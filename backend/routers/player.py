"""
Player-queue persistence router.

Backs the in-app music player's queue with the database instead of the browser,
so a user's queue + current track follow them across devices and reloads.
Tied to the verified email. Auth: X-Session-Token (lax=False), same posture as
the quiz / saved routers. Backend is the single source of truth.

One row per user (user_email PK). Runtime-only flags (isPlaying / minimized)
are never persisted — playback never auto-starts on load.
"""
from typing import Any, Optional

from psycopg2.extras import Json, RealDictCursor
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from security import require_session_token
from database import get_db_connection, release_db_connection
from config import logger


router = APIRouter()

_MAX_QUEUE = 200


class PlayerQueuePayload(BaseModel):
    queue:        list[Any] = Field(default_factory=list)
    currentIndex: int = -1


_SCHEMA_INITIALISED = False


def _ensure_schema() -> None:
    global _SCHEMA_INITIALISED
    if _SCHEMA_INITIALISED:
        return
    conn = get_db_connection()
    if not conn:
        logger.error("[PLAYER] Cannot init schema, DB unavailable")
        return
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS player_queue (
                    user_email    TEXT        PRIMARY KEY,
                    queue         JSONB       NOT NULL DEFAULT '[]'::jsonb,
                    current_index INTEGER     NOT NULL DEFAULT -1,
                    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );
                """
            )
            conn.commit()
        _SCHEMA_INITIALISED = True
        logger.info("[PLAYER] player_queue table ready")
    except Exception as exc:
        logger.error(f"[PLAYER] Schema init failed: {exc}")
    finally:
        release_db_connection(conn)


def _clean_queue(items) -> list:
    """Keep only the known track fields, capped, so we never store junk."""
    out = []
    for it in (items or [])[:_MAX_QUEUE]:
        if not isinstance(it, dict):
            continue
        out.append({
            "id":         str(it.get("id") or "")[:64],
            "title":      str(it.get("title") or "Unknown")[:300],
            "artist":     str(it.get("artist") or "")[:300],
            "albumArt":   (str(it.get("albumArt"))[:600] if it.get("albumArt") else None),
            "spotifyUrl": (str(it.get("spotifyUrl"))[:300] if it.get("spotifyUrl") else None),
            "videoId":    (str(it.get("videoId"))[:32] if it.get("videoId") else None),
        })
    return out


# ─────────────────────────────────────────────────────────────────────────────
# GET — the user's stored queue (or empty)
# ─────────────────────────────────────────────────────────────────────────────
@router.get("/api/player/queue")
def get_queue(request: Request):
    email = require_session_token(request, lax=False)
    _ensure_schema()

    conn = get_db_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="Database connection failed")
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                "SELECT queue, current_index FROM player_queue WHERE user_email = %s",
                (email,),
            )
            row = cur.fetchone()
    finally:
        release_db_connection(conn)

    if not row:
        return {"queue": [], "currentIndex": -1}
    return {
        "queue":        row["queue"] or [],
        "currentIndex": row["current_index"] if row["current_index"] is not None else -1,
    }


# ─────────────────────────────────────────────────────────────────────────────
# PUT — upsert the user's queue + current index
# ─────────────────────────────────────────────────────────────────────────────
@router.put("/api/player/queue")
def save_queue(data: PlayerQueuePayload, request: Request):
    email = require_session_token(request, lax=False)
    _ensure_schema()

    queue = _clean_queue(data.queue)
    ci = data.currentIndex if isinstance(data.currentIndex, int) else -1
    if not queue:
        ci = -1
    elif ci < 0 or ci >= len(queue):
        ci = min(max(ci, 0), len(queue) - 1) if ci >= 0 else -1

    conn = get_db_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="Database connection failed")
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO player_queue (user_email, queue, current_index, updated_at)
                VALUES (%s, %s, %s, NOW())
                ON CONFLICT (user_email) DO UPDATE
                  SET queue = EXCLUDED.queue,
                      current_index = EXCLUDED.current_index,
                      updated_at = NOW()
                """,
                (email, Json(queue), ci),
            )
            conn.commit()
    except Exception as exc:
        conn.rollback()
        logger.error(f"[PLAYER] save_queue error: {exc}")
        raise HTTPException(status_code=500, detail="Failed to save queue")
    finally:
        release_db_connection(conn)

    return {"message": "saved", "count": len(queue), "currentIndex": ci}
