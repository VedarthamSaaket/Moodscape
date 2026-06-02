import re
import requests
from concurrent.futures import as_completed, TimeoutError as FutureTimeoutError

from fastapi import APIRouter, HTTPException, Request

from security import require_session_token, validate_spotify_token, sanitise_user_text, sanitise_language, sanitise_genre, sanitise_movie, sanitise_search_token
from config import logger, LANGUAGE_ALIASES, LANGUAGE_CONFIG, PLAYLIST_RANGES, resolve_track_count
from mood_engine import (
    parse_mood_profile, detect_indian_language, build_search_queries,
    DeduplicationState, _GLOBAL_EXECUTOR,
)
from spotify import (
    get_spotify_user_profile, normalise_track, search_tracks_by_query,
    search_movie_album, create_playlist_in_profile, add_tracks_to_playlist,
    verify_playlist_ownership, get_recommendations,
)
from models import PlaylistRequest, AddTracksRequest, SimilarTracksRequest

router = APIRouter()


@router.post("/api/create-playlist")
def create_playlist(data: PlaylistRequest, request: Request):
    require_session_token(request)

    auth_header = request.headers.get("Authorization")
    if not auth_header or not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid Spotify token")

    raw_token    = auth_header.split(" ", 1)[1]
    access_token = validate_spotify_token(raw_token)

    mood_text = sanitise_user_text(data.moodText.strip(), "moodText", max_len=500)
    intent    = sanitise_user_text(data.playlistIntent.strip(), "playlistIntent", max_len=200) if data.playlistIntent else None

    selected_langs = [sanitise_language(l) for l in (data.selectedLanguages or ["English"])]
    selected_genres = [sanitise_genre(g) for g in (data.selectedGenres or [])]

    selected_movies = data.selectedMovies or ([data.movieName] if data.movieName else [])
    split_movies    = []
    for m in selected_movies:
        parts = re.split(r',|\band\b', m, flags=re.IGNORECASE)
        split_movies.extend([sanitise_movie(p.strip()) for p in parts if p.strip()])
    selected_movies = split_movies

    mood_profile = parse_mood_profile(mood_text, intent)
    logger.info(
        f"[MOOD] {mood_profile['emotion']} | energy={mood_profile['energy']} | intent={mood_profile['intent']}"
    )

    range_key   = data.trackCountRange if data.trackCountRange in PLAYLIST_RANGES else "15-30"
    track_count = resolve_track_count(range_key)

    logger.info(
        f"[REQ] count={track_count} langs={selected_langs} genres={selected_genres} movies={selected_movies}"
    )

    try:
        user_profile = get_spotify_user_profile(access_token)
        user_id      = user_profile["id"]

        dedup2     = DeduplicationState()
        all_tracks = []
        track_uris = []

        if selected_movies:
            for mv in selected_movies:
                indian_lang = detect_indian_language(mood_text, data.filmIndustry, selected_langs)
                raw = search_movie_album(access_token, mv, indian_lang or "hindi")
                for t in raw:
                    uri    = t.get("uri", "")
                    artist = t.get("artist", "")
                    if uri and dedup2.is_allowed(uri, artist):
                        dedup2.register(uri, artist)
                        track_uris.append(uri)
                        all_tracks.append({k: v for k, v in t.items() if k != "uri"})

            fill_count = max(0, track_count - len(all_tracks))
            if fill_count > 0:
                fill = get_recommendations(
                    access_token, mood_text, mood_profile, fill_count,
                    selected_langs, selected_genres, data.filmIndustry,
                    None, dedup2,
                )
                for t in fill:
                    uri = t.pop("uri", "")
                    if uri:
                        track_uris.append(uri)
                        all_tracks.append(t)
        else:
            tracks = get_recommendations(
                access_token, mood_text, mood_profile, track_count,
                selected_langs, selected_genres, data.filmIndustry,
                None, DeduplicationState(),
            )
            for t in tracks:
                uri = t.pop("uri", "")
                if uri:
                    track_uris.append(uri)
                    all_tracks.append(t)

        if not all_tracks:
            raise HTTPException(
                status_code=500,
                detail="Couldn't find tracks for this mood. Try describing it differently.",
            )

        desc_parts = [f"Mood: {mood_text[:60]}"]
        if intent:
            desc_parts.append(f"Intent: {intent[:60]}")
        desc = " | ".join(desc_parts)

        playlist_obj = create_playlist_in_profile(
            access_token, user_id, data.playlistName or "Vaedarth AI Playlist", desc
        )
        playlist_id  = playlist_obj["id"]
        playlist_url = playlist_obj["external_urls"]["spotify"]

        add_tracks_to_playlist(access_token, playlist_id, track_uris)

        return {
            "playlist_url":  playlist_url,
            "playlist_id":   playlist_id,
            "playlist_name": data.playlistName or "Vaedarth AI Playlist",
            "tracks":        all_tracks,
        }

    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/api/add-tracks")
def add_tracks_endpoint(data: AddTracksRequest, request: Request):
    require_session_token(request)

    auth_header = request.headers.get("Authorization")
    if not auth_header or not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid Spotify token")
    raw_token    = auth_header.split(" ", 1)[1]
    access_token = validate_spotify_token(raw_token)

    user_profile = get_spotify_user_profile(access_token)
    verify_playlist_ownership(access_token, data.playlist_id, user_profile["id"])

    try:
        add_tracks_to_playlist(access_token, data.playlist_id, data.uris)
        return {"message": f"Added {len(data.uris)} track(s)."}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/api/similar-tracks")
def similar_tracks(data: SimilarTracksRequest, request: Request):
    require_session_token(request)

    auth_header = request.headers.get("Authorization")
    if not auth_header or not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid Spotify token")
    raw_token    = auth_header.split(" ", 1)[1]
    access_token = validate_spotify_token(raw_token)
    headers      = {"Authorization": f"Bearer {access_token}"}

    user_profile = get_spotify_user_profile(access_token)
    verify_playlist_ownership(access_token, data.playlist_id, user_profile["id"])

    safe_language = sanitise_search_token(data.language or "english", "language")
    safe_genre    = sanitise_search_token(data.genre or "", "genre")
    safe_artist   = sanitise_search_token(data.track_artist, "track_artist")
    safe_mood     = sanitise_user_text(data.mood_text or "", "mood_text", max_len=200) if data.mood_text else ""
    safe_intent   = sanitise_user_text(data.playlist_intent or "", "playlist_intent", max_len=200) if data.playlist_intent else None

    lang_key     = LANGUAGE_ALIASES.get(safe_language.lower(), "english")
    lang_cfg     = LANGUAGE_CONFIG.get(lang_key, LANGUAGE_CONFIG["english"])
    market       = lang_cfg.get("market", "US")

    mood_profile = parse_mood_profile(safe_mood, safe_intent)
    dedup        = DeduplicationState()

    if data.ignored_uris:
        for uri in data.ignored_uris:
            dedup.seen_uris.add(uri)

    result_tracks = []

    res = requests.get(
        "https://api.spotify.com/v1/search",
        headers=headers,
        params={"q": f"artist:{safe_artist}", "type": "track", "limit": 20, "market": market},
        timeout=8,
    )
    if res.status_code == 200:
        items = res.json().get("tracks", {}).get("items", [])
        count = 0
        for t in items:
            if t["name"].lower() == data.track_title.lower():
                continue
            uri    = t.get("uri", "")
            artist = t["artists"][0]["name"] if t.get("artists") else ""
            if uri and dedup.is_allowed(uri, artist):
                dedup.register(uri, artist)
                result_tracks.append(normalise_track(t))
                count += 1
            if count >= 4:
                break

    indian_lang = detect_indian_language(safe_language, None, [safe_language])
    queries     = build_search_queries(
        mood_profile, lang_cfg, indian_lang,
        [safe_genre] if safe_genre else [],
        [safe_language],
    )
    queries.insert(0, f"similar to {safe_artist} {safe_genre}")

    def fetch_fill(q: str) -> list:
        try:
            raw = search_tracks_by_query(access_token, q, market, limit=20)
            out = []
            for t in raw:
                if t["name"].lower() == data.track_title.lower():
                    continue
                uri    = t.get("uri", "")
                artist = t["artists"][0]["name"] if t.get("artists") else ""
                if uri and dedup.is_allowed(uri, artist):
                    out.append(normalise_track(t))
            return out
        except Exception as exc:
            logger.warning(f"[SIMILAR_ERR] {exc}")
            return []

    fill_futures = [_GLOBAL_EXECUTOR.submit(fetch_fill, q) for q in queries[:5]]
    try:
        for future in as_completed(fill_futures, timeout=15):
            for t in future.result():
                uri    = t.get("uri", "")
                artist = t.get("artist", "")
                if uri and dedup.is_allowed(uri, artist) and len(result_tracks) < 20:
                    dedup.register(uri, artist)
                    result_tracks.append(t)
            if len(result_tracks) >= 20:
                break
    except FutureTimeoutError:
        logger.warning("[TIMEOUT] similar_tracks timed out after 15s")

    if not result_tracks:
        raise HTTPException(status_code=404, detail="No similar tracks found")

    uris_to_add = [t["uri"] for t in result_tracks if t.get("uri")]
    add_tracks_to_playlist(access_token, data.playlist_id, uris_to_add)

    return {
        "tracks": [
            {
                "title":      t["title"],
                "artist":     t["artist"],
                "albumArt":   t["albumArt"],
                "spotifyUrl": t["spotifyUrl"],
            }
            for t in result_tracks
        ]
    }