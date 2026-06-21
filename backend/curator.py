"""Curator-account Spotify access.

The M&M app no longer asks end users to log in with Spotify (Spotify dev-mode
caps such apps at 5 allow-listed users with no path forward for individuals).
Instead, EVERY generated playlist is written to a single dedicated Spotify
account — the "curator" — and made unlisted (`public=False`), so anyone with
the share URL can open and follow it, but the curator's profile stays empty
of other generated playlists.

This module holds the curator's long-lived refresh token (env:
CURATOR_REFRESH_TOKEN), exchanges it for short-lived access tokens on demand,
caches them in-process, and exposes the curator's Spotify user_id for
playlist-creation calls.
"""
import time
import base64
import threading

import requests
from fastapi import HTTPException

from config import logger, SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET, CURATOR_REFRESH_TOKEN


_token_cache = {"access_token": None, "expires_at": 0.0}
_token_lock  = threading.Lock()

_user_cache = {"user_id": None, "display_name": None}
_user_lock  = threading.Lock()


def get_curator_access_token() -> str:
    """Return a fresh access token for the curator account. Refreshes via
    Spotify's token endpoint when the cached one is within 60s of expiry."""
    now = time.time()
    with _token_lock:
        if _token_cache["access_token"] and now < _token_cache["expires_at"] - 60:
            return _token_cache["access_token"]

        if not CURATOR_REFRESH_TOKEN:
            raise HTTPException(
                status_code=503,
                detail="Curator account not configured on the server.",
            )
        if not SPOTIFY_CLIENT_ID or not SPOTIFY_CLIENT_SECRET:
            raise HTTPException(
                status_code=503,
                detail="Spotify app credentials not configured.",
            )

        basic = base64.b64encode(
            f"{SPOTIFY_CLIENT_ID}:{SPOTIFY_CLIENT_SECRET}".encode()
        ).decode()
        try:
            res = requests.post(
                "https://accounts.spotify.com/api/token",
                headers={
                    "Authorization": f"Basic {basic}",
                    "Content-Type":  "application/x-www-form-urlencoded",
                },
                data={
                    "grant_type":    "refresh_token",
                    "refresh_token": CURATOR_REFRESH_TOKEN,
                },
                timeout=8,
            )
            res.raise_for_status()
            data = res.json()
        except Exception as exc:
            logger.error(f"[CURATOR] refresh failed: {exc}")
            raise HTTPException(status_code=503, detail="Could not authenticate curator with Spotify.")

        _token_cache["access_token"] = data["access_token"]
        _token_cache["expires_at"]   = now + data.get("expires_in", 3600)
        return _token_cache["access_token"]


def get_curator_user_id() -> str:
    """Return the curator account's Spotify user_id, cached after first lookup."""
    with _user_lock:
        if _user_cache["user_id"]:
            return _user_cache["user_id"]

    token = get_curator_access_token()
    try:
        res = requests.get(
            "https://api.spotify.com/v1/me",
            headers={"Authorization": f"Bearer {token}"},
            timeout=8,
        )
        res.raise_for_status()
        data = res.json()
    except Exception as exc:
        logger.error(f"[CURATOR] /me lookup failed: {exc}")
        raise HTTPException(status_code=503, detail="Could not resolve curator profile.")

    with _user_lock:
        _user_cache["user_id"]      = data.get("id")
        _user_cache["display_name"] = data.get("display_name")
    return _user_cache["user_id"]


def _safe_playlist_text(s: str, max_len: int) -> str:
    """Strip characters Spotify's playlist API rejects (vague HTTP 400 with no
    detail). Pipes, ampersands and angle brackets are the common offenders;
    Spotify treats some as markup and rejects the whole body. Also trims to the
    documented max length (100 for name, 300 for description)."""
    if not s:
        return ""
    # Replace problematic chars with safe equivalents; collapse whitespace.
    cleaned = (s
        .replace("|", "-")
        .replace("<", "")
        .replace(">", "")
        .replace("\r", " ")
        .replace("\n", " ")
        .replace('"', "'")
    )
    cleaned = " ".join(cleaned.split())
    return cleaned[:max_len].strip()


def create_curator_playlist(name: str, description: str) -> dict:
    """Create an UNLISTED playlist on the curator account.

    `public=False` is Spotify's "unlisted" mode — playlist is NOT shown on the
    curator's public profile, but IS reachable via direct share URL by anyone
    (Spotify treats the URL as a capability token). This is exactly what we
    want: each user sees only the playlist they generated when they open the
    link, and curator profile pollution stays at zero.
    """
    token   = get_curator_access_token()
    user_id = get_curator_user_id()

    safe_name = _safe_playlist_text(name, 100) or "Playlist"
    safe_desc = _safe_playlist_text(description, 300)

    body = {"name": safe_name, "description": safe_desc, "public": False}
    logger.info(f"[CURATOR] creating playlist user_id={user_id!r} name={safe_name!r} desc_len={len(safe_desc)}")
    res = requests.post(
        f"https://api.spotify.com/v1/users/{user_id}/playlists",
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        json=body,
        timeout=10,
    )
    if res.status_code not in (200, 201):
        logger.error(
            f"[CURATOR] create playlist failed: HTTP {res.status_code} "
            f"body_sent={body} response={res.text[:400]}"
        )
        raise HTTPException(status_code=502, detail="Could not create playlist on curator account.")
    return res.json()


def add_tracks_curator(playlist_id: str, track_uris: list[str]) -> None:
    """Add tracks to a curator-owned playlist in 100-URI batches."""
    if not track_uris:
        return
    token = get_curator_access_token()
    for i in range(0, len(track_uris), 100):
        batch = track_uris[i:i + 100]
        res = requests.post(
            f"https://api.spotify.com/v1/playlists/{playlist_id}/tracks",
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
            json={"uris": batch},
            timeout=10,
        )
        if res.status_code not in (200, 201):
            logger.error(f"[CURATOR] add tracks failed: HTTP {res.status_code} {res.text[:200]}")
            raise HTTPException(status_code=502, detail="Could not add tracks to playlist.")


def remove_tracks_curator(playlist_id: str, track_uris: list[str]) -> None:
    """Remove tracks from a curator-owned playlist."""
    if not track_uris:
        return
    token = get_curator_access_token()
    res = requests.delete(
        f"https://api.spotify.com/v1/playlists/{playlist_id}/tracks",
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        json={"tracks": [{"uri": u} for u in track_uris]},
        timeout=10,
    )
    if res.status_code not in (200, 201):
        logger.warning(f"[CURATOR] remove tracks failed: HTTP {res.status_code} {res.text[:200]}")


def upload_cover_curator(playlist_id: str, jpeg_base64: str, max_attempts: int = 5) -> bool:
    """Upload a JPEG cover (base64, no data: prefix) to a curator playlist.

    Spotify's create-playlist write and the /images read endpoint hit
    different replicas, so a same-tick upload often 404s ("playlist not
    found") even though the playlist exists. Retry on 404 with backoff.
    Returns True on success, False if all retries failed (cover upload is
    best-effort — playlist is fine without it).
    """
    if not jpeg_base64:
        return False
    token = get_curator_access_token()
    for attempt in range(max_attempts):
        try:
            res = requests.put(
                f"https://api.spotify.com/v1/playlists/{playlist_id}/images",
                headers={"Authorization": f"Bearer {token}", "Content-Type": "image/jpeg"},
                data=jpeg_base64,
                timeout=10,
            )
            if res.status_code in (200, 202):
                return True
            if res.status_code == 404 and attempt < max_attempts - 1:
                wait = 1.5 * (attempt + 1)
                logger.info(f"[CURATOR] cover 404 (replica lag), retrying in {wait}s")
                time.sleep(wait)
                continue
            logger.warning(f"[CURATOR] cover upload rejected: HTTP {res.status_code} {res.text[:200]}")
            return False
        except Exception as exc:
            logger.warning(f"[CURATOR] cover upload error: {exc}")
            return False
    return False
