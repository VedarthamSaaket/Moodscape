import random
import hmac
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
from email_service import send_email, verification_html
from models import UserCreate, UserLogin, VerifyEmail, ResendCode
from config import logger

router = APIRouter()

# Set by main.py at startup
sp_oauth = None

_DUMMY_HASH = bcrypt.hashpw(b"dummy_constant_password_for_timing", bcrypt.gensalt(rounds=12))


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


@router.get("/health")
def health_check():
    return {"status": "ok", "timestamp": datetime.utcnow().isoformat()}