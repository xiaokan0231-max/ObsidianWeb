const SOURCES = new Set(["pointer", "hand"]);
const KINDS = new Set(["move", "press", "drag"]);

const DEFAULTS = Object.freeze({
  homeX: 0.5,
  homeY: 0.5,
  positionOmega: 18,
  // 跟随快、复位慢：跟手时要贴住指针，松手／离场后要看得出「回去」这个动作。
  // 两个速率同时相等的话，复位会快到看不见，画面读起来就只有「突然停住」。
  tiltOmega: 14,
  tiltReturnOmega: 5.5,
  maxTilt: 0.16,
  energyAttack: 0.075,
  energyRelease: 0.24,
  dragAttack: 0.06,
  dragRelease: 0.19,
  releaseDecay: 0.28,
  releasedMs: 120,
  settleEpsilon: 0.002,
});

function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}

function finite(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

/**
 * 临界阻尼的解析解。这里不能使用逐帧 lerp，否则 30fps 和 120fps 会呈现不同手感。
 */
function criticalStep(value, velocity, target, dt, omega) {
  if (dt <= 0) return [value, velocity];
  const offset = value - target;
  const decay = Math.exp(-omega * dt);
  const coefficient = velocity + omega * offset;
  return [
    target + (offset + coefficient * dt) * decay,
    (velocity - omega * coefficient * dt) * decay,
  ];
}

function exponentialStep(value, target, dt, timeConstant) {
  if (dt <= 0) return value;
  return target + (value - target) * Math.exp(-dt / timeConstant);
}

function energyFor(kind, requested) {
  if (Number.isFinite(requested)) return clamp01(requested);
  if (kind === "drag") return 1;
  if (kind === "press") return 0.72;
  return 0.38;
}

export class StageInteraction {
  constructor(options = {}) {
    this.options = { ...DEFAULTS, ...options };
    this.phase = "idle";
    this.source = null;
    this.x = finite(this.options.homeX, DEFAULTS.homeX);
    this.y = finite(this.options.homeY, DEFAULTS.homeY);
    this.targetX = this.x;
    this.targetY = this.y;
    this.velocityX = 0;
    this.velocityY = 0;
    this.tiltX = 0;
    this.tiltY = 0;
    this.tiltVelocityX = 0;
    this.tiltVelocityY = 0;
    this.tiltTargetX = 0;
    this.tiltTargetY = 0;
    this.energy = 0;
    this.energyTarget = 0;
    this.dragEnergy = 0;
    this.dragEnergyTarget = 0;
    this.releaseImpulse = 0;
    this.active = false;
    this.dragging = false;
    this.lastTime = null;
    this.releasedAt = null;
  }

  /**
   * 同一时刻只能有一个来源拥有舞台。悬停可被一次明确按压接管，已经按压或拖拽后则锁定到释放。
   */
  setInput(input) {
    this.#assertInput(input);
    this.#advance(input.time, true);

    if (this.source !== null && this.source !== input.source && this.active) {
      const operating = this.phase === "pressing" || this.phase === "manipulating";
      if (operating || input.kind === "move") return this.snapshot();
    }

    this.source = input.source;
    this.active = true;
    this.dragging = input.kind === "drag";
    this.phase = input.kind === "drag"
      ? "manipulating"
      : input.kind === "press"
        ? "pressing"
        : "tracking";
    this.releasedAt = null;

    this.targetX = clamp01(input.x);
    this.targetY = clamp01(input.y);
    const energy = energyFor(input.kind, input.energy);
    this.energyTarget = energy;
    this.dragEnergyTarget = input.kind === "drag"
      ? energy
      : input.kind === "press"
        ? energy * 0.22
        : 0;

    const tiltStrength = 0.42 + energy * 0.58;
    this.tiltTargetX = (0.5 - this.targetY) * 2 * this.options.maxTilt * tiltStrength;
    this.tiltTargetY = (this.targetX - 0.5) * 2 * this.options.maxTilt * tiltStrength;
    return this.snapshot();
  }

  endInput(source, time, { cancelled = false } = {}) {
    if (!SOURCES.has(source)) throw new TypeError(`Unknown interaction source: ${source}`);
    if (!Number.isFinite(time)) throw new TypeError("Interaction time must be finite");
    this.#advance(time, true);
    if (source !== this.source || !this.active) return this.snapshot();

    const wasOperating = this.phase === "pressing" || this.phase === "manipulating";
    const speed = Math.hypot(this.velocityX, this.velocityY);
    this.active = false;
    this.dragging = false;
    this.energyTarget = 0;
    this.dragEnergyTarget = 0;
    this.tiltTargetX = 0;
    this.tiltTargetY = 0;

    if (wasOperating && !cancelled) {
      this.releaseImpulse = Math.max(
        this.releaseImpulse,
        clamp01(0.16 + this.dragEnergy * 0.62 + speed * 0.08),
      );
      this.phase = "released";
      this.releasedAt = time;
    } else {
      if (cancelled) this.releaseImpulse = 0;
      this.phase = "settling";
      this.releasedAt = null;
    }

    // targetX/targetY 刻意保留离场坐标；复原的是作用力和舞台倾斜，而不是把光标瞬移回中心。
    return this.snapshot();
  }

  tick(now, animate = true) {
    if (!Number.isFinite(now)) throw new TypeError("Interaction time must be finite");
    this.#advance(now, animate);
    return this.snapshot();
  }

  snapshot() {
    return {
      source: this.source,
      phase: this.phase,
      x: this.x,
      y: this.y,
      targetX: this.targetX,
      targetY: this.targetY,
      velocityX: this.velocityX,
      velocityY: this.velocityY,
      tiltX: this.tiltX,
      tiltY: this.tiltY,
      energy: this.energy,
      dragEnergy: this.dragEnergy,
      releaseImpulse: this.releaseImpulse,
      active: this.active,
      dragging: this.dragging,
    };
  }

  #assertInput(input) {
    if (!input || !SOURCES.has(input.source)) {
      throw new TypeError(`Unknown interaction source: ${input?.source}`);
    }
    if (!KINDS.has(input.kind)) throw new TypeError(`Unknown interaction kind: ${input.kind}`);
    if (![input.x, input.y, input.time].every(Number.isFinite)) {
      throw new TypeError("Interaction coordinates and time must be finite");
    }
  }

  #advance(now, animate) {
    if (this.lastTime === null) {
      this.lastTime = now;
      return;
    }
    if (now <= this.lastTime) return;

    const dt = (now - this.lastTime) / 1000;
    this.lastTime = now;

    if (!animate) {
      this.x = this.targetX;
      this.y = this.targetY;
      this.velocityX = 0;
      this.velocityY = 0;
      this.tiltX = this.active ? this.tiltTargetX : 0;
      this.tiltY = this.active ? this.tiltTargetY : 0;
      this.tiltVelocityX = 0;
      this.tiltVelocityY = 0;
      this.energy = this.active ? this.energyTarget : 0;
      this.dragEnergy = this.active ? this.dragEnergyTarget : 0;
      this.releaseImpulse = 0;
      if (!this.active) this.#finishSettling();
      return;
    }

    [this.x, this.velocityX] = criticalStep(
      this.x,
      this.velocityX,
      this.targetX,
      dt,
      this.options.positionOmega,
    );
    [this.y, this.velocityY] = criticalStep(
      this.y,
      this.velocityY,
      this.targetY,
      dt,
      this.options.positionOmega,
    );
    const tiltOmega = this.active ? this.options.tiltOmega : this.options.tiltReturnOmega;
    [this.tiltX, this.tiltVelocityX] = criticalStep(
      this.tiltX,
      this.tiltVelocityX,
      this.tiltTargetX,
      dt,
      tiltOmega,
    );
    [this.tiltY, this.tiltVelocityY] = criticalStep(
      this.tiltY,
      this.tiltVelocityY,
      this.tiltTargetY,
      dt,
      tiltOmega,
    );

    const energyTau = this.energyTarget > this.energy
      ? this.options.energyAttack
      : this.options.energyRelease;
    const dragTau = this.dragEnergyTarget > this.dragEnergy
      ? this.options.dragAttack
      : this.options.dragRelease;
    this.energy = exponentialStep(this.energy, this.energyTarget, dt, energyTau);
    this.dragEnergy = exponentialStep(this.dragEnergy, this.dragEnergyTarget, dt, dragTau);
    this.releaseImpulse = exponentialStep(
      this.releaseImpulse,
      0,
      dt,
      this.options.releaseDecay,
    );

    if (
      this.phase === "released"
      && this.releasedAt !== null
      && now - this.releasedAt >= this.options.releasedMs
    ) {
      this.phase = "settling";
      this.releasedAt = null;
    }

    if (this.phase === "settling" && this.#isSettled()) this.#finishSettling();
  }

  #isSettled() {
    const epsilon = this.options.settleEpsilon;
    return this.energy < epsilon
      && this.dragEnergy < epsilon
      && this.releaseImpulse < epsilon
      && Math.abs(this.tiltX) < epsilon
      && Math.abs(this.tiltY) < epsilon
      && Math.abs(this.tiltVelocityX) < epsilon * 10
      && Math.abs(this.tiltVelocityY) < epsilon * 10
      && Math.abs(this.x - this.targetX) < epsilon
      && Math.abs(this.y - this.targetY) < epsilon
      && Math.abs(this.velocityX) < epsilon * 10
      && Math.abs(this.velocityY) < epsilon * 10;
  }

  #finishSettling() {
    this.phase = "idle";
    this.source = null;
    this.active = false;
    this.dragging = false;
    this.energy = 0;
    this.energyTarget = 0;
    this.dragEnergy = 0;
    this.dragEnergyTarget = 0;
    this.releaseImpulse = 0;
    this.tiltX = 0;
    this.tiltY = 0;
    this.tiltVelocityX = 0;
    this.tiltVelocityY = 0;
    this.tiltTargetX = 0;
    this.tiltTargetY = 0;
    this.velocityX = 0;
    this.velocityY = 0;
    this.x = this.targetX;
    this.y = this.targetY;
    this.releasedAt = null;
  }
}

export function createStageInteraction(options) {
  return new StageInteraction(options);
}
