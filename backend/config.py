import os
import random
import logging

from dotenv import load_dotenv

load_dotenv()

DATABASE_URL          = os.getenv("DATABASE_URL")
HF_API_TOKEN          = os.getenv("HF_API_TOKEN")
SPOTIFY_CLIENT_ID     = os.getenv("SPOTIFY_CLIENT_ID")
SPOTIFY_CLIENT_SECRET = os.getenv("SPOTIFY_CLIENT_SECRET")
SPOTIFY_REDIRECT_URI  = os.getenv("SPOTIFY_REDIRECT_URI")
# Public base URL of the frontend, used to build password-reset links sent by
# email. Defaults to the local dev origin.
FRONTEND_URL          = os.getenv("FRONTEND_URL", "http://localhost:5173")
SPOTIFY_SCOPES        = os.getenv("SPOTIFY_SCOPES")
# Optional: used only by the in-app YouTube playback resolver
# (/api/youtube/resolve). The app still boots without it — playback simply
# falls back to "open on Spotify" until a key is provided.
YOUTUBE_API_KEY       = os.getenv("YOUTUBE_API_KEY")
GMAIL_USER            = os.getenv("GMAIL_USER")
GMAIL_APP_PASSWORD    = os.getenv("GMAIL_APP_PASSWORD")
# Resend HTTP API — preferred on hosts that block SMTP (e.g. Render free).
# When RESEND_API_KEY is set, email_service uses Resend instead of Gmail SMTP.
RESEND_API_KEY        = os.getenv("RESEND_API_KEY")
RESEND_FROM           = os.getenv("RESEND_FROM", "MoodScape <onboarding@resend.dev>")

logger = logging.getLogger("moodscape.main")
if not logger.handlers:
    _h = logging.StreamHandler()
    _h.setFormatter(logging.Formatter("%(asctime)s [%(levelname)s] %(message)s"))
    logger.addHandler(_h)
    logger.setLevel(logging.INFO)

PLAYLIST_RANGES = {
    "15-30":   (22, 5),
    "50-60":   (55, 5),
    "100-130": (115, 5),
}

def resolve_track_count(range_key: str) -> int:
    midpoint, spread = PLAYLIST_RANGES.get(range_key, (22, 5))
    return midpoint + random.randint(-spread, spread)

LANGUAGE_CONFIG = {
    "english":      {"market": "US", "search_market": "US",  "genre_tags": [],                                       "artist_tag": ""},
    "spanish":      {"market": "ES", "search_market": "MX",  "genre_tags": ["latin", "reggaeton", "pop latino"],     "artist_tag": ""},
    "korean":       {"market": "KR", "search_market": "KR",  "genre_tags": ["k-pop", "k-indie", "korean pop"],       "artist_tag": "korean"},
    "japanese":     {"market": "JP", "search_market": "JP",  "genre_tags": ["j-pop", "j-rock", "japanese"],          "artist_tag": "japanese"},
    "hindi":        {"market": "IN", "search_market": "IN",  "genre_tags": ["bollywood", "indian pop", "hindi"],     "artist_tag": "hindi"},
    "telugu":       {"market": "IN", "search_market": "IN",  "genre_tags": ["telugu", "tollywood"],                  "artist_tag": "telugu"},
    "tamil":        {"market": "IN", "search_market": "IN",  "genre_tags": ["tamil", "kollywood"],                   "artist_tag": "tamil"},
    "kannada":      {"market": "IN", "search_market": "IN",  "genre_tags": ["kannada", "sandalwood"],                "artist_tag": "kannada"},
    "malayalam":    {"market": "IN", "search_market": "IN",  "genre_tags": ["malayalam", "mollywood"],               "artist_tag": "malayalam"},
    "french":       {"market": "FR", "search_market": "FR",  "genre_tags": ["french pop", "chanson"],                "artist_tag": "french"},
    "german":       {"market": "DE", "search_market": "DE",  "genre_tags": ["german pop", "deutsch"],                "artist_tag": "german"},
    "portuguese":   {"market": "BR", "search_market": "BR",  "genre_tags": ["mpb", "bossa nova", "sertanejo"],       "artist_tag": "brazilian"},
    "italian":      {"market": "IT", "search_market": "IT",  "genre_tags": ["italian pop", "cantautorato"],          "artist_tag": "italian"},
    "arabic":       {"market": "SA", "search_market": "SA",  "genre_tags": ["arabic pop", "khaleeji"],               "artist_tag": "arabic"},
    "turkish":      {"market": "TR", "search_market": "TR",  "genre_tags": ["turkish pop"],                          "artist_tag": "turkish"},
    "instrumental": {"market": "US", "search_market": "US",  "genre_tags": ["instrumental", "ambient", "classical"], "artist_tag": ""},
    "punjabi":      {"market": "IN", "search_market": "IN",  "genre_tags": ["punjabi", "bhangra"],                   "artist_tag": "punjabi"},
    "bengali":      {"market": "IN", "search_market": "IN",  "genre_tags": ["bengali", "bangla"],                    "artist_tag": "bengali"},
    "marathi":      {"market": "IN", "search_market": "IN",  "genre_tags": ["marathi"],                              "artist_tag": "marathi"},
    "gujarati":     {"market": "IN", "search_market": "IN",  "genre_tags": ["gujarati", "garba"],                    "artist_tag": "gujarati"},
}

LANGUAGE_ALIASES = {
    "english": "english", "spanish": "spanish", "español": "spanish",
    "korean": "korean", "korean (k-pop)": "korean", "k-pop": "korean", "kpop": "korean",
    "japanese": "japanese", "japanese (j-pop)": "japanese", "j-pop": "japanese", "jpop": "japanese",
    "hindi": "hindi", "bollywood": "hindi", "हिंदी": "hindi",
    "telugu": "telugu", "tollywood": "telugu", "తెలుగు": "telugu",
    "tamil": "tamil", "kollywood": "tamil", "தமிழ்": "tamil",
    "kannada": "kannada", "sandalwood": "kannada", "ಕನ್ನಡ": "kannada",
    "malayalam": "malayalam", "mollywood": "malayalam", "മലയാളം": "malayalam",
    "french": "french", "français": "french",
    "german": "german", "deutsch": "german",
    "portuguese": "portuguese", "brazilian": "portuguese",
    "italian": "italian", "arabic": "arabic", "turkish": "turkish",
    "any / instrumental": "instrumental", "instrumental": "instrumental", "any": "english",
    "punjabi": "punjabi", "bengali": "bengali", "marathi": "marathi", "gujarati": "gujarati",
}

FILM_INDUSTRY_MAP = {
    "bollywood": "hindi",  "hindi": "hindi",
    "tollywood": "telugu", "telugu": "telugu",
    "kollywood": "tamil",  "tamil": "tamil",
    "sandalwood": "kannada", "kannada": "kannada",
    "mollywood": "malayalam", "malayalam": "malayalam",
}

INDIAN_LANGUAGES = {
    "hindi", "telugu", "tamil", "kannada", "malayalam",
    "punjabi", "bengali", "marathi", "gujarati",
}

MOOD_EMOTION_MAP = {
    "sad":        {"valence": "low",    "energy": "low",    "tempo": "slow"},
    "melancholy": {"valence": "low",    "energy": "low",    "tempo": "slow"},
    "dark":       {"valence": "low",    "energy": "medium", "tempo": "medium"},
    "angry":      {"valence": "low",    "energy": "high",   "tempo": "fast"},
    "nostalgic":  {"valence": "medium", "energy": "low",    "tempo": "slow"},
    "lonely":     {"valence": "low",    "energy": "low",    "tempo": "slow"},
    "anxious":    {"valence": "low",    "energy": "medium", "tempo": "medium"},
    "happy":      {"valence": "high",   "energy": "high",   "tempo": "fast"},
    "romantic":   {"valence": "high",   "energy": "low",    "tempo": "slow"},
    "hopeful":    {"valence": "high",   "energy": "medium", "tempo": "medium"},
    "chill":      {"valence": "medium", "energy": "low",    "tempo": "slow"},
    "focused":    {"valence": "medium", "energy": "low",    "tempo": "slow"},
    "dreamy":     {"valence": "medium", "energy": "low",    "tempo": "slow"},
    "energetic":  {"valence": "medium", "energy": "high",   "tempo": "fast"},
    "night":      {"valence": "low",    "energy": "medium", "tempo": "medium"},
    "summer":     {"valence": "high",   "energy": "medium", "tempo": "medium"},
    "rainy":      {"valence": "low",    "energy": "low",    "tempo": "slow"},
    "spiritual":  {"valence": "medium", "energy": "low",    "tempo": "slow"},
    "confident":  {"valence": "high",   "energy": "high",   "tempo": "fast"},
    "peaceful":   {"valence": "high",   "energy": "low",    "tempo": "slow"},
    "playful":    {"valence": "high",   "energy": "medium", "tempo": "medium"},
    "sensual":    {"valence": "medium", "energy": "low",    "tempo": "slow"},
    "grieving":   {"valence": "low",    "energy": "low",    "tempo": "slow"},
    "bored":      {"valence": "low",    "energy": "low",    "tempo": "medium"},
    "overwhelmed":{"valence": "low",    "energy": "high",   "tempo": "fast"},
    "trippy":     {"valence": "medium", "energy": "medium", "tempo": "medium"},
    "rebellious": {"valence": "medium", "energy": "high",   "tempo": "fast"},
    "heartbroken":{"valence": "low",    "energy": "low",    "tempo": "slow"},
    "wanderlust": {"valence": "high",   "energy": "medium", "tempo": "medium"},
    "mysterious": {"valence": "low",    "energy": "low",    "tempo": "slow"},
}

INTENT_FUNCTION_MAP = {
    "workout":    {"energy_floor": "high",   "tempo_floor": "fast",   "search_boost": ["gym", "workout", "pump up"]},
    "study":      {"energy_ceil":  "low",    "tempo_ceil":  "slow",   "search_boost": ["study", "focus", "concentration"]},
    "sleep":      {"energy_ceil":  "low",    "tempo_ceil":  "slow",   "search_boost": ["sleep", "calm", "ambient"]},
    "party":      {"energy_floor": "high",   "tempo_floor": "fast",   "search_boost": ["party", "dance", "club"]},
    "drive":      {"energy_floor": "medium", "tempo_floor": "medium", "search_boost": ["road trip", "driving", "cruise"]},
    "background": {"energy_ceil":  "medium", "tempo_ceil":  "medium", "search_boost": ["background", "ambient", "chill"]},
    "date":       {"energy_ceil":  "medium", "tempo_ceil":  "medium", "search_boost": ["romantic", "love songs"]},
    "morning":    {"energy_floor": "medium", "tempo_floor": "medium", "search_boost": ["morning", "wake up", "sunrise"]},
    "meditation": {"energy_ceil":  "low",    "tempo_ceil":  "slow",   "search_boost": ["meditation", "mindfulness", "zen"]},
    "gaming":     {"energy_floor": "high",   "tempo_floor": "fast",   "search_boost": ["gaming", "gamer", "epic"]},
    "cleaning":   {"energy_floor": "medium", "tempo_floor": "medium", "search_boost": ["cleaning", "chores", "upbeat"]},
    "cooking":    {"energy_ceil":  "medium", "tempo_ceil":  "medium", "search_boost": ["cooking", "kitchen", "acoustic"]},
    "commute":    {"search_boost": ["commute", "train", "bus", "transit"]},
    "relaxing":   {"energy_ceil":  "low",    "tempo_ceil":  "slow",   "search_boost": ["relax", "unwind", "soothing"]},
    "crying":     {"energy_ceil":  "low",    "tempo_ceil":  "slow",   "search_boost": ["cry", "weep", "sad", "emotional"]},
    "brainstorm": {"energy_ceil":  "medium", "tempo_ceil":  "medium", "search_boost": ["brainstorming", "creative", "flow state"]},
}

INDIAN_LANG_KEYWORDS = {
    "hindi":     ["bollywood", "hindi film", "hindi movie", "hindi songs", "hindi music", "hindi", "ghazal", "qawwali", "sufi hindi", "bhajan"],
    "telugu":    ["tollywood", "telugu film", "telugu movie", "telugu songs", "telugu music", "telugu"],
    "tamil":     ["kollywood", "tamil film", "tamil movie", "tamil songs", "tamil music", "tamil", "ilayaraja songs"],
    "kannada":   ["sandalwood", "kannada film", "kannada movie", "kannada songs", "kannada music", "kannada"],
    "malayalam": ["mollywood", "malayalam film", "malayalam movie", "malayalam songs", "malayalam music", "malayalam", "kerala songs"],
    "punjabi":   ["punjabi songs", "bhangra", "punjabi pop", "punjabi music"],
    "bengali":   ["bengali songs", "bangla songs", "rabindra sangeet"],
    "marathi":   ["marathi songs", "marathi music", "lavani"],
    "gujarati":  ["gujarati songs", "garba", "dandiya"],
}