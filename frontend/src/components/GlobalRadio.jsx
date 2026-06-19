/*
 * GlobalRadio — the off-screen audio host for the pixel boombox on the Saved
 * page. Mounted ONCE at the app root (outside the <Routes> boundary), so the
 * lofi stream keeps playing as the user navigates between /generator, /quiz,
 * /moodboard, /saved etc. The visible radio UI on the Saved page only flips
 * a flag in `useRadioStore`; this component is what actually owns the iframe.
 *
 * Hidden visually (position fixed off-screen, opacity 0, pointer-events none)
 * but mounted at real dimensions so the browser doesn't suspend its audio.
 */

import React from 'react';
import useRadioStore from '../store/radioStore';

const RADIO_EMBED_URL =
  'https://www.youtube.com/embed/tRsQsTMvPNg?autoplay=1&rel=0&playsinline=1';

export default function GlobalRadio() {
  const on = useRadioStore((s) => s.on);
  if (!on) return null;

  return (
    <div
      aria-hidden="true"
      style={{
        position:      'fixed',
        left:          '-10000px',
        top:           0,
        width:         320,
        height:        180,
        opacity:       0,
        pointerEvents: 'none',
        overflow:      'hidden',
      }}
    >
      <iframe
        src={RADIO_EMBED_URL}
        title="Lofi radio audio"
        width="320"
        height="180"
        frameBorder="0"
        allow="autoplay; encrypted-media"
        tabIndex={-1}
        style={{ border: 0, display: 'block' }}
      />
    </div>
  );
}
