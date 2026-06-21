"""Browser-only bootstrap for the M&M curator Spotify refresh token.

Hit GET /api/curator/login in a browser → sign in as the curator account →
HTML page renders the refresh_token in a copyable box. Paste it into
Render env as CURATOR_REFRESH_TOKEN, redeploy, done.

Safe to leave exposed: the refresh token is useless to anyone who doesn't
also have your SPOTIFY_CLIENT_SECRET. Whoever runs the flow signs in with
their OWN Spotify account and gets their OWN refresh token displayed —
they cannot extract the curator's token unless they're the one logged in
as the curator. After CURATOR_REFRESH_TOKEN is set in env, you can
optionally set CURATOR_BOOTSTRAP_DISABLED=1 to 404 these routes.
"""
import os
import base64
import urllib.parse

import requests
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import HTMLResponse, RedirectResponse

from config import logger, SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET

router = APIRouter()

# Same scopes the curator account needs to function as a write target for
# the M&M app: create/modify private+public playlists and upload cover art.
_CURATOR_SCOPES = "playlist-modify-public playlist-modify-private ugc-image-upload"


def _bootstrap_enabled() -> None:
    if os.getenv("CURATOR_BOOTSTRAP_DISABLED", "").strip() == "1":
        raise HTTPException(status_code=404, detail="Not found")


def _redirect_uri(request: Request) -> str:
    """Build the absolute callback URL from the incoming request. Must match
    EXACTLY one of the Redirect URIs registered in the Spotify Dashboard."""
    # request.url_for handles scheme + host correctly under Render's proxy.
    return str(request.url_for("curator_bootstrap_callback"))


@router.get("/api/curator/login")
def curator_login(request: Request):
    """Redirect the browser to Spotify's authorize page with curator scopes.
    Sign in there as the dedicated M&M curator account."""
    _bootstrap_enabled()
    if not SPOTIFY_CLIENT_ID:
        raise HTTPException(status_code=503, detail="SPOTIFY_CLIENT_ID not configured")

    params = {
        "client_id":     SPOTIFY_CLIENT_ID,
        "response_type": "code",
        "redirect_uri":  _redirect_uri(request),
        "scope":         _CURATOR_SCOPES,
        # Force the account picker — without this, Spotify silently reuses an
        # existing cookie session, which usually means signing in as your
        # personal account by mistake instead of the dedicated curator one.
        "show_dialog":   "true",
    }
    url = "https://accounts.spotify.com/authorize?" + urllib.parse.urlencode(params)
    return RedirectResponse(url=url)


@router.get("/api/curator/callback", name="curator_bootstrap_callback")
def curator_callback(request: Request, code: str = "", error: str = ""):
    """Exchange the auth code for a refresh token and render it in HTML for
    one-time copy-paste into env. Does NOT persist anything server-side."""
    _bootstrap_enabled()

    if error:
        return HTMLResponse(
            f"<h2>Authorization cancelled</h2><p>Spotify returned: {error}</p>"
            f"<p><a href='/api/curator/login'>Try again</a></p>",
            status_code=400,
        )
    if not code:
        raise HTTPException(status_code=400, detail="Missing code")

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
                "grant_type":    "authorization_code",
                "code":          code,
                "redirect_uri":  _redirect_uri(request),
            },
            timeout=10,
        )
        res.raise_for_status()
        data = res.json()
    except Exception as exc:
        logger.error(f"[CURATOR-BOOTSTRAP] token exchange failed: {exc}")
        return HTMLResponse(
            f"<h2>Token exchange failed</h2><pre>{exc}</pre>",
            status_code=502,
        )

    refresh = data.get("refresh_token", "")
    access  = data.get("access_token",  "")

    # Pull the account's display name so the user can SANITY-CHECK they
    # actually signed in as the curator account and not, say, their personal
    # Spotify by accident.
    display = "(unknown)"
    try:
        me = requests.get(
            "https://api.spotify.com/v1/me",
            headers={"Authorization": f"Bearer {access}"},
            timeout=5,
        ).json()
        display = me.get("display_name") or me.get("id") or "(unknown)"
    except Exception:
        pass

    html = f"""<!doctype html>
<html><head><meta charset="utf-8"><title>M&M Curator Bootstrap</title>
<style>
  body {{ font-family: -apple-system, system-ui, sans-serif; max-width: 760px; margin: 40px auto; padding: 0 20px; color: #111; background: #f7f7f8; }}
  h1 {{ font-size: 22px; }}
  .ok {{ background: #d1fae5; padding: 10px 14px; border-radius: 8px; color: #065f46; }}
  .warn {{ background: #fef3c7; padding: 10px 14px; border-radius: 8px; color: #92400e; }}
  textarea {{ width: 100%; height: 80px; padding: 10px; font: 14px/1.4 ui-monospace, Menlo, monospace; border: 1px solid #d1d5db; border-radius: 8px; box-sizing: border-box; }}
  code {{ background: #e5e7eb; padding: 2px 6px; border-radius: 4px; }}
  button {{ background: #111827; color: #fff; border: 0; padding: 10px 16px; border-radius: 8px; cursor: pointer; font-size: 14px; }}
  ol li {{ margin: 8px 0; }}
</style></head><body>
<h1>M&amp;M curator account bootstrap</h1>
<p class="ok">✓ Signed in as: <strong>{display}</strong></p>
{('<p class="warn">⚠ This does NOT look like a dedicated curator account. Cancel and re-run the flow signing in as the M&amp;M curator account.</p>' if display.lower() not in ('m&m','m&amp;m','mm','moodscape','m & m') else '')}
<h2>Your refresh token</h2>
<textarea readonly onclick="this.select()">{refresh}</textarea>
<p><button onclick="navigator.clipboard.writeText(document.querySelector('textarea').value); this.textContent='Copied!'">Copy to clipboard</button></p>
<h2>Next steps</h2>
<ol>
  <li>Open your Render service dashboard → <strong>Environment</strong>.</li>
  <li>Add a new env var: <code>CURATOR_REFRESH_TOKEN</code> = (paste the token above).</li>
  <li>Save → Render redeploys automatically.</li>
  <li>(Optional) Add <code>CURATOR_BOOTSTRAP_DISABLED=1</code> to 404 this page after setup.</li>
</ol>
<p style="color:#6b7280;font-size:13px">This page does not persist the token server-side. Refresh tokens are useless without your SPOTIFY_CLIENT_SECRET, so leaving this route exposed is safe — but disabling it after use is good hygiene.</p>
</body></html>"""
    return HTMLResponse(html)
