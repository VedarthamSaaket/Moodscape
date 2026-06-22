import random
import re
import requests
from itertools import zip_longest
from concurrent.futures import as_completed, TimeoutError as FutureTimeoutError

from fastapi import APIRouter, HTTPException, Request

from security import require_session_token, sanitise_user_text, sanitise_language, sanitise_genre, sanitise_movie, sanitise_search_token
from config import logger, LANGUAGE_ALIASES, LANGUAGE_CONFIG, PLAYLIST_RANGES, resolve_track_count
from mood_engine import (
    parse_mood_profile, detect_indian_language, build_search_queries,
    DeduplicationState, _GLOBAL_EXECUTOR,
)
from spotify import (
    normalise_track, search_tracks_by_query, search_movie_album,
    get_recommendations, get_recommendations_for_bucket, get_app_token,
    search_artist, get_artist_top_tracks, search_actor_songs,
    classify_film_vs_indie, filter_tracks_by_vibe,
)
from mood_engine import parse_language
from curator import (
    create_curator_playlist, add_tracks_curator, remove_tracks_curator,
    upload_cover_curator,
)
from models import (
    PlaylistRequest, SimilarTracksRequest, SuggestionsRequest, RemoveTrackRequest,
)
from exclusions import build_exclusions
from sound_seeds import detect_sound_seeds

router = APIRouter()


def _lang_display_for(canonical_key: str, selected_langs: list) -> str:
    """Pick the matching display-form language name from `selected_langs`
    for a canonical lower-case key (e.g. "telugu" → "Telugu"). Falls back
    to title-casing the key if not found in the list."""
    from config import LANGUAGE_ALIASES
    for l in selected_langs:
        if LANGUAGE_ALIASES.get(l.lower(), l.lower()) == canonical_key:
            return l
    return canonical_key.title()


def _fetch_indian_film_indie_mix(
    token, mood_text, mood_profile, lang_cfg, indian_lang,
    selected_genres, lang_list, bucket_count, dedup, exclusions,
    ratio_film: float = 0.55,
):
    """Return ~ratio_film film-tagged tracks + (1-ratio_film) indie tracks
    for one Indian-language bucket. Over-fetches the pool, splits via
    Spotify artist genre tags (filmi/bollywood/tollywood/etc), and trims to
    `bucket_count`. Soft target — if one side of the split is thin, pad with
    the other rather than leaving holes (user explicitly asked for soft)."""
    target_film  = int(round(bucket_count * ratio_film))
    target_indie = bucket_count - target_film

    # Over-fetch ~2x bucket so the post-classification split has enough on
    # each side to actually hit the ratio.
    over_fetch = bucket_count * 2
    pool = get_recommendations_for_bucket(
        token, mood_profile, lang_cfg, indian_lang,
        selected_genres, lang_list, over_fetch, dedup,
        exclusions=exclusions,
    )

    film, indie = classify_film_vs_indie(pool, token)
    logger.info(
        f"[INDIAN_MIX] lang={lang_list[0]} bucket={bucket_count} "
        f"film_pool={len(film)} indie_pool={len(indie)} "
        f"target_film={target_film} target_indie={target_indie}"
    )

    out: list = []
    out.extend(film[:target_film])
    out.extend(indie[:target_indie])
    # Soft fill: if one bucket fell short, pad from the other.
    if len(out) < bucket_count:
        deficit = bucket_count - len(out)
        leftover_film  = film[target_film:]
        leftover_indie = indie[target_indie:]
        # Prefer indie filler when the film side ran short, and vice-versa.
        if len(film) < target_film:
            out.extend(leftover_indie[:deficit])
        else:
            out.extend(leftover_film[:deficit])
    return out[:bucket_count]


@router.post("/api/create-playlist")
def create_playlist(data: PlaylistRequest, request: Request):
    """Generate a playlist and write it to the M&M curator Spotify account.

    The end user never authenticates with Spotify. All catalog search uses the
    app-level Client-Credentials token (no user auth needed). The final write
    — playlist creation, track adds, cover upload — uses the curator account's
    refresh token (env: CURATOR_REFRESH_TOKEN). The playlist is created with
    `public=False` so it does NOT appear on the curator's public profile, but
    the returned share URL still opens for anyone who has it.
    """
    require_session_token(request, lax=True)

    # Catalog search uses the app-scoped Client-Credentials token. Same
    # endpoints as user-authenticated Spotify search, just without per-user
    # personalisation (which we don't need for mood/genre/language matching).
    access_token = get_app_token()

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

    # ─── Dislikes → strict exclusions ────────────────────────────────────────
    # Structured dislikes (the quiz "genre you can't stand" step, carried in the
    # style seed) PLUS any dislikes the user typed into the mood box ("I hate
    # kpop", "no country"). build_exclusions parses the free-text ones out and
    # returns a cleaned mood string with those clauses removed, so "hate" never
    # poisons the emotion read or the positive-intent search. The resolved
    # exclusion set suppresses disliked-genre queries AND filters fetched tracks.
    disliked_raw = [
        sanitise_user_text(g, "dislikedGenre", max_len=80)
        for g in (data.dislikedGenres or [])
        if isinstance(g, str) and g.strip()
    ]
    # Snapshot the user's full input BEFORE build_exclusions strips dislike
    # clauses — the sound-seed / niche-genre detector below needs the
    # ORIGINAL text so a mention like "feeling anxious but want pink noise"
    # still surfaces "pink noise" even after dislike-clause stripping.
    raw_mood_for_seeds = mood_text
    exclusions, mood_text = build_exclusions(
        disliked_raw, mood_text,
        explicit_filter=bool(getattr(data, "excludeExplicit", False)),
    )
    if exclusions and exclusions.keywords:
        logger.info(f"[DISLIKE] suppressing genres={sorted(exclusions.keywords)}")

    selected_movies = data.selectedMovies or ([data.movieName] if data.movieName else [])
    split_movies    = []
    for m in selected_movies:
        # Each chip arrives as a single string but legacy commas-in-textbox
        # users may still feed comma/"and" lists — split + sanitise either way.
        if not isinstance(m, str):
            continue
        parts = re.split(r',|\band\b', m, flags=re.IGNORECASE)
        split_movies.extend([sanitise_movie(p.strip()) for p in parts if p.strip()])
    selected_movies = [m for m in split_movies if m][:5]

    # Movie-star chips entered in the new actor field. Same hygiene as movies.
    selected_actors: list = []
    for a in (data.selectedActors or []):
        if not isinstance(a, str):
            continue
        cleaned = sanitise_user_text(a.strip(), "actor", max_len=60)
        if cleaned:
            selected_actors.append(cleaned)
    selected_actors = selected_actors[:5]

    mood_profile = parse_mood_profile(mood_text, intent)
    logger.info(
        f"[MOOD] {mood_profile['emotion']} | energy={mood_profile['energy']} | intent={mood_profile['intent']}"
    )

    range_key   = data.trackCountRange if data.trackCountRange in PLAYLIST_RANGES else "15-30"
    track_count = resolve_track_count(range_key)

    logger.info(
        f"[REQ] count={track_count} langs={selected_langs} genres={selected_genres} "
        f"movies={selected_movies} actors={selected_actors} "
        f"industry={data.filmIndustry} excludeExplicit={bool(getattr(data, 'excludeExplicit', False))}"
    )

    try:
        dedup2     = DeduplicationState()
        all_tracks = []
        track_uris = []

        # ─── Movie-album anchors ─────────────────────────────────────────
        # When the user lists movies, seed the playlist with each movie's
        # soundtrack tracks. Lives on top of the 55/45 split below; counted
        # toward the film bucket.
        for mv in selected_movies:
            indian_lang = detect_indian_language(mood_text, data.filmIndustry, selected_langs)
            raw = search_movie_album(access_token, mv, indian_lang or "hindi")
            for t in raw:
                uri    = t.get("uri", "")
                artist = t.get("artist", "")
                if uri and dedup2.is_allowed(uri, artist):
                    # Honour explicit + dislike filters even on movie-album
                    # anchors so a "no explicit" toggle is truly global.
                    if exclusions and exclusions.explicit and t.get("explicit"):
                        continue
                    dedup2.register(uri, artist)
                    track_uris.append(uri)
                    all_tracks.append({k: v for k, v in t.items() if k != "uri"})

        # ─── Movie-star (actor) anchors ──────────────────────────────────
        # Spotify has no per-actor index, so we probe by name with a few query
        # shapes (compilations, top tracks). Strong for famous heroes, weaker
        # for character actors. Counted toward the film bucket.
        if selected_actors:
            actor_market = "IN"  # actors are almost always relevant in the IN market
            per_actor = max(3, min(8, track_count // max(1, len(selected_actors) * 2)))
            for actor in selected_actors:
                hits = search_actor_songs(access_token, actor, actor_market, limit=per_actor * 3)
                added_for_actor = 0
                for t in hits:
                    uri    = t.get("uri", "")
                    artist = t.get("artist", "")
                    if not uri or not dedup2.is_allowed(uri, artist):
                        continue
                    if exclusions and exclusions.explicit and t.get("explicit"):
                        continue
                    dedup2.register(uri, artist)
                    track_uris.append(uri)
                    all_tracks.append({k: v for k, v in t.items() if k != "uri"})
                    added_for_actor += 1
                    if added_for_actor >= per_actor:
                        break

        # ─── Specific-sound / niche-genre anchors ────────────────────────
        # The standard mood→emotion→genre pipeline reads "feeling anxious"
        # but doesn't surface "pink noise" or "whale sounds" the user
        # explicitly named — those aren't in the genre dropdown or the
        # query banks. Detect those mentions in the original mood+intent
        # text (pre-dislike-strip so nothing's lost), fetch a small number
        # of tracks per seed via direct Spotify search, and prepend so the
        # user's specific ask is GUARANTEED to land in the playlist.
        sound_seeds = detect_sound_seeds(raw_mood_for_seeds, intent or "")
        if sound_seeds:
            # Cap at ~30% of the playlist (min 3, max 8) so the rest of
            # the slots still get filled by mood-driven recommendations.
            seed_cap = max(3, min(8, int(track_count * 0.3)))
            per_seed = max(1, min(3, max(1, seed_cap // max(1, len(sound_seeds)))))
            logger.info(
                f"[SOUND_SEEDS] {len(sound_seeds)} seed(s): "
                f"{[lbl for (_q, lbl) in sound_seeds[:6]]} cap={seed_cap} per_seed={per_seed}"
            )
            # Ambient/sound content is largely catalogue-universal; the US
            # market has the broadest selection of these uploads on Spotify.
            seed_market = "US"
            added_sound = 0
            for (q, _label) in sound_seeds:
                if added_sound >= seed_cap:
                    break
                try:
                    hits = search_tracks_by_query(access_token, q, seed_market, limit=per_seed * 4)
                except Exception as exc:
                    logger.warning(f"[SOUND_SEEDS] query '{q}' failed: {exc}")
                    continue
                added_for_q = 0
                for raw in hits:
                    uri = raw.get("uri", "")
                    a = raw["artists"][0]["name"] if raw.get("artists") else ""
                    if not uri or not dedup2.is_allowed(uri, a):
                        continue
                    if exclusions and exclusions.explicit and raw.get("explicit"):
                        continue
                    dedup2.register(uri, a)
                    track_uris.append(uri)
                    norm = normalise_track(raw)
                    all_tracks.append({k: v for k, v in norm.items() if k != "uri"})
                    added_for_q += 1
                    added_sound += 1
                    if added_for_q >= per_seed or added_sound >= seed_cap:
                        break

        # ─── Main recommendation fill ────────────────────────────────────
        # When the user picked a film industry, weight the playlist toward that
        # industry's language (~60% if multi-lang selected, 100% if only that
        # industry's language is in the language list). Else fall back to the
        # standard multi-language even split.
        fill_count = max(0, track_count - len(all_tracks))
        if fill_count > 0:
            industry_lang_key = (data.filmIndustry or "").strip().lower()
            from config import FILM_INDUSTRY_MAP, INDIAN_LANGUAGES, LANGUAGE_ALIASES
            industry_lang = FILM_INDUSTRY_MAP.get(industry_lang_key)

            # Normalise selected langs to keys we recognise.
            lang_keys = [LANGUAGE_ALIASES.get(l.lower(), l.lower()) for l in selected_langs]
            indian_selected_keys = [k for k in lang_keys if k in INDIAN_LANGUAGES]
            multi_indian = len(indian_selected_keys) > 1

            buckets: list[tuple[str, int]] = []  # (lang_name_for_recs, bucket_count)

            if industry_lang and multi_indian:
                # Dominant 60% to the industry's language; remaining 40% split
                # across the other Indian (and any non-Indian) selected langs.
                dominant_count = max(1, int(round(fill_count * 0.60)))
                others = [l for l in selected_langs if LANGUAGE_ALIASES.get(l.lower(), l.lower()) != industry_lang]
                rest = fill_count - dominant_count
                buckets.append((_lang_display_for(industry_lang, selected_langs), dominant_count))
                if others and rest > 0:
                    each = max(1, rest // len(others))
                    for i, l in enumerate(others):
                        c = each if i < len(others) - 1 else (rest - each * (len(others) - 1))
                        if c > 0:
                            buckets.append((l, c))
            elif industry_lang:
                # Only the industry's language matters (single-lang or only
                # that lang in the selected list).
                buckets.append((_lang_display_for(industry_lang, selected_langs), fill_count))
            else:
                # No industry picked — fall back to existing multi-lang split.
                n = max(1, len(selected_langs))
                per = fill_count // n
                rem = fill_count % n
                for i, l in enumerate(selected_langs):
                    buckets.append((l, per + (1 if i < rem else 0)))

            for lang_name, bucket_count in buckets:
                if bucket_count <= 0:
                    continue
                lang_cfg    = parse_language(lang_name)
                indian_lang = detect_indian_language("", data.filmIndustry, [lang_name])
                this_lang_key = LANGUAGE_ALIASES.get(lang_name.lower(), lang_name.lower())
                is_indian_bucket = this_lang_key in INDIAN_LANGUAGES

                # Indian buckets get the 55/45 film-vs-indie split. Non-Indian
                # buckets get the standard recommendation flow.
                if is_indian_bucket:
                    fetched = _fetch_indian_film_indie_mix(
                        access_token, mood_text, mood_profile, lang_cfg,
                        indian_lang, selected_genres, [lang_name], bucket_count,
                        dedup2, exclusions, ratio_film=0.55,
                    )
                else:
                    fetched = get_recommendations_for_bucket(
                        access_token, mood_profile, lang_cfg, indian_lang,
                        selected_genres, [lang_name], bucket_count, dedup2,
                        exclusions=exclusions,
                    )
                for t in fetched:
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

        name = data.playlistName or "M&M Playlist"
        playlist_obj = create_curator_playlist(name, desc)
        playlist_id  = playlist_obj["id"]
        playlist_url = playlist_obj["external_urls"]["spotify"]

        add_tracks_curator(playlist_id, track_uris)

        # Cover upload is best-effort — the playlist is fully usable without
        # one (Spotify shows a mosaic of track art as the default). Run it
        # synchronously so the URL we return already has the right cover when
        # the user clicks Open in Spotify.
        if data.coverImageBase64:
            upload_cover_curator(playlist_id, data.coverImageBase64)

        return {
            "playlist_url":  playlist_url,
            "playlist_id":   playlist_id,
            "playlist_name": name,
            "tracks":        all_tracks,
        }

    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/api/playlist/remove-track")
def remove_track_endpoint(data: RemoveTrackRequest, request: Request):
    """Remove a single track from a curator-owned playlist.

    Replaces the direct-from-frontend Spotify DELETE call. The frontend no
    longer holds a Spotify token (auth moved entirely to the curator
    account), so all writes route through the backend with the curator's
    token. Playlist-ownership check is implicit: every playlist created by
    this app lives on the curator account, and only this app's backend
    holds the curator refresh token, so the API surface is naturally
    scoped to playlists we created.
    """
    require_session_token(request, lax=True)
    if not data.uri.startswith("spotify:track:"):
        raise HTTPException(status_code=400, detail="Invalid track URI.")
    try:
        remove_tracks_curator(data.playlist_id, [data.uri])
        return {"message": "Track removed."}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/api/similar-tracks")
def similar_tracks(data: SimilarTracksRequest, request: Request):
    """Find ~20 tracks sonically near the seed track and add them to a
    curator-owned playlist. Search uses the app-level Client-Credentials
    token; writes use the curator account token."""
    require_session_token(request, lax=True)

    access_token = get_app_token()
    headers      = {"Authorization": f"Bearer {access_token}"}

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
    add_tracks_curator(data.playlist_id, uris_to_add)

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


# Era phrases that should bias the search to a release-year RANGE rather than
# being matched as free text. "2003"/"early 2000s"/"y2k" as bare words make
# Spotify match track/album TITLES containing those strings — which is how a
# "2003 Toyota Corolla" ad ended up in a Y2K playlist. We translate the era to
# Spotify's native `year:` filter AND strip the bare year words, while LEAVING
# the genre/vibe words (hyperpop, eurodance, electroclash…) intact — so both
# genuine-2000s tracks and modern Y2K-revival tracks in those genres land.
_ERA_TO_YEAR_RANGE = [
    (re.compile(r"\b(?:y2k|early\s*2000s|2000s|millennium|millenial|millennial)\b", re.I), "2000-2009"),
    (re.compile(r"\b(?:late\s*90s|nineties|90s)\b", re.I), "1995-2001"),
    (re.compile(r"\b(?:2010s|early\s*2010s)\b", re.I), "2010-2019"),
    (re.compile(r"\b(?:eighties|80s)\b", re.I), "1980-1989"),
]
# Any standalone 4-digit year, e.g. "2003".
_BARE_YEAR = re.compile(r"\b(19|20)\d{2}\b")


def rewrite_era_query(q: str) -> str:
    """Turn era/year text in a search seed into a Spotify `year:` range filter,
    dropping the bare year words from the free-text part. Genre/vibe words are
    preserved. Idempotent-ish; if no era is detected the query is returned
    unchanged (minus any stray bare year, which is noise for free-text search).

    Examples:
      "y2k pop 2003 nostalgia"   -> "pop nostalgia year:2000-2009"
      "early 2000s eurodance"    -> "eurodance year:2000-2009"
      "hyperpop chrome glitch"   -> "hyperpop chrome glitch"  (unchanged)
    """
    if not q:
        return q
    year_range = None
    text = q
    for rx, rng in _ERA_TO_YEAR_RANGE:
        if rx.search(text):
            year_range = year_range or rng   # first match wins (most specific era first)
            text = rx.sub(" ", text)
    # Strip any remaining bare 4-digit years (e.g. "2003 synth" -> "synth").
    # If we found an explicit year via a bare year but no era phrase, use it as a
    # ±4yr window so the vibe still reads as "around then" without title-matching.
    bare = _BARE_YEAR.search(text)
    if bare and not year_range:
        y = int(bare.group(0))
        year_range = f"{max(1900, y - 4)}-{y + 4}"
    text = _BARE_YEAR.sub(" ", text)
    text = re.sub(r"\s+", " ", text).strip()
    if year_range:
        return (f"{text} year:{year_range}").strip()
    return text


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
        if not clean:
            continue
        # Translate era/year words to a Spotify `year:` filter and strip the bare
        # years so the genre/vibe terms drive the free-text match (keeps Y2K
        # revival tracks in, keeps "2003 Toyota" junk out).
        clean = rewrite_era_query(clean)
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
        # Shuffle the seed order itself so the SAME archetype yields a different
        # opening track each retake. Spotify search rank within a single seed is
        # stable, so we also widen the per-seed pool (limit=30) and randomly
        # pick from the top hits — gives variety while staying topically tight.
        seeds_shuffled = list(archetype_seeds)
        random.shuffle(seeds_shuffled)
        per_seed = max(1, min(2, (count // max(1, len(seeds_shuffled))) + 1))
        for q in seeds_shuffled:
            if len(archetype_tracks) >= count:
                break
            try:
                hits = search_tracks_by_query(token, q, market, limit=30)
            except Exception as exc:
                logger.warning(f"[SUGGEST] archetype seed '{q}' failed: {exc}")
                continue
            # Within this seed's top-30 hits, keep only those still allowed by
            # dedup, then sample `per_seed` at random. Sampling pool capped at
            # the top-N for relevance — going beyond rank ~20 starts surfacing
            # off-vibe tracks.
            candidates = []
            for t in hits[:20]:
                uri = t.get("uri", "")
                a   = t["artists"][0]["name"] if t.get("artists") else ""
                if uri and dedup.is_allowed(uri, a):
                    candidates.append(t)
            random.shuffle(candidates)
            for t in candidates[:per_seed]:
                uri = t.get("uri", "")
                a   = t["artists"][0]["name"] if t.get("artists") else ""
                dedup.register(uri, a)
                archetype_tracks.append(normalise_track(t))

    if personal:
        # ── 1. The artist's own top tracks ──────────────────────────────────
        try:
            artist = search_artist(token, personal, market)
            if artist:
                artist_genres = [g for g in (artist.get("genres") or []) if g][:3]
                want_artist   = min(4, max(2, count // 3))
                # Artist top-tracks endpoint is deterministic — shuffle the full
                # top-10 then take the first N still allowed by dedup. Different
                # retake = different sample from the same well-known catalogue.
                top = list(get_artist_top_tracks(token, artist["id"], market))
                random.shuffle(top)
                for t in top:
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
                # Widen pool + sample so identical artist-genre+emotion combos
                # don't return the same three theme picks on every retake.
                pool = list(search_tracks_by_query(token, q, market, limit=30))[:20]
                random.shuffle(pool)
                for t in pool:
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
    # one from each strand. Strand ORDER itself is shuffled per call so the
    # same archetype doesn't always lead with the archetype-seed pick — keeps
    # the same-archetype-takes-different-faces promise from the top down.
    strands = [archetype_tracks, artist_tracks, theme_tracks, quiz_tracks]
    random.shuffle(strands)
    blended = (seed_tracks + [
        t for group in zip_longest(*strands)
        for t in group if t
    ])[:count]

    if not blended:
        raise HTTPException(status_code=404, detail="Couldn't find song suggestions right now. Try again.")

    return {"tracks": blended}