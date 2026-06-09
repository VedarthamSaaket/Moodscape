"""
YouTube playback-resolution router.

Spotify handles playlist *generation*, but full-length in-app playback is served
by the YouTube IFrame Player API (free, no per-user Premium). To play a Spotify
track we first need its YouTube videoId — this router resolves
"<title> <artist>" → videoId via the YouTube Data API v3 and caches the result
in Postgres so repeat plays cost zero quota.

Quota note: a Data API search costs 100 units against the default 10,000/day.
Caching (including negative results) keeps us well under that for normal use.

Auth: X-Session-Token (lax) — same posture as the other playback endpoints.
Schema is created idempotently at first use; no separate migration step.
"""
import re

import requests
from fastapi import APIRouter, HTTPException, Request

from security import require_session_token, sanitise_search_token
from database import get_db_connection, release_db_connection
from config import logger, YOUTUBE_API_KEY


router = APIRouter()


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
        logger.error("[YOUTUBE] Cannot init schema, DB unavailable")
        return
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS youtube_resolutions (
                    cache_key   TEXT        PRIMARY KEY,
                    video_id    TEXT        NOT NULL DEFAULT '',
                    title       TEXT,
                    artist      TEXT,
                    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );
                """
            )
            conn.commit()
        _SCHEMA_INITIALISED = True
        logger.info("[YOUTUBE] youtube_resolutions table ready")
    except Exception as exc:
        logger.error(f"[YOUTUBE] Schema init failed: {exc}")
    finally:
        release_db_connection(conn)


_CACHE_VERSION = "v2"  # bump to invalidate ids cached before embeddability checks


def _cache_key(title: str, artist: str) -> str:
    raw = f"{title}|{artist}".lower().strip()
    return f"{_CACHE_VERSION}:" + re.sub(r"\s+", " ", raw)[:280]


def _cache_get(key: str):
    """Return (found: bool, video_id: str).

    A row whose video_id is empty (a previously cached miss) is treated as NOT
    found, so a now-working API key gets a fresh chance to resolve it instead of
    being stuck on a poisoned negative-cache entry forever.
    """
    conn = get_db_connection()
    if not conn:
        return False, ""
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT video_id FROM youtube_resolutions WHERE cache_key = %s", (key,))
            row = cur.fetchone()
            if row is None or not (row[0] or ""):
                return False, ""
            return True, row[0]
    except Exception as exc:
        logger.warning(f"[YOUTUBE] cache_get error: {exc}")
        return False, ""
    finally:
        release_db_connection(conn)


def _cache_put(key: str, video_id: str, title: str, artist: str) -> None:
    conn = get_db_connection()
    if not conn:
        return
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO youtube_resolutions (cache_key, video_id, title, artist)
                VALUES (%s, %s, %s, %s)
                ON CONFLICT (cache_key) DO UPDATE
                  SET video_id = EXCLUDED.video_id
                """,
                (key, video_id or "", title[:300], artist[:300]),
            )
            conn.commit()
    except Exception as exc:
        logger.warning(f"[YOUTUBE] cache_put error: {exc}")
    finally:
        release_db_connection(conn)


def _embeddable_ids(video_ids: list) -> list:
    """Given candidate videoIds in search-rank order, return ALL that are
    *actually* embeddable + public, ranked.

    The search endpoint's videoEmbeddable=true filter is unreliable — it still
    returns embedding-disabled official / "Topic" uploads that throw YT error
    150 in the iframe. videos.list?part=status is authoritative and costs only
    1 quota unit no matter how many ids we pass. We return the whole list so the
    player can fall through to another upload if one still misbehaves.
    """
    if not video_ids:
        return []
    try:
        res = requests.get(
            "https://www.googleapis.com/youtube/v3/videos",
            params={
                "key":  YOUTUBE_API_KEY,
                "id":   ",".join(video_ids),
                "part": "status",
            },
            timeout=8,
        )
        if res.status_code != 200:
            logger.warning(f"[YOUTUBE] videos.list {res.status_code}: {res.text[:160]}")
            return []
        by_id = {it.get("id"): it for it in res.json().get("items", [])}
        out = []
        for vid in video_ids:                        # preserve search ranking
            status = (by_id.get(vid) or {}).get("status", {})
            if status.get("embeddable") and status.get("privacyStatus") == "public":
                out.append(vid)
        return out
    except Exception as exc:
        logger.warning(f"[YOUTUBE] videos.list error: {exc}")
        return []


def _search_candidates(title: str, artist: str) -> list:
    """Resolve "<title> <artist>" to a ranked list of verified-embeddable
    videoIds (possibly empty).

    We deliberately DON'T pass videoEmbeddable=true here: that filter is
    unreliable in BOTH directions (it returns embedding-blocked official videos
    AND hides embeddable fan/lyric uploads). Instead we pull a wide pool of
    candidates and let videos.list?part=status decide authoritatively — since
    people re-upload nearly everything to YouTube, a wide pool almost always
    contains at least one genuinely embeddable copy.
    """
    query = f"{title} {artist}".strip()
    try:
        res = requests.get(
            "https://www.googleapis.com/youtube/v3/search",
            params={
                "key":        YOUTUBE_API_KEY,
                "q":          query,
                "part":       "snippet",
                "type":       "video",
                "maxResults": 25,   # wide net; verification keeps the embeddable ones
            },
            timeout=8,
        )
        if res.status_code != 200:
            logger.warning(f"[YOUTUBE] search {res.status_code}: {res.text[:160]}")
            return []
        ids = [
            it.get("id", {}).get("videoId")
            for it in res.json().get("items", [])
            if it.get("id", {}).get("videoId")
        ]
        if not ids:
            return []
        return _embeddable_ids(ids)
    except Exception as exc:
        logger.warning(f"[YOUTUBE] search error: {exc}")
        return []


@router.get("/api/youtube/resolve")
def resolve_youtube(request: Request, title: str = "", artist: str = "", exclude: str = ""):
    """Resolve a track to a playable YouTube videoId PLUS a ranked list of
    alternate embeddable uploads of the same song. `exclude` (comma-separated
    videoIds) lets the player ask for a fresh pick when a previous one — though
    flagged embeddable by the API — still threw error 150 in the iframe. When
    exclude is present we bypass the cache and re-search.
    """
    require_session_token(request, lax=True)
    _ensure_schema()

    title  = sanitise_search_token(title, "title", max_len=200)
    artist = sanitise_search_token(artist, "artist", max_len=200)
    if not title:
        raise HTTPException(status_code=400, detail="title is required")

    exclude_set = {e.strip() for e in (exclude or "").split(",") if e.strip()}
    key = _cache_key(title, artist)

    # Fast path: a cached good id, only when the player isn't asking us to avoid one.
    if not exclude_set:
        found, cached_id = _cache_get(key)
        if found:
            return {"videoId": cached_id or None, "candidates": [cached_id] if cached_id else [], "cached": True}

    if not YOUTUBE_API_KEY:
        # Not configured — tell the client so it can fall back gracefully.
        raise HTTPException(status_code=503, detail="YouTube playback is not configured.")

    candidates = [c for c in _search_candidates(title, artist) if c not in exclude_set]
    video_id = candidates[0] if candidates else ""
    if video_id:
        _cache_put(key, video_id, title, artist)  # cache the (new) good primary
    else:
        # Don't poison the cache with a miss — a transient error (quota, a
        # referrer-restricted key returning 403, no results) shouldn't block
        # this track forever. It'll simply be retried next time.
        logger.warning(f"[YOUTUBE] no embeddable videoId for {title!r} / {artist!r} (excluded {len(exclude_set)})")
    return {"videoId": video_id or None, "candidates": candidates, "cached": False}
