/*
 * GlobalRadio — the audio host for the pixel boombox on the Saved page.
 * Mounted ONCE at the app root (outside the <Routes> boundary), so the
 * lofi stream keeps playing as the user navigates between /generator, /quiz,
 * /moodboard, /saved etc. The visible radio UI on the Saved page only flips
 * a flag in `useRadioStore`; this component is what actually owns the player.
 *
 * iOS Safari autoplay rule: audio may only START from inside a user-gesture
 * window. A raw <iframe src="...autoplay=1"> does NOT satisfy this — iOS
 * ignores the embed's autoplay param and a delayed postMessage(playVideo)
 * lands AFTER the gesture window has closed, so the radio stayed silent on
 * iPhone while the rest of the app's music (which uses the YouTube IFrame
 * *API* and calls playVideo() synchronously in the click handler) played fine.
 *
 * Fix: use the same YouTube IFrame Player API here. The radio store's `on`
 * flag is flipped synchronously inside the PixelRadio tap; the effect below
 * runs in that same gesture-driven render and calls playVideo() on the live
 * player instance — exactly the path GlobalPlayer uses — so iOS allows audio.
 */

import React, { useEffect, useRef } from 'react';
import useRadioStore from '../store/radioStore';

const RADIO_VIDEO_ID = 'tRsQsTMvPNg'; // 24/7 lofi hip hop radio

// ── Load the YouTube IFrame Player API exactly once (shared with GlobalPlayer
// via the same window.onYouTubeIframeAPIReady chain / dedup by element id). ──
let ytApiPromise = null;
function loadYouTubeAPI() {
  if (ytApiPromise) return ytApiPromise;
  ytApiPromise = new Promise((resolve) => {
    if (window.YT && window.YT.Player) {
      resolve(window.YT);
      return;
    }
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      if (typeof prev === 'function') prev();
      resolve(window.YT);
    };
    if (!document.getElementById('youtube-iframe-api')) {
      const tag = document.createElement('script');
      tag.id = 'youtube-iframe-api';
      tag.src = 'https://www.youtube.com/iframe_api';
      document.head.appendChild(tag);
    }
  });
  return ytApiPromise;
}

export default function GlobalRadio() {
  const on = useRadioStore((s) => s.on);

  const hostRef     = useRef(null);   // stable wrapper React owns
  const playerRef   = useRef(null);   // YT.Player instance
  const readyRef    = useRef(false);  // player onReady fired
  const wantOnRef   = useRef(on);     // latest desired state for async callbacks

  // Create the player once, on first mount. It's created paused/cued; we only
  // call playVideo() in response to the `on` toggle so iOS sees a gesture.
  useEffect(() => {
    let cancelled = false;
    loadYouTubeAPI().then((YT) => {
      if (cancelled || playerRef.current || !hostRef.current) return;
      const mount = document.createElement('div');
      hostRef.current.appendChild(mount);
      playerRef.current = new YT.Player(mount, {
        height: '180',
        width: '320',
        videoId: RADIO_VIDEO_ID,
        playerVars: {
          autoplay: 0,
          controls: 0,
          rel: 0,
          playsinline: 1,      // never go fullscreen on iOS
          modestbranding: 1,
        },
        events: {
          onReady: (e) => {
            readyRef.current = true;
            // If the user already turned the radio on before the API finished
            // loading, honour it now. (May be blocked by iOS if the gesture
            // window has closed, but the toggle effect retries on every flip.)
            if (wantOnRef.current) {
              try { e.target.playVideo(); } catch { /* ignore */ }
            }
          },
        },
      });
    });
    return () => { cancelled = true; };
  }, []);

  // React to the on/off toggle. This effect runs in the same render the
  // PixelRadio tap triggered, so playVideo() lands inside the iOS gesture
  // window — the whole reason the raw-iframe approach failed before.
  useEffect(() => {
    wantOnRef.current = on;
    const p = playerRef.current;
    if (!p || !readyRef.current) return; // onReady will pick up wantOnRef
    try {
      if (on) p.playVideo();
      else p.pauseVideo();
    } catch { /* player not fully ready — onReady covers the on case */ }
  }, [on]);

  return (
    <div
      aria-hidden="true"
      style={{
        // Visible on-screen but tiny in the bottom-left corner. iOS treats a
        // truly hidden iframe (display:none / 0×0 / visibility:hidden) as
        // background and suspends audio, so we keep a real, non-zero pixel
        // footprint with near-zero opacity instead.
        position:      'fixed',
        left:          0,
        bottom:        0,
        width:         2,
        height:        2,
        opacity:       0.01,
        pointerEvents: 'none',
        overflow:      'hidden',
        zIndex:        -1,
      }}
    >
      <div ref={hostRef} />
    </div>
  );
}
