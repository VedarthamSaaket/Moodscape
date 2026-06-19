"""
Genre / music-type EXCLUSION engine.

DYNAMIC, NOT HARD-CODED.

Whatever the user types in the dedicated "Genres or music types to exclude"
textbox (or supplies via the quiz dislike step) is honoured verbatim — there
is no curated whitelist of recognised genres any more. Each phrase is reduced
to its meaningful atoms (filler words like "music", "songs", "stuff" are
dropped) and then used as a literal substring match against three live signals
at playlist-generation time:

  1. TRACK METADATA TEXT  — title, artist name, album name. Catches anything
     that names the disliked term in its own metadata.

  2. SPOTIFY ARTIST GENRE TAGS  — for every candidate track, we batch-fetch
     the artist's `genres` array from `/v1/artists` and drop the track if any
     tag contains any user keyword. THIS is the "translation" step: a user
     who types "rap" excludes Travis Scott because Spotify tags him with
     ["rap", "hip hop", "trap"]. A user who types "Hindi music" excludes
     Arijit Singh because Spotify tags him with ["filmi", "modern bollywood",
     "hindi indie pop"]. We don't need to maintain our own genre dictionary;
     Spotify already does.

  3. QUERY BANK CONTENTS  — at search-query build time we scan each genre
     query bank (key + every query string in its value list) and skip the
     whole bank if any user keyword appears. So a user typing "rap" suppresses
     the hip-hop bank dynamically, without us hard-coding "rap → hip-hop".

This module is intentionally tiny and dependency-free; the heavy lifting (the
artist-genre fetch + the bank scan) lives in `spotify.py` and `mood_engine.py`
respectively, both of which consume the Exclusions object below.

Two entry points feed dislikes in:
  * STRUCTURED — the `dislikedGenres` list the frontend sends. STRICT: every
    phrase becomes a literal keyword, no recognition required.
  * FREE-TEXT  — phrases the user types into the mood/intent box, lifted out
    by `parse_dislikes_from_text` so the user does not need a separate field.
"""

import re
from typing import Callable, Iterable, Optional

from config import logger


# Filler words to drop when reducing a user phrase to its keyword atom.
# Intentionally tiny — anything not in this list is treated as meaningful.
# Includes negation/connector words too so that "no country music" or
# "without rap" — when a free-text parser leaks the negator into the atom —
# still reduces cleanly to "country" / "rap".
_FILLER_WORDS = {
    "music", "musics", "songs", "song", "stuff", "type", "types", "genre",
    "genres", "kind", "kinds", "tracks", "track", "the", "a", "an", "any",
    "really", "some", "all", "of",
    "no", "not", "without", "except", "but", "skip", "avoid", "minus",
}


def _squish(s: str) -> str:
    """
    Collapse a string to its compact form for substring comparison: lowercase,
    strip ALL hyphens and ALL whitespace. So "K-Pop", "k pop", "kpop" all
    normalise to "kpop"; "lo-fi" / "lo fi" / "lofi" all to "lofi"; "hindi
    indie pop" to "hindiindiepop". Lets the genre-tag and query-text matchers
    bridge user typos / spacing without us maintaining synonyms.
    """
    if not s:
        return ""
    return re.sub(r"[\s\-]+", "", str(s).lower())


def _atomise(phrase: str) -> str:
    """
    Reduce a user phrase to its meaningful keyword atom.

    "Hindi music"       -> "hindi"
    "mainstream stuff"  -> "mainstream"
    "the kpop genre"    -> "kpop"
    "K-Pop"             -> "k-pop"
    """
    if not phrase:
        return ""
    words = str(phrase).strip().lower().split()
    kept = [w for w in words if w not in _FILLER_WORDS]
    return " ".join(kept).strip()


# ─────────────────────────────────────────────────────────────────────────────
# Free-text dislike extraction from the mood box.
#
# We only honour phrases the parser can confidently lift from "I hate X" /
# "no X" / "anything but X" type phrasings — random words from a normal
# sentence shouldn't accidentally become exclusion filters.
# ─────────────────────────────────────────────────────────────────────────────
_DISLIKE_TRIGGERS = (
    r"i\s+(?:really\s+)?(?:hate|dislike|despise|can't\s+stand|cant\s+stand|don'?t\s+like|do\s+not\s+like)",
    r"(?:no|without|except|but\s+no|minus|avoid|exclude|excluding|skip)",
    r"anything\s+but",
    r"not\s+(?:a\s+fan\s+of|into)",
)
_DISLIKE_RE = re.compile(
    r"(?:%s)\s+(?P<obj>[a-z0-9&\-\s]+?)(?=[.,;!?]|$|\bbut\b|\bhowever\b|\bthough\b|\bplease\b|\bi\s+(?:like|love|want|prefer)\b)"
    % "|".join(_DISLIKE_TRIGGERS),
    re.IGNORECASE,
)
_OBJ_SPLIT_RE = re.compile(r"\s*(?:,|/|\band\b|\bor\b|\bnor\b)\s*", re.IGNORECASE)


def parse_dislikes_from_text(mood_text: str) -> tuple[list[str], str]:
    """
    Extract dislike atoms from free mood text.

    Returns (atom_list, cleaned_mood_text). The cleaned text has the dislike
    clauses stripped so they don't pollute the positive-intent search or the
    HF emotion classifier.
    """
    if not mood_text or not isinstance(mood_text, str):
        return [], (mood_text or "")

    atoms: list[str] = []
    spans: list[tuple[int, int]] = []

    for m in _DISLIKE_RE.finditer(mood_text):
        obj = (m.group("obj") or "").strip()
        if not obj:
            continue
        for piece in _OBJ_SPLIT_RE.split(obj):
            atom = _atomise(piece)
            if atom:
                atoms.append(atom)
        spans.append((m.start(), m.end()))

    cleaned = mood_text
    for start, end in sorted(spans, reverse=True):
        cleaned = cleaned[:start] + " " + cleaned[end:]
    cleaned = re.sub(r"\s{2,}", " ", cleaned).strip(" ,.;-")

    if atoms:
        logger.info(f"[DISLIKE] parsed from mood text: {atoms}")
    return atoms, (cleaned or mood_text)


# ─────────────────────────────────────────────────────────────────────────────
# The Exclusions object.
# ─────────────────────────────────────────────────────────────────────────────
class Exclusions:
    """
    A set of user-typed dislike keywords plus three live match methods:

      * `text_matches(*fields)`       — substring against track metadata text.
      * `matches_any_genre_tag(tags)` — substring against any Spotify artist
                                        genre tag string.
      * `matches_query_text(query)`   — substring against a search query
                                        string (used to skip whole banks).

    No hard-coded vocabulary, no canonical-token translation. The keyword set
    IS the source of truth.
    """

    __slots__ = ("keywords", "_keywords_squished", "_kw_res")

    def __init__(self, keywords: Iterable[str]):
        cleaned: set = set()
        for kw in (keywords or []):
            atom = _atomise(kw)
            if atom and len(atom) <= 60:
                cleaned.add(atom)
            # Also store the raw lowercased phrase so multi-word user input
            # like "mainstream pop" still works as a single keyword.
            raw = (kw or "").strip().lower()
            if raw and len(raw) <= 60:
                cleaned.add(raw)
        self.keywords = cleaned

        # SQUISHED variants used for substring matching against Spotify genre
        # tags and search-query strings. Collapse hyphens/whitespace so
        # "kpop" <-> "k-pop" <-> "k pop" all hit, "lofi" <-> "lo-fi" <-> "lo
        # fi", etc. Track-metadata matching stays word-bounded on the raw
        # form (we don't want a stray "pop" inside "popular").
        self._keywords_squished = {_squish(k) for k in self.keywords if _squish(k)}
        self._kw_res = [
            re.compile(r"(?<![a-z])" + re.escape(k) + r"(?![a-z])", re.IGNORECASE)
            for k in self.keywords
        ]

    def __bool__(self) -> bool:
        return bool(self.keywords)

    def text_matches(self, *fields: str) -> bool:
        """True if any keyword appears (word-bounded) in the supplied fields."""
        if not self._kw_res:
            return False
        blob = " ".join(f for f in fields if f).lower()
        if not blob:
            return False
        return any(rx.search(blob) for rx in self._kw_res)

    def matches_any_genre_tag(self, tags: Optional[Iterable[str]]) -> bool:
        """
        True if ANY supplied Spotify genre tag string contains ANY keyword,
        after collapsing hyphens/whitespace on both sides. So a user keyword
        "kpop" hits Spotify's tag "k-pop", "lofi" hits "lo-fi", "hindi pop"
        hits "hindi-pop" / "hindipop", etc.
        """
        if not self._keywords_squished or not tags:
            return False
        for tag in tags:
            if not tag:
                continue
            sq = _squish(tag)
            if sq and any(k in sq for k in self._keywords_squished):
                return True
        return False

    def matches_query_text(self, query: str) -> bool:
        """
        Substring match against a single search query string, using the same
        squish-normalised compare so "kpop" suppresses queries containing
        "k-pop" or "k pop".
        """
        if not self._keywords_squished or not query:
            return False
        sq = _squish(query)
        if not sq:
            return False
        return any(k in sq for k in self._keywords_squished)


def build_exclusions(disliked_genres: Optional[Iterable[str]],
                     mood_text: str) -> tuple[Exclusions, str]:
    """
    Build an Exclusions set from two strictness levels:

      1. `disliked_genres` (explicit textbox / quiz step) — STRICT. Every
         phrase is honoured verbatim as a keyword.
      2. `mood_text` — LOOSE. Only phrases lifted by `parse_dislikes_from_text`
         from clear "I hate X" / "no X" / "anything but X" phrasings.

    Returns (Exclusions, cleaned_mood_text).
    """
    keywords: list[str] = []

    for g in (disliked_genres or []):
        if g and isinstance(g, str):
            keywords.append(g)

    text_phrases, cleaned = parse_dislikes_from_text(mood_text)
    keywords.extend(text_phrases)

    excl = Exclusions(keywords)
    if excl:
        logger.info(f"[DISLIKE] active keywords={sorted(excl.keywords)}")
    return excl, cleaned


def make_track_filter(excl: Optional[Exclusions]) -> Callable[[dict], bool]:
    """
    Returns predicate(track) -> True if the track should be KEPT.
    Only uses metadata text (title/artist/album). The richer artist-genre-tag
    check happens in spotify.py once we've batched the artist lookup.
    """
    if not excl:
        return lambda _t: True

    def keep(track: dict) -> bool:
        title  = track.get("title") or track.get("name") or ""
        artist = track.get("artist") or ""
        if not artist and track.get("artists"):
            try:
                artist = ", ".join(a.get("name", "") for a in track["artists"])
            except Exception:
                artist = ""
        album = ""
        alb = track.get("album")
        if isinstance(alb, dict):
            album = alb.get("name", "")
        elif isinstance(alb, str):
            album = alb
        return not excl.text_matches(title, artist, album)

    return keep
