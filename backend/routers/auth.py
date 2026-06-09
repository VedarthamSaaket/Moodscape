import random
import hmac
import secrets
import bcrypt
import psycopg2
from datetime import datetime, timedelta

from fastapi import APIRouter, HTTPException, Request

from security import (
    generate_session_token,
    require_session_token,
    record_auth_failure,
    get_client_ip,
    sanitise_user_text,
    validate_spotify_token,
)
from database import get_db_connection, release_db_connection
from email_service import send_email, verification_html, reset_code_html, reset_link_html
from models import (
    UserCreate, UserLogin, VerifyEmail, ResendCode,
    ForgotPassword, VerifyResetCode, ResetPassword,
)
from config import logger, FRONTEND_URL

router = APIRouter()

# Set by main.py at startup
sp_oauth = None

_DUMMY_HASH = bcrypt.hashpw(b"dummy_constant_password_for_timing", bcrypt.gensalt(rounds=12))

# Password-reset columns are added to the existing users table on first use,
# the same idempotent pattern the quiz/youtube/studio routers use for theirs.
_RESET_SCHEMA_READY = False


def _ensure_reset_schema() -> None:
    global _RESET_SCHEMA_READY
    if _RESET_SCHEMA_READY:
        return
    conn = get_db_connection()
    if not conn:
        logger.error("[RESET] Cannot init schema, DB unavailable")
        return
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                ALTER TABLE users
                    ADD COLUMN IF NOT EXISTS reset_code         TEXT,
                    ADD COLUMN IF NOT EXISTS reset_expiry       TIMESTAMPTZ,
                    ADD COLUMN IF NOT EXISTS reset_token        TEXT,
                    ADD COLUMN IF NOT EXISTS reset_token_expiry TIMESTAMPTZ
                """
            )
            conn.commit()
        _RESET_SCHEMA_READY = True
        logger.info("[RESET] password-reset columns ready")
    except Exception as exc:
        logger.error(f"[RESET] Schema init failed: {exc}")
    finally:
        release_db_connection(conn)


@router.post("/api/signup", status_code=201)
def signup_user(user: UserCreate, request: Request):
    if len(user.password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters.")

    conn = get_db_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="Database connection failed")

    hashed = bcrypt.hashpw(user.password.encode(), bcrypt.gensalt(rounds=12))
    code   = str(random.randint(100000, 999999))
    expiry = datetime.utcnow() + timedelta(minutes=15)

    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO users (email, password_hash, verify_code, verify_expiry, is_verified)
                VALUES (%s, %s, %s, %s, FALSE)
                """,
                (user.email, hashed.decode(), code, expiry),
            )
            conn.commit()
        release_db_connection(conn)
    except psycopg2.IntegrityError:
        release_db_connection(conn)
        raise HTTPException(status_code=400, detail="An account with this email already exists.")
    except Exception as exc:
        release_db_connection(conn)
        raise

    ok = send_email(
        to      = user.email,
        subject = "Your MoodScape verification code",
        html    = verification_html(code),
    )
    if not ok:
        raise HTTPException(
            status_code=202,
            detail="Account created, but we couldn't send the verification email. "
                   "Use 'Resend code' on the next screen.",
        )
    return {"message": "Account created! Check your email for the 6-digit code."}


@router.post("/api/verify-email")
def verify_email(data: VerifyEmail):
    conn = get_db_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="Database connection failed")
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT verify_code, verify_expiry, is_verified FROM users WHERE email = %s",
                (data.email,),
            )
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Email not found.")

            db_code, db_expiry, is_verified = row

            if is_verified:
                return {"message": "Email already verified. Please sign in."}
            if datetime.utcnow() > db_expiry:
                raise HTTPException(status_code=400, detail="Code expired — click 'Resend code'.")
            if not hmac.compare_digest(data.code.strip(), db_code.strip()):
                raise HTTPException(status_code=400, detail="Incorrect code. Try again.")

            cur.execute(
                """
                UPDATE users
                SET is_verified = TRUE, verify_code = NULL, verify_expiry = NULL
                WHERE email = %s
                """,
                (data.email,),
            )
            conn.commit()
    finally:
        release_db_connection(conn)

    return {"message": "Email verified! You can now sign in."}


@router.post("/api/resend-verify-code")
def resend_verify_code(data: ResendCode):
    conn = get_db_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="Database connection failed")

    code   = str(random.randint(100000, 999999))
    expiry = datetime.utcnow() + timedelta(minutes=15)

    try:
        with conn.cursor() as cur:
            cur.execute("SELECT id, is_verified FROM users WHERE email = %s", (data.email,))
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Email not found.")
            if row[1]:
                return {"message": "Already verified. Please sign in."}
            cur.execute(
                "UPDATE users SET verify_code = %s, verify_expiry = %s WHERE email = %s",
                (code, expiry, data.email),
            )
            conn.commit()
    finally:
        release_db_connection(conn)

    ok = send_email(
        to      = data.email,
        subject = "Your new MoodScape verification code",
        html    = verification_html(code),
    )
    if not ok:
        raise HTTPException(status_code=500, detail="Couldn't send the email. Try again in a moment.")
    return {"message": "New code sent to your email."}


@router.post("/api/forgot-password")
def forgot_password(data: ForgotPassword):
    """Start a password reset. method='code' emails a 6-digit OTP; method='link'
    emails a one-time reset link. Always returns a generic success message so the
    endpoint can't be used to discover which emails have accounts."""
    _ensure_reset_schema()
    method  = "code" if (data.method or "").strip().lower() == "code" else "link"
    generic = {
        "message": "6-digit code sent! Check your inbox."
        if method == "code"
        else "Reset link sent! Check your inbox."
    }

    conn = get_db_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="Database connection failed")

    now = datetime.utcnow()
    subject = html = None
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT id FROM users WHERE email = %s", (data.email,))
            if not cur.fetchone():
                return generic  # unknown email — say nothing, send nothing

            if method == "code":
                code = str(random.randint(100000, 999999))
                cur.execute(
                    "UPDATE users SET reset_code = %s, reset_expiry = %s WHERE email = %s",
                    (code, now + timedelta(minutes=15), data.email),
                )
                subject, html = "Your MoodScape password reset code", reset_code_html(code)
            else:
                token = secrets.token_urlsafe(32)
                cur.execute(
                    "UPDATE users SET reset_token = %s, reset_token_expiry = %s WHERE email = %s",
                    (token, now + timedelta(minutes=30), data.email),
                )
                link = f"{FRONTEND_URL.rstrip('/')}/forgot-password?resetToken={token}"
                subject, html = "Reset your MoodScape password", reset_link_html(link)
            conn.commit()
    finally:
        release_db_connection(conn)

    if not send_email(to=data.email, subject=subject, html=html):
        raise HTTPException(status_code=500, detail="Couldn't send the email. Try again in a moment.")
    return generic


@router.post("/api/verify-reset-code")
def verify_reset_code(data: VerifyResetCode):
    """Exchange a valid 6-digit reset code for a short-lived reset token."""
    _ensure_reset_schema()
    conn = get_db_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="Database connection failed")
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT reset_code, reset_expiry FROM users WHERE email = %s",
                (data.email,),
            )
            row = cur.fetchone()
            if not row or not row[0]:
                raise HTTPException(status_code=400, detail="Invalid or expired code.")
            db_code, db_expiry = row
            if db_expiry and datetime.utcnow() > db_expiry:
                raise HTTPException(status_code=400, detail="Code expired — request a new one.")
            if not hmac.compare_digest(data.code.strip(), db_code.strip()):
                raise HTTPException(status_code=400, detail="Incorrect code. Try again.")

            token = secrets.token_urlsafe(32)
            cur.execute(
                """
                UPDATE users
                SET reset_token = %s, reset_token_expiry = %s,
                    reset_code = NULL, reset_expiry = NULL
                WHERE email = %s
                """,
                (token, datetime.utcnow() + timedelta(minutes=15), data.email),
            )
            conn.commit()
    finally:
        release_db_connection(conn)
    return {"resetToken": token}


@router.post("/api/reset-password")
def reset_password(data: ResetPassword):
    """Set a new password given a valid reset token (from a link or a verified
    code). Consumes the token and marks the email verified, since reaching this
    point proves ownership of the inbox."""
    _ensure_reset_schema()
    if len(data.newPassword) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters.")

    token = (data.resetToken or "").strip()
    if not token:
        raise HTTPException(status_code=400, detail="Invalid or expired reset link.")

    conn = get_db_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="Database connection failed")
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT email, reset_token_expiry FROM users WHERE reset_token = %s",
                (token,),
            )
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=400, detail="Invalid or expired reset link.")
            email, expiry = row
            if expiry and datetime.utcnow() > expiry:
                raise HTTPException(status_code=400, detail="This reset link has expired. Request a new one.")

            hashed = bcrypt.hashpw(data.newPassword.encode(), bcrypt.gensalt(rounds=12))
            cur.execute(
                """
                UPDATE users
                SET password_hash = %s, is_verified = TRUE,
                    reset_token = NULL, reset_token_expiry = NULL,
                    reset_code = NULL, reset_expiry = NULL
                WHERE email = %s
                """,
                (hashed.decode(), email),
            )
            conn.commit()
    finally:
        release_db_connection(conn)
    return {"message": "Password updated! You can now sign in."}


@router.post("/api/signin")
def signin_user(user: UserLogin, request: Request):
    ip   = get_client_ip(request)
    conn = get_db_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="Database connection failed")
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT password_hash, is_verified FROM users WHERE email = %s",
                (user.email,),
            )
            result = cur.fetchone()
    finally:
        release_db_connection(conn)

    if not result:
        bcrypt.checkpw(user.password.encode(), _DUMMY_HASH)
        record_auth_failure(ip)
        raise HTTPException(status_code=401, detail="Invalid credentials.")

    password_hash, is_verified = result

    if not bcrypt.checkpw(user.password.encode(), password_hash.encode()):
        record_auth_failure(ip)
        raise HTTPException(status_code=401, detail="Invalid credentials.")

    if not is_verified:
        raise HTTPException(
            status_code=403,
            detail="Please verify your email before signing in. Check your inbox or request a new code.",
        )

    session_token = generate_session_token(user.email)
    return {"message": "Sign in successful.", "session_token": session_token}


@router.get("/api/login/spotify")
def spotify_login():
    return {"authorization_url": sp_oauth.get_authorize_url()}


@router.get("/api/callback/spotify")
def spotify_callback(code: str):
    try:
        token_info = sp_oauth.get_access_token(code)
        return {
            "access_token":  token_info.get("access_token"),
            "refresh_token": token_info.get("refresh_token"),
        }
    except Exception as exc:
        logger.error(f"[SPOTIFY] Token exchange error: {exc}")
        raise HTTPException(status_code=400, detail="Auth failed")


@router.post("/api/refresh/spotify")
async def spotify_refresh(request: Request):
    """Exchange a stored Spotify refresh_token for a fresh access_token.

    Spotify access tokens expire after ~1 hour; without this the user would be
    forced to re-authorise mid-session. The frontend calls this when a playback/
    playlist request comes back 401, then retries with the new token.
    """
    require_session_token(request, lax=True)
    if sp_oauth is None:
        raise HTTPException(status_code=503, detail="Spotify auth not configured")
    try:
        body = await request.json()
    except Exception:
        body = {}
    refresh_token = (body or {}).get("refresh_token", "")
    if not refresh_token or not isinstance(refresh_token, str):
        raise HTTPException(status_code=400, detail="refresh_token is required")
    try:
        token_info = sp_oauth.refresh_access_token(refresh_token)
    except Exception as exc:
        logger.error(f"[SPOTIFY] Token refresh error: {exc}")
        raise HTTPException(status_code=401, detail="Could not refresh Spotify token")
    return {
        "access_token":  token_info.get("access_token"),
        # Spotify only sometimes rotates the refresh token; keep the old one if not.
        "refresh_token": token_info.get("refresh_token") or refresh_token,
    }


@router.get("/health")
def health_check():
    return {"status": "ok", "timestamp": datetime.utcnow().isoformat()}