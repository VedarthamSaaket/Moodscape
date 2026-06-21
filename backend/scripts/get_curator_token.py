"""One-time bootstrap: get a refresh_token for the M&M curator Spotify account.

USAGE:
    1. Make sure you've created a fresh dedicated Spotify account for M&M
       (e.g. m.and.m.curator@gmail.com) and set its display name to "M&M".
    2. In Spotify Developer Dashboard → your app → User Management, add the
       curator account's email so the OAuth grant goes through under dev mode.
    3. From the backend/ directory run:
           python scripts/get_curator_token.py
       The script reads SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET and
       SPOTIFY_REDIRECT_URI from your .env (same vars the app uses).
    4. A browser window opens to Spotify. SIGN IN AS THE CURATOR ACCOUNT
       (not your personal one). Grant the scopes.
    5. Script prints:
           CURATOR_REFRESH_TOKEN=AQAB...
    6. Paste that into Render env (and your local .env if testing locally).
    7. Redeploy. Curator account is now wired up — every generated playlist
       lands on it, unlisted, share URL returned to the user.

The refresh token does NOT expire unless the curator revokes app access from
their Spotify account settings, so this is a one-time setup.
"""
import os
import sys

# Allow running this from backend/ — add parent to sys.path so config imports.
_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(_HERE))

from dotenv import load_dotenv
from spotipy.oauth2 import SpotifyOAuth

load_dotenv()

CLIENT_ID     = os.getenv("SPOTIFY_CLIENT_ID")
CLIENT_SECRET = os.getenv("SPOTIFY_CLIENT_SECRET")
REDIRECT_URI  = os.getenv("SPOTIFY_REDIRECT_URI")

# Same write+read scopes the user-OAuth flow used to request — curator needs
# all of them so the backend can create playlists, add/remove tracks, and
# upload covers on the curator's own account.
SCOPES = "playlist-modify-public playlist-modify-private ugc-image-upload"


def main() -> None:
    if not all([CLIENT_ID, CLIENT_SECRET, REDIRECT_URI]):
        print("ERROR: SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET, SPOTIFY_REDIRECT_URI must be set in .env")
        sys.exit(1)

    oauth = SpotifyOAuth(
        client_id     = CLIENT_ID,
        client_secret = CLIENT_SECRET,
        redirect_uri  = REDIRECT_URI,
        scope         = SCOPES,
        # Local cache file, ignored after we extract the refresh_token.
        cache_path    = ".curator_oauth_cache",
        open_browser  = True,
    )

    print("\nOpening browser. SIGN IN AS THE CURATOR ACCOUNT (display name 'M&M').\n")
    token_info = oauth.get_access_token(as_dict=True)
    refresh    = token_info.get("refresh_token")
    if not refresh:
        print("ERROR: no refresh_token returned. Re-run.")
        sys.exit(1)

    print("\n" + "=" * 60)
    print("SUCCESS — paste this line into Render env (and local .env):")
    print("=" * 60)
    print(f"CURATOR_REFRESH_TOKEN={refresh}")
    print("=" * 60)
    print("\nThen delete the local cache file:  rm .curator_oauth_cache\n")


if __name__ == "__main__":
    main()
