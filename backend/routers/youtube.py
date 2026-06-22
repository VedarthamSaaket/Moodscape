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
from sound_seeds import is_sound_track


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


# v6: wider 6-query identity sweep + snippet fallback tier so a song with no
# full-length uploads still plays. Bumped to invalidate pre-sweep cache rows.
_CACHE_VERSION = "v6"


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


_ISO_DUR = re.compile(r"PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?")


def _iso_to_sec(s: str) -> int:
    """Parse YouTube's ISO 8601 duration ('PT3M42S') to seconds. 0 on garbage."""
    if not s:
        return 0
    m = _ISO_DUR.fullmatch(s)
    if not m:
        return 0
    h, mi, se = m.groups()
    return int(h or 0) * 3600 + int(mi or 0) * 60 + int(se or 0)


# Anything shorter than this is treated as a Short / snippet / preview, not a
# real upload of the song. 75s lets a few genuinely-short songs through while
# killing the typical 30-60s preview/Short flood.
_MIN_SONG_SECONDS = 75

# Last-resort fallback floor. If literally NO full-length identity match
# exists for a song (artist only ever posted teaser clips), we allow
# identity-matching uploads down to this length so the user at least hears
# the snippet instead of getting "couldn't load, skipping".
_SNIPPET_FALLBACK_SECONDS = 25


def _video_meta(video_ids: list) -> dict:
    """Fetch embeddable + duration + snippet title/channel for a batch of
    videoIds. Returns {id: {'embeddable': bool, 'duration': int, 'title': str, 'channel': str}}.

    videos.list caps at 50 ids per call (YouTube API limit) — we chunk and
    merge. Each chunk costs 1 quota unit, so 100 candidates = 2 units.
    """
    if not video_ids:
        return {}
    out = {}
    for i in range(0, len(video_ids), 50):
        chunk = video_ids[i:i + 50]
        try:
            res = requests.get(
                "https://www.googleapis.com/youtube/v3/videos",
                params={
                    "key":  YOUTUBE_API_KEY,
                    "id":   ",".join(chunk),
                    "part": "status,contentDetails,snippet",
                },
                timeout=8,
            )
            if res.status_code != 200:
                logger.warning(f"[YOUTUBE] videos.list {res.status_code}: {res.text[:160]}")
                continue
            for it in res.json().get("items", []):
                vid = it.get("id")
                if not vid:
                    continue
                status = it.get("status", {})
                cd     = it.get("contentDetails", {})
                sn     = it.get("snippet", {})
                out[vid] = {
                    "embeddable": bool(status.get("embeddable")) and status.get("privacyStatus") == "public",
                    "duration":   _iso_to_sec(cd.get("duration", "")),
                    "title":      sn.get("title", "") or "",
                    "channel":    sn.get("channelTitle", "") or "",
                }
        except Exception as exc:
            logger.warning(f"[YOUTUBE] videos.list error: {exc}")
    return out


# ── Identity matching: title / artist / version ─────────────────────────────
# Words that disqualify a video unless the Spotify track itself signals that
# version. "Cover" by 99% of users means a fan cover and IS NOT the song the
# user asked for — same logic for the others.
_BAD = re.compile(
    r"\b(covers?|covered|covering|instrumental|karaoke|backing\s*track|"
    r"nightcore|slowed(?:\s*\+?\s*reverb)?|reverb|sped[\s-]?up|spedup|"
    r"8[\s-]?d|3d\s*audio|432\s*hz|"
    r"mashup|parody|reaction|reacts?|type\s*beat|"
    r"ai\s+cover|ai\s+voice|"
    r"tutorial|how\s+to\s+play|guitar\s+lesson|piano\s+lesson|drum\s+cover|"
    r"piano\s+cover|guitar\s+cover|violin\s+cover|"
    r"sing[\s-]?along|review|breakdown|analysis|explained|behind\s+the\s+song)\b",
    re.I,
)

# Version tags the user might actively WANT — only enforce required-match if
# the Spotify title itself signals one. So "Song (Acoustic)" requires the
# YouTube title to also say acoustic; a normal "Song" rejects acoustic.
_VERSION_TAGS = ("acoustic", "live", "unplugged", "remix", "instrumental", "demo")

_STOPWORDS = {"the", "a", "an", "of", "in", "on", "and", "or", "to", "feat", "ft", "with"}


def _normalize(s: str) -> str:
    """Lowercase + strip punctuation → space-separated tokens-ish."""
    return re.sub(r"[^a-z0-9 ]+", " ", (s or "").lower())


def _clean_title(t: str) -> str:
    """Strip Spotify decorations so the bare song-name tokens remain.
    '(feat. X)', '[Remastered 2022]', ' - Single Version', etc. don't help
    matching — they pollute the token set."""
    out = re.sub(r"\((feat|ft|with)\.?[^)]*\)", " ", t, flags=re.I)
    out = re.sub(r"\[[^\]]*\]", " ", out)
    out = re.sub(
        r"-\s*(remastered[^-]*|single\s+version|radio\s+edit|album\s+version|extended\s+(mix|version)|deluxe[^-]*)",
        " ", out, flags=re.I,
    )
    return out


def _tokens(s: str) -> list:
    return [t for t in _normalize(s).split() if t and t not in _STOPWORDS]


def _required_versions(spotify_title: str) -> set:
    """If the Spotify track itself is a Remix/Acoustic/Live/etc. version, the
    YouTube match MUST also be that version. Returns the set of tags found."""
    low = spotify_title.lower()
    return {v for v in _VERSION_TAGS if v in low}


def _is_identity_match(yt_title: str, yt_channel: str,
                       want_title_tokens: list, want_artist_tokens: list,
                       required_versions: set, relax_artist: bool = False) -> bool:
    """True iff this YouTube video is actually the song the user asked for.

    Matching tolerates channels that concatenate words ("WendyWangVEVO",
    "JonasBrothersVEVO", "RihannaForVEVO") by using substring containment on
    the channel string in addition to exact-word membership on the title.

    `relax_artist=True` skips the artist-must-appear gate — used for
    ambient/noise/nature-sound tracks where the Spotify "artist" is a
    label ("Nature Sounds", "Sleep Music Inc") that rarely matches the
    uploader name on YouTube. For these tracks the title content
    (e.g. "Pink Noise 10 Hours") IS the identity.
    """
    if not want_title_tokens:
        return False
    t_low = _normalize(yt_title)
    c_low = _normalize(yt_channel)
    t_set = set(t_low.split())
    c_squashed = c_low.replace(" ", "")           # collapse spaces for substring hits

    def in_title_or_channel(tok: str) -> bool:
        return tok in t_set or tok in c_squashed

    # Title-token coverage — most title tokens must appear (≥80%).
    matched = sum(1 for w in want_title_tokens if in_title_or_channel(w))
    if matched < max(1, int(round(0.8 * len(want_title_tokens)))):
        return False

    # Artist gate — single-token or first-token match counts. Skipped for
    # ambient/noise tracks where the Spotify "artist" rarely matches the
    # YouTube uploader for the same content.
    if not relax_artist and want_artist_tokens and not any(in_title_or_channel(a) for a in want_artist_tokens):
        return False

    # Banned content gate — but allow if the Spotify track itself uses that word.
    bad = _BAD.search(yt_title)
    if bad:
        bad_word = bad.group(0).lower()
        bad_squashed = re.sub(r"[\s-]+", "", bad_word)
        spotify_low = _normalize(" ".join(want_title_tokens))
        allow = (bad_squashed in {re.sub(r"[\s-]+", "", v) for v in required_versions}) or \
                (bad_word in spotify_low)
        if not allow:
            return False

    # Required-version gate.
    for v in required_versions:
        if v not in t_low:
            return False

    return True


def _embeddable_ids(video_ids: list) -> list:
    """Wrapper kept for the secondary search merge path. Returns embeddable
    full-length (>= _MIN_SONG_SECONDS) ids, preserving rank."""
    meta = _video_meta(video_ids)
    return [v for v in video_ids
            if (meta.get(v) or {}).get("embeddable")
            and (meta.get(v) or {}).get("duration", 0) >= _MIN_SONG_SECONDS]


def _raw_search_ids(query: str, max_results: int = 25, music_only: bool = False) -> list:
    """One YouTube search → list of videoIds in rank order. 100 quota units.

    music_only=True adds videoCategoryId=10 (Music) to filter out reactions,
    tutorials, vlogs at the source — quota-free win when the song is mainstream
    enough for YouTube's category classifier to have caught it.
    """
    try:
        params = {
            "key":        YOUTUBE_API_KEY,
            "q":          query,
            "part":       "snippet",
            "type":       "video",
            "maxResults": max_results,
        }
        if music_only:
            params["videoCategoryId"] = "10"
        res = requests.get(
            "https://www.googleapis.com/youtube/v3/search",
            params=params,
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


def _search_candidates(title: str, artist: str, target_seconds: int = 0) -> list:  # noqa: C901
    # Ambient/noise/nature tracks need looser rules: artist matching is mostly
    # meaningless (the Spotify "artist" is usually a label like "Sleep Sounds")
    # and the actual upload duration varies wildly (30s loop ↔ 10-hour version).
    ambient = is_sound_track(title, artist)
    """Resolve "<title> <artist>" to videoIds that ACTUALLY ARE that song.

    Pipeline:
      1. Cast a WIDE net — 6 search variants spanning the most reliable
         discovery patterns for songs on YouTube:
           a. primary       "<title> <artist>"
           b. reversed      "<artist> - <title>"             (matches official artist channels)
           c. audio variant "<title> <artist> audio"         (re-uploads)
           d. lyrics        "<title> <artist> lyrics"        (lyric channels — full songs under fair use)
           e. music-only    "<title> <artist>" filtered to category 10 (Music) — strips reactions/tutorials at source
           f. topic upload  "<artist> <title> topic"         (Spotify auto-mirror "Artist - Topic" channels)
      2. Dedupe → one videos.list call (1 quota unit) returns embeddable +
         duration + title + channel for every candidate.
      3. Apply strict identity gate (title/artist/version/banned-words).
      4. Duration gate:
           - Tight:   ±15s of Spotify length     → ideal pool
           - Loose:   ±35s                       → fallback
           - Snippet: identity-matching uploads
                      >= _SNIPPET_FALLBACK_SECONDS, used ONLY if no
                      full-length identity match exists. Lets the user hear
                      the song instead of getting "skipping" when the artist
                      only posts teasers.
      5. Within the chosen tier: embeddable first, then closest-by-duration.

    Quota budget: up to 6 searches (600u) + 1 videos.list (1u) ≈ 601u per
    miss. Cache makes hits free.
    """
    want_title_tokens  = _tokens(_clean_title(title))
    want_artist_tokens = _tokens(artist)
    required_versions  = _required_versions(title)

    if not want_title_tokens:
        return []

    queries = [
        (f"{title} {artist}".strip(),                False),
        (f"{artist} - {title}".strip(" -"),          False),
        (f"{title} {artist} audio".strip(),          False),
        (f"{title} {artist} lyrics".strip(),         False),
        (f"{title} {artist} official audio".strip(), False),
        (f"{artist} {title} topic".strip(),          False),
    ]

    ids = []
    seen = set()
    for q, music_only in queries:
        if not q:
            continue
        batch = _raw_search_ids(q, 20, music_only=music_only)
        for vid in batch:
            if vid not in seen:
                seen.add(vid)
                ids.append(vid)

    if not ids:
        return []

    meta = _video_meta(ids)

    # Stage 1: identity match — title tokens, artist tokens, version, banned words.
    identity_ok = []
    for vid in ids:
        m = meta.get(vid) or {}
        if _is_identity_match(m.get("title", ""), m.get("channel", ""),
                              want_title_tokens, want_artist_tokens,
                              required_versions, relax_artist=ambient):
            identity_ok.append(vid)

    if not identity_ok:
        logger.info(
            f"[YOUTUBE] no identity match across {len(ids)} candidates for "
            f"{title!r} / {artist!r} — refusing to play wrong song"
        )
        return []

    # Stage 2: duration tiers.
    # Ambient/noise tracks live happily at 30s loops AND 10-hour versions —
    # the upload durations don't correlate with the Spotify track duration.
    # Drop the full-length floor for these so an iframe play of "Pink Noise"
    # doesn't lose to a 5-min cap. Also disable the strict ±15s window
    # since matching duration to Spotify's preview length is meaningless.
    min_full = 25 if ambient else _MIN_SONG_SECONDS
    full_length = [v for v in identity_ok if (meta.get(v) or {}).get("duration", 0) >= min_full]

    def by_score(vid: str):
        m = meta.get(vid) or {}
        dur = m.get("duration", 0)
        delta = abs(dur - target_seconds) if (target_seconds > 0 and not ambient) else 0
        embed_bonus = 0 if m.get("embeddable") else 1
        # For ambient tracks, prefer LONGER uploads (a 1-hour pink noise is
        # better than a 30s loop). For songs, prefer closeness-to-target.
        ambient_pref = -(m.get("duration", 0)) if ambient else 0
        return (delta, ambient_pref, embed_bonus, ids.index(vid))

    tier = []
    tier_label = "unknown"

    # STRICT ±15s — user-mandated for non-ambient songs. We REFUSE to play
    # a wrong-length upload (no 10-minute extended remixes when the original
    # is 3:45, no 30s teasers when the original is 4:20). If nothing falls
    # within ±15s we skip the track — better than playing the wrong version.
    if target_seconds > 0 and not ambient:
        tight = [v for v in identity_ok
                 if abs((meta.get(v) or {}).get("duration", 0) - target_seconds) <= 15]
        if tight:
            tier, tier_label = tight, "tight ±15s"
        else:
            logger.info(
                f"[YOUTUBE] no ±15s match for {title!r} / {artist!r} — "
                f"refusing wrong-length playback"
            )
            return []

    # Ambient / no-duration-target → fall back to any full-length identity match.
    if not tier and full_length:
        tier, tier_label = full_length, ("ambient pool" if ambient else "full-length / no duration target")

    # Snippet fallback — last resort, only when no full-length identity match
    # exists at any duration. The user explicitly asked for this: "if there is
    # absolutely NO way of finding the music piece, ONLY THEN can a 30s/1min
    # snippet play."
    if not tier:
        snippets = [v for v in identity_ok
                    if (meta.get(v) or {}).get("duration", 0) >= _SNIPPET_FALLBACK_SECONDS]
        snippets.sort(key=lambda v: -meta[v]["duration"])  # prefer the longest snippet
        if snippets:
            tier, tier_label = snippets, "snippet fallback"
            logger.info(
                f"[YOUTUBE] snippet fallback for {title!r} / {artist!r} — "
                f"no full-length identity match exists; longest snippet wins"
            )

    if not tier:
        logger.info(
            f"[YOUTUBE] identity matches exist but all are shorter than "
            f"{_SNIPPET_FALLBACK_SECONDS}s for {title!r} / {artist!r} — skipping"
        )
        return []

    tier.sort(key=by_score)
    embed = [v for v in tier if (meta.get(v) or {}).get("embeddable")]
    rest  = [v for v in tier if v not in set(embed)]
    logger.info(
        f"[YOUTUBE] {title!r} / {artist!r}: {len(tier)} pick(s) in tier '{tier_label}', "
        f"primary={(embed + rest)[0] if (embed or rest) else None}"
    )
    return (embed + rest)[:20]


@router.get("/api/youtube/resolve")
def resolve_youtube(request: Request, title: str = "", artist: str = "", exclude: str = "", duration_ms: int = 0):
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

    # Cache-first path — works for BOTH the initial play AND the iframe's
    # exclude-driven retry after a code=150. The recurring "couldn't load,
    # skipping" symptom was caused by exclude= bypassing the cache entirely:
    # every iframe error 150 triggered a fresh 600-quota search, and after
    # ~16 of those the daily YouTube quota was exhausted so EVERY subsequent
    # resolution returned None → app-wide "skipping" for the rest of the day.
    # Now: when exclude is set, try the remaining cached candidates first;
    # only do a fresh search when the entire cached pool is dead.
    found, cached_ids = _cache_get(key)
    if found and cached_ids:
        remaining = [c for c in cached_ids if c not in exclude_set]
        if remaining:
            return {"videoId": remaining[0], "candidates": remaining, "cached": True}
        # Cached pool fully exhausted by the iframe's exclude list — fall
        # through to a fresh search below (but reuse the cached ids as
        # already-tried so we don't re-pick them).
        exclude_set |= set(cached_ids)

    if not YOUTUBE_API_KEY:
        # Not configured — tell the client so it can fall back gracefully.
        raise HTTPException(status_code=503, detail="YouTube playback is not configured.")

    target_seconds = int(duration_ms // 1000) if duration_ms > 0 else 0
    candidates = [c for c in _search_candidates(title, artist, target_seconds) if c not in exclude_set]
    video_id = candidates[0] if candidates else ""
    if candidates:
        _cache_put(key, candidates, title, artist)  # cache the full ranked list
    else:
        # Don't poison the cache with a miss — a transient error (quota, a
        # referrer-restricted key returning 403, no results) shouldn't block
        # this track forever. It'll simply be retried next time.
        logger.warning(f"[YOUTUBE] no embeddable videoId for {title!r} / {artist!r} (excluded {len(exclude_set)})")
    return {"videoId": video_id or None, "candidates": candidates, "cached": False}
