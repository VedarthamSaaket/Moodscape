import re
import requests
from itertools import zip_longest
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
    verify_playlist_ownership, get_recommendations, get_app_token,
    search_artist, get_artist_top_tracks,
)
from models import PlaylistRequest, AddTracksRequest, SimilarTracksRequest, SuggestionsRequest

router = APIRouter()


@router.post("/api/create-playlist")
def create_playlist(data: PlaylistRequest, request: Request):
    require_session_token(request, lax=True)

    auth_header = request.headers.get("Authorization")
    if not auth_header or not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid Spotify token")

    raw_token    = auth_header.split(" ", 1)[1]
    access_token = validate_spotify_token(raw_token)

    mood_text = sanitise_user_text(data.moodText.strip(), "moodText", max_len=500)
    intent    = sanitise_user_text(data.playlistIntent.strip(), "playlistIntent", max_len=200) if data.playlistIntent else None

    # ─── Style-quiz archetype influence ──────────────────────────────────────
    # If the user has taken the Quiz and chose "Use my style", the frontend
    # forwards their archetype + vibe prompt. Fold it into the mood text so
    # the same downstream pipeline (mood parsing, query generation, genre
    # search) sees the aesthetic signal. Keeps a single source of truth.
    style_vibe      = sanitise_user_text(
        (data.styleVibePrompt or "").strip(), "styleVibePrompt", max_len=400
    ) if data.styleVibePrompt else ""
    style_arch_name = sanitise_user_text(
        (data.styleArchetypeName or "").strip(), "styleArchetypeName", max_len=80
    ) if data.styleArchetypeName else ""

    if style_vibe:
        # Prefix the archetype description so HF zero-shot + every query
        # builder picks up the aesthetic, while the user's own words still
        # lead the prompt.
        prefix = (
            f"In a {style_arch_name} aesthetic, {style_vibe} "
            if style_arch_name else f"{style_vibe} "
        )
        mood_text = (prefix + mood_text).strip()
        # Cap again in case the merged string runs long.
        mood_text = mood_text[:600]
        logger.info(f"[STYLE] archetype={style_arch_name or 'n/a'}, vibe folded into mood")

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

        # ── Pinned songs from the post-quiz suggestions ──────────────────────
        # Added FIRST and verbatim, regardless of the mood/genre/language menu.
        pinned_clean = []
        seen_uris    = set(track_uris)
        for u in (data.pinnedUris or []):
            if isinstance(u, str) and u.startswith("spotify:track:") and u not in seen_uris:
                seen_uris.add(u)
                pinned_clean.append(u)
        if pinned_clean:
            track_uris = pinned_clean + track_uris
            logger.info(f"[PINNED] prepending {len(pinned_clean)} pinned track(s) from quiz")

        if not all_tracks and not pinned_clean:
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
    require_session_token(request, lax=True)

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
    require_session_token(request, lax=True)

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


@router.post("/api/quiz/suggestions")
def quiz_suggestions(data: SuggestionsRequest, request: Request):
    """Return a blended set of individual song suggestions shaped by BOTH the
    user's quiz archetype AND their named favourite artist (if any). Uses an
    app-level Spotify token, so this works on the quiz result screen even before
    the user has connected their own Spotify account. Does NOT create a playlist.

    The blend, when an artist is named, is three strands woven together:
      1. a few of the artist's own top tracks,
      2. tracks in the artist's sonic theme (their Spotify genres + the mood),
      3. archetype/quiz-driven recommendations.
    With no artist, the whole list is quiz-archetype driven.
    """
    require_session_token(request, lax=True)

    token = get_app_token()

    vibe      = sanitise_user_text((data.vibePrompt or "").strip(), "vibePrompt", max_len=400) if data.vibePrompt else ""
    arch_name = sanitise_user_text((data.archetypeName or "").strip(), "archetypeName", max_len=80) if data.archetypeName else ""
    personal  = sanitise_search_token(data.personalSeed or "", "personalSeed", max_len=120)
    # Spotify's search syntax treats `-` (with surrounding whitespace) as a
    # NOT operator, so a user typing "One and only - Adele" was getting
    # tracks that contain "One and only" but EXCLUDE Adele — i.e. the
    # opposite of intent. Normalise common dash separators (hyphen, en-dash,
    # em-dash) to a single space before the query is sent.
    if personal:
        personal = re.sub(r"\s+[-–—]\s+", " ", personal)
        personal = re.sub(r"\s{2,}", " ", personal).strip()

    mood_text = vibe or arch_name or "chill"
    if arch_name and arch_name.lower() not in mood_text.lower():
        mood_text = f"In a {arch_name} aesthetic, {mood_text}"
    mood_text = mood_text[:500]

    selected_langs  = [sanitise_language(l) for l in (data.languageSeed or ["English"])][:5]
    selected_genres = [sanitise_genre(g) for g in (data.genreSeed or [])][:5]
    count           = max(1, min(data.count or 10, 12))

    # Archetype-specific Spotify search queries from quizData.js — sanitised
    # and capped. These run before the artist/theme/quiz strands below so the
    # final blend is anchored on hand-curated sonic territory.
    raw_seeds = data.searchSeeds or []
    archetype_seeds = []
    for s in raw_seeds[:6]:
        if not isinstance(s, str):
            continue
        clean = sanitise_search_token(s.strip(), "archetypeSeed", max_len=120)
        if clean:
            archetype_seeds.append(clean)

    lang_key = LANGUAGE_ALIASES.get((selected_langs[0] if selected_langs else "english").lower(), "english")
    market   = LANGUAGE_CONFIG.get(lang_key, LANGUAGE_CONFIG["english"]).get("market", "US")

    mood_profile = parse_mood_profile(mood_text, None)
    dedup        = DeduplicationState()

    archetype_tracks = []   # 0b. archetype-seed hits (curated sonic territory)
    artist_tracks    = []   # 1.  the artist's own songs
    theme_tracks     = []   # 2.  songs in the artist's sonic theme
    artist_genres    = []

    # 0. The exact track the user named, guaranteed into the list (deduped so the
    #    artist/theme/quiz strands below won't repeat it). When they typed an
    #    artist rather than a song this usually no-ops and the artist strand
    #    carries it instead.
    seed_tracks = []
    if personal:
        try:
            for t in search_tracks_by_query(token, personal, market, limit=1):
                uri = t.get("uri", "")
                a   = t["artists"][0]["name"] if t.get("artists") else ""
                if uri and dedup.is_allowed(uri, a):
                    dedup.register(uri, a)
                    seed_tracks.append(normalise_track(t))
        except Exception as exc:
            logger.warning(f"[SUGGEST] seed track search failed: {exc}")

    # 0b. Archetype-curated search seeds. Each seed is a hand-tuned Spotify
    #     query that reliably surfaces the archetype's sonic core (see
    #     `searchSeeds` in quizData.js). Running these BEFORE the generic
    #     mood/genre recommendation path is what makes the result-page
    #     samples spot-on for a niche archetype like Dark Academia, where
    #     the generic HF zero-shot → mood-bank route would land on a much
    #     broader "sad indie" cloud.
    if archetype_seeds:
        per_seed = max(1, min(2, (count // max(1, len(archetype_seeds))) + 1))
        for q in archetype_seeds:
            if len(archetype_tracks) >= count:
                break
            try:
                hits = search_tracks_by_query(token, q, market, limit=12)
            except Exception as exc:
                logger.warning(f"[SUGGEST] archetype seed '{q}' failed: {exc}")
                continue
            added_for_seed = 0
            for t in hits:
                uri = t.get("uri", "")
                a   = t["artists"][0]["name"] if t.get("artists") else ""
                if uri and dedup.is_allowed(uri, a):
                    dedup.register(uri, a)
                    archetype_tracks.append(normalise_track(t))
                    added_for_seed += 1
                if added_for_seed >= per_seed:
                    break

    if personal:
        # ── 1. The artist's own top tracks ──────────────────────────────────
        try:
            artist = search_artist(token, personal, market)
            if artist:
                artist_genres = [g for g in (artist.get("genres") or []) if g][:3]
                want_artist   = min(4, max(2, count // 3))
                for t in get_artist_top_tracks(token, artist["id"], market):
                    uri = t.get("uri", "")
                    a   = t["artists"][0]["name"] if t.get("artists") else ""
                    if uri and dedup.is_allowed(uri, a):
                        dedup.register(uri, a)
                        artist_tracks.append(normalise_track(t))
                    if len(artist_tracks) >= want_artist:
                        break
            if not artist_tracks:
                # Fallback: plain track search for whatever they typed.
                for t in search_tracks_by_query(token, personal, market, limit=10):
                    uri = t.get("uri", "")
                    a   = t["artists"][0]["name"] if t.get("artists") else ""
                    if uri and dedup.is_allowed(uri, a):
                        dedup.register(uri, a)
                        artist_tracks.append(normalise_track(t))
                    if len(artist_tracks) >= 3:
                        break
        except Exception as exc:
            logger.warning(f"[SUGGEST] artist lookup failed: {exc}")

        # ── 2. Tracks in the artist's theme (their genres + the quiz mood) ───
        emotion = (mood_profile.get("emotion") or "").strip()
        for g in artist_genres:
            if len(artist_tracks) + len(theme_tracks) >= count:
                break
            q = sanitise_search_token(f"{g} {emotion}".strip(), "themeQuery", max_len=120)
            try:
                for t in search_tracks_by_query(token, q, market, limit=15):
                    uri = t.get("uri", "")
                    a   = t["artists"][0]["name"] if t.get("artists") else ""
                    if uri and dedup.is_allowed(uri, a):
                        dedup.register(uri, a)
                        theme_tracks.append(normalise_track(t))
                    if len(theme_tracks) >= 3:
                        break
            except Exception as exc:
                logger.warning(f"[SUGGEST] theme search '{q}' failed: {exc}")

    # ── 3. Archetype / quiz-driven recommendations fill the rest ────────────
    remaining = max(
        0,
        count - len(seed_tracks) - len(archetype_tracks)
              - len(artist_tracks) - len(theme_tracks),
    )
    quiz_tracks = []
    if remaining > 0:
        try:
            quiz_tracks = get_recommendations(
                token, mood_text, mood_profile, remaining,
                selected_langs, selected_genres, None, None, dedup,
            )
        except Exception as exc:
            logger.warning(f"[SUGGEST] recommendations failed: {exc}")

    # Weave the strands round-robin so the list reads as a genuine blend
    # rather than stacked blocks. The user's named track always leads, then
    # one from each strand: archetype seeds (curated), artist tracks (their
    # named favourite), theme tracks (artist genre + mood), and the generic
    # quiz/mood fill. Archetype seeds sit first in each rotation so the
    # samples are recognisably the archetype's sound from the top of the list.
    blended = (seed_tracks + [
        t for group in zip_longest(archetype_tracks, artist_tracks, theme_tracks, quiz_tracks)
        for t in group if t
    ])[:count]

    if not blended:
        raise HTTPException(status_code=404, detail="Couldn't find song suggestions right now. Try again.")

    return {"tracks": blended}