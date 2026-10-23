import os
import re
import time
import hmac
import json
import hashlib
import ipaddress
import logging
import threading
from collections import defaultdict
from typing import Optional

from fastapi import Request, HTTPException
from fastapi.responses import JSONResponse, RedirectResponse
from starlette.middleware.base import BaseHTTPMiddleware

logger = logging.getLogger("moodscape.security")
if not logger.handlers:
    handler = logging.StreamHandler()
    handler.setFormatter(logging.Formatter("%(asctime)s [%(levelname)s] %(message)s"))
    logger.addHandler(handler)
    logger.setLevel(logging.INFO)

# ─────────────────────────────────────────────────────────────────────────────
# Sensitive-field scrubber
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
# Input sanitisation
# ─────────────────────────────────────────────────────────────────────────────

_SQL_INJECTION_RE = re.compile(
    r"(\b(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|EXEC|UNION|SCRIPT)\b|--|;|/\*|\*/)",
    re.IGNORECASE,
)
_XSS_RE = re.compile(
    r"(<script|javascript:|on\w+=|<iframe|<object|<embed|<link\s+rel)",
    re.IGNORECASE,
)
# Characters that could manipulate Spotify search query syntax
_SEARCH_INJECTION_RE = re.compile(r'["\\\x00-\x1f]')

_ALLOWED_LANGUAGE_RE = re.compile(r'^[a-zA-Z /\(\)\-]+$')
_ALLOWED_GENRE_RE    = re.compile(r'^[a-zA-Z0-9 /\(\)\-&+]+$')
_ALLOWED_MOVIE_RE    = re.compile(r'^[a-zA-Z0-9 \'\-\.,&]+$')


def sanitise_user_text(text: str, field_name: str = "input", max_len: int = 500) -> str:
    """
    Validate and clean free-text fields (moodText, playlistIntent) before
    sending to HuggingFace or using in search query construction.
    Raises HTTP 400 on injection patterns.
    """
    if not isinstance(text, str):
        return ""
    text = text.strip()
    if len(text) > max_len:
        raise HTTPException(status_code=400, detail=f"{field_name} must be {max_len} characters or fewer.")
    if _SQL_INJECTION_RE.search(text):
        logger.warning("[SANITISE] SQL injection pattern in %s: %s", field_name, text[:60])
        raise HTTPException(status_code=400, detail=f"Invalid characters in {field_name}.")
    if _XSS_RE.search(text):
        logger.warning("[SANITISE] XSS pattern in %s: %s", field_name, text[:60])
        raise HTTPException(status_code=400, detail=f"Invalid content in {field_name}.")
    return text


def sanitise_search_token(value: str, field_name: str = "field", max_len: int = 100) -> str:
    """
    Clean individual tokens (movie names, genre, language) that are
    interpolated into Spotify search query strings.
    """
    if not isinstance(value, str):
        return ""
    value = value.strip()[:max_len]
    # Strip characters that would break or manipulate search query structure
    value = _SEARCH_INJECTION_RE.sub("", value)
    return value


def sanitise_language(lang: str) -> str:
    lang = lang.strip()[:50]
    if not _ALLOWED_LANGUAGE_RE.match(lang):
        raise HTTPException(status_code=400, detail=f"Invalid language value: {lang!r}")
    return lang


def sanitise_genre(genre: str) -> str:
    genre = genre.strip()[:80]
    if not _ALLOWED_GENRE_RE.match(genre):
        raise HTTPException(status_code=400, detail=f"Invalid genre value: {genre!r}")
    return genre


def sanitise_movie(movie: str) -> str:
    movie = movie.strip()[:120]
    if not _ALLOWED_MOVIE_RE.match(movie):
        raise HTTPException(status_code=400, detail=f"Invalid movie name: {movie!r}")
    return movie


def validate_spotify_token(token: str) -> str:
    """
    Structural validation of a Spotify Bearer token before use.
    Spotify access tokens are Base64url strings, typically 100–400 chars.
    Raises HTTP 401 on clearly malformed tokens.
    """
    if not token or not isinstance(token, str):
        raise HTTPException(status_code=401, detail="Missing Spotify token.")
    token = token.strip()
    if len(token) < 20 or len(token) > 512:
        raise HTTPException(status_code=401, detail="Malformed Spotify token.")
    if not re.match(r'^[A-Za-z0-9\-_=+/]+$', token):
        raise HTTPException(status_code=401, detail="Malformed Spotify token.")
    return token


# ─────────────────────────────────────────────────────────────────────────────
# Secrets validation
# ─────────────────────────────────────────────────────────────────────────────
REQUIRED_SECRETS = [
    "DATABASE_URL",
    "HF_API_TOKEN",
    "SPOTIFY_CLIENT_ID",
    "SPOTIFY_CLIENT_SECRET",
    "SPOTIFY_REDIRECT_URI",
    "SPOTIFY_SCOPES",
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
_SESSION_SECRET: str = ""

def _get_session_secret() -> str:
    global _SESSION_SECRET
    if not _SESSION_SECRET:
        _SESSION_SECRET = os.getenv("SESSION_SECRET", "")
    return _SESSION_SECRET


SESSION_TTL_SECONDS = 7 * 24 * 3600

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
    try:
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


def require_session_token(request: Request, lax: bool = False) -> str:
    token = request.headers.get("X-Session-Token", "").strip()
    if not token:
        if lax:
            return ""
        raise HTTPException(status_code=401, detail="Missing X-Session-Token header.")
    return verify_session_token(token)


# ─────────────────────────────────────────────────────────────────────────────
# Sliding-window per-IP rate limiter
# ─────────────────────────────────────────────────────────────────────────────
class SlidingWindowRateLimiter:
    def __init__(self) -> None:
        self._lock:    threading.Lock         = threading.Lock()
        self._windows: dict[str, list[float]] = defaultdict(list)

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

_RATE_RULES: dict[str, tuple[int, int]] = {
    "/api/auth/firebase":      (10,  60),
    "/api/create-playlist":    (30,  60),
    "/api/add-tracks":         (30,  60),
    "/api/similar-tracks":     (20,  60),
    "/api/get-mood-data":      (20,  60),
    "/api/quiz/suggestions":   (30,  60),
    "/api/quiz/interpret":     (10,  60),
    "/api/youtube/resolve":    (90,  60),
    "/api/images/search":      (60,  60),
    "/api/login/spotify":      (20,  60),
    "/api/callback/spotify":   (20,  60),
    "/api/refresh/spotify":    (30,  60),
    "/api/saved":              (60,  60),
    "/api/saved/add":          (60,  60),
    "/api/saved/remove":       (60,  60),
    "/api/saved/clear":        (10,  60),
    "/api/player/queue":       (120, 60),
    "/api/saint/stats":        (30,  60),
    "/api/saint/record":       (30,  60),
}

SIGNED_IN_LIMIT_MULTIPLIER = 3

def _session_email(request: Request) -> Optional[str]:
    token = request.headers.get("X-Session-Token", "").strip()
    if not token:
        return None
    try:
        return verify_session_token(token)
    except HTTPException:
        return None

def check_rate_limit(request: Request) -> None:
    rule = _RATE_RULES.get(request.url.path)
    if not rule:
        return
    ip    = get_client_ip(request)
    email = _session_email(request)
    who   = f"user:{email}" if email else f"ip:{ip}"
    limit = rule[0] * SIGNED_IN_LIMIT_MULTIPLIER if email else rule[0]
    key   = f"{who}:{request.url.path}"
    if not limiter.is_allowed(key, limit, rule[1]):
        logger.warning(f"[RATELIMIT] {who} exceeded limit on {request.url.path}")
        raise HTTPException(status_code=429, detail="Too many requests. Please slow down.")


# ─────────────────────────────────────────────────────────────────────────────
# Per-IP authentication failure tracking + IP blocking
# ─────────────────────────────────────────────────────────────────────────────
_auth_failures: dict[str, list[float]] = defaultdict(list)
_blocked_ips:   dict[str, float]       = {}
_auth_lock = threading.Lock()

AUTH_FAIL_MAX    = 20
AUTH_FAIL_WINDOW = 120
IP_BLOCK_SECS    = 600

_PROXY_NETWORKS = [
    ipaddress.ip_network(cidr)
    for cidr in (
        "173.245.48.0/20", "103.21.244.0/22", "103.22.200.0/22", "103.31.4.0/22",
        "141.101.64.0/18", "108.162.192.0/18", "190.93.240.0/20", "188.114.96.0/20",
        "197.234.240.0/22", "198.41.128.0/17", "162.158.0.0/15", "104.16.0.0/13",
        "104.24.0.0/14", "172.64.0.0/13", "131.0.72.0/22",
        "2400:cb00::/32", "2606:4700::/32", "2803:f800::/32", "2405:b500::/32",
        "2405:8100::/32", "2a06:98c0::/29", "2c0f:f248::/32",
    )
]


def _parse_ip(value: str):
    try:
        return ipaddress.ip_address(value.strip().strip("[]"))
    except ValueError:
        return None


def _is_proxy_hop(ip) -> bool:
    return (
        ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved
        or any(ip in network for network in _PROXY_NETWORKS)
    )


def get_client_ip(request: Request) -> str:
    peer = request.client.host if request.client else "unknown"
    peer_ip = _parse_ip(peer)
    if peer_ip is None or not _is_proxy_hop(peer_ip):
        return peer
    for value in reversed(request.headers.get("X-Forwarded-For", "").split(",")):
        ip = _parse_ip(value)
        if ip is None or ip == peer_ip or _is_proxy_hop(ip):
            continue
        return str(ip)
    return peer

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
    "/api/auth/firebase",
})

def check_bot_signals(request: Request) -> Optional[str]:
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
# Central SecurityMiddleware
# ─────────────────────────────────────────────────────────────────────────────
class SecurityMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        start = time.time()
        ip    = get_client_ip(request)
        path  = request.url.path

        if os.getenv("FORCE_HTTPS") == "true" and request.url.scheme == "http":
            https_url = str(request.url).replace("http://", "https://", 1)
            return RedirectResponse(url=https_url, status_code=301)

        if is_ip_blocked(ip):
            logger.warning(f"[SECURITY] Blocked IP {ip} attempted {path}")
            return JSONResponse(
                status_code=429,
                content={"detail": "Too many failed attempts. Please try again later."},
            )

        bot_reason = check_bot_signals(request)
        if bot_reason:
            logger.warning(f"[BOT] {ip} blocked on {path}: {bot_reason}")
            return JSONResponse(status_code=403, content={"detail": "Access denied."})

        try:
            check_rate_limit(request)
        except HTTPException as exc:
            return JSONResponse(
                status_code=exc.status_code,
                content={"detail": exc.detail},
            )

        response   = await call_next(request)
        elapsed_ms = (time.time() - start) * 1000

        for header, value in _SECURITY_HEADERS.items():
            response.headers[header] = value

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