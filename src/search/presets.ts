import { DEFAULT_WEIGHTS, type Weights } from './evaluate';

/** The first baseline weights. The ablation presets below are relative to these. */
const V1: Weights = { top: 100, advance: 3, threat: 60, threatToMove: 200, topMobility: 4, baseMobility: 2 };

/**
 * Named evaluation-weight variants for tournaments and ablation experiments.
 * Results in data/tournament-eval.md, -mobility.md and -basemob*.md were produced with `ab4`
 * meaning v1 weights, so the variants keep v1 as their reference.
 */
export const WEIGHT_PRESETS: Record<string, Weights> = {
  default: DEFAULT_WEIGHTS,
  v1: V1,
  material: { ...V1, advance: 0, threat: 0, threatToMove: 0, topMobility: 0, baseMobility: 0 },
  noAdvance: { ...V1, advance: 0 },
  noThreat: { ...V1, threat: 0, threatToMove: 0 },
  noMobility: { ...V1, topMobility: 0, baseMobility: 0 },
  noTopMobility: { ...V1, topMobility: 0 },
  noBaseMobility: { ...V1, baseMobility: 0 },
  advance2x: { ...V1, advance: V1.advance * 2 },
  mobility2x: { ...V1, topMobility: V1.topMobility * 2, baseMobility: V1.baseMobility * 2 },
  base3x: { ...V1, baseMobility: V1.baseMobility * 3 },
  base6x: { ...V1, baseMobility: V1.baseMobility * 6 },
  base12x: { ...V1, baseMobility: V1.baseMobility * 12 },
};
