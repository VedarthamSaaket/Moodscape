"""
Style-Quiz persistence router.

Stores each user's quiz result (archetype + raw axis scores + the option
deltas they picked) tied to their verified email. Auth: requires
X-Session-Token. Anonymous access is rejected, the same as the studio router.

Schema is created idempotently at module import, no separate migration step.

One row per user (user_email PK). The user can retake the quiz and
overwrite their result; we only keep the most recent attempt.
"""
from datetime import datetime
from typing import Optional, Any

from psycopg2.extras import Json, RealDictCursor
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from security import require_session_token
from database import get_db_connection, release_db_connection
from config import logger
from quiz_reader import clean_answers, clean_archetypes, clean_ranking, read_person


router = APIRouter()


# ─────────────────────────────────────────────────────────────────────────────
# Models
# ─────────────────────────────────────────────────────────────────────────────
class QuizScores(BaseModel):
    temp:    int = 0
    edge:    int = 0
    era:     int = 0
    density: int = 0


class QuizResultPayload(BaseModel):
    archetype_id:    str
    archetype_name:  str
    runner_up_id:    Optional[str] = None
    runner_up_name:  Optional[str] = None
    scores:          QuizScores
    answers:         list[Any] = Field(default_factory=list)
    completed_at:    Optional[str] = None
    insight:         Optional[dict] = None


class QuizInterpretPayload(BaseModel):
    archetypes: list[Any] = Field(default_factory=list)
    answers:    list[Any] = Field(default_factory=list)
    ranking:    list[Any] = Field(default_factory=list)


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
        logger.error("[QUIZ] Cannot init schema, DB unavailable")
        return
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS quiz_results (
                    user_email      TEXT      PRIMARY KEY,
                    archetype_id    TEXT      NOT NULL,
                    archetype_name  TEXT      NOT NULL,
                    runner_up_id    TEXT,
                    runner_up_name  TEXT,
                    scores          JSONB     NOT NULL DEFAULT '{}'::jsonb,
                    answers         JSONB     NOT NULL DEFAULT '[]'::jsonb,
                    completed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );
                """
            )
            cur.execute("ALTER TABLE quiz_results ADD COLUMN IF NOT EXISTS insight JSONB")
            conn.commit()
        _SCHEMA_INITIALISED = True
        logger.info("[QUIZ] quiz_results table ready")
    except Exception as exc:
        logger.error(f"[QUIZ] Schema init failed: {exc}")
    finally:
        release_db_connection(conn)


def _parse_ts(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except Exception:
        return None


def _clean_insight(insight: Optional[dict]) -> Optional[dict]:
    if not isinstance(insight, dict):
        return None
    traits = insight.get("traits") if isinstance(insight.get("traits"), list) else []
    return {
        "title":       str(insight.get("title") or "")[:60],
        "read":        str(insight.get("read") or "")[:480],
        "traits":      [str(t)[:40] for t in traits[:3]],
        "vibe_prompt": str(insight.get("vibe_prompt") or "")[:300],
    }


def _row_to_result(row: dict) -> dict:
    return {
        "archetype_id":   row["archetype_id"],
        "archetype_name": row["archetype_name"],
        "runner_up_id":   row.get("runner_up_id"),
        "runner_up_name": row.get("runner_up_name"),
        "scores":         row["scores"] or {},
        "answers":        row["answers"] or [],
        "insight":        row.get("insight"),
        "completed_at":   row["completed_at"].isoformat() if row.get("completed_at") else None,
        "updated_at":     row["updated_at"].isoformat() if row.get("updated_at") else None,
    }


# ─────────────────────────────────────────────────────────────────────────────
# GET, the user's latest result (or null)
# ─────────────────────────────────────────────────────────────────────────────
@router.get("/api/quiz/result")
def get_quiz_result(request: Request):
    email = require_session_token(request, lax=False)
    _ensure_schema()

    conn = get_db_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="Database connection failed")
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(
                "SELECT archetype_id, archetype_name, runner_up_id, runner_up_name, "
                "scores, answers, insight, completed_at, updated_at "
                "FROM quiz_results WHERE user_email = %s",
                (email,),
            )
            row = cur.fetchone()
    finally:
        release_db_connection(conn)

    if not row:
        return {"result": None}
    return {"result": _row_to_result(row)}


# ─────────────────────────────────────────────────────────────────────────────
# PUT, upsert the user's latest result
# ─────────────────────────────────────────────────────────────────────────────
@router.put("/api/quiz/result")
def save_quiz_result(data: QuizResultPayload, request: Request):
    email = require_session_token(request, lax=False)
    _ensure_schema()

    archetype_id   = (data.archetype_id or "")[:80]
    archetype_name = (data.archetype_name or "")[:120]
    runner_up_id   = (data.runner_up_id or "")[:80] or None
    runner_up_name = (data.runner_up_name or "")[:120] or None
    completed_at   = _parse_ts(data.completed_at) or datetime.utcnow()

    if not archetype_id or not archetype_name:
        raise HTTPException(status_code=400, detail="archetype_id and archetype_name are required")

    conn = get_db_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="Database connection failed")
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO quiz_results
                    (user_email, archetype_id, archetype_name,
                     runner_up_id, runner_up_name,
                     scores, answers, insight, completed_at, updated_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, NOW())
                ON CONFLICT (user_email) DO UPDATE
                  SET archetype_id   = EXCLUDED.archetype_id,
                      archetype_name = EXCLUDED.archetype_name,
                      runner_up_id   = EXCLUDED.runner_up_id,
                      runner_up_name = EXCLUDED.runner_up_name,
                      scores         = EXCLUDED.scores,
                      answers        = EXCLUDED.answers,
                      insight        = EXCLUDED.insight,
                      completed_at   = EXCLUDED.completed_at,
                      updated_at     = NOW()
                """,
                (
                    email, archetype_id, archetype_name,
                    runner_up_id, runner_up_name,
                    Json(data.scores.dict()),
                    Json(data.answers or []),
                    Json(_clean_insight(data.insight)) if data.insight else None,
                    completed_at,
                ),
            )
            conn.commit()
    except Exception as exc:
        conn.rollback()
        logger.error(f"[QUIZ] save_quiz_result error: {exc}")
        raise HTTPException(status_code=500, detail="Failed to save quiz result")
    finally:
        release_db_connection(conn)

    return {"message": "Quiz result saved.", "archetype_id": archetype_id}


@router.post("/api/quiz/interpret")
def interpret_quiz(data: QuizInterpretPayload, request: Request):
    require_session_token(request, lax=True)
    archetypes = clean_archetypes(data.archetypes)
    answers = clean_answers(data.answers)
    ranking = clean_ranking(data.ranking, [a["id"] for a in archetypes])
    insight = read_person(archetypes, answers, ranking)
    if not insight:
        return {"insight": None}
    logger.info(f"[QUIZ_READER] read produced by {insight.get('model')}")
    return {"insight": insight}


# ─────────────────────────────────────────────────────────────────────────────
# DELETE, wipe the user's stored result (used on Retake if the client wants it)
# ─────────────────────────────────────────────────────────────────────────────
@router.delete("/api/quiz/result")
def delete_quiz_result(request: Request):
    email = require_session_token(request, lax=False)
    _ensure_schema()

    conn = get_db_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="Database connection failed")
    try:
        with conn.cursor() as cur:
            cur.execute(
                "DELETE FROM quiz_results WHERE user_email = %s",
                (email,),
            )
            conn.commit()
    finally:
        release_db_connection(conn)

    return {"message": "Quiz result cleared."}
