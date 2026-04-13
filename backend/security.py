import os
import re
import time
import hmac
import json
import hashlib
import logging
import threading
from collections import defaultdict
from typing import Optional

from fastapi import Request, HTTPException
from fastapi.responses import JSONResponse, RedirectResponse
from starlette.middleware.base import BaseHTTPMiddleware

# ─────────────────────────────────────────────────────────────────────────────
# Structured logger
# ─────────────────────────────────────────────────────────────────────────────
logger = logging.getLogger("moodscape.security")
if not logger.handlers:
    handler = logging.StreamHandler()
    handler.setFormatter(logging.Formatter("%(asctime)s [%(levelname)s] %(message)s"))
    logger.addHandler(handler)
    logger.setLevel(logging.INFO)

# ─────────────────────────────────────────────────────────────────────────────
# Sensitive-field scrubber  (used before anything hits logs)
# ─────────────────────────────────────────────────────────────────────────────
_SENSITIVE = {
    "password", "password_hash", "access_token", "refresh_token",
    "session_token", "verify_code", "gmail_app_password",
    "hf_api_token", "spotify_client_secret", "database_url",
    "unsplash_access_key", "session_secret",
}

def scrub_sensitive_from_log(data: dict) -> dict:
    out = {}
    for k, v in data.items():
        if k.lower() in _SENSITIVE:
            out[k] = "***REDACTED***"
        elif isinstance(v, dict):
            out[k] = scrub_sensitive_from_log(v)
        else:
            out[k] = v
    return out


# ─────────────────────────────────────────────────────────────────────────────
# Secrets validation  – server refuses to boot if any required var is missing
# ─────────────────────────────────────────────────────────────────────────────
REQUIRED_SECRETS = [
    "DATABASE_URL",
    "HF_API_TOKEN",
    "SPOTIFY_CLIENT_ID",
    "SPOTIFY_CLIENT_SECRET",
    "SPOTIFY_REDIRECT_URI",
    "SPOTIFY_SCOPES",
    "GMAIL_USER",
    "GMAIL_APP_PASSWORD",
    "SESSION_SECRET",
    "UNSPLASH_ACCESS_KEY",
]

def validate_secrets() -> None:
    missing = [k for k in REQUIRED_SECRETS if not os.getenv(k)]
    if missing:
        raise RuntimeError(
            f"[STARTUP] Missing required environment variables: {', '.join(missing)}. "
            "Server refusing to start — add them to .env and restart."
        )
    logger.info("[STARTUP] All required secrets present ✓")


# ─────────────────────────────────────────────────────────────────────────────
# HMAC-signed session token
# ─────────────────────────────────────────────────────────────────────────────
_SESSION_SECRET: str = ""   # initialised lazily from env so import order is safe

def _get_session_secret() -> str:
    global _SESSION_SECRET
    if not _SESSION_SECRET:
        _SESSION_SECRET = os.getenv("SESSION_SECRET", "")
    return _SESSION_SECRET


SESSION_TTL_SECONDS = 7 * 24 * 3600   # 7 days

def generate_session_token(email: str) -> str:
    ts      = str(int(time.time()))
    payload = f"{email}:{ts}"
    sig     = hmac.new(
        _get_session_secret().encode(),
        payload.encode(),
        hashlib.sha256,
    ).hexdigest()
    return f"{payload}:{sig}"


def verify_session_token(token: str) -> str:
    """
    Returns the verified email on success.
    Raises HTTPException(401) on any failure.
    """
    try:
        # token format: email:timestamp:hmac_hex
        # We split from the right so emails with colons are handled safely
        parts = token.rsplit(":", 2)
        if len(parts) != 3:
            raise ValueError("bad format")
        email, ts, sig = parts
        expected_payload = f"{email}:{ts}"
        expected_sig = hmac.new(
            _get_session_secret().encode(),
            expected_payload.encode(),
            hashlib.sha256,
        ).hexdigest()
        if not hmac.compare_digest(sig, expected_sig):
            raise ValueError("invalid signature")
        if time.time() - int(ts) > SESSION_TTL_SECONDS:
            raise ValueError("token expired")
        return email
    except HTTPException:
        raise
    except Exception:
        logger.warning("[AUTH] Invalid session token presented")
        raise HTTPException(status_code=401, detail="Invalid or expired session token.")


def require_session_token(request: Request) -> str:
    """
    Convenience extractor — pulls X-Session-Token from headers and verifies it.
    Returns the verified email.
    """
    token = request.headers.get("X-Session-Token", "").strip()
    if not token:
        raise HTTPException(status_code=401, detail="Missing X-Session-Token header.")
    return verify_session_token(token)


# ─────────────────────────────────────────────────────────────────────────────
# Sliding-window per-IP rate limiter
# ─────────────────────────────────────────────────────────────────────────────
class SlidingWindowRateLimiter:
    def __init__(self) -> None:
        self._lock:    threading.Lock                  = threading.Lock()
        self._windows: dict[str, list[float]]          = defaultdict(list)

    def is_allowed(self, key: str, max_requests: int, window_seconds: int) -> bool:
        now    = time.time()
        cutoff = now - window_seconds
        with self._lock:
            self._windows[key] = [t for t in self._windows[key] if t > cutoff]
            if len(self._windows[key]) >= max_requests:
                return False
            self._windows[key].append(now)
            return True

    def cleanup_old_keys(self, max_idle_seconds: int = 3600) -> None:
        now = time.time()
        with self._lock:
            stale = [
                k for k, ts in self._windows.items()
                if not ts or now - max(ts) > max_idle_seconds
            ]
            for k in stale:
                del self._windows[k]
        if stale:
            logger.info(f"[RATELIMIT] Cleaned up {len(stale)} stale rate-limit keys.")


limiter = SlidingWindowRateLimiter()

# Background thread — runs cleanup every 10 minutes so memory never grows unbounded
def _start_cleanup_scheduler() -> None:
    def _loop() -> None:
        while True:
            time.sleep(600)
            try:
                limiter.cleanup_old_keys()
            except Exception as exc:
                logger.error(f"[RATELIMIT] Cleanup error: {exc}")
    t = threading.Thread(target=_loop, daemon=True, name="rate-limiter-gc")
    t.start()

_start_cleanup_scheduler()

# Rate-limit rules: path → (max_requests, window_seconds)
_RATE_RULES: dict[str, tuple[int, int]] = {
    "/api/signin":             (10,  60),    # 10 / minute
    "/api/signup":             (5,  300),    # 5  / 5 min
    "/api/verify-email":       (10,  60),
    "/api/resend-verify-code": (3,  300),    # 3  / 5 min
    "/api/create-playlist":    (30,  60),
    "/api/add-tracks":         (30,  60),
    "/api/similar-tracks":     (20,  60),
    "/api/get-mood-data":      (20,  60),
    "/api/login/spotify":      (20,  60),
    "/api/callback/spotify":   (20,  60),
}

def check_rate_limit(request: Request) -> None:
    rule = _RATE_RULES.get(request.url.path)
    if not rule:
        return
    ip  = get_client_ip(request)
    key = f"{ip}:{request.url.path}"
    if not limiter.is_allowed(key, rule[0], rule[1]):
        logger.warning(f"[RATELIMIT] {ip} exceeded limit on {request.url.path}")
        raise HTTPException(status_code=429, detail="Too many requests. Please slow down.")


# ─────────────────────────────────────────────────────────────────────────────
# Per-IP authentication failure tracking + IP blocking
# ─────────────────────────────────────────────────────────────────────────────
_auth_failures: dict[str, list[float]] = defaultdict(list)
_blocked_ips:   dict[str, float]       = {}
_auth_lock = threading.Lock()

AUTH_FAIL_MAX    = 20     # failures inside the window triggers a block
AUTH_FAIL_WINDOW = 120    # 2-minute rolling window
IP_BLOCK_SECS    = 600   # 10-minute block

def get_client_ip(request: Request) -> str:
    forwarded = request.headers.get("X-Forwarded-For", "")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"

def record_auth_failure(ip: str) -> None:
    now = time.time()
    with _auth_lock:
        _auth_failures[ip] = [
            t for t in _auth_failures[ip] if now - t < AUTH_FAIL_WINDOW
        ]
        _auth_failures[ip].append(now)
        if len(_auth_failures[ip]) >= AUTH_FAIL_MAX:
            _blocked_ips[ip] = now + IP_BLOCK_SECS
            logger.warning(
                f"[SECURITY] IP {ip} auto-blocked for {IP_BLOCK_SECS}s "
                f"after {AUTH_FAIL_MAX} consecutive auth failures."
            )

def is_ip_blocked(ip: str) -> bool:
    with _auth_lock:
        unblock_at = _blocked_ips.get(ip)
        if not unblock_at:
            return False
        if time.time() < unblock_at:
            return True
        del _blocked_ips[ip]
        return False


# ─────────────────────────────────────────────────────────────────────────────
# Bot / automated-client detection
# ─────────────────────────────────────────────────────────────────────────────
_BLOCKED_UA_RE = re.compile(
    r"python-requests|curl/|wget/|scrapy|httpx|go-http-client"
    r"|java/|okhttp|axios/|node-fetch|libwww|ApacheBench"
    r"|zgrab|masscan|nmap|sqlmap|nikto|dirbuster|wfuzz|nuclei",
    re.IGNORECASE,
)

_AUTH_PATHS = frozenset({
    "/api/signin",
    "/api/signup",
    "/api/verify-email",
    "/api/resend-verify-code",
})

def check_bot_signals(request: Request) -> Optional[str]:
    """
    Returns a human-readable block reason if the request looks like a bot,
    or None if the request looks legitimate.
    Only enforced on auth-sensitive paths.
    """
    if request.url.path not in _AUTH_PATHS:
        return None
    ua = request.headers.get("User-Agent", "").strip()
    if not ua:
        return "Missing User-Agent"
    if _BLOCKED_UA_RE.search(ua):
        return f"Automated client blocked: {ua[:80]}"
    return None


# ─────────────────────────────────────────────────────────────────────────────
# Security response headers
# ─────────────────────────────────────────────────────────────────────────────
_SECURITY_HEADERS: dict[str, str] = {
    "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
    "X-Content-Type-Options":    "nosniff",
    "X-Frame-Options":           "DENY",
    "X-XSS-Protection":          "1; mode=block",
    "Referrer-Policy":           "strict-origin-when-cross-origin",
    "Permissions-Policy":        "camera=(), microphone=(), geolocation=()",
    "Content-Security-Policy": (
        "default-src 'self'; "
        "script-src 'self'; "
        "style-src 'self' 'unsafe-inline'; "
        "img-src 'self' data: https:; "
        "connect-src 'self' https://api.spotify.com https://api.unsplash.com "
        "https://api-inference.huggingface.co; "
        "frame-ancestors 'none';"
    ),
}


# ─────────────────────────────────────────────────────────────────────────────
# Central SecurityMiddleware  (add to app AFTER CORSMiddleware)
# ─────────────────────────────────────────────────────────────────────────────
class SecurityMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        start = time.time()
        ip    = get_client_ip(request)
        path  = request.url.path

        # 1. Force HTTPS in production
        if os.getenv("FORCE_HTTPS") == "true" and request.url.scheme == "http":
            https_url = str(request.url).replace("http://", "https://", 1)
            return RedirectResponse(url=https_url, status_code=301)

        # 2. Reject blocked IPs immediately
        if is_ip_blocked(ip):
            logger.warning(f"[SECURITY] Blocked IP {ip} attempted {path}")
            return JSONResponse(
                status_code=429,
                content={"detail": "Too many failed attempts. Please try again later."},
            )

        # 3. Bot detection
        bot_reason = check_bot_signals(request)
        if bot_reason:
            logger.warning(f"[BOT] {ip} blocked on {path}: {bot_reason}")
            return JSONResponse(status_code=403, content={"detail": "Access denied."})

        # 4. Rate limiting
        try:
            check_rate_limit(request)
        except HTTPException as exc:
            return JSONResponse(
                status_code=exc.status_code,
                content={"detail": exc.detail},
            )

        # 5. Process request
        response   = await call_next(request)
        elapsed_ms = (time.time() - start) * 1000

        # 6. Inject security headers on every response
        for header, value in _SECURITY_HEADERS.items():
            response.headers[header] = value

        # 7. Structured access log; flag slow responses as anomalies
        entry = {
            "ip":     ip,
            "method": request.method,
            "path":   path,
            "status": response.status_code,
            "ms":     round(elapsed_ms, 1),
        }
        if elapsed_ms > 8000:
            logger.warning(f"[SLOW_REQUEST] {json.dumps(entry)}")
        else:
            logger.info(f"[ACCESS] {json.dumps(entry)}")

        return response


# ─────────────────────────────────────────────────────────────────────────────
# IDOR / ownership helpers
# ─────────────────────────────────────────────────────────────────────────────
def assert_owns_resource(
    requesting_email: str,
    resource_owner_email: str,
    resource_label: str = "resource",
) -> None:
    """
    Raises 403 if the requesting user is not the resource owner.
    Drop this into any endpoint that reads / modifies per-user data.
    """
    if requesting_email.lower().strip() != resource_owner_email.lower().strip():
        logger.warning(
            f"[IDOR] {requesting_email} attempted access to {resource_label} "
            f"owned by {resource_owner_email}"
        )
        raise HTTPException(
            status_code=403,
            detail="Access denied: you do not own this resource.",
        )


def safe_email_lookup(conn, email: str) -> Optional[dict]:
    """
    Fetches only the columns the app actually needs for the given email.
    Returns None (not raises) when the row is missing — callers decide the error.
    """
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id, email, is_verified FROM users WHERE email = %s LIMIT 1",
                (email,),
            )
            row = cur.fetchone()
            if not row:
                return None
            return {"id": row[0], "email": row[1], "is_verified": row[2]}
    except Exception as exc:
        logger.error(f"[DB] safe_email_lookup error: {exc}")
        return None