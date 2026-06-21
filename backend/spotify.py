import time
import base64
import random
import threading
from typing import Optional
from concurrent.futures import as_completed, TimeoutError as FutureTimeoutError

import requests
from fastapi import HTTPException

from config import logger, SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET
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


def normalise_track(t: dict) -> dict:
    album_images = t.get("album", {}).get("images", []) if "album" in t else []
    # Stash the primary artist id so a later batched `/v1/artists` call can
    # fetch genre tags for the dynamic exclusion filter. Frontend ignores
    # unknown fields.
    artist_id = ""
    if t.get("artists") and isinstance(t["artists"], list) and t["artists"]:
        artist_id = t["artists"][0].get("id", "") or ""
    return {
        "title":      t["name"],
        "artist":     t["artists"][0]["name"] if t.get("artists") else "Unknown",
        "albumArt":   album_images[0]["url"] if album_images else None,
        "spotifyUrl": t.get("external_urls", {}).get("spotify", ""),
        "previewUrl": t.get("preview_url"),
        "uri":        t.get("uri", ""),
        "artistId":   artist_id,
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


def fetch_artist_genres_batch(token: str, artist_ids: list) -> dict[str, tuple]:
    """
    Batch-fetch Spotify's `genres` array for each artist id. Returns
    {artist_id: (genre_tag, ...)}. Empty tuple for artists Spotify has no
    genre tags for. Chunked at 50 ids per request (Spotify's hard max for the
    `/v1/artists?ids=` endpoint). Caches results in-process.
    """
    out: dict[str, tuple] = {}
    if not artist_ids:
        return out

    to_fetch: list = []
    with _artist_genre_lock:
        for aid in artist_ids:
            if not aid:
                continue
            cached = _artist_genre_cache.get(aid)
            if cached is not None:
                out[aid] = cached
            else:
                to_fetch.append(aid)

    if not to_fetch:
        return out

    seen: set = set()
    deduped = [a for a in to_fetch if not (a in seen or seen.add(a))]

    for i in range(0, len(deduped), 50):
        chunk = deduped[i:i + 50]
        try:
            res = requests.get(
                "https://api.spotify.com/v1/artists",
                headers={"Authorization": f"Bearer {token}"},
                params={"ids": ",".join(chunk)},
                timeout=8,
            )
            if res.status_code != 200:
                logger.warning(f"[ARTIST_GENRES] HTTP {res.status_code}: {res.text[:120]}")
                # Cache empty for this chunk so we don't re-hit a failing call
                # in a loop; the worst case is we filter less for these ids.
                with _artist_genre_lock:
                    for aid in chunk:
                        _artist_genre_cache.setdefault(aid, ())
                        out.setdefault(aid, ())
                continue
            data = res.json() or {}
            for art in (data.get("artists") or []):
                if not art:
                    continue
                aid = art.get("id", "")
                tags = tuple(g.lower() for g in (art.get("genres") or []))
                if aid:
                    with _artist_genre_lock:
                        _artist_genre_cache[aid] = tags
                    out[aid] = tags
        except Exception as exc:
            logger.warning(f"[ARTIST_GENRES] fetch error: {exc}")
            with _artist_genre_lock:
                for aid in chunk:
                    _artist_genre_cache.setdefault(aid, ())
                    out.setdefault(aid, ())

    return out


def _filter_by_artist_genres(tracks: list, token: str, exclusions) -> list:
    """
    Drop any track whose primary artist's Spotify genre tags match a user
    dislike keyword. This is the DYNAMIC translation step: we don't need our
    own genre dictionary because Spotify already tags artists with the
    canonical genre vocabulary they actually belong to.
    """
    if not exclusions or not tracks:
        return tracks

    artist_ids = [t.get("artistId", "") for t in tracks if t.get("artistId")]
    if not artist_ids:
        return tracks

    genres_by_artist = fetch_artist_genres_batch(token, artist_ids)

    kept = []
    dropped = 0
    for t in tracks:
        aid = t.get("artistId", "")
        tags = genres_by_artist.get(aid, ())
        if tags and exclusions.matches_any_genre_tag(tags):
            dropped += 1
            continue
        kept.append(t)
    if dropped:
        logger.info(f"[DISLIKE] artist-genre filter dropped {dropped} track(s)")
    return kept


def search_tracks_by_query(token: str, query: str, market: str, limit: int = 30) -> list:
    res = requests.get(
        "https://api.spotify.com/v1/search",
        headers={"Authorization": f"Bearer {token}"},
        params={"q": query, "type": "track", "limit": min(limit, 50), "market": market},
        timeout=6,
    )
    if res.status_code == 200:
        return res.json().get("tracks", {}).get("items", [])
    return []


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
) -> list:
    market     = lang_cfg.get("market", "US")
    all_tracks = []
    keep       = make_track_filter(exclusions)          # predicate: True = keep

    if movie_name and indian_lang:
        raw = search_movie_album(token, movie_name, indian_lang)
        for t in raw:
            uri    = t.get("uri", "")
            artist = t.get("artist", "")
            if uri and dedup.is_allowed(uri, artist) and keep(t):
                dedup.register(uri, artist)
                all_tracks.append(t)
        if len(all_tracks) >= track_count:
            # Even movie-soundtrack tracks get the artist-genre dynamic filter,
            # so a user who excludes a language still has it honoured here.
            all_tracks = _filter_by_artist_genres(all_tracks, token, exclusions)
            return all_tracks[:track_count]

    queries = build_search_queries(
        mood_profile, lang_cfg, indian_lang, selected_genres, selected_languages,
        exclusions=exclusions,
    )
    logger.info(f"[QUERIES] {queries[:6]}")

    def fetch_query(q: str) -> list:
        try:
            raw    = search_tracks_by_query(token, q, market, limit=40)
            result = []
            for t in raw:
                uri    = t.get("uri", "")
                artist = t["artists"][0]["name"] if t.get("artists") else ""
                # Cheap metadata text filter at fetch time. The richer artist-
                # genre-tag filter runs once at the end of the bucket on the
                # accumulated candidate pool (one batched API call).
                if uri and dedup.is_allowed(uri, artist) and keep(t):
                    result.append(normalise_track(t))
            return result
        except Exception as exc:
            logger.warning(f"[QUERY_ERR] {q}: {exc}")
            return []

    futures = {_GLOBAL_EXECUTOR.submit(fetch_query, q): q for q in queries}
    # When exclusions are active we over-fetch so the artist-genre drop step
    # at the end still leaves enough tracks to hit `track_count`.
    target_pool = track_count * (3 if exclusions else 2)
    try:
        for future in as_completed(futures, timeout=15):
            for t in future.result():
                uri    = t.get("uri", "")
                artist = t.get("artist", "")
                if uri and dedup.is_allowed(uri, artist) and keep(t):
                    dedup.register(uri, artist)
                    all_tracks.append(t)
            if len(all_tracks) >= target_pool:
                break
    except FutureTimeoutError:
        logger.warning("[TIMEOUT] get_recommendations_for_bucket timed out after 15s")

    # Dynamic translation step — Spotify's own artist-genre tags do the work
    # of mapping a user's typed exclusion ("rap", "hindi", "k-pop") to the
    # tracks that actually belong to that genre, without us maintaining any
    # canonical-vocabulary table on our side.
    all_tracks = _filter_by_artist_genres(all_tracks, token, exclusions)

    # Audio-feature vibe filter (sad/happy/energetic/etc). One batched
    # `/v1/audio-features` call per bucket; no-op when no vibes triggered.
    if exclusions and getattr(exclusions, "vibe_filters", None):
        all_tracks = filter_tracks_by_vibe(all_tracks, token, exclusions.vibe_filters)

    random.shuffle(all_tracks)
    return all_tracks[:track_count]


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
def fetch_audio_features_batch(token: str, track_ids: list) -> dict:
    """Batch-fetch `/v1/audio-features` for up to 100 IDs at a time. Returns
    {track_id: features_dict}. Tracks Spotify has no analysis for map to {}."""
    out: dict = {}
    if not track_ids:
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