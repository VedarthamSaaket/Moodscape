// Pure scoring function for the style quiz.
// Input: ordered array of selected option objects (each has a `delta` on the 4 axes).
// Output: { scores, ranking, archetype, runnerUp }.
//
// Scoring model:
//   1. Sum all deltas → 4-axis vector `scores = { temp, edge, era, density }`.
//   2. For each archetype, compute squared Euclidean distance from its centroid.
//   3. Sort ascending; smallest distance wins.
//   4. Also return the second-place for the "with a streak of …" line on the result page.

import { ARCHETYPES, AXES } from './quizData.js';

/**
 * @param {Array<{delta: {temp:number, edge:number, era:number, density:number}}>} answers
 * @returns {{
 *   scores: {temp:number, edge:number, era:number, density:number},
 *   ranking: Array<{archetype: object, distance: number}>,
 *   archetype: object,
 *   runnerUp: object,
 * }}
 */
export function score(answers) {
  const scores = { temp: 0, edge: 0, era: 0, density: 0 };
  for (const a of answers) {
    if (!a || !a.delta) continue;
    for (const axis of AXES) {
      scores[axis] += a.delta[axis] || 0;
    }
  }

  const ranking = ARCHETYPES
    .map((archetype) => {
      let d = 0;
      for (const axis of AXES) {
        const diff = scores[axis] - archetype.centroid[axis];
        d += diff * diff;
      }
      return { archetype, distance: d };
    })
    .sort((a, b) => a.distance - b.distance);

  return {
    scores,
    ranking,
    archetype: ranking[0].archetype,
    runnerUp: ranking[1]?.archetype || null,
  };
}

/**
 * Normalize a single axis score to a 0..1 range for the VibeMeter SVG.
 * Most questions push by ±1 or ±2; 8 questions → theoretical range roughly ±10.
 * Clamp to [-8, +8] for visual stability.
 */
export function axisToUnit(value) {
  const clamped = Math.max(-8, Math.min(8, value));
  return (clamped + 8) / 16;  // 0..1
}
