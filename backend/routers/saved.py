"""
Saved-songs persistence router.

Stores the individual songs a user hearts from the post-quiz suggestions (or
anywhere else) so they can return and replay them. Tied to the user's verified
email. Auth: requires X-Session-Token (lax=False) — same posture as the quiz
and studio routers. Backend is the single source of truth; the client holds no
durable copy.

Schema is created idempotently at first use; no separate migration step.
One row per (user_email, song_key); newest-first on read.
"""
from typing import Optional

from psycopg2.extras import RealDictCursor
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from security import require_session_token, sanitise_user_text
from database import get_db_connection, release_db_connection
from config import logger


router = APIRouter()


# ─────────────────────────────────────────────────────────────────────────────
# Models
# ─────────────────────────────────────────────────────────────────────────────
class SavedSong(BaseModel):
    title:      str
    artist:     str = ""
    albumArt:   Optional[str] = None
    spotifyUrl: Optional[str] = None


# ─────────────────────────────────────────────────────────────────────────────
# Idempotent schema bootstrap
# ─────────────────────────────────────────────────────────────────────────────
_SCHEMA_INITIALISED = False


def _ensure_schema() -> None:
    global _SCHEMA_INITIALISED
    if _SCHEMA_INITIALISED:
        return
    conn = get_db_connection()
    if not conn:
        logger.error("[SAVED] Cannot init schema, DB unavailable")
        return
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS saved_songs (
                    user_email  TEXT        NOT NULL,
                    song_key    TEXT        NOT NULL,
                    title       TEXT        NOT NULL,
                    artist      TEXT        NOT NULL DEFAULT '',
                    album_art   TEXT,
                    spotify_url TEXT,
                    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    PRIMARY KEY (user_email, song_key)
                );
                """
            )
            conn.commit()
        _SCHEMA_INITIALISED = True
        logger.info("[SAVED] saved_songs table ready")
    except Exception as exc:
        logger.error(f"[SAVED] Schema init failed: {exc}")
    finally:
        release_db_connection(conn)


def _key(song: SavedSong) -> str:
    """Stable identity, mirrors the frontend's savedKey(): spotify url, else
    title·artist."""
    raw = (song.spotifyUrl or f"{song.title}·{song.artist}").strip()
    return raw[:400]


def _clean(song: SavedSong) -> SavedSong:
    return SavedSong(
        title      = sanitise_user_text((song.title or "").strip(), "title", max_len=300) or "Unknown",
        artist     = sanitise_user_text((song.artist or "").strip(), "artist", max_len=300),
        albumArt   = (song.albumArt or None),
        spotifyUrl = (song.spotifyUrl or None),
    )


# ─────────────────────────────────────────────────────────────────────────────
# GET — the user's saved songs, newest first
# ─────────────────────────────────────────────────────────────────────────────
@router.get("/api/saved")
def list_saved(request: Request):
    email = require_session_token(request, lax=False)
    _ensure_schema()

    conn = get_db_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="Database connection failed")
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                "SELECT title, artist, album_art, spotify_url "
                "FROM saved_songs WHERE user_email = %s ORDER BY created_at DESC",
                (email,),
            )
            rows = cur.fetchall()
    finally:
        release_db_connection(conn)

    saved = [
        {
            "title":      r["title"],
            "artist":     r["artist"],
            "albumArt":   r.get("album_art"),
            "spotifyUrl": r.get("spotify_url"),
        }
        for r in rows
    ]
    return {"saved": saved}


# ─────────────────────────────────────────────────────────────────────────────
# POST /add — upsert one song
# ─────────────────────────────────────────────────────────────────────────────
@router.post("/api/saved/add")
def add_saved(song: SavedSong, request: Request):
    email = require_session_token(request, lax=False)
    _ensure_schema()
    logger.info(f"[SAVED] add_saved called for {email}")

    song = _clean(song)
    if not song.title:
        logger.error("[SAVED] title missing")
        raise HTTPException(status_code=400, detail="title is required")
    key = _key(song)
    logger.info(f"[SAVED] add key={key}")

    conn = get_db_connection()
    if not conn:
        logger.error("[SAVED] get_db_connection returned None")
        raise HTTPException(status_code=500, detail="Database connection failed")
    try:
        with conn.cursor() as cur:
            logger.debug(f"[SAVED] executing INSERT for {email}, {key}")
            cur.execute(
                """
                INSERT INTO saved_songs (user_email, song_key, title, artist, album_art, spotify_url)
                VALUES (%s, %s, %s, %s, %s, %s)
                ON CONFLICT (user_email, song_key) DO UPDATE
                  SET title = EXCLUDED.title, artist = EXCLUDED.artist,
                      album_art = EXCLUDED.album_art, spotify_url = EXCLUDED.spotify_url
                """,
                (email, key, song.title, song.artist, song.albumArt, song.spotifyUrl),
            )
            conn.commit()
            logger.info(f"[SAVED] added/updated {key} for {email}")
    except Exception as exc:
        conn.rollback()
        logger.error(f"[SAVED] add error: {exc}")
        raise HTTPException(status_code=500, detail="Failed to save song")
    finally:
        release_db_connection(conn)

    return {"message": "saved", "key": key}


# ─────────────────────────────────────────────────────────────────────────────
# POST /remove — delete one song
# ─────────────────────────────────────────────────────────────────────────────
@router.post("/api/saved/remove")
def remove_saved(song: SavedSong, request: Request):
    email = require_session_token(request, lax=False)
    _ensure_schema()
    key = _key(_clean(song))

    conn = get_db_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="Database connection failed")
    try:
        with conn.cursor() as cur:
            cur.execute(
                "DELETE FROM saved_songs WHERE user_email = %s AND song_key = %s",
                (email, key),
            )
            conn.commit()
    finally:
        release_db_connection(conn)

    return {"message": "removed", "key": key}


# ─────────────────────────────────────────────────────────────────────────────
# POST /clear — wipe all saved songs for the user
# ─────────────────────────────────────────────────────────────────────────────
@router.post("/api/saved/clear")
def clear_saved(request: Request):
    email = require_session_token(request, lax=False)
    _ensure_schema()

    conn = get_db_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="Database connection failed")
    try:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM saved_songs WHERE user_email = %s", (email,))
            conn.commit()
    finally:
        release_db_connection(conn)

    return {"message": "cleared"}
