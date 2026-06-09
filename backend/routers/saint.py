"""
Saint-or-Sinner lifetime stats router.

Accumulates a player's performance across every Saint-or-Sinner run so we can
show a persistent "Vibe Guesser" meter — a read on how sharply they judge
strangers from traits alone (proximity to the world's verdict) and how often
they name the figure. Tied to the verified email. Auth: X-Session-Token
(lax=False), same posture as the quiz / saved / player routers. Backend is the
single source of truth.

One row per user (user_email PK); increments are done server-side so the
totals can't drift or be tampered with.
"""
from psycopg2.extras import RealDictCursor
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from security import require_session_token
from database import get_db_connection, release_db_connection
from config import logger


router = APIRouter()


class SaintRecord(BaseModel):
    accuracy: int   # this run's average "read the room" accuracy, 0..100
    guesses:  int   # correct name guesses this run
    total:    int   # rounds (figures) judged this run


_SCHEMA_INITIALISED = False


def _ensure_schema() -> None:
    global _SCHEMA_INITIALISED
    if _SCHEMA_INITIALISED:
        return
    conn = get_db_connection()
    if not conn:
        logger.error("[SAINT] Cannot init schema, DB unavailable")
        return
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS saint_stats (
                    user_email      TEXT        PRIMARY KEY,
                    runs            INTEGER     NOT NULL DEFAULT 0,
                    rounds_total    BIGINT      NOT NULL DEFAULT 0,
                    proximity_total BIGINT      NOT NULL DEFAULT 0,
                    guess_total     BIGINT      NOT NULL DEFAULT 0,
                    best_accuracy   INTEGER     NOT NULL DEFAULT 0,
                    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );
                """
            )
            conn.commit()
        _SCHEMA_INITIALISED = True
        logger.info("[SAINT] saint_stats table ready")
    except Exception as exc:
        logger.error(f"[SAINT] Schema init failed: {exc}")
    finally:
        release_db_connection(conn)


def _row_to_stats(row) -> dict:
    if not row:
        return {"runs": 0, "roundsTotal": 0, "proximityTotal": 0, "guessTotal": 0, "bestAccuracy": 0}
    return {
        "runs":           row["runs"],
        "roundsTotal":    row["rounds_total"],
        "proximityTotal": row["proximity_total"],
        "guessTotal":     row["guess_total"],
        "bestAccuracy":   row["best_accuracy"],
    }


# ─────────────────────────────────────────────────────────────────────────────
# GET — the user's cumulative stats
# ─────────────────────────────────────────────────────────────────────────────
@router.get("/api/saint/stats")
def get_stats(request: Request):
    email = require_session_token(request, lax=False)
    _ensure_schema()

    conn = get_db_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="Database connection failed")
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                "SELECT runs, rounds_total, proximity_total, guess_total, best_accuracy "
                "FROM saint_stats WHERE user_email = %s",
                (email,),
            )
            row = cur.fetchone()
    finally:
        release_db_connection(conn)

    return {"stats": _row_to_stats(row)}


# ─────────────────────────────────────────────────────────────────────────────
# POST — record one completed run; server increments and returns new totals
# ─────────────────────────────────────────────────────────────────────────────
@router.post("/api/saint/record")
def record_run(data: SaintRecord, request: Request):
    email = require_session_token(request, lax=False)
    _ensure_schema()

    total    = max(1, min(int(data.total), 50))
    accuracy = max(0, min(int(data.accuracy), 100))
    guesses  = max(0, min(int(data.guesses), total))
    proximity = accuracy * total  # this run's summed proximity points

    conn = get_db_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="Database connection failed")
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                """
                INSERT INTO saint_stats
                    (user_email, runs, rounds_total, proximity_total, guess_total, best_accuracy)
                VALUES (%s, 1, %s, %s, %s, %s)
                ON CONFLICT (user_email) DO UPDATE
                  SET runs            = saint_stats.runs + 1,
                      rounds_total    = saint_stats.rounds_total + EXCLUDED.rounds_total,
                      proximity_total = saint_stats.proximity_total + EXCLUDED.proximity_total,
                      guess_total     = saint_stats.guess_total + EXCLUDED.guess_total,
                      best_accuracy   = GREATEST(saint_stats.best_accuracy, EXCLUDED.best_accuracy),
                      updated_at      = NOW()
                RETURNING runs, rounds_total, proximity_total, guess_total, best_accuracy
                """,
                (email, total, proximity, guesses, accuracy),
            )
            row = cur.fetchone()
            conn.commit()
    except Exception as exc:
        conn.rollback()
        logger.error(f"[SAINT] record_run error: {exc}")
        raise HTTPException(status_code=500, detail="Failed to record run")
    finally:
        release_db_connection(conn)

    return {"stats": _row_to_stats(row)}
