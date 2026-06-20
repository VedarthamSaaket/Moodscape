import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from spotipy.oauth2 import SpotifyOAuth

from security import SecurityMiddleware, validate_secrets
from database import init_db_pool, close_db_pool
from config import (
    SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET,
    SPOTIFY_REDIRECT_URI, SPOTIFY_SCOPES,
)
from routers import auth, playlist, mood, studio, quiz, youtube, saved, player, saint, images


sp_oauth = SpotifyOAuth(
    client_id=SPOTIFY_CLIENT_ID,
    client_secret=SPOTIFY_CLIENT_SECRET,
    redirect_uri=SPOTIFY_REDIRECT_URI,
    scope=SPOTIFY_SCOPES,
)

# Inject sp_oauth into the auth router module so the route handlers can use it
auth.sp_oauth = sp_oauth


def _init_all_schemas() -> None:
    """Create every router's table at startup, eagerly.

    Previously each router created its table lazily on first authenticated
    request (_ensure_schema guarded by a per-process flag). That silently
    failed in two ways: (1) if the very first hit was unauthenticated it 401'd
    before reaching _ensure_schema, and (2) any transient hiccup left the table
    missing with the flag still False, so reads returned an empty list that
    looked exactly like "you have no saved songs". Tables that never got
    created here: saved_songs, player_queue, saint_stats, quiz_results, boards
    — which is why saved songs vanished on reload. Creating them up front, once,
    removes the entire failure class.
    """
    from config import logger
    for mod in (studio, quiz, youtube, saved, player, saint):
        try:
            mod._ensure_schema()
        except Exception as exc:
            logger.error(f"[STARTUP] schema init failed for {mod.__name__}: {exc}")


@asynccontextmanager
async def lifespan(application: FastAPI):
    validate_secrets()
    init_db_pool()
    _init_all_schemas()
    yield
    close_db_pool()


app = FastAPI(lifespan=lifespan)

# Local dev origins are always allowed. Production origins must be supplied
# via the CORS_ORIGINS env var as a comma-separated list, e.g.
#   CORS_ORIGINS=https://moodscape.app,https://www.moodscape.app
# This keeps localhost out of the prod allowlist by default and lets us
# add new domains without a code change.
_dev_origins = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://192.168.29.130:5173",
]
_extra = [o.strip() for o in os.getenv("CORS_ORIGINS", "").split(",") if o.strip()]
origins = _dev_origins + _extra

app.add_middleware(SecurityMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Session-Token"],
)

app.include_router(auth.router)
app.include_router(playlist.router)
app.include_router(mood.router)
app.include_router(studio.router)
app.include_router(quiz.router)
app.include_router(youtube.router)
app.include_router(saved.router)
app.include_router(player.router)
app.include_router(saint.router)
app.include_router(images.router)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)