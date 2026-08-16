export type HandLandmarkPoint = {
  x: number;
  y: number;
  z?: number;
  visibility?: number;
};

export type HandPose = {
  x: number;
  y: number;
  scale: number;
  pinchRatio: number;
};

export type RecognizedHandGesture =
  | "None"
  | "Closed_Fist"
  | "Open_Palm"
  | "Pointing_Up"
  | "Thumb_Down"
  | "Thumb_Up"
  | "Victory"
  | "ILoveYou";

export type GestureHold = {
  gesture: string;
  since: number;
  lastSeen: number;
  evidenceFrames: number;
};

export type PinchInteraction = {
  pinching: boolean;
  grabbed: boolean;
  startedAt: number;
  progress: number;
  event: "none" | "press" | "select" | "grab-start" | "release" | "cancel";
};

export type PinchThresholds = {
  closeThreshold: number;
  releaseThreshold: number;
  calibrated?: boolean;
};

export type HandMatchPoint = {
  id?: string;
  x: number;
  y: number;
  handedness?: string;
};

export type TwoHandMetrics = {
  centerX: number;
  centerY: number;
  distance: number;
  angle: number;
};

export type PrimaryHandCandidate = {
  id: string;
  lastSeen: number;
  visible: boolean;
  event?: string;
};

export const HAND_CONNECTIONS: readonly (readonly [number, number])[];

export function handPoseFromLandmarks(
  landmarks: readonly HandLandmarkPoint[],
): HandPose | null;

export function nextGrabState(
  previous: boolean,
  gestureName: string,
  gestureScore: number,
  pinchRatio: number,
): boolean;

export function gestureScoreThreshold(gestureName: string): number;

export function inferCommandGestureFromLandmarks(
  landmarks: readonly HandLandmarkPoint[],
): RecognizedHandGesture;

export function updateGestureHold(
  previous: GestureHold | null,
  observedGesture: string,
  now: number,
  graceMs?: number,
): GestureHold;

export function updatePinchInteraction(
  previous: PinchInteraction | null,
  pinchRatio: number,
  now: number,
  options?: number | (PinchThresholds & { holdMs?: number }),
): PinchInteraction;

export function derivePinchThresholds(
  openSamples: readonly number[],
  closedSamples: readonly number[],
): PinchThresholds & { calibrated: boolean };

export function matchHandDetections(
  previousHands: readonly HandMatchPoint[],
  detections: readonly HandMatchPoint[],
  maxDistance?: number,
): {
  matches: Array<{
    previousIndex: number;
    detectionIndex: number;
    cost: number;
    positionCost: number;
  }>;
  unmatchedPrevious: number[];
  unmatchedDetections: number[];
};

export function resolvePrimaryHandId(
  currentId: string | null,
  hands: readonly PrimaryHandCandidate[],
  now: number,
  graceMs?: number,
): string | null;

export function twoHandMetrics(
  first: HandMatchPoint,
  second: HandMatchPoint,
): TwoHandMetrics | null;

export function twoHandTransformDelta(
  previous: TwoHandMetrics,
  next: TwoHandMetrics,
): {
  centerX: number;
  centerY: number;
  separation: number;
  dx: number;
  dy: number;
  scaleRatio: number;
  rotationDelta: number;
} | null;

export function smoothHandPose(
  previous: HandPose | null,
  next: HandPose,
  alpha?: number,
): HandPose;
