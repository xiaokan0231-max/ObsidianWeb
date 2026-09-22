// 指针动量场。
//
// 手感的关键不在「粒子被吸向光标」，而在「指针扫过时把粒子甩出去，
// 之后每颗粒子各自滑行、各自归位」。前者停手即死（距离一变远，位移立刻消失）；
// 后者停手之后位移才刚开始长起来，一秒左右到峰值再慢慢落回，所以画面一直是活的。
//
// 实现上不走 GPGPU 状态纹理：位移对时间有解析解，着色器只要拿到
// 「笔画 + 冲量 + 年龄」就能直接求值，省掉一整套 ping-pong 渲染靶。

/** 超过这个年龄的笔画不再有可见位移（e^-6 ≈ 0.25%），直接回收。 */
export const MOTION_SETTLE_SECONDS = 6;
/** 同时参与计算的笔画数。着色器里是常量循环上界，改这里要一起改。 */
export const MOTION_STROKE_LIMIT = 6;
/** 单帧冲量上限。防的是一次瞬移（切窗口回来、指针跳变）把粒子整片甩飞。 */
export const MOTION_IMPULSE_CLAMP = 0.18;
/** 冲量转速度的增益。 */
export const MOTION_IMPULSE_GAIN = 5.4;
/** 逐粒子速度上限。夹在这一层而不是夹累计冲量，动量总量才不随帧率变化：
 *  一笔的冲量等于这段路程，与切了几帧无关；上限只负责封顶，不参与日常取值。 */
export const MOTION_SPEED_CLAMP = 0.5;
/** 质量区间：小粒子轻、反应快，大粒子沉、跟得慢。 */
export const MOTION_MASS_MIN = 0.65;
export const MOTION_MASS_MAX = 2.4;

// 一笔持续多久就换下一笔。太短则 6 笔只覆盖几帧、拖尾没有长度；
// 太长则快速划过时整段被压成一条直线，丢掉轨迹的弯曲。
const STROKE_WINDOW_SECONDS = 0.09;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function finite(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

/**
 * 粒子质量。参数是粒子的尺寸系数，尺寸越大越沉。
 */
export function motionMass(size) {
  const normalized = clamp((finite(size, 0) - 0.08) / 0.22, 0, 1);
  const eased = normalized * normalized * (3 - 2 * normalized);
  return MOTION_MASS_MIN + (MOTION_MASS_MAX - MOTION_MASS_MIN) * eased;
}

/**
 * 滑行位移的解析解，与着色器里的 astraCoast 必须逐字一致。
 *
 * 解的是 x' = v - x、v' = -drag·v：速度按 drag 衰减，位移以 1 秒的时间常数回零。
 * 因为是解析解，帧率再抖也不会影响轨迹——不需要逐帧积分。
 */
export function coastOffset(velocity, mass, age) {
  const safeMass = clamp(finite(mass, 1), MOTION_MASS_MIN, MOTION_MASS_MAX);
  const safeAge = Math.max(0, finite(age, 0));
  const drag = 2.3 / Math.sqrt(safeMass);
  const velocityDecay = Math.exp(-drag * safeAge);
  const returnDecay = Math.exp(-safeAge);
  return finite(velocity, 0) * (returnDecay - velocityDecay) / (drag - 1);
}

/**
 * 一段笔画对某个位置的影响权重。距离量的是到「上一帧到这一帧」这条线段的距离，
 * 不是到光标那一点——否则快速划过时两帧之间的粒子会被整排跳过。
 */
export function strokeWeight(px, py, originX, originY, segmentX, segmentY, radius) {
  const lengthSquared = segmentX * segmentX + segmentY * segmentY;
  const t = lengthSquared > 1e-12
    ? clamp(((px - originX) * segmentX + (py - originY) * segmentY) / lengthSquared, 0, 1)
    : 0;
  const dx = px - originX - segmentX * t;
  const dy = py - originY - segmentY * t;
  const distance = Math.hypot(dx, dy);
  const safeRadius = Math.max(radius, 1e-4);
  const normalized = clamp(distance / safeRadius, 0, 1);
  const falloff = 1 - normalized * normalized * (3 - 2 * normalized);
  return falloff * falloff;
}

/**
 * 指针动量场。坐标一律用 NDC（-1..1，y 向上），由调用方负责换算。
 */
export function createPointerMotionField(options = {}) {
  const limit = Math.max(1, Math.floor(options.strokes ?? MOTION_STROKE_LIMIT));
  const settleSeconds = options.settleSeconds ?? MOTION_SETTLE_SECONDS;
  const strokeWindow = options.strokeWindow ?? STROKE_WINDOW_SECONDS;
  const impulseClamp = options.impulseClamp ?? MOTION_IMPULSE_CLAMP;

  const origins = new Float32Array(limit * 2);
  const segments = new Float32Array(limit * 2);
  const impulses = new Float32Array(limit * 2);
  const ages = new Float32Array(limit).fill(settleSeconds);

  let lastX = null;
  let lastY = null;
  let head = -1;
  let releaseX = 0;
  let releaseY = 0;
  let releaseImpulse = 0;
  let releaseAge = settleSeconds;

  const openStroke = (originX, originY) => {
    head = (head + 1) % limit;
    const index2 = head * 2;
    origins[index2] = originX;
    origins[index2 + 1] = originY;
    segments[index2] = 0;
    segments[index2 + 1] = 0;
    impulses[index2] = 0;
    impulses[index2 + 1] = 0;
    ages[head] = 0;
  };

  // 一笔的累计冲量只封一个宽松的顶，正常划动够不到它。
  const strokeCeiling = impulseClamp * 4;
  const applyStrokeCeiling = (index) => {
    const index2 = index * 2;
    const length = Math.hypot(impulses[index2], impulses[index2 + 1]);
    if (length > strokeCeiling && length > 1e-9) {
      const scale = strokeCeiling / length;
      impulses[index2] *= scale;
      impulses[index2 + 1] *= scale;
    }
  };

  return {
    origins,
    segments,
    impulses,
    ages,
    get strokes() {
      return limit;
    },
    get releaseCenter() {
      return [releaseX, releaseY];
    },
    get releaseImpulse() {
      return releaseImpulse;
    },
    get releaseAge() {
      return releaseAge;
    },

    /** 指针移到新位置。第一次调用只记录起点，不产生笔画。 */
    push(x, y) {
      const nextX = finite(x, 0);
      const nextY = finite(y, 0);
      if (lastX === null || lastY === null) {
        lastX = nextX;
        lastY = nextY;
        return;
      }
      let deltaX = nextX - lastX;
      let deltaY = nextY - lastY;
      lastX = nextX;
      lastY = nextY;
      if (Math.abs(deltaX) < 1e-6 && Math.abs(deltaY) < 1e-6) return;
      const step = Math.hypot(deltaX, deltaY);
      if (step > impulseClamp) {
        deltaX *= impulseClamp / step;
        deltaY *= impulseClamp / step;
      }
      // 同一笔窗口内继续延长当前笔画，冲量累加；超窗则另起一笔。
      if (head < 0 || ages[head] > strokeWindow) openStroke(nextX - deltaX, nextY - deltaY);
      const index2 = head * 2;
      segments[index2] = nextX - origins[index2];
      segments[index2 + 1] = nextY - origins[index2 + 1];
      impulses[index2] += deltaX;
      impulses[index2 + 1] += deltaY;
      applyStrokeCeiling(head);
    },

    /** 松手／点击时的一圈径向涟漪，与笔画共用同一套滑行解。 */
    burst(x, y, strength) {
      releaseX = finite(x, 0);
      releaseY = finite(y, 0);
      releaseImpulse = clamp(finite(strength, 0), 0, 1) * impulseClamp;
      releaseAge = 0;
    },

    /** 指针离场：只断开笔画的连续性，已有的笔画继续滑行到自然停住。 */
    lift() {
      lastX = null;
      lastY = null;
    },

    /** 清空全部动量（切换视图、丢失上下文时用）。 */
    reset() {
      ages.fill(settleSeconds);
      origins.fill(0);
      segments.fill(0);
      impulses.fill(0);
      head = -1;
      lastX = null;
      lastY = null;
      releaseImpulse = 0;
      releaseAge = settleSeconds;
    },

    tick(dt) {
      const step = Math.max(0, finite(dt, 0));
      for (let index = 0; index < limit; index += 1) {
        if (ages[index] < settleSeconds) {
          ages[index] = Math.min(settleSeconds, ages[index] + step);
        }
      }
      if (releaseAge < settleSeconds) {
        releaseAge = Math.min(settleSeconds, releaseAge + step);
        if (releaseAge >= settleSeconds) releaseImpulse = 0;
      }
    },

    /** 当前是否还有可见的动量，用来决定能不能停掉重绘。 */
    get active() {
      if (releaseAge < settleSeconds && releaseImpulse > 0) return true;
      for (let index = 0; index < limit; index += 1) {
        if (ages[index] < settleSeconds) return true;
      }
      return false;
    },

    /** 求某点当前的位移，供 CPU 侧（测试、非着色器消费者）复核着色器结果。 */
    offsetAt(px, py, mass, radius, out = [0, 0]) {
      out[0] = 0;
      out[1] = 0;
      for (let index = 0; index < limit; index += 1) {
        const age = ages[index];
        if (age >= settleSeconds) continue;
        const index2 = index * 2;
        const weight = strokeWeight(
          px,
          py,
          origins[index2],
          origins[index2 + 1],
          segments[index2],
          segments[index2 + 1],
          radius,
        );
        if (weight <= 0) continue;
        const gain = MOTION_IMPULSE_GAIN / clamp(mass, MOTION_MASS_MIN, MOTION_MASS_MAX);
        let velocityX = impulses[index2] * gain * weight;
        let velocityY = impulses[index2 + 1] * gain * weight;
        const speed = Math.hypot(velocityX, velocityY);
        if (speed > MOTION_SPEED_CLAMP && speed > 1e-9) {
          velocityX *= MOTION_SPEED_CLAMP / speed;
          velocityY *= MOTION_SPEED_CLAMP / speed;
        }
        out[0] += coastOffset(velocityX, mass, age);
        out[1] += coastOffset(velocityY, mass, age);
      }
      return out;
    },
  };
}
