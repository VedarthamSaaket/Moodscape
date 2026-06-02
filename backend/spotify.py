import random
from typing import Optional
from concurrent.futures import as_completed, TimeoutError as FutureTimeoutError

import requests
from fastapi import HTTPException

from config import logger
from mood_engine import (
    build_search_queries, detect_indian_language, parse_language,
    DeduplicationState, _GLOBAL_EXECUTOR,
)
from query_banks import INDIAN_LANG_QUERY_BANKS


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
    return {
        "title":      t["name"],
        "artist":     t["artists"][0]["name"] if t.get("artists") else "Unknown",
        "albumArt":   album_images[0]["url"] if album_images else None,
        "spotifyUrl": t.get("external_urls", {}).get("spotify", ""),
        "previewUrl": t.get("preview_url"),
        "uri":        t.get("uri", ""),
    }


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
) -> list:
    market     = lang_cfg.get("market", "US")
    all_tracks = []

    if movie_name and indian_lang:
        raw = search_movie_album(token, movie_name, indian_lang)
        for t in raw:
            uri    = t.get("uri", "")
            artist = t.get("artist", "")
            if uri and dedup.is_allowed(uri, artist):
                dedup.register(uri, artist)
                all_tracks.append(t)
        if len(all_tracks) >= track_count:
            return all_tracks[:track_count]

    queries = build_search_queries(
        mood_profile, lang_cfg, indian_lang, selected_genres, selected_languages
    )
    logger.info(f"[QUERIES] {queries[:6]}")

    def fetch_query(q: str) -> list:
        try:
            raw    = search_tracks_by_query(token, q, market, limit=40)
            result = []
            for t in raw:
                uri    = t.get("uri", "")
                artist = t["artists"][0]["name"] if t.get("artists") else ""
                if uri and dedup.is_allowed(uri, artist):
                    result.append(normalise_track(t))
            return result
        except Exception as exc:
            logger.warning(f"[QUERY_ERR] {q}: {exc}")
            return []

    futures = {_GLOBAL_EXECUTOR.submit(fetch_query, q): q for q in queries}
    try:
        for future in as_completed(futures, timeout=15):
            for t in future.result():
                uri    = t.get("uri", "")
                artist = t.get("artist", "")
                if uri and dedup.is_allowed(uri, artist):
                    dedup.register(uri, artist)
                    all_tracks.append(t)
            if len(all_tracks) >= track_count * 2:
                break
    except FutureTimeoutError:
        logger.warning("[TIMEOUT] get_recommendations_for_bucket timed out after 15s")

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
        )
        all_tracks.extend(tracks)

    random.shuffle(all_tracks)
    return all_tracks