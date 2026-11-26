// 特效:景深灯泡(散景)、雪、地面闪光、爱心、烟花。全部是 uTime 的确定性函数,可随意拖动进度。
import * as THREE from 'three';

export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const additive = (extra) => ({
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  ...extra,
});

/* ---------- 景深灯泡:近处是锐利光点,离焦后变成带亮边的散景圆斑 ---------- */
export class Bulbs {
  constructor(max = 4096) {
    this.max = max;
    this.n = 0;
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.phase = new Float32Array(max);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1));
    g.setAttribute('aPhase', new THREE.BufferAttribute(this.phase, 1));
    g.setDrawRange(0, 0);
    this.uniforms = {
      uTime: { value: 0 }, uFocus: { value: 6 }, uAperture: { value: 0.4 },
      uScale: { value: 800 }, uH: { value: 1080 }, uMaxSize: { value: 160 },
      uGain: { value: 1 }, uPulse: { value: 0 },
    };
    const m = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: /* glsl */ `
        attribute vec3 aColor; attribute float aSize; attribute float aPhase;
        uniform float uTime, uFocus, uAperture, uScale, uH, uMaxSize, uGain, uPulse;
        varying vec3 vColor; varying float vAlpha; varying float vBlur;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          float depth = max(-mv.z, 0.2);
          float basePx = max(aSize * uScale / depth, 1.0);
          float coc = uAperture * abs(depth - uFocus) / depth * uH * 0.09;
          float px = min(max(basePx, coc), uMaxSize);
          float e = clamp(pow(basePx / px, 1.35), 0.07, 1.0);
          float tw = 0.82 + 0.18 * sin(uTime * (1.2 + aPhase * 2.2) + aPhase * 50.0);
          vColor = aColor * uGain * tw * (1.0 + uPulse * 0.7);
          vAlpha = e;
          vBlur = clamp((px - basePx) / px, 0.0, 1.0);
          gl_PointSize = px;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vColor; varying float vAlpha; varying float vBlur;
        void main() {
          vec2 p = gl_PointCoord - 0.5;
          float d = length(p) * 2.0;
          float core = exp(-d * d * 5.0);
          float disc = smoothstep(1.0, 0.9, d) * (0.62 + 0.38 * smoothstep(0.55, 0.96, d));
          float shape = mix(core, disc, vBlur);
          if (shape < 0.003) discard;
          gl_FragColor = vec4(vColor, shape * vAlpha);
        }`,
      ...additive(),
    });
    this.points = new THREE.Points(g, m);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
  }
  add(x, y, z, r, g, b, size, phase = Math.random()) {
    if (this.n >= this.max) return;
    const i = this.n++;
    this.pos.set([x, y, z], i * 3);
    this.col.set([r, g, b], i * 3);
    this.size[i] = size;
    this.phase[i] = phase;
  }
  commit() {
    const g = this.points.geometry;
    for (const k of ['position', 'aColor', 'aSize', 'aPhase']) g.attributes[k].needsUpdate = true;
    g.setDrawRange(0, this.n);
  }
}

/* ---------- 飘雪 ---------- */
export function createSnow(count = 3600) {
  const R = rng(11);
  const pos = new Float32Array(count * 3), seed = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    pos[i * 3] = (R() - 0.5) * 60;
    pos[i * 3 + 1] = R() * 30;
    pos[i * 3 + 2] = (R() - 0.5) * 60;
    seed[i] = R();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  const uniforms = { uTime: { value: 0 }, uScale: { value: 800 }, uMaxSize: { value: 120 }, uCam: { value: new THREE.Vector3() }, uGain: { value: 1 } };
  const m = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      attribute float aSeed; uniform float uTime, uScale, uMaxSize; uniform vec3 uCam;
      varying float vA;
      void main() {
        vec3 p = position;
        float sp = 0.7 + aSeed * 1.1;
        p.y = mod(p.y - uTime * sp, 30.0);
        p.x += sin(uTime * 0.55 + aSeed * 31.0 + p.y * 0.35) * 0.55 + uTime * 0.16;
        p.z += cos(uTime * 0.43 + aSeed * 17.0 + p.y * 0.3) * 0.5;
        p.x = uCam.x + mod(p.x - uCam.x + 30.0, 60.0) - 30.0;
        p.z = uCam.z + mod(p.z - uCam.z + 30.0, 60.0) - 30.0;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        float depth = max(-mv.z, 0.1);
        float size = 0.02 + aSeed * 0.03;
        gl_PointSize = clamp(size * uScale / depth, 1.4, uMaxSize);
        vA = smoothstep(0.5, 2.5, depth) * (1.0 - smoothstep(32.0, 60.0, depth)) * (0.5 + 0.5 * aSeed);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uGain; varying float vA;
      void main() {
        float d = length(gl_PointCoord - 0.5) * 2.0;
        float a = pow(clamp(1.0 - d, 0.0, 1.0), 1.4);
        if (a < 0.01) discard;
        gl_FragColor = vec4(vec3(0.95, 0.98, 1.08) * 1.25 * uGain, a * vA * 0.9);
      }`,
    ...additive(),
  });
  const pts = new THREE.Points(g, m);
  pts.frustumCulled = false;
  pts.renderOrder = 6;
  return { points: pts, uniforms };
}

/* ---------- 雪面闪光 ---------- */
export function createGlitter(count = 2200, radius = 18) {
  const R = rng(77);
  const pos = new Float32Array(count * 3), seed = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const a = R() * Math.PI * 2, r = Math.sqrt(R()) * radius;
    pos[i * 3] = Math.cos(a) * r;
    pos[i * 3 + 1] = 0.012 + R() * 0.04;
    pos[i * 3 + 2] = Math.sin(a) * r;
    seed[i] = R();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  const uniforms = { uTime: { value: 0 }, uScale: { value: 800 } };
  const m = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      attribute float aSeed; uniform float uTime, uScale; varying float vA;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        float depth = max(-mv.z, 0.2);
        float tw = pow(max(0.0, sin(uTime * (0.7 + aSeed * 2.4) + aSeed * 200.0)), 12.0);
        vA = tw;
        gl_PointSize = clamp((0.05 + aSeed * 0.05) * uScale / depth, 1.0, 34.0);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      varying float vA;
      void main() {
        vec2 p = gl_PointCoord - 0.5;
        float a = exp(-dot(p, p) * 40.0) + 0.7 * exp(-abs(p.x) * 26.0) * exp(-abs(p.y) * 5.0) + 0.7 * exp(-abs(p.y) * 26.0) * exp(-abs(p.x) * 5.0);
        if (vA * a < 0.01) discard;
        gl_FragColor = vec4(vec3(0.85, 0.93, 1.2) * 2.2, a * vA);
      }`,
    ...additive(),
  });
  const pts = new THREE.Points(g, m);
  pts.frustumCulled = false;
  pts.renderOrder = 4;
  return { points: pts, uniforms };
}

/* ---------- 爱心:片元里用隐函数画心形,发光 ---------- */
export function createHearts(count = 150) {
  const pos = new Float32Array(count * 3), birth = new Float32Array(count).fill(1e9), seed = new Float32Array(count);
  const R = rng(520);
  for (let i = 0; i < count; i++) seed[i] = R();
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aBirth', new THREE.BufferAttribute(birth, 1));
  g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  const uniforms = { uTime: { value: 0 }, uScale: { value: 800 }, uMaxSize: { value: 150 } };
  const m = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      attribute float aBirth; attribute float aSeed; uniform float uTime, uScale, uMaxSize;
      varying float vA; varying float vSeed;
      void main() {
        float age = uTime - aBirth;
        float life = 7.0;
        float a = clamp(age, 0.0, life);
        vec3 p = position;
        p.y += a * (0.35 + aSeed * 0.35);
        p.x += sin(a * 0.9 + aSeed * 40.0) * 0.35 * (0.4 + a * 0.12);
        p.z += cos(a * 0.7 + aSeed * 23.0) * 0.28 * (0.4 + a * 0.1);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        float depth = max(-mv.z, 0.1);
        float live = step(0.0, age) * step(age, life);
        float grow = smoothstep(0.0, 0.8, age);
        float fade = 1.0 - smoothstep(life - 2.0, life, age);
        float size = (0.07 + aSeed * 0.09) * (0.8 + 0.2 * sin(age * 3.0 + aSeed * 9.0));
        gl_PointSize = clamp(size * uScale / depth, 1.0, uMaxSize);
        vA = fade * live * grow;
        vSeed = aSeed;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      varying float vA; varying float vSeed;
      void main() {
        vec2 p = (vec2(gl_PointCoord.x, 1.0 - gl_PointCoord.y) - 0.5) * 2.7;
        p.y += 0.12;
        float a = p.x * p.x + p.y * p.y - 1.0;
        float f = a * a * a - p.x * p.x * p.y * p.y * p.y;
        float m = smoothstep(0.06, -0.06, f);
        float halo = exp(-dot(p, p) * 1.6) * 0.35;
        vec3 c = mix(vec3(1.0, 0.42, 0.62), vec3(1.0, 0.78, 0.7), fract(vSeed * 7.0));
        float alpha = clamp(m + halo, 0.0, 1.0) * vA;
        if (alpha < 0.01) discard;
        gl_FragColor = vec4(c * (0.9 + m * 0.75), alpha);
      }`,
    ...additive(),
  });
  const pts = new THREE.Points(g, m);
  pts.frustumCulled = false;
  pts.renderOrder = 7;
  let next = 0;
  // 在 [t0,t1] 时间窗内,围绕 center 持续冒出 n 颗爱心
  function emit(center, n, t0, t1, sx = 0.9, sz = 0.55, y0 = 0.5, y1 = 1.7) {
    const r = rng(Math.floor(t0 * 100) + n);
    for (let k = 0; k < n; k++) {
      const i = next++ % count;
      pos[i * 3] = center.x + (r() - 0.5) * 2 * sx;
      pos[i * 3 + 1] = y0 + r() * (y1 - y0);
      pos[i * 3 + 2] = center.z + (r() - 0.5) * 2 * sz;
      birth[i] = t0 + r() * (t1 - t0);
    }
    g.attributes.position.needsUpdate = true;
    g.attributes.aBirth.needsUpdate = true;
  }
  return { points: pts, uniforms, emit };
}

/* ---------- 烟花:解析式(含阻力+重力),纯函数于 uTime ---------- */
export function createFireworks(maxParticles = 2600) {
  const pos = new Float32Array(maxParticles * 3), vel = new Float32Array(maxParticles * 3), col = new Float32Array(maxParticles * 3);
  const birth = new Float32Array(maxParticles).fill(1e9), seed = new Float32Array(maxParticles), kind = new Float32Array(maxParticles);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aVel', new THREE.BufferAttribute(vel, 3));
  g.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
  g.setAttribute('aBirth', new THREE.BufferAttribute(birth, 1));
  g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  g.setAttribute('aKind', new THREE.BufferAttribute(kind, 1));
  const uniforms = { uTime: { value: 0 }, uScale: { value: 800 }, uMaxSize: { value: 140 } };
  const m = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      attribute vec3 aVel; attribute vec3 aColor; attribute float aBirth; attribute float aSeed; attribute float aKind;
      uniform float uTime, uScale, uMaxSize;
      varying vec3 vC; varying float vA;
      void main() {
        float age = uTime - aBirth;
        bool flash = aKind > 0.5;
        float life = flash ? 0.5 : 2.6 + aSeed * 0.9;
        float k = 1.7;
        float a = max(age, 0.0);
        float f = (1.0 - exp(-k * a)) / k;
        vec3 p = position + aVel * f;
        p.y -= (4.2 / k) * (a - f);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        float depth = max(-mv.z, 0.1);
        float live = step(0.0, age) * step(age, life);
        float u = clamp(age / life, 0.0, 1.0);
        float fade = flash ? (1.0 - u) * (1.0 - u) : pow(1.0 - u, 1.4);
        float flick = flash ? 1.0 : 0.65 + 0.35 * sin(age * 34.0 + aSeed * 100.0);
        float size = flash ? 11.0 * (0.4 + u) : (0.34 + aSeed * 0.3) * (1.0 - 0.5 * u);
        gl_PointSize = clamp(size * uScale / depth, 1.0, uMaxSize);
        vC = aColor * flick * (flash ? 2.4 : 2.0);
        vA = fade * live;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vC; varying float vA;
      void main() {
        float d = length(gl_PointCoord - 0.5) * 2.0;
        float a = exp(-d * d * 4.5);
        if (a * vA < 0.01) discard;
        gl_FragColor = vec4(vC, a * vA);
      }`,
    ...additive(),
  });
  const pts = new THREE.Points(g, m);
  pts.frustumCulled = false;
  pts.renderOrder = 8;
  let next = 0;
  function push(cx, cy, cz, vx, vy, vz, c, t0, sd, kd) {
    const i = next++;
    if (i >= maxParticles) return;
    pos.set([cx, cy, cz], i * 3);
    vel.set([vx, vy, vz], i * 3);
    col.set(c, i * 3);
    birth[i] = t0;
    seed[i] = sd;
    kind[i] = kd;
  }
  // shape: 'sphere' | 'heart' | 'ring'
  function burst(center, t0, color, n = 240, speed = 14, shape = 'sphere') {
    const r = rng(Math.floor(t0 * 1000) + n);
    push(center.x, center.y, center.z, 0, 0, 0, color, t0, 0.5, 1);
    for (let i = 0; i < n; i++) {
      let vx, vy, vz;
      if (shape === 'heart') {
        const t = (i / n) * Math.PI * 2;
        const hx = 16 * Math.pow(Math.sin(t), 3);
        const hy = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
        const s = (speed / 16) * (0.97 + r() * 0.06);
        vx = hx * s; vy = (hy + 1.5) * s; vz = (r() - 0.5) * 1.2;
      } else if (shape === 'ring') {
        const t = (i / n) * Math.PI * 2;
        vx = Math.cos(t) * speed; vy = Math.sin(t) * speed * 0.35; vz = Math.sin(t) * speed * 0.9;
      } else {
        const u = r() * 2 - 1, th = r() * Math.PI * 2, s = Math.sqrt(1 - u * u);
        const sp = speed * (0.55 + r() * 0.45);
        vx = s * Math.cos(th) * sp; vy = u * sp; vz = s * Math.sin(th) * sp;
      }
      push(center.x, center.y, center.z, vx, vy, vz, color, t0, r(), 0);
    }
    for (const k of ['position', 'aVel', 'aColor', 'aBirth', 'aSeed', 'aKind']) g.attributes[k].needsUpdate = true;
  }
  return { points: pts, uniforms, burst };
}
