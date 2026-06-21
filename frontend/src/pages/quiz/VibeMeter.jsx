import React from 'react';
import { axisToUnit } from './scoreQuiz.js';
import { AXIS_LABELS } from './quizData.js';

/**
 * VibeMeter, a 4-axis radial chart drawn by hand in SVG.
 * Axes shown on a cross: temp ↔ Warm (top), edge ↔ Sharp (right),
 *                        era ↔ Futurist (bottom), density ↔ Maximalist (left).
 *
 * Each axis line spans from −1 to +1 (radius=R). The user's score is mapped
 * to that −1..+1 range; the resulting point is drawn on the axis. The four
 * points are connected by a closed quadrilateral, the user's "shape".
 *
 * Props:
 *   scores  {temp, edge, era, density}
 *   size    px (defaults to 260)
 *   accent  {from, to}  optional gradient stops for the polygon stroke/fill
 */
function VibeMeter({ scores, size = 260, accent = { from: '#9ab8cc', to: '#8e9fc4' } }) {
  if (!scores) return null;

  const c = size / 2;
  const R = c - 28; // padding for labels

  // Cartesian endpoints of each user point.
  // temp: vertical axis (Cool down, Warm up). −1 = bottom of axis, +1 = top → invert.
  // edge: horizontal axis (Soft left, Sharp right). −1 = left, +1 = right.
  // era:  vertical axis flipped (Vintage up, Futurist down).
  // density: horizontal axis flipped (Restrained right, Maximalist left).
  // To get a 4-point polygon, plot on a single cross:
  //   N = warm (temp+)
  //   E = sharp (edge+)
  //   S = futurist (era+)
  //   W = maximalist (density+)
  // Each point's distance from center = absolute value on its pole-facing direction.
  //
  // To preserve sign cleanly we map each axis to a [0..1] outward distance from center
  // where 0.5 sits at the dead-center "neutral" and 1.0 is the rim. So distance d is:
  //   d = (axis − negPoleValue) / (posPoleValue − negPoleValue) applied positionally below.

  // For each pole direction, we ALWAYS draw the user's point at distance R * t,
  // where t is mapped 0..1 from −8..+8 (using axisToUnit).
  // This means temp=−8 puts the "warm-N" point near center (not drawn into the south).
  // We treat the polygon as a "lean" indicator on each pole, not a true cross.
  const t = {
    N: axisToUnit(scores.temp),
    E: axisToUnit(scores.edge),
    S: axisToUnit(scores.era),
    W: axisToUnit(scores.density),
  };

  const points = {
    N: [c,            c - R * t.N],
    E: [c + R * t.E,  c          ],
    S: [c,            c + R * t.S],
    W: [c - R * t.W,  c          ],
  };

  const polygonPts = [points.N, points.E, points.S, points.W]
    .map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`)
    .join(' ');

  const uniq = Math.abs(
    (scores.temp * 31 + scores.edge * 17 + scores.era * 7 + scores.density) | 0
  );
  const gid    = `vm-grad-${uniq}`;
  const glowId = `vm-glow-${uniq}`;

  // Concentric guide rings. Five thin rings reads more like an engraved
  // dial / star-chart than three plain circles — the dark-academia register.
  const rings = [0.2, 0.4, 0.6, 0.8, 1.0].map((k) => R * k);

  // Warm "candlelit ink" furniture tones — parchment-gold lines on the dark
  // ground, instead of the old cold blue-grey. The user's accent gradient
  // still drives the polygon so each archetype keeps its own colour identity.
  const INK      = 'rgba(210, 188, 140, 0.30)'; // ring / hatch ink
  const INK_AXIS = 'rgba(214, 196, 150, 0.46)'; // stronger cross axes
  const INK_RIM  = 'rgba(220, 200, 150, 0.58)'; // outer rim

  // Faint diagonal hatch ticks at the rim — like pencil shading round a dial.
  const hatch = Array.from({ length: 24 }, (_, i) => {
    const a = (i / 24) * Math.PI * 2;
    const r1 = R * 0.96, r2 = R;
    return {
      x1: c + Math.cos(a) * r1, y1: c + Math.sin(a) * r1,
      x2: c + Math.cos(a) * r2, y2: c + Math.sin(a) * r2,
    };
  });

  return (
    <svg
      className="vibe-meter"
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label="Your vibe across four style axes"
    >
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%"  stopColor={accent.from} stopOpacity="0.92" />
          <stop offset="100%" stopColor={accent.to}   stopOpacity="0.92" />
        </linearGradient>
        {/* Soft candlelight bloom behind the polygon. */}
        <radialGradient id={glowId} cx="50%" cy="50%" r="50%">
          <stop offset="0%"  stopColor={accent.from} stopOpacity="0.28" />
          <stop offset="60%" stopColor={accent.to}   stopOpacity="0.10" />
          <stop offset="100%" stopColor={accent.to}  stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* Inner candlelit ground */}
      <circle cx={c} cy={c} r={R} fill={`url(#${glowId})`} />

      {rings.map((r, i) => (
        <circle
          key={i}
          cx={c}
          cy={c}
          r={r}
          fill="none"
          stroke={i === rings.length - 1 ? INK_RIM : INK}
          strokeWidth={i === rings.length - 1 ? 1 : 0.5}
          strokeDasharray={i === rings.length - 1 ? 'none' : '1 4'}
        />
      ))}

      {/* Rim hatch ticks */}
      {hatch.map((h, i) => (
        <line key={i} x1={h.x1} y1={h.y1} x2={h.x2} y2={h.y2}
          stroke={INK} strokeWidth="0.6" />
      ))}

      {/* Cross axes — drawn faint, like ruled guide lines on parchment. */}
      <line x1={c} y1={c - R} x2={c} y2={c + R} stroke={INK_AXIS} strokeWidth="0.8" />
      <line x1={c - R} y1={c} x2={c + R} y2={c} stroke={INK_AXIS} strokeWidth="0.8" />

      {/* User polygon */}
      <polygon
        points={polygonPts}
        fill={`url(#${gid})`}
        fillOpacity="0.24"
        stroke={`url(#${gid})`}
        strokeWidth="1.6"
        strokeLinejoin="round"
      />

      {/* Vertex dots — small inked beads with a faint ring halo. */}
      {Object.values(points).map(([x, y], i) => (
        <g key={i}>
          <circle cx={x} cy={y} r="5" fill="none" stroke={accent.to} strokeOpacity="0.35" strokeWidth="0.8" />
          <circle cx={x} cy={y} r="2.6" fill={accent.to} stroke="rgba(10,8,4,0.85)" strokeWidth="0.8" />
        </g>
      ))}

      {/* Axis labels — serif small-caps, the editorial register of the result. */}
      <text x={c} y={14}            className="vm-label" textAnchor="middle">{AXIS_LABELS.temp.pos}</text>
      <text x={size - 4} y={c + 4}  className="vm-label" textAnchor="end">{AXIS_LABELS.edge.pos}</text>
      <text x={c} y={size - 4}      className="vm-label" textAnchor="middle">{AXIS_LABELS.era.pos}</text>
      <text x={4} y={c + 4}         className="vm-label" textAnchor="start">{AXIS_LABELS.density.pos}</text>
    </svg>
  );
}

export default VibeMeter;
