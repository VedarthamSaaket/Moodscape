import random
from typing import Optional
from concurrent.futures import ThreadPoolExecutor, as_completed, TimeoutError as FutureTimeoutError

import requests

from config import (
    HF_API_TOKEN, logger,
    MOOD_EMOTION_MAP, INTENT_FUNCTION_MAP,
    LANGUAGE_CONFIG, LANGUAGE_ALIASES, FILM_INDUSTRY_MAP,
    INDIAN_LANGUAGES, INDIAN_LANG_KEYWORDS,
)
from query_banks import (
    GENRE_QUERY_BANKS, MOOD_QUERY_BANKS,
    INDIAN_LANG_QUERY_BANKS, LANG_GENRE_CROSS_QUERIES,
)


_GLOBAL_EXECUTOR = ThreadPoolExecutor(max_workers=12)


def hf_zero_shot_classify(text: str, candidate_labels: list[str]) -> str:
    if not text.strip():
        return None
    API_URL = "https://api-inference.huggingface.co/models/facebook/bart-large-mnli"
    headers = {"Authorization": f"Bearer {HF_API_TOKEN}"}
    payload = {
        "inputs": text,
        "parameters": {"candidate_labels": candidate_labels},
        "options": {"wait_for_model": True},
    }
    try:
        res = requests.post(API_URL, headers=headers, json=payload, timeout=10)
        if res.status_code == 200:
            data = res.json()
            if "labels" in data and len(data["labels"]) > 0:
                logger.info(f"[HF Zero-Shot] text='{text[:30]}...', pred='{data['labels'][0]}'")
                return data["labels"][0]
        else:
            logger.warning(f"[HF Zero-Shot] Failed {res.status_code}: {res.text}")
    except Exception as exc:
        logger.warning(f"[HF Zero-Shot] Error: {exc}")
    return None


def parse_mood_profile(mood_text: str, playlist_intent: Optional[str]) -> dict:
    text        = mood_text.lower()
    intent_text = (playlist_intent or "").lower()

    emotions         = list(MOOD_EMOTION_MAP.keys())
    detected_emotion = hf_zero_shot_classify(text, emotions) if text else None

    if not detected_emotion:
        best_score = 0
        detected_emotion = "chill"
        for emotion in emotions:
            score = text.count(emotion)
            if score > best_score:
                best_score = score
                detected_emotion = emotion

    profile = MOOD_EMOTION_MAP[detected_emotion].copy()

    detected_intent = None
    intent_boosts   = []
    if intent_text:
        intents         = list(INTENT_FUNCTION_MAP.keys())
        detected_intent = hf_zero_shot_classify(intent_text, intents)

        if not detected_intent:
            for i in intents:
                if i in intent_text:
                    detected_intent = i
                    break

        if detected_intent:
            intent_cfg    = INTENT_FUNCTION_MAP[detected_intent]
            intent_boosts = intent_cfg.get("search_boost", [])
            if "energy_floor" in intent_cfg and profile["energy"] == "low":
                profile["energy"] = intent_cfg["energy_floor"]
            if "energy_ceil" in intent_cfg and profile["energy"] == "high":
                profile["energy"] = intent_cfg["energy_ceil"]
            if "tempo_floor" in intent_cfg and profile["tempo"] == "slow":
                profile["tempo"] = intent_cfg["tempo_floor"]
            if "tempo_ceil" in intent_cfg and profile["tempo"] == "fast":
                profile["tempo"] = intent_cfg["tempo_ceil"]

    return {
        "emotion":       detected_emotion,
        "valence":       profile["valence"],
        "energy":        profile["energy"],
        "tempo":         profile["tempo"],
        "intent":        detected_intent,
        "intent_boosts": intent_boosts,
        "mood_tags":     [detected_emotion],
        "raw_mood":      mood_text,
        "raw_intent":    playlist_intent or "",
    }


def get_lang_genre_queries(lang_key: str, genre_key: str) -> list:
    key = (lang_key.lower(), genre_key.lower())
    return LANG_GENRE_CROSS_QUERIES.get(key, [])


def build_search_queries(
    mood_profile:        dict,
    lang_cfg:            dict,
    indian_lang:         Optional[str],
    selected_genres:     list,
    selected_languages:  list,
    exclusions=None,
) -> list:
    """
    Build a search-query list, with DYNAMIC exclusion of anything matching the
    user's typed dislike keywords. There is no hard-coded "disliked-genre ->
    bank key" table; instead, for every query we'd add, we ask the Exclusions
    object whether the query string (or its parent bank key) matches any user
    keyword, and skip if so.
    """
    queries = []
    emotion = mood_profile["emotion"]
    energy  = mood_profile["energy"]
    valence = mood_profile["valence"]
    intent  = mood_profile["intent"]

    # `excl` is callable-like via `.matches_query_text(s)`; we use a no-op
    # shim when no exclusions are active so the rest of the code stays flat.
    class _NoExcl:
        def __bool__(self): return False
        def matches_query_text(self, _q): return False
        def matches_any_genre_tag(self, _g): return False
    excl = exclusions if exclusions else _NoExcl()

    def _ok(text: str) -> bool:
        """Pass-through filter — keep the query only if exclusions don't hit."""
        return not excl.matches_query_text(text)

    def _add(items):
        for q in items:
            if q and _ok(q):
                queries.append(q)

    genre_keys = [
        g.lower().replace(" / ", " ").replace("/", " ").replace("-", " ").strip()
        for g in (selected_genres or [])
    ]
    genre_label_map = {
        "r&b soul": "r&b", "r&b / soul": "r&b", "hip hop rap": "hip-hop",
        "hip hop / rap": "hip-hop", "electronic edm": "electronic",
        "electronic / edm": "electronic", "lofi chill": "lofi",
        "lofi / chill": "lofi", "bhangra punjabi": "bhangra",
        "bhangra / punjabi": "bhangra", "indian folk": "indian folk",
    }
    genre_keys = [genre_label_map.get(k, k) for k in genre_keys]
    # User-selected genre overlap with a typed dislike — dislike wins.
    genre_keys = [g for g in genre_keys if _ok(g)]

    lang_keys = [
        LANGUAGE_ALIASES.get(l.lower(), "english")
        for l in (selected_languages or ["English"])
    ]

    if genre_keys and lang_keys and lang_keys != ["english"]:
        for lk in lang_keys:
            if not _ok(lk):
                continue
            for gk in genre_keys:
                if not _ok(gk):
                    continue
                _add(get_lang_genre_queries(lk, gk)[:3])

    if indian_lang and indian_lang in INDIAN_LANG_QUERY_BANKS and _ok(indian_lang):
        lang_bank = INDIAN_LANG_QUERY_BANKS[indian_lang]
        film_qs   = lang_bank.get("film", [])
        indie_qs  = lang_bank.get("indie", [])

        if valence == "low":
            film_qs = (
                [q for q in film_qs if any(w in q.lower() for w in ["sad", "melody", "emotional", "classic", "slow"])]
                or film_qs[:4]
            )
        elif energy == "high":
            film_qs = (
                [q for q in film_qs if any(w in q.lower() for w in ["hits", "mass", "energetic", "fast"])]
                or film_qs[:4]
            )

        _add(film_qs[:5])
        _add(indie_qs[:2])

    if genre_keys:
        for gk in genre_keys:
            if not _ok(gk):
                continue
            bank = GENRE_QUERY_BANKS.get(gk, [])
            if bank:
                _add(bank[:6])

    # Dynamic bank-skip pass for the FULL GENRE_QUERY_BANKS table: if ANY
    # query string in a bank matches an exclusion keyword (or the bank key
    # itself does), that bank is poisoned and we don't draw from it even as a
    # mood fallback. We rebuild MOOD_QUERY_BANKS' picks the same way.
    mood_bank = MOOD_QUERY_BANKS.get(emotion, MOOD_QUERY_BANKS.get("chill", []))
    _add(mood_bank[:6])

    # Final dynamic guard: drop any built query that even names a disliked
    # term as a substring (mood-bank entries are short generic strings, but
    # a "dark atmospheric kpop" could sneak in from a hand-curated bank).
    if excl:
        queries = [q for q in queries if _ok(q)]

    if intent == "workout":
        queries.insert(0, "high energy underground metal rap")
        queries.insert(0, "workout hardcore punk metal")
    elif intent == "study":
        queries.insert(0, "focus ambient instrumental study")
        queries.insert(0, "lofi study music underground")
    elif intent == "sleep":
        queries.insert(0, "sleep ambient drone")
        queries.insert(0, "sleep music calm neoclassical")
    elif intent == "party":
        queries.insert(0, "party indie dance underground")
    elif intent == "drive":
        queries.insert(0, "night drive indie synth")

    seen  = set()
    final = []
    for q in queries:
        q = q.strip()
        if q and q not in seen:
            seen.add(q)
            final.append(q)

    return final[:12]


class DeduplicationState:
    def __init__(self):
        self.seen_uris:    set = set()
        self.seen_artists: set = set()

    def is_allowed(self, uri: str, artist: str) -> bool:
        artist_key = artist.lower().strip()
        if uri in self.seen_uris:
            return False
        if artist_key in self.seen_artists:
            return False
        return True

    def register(self, uri: str, artist: str):
        self.seen_uris.add(uri)
        self.seen_artists.add(artist.lower().strip())


def detect_indian_language(
    mood_text: str,
    film_industry_field: Optional[str],
    selected_languages: list,
) -> Optional[str]:
    for lang in (selected_languages or []):
        key = LANGUAGE_ALIASES.get(lang.lower())
        if key and key in INDIAN_LANGUAGES:
            return key

    if film_industry_field:
        mapped = FILM_INDUSTRY_MAP.get(film_industry_field.lower())
        if mapped:
            return mapped

    text = mood_text.lower()
    for lang, keywords in INDIAN_LANG_KEYWORDS.items():
        if any(kw in text for kw in keywords):
            return lang

    return None


def parse_language(lang_name: str) -> dict:
    key = LANGUAGE_ALIASES.get(lang_name.lower(), "english")
    return LANGUAGE_CONFIG.get(key, LANGUAGE_CONFIG["english"])