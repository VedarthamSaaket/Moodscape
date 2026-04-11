import os
import re
import json
import random
import psycopg2
import bcrypt
import requests
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text      import MIMEText
from concurrent.futures import ThreadPoolExecutor, as_completed
from dotenv import load_dotenv          # ← import first
from datetime import datetime, timedelta

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, EmailStr
from spotipy.oauth2 import SpotifyOAuth
from typing import Optional

load_dotenv()                           # ← call SECOND, before ANY os.getenv()

# NOW read all env vars — load_dotenv() has already populated os.environ
DATABASE_URL          = os.getenv("DATABASE_URL")
HF_API_TOKEN          = os.getenv("HF_API_TOKEN")
SPOTIFY_CLIENT_ID     = os.getenv("SPOTIFY_CLIENT_ID")
SPOTIFY_CLIENT_SECRET = os.getenv("SPOTIFY_CLIENT_SECRET")
SPOTIFY_REDIRECT_URI  = os.getenv("SPOTIFY_REDIRECT_URI")
SPOTIFY_SCOPES        = os.getenv("SPOTIFY_SCOPES")
GMAIL_USER            = os.getenv("GMAIL_USER")
GMAIL_APP_PASSWORD    = os.getenv("GMAIL_APP_PASSWORD")

app = FastAPI()

origins = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://192.168.29.130:5173"
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

sp_oauth = SpotifyOAuth(
    client_id=SPOTIFY_CLIENT_ID,
    client_secret=SPOTIFY_CLIENT_SECRET,
    redirect_uri=SPOTIFY_REDIRECT_URI,
    scope=SPOTIFY_SCOPES
)

PLAYLIST_RANGES = {
    "15-30":   (22, 5),
    "50-60":   (55, 5),
    "100-130": (115, 5),
}

def resolve_track_count(range_key: str) -> int:
    midpoint, spread = PLAYLIST_RANGES.get(range_key, (22, 5))
    return midpoint + random.randint(-spread, spread)


class UserCreate(BaseModel):
    email: EmailStr
    password: str

class UserLogin(BaseModel):
    email: EmailStr
    password: str

class PlaylistRequest(BaseModel):
    moodText:          str
    playlistIntent:    Optional[str]       = None
    playlistName:      str                 = "Vaedarth AI Playlist"
    trackCountRange:   str                 = "15-30"
    filmIndustry:      Optional[str]       = None
    movieName:         Optional[str]       = None
    selectedMovies:    Optional[list[str]] = None
    selectedLanguages: Optional[list[str]] = None
    selectedGenres:    Optional[list[str]] = None

class MoodRequest(BaseModel):
    text: str

class VerifyEmail(BaseModel):
    email: EmailStr
    code: str

class ResendCode(BaseModel):
    email: EmailStr


def get_db_connection():
    try:
        return psycopg2.connect(DATABASE_URL)
    except psycopg2.OperationalError as e:
        print(f"DB error: {e}")
        return None
def send_email(to: str, subject: str, html: str) -> bool:
    try:
        pwd = (GMAIL_APP_PASSWORD or "").replace(" ", "")   # strip spaces defensively
        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"]    = f"MoodScape <{GMAIL_USER}>"
        msg["To"]      = to
        msg.attach(MIMEText(html, "html"))
        with smtplib.SMTP("smtp.gmail.com", 587) as server:  # 587 + STARTTLS
            server.ehlo()
            server.starttls()
            server.ehlo()
            server.login(GMAIL_USER, pwd)
            server.sendmail(GMAIL_USER, to, msg.as_string())
        print(f"[EMAIL] ✓ sent to {to}")
        return True
    except smtplib.SMTPAuthenticationError:
        print("[EMAIL] ✗ Auth failed — check GMAIL_USER and GMAIL_APP_PASSWORD in .env")
        return False
    except Exception as e:
        print(f"[EMAIL] ✗ {e}")
        return False

def verification_html(code: str) -> str:
    digits = "".join(
        f'<span style="display:inline-block;width:44px;height:56px;line-height:56px;'
        f'text-align:center;margin:0 4px;border-radius:10px;'
        f'background:rgba(167,139,250,0.12);border:1px solid rgba(167,139,250,0.25);'
        f'font-size:28px;font-weight:700;color:#c4b5fd;">'
        f'{ch}</span>'
        for ch in code
    )
    year = __import__('datetime').datetime.utcnow().year
    return f"""<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#07080d;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#07080d;padding:48px 16px;">
    <tr><td align="center">
      <table role="presentation" cellpadding="0" cellspacing="0" width="480"
             style="background:#0d0e17;border-radius:20px;border:1px solid rgba(167,139,250,0.14);">
        <tr><td style="padding:44px 44px 0;">
          <div style="font-size:26px;font-weight:700;letter-spacing:0.06em;color:#c4b5fd;">MoodScape</div>
          <div style="height:1px;margin:22px 0;background:linear-gradient(to right,transparent,rgba(167,139,250,0.2),transparent);"></div>
          <p style="margin:0 0 8px;font-size:19px;font-weight:600;color:#dde8ff;">Verify your email</p>
          <p style="margin:0 0 30px;font-size:14px;color:rgba(175,198,255,0.55);line-height:1.7;">
            Enter this 6-digit code in MoodScape to confirm your account.
          </p>
          <div style="text-align:center;margin-bottom:28px;">{digits}</div>
          <div style="text-align:center;margin-bottom:36px;">
            <span style="display:inline-block;padding:8px 18px;border-radius:30px;
                         background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.07);
                         font-size:12px;color:rgba(175,198,255,0.45);">⏱ Expires in 15 minutes</span>
          </div>
        </td></tr>
        <tr><td style="padding:0 44px 32px;">
          <div style="height:1px;margin-bottom:20px;background:linear-gradient(to right,transparent,rgba(167,139,250,0.1),transparent);"></div>
          <p style="margin:0;font-size:11.5px;color:rgba(150,170,220,0.3);text-align:center;line-height:1.7;">
            If you didn't create a MoodScape account, ignore this email.<br>© {year} MoodScape
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>"""

@app.post("/api/signup", status_code=201)
def signup_user(user: UserCreate):
    conn = get_db_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="Database connection failed")
 
    hashed = bcrypt.hashpw(user.password.encode(), bcrypt.gensalt())
    code   = str(random.randint(100000, 999999))
    expiry = datetime.utcnow() + timedelta(minutes=15)
 
    try:
        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO users (email, password_hash, verify_code, verify_expiry, is_verified)
                VALUES (%s, %s, %s, %s, FALSE)
            """, (user.email, hashed.decode(), code, expiry))
            conn.commit()
    except psycopg2.IntegrityError:
        conn.close()
        raise HTTPException(status_code=400, detail="An account with this email already exists.")
    finally:
        conn.close()
 
    ok = send_email(
        to      = user.email,
        subject = "Your MoodScape verification code",
        html    = verification_html(code),
    )
    if not ok:
        # Account row exists but email failed — let frontend redirect to verify
        # screen so user can hit Resend
        raise HTTPException(
            status_code=202,
            detail="Account created, but we couldn't send the verification email. "
                   "Use 'Resend code' on the next screen."
        )
 
    return {"message": "Account created! Check your email for the 6-digit code."}
 
 
# ── VERIFY EMAIL ─────────────────────────────────────────────────────────────
@app.post("/api/verify-email")
def verify_email(data: VerifyEmail):
    conn = get_db_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="Database connection failed")
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT verify_code, verify_expiry, is_verified FROM users WHERE email = %s",
                (data.email,)
            )
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Email not found.")
 
            db_code, db_expiry, is_verified = row
 
            if is_verified:
                return {"message": "Email already verified. Please sign in."}
            if datetime.utcnow() > db_expiry:
                raise HTTPException(status_code=400, detail="Code expired — click 'Resend code'.")
            if data.code.strip() != db_code.strip():
                raise HTTPException(status_code=400, detail="Incorrect code. Try again.")
 
            cur.execute("""
                UPDATE users
                SET is_verified = TRUE, verify_code = NULL, verify_expiry = NULL
                WHERE email = %s
            """, (data.email,))
            conn.commit()
    finally:
        conn.close()
 
    return {"message": "Email verified! You can now sign in."}
 
 
# ── RESEND CODE ──────────────────────────────────────────────────────────────
@app.post("/api/resend-verify-code")
def resend_verify_code(data: ResendCode):
    conn = get_db_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="Database connection failed")
 
    code   = str(random.randint(100000, 999999))
    expiry = datetime.utcnow() + timedelta(minutes=15)
 
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT id, is_verified FROM users WHERE email = %s", (data.email,))
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Email not found.")
            if row[1]:
                return {"message": "Already verified. Please sign in."}
            cur.execute(
                "UPDATE users SET verify_code = %s, verify_expiry = %s WHERE email = %s",
                (code, expiry, data.email)
            )
            conn.commit()
    finally:
        conn.close()
 
    ok = send_email(
        to      = data.email,
        subject = "Your new MoodScape verification code",
        html    = verification_html(code),
    )
    if not ok:
        raise HTTPException(status_code=500, detail="Couldn't send the email. Try again in a moment.")
 
    return {"message": "New code sent to your email."}
 
 
# ── SIGNIN — blocks unverified accounts ─────────────────────────────────────
@app.post("/api/signin")
def signin_user(user: UserLogin):
    conn = get_db_connection()
    if not conn:
        raise HTTPException(status_code=500, detail="Database connection failed")
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT password_hash, is_verified FROM users WHERE email = %s",
                (user.email,)
            )
            result = cur.fetchone()
    finally:
        conn.close()
 
    if not result:
        raise HTTPException(status_code=404, detail="Invalid credentials.")
 
    password_hash, is_verified = result
 
    if not bcrypt.checkpw(user.password.encode(), password_hash.encode()):
        raise HTTPException(status_code=401, detail="Invalid credentials.")
 
    if not is_verified:
        raise HTTPException(
            status_code=403,
            detail="Please verify your email before signing in. Check your inbox or request a new code."
        )
 
    return {"message": "Sign in successful."}
 
@app.get("/api/login/spotify")
def spotify_login():
    return {"authorization_url": sp_oauth.get_authorize_url()}


@app.get("/api/callback/spotify")
def spotify_callback(code: str):
    try:
        token_info = sp_oauth.get_access_token(code)
        return {
            "access_token":  token_info.get("access_token"),
            "refresh_token": token_info.get("refresh_token")
        }
    except Exception as e:
        print(f"Spotify token error: {e}")
        raise HTTPException(status_code=400, detail="Auth failed")


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

INDIAN_LANGUAGES = {"hindi", "telugu", "tamil", "kannada", "malayalam", "punjabi", "bengali", "marathi", "gujarati"}


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

def hf_zero_shot_classify(text: str, candidate_labels: list[str]) -> str:
    if not text.strip():
        return None
    API_URL = "https://api-inference.huggingface.co/models/facebook/bart-large-mnli"
    headers = {"Authorization": f"Bearer {HF_API_TOKEN}"}
    payload = {
        "inputs": text,
        "parameters": {"candidate_labels": candidate_labels},
        "options": {"wait_for_model": True}
    }
    try:
        res = requests.post(API_URL, headers=headers, json=payload, timeout=10)
        if res.status_code == 200:
            data = res.json()
            if "labels" in data and len(data["labels"]) > 0:
                print(f"[HF Zero-Shot] text='{text[:30]}...', pred='{data['labels'][0]}'")
                return data["labels"][0]
        else:
            print(f"[HF Zero-Shot] Failed {res.status_code}: {res.text}")
    except Exception as e:
        print(f"[HF Zero-Shot] Error: {e}")
    return None

def parse_mood_profile(mood_text: str, playlist_intent: Optional[str]) -> dict:
    text        = mood_text.lower()
    intent_text = (playlist_intent or "").lower()

    emotions = list(MOOD_EMOTION_MAP.keys())
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
        intents = list(INTENT_FUNCTION_MAP.keys())
        detected_intent = hf_zero_shot_classify(intent_text, intents)

        if not detected_intent:
            for i in intents:
                if i in intent_text:
                    detected_intent = i
                    break

        if detected_intent:
            intent_cfg = INTENT_FUNCTION_MAP[detected_intent]
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


# Query banks: scene, style, and mood descriptors only. No artist names.
# Spotify's search engine discovers artists dynamically based on these queries.

GENRE_QUERY_BANKS = {
    "rock": [
        "underrated indie rock 2020s",
        "post-punk revival scene",
        "art rock underground",
        "midwest emo scene",
        "noise rock cult following",
        "alternative rock deep cuts",
        "shoegaze revival scene",
        "garage rock underground",
        "psychedelic rock obscure",
        "math rock scene",
        "krautrock influence",
        "post-rock instrumental",
        "indie rock cult classics",
        "lo-fi rock bedroom recordings",
        "slacker rock 90s influenced",
    ],
    "metal": [
        "doom metal underrated",
        "sludge metal cult following",
        "post-metal atmospheric",
        "math metal progressive",
        "black metal underrated scene",
        "death metal cult following",
        "post-hardcore underground",
        "screamo underrated bands",
        "metalcore deep cuts",
        "drone metal experimental",
        "noise metal scene",
        "stoner metal cult",
        "progressive metal underrated",
        "djent underrated",
        "tech death underground",
        "Indian metal scene",
        "Indian progressive metal",
    ],
    "pop": [
        "indie pop 2020s underground",
        "art pop underground scene",
        "dream pop cult following",
        "bedroom pop artists",
        "chamber pop obscure",
        "baroque pop underrated",
        "synth pop cult 80s influenced",
        "sophisti-pop underrated",
        "twee pop artists",
        "hyperpop experimental",
        "art pop female vocals",
        "indie pop guitar jangly",
        "power pop underrated",
        "electropop underground",
        "bubblegum pop underground",
    ],
    "hip-hop": [
        "underground rap scene",
        "boom bap underground",
        "experimental hip hop",
        "conscious rap underrated",
        "jazz rap cult following",
        "lo-fi hip hop artists",
        "abstract hip hop experimental",
        "indie rap scene",
        "underground east coast rap",
        "west coast underground rap",
        "southern rap underground",
        "trap underground",
        "noise rap experimental",
        "lyrical underground rap",
        "avant garde hip hop",
    ],
    "r&b": [
        "neo soul underground",
        "alternative r&b cult",
        "indie r&b artists",
        "lo-fi r&b bedroom",
        "experimental r&b",
        "future soul artists",
        "dark r&b underground",
        "indie soul scene",
        "bedroom r&b lo-fi",
        "art r&b experimental vocals",
        "jazz influenced r&b",
        "soul underground modern",
        "r&b singer songwriter",
        "atmospheric r&b",
        "underground r&b 2020s",
    ],
    "electronic": [
        "underground techno artists",
        "ambient electronic cult",
        "IDM experimental",
        "experimental electronic underrated",
        "modular synthesis artists",
        "lo-fi electronic bedroom",
        "post-dubstep underground",
        "footwork juke scene",
        "drone electronic ambient",
        "glitch art electronic",
        "ambient techno underground",
        "dark electronic experimental",
        "industrial electronic underground",
        "neo-classical electronic crossover",
        "ambient drone soundscapes",
    ],
    "jazz": [
        "jazz underground modern",
        "avant garde jazz experimental",
        "jazz fusion underrated",
        "free jazz cult following",
        "spiritual jazz underrated",
        "jazz rap fusion",
        "modern jazz London scene",
        "jazz funk underrated",
        "post-bop obscure",
        "contemporary jazz piano",
        "neo-bop underground",
        "jazz nu-jazz modern",
        "world jazz fusion",
        "chamber jazz underrated",
        "jazz electronica crossover",
    ],
    "classical": [
        "neoclassical piano underrated",
        "modern classical experimental",
        "contemporary classical composers",
        "minimalist classical artists",
        "ambient classical crossover",
        "post-classical underground",
        "neoclassical piano solo",
        "contemporary chamber music",
        "minimalist orchestral",
        "modern string quartet",
        "solo piano contemporary",
        "orchestral ambient crossover",
        "sacred minimalist classical",
        "late romantic orchestral",
        "film score orchestral underrated",
    ],
    "lofi": [
        "lofi hip hop underrated",
        "lo-fi bedroom producers",
        "chillhop underground",
        "lofi jazz beats",
        "study lofi obscure",
        "lofi soul beats",
        "underground lofi producers",
        "bedroom lo-fi artists underground",
        "lofi hip hop aesthetic 2023 2024",
        "lofi chill instrumental",
        "lo-fi indie bedroom recordings",
        "lofi beats underground",
        "tape music lo-fi",
        "lo-fi ambient chill",
        "lofi beats study focus",
    ],
    "indie": [
        "indie folk underground",
        "indie rock cult 2020s",
        "slowcore sadcore artists",
        "dream pop indie underground",
        "lo-fi indie bedroom",
        "indie singer-songwriter underrated",
        "emo revival underground",
        "midwest emo modern",
        "shoegaze indie 2020s",
        "indie pop guitar jangly",
        "indie folk singer songwriter",
        "lo-fi indie atmospheric",
        "indie chamber pop",
        "indie rock post-punk adjacent",
        "indie bedroom pop underground",
    ],
    "acoustic": [
        "fingerpicking guitar underrated",
        "acoustic folk obscure",
        "singer songwriter bedroom",
        "acoustic indie folk 2020s",
        "neofolk acoustic",
        "acoustic americana underground",
        "fingerstyle guitar solo",
        "acoustic ballad underrated",
        "acoustic indie singer songwriter",
        "acoustic chamber folk",
        "acoustic pop underground",
        "acoustic guitar meditative",
        "classical acoustic guitar crossover",
        "acoustic roots music",
        "acoustic lo-fi recordings",
    ],
    "folk": [
        "freak folk experimental",
        "psychedelic folk obscure",
        "traditional folk revival",
        "folk punk underground",
        "anti-folk cult following",
        "appalachian folk underrated",
        "new weird america folk",
        "British folk revival",
        "Irish folk traditional",
        "harp folk experimental",
        "dark folk underground",
        "folk drone experimental",
        "folk baroque crossover",
        "celtic folk modern",
        "Nordic folk scene",
    ],
    "blues": [
        "delta blues obscure",
        "chicago blues underground",
        "electric blues cult",
        "blues rock underrated",
        "acoustic blues traditional",
        "country blues obscure",
        "young blues rock scene",
        "modern blues underground",
        "blues soul crossover",
        "blues guitar instrumental",
        "southern blues underrated",
        "blues revival modern",
        "blues jazz crossover",
        "British blues rock revival",
        "indie blues underground",
    ],
    "country": [
        "outlaw country underrated",
        "americana underground",
        "alt country obscure",
        "country folk singer songwriter",
        "red dirt country underground",
        "country blues roots",
        "honky tonk traditional",
        "modern country underground",
        "Appalachian country folk",
        "country soul crossover",
        "roots country underrated",
        "country indie crossover",
        "country gospel underground",
        "western folk country",
        "singer songwriter country underground",
    ],
    "reggae": [
        "roots reggae classic",
        "dub experimental",
        "dancehall underground",
        "reggae revival modern",
        "rocksteady ska underground",
        "dub techno crossover",
        "reggae soul crossover",
        "modern reggae conscious",
        "reggae roots spiritual",
        "Jamaican revival roots",
        "neo reggae scene",
        "dub ambient crossover",
        "reggae folk crossover",
        "dancehall alternative",
        "roots dub underground",
    ],
    "latin": [
        "latin jazz obscure",
        "bossa nova cult following",
        "cumbia underground",
        "salsa classic deep cuts",
        "afro-latin experimental",
        "nueva cancion folk latin",
        "reggaeton underground",
        "Brazilian experimental music",
        "Cuban jazz roots",
        "Latin alternative underground",
        "Mexican indie rock",
        "Latin folk singer songwriter",
        "South American experimental",
        "Latin soul crossover",
        "bolero romantic classic",
    ],
    "afrobeats": [
        "afrobeats underground",
        "highlife classic",
        "afrobeat Fela inspired",
        "afropop underrated",
        "juju music Nigeria",
        "afro soul",
        "Nigerian music underground",
        "afrobeats 2020s underground",
        "West African pop underground",
        "afro fusion modern",
        "afropop alternative",
        "East African pop underground",
        "Ghanaian music modern",
        "afrobeats soul crossover",
        "African indie music",
    ],
    "ambient": [
        "dark ambient experimental",
        "drone ambient cult following",
        "ambient classical crossover",
        "field recording ambient",
        "generative ambient music",
        "atmospheric ambient post-rock adjacent",
        "hauntology music",
        "ambient systems music",
        "ambient techno underground",
        "neo-classical ambient",
        "ambient drone soundscapes",
        "dark ambient industrial crossover",
        "ambient nature field recordings",
        "slow ambient meditation",
        "tape ambient lo-fi",
    ],
    "ghazal": [
        "ghazal classical Pakistani",
        "urdu ghazal traditional",
        "hindi ghazal",
        "ghazal vocal classical",
        "ghazal semi-classical",
        "ghazal modern interpretation",
        "Pakistani ghazal underground",
        "Indian ghazal classical",
        "ghazal thumri crossover",
        "contemporary ghazal artists",
    ],
    "qawwali": [
        "qawwali sufi music",
        "qawwali devotional",
        "sufi qawwali Pakistani",
        "qawwali traditional",
        "modern qawwali interpretation",
        "qawwali underground artists",
        "sufi qawwali Indian",
        "qawwali fusion modern",
    ],
    "sufi": [
        "sufi music Hindi",
        "sufi songs Bollywood",
        "sufi rock India",
        "sufi folk India",
        "sufi devotional",
        "Indian sufi underground",
        "sufi pop crossover",
        "sufi classical crossover",
        "sufi fusion modern India",
        "sufi indie India",
    ],
    "carnatic": [
        "carnatic classical vocal",
        "carnatic instrumental",
        "south Indian classical music",
        "carnatic fusion modern",
        "carnatic contemporary artists",
        "carnatic vocal underrated",
        "carnatic violin instrumental",
        "carnatic flute instrumental",
        "carnatic mandolin crossover",
        "carnatic world fusion",
    ],
    "hindustani": [
        "hindustani classical raga",
        "north Indian classical music",
        "sitar classical hindustani",
        "tabla solo hindustani",
        "flute hindustani classical",
        "sarod hindustani classical",
        "kirana gharana vocal",
        "hindustani vocal underrated",
        "hindustani classical contemporary",
        "raga fusion modern",
    ],
    "bhangra": [
        "bhangra Punjabi modern",
        "Punjabi underground indie",
        "Punjabi folk traditional",
        "Punjabi indie music",
        "Punjabi pop underground",
        "bhangra fusion modern",
        "Punjabi singer songwriter",
        "Punjabi music 2020s",
    ],
    "devotional": [
        "bhajan Hindi devotional",
        "devotional songs India",
        "Indian devotional classical crossover",
        "devotional music contemporary",
        "devotional folk India",
        "bhajan classical crossover",
        "devotional indie India",
        "temple music devotional",
    ],
    "indian folk": [
        "Indian folk music traditional",
        "Rajasthani folk music",
        "Baul songs Bengal",
        "folk fusion India",
        "tribal folk India",
        "Indian folk singer songwriter",
        "Indian folk rock crossover",
        "rural folk India traditional",
        "folk songs India regional",
        "Indian roots music",
    ],
}

MOOD_QUERY_BANKS = {
    "sad": [
        "midwest emo sad songs",
        "slowcore sadcore scene",
        "sad indie bedroom pop",
        "emo revival sad 2020s",
        "post-rock melancholy",
        "ambient sad music",
        "shoegaze sad dreamy",
        "singer songwriter sad confessional",
        "sad piano neoclassical",
        "heartbreak indie underground",
        "sad folk songs obscure",
        "sad indie confessional lyrics",
        "grief music indie",
        "melancholy post-rock",
        "sad slowcore underground",
    ],
    "melancholy": [
        "bittersweet indie pop",
        "melancholic dream pop",
        "nostalgic indie folk",
        "wistful ambient music",
        "melancholy neoclassical piano",
        "melancholy orchestral pop",
        "melancholy folk singer songwriter",
        "bittersweet post-rock",
        "melancholy dream pop ethereal",
        "slowcore melancholy",
        "melancholy ambient drone",
        "wistful indie bedroom pop",
        "melancholy film score",
        "orchestral melancholy modern",
        "melancholy chamber music",
    ],
    "dark": [
        "dark atmospheric indie",
        "post-punk dark scene",
        "darkwave underground",
        "gothic rock cult following",
        "industrial dark experimental",
        "noise rock dark",
        "dark experimental underground",
        "dark folk underground",
        "dark ambient industrial",
        "dark post-punk revival",
        "gothic darkwave underground",
        "dark drone atmospheric",
        "dark neo-classical",
        "dark singer songwriter",
        "dark ethereal vocals",
    ],
    "angry": [
        "noise rock angry",
        "hardcore punk underground",
        "post-hardcore aggression",
        "math rock intense",
        "death metal underground",
        "grindcore scene",
        "experimental rap angry",
        "noise rap experimental",
        "hardcore heavy",
        "post-hardcore intense",
        "math metalcore",
        "heavy noise underground",
        "sludge heavy angry",
        "punk political underground",
        "angry indie underground",
    ],
    "nostalgic": [
        "nostalgic indie dream pop",
        "shoegaze 90s revival",
        "jangle pop classic",
        "bedroom pop nostalgic",
        "lo-fi nostalgic tape",
        "shoegaze nostalgic",
        "dreamy nostalgic indie",
        "90s indie nostalgia",
        "jangle pop nostalgic",
        "nostalgic bedroom recordings",
        "nostalgic ambient music",
        "nostalgic dream pop",
        "late 90s indie nostalgia",
        "nostalgic lo-fi",
        "nostalgic folk singer songwriter",
    ],
    "lonely": [
        "lonely ambient music",
        "solitude indie folk",
        "late night sad songs",
        "3am music playlist",
        "isolation ambient",
        "introspective singer songwriter",
        "solitude ambient drone",
        "lonely indie bedroom pop",
        "introspective folk",
        "quiet lonely songs",
        "late night introspective indie",
        "solitude post-rock",
        "lonely slowcore",
        "isolated ambient",
        "solitude acoustic folk",
    ],
    "anxious": [
        "anxious indie music",
        "tense post-punk",
        "nervous energy music",
        "anxious experimental",
        "overwhelming noise music",
        "anxious post-punk revival",
        "tense math rock",
        "anxious indie underground",
        "nervous energy post-punk",
        "restless indie music",
        "uneasy ambient",
        "tense experimental",
        "anxiety indie confessional",
        "unsettling ambient dark",
        "nervous indie bedroom",
    ],
    "happy": [
        "feel good indie pop",
        "jangly indie rock happy",
        "upbeat bedroom pop",
        "indie pop cheerful 2020s",
        "sunshine pop underground",
        "upbeat indie folk",
        "cheerful bedroom pop",
        "feel good indie underground",
        "joyful indie pop",
        "uplifting indie rock",
        "sunny indie pop",
        "cheerful singer songwriter",
        "feel good 2020s indie",
        "happy jangle pop",
        "upbeat indie guitar",
    ],
    "romantic": [
        "romantic indie folk",
        "love songs indie underground",
        "tender dream pop",
        "romantic neoclassical",
        "intimate bedroom pop love",
        "romantic ambient",
        "tender indie folk",
        "intimate love songs underground",
        "romantic dream pop",
        "soft romantic indie",
        "tender acoustic love songs",
        "romantic lo-fi",
        "love songs bedroom pop",
        "romantic singer songwriter",
        "soft romantic pop underground",
    ],
    "hopeful": [
        "uplifting indie folk",
        "hopeful ambient",
        "inspiring post-rock",
        "redemption arc indie",
        "healing music indie",
        "hopeful folk singer songwriter",
        "uplifting post-rock",
        "hopeful indie underground",
        "optimistic indie pop",
        "healing ambient",
        "hopeful orchestral",
        "uplifting chamber music",
        "hopeful bedroom pop",
        "encouraging indie folk",
        "uplifting lo-fi",
    ],
    "chill": [
        "chill indie underground",
        "laid back bedroom pop",
        "mellow indie chill",
        "lo-fi chill beats",
        "ambient chill electronic",
        "chill lo-fi bedroom",
        "mellow indie underground",
        "chill world music",
        "laid back indie rock",
        "chill ambient electronic",
        "mellow soul chill",
        "lo-fi chill instrumental",
        "chill indie folk",
        "mellow bedroom pop",
        "chill electronic ambient",
    ],
    "focused": [
        "focus music instrumental",
        "study music ambient",
        "concentration piano",
        "deep work music",
        "background instrumental indie",
        "lo-fi study beats",
        "focus ambient",
        "concentration instrumental",
        "study piano classical",
        "deep focus ambient",
        "work music instrumental background",
        "focus drone ambient",
        "study electronic ambient",
        "piano focus solo",
        "deep work lo-fi",
    ],
    "dreamy": [
        "dreamy shoegaze",
        "ethereal dream pop",
        "hazy psychedelic indie",
        "surreal ambient music",
        "hypnotic drone music",
        "dreamy ethereal vocals",
        "hazy bedroom dream pop",
        "hypnotic ambient drone",
        "dreamy psychedelic",
        "surreal indie underground",
        "dreamy lo-fi",
        "ethereal ambient",
        "dreamy chamber pop",
        "floating ambient dreamy",
        "dreamy post-rock",
    ],
    "energetic": [
        "energetic underground rock",
        "high energy post-punk",
        "intense math rock",
        "energetic indie underground",
        "pump up underground rap",
        "energetic hardcore",
        "high energy indie rock",
        "intense post-punk revival",
        "energetic dance punk",
        "high energy garage rock",
        "energetic noise rock",
        "intense experimental",
        "energetic punk revival",
        "upbeat energetic indie",
        "high energy underground",
    ],
    "night": [
        "late night indie",
        "night drive music",
        "nocturnal ambient",
        "2am songs underground",
        "midnight indie bedroom",
        "night electronic ambient",
        "nocturnal r&b",
        "late night dream pop",
        "night jazz",
        "nocturnal lo-fi",
        "midnight ambient",
        "night drive electronic",
        "late night trip hop",
        "nocturnal indie",
        "dark night music",
    ],
    "summer": [
        "summer indie pop",
        "beach indie rock",
        "sunshine indie underground",
        "summer bedroom pop",
        "warm jangly indie",
        "summer psychedelic",
        "beach pop underground",
        "summer lo-fi",
        "warm summer indie folk",
        "sunshine garage rock",
        "summer dream pop",
        "warm indie rock",
        "surf rock modern",
        "summer singer songwriter",
        "warm indie acoustic",
    ],
    "rainy": [
        "rainy day indie",
        "rainy ambient music",
        "grey sky music",
        "monsoon music India",
        "rainy bedroom pop",
        "rainy ambient drone",
        "grey day music",
        "rainy lo-fi",
        "overcast ambient",
        "rainy slowcore",
        "rainy dream pop",
        "grey sky folk",
        "rainy neoclassical",
        "overcast indie acoustic",
        "rainy day singer songwriter",
    ],
    "spiritual": [
        "sufi music spiritual",
        "devotional world music",
        "spiritual ambient meditation",
        "sacred music world",
        "spiritual drone music",
        "devotional folk world",
        "sacred choral music",
        "spiritual neoclassical",
        "devotional ambient",
        "sacred minimalist",
        "spiritual world fusion",
        "devotional Indian classical",
        "spiritual folk",
        "sacred ambient music",
        "spiritual post-rock",
    ],
    "confident": [
        "badass swagger rock",
        "empowering female rap",
        "confident underground hip hop",
        "confident strut electronic",
        "unstoppable heavy rock",
        "main character indie pop",
        "winning anthem underground",
        "confident dance electronic",
        "empowering r&b",
        "bold indie pop",
        "confident art pop",
        "swagger underground rap",
        "strong female vocals indie",
        "empowering indie",
        "confident post-punk",
    ],
    "peaceful": [
        "peaceful acoustic fingerpicking",
        "serene ambient drone",
        "tranquil neoclassical",
        "quiet nature field recordings",
        "stillness drone music",
        "gentle classical piano",
        "harmony vocal ambient",
        "peaceful ambient soundscapes",
        "serene minimalist",
        "quiet folk acoustic",
        "peaceful world music",
        "tranquil electronic ambient",
        "serene neoclassical piano",
        "gentle ambient",
        "peaceful meditation music",
    ],
    "playful": [
        "playful indie pop",
        "quirky art pop",
        "bouncy bedroom pop",
        "silly experimental funk",
        "goofy synth pop",
        "cheeky indie rock",
        "playful funk underground",
        "quirky indie underground",
        "playful art pop",
        "fun bedroom pop",
        "whimsical indie",
        "bouncy indie pop",
        "playful electronic",
        "silly indie fun",
        "joyful quirky indie",
    ],
    "sensual": [
        "seductive neo soul",
        "sensual dark r&b",
        "sultry jazz underground",
        "steamy bedroom electronic",
        "late night sensual indie",
        "sensual ambient",
        "dark r&b atmospheric",
        "sultry soul underground",
        "sensual electronic",
        "intimate r&b bedroom",
        "sensual trip hop",
        "dark sensual indie",
        "sultry jazz modern",
        "sensual lo-fi",
        "intimate vocal r&b",
    ],
    "grieving": [
        "grief ambient music",
        "loss slowcore",
        "mourning instrumental",
        "funeral doom ambient",
        "grief indie confessional",
        "mourning acoustic folk",
        "grief post-rock",
        "loss chamber music",
        "goodbye sad indie",
        "bereavement acoustic",
        "grief ambient drone",
        "mourning neoclassical",
        "loss songs indie",
        "grief slowcore",
        "dark grief music",
    ],
    "bored": [
        "slacker rock 90s",
        "monotone post-punk",
        "indifferent bedroom pop",
        "bored shoegaze",
        "slacker indie",
        "lo-fi bored bedroom",
        "indifferent post-punk",
        "slacker garage rock",
        "lo-fi slacker",
        "deadpan indie",
        "flat affect indie",
        "monotonous ambient",
        "slacker folk",
        "bored art pop",
        "understated indie",
    ],
    "overwhelmed": [
        "frantic noise rock",
        "chaotic mathcore",
        "overwhelming drone",
        "hyperpop chaotic",
        "fast breakcore",
        "burnout ambient",
        "overwhelming noise experimental",
        "chaotic hardcore",
        "frantic experimental",
        "sensory overload music",
        "intense chaotic noise",
        "frantic drum machine",
        "overwhelmed indie",
        "anxious chaotic",
        "overwhelming industrial",
    ],
    "trippy": [
        "psychedelic rock underground",
        "trippy space ambient",
        "mind bending IDM",
        "acid house underground",
        "cosmic synth music",
        "psybient trippy",
        "trippy psychedelic pop",
        "space rock psychedelic",
        "mind bending experimental",
        "lysergic folk",
        "psychedelic ambient",
        "trippy drone",
        "cosmic electronic",
        "psychedelic noise",
        "acid jazz trippy",
    ],
    "rebellious": [
        "riot grrrl punk",
        "anarchist punk rock",
        "defiant underground rap",
        "anti system industrial",
        "teen angst pop punk",
        "rebellious punk underground",
        "defiant indie",
        "anti-establishment music",
        "punk revival underground",
        "rebellious hardcore",
        "defiant art pop",
        "political punk rock",
        "rebellious rap underground",
        "outsider music",
        "counter-culture rock",
    ],
    "heartbroken": [
        "heartbreak slowcore",
        "dumped sad acoustic",
        "breakup indie pop",
        "betrayed angry rock",
        "crying over you r&b",
        "heartbreak indie confessional",
        "breakup singer songwriter",
        "heartbreak ambient",
        "sad breakup lo-fi",
        "heartbreak folk",
        "breakup dream pop",
        "heartbreak bedroom pop",
        "devastating indie songs",
        "breakup slowcore",
        "sad love songs indie",
    ],
    "wanderlust": [
        "roadtrip americana",
        "adventure indie folk",
        "explore cinematic post-rock",
        "wild country folk",
        "journey progressive rock",
        "highway indie rock",
        "wanderlust folk",
        "travel world music",
        "adventure ambient",
        "open road music",
        "exploratory post-rock",
        "wanderer folk singer songwriter",
        "roadtrip indie rock",
        "journey ambient",
        "wilderness folk",
    ],
    "mysterious": [
        "mysterious dark jazz",
        "enigmatic trip hop",
        "shadowy dark ambient",
        "spooky dungeon synth",
        "detective noir jazz",
        "mysterious ambient",
        "enigmatic post-rock",
        "dark mysterious electronic",
        "shadowy indie",
        "mysterious experimental",
        "occult folk",
        "enigmatic drone",
        "mysterious noir soundtrack",
        "dark mysterious indie",
        "unsettling ambient",
    ],
}

INDIAN_LANG_QUERY_BANKS = {
    "hindi": {
        "film": [
            "Bollywood melody songs",
            "Hindi film sad songs",
            "AR Rahman Hindi songs",
            "Pritam Bollywood",
            "Bollywood indie film songs",
            "Shankar Ehsaan Loy compositions",
            "Hindi film 2020s songs",
            "Bollywood underground indie",
            "Hindi film melody vocals",
            "Bollywood golden era songs",
            "Bollywood classics 90s",
            "Hindi film romantic songs",
            "Mithoon compositions Hindi",
            "Vishal Bhardwaj film songs",
            "Gulzar penned songs",
        ],
        "indie": [
            "Hindi indie music non-film",
            "Indian Ocean Hindi rock",
            "Hindi indie underground 2020s",
            "Nucleya Hindi electronic",
            "Indian metal Hindi",
            "Hindi indie singer songwriter",
            "indie Hindi pop non-film",
            "Hindi indie underground scene",
        ],
    },
    "telugu": {
        "film": [
            "Telugu melody songs",
            "Tollywood hits emotional",
            "SS Thaman Telugu compositions",
            "Devi Sri Prasad Telugu songs",
            "AR Rahman Telugu songs",
            "MM Keeravani Telugu compositions",
            "Mickey J Meyer Telugu melody",
            "Sid Sriram Telugu songs",
            "Telugu film 2020s songs",
            "Telugu sad songs emotional",
            "Anirudh Telugu songs",
            "Ilayaraja Telugu classics",
            "Telugu romantic songs film",
            "Telugu classical songs old",
            "SP Balasubrahmanyam Telugu",
        ],
        "indie": [
            "Telugu indie non-film music",
            "Telugu independent artists",
            "Telugu underground music",
            "Telugu folk fusion indie",
            "Telugu rock bands underground",
        ],
    },
    "tamil": {
        "film": [
            "Tamil melody songs Kollywood",
            "AR Rahman Tamil compositions",
            "Ilayaraja Tamil classics",
            "Anirudh Tamil songs",
            "GV Prakash Tamil songs",
            "D Imman Tamil melody",
            "Harris Jayaraj Tamil melody",
            "Sid Sriram Tamil",
            "Tamil film 2020s songs",
            "Tamil sad songs emotional",
            "Yuvan Shankar Raja Tamil",
            "Karthik Raja Tamil compositions",
            "Tamil golden era songs",
            "SP Balasubrahmanyam Tamil",
        ],
        "indie": [
            "Tamil indie non-film music",
            "Tamil independent artists",
            "Tamil rock bands indie",
            "Tamil underground music",
            "Tamil folk fusion indie",
        ],
    },
    "kannada": {
        "film": [
            "Kannada melody songs Sandalwood",
            "V Harikrishna Kannada compositions",
            "Arjun Janya Kannada songs",
            "Ravi Basrur Kannada",
            "Ajaneesh Loknath Kannada",
            "Hamsalekha Kannada classic songs",
            "Kannada film 2020s songs",
            "Kannada sad songs emotional",
            "SA Rajkumar Kannada classics",
            "Rajan Nagendra Kannada classic",
        ],
        "indie": [
            "Kannada indie non-film music",
            "Raghu Dixit Kannada indie rock",
            "Kannada underground music",
            "Kannada folk fusion",
        ],
    },
    "malayalam": {
        "film": [
            "Malayalam melody songs Mollywood",
            "Shaan Rahman Malayalam compositions",
            "Gopi Sundar Malayalam",
            "M Jayachandran Malayalam",
            "Bijibal Malayalam songs",
            "Sushin Shyam Malayalam",
            "KJ Yesudas Malayalam classics",
            "AR Rahman Malayalam songs",
            "Malayalam film 2020s songs",
            "Malayalam sad songs emotional",
            "Hesham Abdul Wahab Malayalam",
            "Jakes Bejoy Malayalam",
        ],
        "indie": [
            "Malayalam indie non-film music",
            "Malayalam independent artists",
            "Kerala indie music",
            "Malayalam folk fusion indie",
        ],
    },
    "punjabi": {
        "film": [
            "Punjabi songs hits 2020s",
            "Punjabi pop mainstream",
            "Punjabi bhangra hits",
            "Punjabi sad songs emotional",
            "Punjabi folk traditional",
        ],
        "indie": [
            "Punjabi folk indie singer songwriter",
            "Punjabi independent music",
            "Punjabi underground artists",
        ],
    },
    "bengali": {
        "film": [
            "Bengali film songs",
            "Rabindra Sangeet",
            "Bengali romantic film songs",
            "Bengali classic songs",
        ],
        "indie": [
            "Bengali indie music",
            "Bengali independent artists",
            "Bengali underground music",
        ],
    },
    "marathi": {
        "film": [
            "Marathi film songs",
            "Ajay Atul Marathi compositions",
            "Marathi songs hits",
        ],
        "indie": [
            "Marathi indie music non-film",
            "Marathi underground artists",
        ],
    },
    "gujarati": {
        "film": [
            "Gujarati garba songs",
            "Gujarati dandiya music",
            "Gujarati folk songs",
        ],
        "indie": [
            "Gujarati folk indie",
            "Gujarati underground music",
        ],
    },
}

LANG_GENRE_CROSS_QUERIES = {
    ("korean", "rock"):    ["Korean rock bands underground", "K-rock scene", "Korean indie rock", "Korean post-punk"],
    ("korean", "metal"):   ["Korean metal bands underground", "Korean heavy music", "K-metal scene"],
    ("korean", "indie"):   ["K-indie artists", "Korean indie underground", "Korean bedroom pop", "Korean indie scene"],
    ("korean", "jazz"):    ["Korean jazz artists", "K-jazz modern", "Korean jazz underground"],
    ("korean", "hip-hop"): ["K-hip hop underground", "Korean rap underground", "Korean conscious rap"],
    ("japanese", "rock"):  ["Japanese rock bands underground", "J-rock underground scene", "Japanese indie rock", "Japanese post-rock"],
    ("japanese", "metal"): ["Japanese metal bands underground", "Japanese heavy music", "J-metal scene"],
    ("japanese", "indie"): ["Japanese indie music underground", "J-indie scene", "Japanese bedroom pop", "Japanese singer songwriter"],
    ("japanese", "jazz"):  ["Japanese jazz underground", "Japanese piano jazz", "Japanese jazz modern"],
    ("japanese", "folk"):  ["Japanese folk music traditional", "Japanese acoustic folk", "Japanese folk singer songwriter"],
    ("hindi", "rock"):     ["Hindi rock bands India", "Indian rock Hindi songs", "Hindi indie rock", "Indian rock scene Hindi"],
    ("hindi", "metal"):    ["Indian metal bands Hindi", "Hindi metal underground", "Indian heavy music Hindi"],
    ("hindi", "jazz"):     ["Indian jazz Hindi", "Indian jazz fusion", "Hindustani jazz crossover"],
    ("hindi", "hip-hop"):  ["Hindi rap underground", "Hindi hip hop scene", "Indian rap Hindi lyrics"],
    ("hindi", "electronic"):["Hindi electronic music", "Indian electronic Hindi", "Hindi indie electronic"],
    ("telugu", "rock"):    ["Telugu rock bands underground", "Tollywood rock songs", "Telugu indie rock"],
    ("telugu", "metal"):   ["Telugu metal bands India", "Indian metal Telugu songs"],
    ("tamil", "rock"):     ["Tamil rock bands underground", "Tamil indie rock scene", "Chennai rock bands indie"],
    ("tamil", "metal"):    ["Tamil metal bands underground", "Chennai metal scene"],
    ("tamil", "hip-hop"):  ["Tamil rap underground", "Tamil hip hop 2020s", "Tamil rap scene"],
    ("kannada", "rock"):   ["Kannada rock bands underground", "Bangalore rock bands indie", "Kannada indie rock"],
    ("malayalam", "rock"): ["Malayalam rock bands Kerala", "Kerala rock bands indie", "Malayalam indie rock"],
    ("french", "rock"):    ["French rock bands underground", "French indie rock", "French post-punk"],
    ("french", "jazz"):    ["French jazz underground", "Paris jazz scene", "French jazz modern"],
    ("german", "metal"):   ["German metal bands underground", "German heavy music", "German thrash metal"],
    ("german", "electronic"): ["German electronic Krautrock influenced", "German electronic scene", "German experimental electronic"],
    ("portuguese", "jazz"):["Brazilian jazz bossa nova scene", "Brazilian jazz underground", "Brazilian experimental jazz"],
    ("spanish", "rock"):   ["Spanish rock bands underground", "Spanish indie rock scene"],
    ("arabic", "folk"):    ["Arabic folk music traditional", "Arabic classical music", "Arabic world music"],
    ("turkish", "folk"):   ["Turkish folk music traditional", "Turkish folk underground", "Anatolian folk music"],
}


def get_lang_genre_queries(lang_key: str, genre_key: str) -> list:
    key = (lang_key.lower(), genre_key.lower())
    return LANG_GENRE_CROSS_QUERIES.get(key, [])


def build_search_queries(
    mood_profile: dict,
    lang_cfg: dict,
    indian_lang: Optional[str],
    selected_genres: list,
    selected_languages: list,
) -> list:
    queries = []
    emotion  = mood_profile["emotion"]
    energy   = mood_profile["energy"]
    valence  = mood_profile["valence"]
    intent   = mood_profile["intent"]

    genre_keys = [g.lower().replace(" / ", " ").replace("/", " ").replace("-", " ").strip() for g in (selected_genres or [])]
    genre_label_map = {
        "r&b soul": "r&b", "r&b / soul": "r&b", "hip hop rap": "hip-hop",
        "hip hop / rap": "hip-hop", "electronic edm": "electronic",
        "electronic / edm": "electronic", "lofi chill": "lofi",
        "lofi / chill": "lofi", "bhangra punjabi": "bhangra",
        "bhangra / punjabi": "bhangra", "indian folk": "indian folk",
    }
    genre_keys = [genre_label_map.get(k, k) for k in genre_keys]

    lang_keys = [LANGUAGE_ALIASES.get(l.lower(), "english") for l in (selected_languages or ["English"])]

    if genre_keys and lang_keys and lang_keys != ["english"]:
        for lk in lang_keys:
            for gk in genre_keys:
                cross = get_lang_genre_queries(lk, gk)
                queries.extend(cross[:3])

    if indian_lang and indian_lang in INDIAN_LANG_QUERY_BANKS:
        lang_bank = INDIAN_LANG_QUERY_BANKS[indian_lang]
        film_qs   = lang_bank.get("film", [])
        indie_qs  = lang_bank.get("indie", [])

        if valence == "low":
            film_qs = [q for q in film_qs if any(w in q.lower() for w in ["sad", "melody", "emotional", "classic", "slow"])] or film_qs[:4]
        elif energy == "high":
            film_qs = [q for q in film_qs if any(w in q.lower() for w in ["hits", "mass", "energetic", "fast"])] or film_qs[:4]

        queries.extend(film_qs[:5])
        queries.extend(indie_qs[:2])

    if genre_keys:
        for gk in genre_keys:
            bank = GENRE_QUERY_BANKS.get(gk, [])
            if bank:
                queries.extend(bank[:6])

    mood_bank = MOOD_QUERY_BANKS.get(emotion, MOOD_QUERY_BANKS.get("chill", []))
    queries.extend(mood_bank[:6])

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


def get_spotify_user_profile(token: str):
    res = requests.get(
        "https://api.spotify.com/v1/me",
        headers={"Authorization": f"Bearer {token}"}
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
        timeout=6
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
            timeout=5
        )
        if res.status_code != 200:
            continue

        albums = res.json().get("albums", {}).get("items", [])
        for album in albums:
            album_detail = requests.get(
                f"https://api.spotify.com/v1/albums/{album['id']}",
                headers=headers,
                params={"market": "IN"},
                timeout=5
            ).json()
            album_image = album_detail.get("images", [{}])[0].get("url")

            res2 = requests.get(
                f"https://api.spotify.com/v1/albums/{album['id']}/tracks",
                headers=headers,
                params={"limit": 50, "market": "IN"},
                timeout=5
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
            timeout=5
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
        json={"name": name, "description": description, "public": public}
    )
    res.raise_for_status()
    return res.json()


def add_tracks_to_playlist(token, playlist_id, track_uris):
    for i in range(0, len(track_uris), 100):
        batch = track_uris[i:i+100]
        res = requests.post(
            f"https://api.spotify.com/v1/playlists/{playlist_id}/tracks",
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
            json={"uris": batch}
        )
        res.raise_for_status()


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


def detect_indian_language(mood_text: str, film_industry_field: Optional[str], selected_languages: list) -> Optional[str]:
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


def get_recommendations_for_bucket(
    token: str,
    mood_profile: dict,
    lang_cfg: dict,
    indian_lang: Optional[str],
    selected_genres: list,
    selected_languages: list,
    track_count: int,
    dedup: DeduplicationState,
    movie_name: Optional[str] = None,
) -> list:
    market = lang_cfg.get("market", "US")
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

    queries = build_search_queries(mood_profile, lang_cfg, indian_lang, selected_genres, selected_languages)
    print(f"[QUERIES] {queries[:6]}")

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
        except Exception as e:
            print(f"[QUERY_ERR] {q}: {e}")
            return []

    with ThreadPoolExecutor(max_workers=6) as executor:
        futures = {executor.submit(fetch_query, q): q for q in queries}
        for future in as_completed(futures):
            for t in future.result():
                uri    = t.get("uri", "")
                artist = t.get("artist", "")
                if uri and dedup.is_allowed(uri, artist):
                    dedup.register(uri, artist)
                    all_tracks.append(t)
            if len(all_tracks) >= track_count * 2:
                break

    random.shuffle(all_tracks)
    return all_tracks[:track_count]


def get_recommendations(
    token: str,
    mood_text: str,
    mood_profile: dict,
    track_count: int,
    selected_languages: list,
    selected_genres: list,
    film_industry: Optional[str],
    movie_name: Optional[str],
    dedup: DeduplicationState,
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
            selected_genres, lang_list, track_count, dedup, movie_name
        )

    n           = len(lang_list)
    base        = track_count // n
    remainder   = track_count % n
    all_tracks  = []

    for i, lang_name in enumerate(lang_list):
        bucket      = base + (1 if i < remainder else 0)
        lang_cfg    = parse_language(lang_name)
        indian_lang = detect_indian_language("", film_industry if i == 0 else None, [lang_name])
        if indian_lang and indian_lang not in INDIAN_LANG_QUERY_BANKS:
            indian_lang = None

        tracks = get_recommendations_for_bucket(
            token, mood_profile, lang_cfg, indian_lang,
            selected_genres, [lang_name], bucket, dedup,
            movie_name if i == 0 else None
        )
        all_tracks.extend(tracks)

    random.shuffle(all_tracks)
    return all_tracks


@app.post("/api/create-playlist")
def create_playlist(data: PlaylistRequest, request: Request):
    auth_header = request.headers.get("Authorization")
    if not auth_header or not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid token")

    access_token = auth_header.split(" ")[1]
    mood_text    = data.moodText.strip()
    intent       = data.playlistIntent.strip() if data.playlistIntent else None

    mood_profile = parse_mood_profile(mood_text, intent)
    print(f"[MOOD] {mood_profile['emotion']} | energy={mood_profile['energy']} | intent={mood_profile['intent']}")

    range_key       = data.trackCountRange if data.trackCountRange in PLAYLIST_RANGES else "15-30"
    track_count     = resolve_track_count(range_key)
    selected_langs  = data.selectedLanguages or ["English"]
    selected_genres = data.selectedGenres    or []

    selected_movies = data.selectedMovies or ([data.movieName] if data.movieName else [])
    split_movies    = []
    for m in selected_movies:
        parts = re.split(r',|\band\b', m, flags=re.IGNORECASE)
        split_movies.extend([p.strip() for p in parts if p.strip()])
    selected_movies = split_movies

    print(f"[REQ] count={track_count} langs={selected_langs} genres={selected_genres} movies={selected_movies}")

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
                    None, dedup2
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
                None, DeduplicationState()
            )
            for t in tracks:
                uri = t.pop("uri", "")
                if uri:
                    track_uris.append(uri)
                    all_tracks.append(t)

        if not all_tracks:
            raise HTTPException(status_code=500, detail="Couldn't find tracks for this mood. Try describing it differently.")

        desc_parts = [f"Mood: {mood_text[:60]}"]
        if intent:
            desc_parts.append(f"Intent: {intent[:60]}")
        desc = " | ".join(desc_parts)

        playlist_obj = create_playlist_in_profile(access_token, user_id, data.playlistName or "Vaedarth AI Playlist", desc)
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
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


class AddTracksRequest(BaseModel):
    playlist_id: str
    uris:        list[str]


@app.post("/api/add-tracks")
def add_tracks_endpoint(data: AddTracksRequest, request: Request):
    auth_header = request.headers.get("Authorization")
    if not auth_header or not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid token")
    access_token = auth_header.split(" ")[1]
    try:
        add_tracks_to_playlist(access_token, data.playlist_id, data.uris)
        return {"message": f"Added {len(data.uris)} track(s)."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


class SimilarTracksRequest(BaseModel):
    track_title:     str
    track_artist:    str
    playlist_id:     str
    mood_text:       Optional[str] = None
    playlist_intent: Optional[str] = None
    language:        Optional[str] = None
    genre:           Optional[str] = None
    ignored_uris:    Optional[list[str]] = None

@app.post("/api/similar-tracks")
def similar_tracks(data: SimilarTracksRequest, request: Request):
    auth_header = request.headers.get("Authorization")
    if not auth_header or not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid token")

    access_token = auth_header.split(" ")[1]
    headers      = {"Authorization": f"Bearer {access_token}"}
    lang_key     = LANGUAGE_ALIASES.get((data.language or "english").lower(), "english")
    lang_cfg     = LANGUAGE_CONFIG.get(lang_key, LANGUAGE_CONFIG["english"])
    market       = lang_cfg.get("market", "US")

    mood_profile = parse_mood_profile(data.mood_text or "", data.playlist_intent)
    dedup        = DeduplicationState()

    if data.ignored_uris:
        for uri in data.ignored_uris:
            dedup.seen_uris.add(uri)

    result_tracks = []

    res = requests.get(
        "https://api.spotify.com/v1/search",
        headers=headers,
        params={"q": f"artist:{data.track_artist}", "type": "track", "limit": 20, "market": market},
        timeout=8
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

    indian_lang = detect_indian_language(data.language or "", None, [data.language or "English"])
    queries     = build_search_queries(
        mood_profile, lang_cfg, indian_lang,
        [data.genre] if data.genre else [],
        [data.language or "English"]
    )
    queries.insert(0, f"similar to {data.track_artist} {data.genre or ''}")

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
        except Exception as e:
            print(f"[SIMILAR_ERR] {e}")
            return []

    with ThreadPoolExecutor(max_workers=4) as executor:
        futures = [executor.submit(fetch_fill, q) for q in queries[:5]]
        for future in as_completed(futures):
            for t in future.result():
                uri    = t.get("uri", "")
                artist = t.get("artist", "")
                if uri and dedup.is_allowed(uri, artist) and len(result_tracks) < 20:
                    dedup.register(uri, artist)
                    result_tracks.append(t)
            if len(result_tracks) >= 20:
                break

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


def get_emotion_from_text(text: str):
    API_URL = "https://api-inference.huggingface.co/models/michellejieli/emotion_text_classifier"
    headers = {"Authorization": f"Bearer {HF_API_TOKEN}"}
    response = requests.post(API_URL, headers=headers, json={"inputs": text})
    if response.status_code == 503:
        return {"error": "Model is loading"}
    if response.status_code == 200:
        data = response.json()
        if data and isinstance(data[0], list) and data[0]:
            top = sorted(data[0], key=lambda x: x.get("score", 0), reverse=True)[0]
            return {"emotion": top.get("label", "thoughtful")}
    return {"error": "Could not determine emotion"}


def get_images_from_unsplash(query: str, count: int = 4):
    headers = {"Authorization": f"Client-ID {os.getenv('UNSPLASH_ACCESS_KEY')}"}
    params  = {"query": query, "count": count, "orientation": "landscape"}
    res = requests.get("https://api.unsplash.com/photos/random", headers=headers, params=params)
    if res.status_code == 200:
        return [{"id": p["id"], "url": p["urls"]["regular"]} for p in res.json()]
    return []


@app.post("/api/get-mood-data")
def get_mood_data(request: MoodRequest):
    emotion_result = get_emotion_from_text(request.text)
    if "error" in emotion_result:
        return emotion_result
    emotion = emotion_result.get("emotion", "thoughtful")
    images  = get_images_from_unsplash(emotion)
    return {"detected_emotion": emotion, "images": images, "playlist": None}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app:app", host="0.0.0.0", port=8000, reload=True)