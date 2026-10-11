import asyncio
import secrets
import urllib.parse

from datetime import datetime, timezone

import bcrypt
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import RedirectResponse
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token as google_id_token

from security import (
    generate_session_token,
    require_session_token,
    record_auth_failure,
    get_client_ip,
)
from database import get_db_connection, release_db_connection
from spotify import get_spotify_user_profile
from models import FirebaseSignin
from config import logger, FRONTEND_URL, FIREBASE_PROJECT_ID

router = APIRouter()

_google_request = google_requests.Request()

sp_oauth = None

_SCHEMA_READY = False


def _ensure_schema() -> None:
    global _SCHEMA_READY
    if _SCHEMA_READY:
        return
    conn = get_db_connection()
    if not conn:
        logger.error("[AUTH] Cannot init schema, DB unavailable")
        return
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS users (
                    id                   SERIAL PRIMARY KEY,
                    email                TEXT        NOT NULL UNIQUE,
                    password_hash        TEXT        NOT NULL,
                    is_verified          BOOLEAN     NOT NULL DEFAULT FALSE,
                    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );
                """
            )
            cur.execute(
                "ALTER TABLE users ADD COLUMN IF NOT EXISTS firebase_uid TEXT"
            )
            cur.execute(
                "CREATE UNIQUE INDEX IF NOT EXISTS ix_users_firebase_uid "
                "ON users (firebase_uid) WHERE firebase_uid IS NOT NULL"
            )
            conn.commit()
        _SCHEMA_READY = True
        logger.info("[AUTH] users table ready")
    except Exception as exc:
        logger.error(f"[AUTH] Schema init failed: {exc}")
    finally:
        release_db_connection(conn)


def _verify_firebase_token(token: str) -> dict:
    project = FIREBASE_PROJECT_ID
    claims = google_id_token.verify_firebase_token(token, _google_request, audience=project)
    if not claims or claims.get("iss") != f"https://securetoken.google.com/{project}":
        raise ValueError("wrong issuer")
    if not claims.get("sub") or not claims.get("email"):
        raise ValueError("token carries no account")
    if not claims.get("email_verified"):
        raise ValueError("email not verified")
    return claims


def _upsert_firebase_user(uid: str, email: str) -> bool:
    conn = get_db_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="Database connection failed")
    is_new = False
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT email FROM users WHERE firebase_uid = %s", (uid,))
            if cur.fetchone():
                return False

            cur.execute("SELECT email FROM users WHERE email = %s", (email,))
            existing = cur.fetchone()
            if existing:
                cur.execute(
                    "UPDATE users SET firebase_uid = %s, is_verified = TRUE WHERE email = %s",
                    (uid, email),
                )
            else:
                unusable_hash = bcrypt.hashpw(secrets.token_bytes(32), bcrypt.gensalt(rounds=12)).decode()
                cur.execute(
                    """
                    INSERT INTO users (email, password_hash, is_verified, firebase_uid, created_at)
                    VALUES (%s, %s, TRUE, %s, NOW())
                    """,
                    (email, unusable_hash, uid),
                )
                is_new = True
            conn.commit()
    finally:
        release_db_connection(conn)
    return is_new


@router.post("/api/auth/firebase")
async def firebase_signin(data: FirebaseSignin, request: Request):
    if not FIREBASE_PROJECT_ID:
        raise HTTPException(status_code=503, detail="Sign-in is not configured yet.")
    try:
        claims = await asyncio.to_thread(_verify_firebase_token, data.id_token)
    except Exception as exc:
        logger.warning(f"[AUTH] rejected Firebase token: {type(exc).__name__}")
        record_auth_failure(get_client_ip(request))
        raise HTTPException(status_code=401, detail="Could not verify your Google sign-in.")

    uid   = claims["sub"]
    email = claims["email"].strip().lower()
    is_new = _upsert_firebase_user(uid, email)

    session_token = generate_session_token(email)
    return {
        "message": "Signed in.",
        "session_token": session_token,
        "email": email,
        "is_new": is_new,
        "full_name": claims.get("name"),
    }


@router.get("/api/login/spotify")
def spotify_login():
    return {"authorization_url": sp_oauth.get_authorize_url()}


def _upsert_spotify_user(email: str) -> None:
    conn = get_db_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="Database connection failed")
    try:
        unusable_hash = bcrypt.hashpw(secrets.token_bytes(32), bcrypt.gensalt(rounds=12)).decode()
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO users (email, password_hash, is_verified, created_at)
                VALUES (%s, %s, TRUE, NOW())
                ON CONFLICT (email) DO UPDATE
                  SET is_verified = TRUE
                """,
                (email, unusable_hash),
            )
            conn.commit()
    finally:
        release_db_connection(conn)


@router.get("/api/callback/spotify")
def spotify_callback(code: str, request: Request):
    try:
        token_info = sp_oauth.get_access_token(code)
    except Exception as exc:
        logger.error(f"[SPOTIFY] Token exchange error: {exc}")
        accept = (request.headers.get("accept") or "")
        if "text/html" in accept:
            fail_url = f"{FRONTEND_URL.rstrip('/')}/generator?spotify=failed"
            return RedirectResponse(url=fail_url)
        raise HTTPException(status_code=400, detail="Auth failed")

    access_token  = token_info.get("access_token", "")
    refresh_token = token_info.get("refresh_token", "")

    session_token = None
    try:
        profile = get_spotify_user_profile(access_token)
        if not profile:
            logger.warning("[SPOTIFY] profile returned None")
        else:
            email = (profile or {}).get("email")
            if email:
                email = email.strip().lower()
                _upsert_spotify_user(email)
                session_token = generate_session_token(email)
                logger.info(f"[SPOTIFY] bridged session for {email}")
            else:
                logger.warning("[SPOTIFY] profile had no email; no app session minted")
    except HTTPException:
        raise
    except Exception as exc:
        logger.error(f"[SPOTIFY] session bridge failed: {exc}")

    accept = (request.headers.get("accept") or "")
    is_browser_nav = "text/html" in accept

    if is_browser_nav:
        params = [
            ("spotify_auth", "success"),
            ("access_token", access_token),
            ("refresh_token", refresh_token),
        ]
        if session_token:
            params.append(("session_token", session_token))
        query = "&".join(
            f"{urllib.parse.quote(k)}={urllib.parse.quote(v)}"
            for k, v in params if v
        )
        redirect_url = f"{FRONTEND_URL.rstrip('/')}/callback?{query}"
        logger.info(f"[SPOTIFY] redirecting browser to {redirect_url[:80]}...")
        return RedirectResponse(url=redirect_url)

    resp = {"access_token": access_token, "refresh_token": refresh_token}
    if session_token:
        resp["session_token"] = session_token
    return resp


@router.post("/api/refresh/spotify")
async def spotify_refresh(request: Request):
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
        "refresh_token": token_info.get("refresh_token") or refresh_token,
    }


@router.get("/health")
def health_check():
    return {"status": "ok", "timestamp": datetime.now(timezone.utc).isoformat()}
