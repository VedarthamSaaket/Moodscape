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
from routers import auth, playlist, mood


sp_oauth = SpotifyOAuth(
    client_id=SPOTIFY_CLIENT_ID,
    client_secret=SPOTIFY_CLIENT_SECRET,
    redirect_uri=SPOTIFY_REDIRECT_URI,
    scope=SPOTIFY_SCOPES,
)

# Inject sp_oauth into the auth router module so the route handlers can use it
auth.sp_oauth = sp_oauth


@asynccontextmanager
async def lifespan(application: FastAPI):
    validate_secrets()
    init_db_pool()
    yield
    close_db_pool()


app = FastAPI(lifespan=lifespan)

origins = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://192.168.29.130:5173",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Session-Token"],
)
app.add_middleware(SecurityMiddleware)

app.include_router(auth.router)
app.include_router(playlist.router)
app.include_router(mood.router)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)