"""
Genre / music-type EXCLUSION engine.

Two entry points feed dislikes into the playlist pipeline:

  1. Structured dislikes  — the `dislikedGenres` list the frontend sends
     (from the style-quiz "a genre you can't stand" step, or carried in the
     quiz style seed). Each is a free-text phrase like "mainstream pop",
     "kpop", "russian music".

  2. Free-text dislikes   — phrases the user types directly into the mood /
     intent box, e.g. "happy summer vibes but I hate edm and no country".
     `parse_dislikes_from_text` lifts those out so the user does not need a
     separate field.

Both are normalised to a canonical set used in two places downstream:

  * QUERY SUPPRESSION  — `excluded_genre_keys()` returns the GENRE_QUERY_BANKS
    keys to skip, so we never even search for a disliked genre.

  * TRACK FILTERING    — `make_track_filter()` returns a predicate that drops
    any candidate whose title / artist / album text matches a disliked
    keyword (catches things a query-level skip can't, e.g. a k-pop act that
    surfaced via a generic "happy" query, or an explicitly named language).

The matching vocabulary is deliberately broader than the GENRE_QUERY_BANKS
keys — a user who says "kpop" means the whole Korean-pop space, which our
banks don't even have a key for, so the only lever there is the text filter.
"""

import re
from typing import Callable, Iterable, Optional

from config import logger


# ─────────────────────────────────────────────────────────────────────────────
# Canonical dislike vocabulary.
#
# Each entry maps a canonical dislike token to:
#   - "genre_keys" : GENRE_QUERY_BANKS keys to SUPPRESS at query-build time
#                    (empty if we have no curated bank for it — text filter only)
#   - "keywords"   : substrings matched (word-ish) against track title / artist
#                    / album to drop a fetched track
#
# `SYNONYMS` maps the many ways a user phrases a dislike onto a canonical token.
# Keep keys lowercase; matching is done lowercased.
# ─────────────────────────────────────────────────────────────────────────────
EXCLUSION_VOCAB: dict[str, dict] = {
    "pop": {
        "genre_keys": ["pop"],
        "keywords": ["pop", "mainstream pop", "top 40", "chart pop", "bubblegum"],
    },
    "k-pop": {
        "genre_keys": [],   # no curated bank — text filter is the only lever
        "keywords": ["kpop", "k-pop", "k pop", "korean pop"],
    },
    "j-pop": {
        "genre_keys": [],
        "keywords": ["jpop", "j-pop", "j pop", "japanese pop"],
    },
    "country": {
        "genre_keys": ["country"],
        "keywords": ["country", "bluegrass", "honky tonk", "americana"],
    },
    "metal": {
        "genre_keys": ["metal"],
        "keywords": ["metal", "metalcore", "deathcore", "death metal", "black metal"],
    },
    "rock": {
        "genre_keys": ["rock"],
        "keywords": ["rock", "hard rock", "punk rock"],
    },
    "hip-hop": {
        "genre_keys": ["hip-hop"],
        "keywords": ["hip hop", "hip-hop", "hiphop", "rap", "trap", "drill"],
    },
    "r&b": {
        "genre_keys": ["r&b"],
        "keywords": ["r&b", "rnb", "soul", "neo soul"],
    },
    "electronic": {
        "genre_keys": ["electronic"],
        "keywords": ["edm", "electronic", "techno", "house", "dubstep", "trance", "electro"],
    },
    "jazz": {
        "genre_keys": ["jazz"],
        "keywords": ["jazz", "bebop", "swing"],
    },
    "classical": {
        "genre_keys": ["classical"],
        "keywords": ["classical", "orchestral", "symphony", "opera", "baroque"],
    },
    "lofi": {
        "genre_keys": ["lofi"],
        "keywords": ["lofi", "lo-fi", "lo fi"],
    },
    "indie": {
        "genre_keys": ["indie"],
        "keywords": ["indie"],
    },
    "acoustic": {
        "genre_keys": ["acoustic"],
        "keywords": ["acoustic", "unplugged"],
    },
    "folk": {
        "genre_keys": ["folk"],
        "keywords": ["folk"],
    },
    "blues": {
        "genre_keys": ["blues"],
        "keywords": ["blues"],
    },
    "reggae": {
        "genre_keys": ["reggae"],
        "keywords": ["reggae", "dancehall", "ska"],
    },
    "latin": {
        "genre_keys": ["latin"],
        "keywords": ["latin", "reggaeton", "salsa", "bachata"],
    },
    "afrobeats": {
        "genre_keys": ["afrobeats"],
        "keywords": ["afrobeats", "afrobeat", "amapiano"],
    },
    "ambient": {
        "genre_keys": ["ambient"],
        "keywords": ["ambient", "drone"],
    },
    "bhangra": {
        "genre_keys": ["bhangra"],
        "keywords": ["bhangra", "punjabi pop"],
    },
    "ghazal": {
        "genre_keys": ["ghazal"],
        "keywords": ["ghazal"],
    },
    "qawwali": {
        "genre_keys": ["qawwali"],
        "keywords": ["qawwali"],
    },
    "sufi": {
        "genre_keys": ["sufi"],
        "keywords": ["sufi"],
    },
    "devotional": {
        "genre_keys": ["devotional"],
        "keywords": ["devotional", "bhajan", "kirtan"],
    },
    # ── Language / region "music type" dislikes. No genre bank — text only.
    "russian": {
        "genre_keys": [],
        "keywords": ["russian"],
    },
    "korean": {
        "genre_keys": [],
        "keywords": ["korean"],
    },
    "japanese": {
        "genre_keys": [],
        "keywords": ["japanese"],
    },
    "spanish": {
        "genre_keys": [],
        "keywords": ["spanish"],
    },
    "arabic": {
        "genre_keys": [],
        "keywords": ["arabic"],
    },
}

# Map the many user phrasings onto a canonical vocab token.
SYNONYMS: dict[str, str] = {
    "mainstream pop": "pop", "chart pop": "pop", "top 40": "pop",
    "bubblegum pop": "pop", "commercial pop": "pop", "radio pop": "pop",
    "kpop": "k-pop", "k pop": "k-pop", "korean pop": "k-pop",
    "jpop": "j-pop", "j pop": "j-pop", "japanese pop": "j-pop",
    "edm": "electronic", "techno": "electronic", "house music": "electronic",
    "dubstep": "electronic", "trance": "electronic", "house": "electronic",
    "rap": "hip-hop", "trap": "hip-hop", "hiphop": "hip-hop", "hip hop": "hip-hop",
    "drill": "hip-hop",
    "rnb": "r&b", "soul": "r&b", "neo soul": "r&b",
    "heavy metal": "metal", "death metal": "metal", "metalcore": "metal",
    "reggaeton": "latin", "salsa": "latin",
    "lo-fi": "lofi", "lo fi": "lofi",
    "country music": "country", "bluegrass": "country",
    "russian music": "russian", "korean music": "korean",
    "japanese music": "japanese", "spanish music": "spanish",
    "arabic music": "arabic",
    "classical music": "classical", "orchestral": "classical", "opera": "classical",
}


def _canonicalise(phrase: str) -> Optional[str]:
    """Map a raw dislike phrase to a canonical vocab token, or None."""
    p = (phrase or "").strip().lower()
    if not p:
        return None
    # direct vocab hit
    if p in EXCLUSION_VOCAB:
        return p
    # synonym hit
    if p in SYNONYMS:
        return SYNONYMS[p]
    # loose containment: "i hate mainstream pop music" → "mainstream pop"
    for syn, canon in SYNONYMS.items():
        if syn in p:
            return canon
    for canon in EXCLUSION_VOCAB:
        if canon in p:
            return canon
    return None


# ─────────────────────────────────────────────────────────────────────────────
# Free-text dislike extraction.
#
# Pulls "<verb-of-dislike> X [and Y]" clauses out of the mood text. Returns the
# extracted dislike phrases AND a cleaned mood string with those clauses
# removed (so the leftover positive intent still drives the search and the word
# "hate" doesn't poison the HF emotion read).
# ─────────────────────────────────────────────────────────────────────────────
_DISLIKE_TRIGGERS = (
    r"i\s+(?:really\s+)?(?:hate|dislike|despise|can't\s+stand|cant\s+stand|don'?t\s+like|do\s+not\s+like)",
    r"(?:no|without|except|but\s+no|minus|avoid|exclude|excluding|skip)",
    r"anything\s+but",
    r"not\s+(?:a\s+fan\s+of|into)",
)
# One regex that captures the object phrase after any trigger, up to a
# sentence break or a contrasting conjunction.
_DISLIKE_RE = re.compile(
    r"(?:%s)\s+(?P<obj>[a-z0-9&\-\s]+?)(?=[.,;!?]|$|\bbut\b|\bhowever\b|\bthough\b|\bplease\b|\bi\s+(?:like|love|want|prefer)\b)"
    % "|".join(_DISLIKE_TRIGGERS),
    re.IGNORECASE,
)

# Split an object phrase like "edm and country or kpop" into atoms.
_OBJ_SPLIT_RE = re.compile(r"\s*(?:,|/|\band\b|\bor\b|\bnor\b)\s*", re.IGNORECASE)

# Filler words to drop from an extracted object atom.
_OBJ_STOPWORDS = {"music", "songs", "song", "stuff", "type", "genre", "genres",
                  "kind", "tracks", "the", "any", "really", "stuff", "a", "an"}


def parse_dislikes_from_text(mood_text: str) -> tuple[list[str], str]:
    """
    Extract dislike phrases from free mood text.

    Returns (dislike_phrases, cleaned_mood_text). The cleaned text has the
    dislike clauses stripped so they don't pollute the positive-intent search
    or the emotion classifier.
    """
    if not mood_text or not isinstance(mood_text, str):
        return [], (mood_text or "")

    phrases: list[str] = []
    spans:   list[tuple[int, int]] = []

    for m in _DISLIKE_RE.finditer(mood_text):
        obj = (m.group("obj") or "").strip()
        if not obj:
            continue
        for atom in _OBJ_SPLIT_RE.split(obj):
            atom = " ".join(
                w for w in atom.strip().lower().split() if w not in _OBJ_STOPWORDS
            ).strip()
            if atom and _canonicalise(atom):
                phrases.append(atom)
        spans.append((m.start(), m.end()))

    # Build cleaned text by removing matched dislike spans.
    cleaned = mood_text
    for start, end in sorted(spans, reverse=True):
        cleaned = cleaned[:start] + " " + cleaned[end:]
    cleaned = re.sub(r"\s{2,}", " ", cleaned).strip(" ,.;-")

    if phrases:
        logger.info(f"[DISLIKE] parsed from text: {phrases}")
    return phrases, (cleaned or mood_text)


# ─────────────────────────────────────────────────────────────────────────────
# Public builders.
# ─────────────────────────────────────────────────────────────────────────────
class Exclusions:
    """Resolved exclusion set: canonical tokens + the derived lookups."""

    __slots__ = ("tokens", "genre_keys", "keywords", "_kw_res")

    def __init__(self, tokens: set):
        self.tokens = tokens
        self.genre_keys: set = set()
        self.keywords:   set = set()
        for tok in tokens:
            spec = EXCLUSION_VOCAB.get(tok, {})
            self.genre_keys.update(spec.get("genre_keys", []))
            self.keywords.update(k.lower() for k in spec.get("keywords", []))
        # Pre-compile a word-ish boundary regex per keyword for fast track
        # matching. Boundaries are loose (\b) so "pop" won't match "popular"
        # only when standing alone, while "k-pop" matches as a unit.
        self._kw_res = [
            re.compile(r"(?<![a-z])" + re.escape(k) + r"(?![a-z])", re.IGNORECASE)
            for k in self.keywords
        ]

    def __bool__(self) -> bool:
        return bool(self.tokens)

    def text_matches(self, *fields: str) -> bool:
        """True if any disliked keyword appears in the supplied text fields."""
        if not self._kw_res:
            return False
        blob = " ".join(f for f in fields if f).lower()
        if not blob:
            return False
        return any(rx.search(blob) for rx in self._kw_res)


def build_exclusions(disliked_genres: Optional[Iterable[str]],
                     mood_text: str) -> tuple[Exclusions, str]:
    """
    Resolve the full exclusion set from structured dislikes + free-text
    dislikes parsed out of the mood string.

    Returns (Exclusions, cleaned_mood_text).
    """
    tokens: set = set()

    # 1. structured dislikes (quiz step / explicit list)
    for g in (disliked_genres or []):
        canon = _canonicalise(g)
        if canon:
            tokens.add(canon)

    # 2. free-text dislikes lifted from the mood box
    text_phrases, cleaned = parse_dislikes_from_text(mood_text)
    for p in text_phrases:
        canon = _canonicalise(p)
        if canon:
            tokens.add(canon)

    excl = Exclusions(tokens)
    if excl:
        logger.info(
            f"[DISLIKE] active tokens={sorted(tokens)} "
            f"suppress_genres={sorted(excl.genre_keys)}"
        )
    return excl, cleaned


def make_track_filter(excl: Exclusions) -> Callable[[dict], bool]:
    """
    Returns predicate(track) -> True if the track should be KEPT (not excluded).
    Track dict may be a normalised track ({title, artist, ...}) or a raw
    Spotify item ({name, artists:[{name}], album:{name}}).
    """
    if not excl:
        return lambda _t: True

    def keep(track: dict) -> bool:
        title  = track.get("title") or track.get("name") or ""
        album  = ""
        artist = track.get("artist") or ""
        if not artist and track.get("artists"):
            try:
                artist = ", ".join(a.get("name", "") for a in track["artists"])
            except Exception:
                artist = ""
        alb = track.get("album")
        if isinstance(alb, dict):
            album = alb.get("name", "")
        elif isinstance(alb, str):
            album = alb
        return not excl.text_matches(title, artist, album)

    return keep
