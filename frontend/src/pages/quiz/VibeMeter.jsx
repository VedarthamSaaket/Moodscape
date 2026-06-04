import React from 'react';
import { axisToUnit } from './scoreQuiz.js';
import { AXIS_LABELS } from './quizData.js';

/**
 * VibeMeter — a 4-axis radial chart drawn by hand in SVG.
 * Axes shown on a cross: temp ↔ Warm (top), edge ↔ Sharp (right),
 *                        era ↔ Futurist (bottom), density ↔ Maximalist (left).
 *
 * Each axis line spans from −1 to +1 (radius=R). The user's score is mapped
 * to that −1..+1 range; the resulting point is drawn on the axis. The four
 * points are connected by a closed quadrilateral — the user's "shape".
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

  // Map −8..+8 (axisToUnit gives 0..1) back to −1..+1 for polar plot.
  const u = {
    temp:    axisToUnit(scores.temp)    * 2 - 1,
    edge:    axisToUnit(scores.edge)    * 2 - 1,
    era:     axisToUnit(scores.era)     * 2 - 1,
    density: axisToUnit(scores.density) * 2 - 1,
  };

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

  const gid = `vm-grad-${Math.abs(
    (scores.temp * 31 + scores.edge * 17 + scores.era * 7 + scores.density) | 0
  )}`;

  // Concentric guide rings.
  const rings = [0.33, 0.66, 1.0].map((k) => R * k);

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
          <stop offset="0%"  stopColor={accent.from} stopOpacity="0.85" />
          <stop offset="100%" stopColor={accent.to}   stopOpacity="0.85" />
        </linearGradient>
      </defs>

      {rings.map((r, i) => (
        <circle
          key={i}
          cx={c}
          cy={c}
          r={r}
          fill="none"
          stroke="rgba(220,232,240,0.10)"
          strokeWidth={i === rings.length - 1 ? 1 : 0.6}
        />
      ))}

      {/* Cross axes */}
      <line x1={c} y1={c - R} x2={c} y2={c + R} stroke="rgba(220,232,240,0.18)" strokeWidth="0.7" />
      <line x1={c - R} y1={c} x2={c + R} y2={c} stroke="rgba(220,232,240,0.18)" strokeWidth="0.7" />

      {/* User polygon */}
      <polygon
        points={polygonPts}
        fill={`url(#${gid})`}
        fillOpacity="0.22"
        stroke={`url(#${gid})`}
        strokeWidth="1.5"
        strokeLinejoin="round"
      />

      {/* Vertex dots */}
      {Object.values(points).map(([x, y], i) => (
        <circle
          key={i}
          cx={x}
          cy={y}
          r="3"
          fill={accent.to}
          stroke="rgba(8,11,22,0.8)"
          strokeWidth="0.8"
        />
      ))}

      {/* Axis labels */}
      <text x={c} y={14}            className="vm-label" textAnchor="middle">{AXIS_LABELS.temp.pos.toUpperCase()}</text>
      <text x={size - 4} y={c + 4}  className="vm-label" textAnchor="end">{AXIS_LABELS.edge.pos.toUpperCase()}</text>
      <text x={c} y={size - 4}      className="vm-label" textAnchor="middle">{AXIS_LABELS.era.pos.toUpperCase()}</text>
      <text x={4} y={c + 4}         className="vm-label" textAnchor="start">{AXIS_LABELS.density.pos.toUpperCase()}</text>
    </svg>
  );
}

export default VibeMeter;
