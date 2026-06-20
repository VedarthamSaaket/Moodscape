"""Image-search proxy router.

Forwards Unsplash and Pexels search queries through the backend so the
provider API keys never reach the browser. The frontend used to read
VITE_UNSPLASH_KEY / VITE_PEXELS_KEY directly from import.meta.env, which
Vite inlines into the production bundle — anyone could open DevTools and
read them. Routing through the backend means the only thing the client
sees is the public image URL.

The endpoint is rate-limited via the central SecurityMiddleware rule for
/api/images/search so a malicious caller cannot turn the proxy into a
free quota-burner against the provider account.
"""

import os
import logging
from typing import Optional

import requests
from fastapi import APIRouter, HTTPException, Request, Query

from security import (
    require_session_token,
    sanitise_search_token,
)

router = APIRouter()
logger = logging.getLogger("moodscape.images")


_UNSPLASH = "https://api.unsplash.com/search/photos"
_PEXELS   = "https://api.pexels.com/v1/search"


def _unsplash_search(query: str, page: int, per_page: int, orientation: Optional[str]):
    key = os.getenv("UNSPLASH_ACCESS_KEY", "").strip()
    if not key:
        raise HTTPException(status_code=503, detail="Unsplash not configured on server.")
    params = {"query": query, "page": page, "per_page": per_page, "content_filter": "high"}
    if orientation in ("landscape", "portrait", "squarish"):
        params["orientation"] = orientation
    headers = {"Authorization": f"Client-ID {key}", "Accept-Version": "v1"}
    try:
        res = requests.get(_UNSPLASH, headers=headers, params=params, timeout=8)
    except requests.RequestException as exc:
        logger.warning("[IMAGES] Unsplash request failed: %s", exc)
        raise HTTPException(status_code=502, detail="Image provider unavailable.")
    if res.status_code != 200:
        logger.warning("[IMAGES] Unsplash %s for %r", res.status_code, query[:40])
        return []
    data = res.json()
    out = []
    for p in data.get("results", []):
        urls = p.get("urls") or {}
        user = p.get("user") or {}
        out.append({
            "thumb":       urls.get("small"),
            "full":        urls.get("regular"),
            "alt":         p.get("alt_description") or query,
            "attribution": f"{user.get('name', 'Unknown')}, Unsplash",
        })
    return out


def _pexels_search(query: str, page: int, per_page: int, orientation: Optional[str]):
    key = (
        os.getenv("PEXELS_API_KEY")
        or os.getenv("PEXELS_ACCESS_KEY")
        or os.getenv("NEXT_PUBLIC_PEXELS_KEY")
        or ""
    ).strip()
    if not key:
        raise HTTPException(status_code=503, detail="Pexels not configured on server.")
    params = {"query": query, "page": page, "per_page": per_page}
    if orientation in ("landscape", "portrait", "square"):
        params["orientation"] = orientation
    headers = {"Authorization": key}
    try:
        res = requests.get(_PEXELS, headers=headers, params=params, timeout=8)
    except requests.RequestException as exc:
        logger.warning("[IMAGES] Pexels request failed: %s", exc)
        raise HTTPException(status_code=502, detail="Image provider unavailable.")
    if res.status_code != 200:
        logger.warning("[IMAGES] Pexels %s for %r", res.status_code, query[:40])
        return []
    data = res.json()
    out = []
    for p in data.get("photos", []):
        src = p.get("src") or {}
        out.append({
            "thumb":       src.get("medium"),
            "full":        src.get("large"),
            "alt":         p.get("alt") or query,
            "attribution": f"{p.get('photographer', 'Unknown')}, Pexels",
        })
    return out


@router.get("/api/images/search")
def search_images(
    request: Request,
    query:       str           = Query(..., min_length=1, max_length=120),
    source:      str           = Query("unsplash", pattern="^(unsplash|pexels)$"),
    page:        int           = Query(1, ge=1, le=50),
    per_page:    int           = Query(30, ge=1, le=30),
    orientation: Optional[str] = Query(None, pattern="^(landscape|portrait|squarish|square)$"),
):
    """Proxy image-search query to the configured provider.

    Auth: require_session_token in lax mode — anonymous browsing is allowed
    but the request is still rate-limited by IP via SecurityMiddleware.
    """
    require_session_token(request, lax=True)

    safe_query = sanitise_search_token(query, "query", max_len=120)
    if not safe_query:
        raise HTTPException(status_code=400, detail="Empty query.")

    if source == "unsplash":
        results = _unsplash_search(safe_query, page, per_page, orientation)
    else:
        results = _pexels_search(safe_query, page, per_page, orientation)

    return {"source": source, "query": safe_query, "page": page, "results": results}
