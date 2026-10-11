import re
import time
import base64
import random
import threading
import unicodedata
from typing import Optional
from concurrent.futures import as_completed, TimeoutError as FutureTimeoutError

import requests
from fastapi import HTTPException

from config import logger, SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET, LANGUAGE_ALIASES
from mood_engine import (
    build_search_queries, detect_indian_language, parse_language,
    DeduplicationState, _GLOBAL_EXECUTOR,
)
from query_banks import INDIAN_LANG_QUERY_BANKS
from exclusions import Exclusions, make_track_filter


# ─────────────────────────────────────────────────────────────────────────────
# App-level (client-credentials) token
# ─────────────────────────────────────────────────────────────────────────────
# Some flows (e.g. the post-quiz song suggestions on the result screen) need to
# search Spotify BEFORE the user has connected their own Spotify account. The
# Client-Credentials grant yields an app-scoped token that can hit the public
# search/track endpoints (it cannot touch a user's library — that still needs
# the user's own Bearer token). Cached in-memory and refreshed ~1 min early.
_app_token_cache = {"token": None, "expires_at": 0.0}
_app_token_lock  = threading.Lock()


def get_app_token() -> str:
    now = time.time()
    with _app_token_lock:
        if _app_token_cache["token"] and now < _app_token_cache["expires_at"] - 60:
            return _app_token_cache["token"]

        if not SPOTIFY_CLIENT_ID or not SPOTIFY_CLIENT_SECRET:
            raise HTTPException(status_code=503, detail="Spotify is not configured on the server.")

        basic = base64.b64encode(
            f"{SPOTIFY_CLIENT_ID}:{SPOTIFY_CLIENT_SECRET}".encode()
        ).decode()
        try:
            res = requests.post(
                "https://accounts.spotify.com/api/token",
                headers={
                    "Authorization":  f"Basic {basic}",
                    "Content-Type":   "application/x-www-form-urlencoded",
                },
                data={"grant_type": "client_credentials"},
                timeout=8,
            )
            res.raise_for_status()
            data = res.json()
        except Exception as exc:
            logger.error(f"[SPOTIFY] client-credentials token error: {exc}")
            raise HTTPException(status_code=503, detail="Could not authenticate with Spotify.")

        _app_token_cache["token"]      = data["access_token"]
        _app_token_cache["expires_at"] = now + data.get("expires_in", 3600)
        return _app_token_cache["token"]


def get_spotify_user_profile(token: str):
    res = requests.get(
        "https://api.spotify.com/v1/me",
        headers={"Authorization": f"Bearer {token}"},
    )
    if res.status_code != 200:
        raise HTTPException(status_code=401, detail="Invalid Spotify token")
    return res.json()


def _artist_ids_of(t: dict) -> list:
    artists = t.get("artists")
    if not isinstance(artists, list):
        return []
    return [a.get("id") for a in artists if isinstance(a, dict) and a.get("id")]


def normalise_track(t: dict) -> dict:
    album_images = t.get("album", {}).get("images", []) if "album" in t else []
    # Stash the primary artist id so a later batched `/v1/artists` call can
    # fetch genre tags for the dynamic exclusion filter. Frontend ignores
    # unknown fields.
    artist_ids = _artist_ids_of(t)
    artist_id = artist_ids[0] if artist_ids else ""
    return {
        "title":      t["name"],
        "artist":     t["artists"][0]["name"] if t.get("artists") else "Unknown",
        "albumArt":   album_images[0]["url"] if album_images else None,
        "spotifyUrl": t.get("external_urls", {}).get("spotify", ""),
        "previewUrl": t.get("preview_url"),
        "uri":        t.get("uri", ""),
        "artistId":   artist_id,
        "artistIds":  artist_ids,
        "artistNames": [a.get("name", "") for a in (t.get("artists") or []) if isinstance(a, dict)],
        "durationMs": t.get("duration_ms") or 0,
        # Spotify's `explicit` flag — true if the track has Parental Advisory
        # ("E" badge in the Spotify UI). Used by the explicit-content filter
        # in exclusions.make_track_filter.
        "explicit":   bool(t.get("explicit", False)),
    }


# In-process cache for artist-genre lookups. Spotify artist genres are stable
# enough that we can keep them around for the lifetime of the process. Keyed by
# Spotify artist id, value is a tuple of genre tag strings (immutable so set()
# membership tests stay fast).
_artist_genre_cache: dict[str, tuple] = {}
_artist_genre_lock = threading.Lock()


def _fetch_artist_genres_chunk(token: str, chunk: list) -> dict[str, tuple]:
    for attempt in range(2):
        try:
            res = requests.get(
                "https://api.spotify.com/v1/artists",
                headers={"Authorization": f"Bearer {token}"},
                params={"ids": ",".join(chunk)},
                timeout=8,
            )
        except Exception as exc:
            logger.warning(f"[ARTIST_GENRES] fetch error: {exc}")
            break
        if res.status_code == 200:
            found: dict[str, tuple] = {}
            for art in ((res.json() or {}).get("artists") or []):
                if art and art.get("id"):
                    found[art["id"]] = tuple(g.lower() for g in (art.get("genres") or []))
            return found
        logger.warning(f"[ARTIST_GENRES] HTTP {res.status_code}: {res.text[:120]}")
        if res.status_code == 429 and attempt == 0:
            try:
                wait = float(res.headers.get("Retry-After", "1"))
            except ValueError:
                wait = 1.0
            time.sleep(min(wait, 3.0))
            continue
        break
    return {}


def fetch_artist_genres_batch(token: str, artist_ids: list) -> dict[str, tuple]:
    out: dict[str, tuple] = {}
    if not artist_ids:
        return out

    to_fetch: list = []
    seen: set = set()
    with _artist_genre_lock:
        for aid in artist_ids:
            if not aid or aid in seen:
                continue
            seen.add(aid)
            cached = _artist_genre_cache.get(aid)
            if cached is not None:
                out[aid] = cached
            else:
                to_fetch.append(aid)

    if not to_fetch:
        return out

    chunks = [to_fetch[i:i + 50] for i in range(0, len(to_fetch), 50)]
    futures = [_GLOBAL_EXECUTOR.submit(_fetch_artist_genres_chunk, token, c) for c in chunks]
    for future in futures:
        try:
            found = future.result(timeout=20)
        except Exception as exc:
            logger.warning(f"[ARTIST_GENRES] chunk failed: {exc}")
            continue
        with _artist_genre_lock:
            _artist_genre_cache.update(found)
        out.update(found)

    return out


def _filter_by_artist_genres(tracks: list, token: str, exclusions, strict: bool = True) -> list:
    if not tracks or not exclusions or not exclusions.requires_genre_tags:
        return tracks

    def ids_of(t: dict) -> list:
        ids = [a for a in (t.get("artistIds") or []) if a]
        if not ids and t.get("artistId"):
            ids = [t["artistId"]]
        return ids

    genres_by_artist = fetch_artist_genres_batch(
        token, [aid for t in tracks for aid in ids_of(t)]
    )

    kept = []
    matched = 0
    unverified = 0
    for t in tracks:
        ids = ids_of(t)
        if any(exclusions.matches_any_genre_tag(genres_by_artist.get(a, ())) for a in ids):
            matched += 1
            continue
        if strict and not (ids and genres_by_artist.get(ids[0])):
            unverified += 1
            continue
        kept.append(t)
    if matched or unverified:
        logger.info(
            f"[DISLIKE] artist-genre filter dropped {matched} matching, "
            f"{unverified} unverified track(s), kept {len(kept)}"
        )
    return kept


def apply_exclusions(tracks: list, token: str, exclusions, strict: bool = True) -> list:
    if not exclusions or not tracks:
        return tracks
    keep = make_track_filter(exclusions)
    tracks = [t for t in tracks if keep(t)]
    tracks = _filter_by_artist_genres(tracks, token, exclusions, strict=strict)
    if exclusions.vibe_filters:
        tracks = filter_tracks_by_vibe(tracks, token, exclusions.vibe_filters)
    return tracks


def search_tracks_by_query(token: str, query: str, market: str, limit: int = 30, offset: int = 0) -> list:
    res = requests.get(
        "https://api.spotify.com/v1/search",
        headers={"Authorization": f"Bearer {token}"},
        params={"q": query, "type": "track", "limit": min(limit, 50), "offset": offset, "market": market},
        timeout=6,
    )
    if res.status_code == 429:
        try:
            wait = float(res.headers.get("Retry-After", "1"))
        except ValueError:
            wait = 1.0
        logger.warning(f"[SPOTIFY] search rate limited, retry-after {wait:.0f}s")
        if wait <= 3:
            time.sleep(wait)
            res = requests.get(
                "https://api.spotify.com/v1/search",
                headers={"Authorization": f"Bearer {token}"},
                params={"q": query, "type": "track", "limit": min(limit, 50), "offset": offset, "market": market},
                timeout=6,
            )
    if res.status_code == 200:
        return res.json().get("tracks", {}).get("items", [])
    return []


def fetch_tracks_by_uri(token: str, uris: list) -> list:
    ids = [u.split(":", 2)[2] for u in uris if u.startswith("spotify:track:")][:50]
    if not ids:
        return []
    try:
        res = requests.get(
            "https://api.spotify.com/v1/tracks",
            headers={"Authorization": f"Bearer {token}"},
            params={"ids": ",".join(ids)},
            timeout=8,
        )
    except Exception as exc:
        logger.warning(f"[SPOTIFY] pinned track lookup failed: {exc}")
        return []
    if res.status_code != 200:
        return []
    return [normalise_track(t) for t in (res.json().get("tracks") or []) if t]


def search_artist(token: str, name: str, market: str) -> Optional[dict]:
    """Resolve a free-text artist name to a Spotify artist object (id + genres)."""
    res = requests.get(
        "https://api.spotify.com/v1/search",
        headers={"Authorization": f"Bearer {token}"},
        params={"q": name, "type": "artist", "limit": 1, "market": market},
        timeout=6,
    )
    if res.status_code != 200:
        return None
    items = res.json().get("artists", {}).get("items", [])
    return items[0] if items else None


def get_artist_top_tracks(token: str, artist_id: str, market: str) -> list:
    """Return an artist's top tracks (up to 10) for a market."""
    res = requests.get(
        f"https://api.spotify.com/v1/artists/{artist_id}/top-tracks",
        headers={"Authorization": f"Bearer {token}"},
        params={"market": market},
        timeout=6,
    )
    if res.status_code != 200:
        return []
    return res.json().get("tracks", [])


def search_movie_album(token: str, movie_name: str, indian_lang: str) -> list:
    headers = {"Authorization": f"Bearer {token}"}
    tracks  = []
    seen    = set()

    for q in [f"{movie_name} soundtrack", f"{movie_name} songs", f"{movie_name} film", movie_name]:
        res = requests.get(
            "https://api.spotify.com/v1/search",
            headers=headers,
            params={"q": q, "type": "album", "limit": 5, "market": "IN"},
            timeout=5,
        )
        if res.status_code != 200:
            continue

        albums = res.json().get("albums", {}).get("items", [])
        for album in albums:
            album_detail = requests.get(
                f"https://api.spotify.com/v1/albums/{album['id']}",
                headers=headers,
                params={"market": "IN"},
                timeout=5,
            ).json()
            album_image = album_detail.get("images", [{}])[0].get("url")

            res2 = requests.get(
                f"https://api.spotify.com/v1/albums/{album['id']}/tracks",
                headers=headers,
                params={"limit": 50, "market": "IN"},
                timeout=5,
            )
            if res2.status_code != 200:
                continue

            for t in res2.json().get("items", []):
                if t.get("uri") and t["uri"] not in seen:
                    seen.add(t["uri"])
                    tracks.append({
                        "title":      t["name"],
                        "artist":     t["artists"][0]["name"],
                        "albumArt":   album_image,
                        "spotifyUrl": t.get("external_urls", {}).get("spotify", ""),
                        "previewUrl": t.get("preview_url"),
                        "uri":        t["uri"],
                        "artistId":   (_artist_ids_of(t) or [""])[0],
                        "artistIds":  _artist_ids_of(t),
                        "explicit":   bool(t.get("explicit", False)),
                    })

        if tracks:
            return tracks

    track_fallback = []
    seen_fb = set()
    for q in [f"{movie_name} songs", f"{movie_name} film songs", f"{movie_name} soundtrack"]:
        res = requests.get(
            "https://api.spotify.com/v1/search",
            headers=headers,
            params={"q": q, "type": "track", "limit": 50, "market": "IN"},
            timeout=5,
        )
        if res.status_code == 200:
            for t in res.json().get("tracks", {}).get("items", []):
                uri = t.get("uri")
                if uri and uri not in seen_fb:
                    seen_fb.add(uri)
                    album_images = t.get("album", {}).get("images", [])
                    track_fallback.append({
                        "title":      t["name"],
                        "artist":     t["artists"][0]["name"],
                        "albumArt":   album_images[0]["url"] if album_images else None,
                        "spotifyUrl": t.get("external_urls", {}).get("spotify", ""),
                        "previewUrl": t.get("preview_url"),
                        "uri":        t["uri"],
                        "artistId":   (_artist_ids_of(t) or [""])[0],
                        "artistIds":  _artist_ids_of(t),
                        "explicit":   bool(t.get("explicit", False)),
                    })
        if len(track_fallback) >= 20:
            break

    return track_fallback


def create_playlist_in_profile(token, user_id, name, description, public=True):
    res = requests.post(
        f"https://api.spotify.com/v1/users/{user_id}/playlists",
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        json={"name": name, "description": description, "public": public},
    )
    res.raise_for_status()
    return res.json()


def add_tracks_to_playlist(token, playlist_id, track_uris):
    for i in range(0, len(track_uris), 100):
        batch = track_uris[i:i + 100]
        res = requests.post(
            f"https://api.spotify.com/v1/playlists/{playlist_id}/tracks",
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
            json={"uris": batch},
        )
        res.raise_for_status()


def verify_playlist_ownership(access_token: str, playlist_id: str, spotify_user_id: str) -> None:
    try:
        res = requests.get(
            f"https://api.spotify.com/v1/playlists/{playlist_id}",
            headers={"Authorization": f"Bearer {access_token}"},
            params={"fields": "owner.id"},
            timeout=5,
        )
    except Exception as exc:
        logger.error(f"[IDOR] Spotify ownership check failed: {exc}")
        raise HTTPException(status_code=503, detail="Could not verify playlist ownership. Try again.")
    if res.status_code != 200:
        raise HTTPException(status_code=400, detail="Playlist not found or not accessible.")
    owner_id = res.json().get("owner", {}).get("id", "")
    if owner_id != spotify_user_id:
        logger.warning(
            f"[IDOR] User {spotify_user_id} attempted to modify playlist {playlist_id} "
            f"owned by {owner_id}"
        )
        raise HTTPException(status_code=403, detail="You do not own this playlist.")


LANGUAGE_TAG_MARKERS = {
    "korean":    ["k-", "korean"],
    "japanese":  ["j-", "japanese", "anime", "city pop", "vocaloid", "shibuya", "enka"],
    "hindi":     ["bollywood", "hindi", "filmi", "desi", "indian", "sufi", "ghazal", "qawwali"],
    "tamil":     ["tamil", "kollywood"],
    "telugu":    ["telugu", "tollywood"],
    "kannada":   ["kannada", "sandalwood"],
    "malayalam": ["malayalam", "mollywood"],
    "punjabi":   ["punjabi", "bhangra"],
    "bengali":   ["bengali", "bangla"],
    "marathi":   ["marathi"],
    "gujarati":  ["gujarati", "garba"],
}

LANGUAGE_SCRIPTS = {
    "korean":    re.compile(r"[\uac00-\ud7af\u1100-\u11ff]"),
    "japanese":  re.compile(r"[\u3040-\u30ff]"),
    "hindi":     re.compile(r"[\u0900-\u097f]"),
    "marathi":   re.compile(r"[\u0900-\u097f]"),
    "tamil":     re.compile(r"[\u0b80-\u0bff]"),
    "telugu":    re.compile(r"[\u0c00-\u0c7f]"),
    "kannada":   re.compile(r"[\u0c80-\u0cff]"),
    "malayalam": re.compile(r"[\u0d00-\u0d7f]"),
    "punjabi":   re.compile(r"[\u0a00-\u0a7f]"),
    "bengali":   re.compile(r"[\u0980-\u09ff]"),
    "gujarati":  re.compile(r"[\u0a80-\u0aff]"),
}

_ARTIST_SPLIT_RE = re.compile(r"\s*(?:,|&|\bfeat\.?|\bft\.?|\bfeaturing\b|\bwith\b|\bx\b|/)\s*", re.IGNORECASE)


def _fold(text: str) -> str:
    decomposed = unicodedata.normalize("NFKD", str(text or "").lower())
    return "".join(ch for ch in decomposed if ch.isalnum())


def _lead_artist(name: str) -> str:
    return _ARTIST_SPLIT_RE.split(name or "")[0].strip() or (name or "")


def _artist_matches(track: dict, wanted: str) -> bool:
    targets = [_fold(p) for p in _ARTIST_SPLIT_RE.split(wanted or "") if _fold(p)]
    names = [_fold(a.get("name", "")) for a in (track.get("artists") or [])]
    return any(t and n and (t in n or n in t) for t in targets for n in names)


def _find_planned_song(token: str, song: dict, market: str) -> Optional[dict]:
    lead = _lead_artist(song["artist"])
    title = song["title"].replace('"', "")
    try:
        hits = search_tracks_by_query(token, f'track:"{title}" artist:"{lead}"', market, limit=5)
    except Exception as exc:
        logger.warning(f"[CURATOR] song lookup failed: {exc}")
        return None
    for t in hits:
        if _artist_matches(t, song["artist"]) and _fold(title)[:12] in _fold(t.get("name", "")):
            return normalise_track(t)
    return None


def _find_artist_track(token: str, artist: str, market: str) -> Optional[dict]:
    try:
        hits = search_tracks_by_query(token, f'artist:"{artist}"', market, limit=6)
    except Exception as exc:
        logger.warning(f"[CURATOR] artist lookup failed: {exc}")
        return None
    matching = [t for t in hits if _artist_matches(t, artist)]
    return normalise_track(random.choice(matching[:4])) if matching else None


def _tags_of(track: dict, genres_by_artist: dict) -> list:
    ids = [a for a in (track.get("artistIds") or [track.get("artistId")]) if a]
    return [tag for a in ids for tag in genres_by_artist.get(a, ())]


def _filter_by_tag_markers(tracks: list, token: str, markers: list, script=None) -> list:
    if not tracks or not markers:
        return tracks
    ids = [a for t in tracks for a in (t.get("artistIds") or [t.get("artistId")]) if a]
    genres_by_artist = fetch_artist_genres_batch(token, ids)
    kept = [
        t for t in tracks
        if (script and script.search(f"{t.get('title', '')} {t.get('artist', '')}"))
        or any(
            tag.startswith(m) or f" {m}" in tag if m.endswith("-") else m in tag
            for tag in _tags_of(t, genres_by_artist) for m in markers
        )
    ]
    if len(kept) < len(tracks):
        logger.info(f"[CURATOR] tag check kept {len(kept)} of {len(tracks)} track(s)")
    return kept


def fetch_planned_tracks(token: str, plan: dict, market: str, needed: int,
                         dedup: DeduplicationState, keep, exclusions,
                         markers: Optional[list] = None, script=None) -> list:
    out: list = []

    def collect(found: list) -> list:
        fresh = []
        for t in _filter_by_tag_markers([t for t in found if t], token, markers or [], script):
            uri, artist = t.get("uri", ""), t.get("artist", "")
            if uri and dedup.is_allowed(uri, artist) and keep(t):
                dedup.register(uri, artist)
                fresh.append(t)
        return apply_exclusions(fresh, token, exclusions)

    def run(fn, items) -> list:
        futures = [_GLOBAL_EXECUTOR.submit(fn, token, item, market) for item in items]
        results = []
        for future in futures:
            try:
                results.append(future.result(timeout=12))
            except Exception:
                results.append(None)
        return results

    songs = plan.get("songs") or []
    missed: list = []
    if songs:
        results = run(_find_planned_song, songs)
        missed = [_lead_artist(s["artist"]) for s, t in zip(songs, results) if not t]
        out.extend(collect(results))
        logger.info(
            f"[CURATOR] planned {len(songs)} song(s), found {len(songs) - len(missed)}, kept {len(out)}"
        )

    if len(out) < needed:
        names = list(dict.fromkeys(a for a in (plan.get("artists") or []) + missed if a))
        names = [a for a in names if a.lower().strip() not in dedup.seen_artists]
        if names:
            out.extend(collect(run(_find_artist_track, names[: (needed - len(out)) * 2 + 4])))

    year = plan.get("year")
    for genre in (plan.get("genres") or []):
        if len(out) >= needed:
            break
        if exclusions and exclusions.matches_query_text(genre):
            continue
        query = f'genre:"{genre}"' + (f" year:{year}" if year else "")
        try:
            hits = [normalise_track(t) for t in search_tracks_by_query(token, query, market, limit=40)]
        except Exception as exc:
            logger.warning(f"[CURATOR] genre lookup failed: {exc}")
            continue
        random.shuffle(hits)
        out.extend(collect(_filter_by_tag_markers(hits, token, [genre])))

    return out


def get_recommendations_for_bucket(
    token:              str,
    mood_profile:       dict,
    lang_cfg:           dict,
    indian_lang:        Optional[str],
    selected_genres:    list,
    selected_languages: list,
    track_count:        int,
    dedup:              DeduplicationState,
    movie_name:         Optional[str] = None,
    exclusions:         Optional[Exclusions] = None,
    plan:               Optional[dict] = None,
) -> list:
    market     = lang_cfg.get("market", "US")
    all_tracks = []
    keep       = make_track_filter(exclusions)
    strict     = bool(exclusions) and exclusions.requires_genre_tags
    lang_key   = LANGUAGE_ALIASES.get((selected_languages or ["English"])[0].lower(), "english")
    markers    = LANGUAGE_TAG_MARKERS.get(lang_key, [])
    script     = LANGUAGE_SCRIPTS.get(lang_key)

    if movie_name and indian_lang:
        raw = search_movie_album(token, movie_name, indian_lang)
        anchors = []
        for t in raw:
            uri    = t.get("uri", "")
            artist = t.get("artist", "")
            if uri and dedup.is_allowed(uri, artist) and keep(t):
                dedup.register(uri, artist)
                anchors.append(t)
        all_tracks = apply_exclusions(anchors, token, exclusions, strict=False)
        if len(all_tracks) >= track_count:
            return all_tracks[:track_count]

    if plan:
        planned = fetch_planned_tracks(
            token, plan, market, track_count - len(all_tracks), dedup, keep, exclusions,
            markers=markers, script=script,
        )
        random.shuffle(planned)
        all_tracks.extend(planned)
        if len(all_tracks) >= track_count:
            return all_tracks[:track_count]

    queries = build_search_queries(
        mood_profile, lang_cfg, indian_lang, selected_genres, selected_languages,
        exclusions=exclusions,
    )
    logger.info(f"[QUERIES] {queries[:6]}")
    curated = len(all_tracks)

    def fetch_query(q: str, offset: int) -> list:
        try:
            raw    = search_tracks_by_query(token, q, market, limit=40, offset=offset)
            result = []
            for t in raw:
                uri    = t.get("uri", "")
                artist = t["artists"][0]["name"] if t.get("artists") else ""
                if uri and dedup.is_allowed(uri, artist) and keep(t):
                    result.append(normalise_track(t))
            return result
        except Exception as exc:
            logger.warning(f"[QUERY_ERR] {q}: {exc}")
            return []

    target_pool = track_count * (8 if strict else 3 if exclusions else 2)
    offsets     = (0, 40, 80) if strict else (0,)

    for offset in offsets:
        needed = track_count - len(all_tracks)
        if needed <= 0 or not queries:
            break
        pool    = []
        futures = {_GLOBAL_EXECUTOR.submit(fetch_query, q, offset): q for q in queries}
        try:
            for future in as_completed(futures, timeout=15):
                for t in future.result():
                    uri    = t.get("uri", "")
                    artist = t.get("artist", "")
                    if uri and dedup.is_allowed(uri, artist) and keep(t):
                        dedup.register(uri, artist)
                        pool.append(t)
                if len(pool) >= target_pool:
                    break
        except FutureTimeoutError:
            logger.warning("[TIMEOUT] get_recommendations_for_bucket timed out after 15s")
        if not pool:
            break
        pool = apply_exclusions(pool, token, exclusions, strict=strict)
        all_tracks.extend(_filter_by_tag_markers(pool, token, markers, script))

    filler = all_tracks[curated:]
    random.shuffle(filler)
    return (all_tracks[:curated] + filler)[:track_count]


def get_recommendations(
    token:              str,
    mood_text:          str,
    mood_profile:       dict,
    track_count:        int,
    selected_languages: list,
    selected_genres:    list,
    film_industry:      Optional[str],
    movie_name:         Optional[str],
    dedup:              DeduplicationState,
    exclusions:         Optional[Exclusions] = None,
) -> list:
    lang_list = selected_languages or ["English"]

    if len(lang_list) == 1:
        lang_name   = lang_list[0]
        lang_cfg    = parse_language(lang_name)
        indian_lang = detect_indian_language(mood_text, film_industry, lang_list)
        if indian_lang and indian_lang not in INDIAN_LANG_QUERY_BANKS:
            indian_lang = None

        return get_recommendations_for_bucket(
            token, mood_profile, lang_cfg, indian_lang,
            selected_genres, lang_list, track_count, dedup, movie_name,
            exclusions=exclusions,
        )

    n         = len(lang_list)
    base      = track_count // n
    remainder = track_count % n
    all_tracks = []

    for i, lang_name in enumerate(lang_list):
        bucket      = base + (1 if i < remainder else 0)
        lang_cfg    = parse_language(lang_name)
        indian_lang = detect_indian_language("", film_industry if i == 0 else None, [lang_name])
        if indian_lang and indian_lang not in INDIAN_LANG_QUERY_BANKS:
            indian_lang = None

        tracks = get_recommendations_for_bucket(
            token, mood_profile, lang_cfg, indian_lang,
            selected_genres, [lang_name], bucket, dedup,
            movie_name if i == 0 else None,
            exclusions=exclusions,
        )
        all_tracks.extend(tracks)

    random.shuffle(all_tracks)
    return all_tracks


# ─────────────────────────────────────────────────────────────────────────────
# Actor / "movie star" search.
# ─────────────────────────────────────────────────────────────────────────────
# Spotify doesn't tag tracks by acting credit. The next best signal is the
# album-title text — "Prabhas hits", "<actor> all time best", "<actor> top
# songs" compilations exist for popular South Indian heroes. Plus a movie
# soundtrack whose album title or track title contains the actor's name
# (much rarer). We probe a few query shapes and dedupe.
def search_actor_songs(token: str, actor_name: str, market: str,
                       limit: int = 25) -> list:
    """Search Spotify for tracks associated with a movie star. Returns a list
    of NORMALISED track dicts (already passed through normalise_track). The
    caller filters / dedups further. Empty list on miss."""
    if not actor_name or not actor_name.strip():
        return []
    name = actor_name.strip()
    queries = [
        f"{name} hits",
        f"{name} songs",
        f"{name} top tracks",
        f"{name} all time best",
        f"{name} super hits",
    ]
    out: list = []
    seen_uris: set = set()
    headers = {"Authorization": f"Bearer {token}"}
    for q in queries:
        try:
            res = requests.get(
                "https://api.spotify.com/v1/search",
                headers=headers,
                params={"q": q, "type": "track", "limit": min(limit, 25), "market": market},
                timeout=6,
            )
            if res.status_code != 200:
                continue
            items = res.json().get("tracks", {}).get("items", [])
            for t in items:
                uri = t.get("uri", "")
                if uri and uri not in seen_uris:
                    seen_uris.add(uri)
                    out.append(normalise_track(t))
        except Exception as exc:
            logger.warning(f"[ACTOR_SEARCH] '{q}' failed: {exc}")
        if len(out) >= limit:
            break
    return out[:limit]


# ─────────────────────────────────────────────────────────────────────────────
# Audio-features batched lookup (for the vibe-exclusion filter).
# ─────────────────────────────────────────────────────────────────────────────
_audio_features_blocked = False


def fetch_audio_features_batch(token: str, track_ids: list) -> dict:
    """Batch-fetch `/v1/audio-features` for up to 100 IDs at a time. Returns
    {track_id: features_dict}. Tracks Spotify has no analysis for map to {}."""
    global _audio_features_blocked
    out: dict = {}
    if not track_ids or _audio_features_blocked:
        return out
    headers = {"Authorization": f"Bearer {token}"}
    seen: set = set()
    deduped = [t for t in track_ids if t and not (t in seen or seen.add(t))]
    for i in range(0, len(deduped), 100):
        chunk = deduped[i:i + 100]
        try:
            res = requests.get(
                "https://api.spotify.com/v1/audio-features",
                headers=headers,
                params={"ids": ",".join(chunk)},
                timeout=8,
            )
            if res.status_code == 403:
                _audio_features_blocked = True
                logger.warning("[AUDIO_FEATURES] HTTP 403, endpoint unavailable for this app")
                break
            if res.status_code != 200:
                logger.warning(f"[AUDIO_FEATURES] HTTP {res.status_code}")
                continue
            for af in (res.json() or {}).get("audio_features", []) or []:
                if af and af.get("id"):
                    out[af["id"]] = af
        except Exception as exc:
            logger.warning(f"[AUDIO_FEATURES] fetch error: {exc}")
    return out


def filter_tracks_by_vibe(tracks: list, token: str, vibe_filters: list) -> list:
    """Drop tracks whose audio-features fall into any of the supplied vibe
    drop-ranges. Safe to call with no vibe filters (returns tracks unchanged)
    or no tracks (returns empty)."""
    from exclusions import feature_in_drop_range
    if not vibe_filters or not tracks:
        return tracks

    ids: list = []
    for t in tracks:
        uri = t.get("uri", "") or ""
        if uri.startswith("spotify:track:"):
            ids.append(uri.split(":", 2)[2])
    if not ids:
        return tracks

    features_by_id = fetch_audio_features_batch(token, ids)
    if not features_by_id:
        return tracks

    kept = []
    dropped = 0
    for t, tid in zip(tracks, ids):
        af = features_by_id.get(tid) or {}
        if feature_in_drop_range(af, vibe_filters):
            dropped += 1
            continue
        kept.append(t)
    if dropped:
        logger.info(f"[VIBE] audio-feature filter dropped {dropped} track(s)")
    return kept


# ─────────────────────────────────────────────────────────────────────────────
# Film-vs-indie classification for Indian playlists.
# ─────────────────────────────────────────────────────────────────────────────
# A track is "film" if its primary artist's Spotify genre tags hit a film-
# music tag (filmi / bollywood / tollywood / kollywood / sandalwood / mollywood
# / hindi film …) — these are the tags Spotify itself uses to mark playback
# acts that work primarily as movie playback artists. Untagged artists go to
# indie (conservative — better to mix in than misclassify as film).
_FILM_GENRE_TOKENS = {
    "filmi", "indian film", "hindi film", "tamil film", "telugu film",
    "kannada film", "malayalam film", "punjabi film",
    "bollywood", "tollywood", "kollywood", "sandalwood", "mollywood",
    "modern bollywood", "classic bollywood",
}


def classify_film_vs_indie(tracks: list, token: str) -> tuple[list, list]:
    """Split tracks into (film_tracks, indie_tracks) by primary artist genre."""
    if not tracks:
        return [], []
    artist_ids = [t.get("artistId", "") for t in tracks if t.get("artistId")]
    genres_by_artist = fetch_artist_genres_batch(token, artist_ids) if artist_ids else {}

    film, indie = [], []
    for t in tracks:
        aid = t.get("artistId", "")
        tags = genres_by_artist.get(aid, ())
        is_film = any(any(tok in tag for tok in _FILM_GENRE_TOKENS) for tag in tags)
        if is_film:
            film.append(t)
        else:
            indie.append(t)
    return film, indie