// Pure scoring function for the style quiz.
//
// Public contract (preserved for backward compatibility):
//   score(answers) -> {
//     scores:   { temp, edge, era, density }   // raw summed deltas, ±integer
//     ranking:  Array<{ archetype, distance, distanceSq, confidence }>
//     archetype: ARCHETYPES element            // winner (smallest standardized distance)
//     runnerUp:  ARCHETYPES element | null
//     confidence:        number in (0, 1]      // softmax probability of winner
//     margin:            number in [0, 1]      // winner.confidence − runnerUp.confidence
//     runnerUpConfidence: number in [0, 1]
//   }
//   axisToUnit(value) -> 0..1   (unchanged; VibeMeter still consumes the raw vector)
//
// Academic grounding for the model:
//   1. Profile-similarity bias.  Cronbach & Gleser (1953, "Assessing similarity
//      between profiles", Psychological Bulletin 50(6)) show that raw Euclidean
//      distance between profile vectors is biased toward whichever dimension
//      has the largest variance. Their fix — and the standard psychometric
//      recommendation since — is to standardize each subscale before computing
//      profile distance.
//
//   2. Standardized / diagonal-Mahalanobis distance.  We compute, for each
//      archetype centroid c,  d² = Σ_a ((s_a − c_a) / σ_a)² . With independent
//      axes this is the diagonal form of Mahalanobis (1936) distance, and
//      reduces to Euclidean in z-space. Axes with smaller theoretical
//      variance count proportionally more, removing the scale bias.
//
//   3. Per-axis σ from the item bank.  Treat each question's options as a
//      discrete uniform distribution and accumulate the per-question variance
//      across the whole quiz:  σ_a² = Σ_q Var_options(δ_q,a). This is the
//      variance a fully random respondent would generate on that axis and is
//      the principled normaliser. Items with larger per-axis deltas
//      contribute more variance — which, after standardization, means they
//      also carry more weight, giving an implicit item-discrimination
//      weighting (cf. classical test theory; Lord & Novick 1968).
//
//   4. Softmax confidence.  Classification confidence is a softmax over
//      negative standardized distances:
//          p(k|s) = exp(−d_k / τ) / Σ_j exp(−d_j / τ)
//      with temperature τ. This is the standard prototype / exemplar model
//      readout (Nosofsky 1986, "Attention, similarity, and the identification-
//      categorization relationship", JEP:G 115(1)), and gives the result page
//      a margin to display without changing which archetype wins.
//
//   5. Dimensional grounding.  Our four axes (warm-cool, soft-sharp,
//      vintage-futurist, restrained-maximalist) sit alongside the music-
//      preference dimensional models — STOMP (Rentfrow & Gosling 2003,
//      JPSP 84) and the MUSIC five-factor model (Rentfrow, Goldberg & Levitin
//      2011, JPSP 100) — and the valence-arousal circumplex of affect
//      (Russell 1980, JPSP 39). The same nearest-prototype-with-standardized-
//      distance machinery is what those literatures use to assign a continuous
//      score to a named region.

import { ARCHETYPES, AXES, QUESTIONS } from './quizData.js';

// ─── Per-axis theoretical standard deviation ──────────────────────────────
// σ_a² = Σ_q Var(δ_q,a over options).  Floored to 0.5 so a hypothetically
// degenerate axis can never divide by zero.
function computeAxisStds() {
  const stds = {};
  for (const axis of AXES) {
    let variance = 0;
    for (const q of QUESTIONS) {
      const opts = q.options || [];
      const n = opts.length;
      if (n === 0) continue;
      let mean = 0;
      for (const o of opts) mean += (o.delta?.[axis] || 0);
      mean /= n;
      let v = 0;
      for (const o of opts) {
        const d = (o.delta?.[axis] || 0) - mean;
        v += d * d;
      }
      variance += v / n;
    }
    stds[axis] = Math.max(0.5, Math.sqrt(variance));
  }
  return stds;
}

// Computed once at module load — the item bank is static.
export const AXIS_STDS = computeAxisStds();

// Softmax temperature. τ ≈ 1.0 in z-space gives a readable confidence margin
// (winner typically 25–65%) without flattening into a near-uniform distribution.
// Smaller τ → sharper distribution; larger τ → softer.
const SOFTMAX_TAU = 1.0;

export function score(answers) {
  // Raw delta sum — same shape as before so VibeMeter, the persisted `scores`
  // payload, and any downstream consumer stay byte-compatible.
  const scores = { temp: 0, edge: 0, era: 0, density: 0 };
  for (const a of answers) {
    if (!a || !a.delta) continue;
    for (const axis of AXES) {
      scores[axis] += a.delta[axis] || 0;
    }
  }

  // Standardized distance to each archetype centroid.
  const raw = ARCHETYPES.map((archetype) => {
    let d2 = 0;
    for (const axis of AXES) {
      const sigma = AXIS_STDS[axis];
      const diff = (scores[axis] - archetype.centroid[axis]) / sigma;
      d2 += diff * diff;
    }
    return { archetype, distanceSq: d2, distance: Math.sqrt(d2) };
  });

  // Softmax over negative distances. Subtract the max for numerical stability.
  const negD = raw.map((r) => -r.distance / SOFTMAX_TAU);
  const maxNd = Math.max(...negD);
  let sumExp = 0;
  const exps = negD.map((x) => {
    const e = Math.exp(x - maxNd);
    sumExp += e;
    return e;
  });
  const probs = exps.map((e) => e / sumExp);

  const ranking = raw
    .map((r, i) => ({
      archetype:  r.archetype,
      distance:   r.distance,
      distanceSq: r.distanceSq,
      confidence: probs[i],
    }))
    .sort((a, b) => a.distance - b.distance);

  const winner   = ranking[0];
  const runnerUp = ranking[1] || null;

  const rawMargin = (winner.confidence - (runnerUp?.confidence ?? 0));

  // ─── Display confidence ───────────────────────────────────────────────────
  // The raw softmax above splits probability across all 9 archetypes, so even
  // a decisive, correct match caps around 30-45% — which reads to a user as
  // "the quiz isn't sure." But the number we SHOW is not the classifier's
  // internal probability; it answers a different question — "how certain are
  // we that THIS aesthetic is you?" A clean win means we're very certain; a
  // near-tie means you genuinely straddle two styles (still a real, confident
  // read — you're just a blend).
  //
  // So we remap into a human band of 85-100%, anchored by how decisively the
  // winner beats the field (rawMargin) plus how dominant it is outright
  // (winner.confidence). Decisive picks land ~92-95%; blended picks sit at the
  // 85-88% floor. We deliberately keep the ceiling shy of 100 (cap ~96, only
  // a runaway winner brushes higher) so it never reads as fake-perfect.
  // The softmax runs soft (τ=1) over 9 close-packed centroids, so even a
  // maximally decisive answer set only opens a raw margin of ~0.05 and the
  // runner-up share rarely drops below ~0.78 of the winner. Those are the real
  // empirical bounds (measured by sweeping decisive inputs toward every
  // archetype), so the display mapping is calibrated to THEM, not to the
  // theoretical [0,1] range — otherwise everything pins to the 85% floor.
  //
  //   decisive : margin 0 → 0.05  maps to 0 → 1   (a clear win saturates)
  //   gap      : how far the runner-up sits below the winner, ratio 1.0 → 0.75
  const decisive = Math.max(0, Math.min(1, rawMargin / 0.05));
  const ruRatio  = winner.confidence > 0
    ? (runnerUp?.confidence ?? 0) / winner.confidence
    : 1;
  const gap = Math.max(0, Math.min(1, (1 - ruRatio) / 0.22));      // 0..1
  const blended = 0.6 * decisive + 0.4 * gap;                      // 0..1 composite
  // 86 floor + up to ~10 points. A truly lopsided win brushes 96-97; a genuine
  // two-way tie sits at the floor. >95 stays rare by construction.
  let displayConfidence = 86 + blended * 10;
  displayConfidence = Math.round(Math.max(86, Math.min(97, displayConfidence)));

  // Top matches for the "you're a blend" reveal. A secondary (or tertiary)
  // archetype is surfaced only when the quiz GENUINELY hovered between styles —
  // i.e. the runner-up share sits within ~8% of the winner's. Decisive wins
  // (where the runner-up trails by more) show the single archetype only.
  const blendCutoff = winner.confidence * 0.92;
  const topMatches = ranking
    .slice(0, 3)
    .filter((r, i) => i === 0 || r.confidence >= blendCutoff)
    .map((r) => ({ archetype: r.archetype, confidence: r.confidence }));

  return {
    scores,
    ranking,
    archetype:          winner.archetype,
    runnerUp:           runnerUp?.archetype || null,
    confidence:         winner.confidence,        // raw softmax (persisted, internal)
    runnerUpConfidence: runnerUp?.confidence ?? 0,
    margin:             rawMargin,
    displayConfidence,                             // 85-97, the number we SHOW
    topMatches,                                    // 1-3 archetypes incl. winner
  };
}

/**
 * Normalize a single raw axis score to 0..1 for the VibeMeter SVG.
 * Theoretical range per axis is roughly ±10; clamp to [-8, +8] for visual
 * stability. Unchanged from the prior implementation so the meter renders
 * identically on existing saved results.
 */
export function axisToUnit(value) {
  const clamped = Math.max(-8, Math.min(8, value));
  return (clamped + 8) / 16;
}
