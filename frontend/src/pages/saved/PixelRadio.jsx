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
  displayBar:   '#7ee8b8',
  displayBarDim:'#1e4038',
  displayAccent:'#e57878',

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

  note:      '#7ee8b8',
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
function MusicNotes() {
  const notes = [
    // ── Top edge ─────────────────────────────────────────────
    { ch: '♪', x: 14, y: 7,  size: 3.4, side: 'up',    delay: '0s'   },
    { ch: '♫', x: 24, y: 5,  size: 2.8, side: 'up',    delay: '0.7s' },
    { ch: '♬', x: 34, y: 8,  size: 4.0, side: 'up',    delay: '1.4s' },
    // ── Right edge ───────────────────────────────────────────
    { ch: '♩', x: 47, y: 19, size: 3.0, side: 'right', delay: '0.3s' },
    { ch: '♪', x: 48, y: 28, size: 4.2, side: 'right', delay: '1.1s' },
    { ch: '♫', x: 47, y: 35, size: 2.6, side: 'right', delay: '1.9s' },
    // ── Bottom edge ──────────────────────────────────────────
    { ch: '♬', x: 14, y: 42, size: 2.8, side: 'down',  delay: '0.5s' },
    { ch: '♪', x: 25, y: 43, size: 3.6, side: 'down',  delay: '1.3s' },
    { ch: '♩', x: 36, y: 42, size: 3.0, side: 'down',  delay: '2.1s' },
    // ── Left edge ────────────────────────────────────────────
    { ch: '♫', x: 2,  y: 22, size: 3.2, side: 'left',  delay: '0.9s' },
    { ch: '♪', x: 1,  y: 30, size: 4.0, side: 'left',  delay: '1.7s' },
    { ch: '♬', x: 2,  y: 36, size: 2.6, side: 'left',  delay: '2.5s' },
  ];

  return (
    <g className="pr-notes">
      {notes.map((n, i) => (
        <text
          key={i}
          x={n.x}
          y={n.y}
          fill={C.note}
          fontSize={n.size}
          textAnchor="middle"
          className={`pr-note pr-note--${n.side}`}
          style={{ animationDelay: n.delay }}
        >
          {n.ch}
        </text>
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

        {/* ── Power label dots ────────────────────────────────────────── */}
        <Px x={27} y={31} w={1} h={1} fill={C.bodyHi} />
        <Px x={29} y={31} w={1} h={1} fill={C.bodyHi} />
        <Px x={31} y={31} w={1} h={1} fill={C.bodyHi} />
        <Px x={33} y={31} w={1} h={1} fill={C.bodyHi} />

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
