export const MOTION_SETTLE_SECONDS: number;
export const MOTION_STROKE_LIMIT: number;
export const MOTION_IMPULSE_CLAMP: number;
export const MOTION_IMPULSE_GAIN: number;
export const MOTION_SPEED_CLAMP: number;
export const MOTION_MASS_MIN: number;
export const MOTION_MASS_MAX: number;

export function motionMass(size: number): number;
export function coastOffset(velocity: number, mass: number, age: number): number;
export function strokeWeight(
  px: number,
  py: number,
  originX: number,
  originY: number,
  segmentX: number,
  segmentY: number,
  radius: number,
): number;

export type PointerMotionField = {
  readonly origins: Float32Array;
  readonly segments: Float32Array;
  readonly impulses: Float32Array;
  readonly ages: Float32Array;
  readonly strokes: number;
  readonly releaseCenter: [number, number];
  readonly releaseImpulse: number;
  readonly releaseAge: number;
  readonly active: boolean;
  push(x: number, y: number): void;
  burst(x: number, y: number, strength: number): void;
  lift(): void;
  reset(): void;
  tick(dt: number): void;
  offsetAt(
    px: number,
    py: number,
    mass: number,
    radius: number,
    out?: number[],
  ): number[];
};

export function createPointerMotionField(options?: Partial<{
  strokes: number;
  settleSeconds: number;
  strokeWindow: number;
  impulseClamp: number;
}>): PointerMotionField;
