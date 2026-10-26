import { DEFAULT_WEIGHTS, type Weights } from './evaluate';

/** Named evaluation-weight variants for tournaments and ablation experiments. */
export const WEIGHT_PRESETS: Record<string, Weights> = {
  default: DEFAULT_WEIGHTS,
  material: { ...DEFAULT_WEIGHTS, advance: 0, threat: 0, threatToMove: 0, topMobility: 0, baseMobility: 0 },
  noAdvance: { ...DEFAULT_WEIGHTS, advance: 0 },
  noThreat: { ...DEFAULT_WEIGHTS, threat: 0, threatToMove: 0 },
  noMobility: { ...DEFAULT_WEIGHTS, topMobility: 0, baseMobility: 0 },
  noTopMobility: { ...DEFAULT_WEIGHTS, topMobility: 0 },
  noBaseMobility: { ...DEFAULT_WEIGHTS, baseMobility: 0 },
  base3x: { ...DEFAULT_WEIGHTS, baseMobility: DEFAULT_WEIGHTS.baseMobility * 3 },
  base6x: { ...DEFAULT_WEIGHTS, baseMobility: DEFAULT_WEIGHTS.baseMobility * 6 },
  base12x: { ...DEFAULT_WEIGHTS, baseMobility: DEFAULT_WEIGHTS.baseMobility * 12 },
  advance2x: { ...DEFAULT_WEIGHTS, advance: DEFAULT_WEIGHTS.advance * 2 },
  mobility2x: { ...DEFAULT_WEIGHTS, topMobility: DEFAULT_WEIGHTS.topMobility * 2, baseMobility: DEFAULT_WEIGHTS.baseMobility * 2 },
};
