"""
Detection + Spotify-search seeding for SPECIFIC user requests inside the mood
or intent text — sounds, niche genres, and "I want X" phrases that the generic
mood→emotion→genre query pipeline doesn't reliably surface.

Use case:
    "I'm anxious, can't sleep — need some pink noise"
    "feeling chill, want whale sounds in the background"
    "excited but need shoegaze, not regular pop"

The standard pipeline reads the emotion ("anxious"/"chill"/"excited") and
fills queries from MOOD_QUERY_BANKS + GENRE_QUERY_BANKS. None of those banks
include color noise, nature sounds, ASMR, binaural beats, or niche genres
that aren't in the dropdown. This module detects those mentions and emits
high-priority Spotify search queries so the requested tracks land in the
playlist verbatim.

Two outputs:
  * detect_sound_seeds(mood_text, intent_text) → list of (query, label) pairs
    each pair carries the Spotify search and a short tag for logging.
  * is_sound_track(title, artist) → True if a track's metadata looks like
    ambient/noise/nature content (caller relaxes YouTube identity matching
    for these since "artist = Nature Sounds" rarely matches across uploads).
"""
import re


# ─────────────────────────────────────────────────────────────────────────────
# Sound categories — explicit user phrasing → list of Spotify search queries.
# Each query is hand-tuned to reliably surface that specific sound on Spotify.
# Order inside a list matters: the first query is the strongest signal.
# ─────────────────────────────────────────────────────────────────────────────
_COLOR_NOISES = {
    "pink noise":   ["pink noise sleep", "pink noise focus", "pink noise 10 hours"],
    "white noise":  ["white noise sleep", "white noise focus", "white noise 10 hours"],
    "brown noise":  ["brown noise sleep", "brown noise focus", "brown noise deep"],
    "blue noise":   ["blue noise focus", "blue noise meditation"],
    "violet noise": ["violet noise focus"],
    "grey noise":   ["grey noise sleep", "gray noise sleep"],
    "gray noise":   ["gray noise sleep", "grey noise sleep"],
    "green noise":  ["green noise focus", "green noise relaxation"],
    "black noise":  ["black noise silence"],
}

_NATURE_SOUNDS = {
    "whale":        ["whale sounds", "humpback whale calls", "whale song deep ocean"],
    "ocean":        ["ocean waves sleep", "ocean sounds calming", "sea waves ambient"],
    "sea":          ["sea waves ambient", "ocean waves sleep"],
    "rain":         ["rain sounds sleep", "gentle rainfall ambient", "rain on roof"],
    "rainfall":     ["rainfall sleep", "gentle rainfall ambient"],
    "thunder":      ["thunderstorm sounds", "thunder rain ambient"],
    "thunderstorm": ["thunderstorm sounds", "rain thunder ambient"],
    "storm":        ["thunderstorm sounds", "storm rain ambient"],
    "forest":       ["forest sounds ambient", "woodland nature sounds", "rainforest ambience"],
    "rainforest":   ["rainforest ambience", "tropical forest sounds"],
    "jungle":       ["jungle sounds nature"],
    "bird":         ["bird sounds nature", "morning birdsong"],
    "birds":        ["bird sounds nature", "morning birdsong"],
    "birdsong":     ["morning birdsong", "bird sounds nature"],
    "wind":         ["wind sounds ambient", "gentle breeze nature sounds"],
    "fire":         ["crackling fire sounds", "fireplace ambient", "campfire sounds"],
    "fireplace":    ["fireplace ambient", "crackling fire sounds"],
    "campfire":     ["campfire sounds", "crackling fire sounds"],
    "river":        ["river stream sounds", "flowing water ambient"],
    "stream":       ["stream water sounds", "creek babbling brook"],
    "creek":        ["creek babbling brook", "stream water sounds"],
    "brook":        ["babbling brook", "stream water sounds"],
    "waterfall":    ["waterfall sounds", "waterfall ambient nature"],
    "crickets":     ["cricket sounds night", "crickets nature ambient"],
    "frogs":        ["frog sounds nature pond"],
    "wolves":       ["wolf howl sounds"],
    "wolf":         ["wolf howl sounds"],
    "owls":         ["owl sounds night forest"],
    "owl":          ["owl sounds night forest"],
}

_OTHER_SOUNDS = {
    "asmr":              ["asmr sleep", "asmr tingles", "asmr relaxation"],
    "binaural":          ["binaural beats focus", "binaural beats sleep", "binaural beats meditation"],
    "binaural beats":    ["binaural beats focus", "binaural beats sleep"],
    "isochronic":        ["isochronic tones focus"],
    "isochronic tones":  ["isochronic tones focus", "isochronic tones meditation"],
    "tibetan bowl":      ["tibetan singing bowls", "tibetan bowl meditation"],
    "tibetan bowls":     ["tibetan singing bowls", "tibetan bowl meditation"],
    "singing bowl":      ["singing bowls meditation", "tibetan singing bowls"],
    "singing bowls":     ["singing bowls meditation", "tibetan singing bowls"],
    "gong":              ["gong meditation bath", "gong sounds healing"],
    "om":                ["om chanting meditation", "om mantra"],
    "mantra":            ["mantra chanting meditation"],
    "chant":             ["chanting meditation", "gregorian chant"],
    "chanting":          ["chanting meditation"],
    "gregorian":         ["gregorian chant"],
    "solfeggio":         ["solfeggio frequencies", "528 hz healing", "432 hz meditation"],
    "432 hz":            ["432 hz meditation", "432 hz frequency"],
    "528 hz":            ["528 hz healing", "528 hz frequency"],
    "639 hz":            ["639 hz frequency"],
    "741 hz":            ["741 hz frequency"],
    "852 hz":            ["852 hz frequency"],
    "963 hz":            ["963 hz frequency"],
    "fan noise":         ["fan noise sleep", "fan sounds white noise"],
    "fan sounds":        ["fan sounds sleep", "fan noise white"],
    "vacuum":            ["vacuum cleaner sound sleep"],
    "hair dryer":        ["hair dryer sound sleep"],
    "heartbeat":         ["heartbeat sounds calming", "womb heartbeat baby"],
    "womb":              ["womb sounds baby"],
    "train":             ["train sounds sleep", "train ambient travel"],
    "rail":              ["train sounds sleep"],
    "plane":             ["airplane cabin ambient", "white noise airplane"],
    "airplane":          ["airplane cabin ambient", "white noise airplane"],
    "city ambient":      ["city ambient sounds", "urban background noise"],
    "cafe":              ["coffee shop ambient", "cafe background noise"],
    "coffee shop":       ["coffee shop ambient"],
    "library":           ["library ambient quiet study"],
    "rain on roof":      ["rain on roof sleep"],
    "rain on tent":      ["rain on tent sleep ambient"],
    "rain on window":    ["rain on window sleep"],
    "thunderstorm rain": ["thunderstorm rain sleep"],
    "heavy rain":        ["heavy rain sleep ambient"],
}

# Merge all into one big dict.
_ALL_SOUNDS: dict[str, list[str]] = {**_COLOR_NOISES, **_NATURE_SOUNDS, **_OTHER_SOUNDS}

# Compile a single alternation regex, sorted by length so multi-word phrases
# ("pink noise", "binaural beats") match before single words ("noise", "beats").
_SOUND_KEYS = sorted(_ALL_SOUNDS.keys(), key=len, reverse=True)
_SOUND_RE = re.compile(
    r"(?<![a-z])(?:" + "|".join(re.escape(k) for k in _SOUND_KEYS) + r")(?![a-z])",
    re.IGNORECASE,
)

# Generic "<noun> noise" / "<noun> sounds" extraction — catches things we didn't
# enumerate explicitly (e.g. "river sounds", "subway noise"). The noun gets
# turned into "<noun> sounds" as a Spotify query.
_GENERIC_NOISE_RE = re.compile(
    r"(?<![a-z])([a-z][a-z\-]{2,18})\s+(noise|noises|sounds?)(?![a-z])",
    re.IGNORECASE,
)


# ─────────────────────────────────────────────────────────────────────────────
# Niche-genre / "I want X" extraction.
#
# When a user types "want shoegaze" or "include some dungeon synth" or
# "with vaporwave", that X is a specific musical request the user wants
# represented in the playlist — even if it's not in the dropdown. We pull
# the phrase after the trigger verb and use it as a literal Spotify query.
# ─────────────────────────────────────────────────────────────────────────────
_WANT_TRIGGER_RE = re.compile(
    r"(?<![a-z])(?:i\s+(?:really\s+)?(?:want|need|prefer|love|like|gotta\s+have|wanna\s+hear)"
    r"|want|need|wanna\s+hear|gotta\s+have|prefer|include|add|with|some|featuring|"
    r"throw\s+in|sprinkle\s+(?:in|with)|mix\s+in)\s+"
    r"(?P<obj>[a-z0-9][a-z0-9'&\-\s]{2,40}?)"
    r"(?=[.,;!?]|\s+(?:please|in\s+the|in\s+my|for\s+the|for\s+my|to\s+the|to\s+my)\b|$)",
    re.IGNORECASE,
)
# Words that, when they appear AT THE END of an extracted phrase, mean the
# phrase is referring to music-content. Helps us be confident the user is
# asking for a sound/genre rather than e.g. "want coffee".
_MUSIC_TAIL_WORDS = {
    "music", "song", "songs", "track", "tracks", "noise", "noises",
    "sound", "sounds", "vibes", "beats", "tones", "frequencies",
}
# Words that disqualify an extracted "want X" phrase from being interpreted
# as a musical request (so "want coffee" / "need sleep" don't get matched).
_NON_MUSIC_OBJECTS = {
    "to", "the", "a", "an", "some", "more", "less", "this", "that",
    "coffee", "tea", "food", "water", "sleep", "rest", "peace",
    "help", "advice", "company", "friends", "love", "money", "time",
    "energy", "focus", "comfort", "validation",
}


_LEADING_FILLERS = (
    "some", "any", "a", "an", "the", "more", "less", "really", "just",
    "actually", "kind of", "kinda", "sort of", "sorta",
)


def _strip_leading_fillers(phrase: str) -> str:
    """Trim leading conversational fillers from a "want X" object so
    'some post-rock' → 'post-rock' before music-phrase classification.
    Leaves single-word fillers ('some' alone) intact for the classifier
    to reject."""
    s = phrase.strip()
    if not s:
        return s
    changed = True
    while changed:
        changed = False
        low = s.lower()
        for f in _LEADING_FILLERS:
            if low == f:
                # Nothing meaningful left — leave as-is so the classifier rejects.
                return s
            if low.startswith(f + " "):
                s = s[len(f) + 1 :].lstrip()
                changed = True
                break
    return s


def _split_phrases(obj: str) -> list[str]:
    """Split an extracted 'want X' object on commas / 'and' / 'or' so
    'shoegaze and dream pop' yields ['shoegaze', 'dream pop']. Also
    strips leading conversational fillers ('some post-rock' → 'post-rock')."""
    parts = re.split(r"\s*(?:,|\band\b|\bor\b)\s*", obj, flags=re.IGNORECASE)
    out: list[str] = []
    for p in parts:
        s = _strip_leading_fillers((p or "").strip())
        if s:
            out.append(s)
    return out


def _looks_like_music_phrase(phrase: str) -> bool:
    """True if a 'want X' phrase looks like a musical/sonic request rather
    than a non-music object ('coffee', 'help', etc.)."""
    p = phrase.lower().strip()
    if not p:
        return False
    if p in _NON_MUSIC_OBJECTS:
        return False
    words = p.split()
    if not words:
        return False
    # First-token disqualifiers — "want help" → words=["help"] → drop.
    if words[0] in _NON_MUSIC_OBJECTS:
        return False
    # End-with-music-word → strong signal it's musical.
    if words[-1] in _MUSIC_TAIL_WORDS:
        return True
    # Looks like a multi-word genre/style → keep.
    if len(words) >= 2:
        return True
    # Single word — keep only if it looks like a genre-y word (no common
    # everyday meaning). A short whitelist of niche-genre stems we trust as
    # single tokens, plus anything with a hyphen ("lo-fi", "post-rock") or
    # a known-genre suffix.
    GENRE_SINGLE = {
        "shoegaze", "vaporwave", "synthwave", "darksynth", "dungeon",
        "djent", "djentcore", "screamo", "emo", "hyperpop", "phonk",
        "drill", "drum-and-bass", "jungle", "garage", "house", "techno",
        "trance", "dubstep", "trap", "lofi", "lo-fi", "chillwave",
        "witchhouse", "witch-house", "blackgaze", "noisecore", "math-rock",
        "post-rock", "post-punk", "post-metal", "post-hardcore",
        "krautrock", "shoegazey", "klezmer", "afrobeat", "afrobeats",
        "reggaeton", "cumbia", "salsa", "bossa", "samba", "fado",
        "qawwali", "ghazal", "carnatic", "hindustani", "bhajan",
        "ambient", "drone", "minimal", "neoclassical", "neo-classical",
        "industrial", "ebm", "darkwave", "coldwave", "no-wave",
    }
    if words[0] in GENRE_SINGLE:
        return True
    if "-" in words[0]:
        return True
    return False


def detect_sound_seeds(mood_text: str, intent_text: str = "") -> list[tuple[str, str]]:
    """
    Scan the combined mood+intent text for specific sound/genre/niche
    requests. Returns a deduped list of (spotify_query, label) tuples,
    ordered by the user's mention order (earlier mentions weighted more).

    The caller should fetch a small number of tracks per query (2–3) and
    prepend them to the playlist BEFORE the standard mood/genre fill, so
    the user's specific request is guaranteed representation.
    """
    blob = " ".join(t for t in (mood_text, intent_text) if t).strip()
    if not blob:
        return []

    out: list[tuple[str, str]] = []
    seen_q: set = set()
    # Character spans already explained by an explicit-sound match —
    # used to skip the generic "<noun> noise" pass over the SAME text.
    explicit_spans: list[tuple[int, int]] = []

    def _push(query: str, label: str) -> None:
        q = (query or "").strip()
        if not q or q in seen_q:
            return
        seen_q.add(q)
        out.append((q, label))

    def _overlaps_explicit(start: int, end: int) -> bool:
        return any(not (end <= s or start >= e) for (s, e) in explicit_spans)

    # 1. Explicit sound categories.
    for m in _SOUND_RE.finditer(blob):
        phrase = m.group(0).lower().strip()
        explicit_spans.append((m.start(), m.end()))
        for q in _ALL_SOUNDS.get(phrase, []):
            _push(q, f"sound:{phrase}")

    # 2. Generic "<noun> noise" / "<noun> sounds" patterns we didn't catch
    #    in the explicit table. Skip any whose span overlaps an explicit
    #    hit so "pink noise" doesn't spawn an extra "pink sounds" seed.
    for m in _GENERIC_NOISE_RE.finditer(blob):
        if _overlaps_explicit(m.start(), m.end()):
            continue
        noun  = m.group(1).lower().strip()
        kind  = m.group(2).lower().strip()
        if noun in _ALL_SOUNDS:
            continue
        if len(noun) < 3:
            continue
        # "<noun> noise" / "<noun> sounds" → seed both shapes for resilience.
        _push(f"{noun} {kind}", f"sound:{noun} {kind}")
        if kind != "sounds":
            _push(f"{noun} sounds", f"sound:{noun} sounds")

    # 3. "I want / need / include X" niche-genre and free-text mentions.
    for m in _WANT_TRIGGER_RE.finditer(blob):
        obj = (m.group("obj") or "").strip()
        if not obj:
            continue
        for piece in _split_phrases(obj):
            if not _looks_like_music_phrase(piece):
                continue
            # If the piece already contains a sound keyword, the explicit
            # branch above already covered it — don't double-seed.
            if _SOUND_RE.search(piece):
                continue
            _push(piece, f"specific:{piece}")

    return out


# ─────────────────────────────────────────────────────────────────────────────
# Track-level "is this an ambient/noise recording?" check. Used by the
# YouTube resolver to relax identity matching for these tracks — channels
# like "Sleep Sounds Inc" / "Nature Music" rarely match the artist field
# exactly, and the title content IS the identity for noise/nature audio.
# ─────────────────────────────────────────────────────────────────────────────
_AMBIENT_TRACK_MARKERS = re.compile(
    r"\b("
    r"pink\s*noise|white\s*noise|brown\s*noise|blue\s*noise|grey\s*noise|gray\s*noise|"
    r"green\s*noise|violet\s*noise|black\s*noise|"
    r"asmr|binaural|isochronic|solfeggio|"
    r"432\s*hz|528\s*hz|639\s*hz|741\s*hz|852\s*hz|963\s*hz|"
    r"\d{1,2}\s*hours?|\d{1,2}\s*hr|"
    r"sleep\s+sound|sleep\s+music|ambient\s+sound|nature\s+sound|"
    r"rain\s+sound|ocean\s+sound|forest\s+sound|whale\s+sound|"
    r"thunder\s+sound|wind\s+sound|fire\s+sound|river\s+sound|"
    r"singing\s+bowl|tibetan\s+bowl|gong\s+bath|"
    r"meditation\s+music|relaxation\s+music"
    r")\b",
    re.IGNORECASE,
)


def is_sound_track(title: str, artist: str = "") -> bool:
    """Heuristic: does this track LOOK like an ambient/noise/nature recording?

    True iff title or artist mentions a recognised sound-category marker
    (pink noise, ASMR, binaural beats, "10 hours" runtimes, "nature sounds",
    "sleep music" etc.). Used to relax YouTube identity matching so the
    iframe widget can actually play these without false-rejecting their
    YouTube uploads under the strict song-identity rules.
    """
    blob = f"{title or ''} {artist or ''}"
    return bool(_AMBIENT_TRACK_MARKERS.search(blob))
