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
import json
import os
import re
import threading
import time
import unicodedata
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Optional

import requests
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from security import require_session_token, sanitise_search_token
from database import get_db_connection, release_db_connection
from config import logger, YOUTUBE_API_KEY
from sound_seeds import is_sound_track

# ── ytmusicapi (unofficial YouTube Music) — EQUAL-PRIORITY resolver ─────────
# YouTube Music exposes a music-curated catalogue: official song records only,
# no covers / reactions / tutorials / Shorts. Its uploads are uniformly
# embeddable and syndicated (they're the Topic-channel masters that Spotify
# auto-mirrors). Hits a public unofficial endpoint with NO quota cost — frees
# us to fan out wider than the Data API's 10k/day budget allows.
#
# The two resolvers (YouTube Data API + YouTube Music) run IN PARALLEL via
# the thread executor below; their candidate IDs are unioned and scored by
# the same `_match_score`. Equal priority — neither pre-empts the other; the
# best-scoring upload across both pools wins.
try:
    from ytmusicapi import YTMusic
    _YTMUSIC_AVAILABLE = True
except Exception as _exc:                         # library missing or import error
    YTMusic = None                                # type: ignore
    _YTMUSIC_AVAILABLE = False
    logger.warning(f"[YOUTUBE] ytmusicapi unavailable, falling back to Data API only: {_exc}")

_ytmusic_client = None
_ytmusic_lock = threading.Lock()
_ytmusic_executor = ThreadPoolExecutor(max_workers=4, thread_name_prefix="ytmusic")


def _get_ytmusic_client():
    """Lazy singleton YTMusic() — first call constructs the unauthenticated
    client (anonymous public-search posture, no cookie needed). Returns None
    if the library is missing or the constructor blows up; callers degrade
    gracefully to Data-API-only matching."""
    global _ytmusic_client
    if not _YTMUSIC_AVAILABLE:
        return None
    if _ytmusic_client is not None:
        return _ytmusic_client
    with _ytmusic_lock:
        if _ytmusic_client is None:
            try:
                _ytmusic_client = YTMusic()
            except Exception as exc:
                logger.warning(f"[YOUTUBE] YTMusic() init failed: {exc}")
                _ytmusic_client = None
    return _ytmusic_client


def _ytmusic_duration_to_seconds(s) -> int:
    """ytmusicapi returns duration as 'M:SS' or 'H:MM:SS'; convert to seconds.
    `duration_seconds` is also sometimes present and preferred when set."""
    if isinstance(s, int):
        return max(0, int(s))
    if not s:
        return 0
    parts = str(s).split(":")
    try:
        parts = [int(p) for p in parts]
    except ValueError:
        return 0
    if len(parts) == 3:
        return parts[0] * 3600 + parts[1] * 60 + parts[2]
    if len(parts) == 2:
        return parts[0] * 60 + parts[1]
    if len(parts) == 1:
        return parts[0]
    return 0


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
                    confidence  REAL        NOT NULL DEFAULT 0.0,
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
            # Confidence column added at v3 of the matching layer; idempotent
            # for fresh schemas (NOT EXISTS) and adds the column for upgrades.
            cur.execute(
                "ALTER TABLE youtube_resolutions ADD COLUMN IF NOT EXISTS confidence REAL NOT NULL DEFAULT 0.0"
            )
            conn.commit()
        _SCHEMA_INITIALISED = True
        logger.info("[YOUTUBE] youtube_resolutions table ready")
    except Exception as exc:
        logger.error(f"[YOUTUBE] Schema init failed: {exc}")
    finally:
        release_db_connection(conn)


# v9: YouTube Music resolver narrowed to `filter='songs'` only — Topic-channel
# AUDIO masters, the Spotify auto-mirrors. The previous v8 also pulled the
# `videos` (music-video) filter; visually irrelevant in our hidden iframe
# and occasionally carried channel-intro audio. Audio-master score nudge
# bumped to +0.06 to reflect the stronger identity signal. Cache bumped so
# every v8 row reranks against the new audio-master preference.
_CACHE_VERSION = "v9"


def _cache_key(title: str, artist: str) -> str:
    raw = f"{title}|{artist}".lower().strip()
    return f"{_CACHE_VERSION}:" + re.sub(r"\s+", " ", raw)[:280]


def _cache_get(key: str):
    """Return (found: bool, candidates: list[str], confidence: float).

    Returns the full ranked candidate list AND the confidence we computed at
    cache-write time. A row with no usable ids (a previously cached miss) is
    treated as NOT found, so a now-working API key gets a fresh chance instead
    of being stuck on a poisoned negative entry.
    """
    conn = get_db_connection()
    if not conn:
        return False, [], 0.0
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT video_id, video_ids, confidence FROM youtube_resolutions WHERE cache_key = %s",
                (key,),
            )
            row = cur.fetchone()
            if row is None:
                return False, [], 0.0
            primary, joined = row[0] or "", row[1] or ""
            confidence = float(row[2] or 0.0)
            ids = [v for v in joined.split(",") if v]
            if not ids and primary:        # row predates video_ids column
                ids = [primary]
            if not ids:
                return False, [], 0.0
            return True, ids, confidence
    except Exception as exc:
        logger.warning(f"[YOUTUBE] cache_get error: {exc}")
        return False, [], 0.0
    finally:
        release_db_connection(conn)


def _cache_put(key: str, candidates: list, title: str, artist: str,
                confidence: float = 0.0) -> None:
    """Cache the full ranked candidate list AND the confidence used at write
    time. video_id keeps the primary pick for back-compat; video_ids holds the
    whole list so a cache hit has fallbacks."""
    conn = get_db_connection()
    if not conn:
        return
    primary = candidates[0] if candidates else ""
    joined  = ",".join(candidates[:12])   # cap stored list; 12 is plenty of fallbacks
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO youtube_resolutions (cache_key, video_id, video_ids, confidence, title, artist)
                VALUES (%s, %s, %s, %s, %s, %s)
                ON CONFLICT (cache_key) DO UPDATE
                  SET video_id   = EXCLUDED.video_id,
                      video_ids  = EXCLUDED.video_ids,
                      confidence = EXCLUDED.confidence
                """,
                (key, primary, joined, float(confidence), title[:300], artist[:300]),
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


# ── Romanization / phonetic normalization ──────────────────────────────────
# Indian-language catalog has heavy spelling variance once romanized:
# "Naatu Naatu" / "Natu Natu", "Saami Saami", "Kaavaalaa" / "Kavala". Plus
# diacritics: "Beyoncé" / "Beyonce", "Sigur Rós" / "Sigur Ros". These are
# CHEAP normalizations applied BEFORE any fuzzy-distance work — most of
# the romanization-variance hits collapse to exact matches at this layer
# and never need Levenshtein at all.
#
#   1. Unicode NFKD then drop combining marks  → diacritic folding
#   2. Collapse runs of identical letters (≥2 → 1) → "naatu"→"natu",
#      "saami"→"sami", "kaavaalaa"→"kavala". Applied symmetrically so
#      both sides reduce to the same form regardless of which spelling
#      the user/uploader chose.

def _fold_token(tok: str) -> str:
    """Diacritic-fold + collapse doubled letters. Pure ASCII out."""
    if not tok:
        return ""
    # NFKD splits 'é' → 'e' + combining-acute; drop the combining marks.
    nfkd = unicodedata.normalize("NFKD", tok)
    ascii_ = "".join(ch for ch in nfkd if not unicodedata.combining(ch))
    ascii_ = ascii_.lower()
    # Collapse runs of identical chars (length ≥ 2) to a single char.
    return re.sub(r"(.)\1+", r"\1", ascii_)


# ── Levenshtein edit-distance (pure Python DP, ~10 lines) ──────────────────
# Used only as a fuzzy fallback when folded-exact match fails — typo paths
# ("Bohmian"/"Bohemian"), partial romanization survivors, minor spellings.
# Threshold: edit_distance / max(len) <= 0.35 — i.e. a 6-char token can
# differ by 2 chars and still match; a 10-char token by 3; etc.

def _lev(a: str, b: str) -> int:
    """Standard Wagner–Fischer Levenshtein distance."""
    if a == b:
        return 0
    if not a:
        return len(b)
    if not b:
        return len(a)
    # Row-by-row DP, O(min(len(a), len(b))) space.
    if len(a) < len(b):
        a, b = b, a
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i] + [0] * len(b)
        for j, cb in enumerate(b, 1):
            cur[j] = min(
                prev[j] + 1,           # deletion
                cur[j - 1] + 1,        # insertion
                prev[j - 1] + (0 if ca == cb else 1),  # substitution
            )
        prev = cur
    return prev[-1]


# Distance cutoff and weight discount for the fuzzy fallback. Both are
# applied AFTER fold-exact has had its shot, so romanization-variance hits
# already exact-matched and never reach this branch.
_FUZZY_CUTOFF = 0.35
_FUZZY_WEIGHT = 0.75


def _fuzzy_hit(tok: str, hay_set: set, hay_squashed: str) -> bool:
    """True if `tok` is within the fuzzy cutoff of any token in `hay_set`,
    or appears as a near-substring in `hay_squashed`. Cheap short-circuit
    skips tokens of wildly different length up-front."""
    if not tok:
        return False
    for h in hay_set:
        if not h:
            continue
        lmax = max(len(tok), len(h))
        if abs(len(tok) - len(h)) / lmax > _FUZZY_CUTOFF:
            continue                                  # cheap length filter
        if _lev(tok, h) / lmax <= _FUZZY_CUTOFF:
            return True
    # Substring sweep against the squashed channel string for cases where
    # the YouTube side concatenates words ("BeyonceVEVO", "ArijitOfficial").
    if len(tok) >= 4 and tok in hay_squashed:
        return True
    return False


def _required_versions(spotify_title: str) -> set:
    """If the Spotify track itself is a Remix/Acoustic/Live/etc. version, the
    YouTube match MUST also be that version. Returns the set of tags found."""
    low = spotify_title.lower()
    return {v for v in _VERSION_TAGS if v in low}


# ── Confidence scoring: replaces the old binary identity gate ────────────────
# The old code was a hard AND-gate: a candidate had to clear an 80% title
# threshold AND contain the artist AND survive a strict duration window, or it
# was thrown away — which is exactly what produced "couldn't load, skipping".
#
# Instead, every candidate now earns a CONTINUOUS 0..1 confidence from several
# weighted signals, and the caller accepts the best one as long as it clears a
# *relative* floor. A right-title / wrong-length upload therefore still plays.
#
# Nothing here is a tuned per-song constant: title tokens are weighted by their
# own length (distinctive words count more), duration closeness is measured
# RELATIVE to the song's own length, and the acceptance floor is derived from
# how much of the title we covered — never a fixed number of seconds.

# Relative weights of the three core signals. Title dominates (strongest "is
# this the right song" evidence); artist confirms; duration only nudges the
# ranking and never gates.
_W_TITLE  = 0.60
_W_ARTIST = 0.25
_W_DUR    = 0.15

# Channel substrings that mark an official master upload — a weak positive prior.
_OFFICIAL_CHANNEL_TOKENS = ("vevo", "official", "topic", "records")


# ── Channel reputation map ─────────────────────────────────────────────────
# Tie-breaker multiplier applied AFTER the base score. Channel substrings
# that empirically produce a particular embeddability / cleanliness profile
# get nudged up or down. The exact value range stays close to 1.0 so this
# layer never overrides the title/artist/duration evidence — it only sorts
# already-comparable candidates.
#
# Notes on individual values:
#   "vevo"     — the spec calls this hard penalty (0.10) because so many
#                VEVO uploads are non-embeddable. The risk is tanking the
#                legitimate master when it IS embeddable. The player falls
#                through dead videos already; we trade a small chance of
#                missing an embeddable VEVO master for a much larger gain
#                of skipping the dead ones.
#   "- topic"  — Spotify's auto-mirror, almost always the exact same audio
#                that's in Spotify but embeddability is mixed.
#   "official" — fan-named "X Official" channels are weaker than VEVO but
#                generally clean uploads of the original audio.
#   default    — unknown / indie channels often allow embed; small boost.
_CHANNEL_REPUTATION = (
    ("vevo",     0.10),   # very rarely embeddable in iframe — heavily penalise
    ("- topic",  0.85),   # auto-mirror; mixed embed status
    ("official", 0.95),   # mild trust
)
_CHANNEL_BONUS_UNKNOWN = 1.02


def _channel_reputation_multiplier(channel_lower: str) -> float:
    """Return the rep multiplier for a channel title. First substring match
    wins; falls back to the unknown-channel bonus."""
    if not channel_lower:
        return _CHANNEL_BONUS_UNKNOWN
    for needle, mult in _CHANNEL_REPUTATION:
        if needle in channel_lower:
            return mult
    return _CHANNEL_BONUS_UNKNOWN


def _weighted_coverage(want_tokens: list, hay_set: set, hay_squashed: str) -> float:
    """Fraction of the wanted tokens present, each weighted by its own length
    so distinctive words ('bohemian') count more than short glue ('you').
    Returns 0..1. Empty want-set → 1.0 (nothing left to satisfy).

    Three-tier matching applied per token, in order:
      a) RAW exact      — tok in hay_set / hay_squashed → full weight.
      b) FOLDED exact   — diacritic-fold + collapse-doubles on both sides,
                          then exact compare → full weight. Catches romaniz-
                          ation variance ("Naatu"/"Natu"), diacritics
                          ("Beyoncé"/"Beyonce") at zero distance.
      c) FUZZY fallback — Levenshtein on folded forms, dist/maxlen ≤ 0.35
                          → 0.75× weight. Catches typos and minor spelling
                          drift; the discount keeps a clean exact-token
                          candidate ranked above a fuzzy one.
    """
    if not want_tokens:
        return 1.0

    # Build folded views of the haystack once per candidate.
    folded_hay_set = {_fold_token(h) for h in hay_set if h}
    folded_hay_squashed = _fold_token(hay_squashed)

    total = have = 0.0
    for tok in want_tokens:
        w = len(tok)
        total += w
        if tok in hay_set or tok in hay_squashed:
            have += w
            continue
        ft = _fold_token(tok)
        if ft and (ft in folded_hay_set or (len(ft) >= 3 and ft in folded_hay_squashed)):
            have += w
            continue
        if ft and _fuzzy_hit(ft, folded_hay_set, folded_hay_squashed):
            have += w * _FUZZY_WEIGHT
    return (have / total) if total else 0.0


def _match_score(meta: dict, want_title_tokens: list, want_artist_tokens: list,
                 required_versions: set, target_seconds: int, rank: int,
                 ambient: bool = False) -> tuple:
    """Continuous confidence that `meta` IS the wanted song.

    Returns (score, title_cov). `title_cov` is surfaced separately so the
    caller's acceptance floor can key off the single most trustworthy signal
    (how much of the title matched) rather than the blended score.

    Channel matching tolerates concatenated names ("JonasBrothersVEVO") via
    substring containment, same as the old gate.
    """
    t_low      = _normalize(meta.get("title", ""))
    c_low      = _normalize(meta.get("channel", ""))
    t_set      = set(t_low.split())
    c_squashed = c_low.replace(" ", "")

    title_cov  = _weighted_coverage(want_title_tokens, t_set, c_squashed)
    artist_cov = _weighted_coverage(want_artist_tokens, t_set, c_squashed)

    # Duration proximity — RELATIVE to the song's own length, so a 12s gap on a
    # 3-min song scores the same as a 12s gap would, instead of being judged
    # against a fixed ±15s window. Unknown length → neutral (never penalised).
    # For ambient/noise tracks (pink noise, rain, ASMR) the upload duration
    # varies wildly between a 30s loop and a 10-hour version — duration is
    # meaningless as evidence so we hold it neutral.
    dur = meta.get("duration", 0) or 0
    if ambient:
        dur_score = 0.5
    elif target_seconds > 0 and dur > 0:
        rel = abs(dur - target_seconds) / max(target_seconds, 1)
        dur_score = 1.0 / (1.0 + rel * 3.0)     # rel 0→1.0, .33→.5, 1.0→.25
    else:
        dur_score = 0.5

    # For ambient tracks the Spotify "artist" is usually a label
    # ("Nature Sounds", "Sleep Music Inc") that almost never matches the
    # YouTube uploader. Redistribute artist's weight onto title — the title
    # IS the identity for these ("Pink Noise 10 Hours").
    if ambient:
        score = ((_W_TITLE + _W_ARTIST) * title_cov +
                 _W_DUR * dur_score)
    else:
        score = (_W_TITLE * title_cov +
                 _W_ARTIST * artist_cov +
                 _W_DUR * dur_score)

    # ── Multiplicative penalties (shape ranking, rarely zero a candidate) ────
    # Derivative content (cover/karaoke/nightcore…) unless the Spotify track
    # itself signalled that word. Heavy discount, NOT elimination — a clean
    # upload always outranks a cover, but a cover of the RIGHT song still beats
    # silence when it's genuinely all that exists.
    bad = _BAD.search(meta.get("title", ""))
    if bad:
        bad_word     = bad.group(0).lower()
        bad_squashed = re.sub(r"[\s-]+", "", bad_word)
        spotify_low  = _normalize(" ".join(want_title_tokens))
        allowed = (bad_squashed in {re.sub(r"[\s-]+", "", v) for v in required_versions}) or \
                  (bad_word in spotify_low)
        if not allowed:
            score *= 0.35

    # Required-version mismatch (Spotify said "Acoustic", this upload isn't).
    for v in required_versions:
        if v not in t_low:
            score *= 0.6

    # ── Additive nudges (bounded tie-breakers) ──────────────────────────────
    if meta.get("embeddable"):
        score += 0.04                            # plays in-iframe without a fight
    if any(tok in c_squashed for tok in _OFFICIAL_CHANNEL_TOKENS):
        score += 0.04                            # official master, almost certainly right
    score += max(0.0, 0.03 - rank * 0.002)       # earlier search hits = weak relevance prior

    # ── Channel reputation multiplier ────────────────────────────────────────
    # Final tie-breaker — applied after additive nudges so it scales the
    # already-shaped score. Most channels land near 1.02; VEVO/"- topic"
    # bring known-bad embed profiles down. See _CHANNEL_REPUTATION for the
    # rationale on each.
    score *= _channel_reputation_multiplier(c_low)

    return max(0.0, min(1.0, score)), title_cov


def _ytmusic_search(query: str, max_results: int = 30) -> tuple:
    """One YouTube Music search → (ordered_ids, {id: meta}) matching the
    same shape `_video_meta` returns for the Data API path.

    ── AUDIO ONLY ────────────────────────────────────────────────────────
    Hits ONLY YouTube Music's `songs` filter — the Topic-channel audio
    masters that Spotify auto-mirrors. These are the actual audio uploads
    (no music videos, no live recordings, no fan covers, no remixes); the
    same audio you'd hear playing the track natively in Spotify, served by
    YouTube's catalogue and embeddable in our hidden iframe.
    The `videos` filter (music VIDEOS — visual uploads) is intentionally
    skipped: the iframe is invisible in this app, so a video upload would
    just give us a visually-different copy of the audio we already had,
    while sometimes carrying extra channel/intro audio noise.

    Each result already carries title / channel / duration so NO videos.list
    quota call is needed for these — we mark them embeddable by default
    (Topic-channel masters are uniformly syndicated; the iframe still vets
    at runtime and the player falls through any rare duds).

    Returns ([], {}) on any error so the Data API path keeps working alone.
    """
    client = _get_ytmusic_client()
    if not client or not query:
        return [], {}
    try:
        items = client.search(
            query, filter="songs",
            limit=max_results, ignore_spelling=False,
        ) or []
    except Exception as exc:
        logger.warning(f"[YTMUSIC] songs search '{query}' failed: {exc}")
        return [], {}

    ordered: list = []
    meta: dict = {}
    for it in items[:max_results]:
        vid = (it or {}).get("videoId")
        if not vid or vid in meta:
            continue
        title = it.get("title", "") or ""
        artists = it.get("artists") or []
        # Concatenate every credited artist; identity matching looks for
        # the artist tokens anywhere in title OR channel substring, so
        # joining them gives the maximal hit surface.
        channel = " ".join(a.get("name", "") for a in artists if a) or it.get("author", "") or ""
        dur_raw = it.get("duration_seconds") or it.get("duration") or 0
        duration = _ytmusic_duration_to_seconds(dur_raw)
        meta[vid] = {
            "embeddable": True,        # Topic-channel masters are iframe-friendly
            "duration":   duration,
            "title":      title,
            "channel":    channel,
            "_source":    "ytmusic",   # debug/log marker, used for scoring nudge
        }
        ordered.append(vid)
    return ordered, meta


def _duration_bucket(seconds: int) -> str:
    """Map a target song length to YouTube's `videoDuration` enum.
    short = <4min, medium = 4–20min, long = >20min, any = unknown.
    Used in the search call so YouTube only returns uploads in the right
    ballpark and we don't burn quota on Shorts or 10-hour mixes."""
    if seconds <= 0:
        return "any"
    if seconds < 240:
        return "short"
    if seconds <= 1200:
        return "medium"
    return "long"


def _raw_search_ids(query: str, max_results: int = 25, music_only: bool = False,
                    embeddable_only: bool = True, duration_bucket: str = "any") -> list:
    """One YouTube search → list of videoIds in rank order. 100 quota units.

    Default filters favour iframe-playable results AT SOURCE:
      • videoEmbeddable=true — YouTube only returns uploads it claims can be
        embedded (the `videos.list` embeddable flag often disagrees with
        what the iframe actually accepts, but search-side filtering at least
        culls the bulk of label-blocked masters that throw code=150).
      • videoSyndicated=true — only uploads playable outside youtube.com,
        the proper iframe-friendly subset. This was the single biggest source
        of "couldn't find, skipping" — non-syndicated VEVO/label uploads were
        returned, looked embeddable in `videos.list`, then died in the iframe.
      • videoDuration=<bucket> — when target length is known, ditto.
      • music_only — videoCategoryId=10 strips reactions/tutorials/vlogs.

    These all run AT THE SEARCH LAYER, so they cost nothing extra and pre-cull
    junk before it even reaches the scoring stage.

    `embeddable_only=False` is reserved for last-ditch fallback queries — the
    filter occasionally drops too aggressively for obscure tracks (the search
    side and the video side don't share the same embeddability index), and
    the player can still try those uploads via the fallthrough loop.
    """
    try:
        params = {
            "key":        YOUTUBE_API_KEY,
            "q":          query,
            "part":       "snippet",
            "type":       "video",
            "maxResults": max_results,
        }
        if embeddable_only:
            params["videoEmbeddable"] = "true"
            params["videoSyndicated"] = "true"
        if duration_bucket and duration_bucket != "any":
            params["videoDuration"] = duration_bucket
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


# Acceptance floor — only refusal path is "this is a DIFFERENT song", which
# shows up as the title barely overlapping. Lowered from 0.5 to 0.4 (Apr v3.1)
# so right-title uploads with messy decoration ("Song Name | Lyrical Video |
# Featured | Bollywood 2023") still clear when ~40% of distinctive title-weight
# matches. Wrong songs still fail; right songs with verbose titles now don't.
_TITLE_MAJORITY = 0.4


def _run_search_pipeline(title: str, artist: str, target_seconds: int,
                          queries: list, ambient: bool = False,
                          embeddable_only: bool = True) -> tuple:
    """Inner pipeline shared by the primary call and the second-pass retry.

    Takes a list of (query, music_only) tuples, runs them, scores the union
    of returned ids against the wanted title/artist/duration, and returns
    (accepted_ids, best_score, best_title_cov). Empty tuple-of-zeros on
    total miss (no ids at all). `ambient=True` propagates the relaxed scoring
    posture (artist neutralised, duration neutral) down to `_match_score`.
    `embeddable_only=False` widens the second-pass fallback, since the search
    embeddability filter is over-eager on obscure tracks.
    """
    want_title_tokens  = _tokens(_clean_title(title))
    want_artist_tokens = _tokens(artist)
    required_versions  = _required_versions(title)
    # When target length is known, ask YouTube to pre-bucket results — this
    # alone strips most Shorts / extended-remix junk before scoring.
    dur_bucket = "any" if ambient else _duration_bucket(target_seconds)

    if not want_title_tokens:
        return [], 0.0, 0.0

    # ── Parallel fan-out across BOTH resolvers ─────────────────────────────
    # Data API queries and YouTube Music queries fire concurrently — total
    # wall-clock = max(slowest single search) rather than sum. Each resolver
    # contributes its own ordered id list; we union them preserving first-seen
    # order. YouTube Music's clean catalogue tends to land the strongest
    # candidates near the top of the union which is exactly what the rank
    # nudge in `_match_score` rewards.
    da_futures = []
    ym_futures = []
    for q, music_only in queries:
        if not q:
            continue
        da_futures.append((q, _ytmusic_executor.submit(
            _raw_search_ids, q, 25,
            music_only=music_only,
            embeddable_only=embeddable_only,
            duration_bucket=dur_bucket,
        )))
        # Fire YouTube Music on the SAME queries — equal priority, no rate
        # gating. The shapes that work for the Data API ("title artist",
        # "title artist audio", etc.) work just as well as YTMusic queries.
        if _YTMUSIC_AVAILABLE:
            ym_futures.append((q, _ytmusic_executor.submit(_ytmusic_search, q, 30)))

    ids: list = []
    seen: set = set()
    ytmusic_meta: dict = {}

    for _q, fut in da_futures:
        try:
            batch = fut.result(timeout=10) or []
        except Exception as exc:
            logger.warning(f"[YOUTUBE] DA future failed for {_q!r}: {exc}")
            continue
        for vid in batch:
            if vid not in seen:
                seen.add(vid)
                ids.append(vid)

    for _q, fut in ym_futures:
        try:
            ym_ids, ym_meta = fut.result(timeout=10)
        except Exception as exc:
            logger.warning(f"[YTMUSIC] future failed for {_q!r}: {exc}")
            continue
        for vid in (ym_ids or []):
            if vid not in seen:
                seen.add(vid)
                ids.append(vid)
            # Even when the Data API and YTMusic returned the SAME id, prefer
            # YTMusic's authoritative metadata (it's the master record), so
            # write into the meta dict unconditionally.
            ytmusic_meta[vid] = ym_meta[vid]

    if not ids:
        return [], 0.0, 0.0

    # Fetch Data API metadata only for ids YTMusic didn't already give us
    # — saves quota on every YTMusic-only hit (which is most of them for
    # popular catalogue).
    missing_meta_ids = [v for v in ids if v not in ytmusic_meta]
    da_meta = _video_meta(missing_meta_ids) if missing_meta_ids else {}
    # Merge: YTMusic meta wins on overlap (cleaner source).
    meta = {**da_meta, **ytmusic_meta}

    scored = []
    for r, vid in enumerate(ids):
        m = meta.get(vid)
        if not m:
            continue
        s, tcov = _match_score(
            m, want_title_tokens, want_artist_tokens,
            required_versions, target_seconds, r,
            ambient=ambient,
        )
        # Audio-master nudge for YouTube Music-sourced candidates — these are
        # Topic-channel uploads (the actual audio masters Spotify auto-mirrors),
        # not music videos or fan re-uploads. Larger nudge than before (+0.06)
        # because the `songs` filter guarantees audio identity; all-else-equal
        # an audio master is the right pick over a Data API cover/lyric video.
        # Still bounded so genuine title/artist evidence wins on disagreement.
        if m.get("_source") == "ytmusic":
            s = min(1.0, s + 0.06)
        scored.append((s, tcov, vid))

    if not scored:
        return [], 0.0, 0.0

    scored.sort(key=lambda x: x[0], reverse=True)
    best_score, best_tcov, _ = scored[0]
    accepted = [vid for s, tcov, vid in scored if tcov >= _TITLE_MAJORITY]
    if not accepted:
        accepted = [scored[0][2]]
    # Return up to 40 (was 20) — the player walks this list on iframe 150
    # errors, and YouTube's `videos.list embeddable` flag is noisy enough
    # that a longer fallback list materially reduces "couldn't load" cases.
    return accepted[:40], best_score, best_tcov


def _search_candidates(title: str, artist: str, target_seconds: int = 0,
                        _retry: bool = False) -> tuple:
    """Resolve "<title> <artist>" to (ids, confidence, title_cov).

    Pipeline:
      1. Cast a WIDE net — 6 search variants spanning the most reliable
         discovery patterns for songs on YouTube:
           a. primary       "<title> <artist>"
           b. reversed      "<artist> - <title>"
           c. audio variant "<title> <artist> audio"
           d. lyrics        "<title> <artist> lyrics"
           e. official      "<title> <artist> official audio"
           f. topic upload  "<artist> <title> topic"
      2. Dedupe → one videos.list call returns embeddable + duration + title
         + channel for every candidate.
      3. Score every candidate with `_match_score`. Duration is a ranking
         signal here, NOT a gate.
      4. Accept every candidate whose TITLE coverage clears the title's own
         majority weight (_TITLE_MAJORITY).
      5. Refusal branch fires SECOND-PASS RETRY: one extra search with the
         artist dropped and "full song" added, scored through the same
         pipeline. If that clears the floor it plays; otherwise we return
         empty (`confidence=0`) and the player surfaces "unavailable".

    Quota budget: up to 6 searches (600u) + 1 videos.list (1u) ≈ 601u per
    miss. Retry adds at most 100u + 1u when it fires. Cache makes hits free.
    """
    # Ambient/noise/nature tracks (pink noise, rain, ASMR, binaural) need
    # the relaxed scoring posture: artist neutralised (Spotify "artist" is
    # usually a label that doesn't match YouTube uploaders), duration neutral
    # (uploads vary 30s↔10h with no meaningful target). Detected from title
    # + artist text by sound_seeds.is_sound_track.
    ambient = bool(is_sound_track(title, artist))
    if ambient:
        logger.info(f"[AMBIENT] {title!r} / {artist!r}: relaxed scoring posture")

    # ── Tier 1: strict primary — embeddable+syndicated filter + duration bucket
    # Pre-cull at the SOURCE so most of the iframe-150 deaths never enter the
    # pool. Six query shapes spanning the standard discovery patterns.
    primary_queries = [
        (f"{title} {artist}".strip(),                False),
        (f"{artist} - {title}".strip(" -"),          False),
        (f"{title} {artist} audio".strip(),          False),
        (f"{title} {artist} lyrics".strip(),         False),
        (f"{title} {artist} official audio".strip(), False),
        (f"{artist} {title} topic".strip(),          False),
    ]
    ids, best_score, best_tcov = _run_search_pipeline(
        title, artist, target_seconds, primary_queries, ambient=ambient,
        embeddable_only=True,
    )

    if ids and best_tcov >= _TITLE_MAJORITY:
        logger.info(
            f"[YOUTUBE] {title!r} / {artist!r}: {len(ids)} pick(s), "
            f"best score={best_score:.2f} (title {best_tcov:.2f}), primary={ids[0]}"
        )
        return ids, best_score, best_tcov

    # ── Tier 2: relaxed retry — WIDER queries, embeddable filter OFF.
    # YouTube's search-side `videoEmbeddable` filter is over-eager on obscure
    # tracks (it sometimes drops uploads that the videos.list endpoint says
    # ARE embeddable). Dropping it here recovers tracks the strict tier missed.
    # The `videos.list embeddable` check at scoring time still vets each one.
    if _retry:
        logger.info(
            f"[RETRY] giving up for {title!r} / {artist!r} — best title "
            f"coverage {best_tcov:.2f} stays below floor after relaxation"
        )
        return [], 0.0, best_tcov

    logger.info(
        f"[RETRY] primary refused for {title!r} / {artist!r} "
        f"(best tcov {best_tcov:.2f}); relaxing"
    )
    # Eight relaxed query shapes — more discovery angles than the strict tier,
    # including artist-dropped variants for tracks where the Spotify artist
    # field is unhelpful (compilations, soundtracks, labels-as-artist).
    retry_queries = [
        (f"{title} {artist}".strip(),                False),  # same query, no embed filter
        (f"{title} {artist} full song".strip(),      False),
        (f"{title} {artist} music video".strip(),    False),
        (f"{title} {artist} hd".strip(),             False),
        (f"{title} full song".strip(),               False),  # artist dropped
        (f"{title}".strip(),                         True),   # music-only, title only
        (f"{title} song".strip(),                    False),
        (f"{title} {artist} mp3".strip(),            False),
    ]
    ids2, score2, tcov2 = _run_search_pipeline(
        title, artist, target_seconds, retry_queries, ambient=ambient,
        embeddable_only=False,
    )
    if ids2 and tcov2 >= _TITLE_MAJORITY:
        logger.info(
            f"[RETRY] recovered {title!r} / {artist!r} via relaxation: "
            f"score={score2:.2f} (title {tcov2:.2f}), primary={ids2[0]}"
        )
        return ids2, score2, tcov2

    # ── Tier 3: union of every candidate scored across both passes — if ANY
    # plausibly ARE this song we surface them with low confidence rather
    # than refusing outright. The score is what triggers the "best guess"
    # badge in the player; the user can hit ⏭ if it's actually wrong.
    union_ids = []
    seen = set()
    for src in (ids, ids2):
        for v in (src or []):
            if v not in seen:
                seen.add(v); union_ids.append(v)
    if union_ids:
        fallback_score = max(best_score, score2)
        fallback_tcov  = max(best_tcov, tcov2)
        logger.info(
            f"[YOUTUBE] surfacing {len(union_ids)} sub-floor candidate(s) for "
            f"{title!r} / {artist!r} (score={fallback_score:.2f}, "
            f"title={fallback_tcov:.2f}) — best-guess playback"
        )
        return union_ids[:40], fallback_score, fallback_tcov

    logger.info(
        f"[YOUTUBE] no candidates at all for {title!r} / {artist!r}"
    )
    return [], 0.0, 0.0


# ── Confidence-band cutoffs ────────────────────────────────────────────────
# The score formula's practical ceiling for a "clean" match (perfect title,
# perfect artist, unknown duration, embeddable, official channel) is roughly
# 0.60 + 0.25 + 0.15*0.5 + 0.04 + 0.04 + 0.03 ≈ 0.835, scaled by ~1.02 channel
# rep ≈ 0.85. A perfect-everything match with known duration tops near ~0.95.
# So the bands are anchored to that achievable range, not 0..1.
_CONFIDENCE_HIGH = 0.70
_CONFIDENCE_LOW  = 0.55


def _confidence_label(score: float) -> str:
    if score >= _CONFIDENCE_HIGH:
        return "high"
    if score < _CONFIDENCE_LOW:
        return "low"
    return "medium"


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
    found, cached_ids, cached_conf = _cache_get(key)
    if found and cached_ids:
        remaining = [c for c in cached_ids if c not in exclude_set]
        if remaining:
            return {
                "videoId":         remaining[0],
                "candidates":      remaining,
                "cached":          True,
                "confidence":      cached_conf,
                "confidenceLabel": _confidence_label(cached_conf),
            }
        # Cached pool fully exhausted by the iframe's exclude list — fall
        # through to a fresh search below (but reuse the cached ids as
        # already-tried so we don't re-pick them).
        exclude_set |= set(cached_ids)

    if not YOUTUBE_API_KEY:
        # Not configured — tell the client so it can fall back gracefully.
        raise HTTPException(status_code=503, detail="YouTube playback is not configured.")

    target_seconds = int(duration_ms // 1000) if duration_ms > 0 else 0
    all_candidates, best_score, _best_tcov = _search_candidates(title, artist, target_seconds)
    candidates = [c for c in all_candidates if c not in exclude_set]
    video_id = candidates[0] if candidates else ""
    if candidates:
        _cache_put(key, candidates, title, artist, confidence=best_score)
    else:
        # Don't poison the cache with a miss — a transient error (quota, a
        # referrer-restricted key returning 403, no results) shouldn't block
        # this track forever. It'll simply be retried next time.
        logger.warning(f"[YOUTUBE] no embeddable videoId for {title!r} / {artist!r} (excluded {len(exclude_set)})")
    return {
        "videoId":         video_id or None,
        "candidates":      candidates,
        "cached":          False,
        "confidence":      best_score if candidates else 0.0,
        "confidenceLabel": _confidence_label(best_score) if candidates else "low",
    }


# ── Telemetry skeleton ──────────────────────────────────────────────────────
# Append-only JSONL of play / skip / replay events. Flat-file now; the schema
# (one JSON object per line, stable field names) lets us graduate this to
# Postgres later by tailing the file or replaying it once. Never blocks the
# request: best-effort writes, never raises.
#
# Skip threshold lives on the CLIENT — server just records what arrives. The
# spec uses 10s (skip = next pressed within 10s of play start), which the
# frontend enforces.

_TELEMETRY_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "data", "telemetry.jsonl",
)


class TelemetryEvent(BaseModel):
    track_id:         Optional[str] = Field(default="", description="client-side track UUID (player queue id)")
    title:            Optional[str] = ""
    artist:           Optional[str] = ""
    video_id:         Optional[str] = ""
    event_type:       str = Field(..., description="one of: play | skip | replay | complete")
    score:            Optional[float] = 0.0
    confidence_label: Optional[str] = ""
    elapsed_ms:       Optional[int] = 0
    timestamp:        Optional[int] = 0


_ALLOWED_EVENTS = {"play", "skip", "replay", "complete"}


@router.post("/api/telemetry/event")
def telemetry_event(ev: TelemetryEvent, request: Request):
    """Append a single playback event to the JSONL log.

    Schema is intentionally minimal but stable: track identity (id / title /
    artist / video_id), event_type, match score + label at resolve time,
    elapsed_ms at the moment the event fires (lets us learn skip-time
    distributions), and a client-supplied timestamp. The server stamps its
    own arrival time for any later clock-drift correction.

    No-op on bad event_type or write failure. Never blocks playback.
    """
    require_session_token(request, lax=True)
    et = (ev.event_type or "").lower().strip()
    if et not in _ALLOWED_EVENTS:
        raise HTTPException(status_code=400, detail=f"unknown event_type: {et!r}")

    row = {
        "event_type":       et,
        "track_id":         (ev.track_id or "")[:64],
        "title":            (ev.title or "")[:300],
        "artist":           (ev.artist or "")[:300],
        "video_id":         (ev.video_id or "")[:32],
        "score":            float(ev.score or 0.0),
        "confidence_label": (ev.confidence_label or "")[:16],
        "elapsed_ms":       int(ev.elapsed_ms or 0),
        "client_ts":        int(ev.timestamp or 0),
        "server_ts":        int(time.time() * 1000),
    }
    try:
        os.makedirs(os.path.dirname(_TELEMETRY_PATH), exist_ok=True)
        with open(_TELEMETRY_PATH, "a", encoding="utf-8") as fh:
            fh.write(json.dumps(row, separators=(",", ":")) + "\n")
    except Exception as exc:
        # Telemetry never breaks playback. Log and move on.
        logger.warning(f"[TELEMETRY] write failed: {exc}")
        return {"recorded": False}
    return {"recorded": True}
