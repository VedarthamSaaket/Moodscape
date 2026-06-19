/*
 * PixelRadio — chunky 90s boombox in pixel-art SVG. The whole thing is built
 * out of 1x1 <rect> tiles on a 56x40 grid with `shape-rendering="crispEdges"`,
 * so it stays crisp at any scale. Click anywhere on the button to flip the
 * `on` flag — the parent decides what to actually do (mount an iframe, swap
 * an audio src, whatever). This component only renders the radio + animates
 * its LED / speaker-cone "thump" when on.
 */

import React from 'react';
import './PixelRadio.css';

// Palette — cool navy/teal/parchment, color-matched to the app's existing
// CSS variables (--parch #dce8f0, the saved-btn navy rgba(74,127,160,*), the
// generator's deep-blue dither bg). Lets the radio sit inside the page
// instead of fighting it.
const C = {
  outline:   '#050a12',
  bodyHi:    '#27425e',
  bodyMid:   '#152538',
  bodyLo:    '#0e1a26',
  bodyShade: '#070d18',
  speakerRing:  '#080f1a',
  speakerInner: '#03070d',
  speakerCone:  '#1f3852',
  speakerHi:    '#5c8eb8',
  speakerDot:   '#0b1726',
  knob:      '#a8b8c8',
  knobHi:    '#dce8f0',
  knobShade: '#4a5e74',
  ledRedOn:  '#e57878',
  ledRedOff: '#3a1a1a',
  ledAmber:  '#e6c87a',
  ledGreen:  '#7ee8b8',
  ledOff:    '#1a2630',
  lcdBg:     '#0a1e1a',
  lcdOn:     '#7ef0c4',
  lcdDim:    '#1e4038',
  display:   '#0a1418',
  antenna:   '#7a8aa0',
  antennaTip:'#dce8f0',
  handle:    '#1a2c40',
  handleHi:  '#4a7090',
  buttonTop: '#8aa6bc',
  buttonMid: '#4a6a82',
  buttonLo:  '#1a2c3e',
  tapeWindow:'#0a1828',
  tapeReel:  '#a0b4c8',
  tapeReelHole:'#0a1828',
  wave:      '#7ee8b8',
};

// Helper: emit a 1x1 (or w×h) rect.
const Px = ({ x, y, w = 1, h = 1, fill, className }) => (
  <rect x={x} y={y} width={w} height={h} fill={fill} className={className} />
);

// Helper: draw a horizontal run of pixels of one colour.
function HLine({ y, x0, x1, fill, className }) {
  return <Px x={x0} y={y} w={x1 - x0 + 1} h={1} fill={fill} className={className} />;
}

// Octagonal speaker, centred at (cx, cy) with outer radius r.
// Renders concentric octagons so the cone reads as 3D plastic.
function Speaker({ cx, cy, r, on }) {
  const tiles = [];
  // Outer ring — chunky bezel.
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const ax = Math.abs(dx), ay = Math.abs(dy);
      const oct = ax + ay <= r * 1.35 && ax <= r && ay <= r;
      if (!oct) continue;
      const dist = Math.max(ax, ay) + Math.min(ax, ay) * 0.5;
      let fill;
      if (dist >= r - 0.4)            fill = C.outline;
      else if (dist >= r - 1.4)       fill = C.speakerRing;
      else if (dist >= r - 2.4)       fill = C.bodyHi;
      else if (dist >= r - 3.6)       fill = C.speakerCone;
      else if (dist >= r - 5.0)       fill = C.speakerInner;
      else                            fill = C.speakerDot;
      tiles.push({ x: cx + dx, y: cy + dy, fill });
    }
  }
  // Centre highlight catches the light.
  tiles.push({ x: cx - 1, y: cy - 1, fill: C.speakerHi });

  return (
    <g className={on ? 'pr-speaker pr-speaker--on' : 'pr-speaker'}>
      {tiles.map((t, i) => (
        <Px key={i} x={t.x} y={t.y} fill={t.fill} />
      ))}
    </g>
  );
}

// Cassette deck window — a recessed rect with two spinning reels.
function CassetteDeck({ x, y, w, h, on }) {
  return (
    <g>
      {/* recessed frame */}
      <Px x={x} y={y} w={w} h={1} fill={C.outline} />
      <Px x={x} y={y + h - 1} w={w} h={1} fill={C.outline} />
      <Px x={x} y={y} w={1} h={h} fill={C.outline} />
      <Px x={x + w - 1} y={y} w={1} h={h} fill={C.outline} />
      <Px x={x + 1} y={y + 1} w={w - 2} h={h - 2} fill={C.tapeWindow} />
      {/* left reel */}
      <g className={on ? 'pr-reel pr-reel--on' : 'pr-reel'} style={{ transformOrigin: `${x + 3}px ${y + h / 2}px` }}>
        <Px x={x + 2} y={y + 1} w={3} h={1} fill={C.tapeReel} />
        <Px x={x + 2} y={y + h - 2} w={3} h={1} fill={C.tapeReel} />
        <Px x={x + 1} y={y + 2} w={1} h={h - 4} fill={C.tapeReel} />
        <Px x={x + 5} y={y + 2} w={1} h={h - 4} fill={C.tapeReel} />
        <Px x={x + 3} y={y + 2} w={1} h={1} fill={C.tapeReelHole} />
      </g>
      {/* right reel */}
      <g className={on ? 'pr-reel pr-reel--on' : 'pr-reel'}
         style={{ transformOrigin: `${x + w - 4}px ${y + h / 2}px`, animationDirection: 'reverse' }}>
        <Px x={x + w - 5} y={y + 1} w={3} h={1} fill={C.tapeReel} />
        <Px x={x + w - 5} y={y + h - 2} w={3} h={1} fill={C.tapeReel} />
        <Px x={x + w - 6} y={y + 2} w={1} h={h - 4} fill={C.tapeReel} />
        <Px x={x + w - 2} y={y + 2} w={1} h={h - 4} fill={C.tapeReel} />
        <Px x={x + w - 4} y={y + 2} w={1} h={1} fill={C.tapeReelHole} />
      </g>
    </g>
  );
}

// LCD bars across the display — pulse when on like a tiny VU meter.
function VuBars({ x, y, on }) {
  const bars = [3, 5, 7, 4, 6, 8, 5, 3, 6, 7];
  return (
    <g>
      {bars.map((h, i) => (
        <Px
          key={i}
          x={x + i}
          y={y + 8 - h}
          w={1}
          h={h}
          fill={on ? C.lcdOn : C.lcdDim}
          className={on ? `pr-vu pr-vu-${i % 5}` : ''}
        />
      ))}
    </g>
  );
}

export default function PixelRadio({ on, onToggle }) {
  return (
    <button
      type="button"
      className={`pixel-radio ${on ? 'pixel-radio--on' : ''}`}
      onClick={onToggle}
      aria-label={on ? 'Turn radio off' : 'Turn radio on'}
      title={on ? 'Turn radio off' : 'Turn radio on'}
    >
      <svg
        viewBox="-10 0 76 44"
        xmlns="http://www.w3.org/2000/svg"
        shapeRendering="crispEdges"
        className="pixel-radio__svg"
      >
        {/* ── Soundwaves emanating from each speaker ─────────────────── */}
        {on && (
          <g className="pr-waves" stroke={C.wave} fill="none" strokeLinecap="round">
            {/* Left speaker — three arcs sweeping leftward. */}
            <path className="pr-wave pr-wave-0" d="M 1 24 Q -3 24 -5 24" />
            <path className="pr-wave pr-wave-1" d="M 1 21 Q -4 22 -7 23" />
            <path className="pr-wave pr-wave-2" d="M 1 27 Q -4 26 -7 25" />
            {/* Right speaker — three arcs sweeping rightward. */}
            <path className="pr-wave pr-wave-3" d="M 54 24 Q 58 24 60 24" />
            <path className="pr-wave pr-wave-4" d="M 54 21 Q 59 22 62 23" />
            <path className="pr-wave pr-wave-5" d="M 54 27 Q 59 26 62 25" />
          </g>
        )}

        {/* ── Antenna ─────────────────────────────────────────────────── */}
        <Px x={9} y={0} w={1} h={1} fill={C.antennaTip} className={on ? 'pr-antenna-tip' : ''} />
        <Px x={9} y={1} w={1} h={6} fill={C.antenna} />
        <Px x={10} y={6} w={1} h={1} fill={C.antenna} />

        {/* ── Handle (across top centre) ──────────────────────────────── */}
        <Px x={20} y={3} w={16} h={1} fill={C.outline} />
        <Px x={21} y={4} w={14} h={1} fill={C.handle} />
        <Px x={22} y={5} w={12} h={1} fill={C.handleHi} />
        <Px x={20} y={4} w={1} h={2} fill={C.outline} />
        <Px x={35} y={4} w={1} h={2} fill={C.outline} />

        {/* ── Body — chunky rounded rectangle ─────────────────────────── */}
        {/* top edge */}
        <HLine y={6}  x0={3}  x1={52} fill={C.outline} />
        <HLine y={7}  x0={2}  x1={53} fill={C.outline} />
        <HLine y={8}  x0={1}  x1={54} fill={C.outline} />
        {/* sides */}
        {Array.from({ length: 30 }, (_, i) => (
          <React.Fragment key={`side-${i}`}>
            <Px x={0} y={9 + i} fill={C.outline} />
            <Px x={55} y={9 + i} fill={C.outline} />
          </React.Fragment>
        ))}
        {/* bottom edge */}
        <HLine y={39} x0={1}  x1={54} fill={C.outline} />
        <HLine y={40} x0={2}  x1={53} fill={C.outline} />
        <HLine y={41} x0={3}  x1={52} fill={C.outline} />
        {/* fill */}
        <Px x={1} y={9} w={54} h={30} fill={C.bodyMid} />
        {/* top sheen */}
        <HLine y={8}  x0={2}  x1={53} fill={C.bodyHi} />
        <HLine y={9}  x0={1}  x1={54} fill={C.bodyHi} />
        <HLine y={10} x0={1}  x1={54} fill={C.bodyMid} />
        {/* bottom shade */}
        <HLine y={37} x0={1}  x1={54} fill={C.bodyLo} />
        <HLine y={38} x0={1}  x1={54} fill={C.bodyShade} />

        {/* ── Speakers (left + right) ─────────────────────────────────── */}
        <Speaker cx={10} cy={24} r={7} on={on} />
        <Speaker cx={45} cy={24} r={7} on={on} />

        {/* ── Centre panel surround (recessed) ────────────────────────── */}
        <Px x={19} y={11} w={18} h={1} fill={C.outline} />
        <Px x={19} y={11} w={1} h={20} fill={C.outline} />
        <Px x={36} y={11} w={1} h={20} fill={C.outline} />
        <Px x={19} y={31} w={18} h={1} fill={C.outline} />
        <Px x={20} y={12} w={16} h={19} fill={C.bodyLo} />

        {/* LCD display */}
        <Px x={21} y={13} w={14} h={6} fill={C.display} />
        <Px x={22} y={14} w={12} h={4} fill={C.lcdBg} />
        {/* FM/AM tick */}
        <Px x={22} y={14} w={2} h={1} fill={on ? C.lcdOn : C.lcdDim} />
        <Px x={33} y={14} w={1} h={1} fill={on ? C.lcdOn : C.lcdDim} />
        {/* VU bars across the readout */}
        <VuBars x={23} y={14 - 4 + 4} on={on} />

        {/* Cassette deck */}
        <CassetteDeck x={20} y={20} w={16} h={6} on={on} />

        {/* Button strip */}
        <Px x={20} y={27} w={16} h={4} fill={C.bodyShade} />
        {[0, 1, 2, 3, 4].map((i) => (
          <g key={`btn-${i}`}>
            <Px x={21 + i * 3} y={28} w={2} h={1} fill={C.buttonTop} />
            <Px x={21 + i * 3} y={29} w={2} h={1} fill={C.buttonMid} />
            <Px x={21 + i * 3} y={30} w={2} h={1} fill={C.buttonLo} />
          </g>
        ))}

        {/* ── Knobs (left + right of centre panel) ────────────────────── */}
        {[16, 39].map((kx) => (
          <g key={`knob-${kx}`}>
            <Px x={kx - 1} y={33} w={3} h={1} fill={C.outline} />
            <Px x={kx - 2} y={34} w={5} h={1} fill={C.outline} />
            <Px x={kx - 2} y={35} w={5} h={1} fill={C.knob} />
            <Px x={kx - 2} y={36} w={5} h={1} fill={C.knobShade} />
            <Px x={kx - 1} y={34} w={3} h={1} fill={C.knobHi} />
            {/* knob notch */}
            <Px x={kx} y={35} fill={C.outline} />
          </g>
        ))}

        {/* ── LEDs (under the display) ────────────────────────────────── */}
        <g>
          <Px x={22} y={32} fill={on ? C.ledRedOn : C.ledRedOff} className={on ? 'pr-led pr-led--red' : ''} />
          <Px x={22} y={33} fill={C.outline} />

          <Px x={25} y={32} fill={on ? C.ledAmber : C.ledOff} className={on ? 'pr-led pr-led--amber' : ''} />
          <Px x={25} y={33} fill={C.outline} />

          <Px x={28} y={32} fill={on ? C.ledGreen : C.ledOff} className={on ? 'pr-led pr-led--green' : ''} />
          <Px x={28} y={33} fill={C.outline} />
        </g>

        {/* ── Power label dots ────────────────────────────────────────── */}
        <Px x={32} y={32} w={1} h={1} fill={C.bodyHi} />
        <Px x={34} y={32} w={1} h={1} fill={C.bodyHi} />

        {/* ── Feet / stand ─────────────────────────────────────────────── */}
        <Px x={5}  y={42} w={4} h={1} fill={C.outline} />
        <Px x={47} y={42} w={4} h={1} fill={C.outline} />
        <Px x={5}  y={42} w={4} h={1} fill={C.bodyShade} />
        <Px x={47} y={42} w={4} h={1} fill={C.bodyShade} />
      </svg>

      {/* Press hint that only shows when off. */}
      {!on && (
        <span className="pixel-radio__hint">▸ PRESS</span>
      )}
    </button>
  );
}
