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
                    video_ids   TEXT        NOT NULL DEFAULT '',
                    title       TEXT,
                    artist      TEXT,
                    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );
                """
            )
            # Older deployments created the table without video_ids — add it.
            cur.execute(
                "ALTER TABLE youtube_resolutions ADD COLUMN IF NOT EXISTS video_ids TEXT NOT NULL DEFAULT ''"
            )
            conn.commit()
        _SCHEMA_INITIALISED = True
        logger.info("[YOUTUBE] youtube_resolutions table ready")
    except Exception as exc:
        logger.error(f"[YOUTUBE] Schema init failed: {exc}")
    finally:
        release_db_connection(conn)


# v3: now caching the FULL ranked candidate list (video_ids), not just one id,
# so a cache hit still gives the player fallbacks without a fresh 100-unit search.
_CACHE_VERSION = "v3"


def _cache_key(title: str, artist: str) -> str:
    raw = f"{title}|{artist}".lower().strip()
    return f"{_CACHE_VERSION}:" + re.sub(r"\s+", " ", raw)[:280]


def _cache_get(key: str):
    """Return (found: bool, candidates: list[str]).

    Returns the full ranked candidate list. A row with no usable ids (a
    previously cached miss) is treated as NOT found, so a now-working API key
    gets a fresh chance instead of being stuck on a poisoned negative entry.
    """
    conn = get_db_connection()
    if not conn:
        return False, []
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT video_id, video_ids FROM youtube_resolutions WHERE cache_key = %s",
                (key,),
            )
            row = cur.fetchone()
            if row is None:
                return False, []
            primary, joined = row[0] or "", row[1] or ""
            ids = [v for v in joined.split(",") if v]
            if not ids and primary:        # row predates video_ids column
                ids = [primary]
            if not ids:
                return False, []
            return True, ids
    except Exception as exc:
        logger.warning(f"[YOUTUBE] cache_get error: {exc}")
        return False, []
    finally:
        release_db_connection(conn)


def _cache_put(key: str, candidates: list, title: str, artist: str) -> None:
    """Cache the full ranked candidate list. video_id keeps the primary pick for
    back-compat; video_ids holds the whole list so a cache hit has fallbacks."""
    conn = get_db_connection()
    if not conn:
        return
    primary = candidates[0] if candidates else ""
    joined  = ",".join(candidates[:12])   # cap stored list; 12 is plenty of fallbacks
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO youtube_resolutions (cache_key, video_id, video_ids, title, artist)
                VALUES (%s, %s, %s, %s, %s)
                ON CONFLICT (cache_key) DO UPDATE
                  SET video_id = EXCLUDED.video_id, video_ids = EXCLUDED.video_ids
                """,
                (key, primary, joined, title[:300], artist[:300]),
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


def _raw_search_ids(query: str, max_results: int = 25) -> list:
    """One YouTube search → list of videoIds in rank order (no embeddability
    check). Costs 100 quota units."""
    try:
        res = requests.get(
            "https://www.googleapis.com/youtube/v3/search",
            params={
                "key":        YOUTUBE_API_KEY,
                "q":          query,
                "part":       "snippet",
                "type":       "video",
                "maxResults": max_results,
            },
            timeout=8,
        )
        if res.status_code != 200:
            logger.warning(f"[YOUTUBE] search {res.status_code}: {res.text[:160]}")
            return []
        return [
            it.get("id", {}).get("videoId")
            for it in res.json().get("items", [])
            if it.get("id", {}).get("videoId")
        ]
    except Exception as exc:
        logger.warning(f"[YOUTUBE] search error: {exc}")
        return []


def _search_candidates(title: str, artist: str) -> list:
    """Resolve "<title> <artist>" to a ranked list of verified-embeddable
    videoIds (possibly empty).

    Efficiency: we do ONE wide search (25 results) and verify embeddability in a
    single batched videos.list call (1 quota unit for the whole batch). We only
    spend a SECOND search (100 units) when the first pool yields too few
    embeddable copies — appending "audio" biases toward re-uploads/lyric videos
    that are usually embeddable when the official upload blocks embedding. Most
    tracks resolve on the first search, so the common path is 100 + 1 units.

    We deliberately DON'T pass videoEmbeddable=true: that filter is unreliable in
    both directions (returns embedding-blocked official videos AND hides
    embeddable fan uploads). videos.list?part=status is authoritative.
    """
    primary = f"{title} {artist}".strip()
    ids = _raw_search_ids(primary, 25)
    embeddable = _embeddable_ids(ids) if ids else []

    # Enough good copies already — no need to spend another search.
    if len(embeddable) >= 3:
        return embeddable

    # Thin pool: try one more angle biased toward embeddable re-uploads, then
    # merge (preserve rank, dedupe) and re-verify only the NEW ids.
    secondary = f"{title} {artist} audio".strip()
    more_ids = [i for i in _raw_search_ids(secondary, 15) if i not in set(ids)]
    if more_ids:
        embeddable = embeddable + [i for i in _embeddable_ids(more_ids) if i not in set(embeddable)]
    return embeddable


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

    # Fast path: return the full cached candidate list so the player has fallbacks
    # without paying for a fresh search on every code=150.
    if not exclude_set:
        found, cached_ids = _cache_get(key)
        if found and cached_ids:
            return {"videoId": cached_ids[0], "candidates": cached_ids, "cached": True}

    if not YOUTUBE_API_KEY:
        # Not configured — tell the client so it can fall back gracefully.
        raise HTTPException(status_code=503, detail="YouTube playback is not configured.")

    candidates = [c for c in _search_candidates(title, artist) if c not in exclude_set]
    video_id = candidates[0] if candidates else ""
    if candidates:
        _cache_put(key, candidates, title, artist)  # cache the full ranked list
    else:
        # Don't poison the cache with a miss — a transient error (quota, a
        # referrer-restricted key returning 403, no results) shouldn't block
        # this track forever. It'll simply be retried next time.
        logger.warning(f"[YOUTUBE] no embeddable videoId for {title!r} / {artist!r} (excluded {len(exclude_set)})")
    return {"videoId": video_id or None, "candidates": candidates, "cached": False}
