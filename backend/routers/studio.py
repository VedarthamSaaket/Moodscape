"""
Studio (moodboard) persistence router.

Stores each user's moodboards as JSONB rows tied to the verified user email.
Auth: requires X-Session-Token. Anonymous access is rejected (boards must
belong to a real user to survive across sessions and devices).

Schema is created idempotently at module import — no separate migration step.
"""
from datetime import datetime
from typing import Optional, Any

import psycopg2
from psycopg2.extras import Json, RealDictCursor
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from security import require_session_token, assert_owns_resource
from database import get_db_connection, release_db_connection
from config import logger


router = APIRouter()


# ─────────────────────────────────────────────────────────────────────────────
# Models
# ─────────────────────────────────────────────────────────────────────────────
class BoardPayload(BaseModel):
    """Board state coming from the frontend Zustand store.

    `id` is a client-generated short string (see frontend/src/store.js `uid()`).
    We treat it as opaque; uniqueness is per (user_email, id).
    """
    id: str
    name: str = "Untitled Board"
    layout: str = "freeform"
    cards: list[Any] = []
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


class BoardsBulkPayload(BaseModel):
    boards: list[BoardPayload]


# ─────────────────────────────────────────────────────────────────────────────
# One-time idempotent schema bootstrap
# ─────────────────────────────────────────────────────────────────────────────
_SCHEMA_INITIALISED = False


def _ensure_schema() -> None:
    global _SCHEMA_INITIALISED
    if _SCHEMA_INITIALISED:
        return
    conn = get_db_connection()
    if not conn:
        logger.error("[STUDIO] Cannot init schema — DB unavailable")
        return
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS studio_boards (
                    user_email   TEXT      NOT NULL,
                    board_id     TEXT      NOT NULL,
                    name         TEXT      NOT NULL DEFAULT 'Untitled Board',
                    layout       TEXT      NOT NULL DEFAULT 'freeform',
                    cards        JSONB     NOT NULL DEFAULT '[]'::jsonb,
                    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    PRIMARY KEY (user_email, board_id)
                );
                """
            )
            cur.execute(
                "CREATE INDEX IF NOT EXISTS studio_boards_user_idx "
                "ON studio_boards (user_email, updated_at DESC);"
            )
            conn.commit()
        _SCHEMA_INITIALISED = True
        logger.info("[STUDIO] studio_boards table ready ✓")
    except Exception as exc:
        logger.error(f"[STUDIO] Schema init failed: {exc}")
    finally:
        release_db_connection(conn)


def _parse_ts(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except Exception:
        return None


def _row_to_board(row: dict) -> dict:
    return {
        "id":         row["board_id"],
        "name":       row["name"],
        "layout":     row["layout"],
        "cards":      row["cards"] or [],
        "created_at": row["created_at"].isoformat() if row["created_at"] else None,
        "updated_at": row["updated_at"].isoformat() if row["updated_at"] else None,
    }


# ─────────────────────────────────────────────────────────────────────────────
# GET — list all boards owned by the authenticated user
# ─────────────────────────────────────────────────────────────────────────────
@router.get("/api/boards")
def list_boards(request: Request):
    email = require_session_token(request, lax=False)
    _ensure_schema()

    conn = get_db_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="Database connection failed")
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                "SELECT board_id, name, layout, cards, created_at, updated_at "
                "FROM studio_boards WHERE user_email = %s "
                "ORDER BY updated_at DESC",
                (email,),
            )
            rows = cur.fetchall()
    finally:
        release_db_connection(conn)

    return {"boards": [_row_to_board(r) for r in rows]}


# ─────────────────────────────────────────────────────────────────────────────
# PUT — upsert a single board
# ─────────────────────────────────────────────────────────────────────────────
@router.put("/api/boards/{board_id}")
def upsert_board(board_id: str, data: BoardPayload, request: Request):
    email = require_session_token(request, lax=False)
    _ensure_schema()

    if data.id != board_id:
        raise HTTPException(status_code=400, detail="board_id mismatch between URL and body")

    name = (data.name or "Untitled Board")[:200]
    layout = (data.layout or "freeform")[:40]
    created_at = _parse_ts(data.created_at) or datetime.utcnow()
    updated_at = _parse_ts(data.updated_at) or datetime.utcnow()

    conn = get_db_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="Database connection failed")
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO studio_boards
                    (user_email, board_id, name, layout, cards, created_at, updated_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (user_email, board_id) DO UPDATE
                  SET name       = EXCLUDED.name,
                      layout     = EXCLUDED.layout,
                      cards      = EXCLUDED.cards,
                      updated_at = EXCLUDED.updated_at
                """,
                (email, board_id, name, layout, Json(data.cards or []), created_at, updated_at),
            )
            conn.commit()
    except Exception as exc:
        conn.rollback()
        logger.error(f"[STUDIO] upsert_board error: {exc}")
        raise HTTPException(status_code=500, detail="Failed to save board")
    finally:
        release_db_connection(conn)

    return {"message": "Board saved.", "board_id": board_id, "updated_at": updated_at.isoformat()}


# ─────────────────────────────────────────────────────────────────────────────
# POST — bulk sync (first load: merge local + server, write the union)
# ─────────────────────────────────────────────────────────────────────────────
@router.post("/api/boards/sync")
def sync_boards(data: BoardsBulkPayload, request: Request):
    """Upsert a batch. Used by the frontend on auth/login to push any boards
    that exist only in localStorage up to the server in one round trip."""
    email = require_session_token(request, lax=False)
    _ensure_schema()

    conn = get_db_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="Database connection failed")

    saved = 0
    try:
        with conn.cursor() as cur:
            for b in data.boards:
                name = (b.name or "Untitled Board")[:200]
                layout = (b.layout or "freeform")[:40]
                created_at = _parse_ts(b.created_at) or datetime.utcnow()
                updated_at = _parse_ts(b.updated_at) or datetime.utcnow()
                cur.execute(
                    """
                    INSERT INTO studio_boards
                        (user_email, board_id, name, layout, cards, created_at, updated_at)
                    VALUES (%s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (user_email, board_id) DO UPDATE
                      SET name       = EXCLUDED.name,
                          layout     = EXCLUDED.layout,
                          cards      = EXCLUDED.cards,
                          updated_at = GREATEST(studio_boards.updated_at, EXCLUDED.updated_at)
                    """,
                    (email, b.id, name, layout, Json(b.cards or []), created_at, updated_at),
                )
                saved += 1
            conn.commit()

            cur.execute(
                "SELECT board_id, name, layout, cards, created_at, updated_at "
                "FROM studio_boards WHERE user_email = %s "
                "ORDER BY updated_at DESC",
                (email,),
            )
            rows = cur.fetchall()
    except Exception as exc:
        conn.rollback()
        logger.error(f"[STUDIO] sync_boards error: {exc}")
        raise HTTPException(status_code=500, detail="Failed to sync boards")
    finally:
        release_db_connection(conn)

    merged = [
        {
            "id":         r[0],
            "name":       r[1],
            "layout":     r[2],
            "cards":      r[3] or [],
            "created_at": r[4].isoformat() if r[4] else None,
            "updated_at": r[5].isoformat() if r[5] else None,
        }
        for r in rows
    ]
    return {"saved": saved, "boards": merged}


# ─────────────────────────────────────────────────────────────────────────────
# DELETE — remove a single board
# ─────────────────────────────────────────────────────────────────────────────
@router.delete("/api/boards/{board_id}")
def delete_board(board_id: str, request: Request):
    email = require_session_token(request, lax=False)
    _ensure_schema()

    conn = get_db_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="Database connection failed")
    try:
        with conn.cursor() as cur:
            cur.execute(
                "DELETE FROM studio_boards WHERE user_email = %s AND board_id = %s",
                (email, board_id),
            )
            deleted = cur.rowcount
            conn.commit()
    finally:
        release_db_connection(conn)

    if deleted == 0:
        raise HTTPException(status_code=404, detail="Board not found.")
    return {"message": "Board deleted.", "board_id": board_id}
