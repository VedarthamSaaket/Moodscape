/*
 * PixelRadio — pixel-art boombox on the Saved page.
 *
 * Shape + structure: a classic boombox silhouette (slanted antenna top-left,
 * short carry handle top-centre, a wide horizontal display strip, two square
 * speaker grilles on the bottom-left, a circular tuning knob on the right,
 * a small button row in the middle, two stubby feet).
 *
 * Size: small. The SVG renders at ~180px so it sits comfortably in the
 * Saved page's left rail without dominating.
 *
 * Colour: app palette — cool navy body, parchment trim, mint accents for the
 * "live" LEDs and LCD bars. No purples / oranges; the radio reads as part of
 * the page, not a transplanted asset.
 *
 * On state: the whole radio bobs in pixel-y discrete steps (Claude-pet
 * style), LEDs blink, cassette reels turn, VU bars dance, and a handful of
 * tiny music-note glyphs drift up + fade above it.
 */

import React from 'react';
import './PixelRadio.css';

// Palette — kept in the app's cool navy / parchment / mint vocabulary.
const C = {
  outline:   '#050a12',
  bodyHi:    '#3a5a78',
  bodyMid:   '#1f3552',
  bodyLo:    '#152538',
  bodyShade: '#0a1422',

  handle:    '#1f3552',
  handleHi:  '#4a7090',
  antenna:   '#7a8aa0',
  antennaTip:'#dce8f0',

  displayBg:    '#0a1418',
  displayFrame: '#27425e',
  /* Soft cyan accent — matches the LCD/dots/buttons palette from the
     reference image. Applied to the LCD bars, the "FM" tick dots, the
     four power-label dots, and the floating music-note glyphs so the
     whole "live" signal reads as one colour family. */
  displayBar:   '#88d8e8',
  displayBarDim:'#1e3c44',
  displayAccent:'#d8746e',

  speakerFrame:  '#0a1828',
  speakerCell:   '#27425e',
  speakerCellLo: '#152538',
  speakerCellHi: '#5c8eb8',

  knobRim:   '#050a12',
  knob:      '#a8b8c8',
  knobHi:    '#dce8f0',
  knobShade: '#4a5e74',
  knobNotch: '#152538',

  buttonHi:  '#8aa6bc',
  buttonMid: '#4a6a82',
  buttonLo:  '#1a2c3e',

  ledRedOn:  '#e57878',
  ledRedOff: '#3a1a1a',
  ledAmber:  '#e6c87a',
  ledOff:    '#1a2630',

  foot:      '#050a12',
  footHi:    '#27425e',

  // Notes use a warm amber from the palette (cousin of the LED amber) — pulls
  // the eye against the cool navy body without colliding with the cyan LCD
  // family. Reads as honey / soft gold.
  note:      '#f4d39a',
};

// 1×1 (or w×h) pixel rect helper.
const Px = ({ x, y, w = 1, h = 1, fill, className }) => (
  <rect x={x} y={y} width={w} height={h} fill={fill} className={className} />
);

// Filled rectangle outlined in a 1-px frame. Saves a dozen rects per region.
function Box({ x, y, w, h, fill, stroke }) {
  return (
    <>
      <Px x={x} y={y} w={w} h={1} fill={stroke} />
      <Px x={x} y={y + h - 1} w={w} h={1} fill={stroke} />
      <Px x={x} y={y} w={1} h={h} fill={stroke} />
      <Px x={x + w - 1} y={y} w={1} h={h} fill={stroke} />
      <Px x={x + 1} y={y + 1} w={w - 2} h={h - 2} fill={fill} />
    </>
  );
}

// Pixel speaker grille — checker dots on a darker recessed plate.
function SpeakerSquare({ x, y, size, on }) {
  const cells = [];
  // Background plate.
  cells.push(<Box key="frame" x={x} y={y} w={size} h={size}
                   fill={C.speakerFrame} stroke={C.outline} />);
  // Inner grid of 3x3 cells, slight checker pattern for that 90s grille feel.
  const cellSize = Math.floor((size - 4) / 3);
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      const cx = x + 2 + col * cellSize;
      const cy = y + 2 + row * cellSize;
      const checker = (row + col) % 2 === 0;
      const fill = checker ? C.speakerCell : C.speakerCellLo;
      cells.push(<Px key={`c-${row}-${col}`} x={cx} y={cy}
                     w={cellSize} h={cellSize} fill={fill} />);
      // Tiny highlight pixel per cell.
      if (checker) {
        cells.push(<Px key={`h-${row}-${col}`} x={cx} y={cy}
                       w={1} h={1} fill={C.speakerCellHi} />);
      }
    }
  }
  return (
    <g className={on ? 'pr-speaker pr-speaker--on' : 'pr-speaker'}>
      {cells}
    </g>
  );
}

// Round-ish tuning knob (octagonal on a pixel grid) with a notch.
function Knob({ cx, cy, r, on }) {
  const tiles = [];
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const ax = Math.abs(dx), ay = Math.abs(dy);
      if (ax + ay > r + Math.floor(r / 2)) continue;
      const dist = Math.max(ax, ay) + Math.min(ax, ay) * 0.5;
      let fill;
      if (dist >= r)          fill = C.knobRim;
      else if (dist >= r - 1) fill = C.knobShade;
      else if (dy < 0)        fill = C.knobHi;
      else                    fill = C.knob;
      tiles.push({ x: cx + dx, y: cy + dy, fill });
    }
  }
  // Notch indicator — points to roughly 2 o'clock when on, 12 o'clock when
  // off. Just a single dark pixel offset from centre.
  const notchX = on ? cx + 1 : cx;
  const notchY = on ? cy - 1 : cy - r + 1;
  tiles.push({ x: notchX, y: notchY, fill: C.knobNotch });

  return (
    <g>
      {tiles.map((t, i) => (
        <Px key={i} x={t.x} y={t.y} fill={t.fill} />
      ))}
    </g>
  );
}

// Five LCD VU bars pulse when on.
function VuBars({ x, y, on }) {
  const heights = [2, 3, 4, 3, 2];
  return (
    <g>
      {heights.map((h, i) => (
        <Px
          key={i}
          x={x + i * 2}
          y={y + 4 - h}
          w={1}
          h={h}
          fill={on ? C.displayBar : C.displayBarDim}
          className={on ? `pr-vu pr-vu-${i % 5}` : ''}
        />
      ))}
    </g>
  );
}

// Floating music notes drifting outward from all four sides of the radio.
// Each glyph has its own size (kept in a petite 2.6..4.2 SVG-unit range —
// the radio itself is small, the wash of notes should be cuter than it),
// start position, stagger delay, and drift direction (`side`):
//
//   top    — drifts up-and-slightly-swaying
//   bottom — drifts down
//   left   — drifts out to the left
//   right  — drifts out to the right
// Vector quarter-note glyph drawn with SVG paths instead of the ♪/♫/♬
// Unicode characters. iOS substitutes those characters with its Apple Color
// Emoji font when rendered inside <text>, so on iPhone they showed as full
// colour emoji instead of the cool single-colour pixel notes the desktop
// shows. Vector paths bypass the font stack entirely.
function NoteSingle({ scale = 1, fill }) {
  // Unit shape sized for a 6-unit drawing area; we transform-scale to taste.
  return (
    <g transform={`scale(${scale * 0.10})`}>
      {/* note head (filled ellipse) */}
      <ellipse cx="14" cy="40" rx="9" ry="6.5" fill={fill} transform="rotate(-22 14 40)" />
      {/* stem */}
      <rect x="20" y="6" width="3.2" height="34" fill={fill} />
      {/* small flag */}
      <path d="M23 6 C 32 12, 32 22, 23 26 Z" fill={fill} />
    </g>
  );
}

function NoteBeamed({ scale = 1, fill }) {
  return (
    <g transform={`scale(${scale * 0.10})`}>
      {/* two heads */}
      <ellipse cx="10" cy="42" rx="8" ry="5.8" fill={fill} transform="rotate(-22 10 42)" />
      <ellipse cx="34" cy="44" rx="8" ry="5.8" fill={fill} transform="rotate(-22 34 44)" />
      {/* two stems */}
      <rect x="16" y="10" width="2.8" height="34" fill={fill} />
      <rect x="40" y="12" width="2.8" height="34" fill={fill} />
      {/* connecting beam */}
      <path d="M16 10 L43 12 L43 18 L16 16 Z" fill={fill} />
    </g>
  );
}

// Tiny seeded PRNG (mulberry32). Used so the note field below is generated
// ONCE at module load with stable-but-irregular values — the notes must not
// re-roll their positions on every React repaint (they'd visibly teleport),
// yet they shouldn't sit on a tidy grid either.
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// The note field — scattered around the WHOLE perimeter (all four edges, so
// corners get natural overlap), at JITTERED positions and WIDELY varied sizes.
// The point is imperfection: uneven spacing, mixed sizes from petite to bold,
// no two trajectories alike. Counts differ per edge so no side mirrors another.
const NOTE_FIELD = (() => {
  const rnd   = mulberry32(0x5eed1337);
  const pick  = (arr) => arr[Math.floor(rnd() * arr.length)];
  const range = (lo, hi) => lo + rnd() * (hi - lo);

  // Radio silhouette bounds inside the 50×44 viewBox.
  const L = 3, R = 47, T = 12, B = 40;
  const variants = ['a', 'b', 'c'];

  // Irregular per-edge counts — deliberately not symmetric.
  const edges = [
    { side: 'up',    n: 5 },
    { side: 'right', n: 4 },
    { side: 'down',  n: 3 },
    { side: 'left',  n: 4 },
  ];

  const out = [];
  edges.forEach(({ side, n }) => {
    for (let i = 0; i < n; i++) {
      // Start from an even slot, then jitter HARD so spacing reads uneven.
      const f = Math.min(0.96, Math.max(0.04, (i + 0.5) / n + range(-0.18, 0.18)));
      let x, y;
      if (side === 'up')    { x = L + f * (R - L); y = T + range(-1.5, 2); }
      if (side === 'down')  { x = L + f * (R - L); y = B + range(-2, 1.5); }
      if (side === 'left')  { x = L + range(-1.5, 2); y = T + f * (B - T); }
      if (side === 'right') { x = R + range(-2, 1.5); y = T + f * (B - T); }
      out.push({
        side,
        x: +x.toFixed(2),
        y: +y.toFixed(2),
        // Wide, lumpy size band — squaring the roll biases toward small notes
        // with the occasional bold one, so the wash never looks uniform.
        scale: +(0.16 + Math.pow(rnd(), 1.7) * 0.62).toFixed(3),
        kind: rnd() < 0.34 ? 'beamed' : 'single',
        variant: pick(variants),
        delay: `${(+range(0, 2.6).toFixed(2))}s`,
      });
    }
  });
  return out;
})();

function MusicNotes() {
  const notes = NOTE_FIELD;

  return (
    <g className="pr-notes">
      {notes.map((n, i) => (
        // Outer <g> holds the static placement; inner <g> takes the CSS
        // animation class. Splitting them is required because the animation
        // sets its own `transform`, which would otherwise wipe out a static
        // transform on the same element and collapse every note to (0,0).
        <g key={i} transform={`translate(${n.x} ${n.y})`}>
          <g
            className={`pr-note pr-note--${n.side} pr-note--${n.side}-${n.variant}`}
            style={{ animationDelay: n.delay }}
          >
            {n.kind === 'beamed'
              ? <NoteBeamed scale={n.scale} fill={C.note} />
              : <NoteSingle scale={n.scale} fill={C.note} />}
          </g>
        </g>
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
        viewBox="0 0 50 44"
        xmlns="http://www.w3.org/2000/svg"
        shapeRendering="crispEdges"
        className="pixel-radio__svg"
        draggable="false"
      >
        {/* Floating music notes — drawn first so they sit "behind" the radio
            in the SVG stacking order but visually above thanks to their y
            positions; only animated when on. */}
        {on && <MusicNotes />}

        {/* ── Antenna (slanted up-left) ──────────────────────────────── */}
        <Px x={5}  y={11} fill={C.antenna} />
        <Px x={6}  y={10} fill={C.antenna} />
        <Px x={7}  y={9}  fill={C.antenna} />
        <Px x={8}  y={8}  fill={C.antenna} />
        <Px x={9}  y={7}  fill={C.antenna} />
        <Px x={10} y={6}  fill={C.antenna} />
        <Px x={10} y={5}  fill={C.antennaTip} className={on ? 'pr-antenna-tip' : ''} />

        {/* ── Carry handle (top-centre) ──────────────────────────────── */}
        <Px x={22} y={9}  w={10} h={1} fill={C.outline} />
        <Px x={23} y={10} w={8}  h={1} fill={C.handleHi} />
        <Px x={22} y={10} w={1}  h={2} fill={C.outline} />
        <Px x={31} y={10} w={1}  h={2} fill={C.outline} />

        {/* ── Body — rounded navy plastic ────────────────────────────── */}
        {/* outer outline */}
        <Px x={5}  y={12} w={40} h={1} fill={C.outline} />
        <Px x={4}  y={13} w={42} h={1} fill={C.outline} />
        <Px x={3}  y={14} w={44} h={1} fill={C.outline} />
        {Array.from({ length: 22 }, (_, i) => (
          <React.Fragment key={`side-${i}`}>
            <Px x={2}  y={15 + i} fill={C.outline} />
            <Px x={47} y={15 + i} fill={C.outline} />
          </React.Fragment>
        ))}
        <Px x={3}  y={37} w={44} h={1} fill={C.outline} />
        <Px x={4}  y={38} w={42} h={1} fill={C.outline} />
        <Px x={5}  y={39} w={40} h={1} fill={C.outline} />

        {/* body fill */}
        <Px x={3}  y={15} w={44} h={22} fill={C.bodyMid} />
        {/* top sheen */}
        <Px x={3}  y={14} w={44} h={1}  fill={C.bodyHi} />
        <Px x={4}  y={15} w={42} h={1}  fill={C.bodyHi} />
        {/* bottom shade */}
        <Px x={3}  y={36} w={44} h={1}  fill={C.bodyLo} />
        <Px x={4}  y={37} w={42} h={1}  fill={C.bodyShade} />

        {/* ── Display strip (wide horizontal LCD) ─────────────────────── */}
        <Box x={6} y={17} w={38} h={6}
             fill={C.displayBg} stroke={C.displayFrame} />
        {/* Inner darker recess */}
        <Px x={7}  y={18} w={36} h={4} fill={C.displayBg} />
        {/* Single accent stripe across the display — like a tuner needle. */}
        <Px x={8}  y={19} w={34} h={1}
            fill={on ? C.displayAccent : C.displayBarDim}
            className={on ? 'pr-needle' : ''} />
        {/* VU bars on the left of the display */}
        <VuBars x={9} y={19} on={on} />
        {/* "FM" tick on the right */}
        <Px x={37} y={20} w={1} h={1} fill={on ? C.displayBar : C.displayBarDim} />
        <Px x={39} y={20} w={1} h={1} fill={on ? C.displayBar : C.displayBarDim} />
        <Px x={41} y={20} w={1} h={1} fill={on ? C.displayBar : C.displayBarDim} />

        {/* ── Speakers (two squares bottom-left) ──────────────────────── */}
        <SpeakerSquare x={5}  y={25} size={9} on={on} />
        <SpeakerSquare x={16} y={25} size={9} on={on} />

        {/* ── Button row (centre below display) ───────────────────────── */}
        {[0, 1, 2].map((i) => (
          <g key={`btn-${i}`}>
            <Px x={27 + i * 4} y={26} w={3} h={1} fill={C.buttonHi} />
            <Px x={27 + i * 4} y={27} w={3} h={1} fill={C.buttonMid} />
            <Px x={27 + i * 4} y={28} w={3} h={1} fill={C.buttonLo} />
          </g>
        ))}
        {/* Three LEDs above the button row */}
        <Px x={28} y={24} fill={on ? C.ledRedOn : C.ledRedOff}
            className={on ? 'pr-led pr-led--red' : ''} />
        <Px x={32} y={24} fill={on ? C.ledAmber : C.ledOff}
            className={on ? 'pr-led pr-led--amber' : ''} />
        <Px x={36} y={24} fill={on ? C.displayBar : C.ledOff}
            className={on ? 'pr-led pr-led--green' : ''} />

        {/* ── Tuning knob (right side, big and round) ─────────────────── */}
        <Knob cx={40} cy={31} r={3} on={on} />

        {/* ── Power label dots — same cyan family as the LCD bars + glyphs */}
        <Px x={27} y={31} w={1} h={1} fill={on ? C.displayBar : C.displayBarDim} />
        <Px x={29} y={31} w={1} h={1} fill={on ? C.displayBar : C.displayBarDim} />
        <Px x={31} y={31} w={1} h={1} fill={on ? C.displayBar : C.displayBarDim} />
        <Px x={33} y={31} w={1} h={1} fill={on ? C.displayBar : C.displayBarDim} />

        {/* ── Stubby feet ─────────────────────────────────────────────── */}
        <Px x={7}  y={40} w={5} h={1} fill={C.outline} />
        <Px x={7}  y={41} w={5} h={1} fill={C.foot} />
        <Px x={38} y={40} w={5} h={1} fill={C.outline} />
        <Px x={38} y={41} w={5} h={1} fill={C.foot} />
        <Px x={8}  y={40} w={3} h={1} fill={C.footHi} />
        <Px x={39} y={40} w={3} h={1} fill={C.footHi} />
      </svg>

      {!on && (
        <span className="pixel-radio__hint">▸ PRESS</span>
      )}
    </button>
  );
}
