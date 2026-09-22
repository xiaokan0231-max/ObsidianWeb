export type StageInteractionSource = "pointer" | "hand";
export type StageInteractionKind = "move" | "press" | "drag";
export type StageInteractionPhase =
  | "idle"
  | "tracking"
  | "pressing"
  | "manipulating"
  | "released"
  | "settling";

export type StageInteractionInput = {
  source: StageInteractionSource;
  kind: StageInteractionKind;
  x: number;
  y: number;
  /** 省略或传非有限值时按 kind 取默认强度（见 energyFor）。 */
  energy?: number;
  time: number;
};

export type StageInteractionSnapshot = {
  source: StageInteractionSource | null;
  phase: StageInteractionPhase;
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  velocityX: number;
  velocityY: number;
  tiltX: number;
  tiltY: number;
  energy: number;
  dragEnergy: number;
  releaseImpulse: number;
  active: boolean;
  dragging: boolean;
};

export type StageInteractionOptions = Partial<{
  homeX: number;
  homeY: number;
  positionOmega: number;
  tiltOmega: number;
  tiltReturnOmega: number;
  maxTilt: number;
  energyAttack: number;
  energyRelease: number;
  dragAttack: number;
  dragRelease: number;
  releaseDecay: number;
  releasedMs: number;
  settleEpsilon: number;
}>;

export class StageInteraction {
  constructor(options?: StageInteractionOptions);
  setInput(input: StageInteractionInput): StageInteractionSnapshot;
  endInput(
    source: StageInteractionSource,
    time: number,
    options?: { cancelled?: boolean },
  ): StageInteractionSnapshot;
  tick(now: number, animate?: boolean): StageInteractionSnapshot;
  snapshot(): StageInteractionSnapshot;
}

export function createStageInteraction(options?: StageInteractionOptions): StageInteraction;
