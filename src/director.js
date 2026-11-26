// 导演:全部是时间 t 的确定性函数 —— 镜头、姿态、表情、字幕、特效参数,可随意拖动/重播。
import * as THREE from 'three';
import { POSE0 } from './character.js';

const D = Math.PI / 180;
export const DURATION = 58;

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const smooth = (x) => { x = clamp01(x); return x * x * (3 - 2 * x); };
const lerp = (a, b, t) => a + (b - a) * t;
const lerp3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

/* ================= 姿态轨道 ================= */
const GY = -65 * D, BY = 65 * D;
const clasp = { lx: 0.035, ly: 0.13, lz: 0.23, rx: -0.035, ry: 0.11, rz: 0.21, out: 0.8 };
const fists = { lx: 0.055, ly: 0.36, lz: 0.2, rx: -0.055, ry: 0.34, rz: 0.21, out: 0.9 };
const heartPress = { lx: 0.02, ly: 0.37, lz: 0.23, rx: -0.045, ry: 0.385, rz: 0.2, out: 0.9 };
const mouthCover = { lx: 0.05, ly: 0.645, lz: 0.2, rx: -0.05, ry: 0.625, rz: 0.21, out: 1.0 };
const rest = { lx: 0.25, ly: -0.06, lz: 0.08, rx: -0.25, ry: -0.06, rz: 0.08, out: 0.5 };

const girlKeys = [
  [0, { x: 0.95, yaw: GY, lean: 0.03, hp: 0.28, hy: 0.12, hr: 0.08, ...clasp }],
  [8.6, { hp: 0.24, hy: 0.16 }],
  [10.6, { hp: 0.05, hy: -0.1, hr: 0.0 }],
  [13.2, { hp: 0.22, hy: 0.14, hr: 0.08, lean: 0.02 }],
  [17.2, { hp: 0.3, hy: 0.18, hr: 0.1, lean: 0.0, x: 0.93 }],
  [21.4, { hp: 0.1, hy: -0.05, hr: 0.03, lean: 0.05, x: 0.88 }],
  [23.4, { hp: 0.0, hy: -0.02, hr: 0, lean: 0.07, x: 0.78, ...fists }],
  [27.0, { x: 0.62, lean: 0.1, hp: -0.07, hr: -0.03, ...heartPress }],
  [33.0, { lean: 0.09, hp: 0.08, hr: 0.04 }],
  [38.2, { lean: 0.06, hp: 0.12, hr: 0.1, ...mouthCover }],
  [41.0, { hold: 0, lx: 0.2, ly: 0.28, lz: 0.3, rx: -0.05, ry: 0.4, rz: 0.2, out: 0.8 }],
  [43.0, { x: 0.42, hold: 1, hp: 0.04, hr: 0.1 }],
  [58, { hold: 1, hr: 0.14 }],
];
const boyKeys = [
  [0, { x: -0.95, yaw: BY, lean: 0, hp: 0.02, hy: 0, hr: 0, ...rest }],
  [25.0, {}],
  [26.8, { lean: -0.05, hp: -0.04 }],
  [30.0, { lean: -0.04, hp: 0.0, hy: -0.05 }],
  [33.4, { lean: -0.01, hp: 0.28, hy: -0.15, hr: 0.07, rx: -0.05, ry: 0.665, rz: 0.2, out: 1.0 }],
  [35.6, {}],
  [36.5, { hp: 0.14, hy: -0.06, hr: 0.04, rx: -0.22, ry: 0.16, rz: 0.14, out: 0.6 }],
  [38.4, { hp: 0.06, hy: 0, hr: 0 }],
  [40.4, { x: -0.5, lean: 0.05, hp: 0.05 }],
  [43.0, { x: -0.42, hold: 1, lean: 0.06 }],
  [58, { hold: 1, hr: -0.06 }],
];
function buildTrack(keys) {
  const out = [];
  let cur = { ...POSE0 };
  for (const [t, o] of keys) { cur = { ...cur, ...o }; out.push([t, cur]); }
  return out;
}
const girlTrack = buildTrack(girlKeys), boyTrack = buildTrack(boyKeys);
function sampleTrack(tr, t, out) {
  let a, b, u;
  if (t <= tr[0][0]) { a = b = tr[0][1]; u = 0; }
  else {
    a = b = tr[tr.length - 1][1]; u = 0;
    for (let i = 0; i < tr.length - 1; i++) {
      if (t < tr[i + 1][0]) { a = tr[i][1]; b = tr[i + 1][1]; u = smooth((t - tr[i][0]) / (tr[i + 1][0] - tr[i][0])); break; }
    }
  }
  for (const k in a) out[k] = a[k] + (b[k] - a[k]) * u;
  return out;
}

/* ================= 表情、字幕 ================= */
const girlExpr = [[0, 'nervous'], [8.5, 'soft'], [12.8, 'nervous'], [17.2, 'down'], [21.6, 'resolve'], [25.4, 'confess'], [32.4, 'wait'], [38.4, 'teary'], [43.5, 'happy']];
const boyExpr = [[0, 'calm'], [25.4, 'surprised'], [32.6, 'blush'], [36.5, 'gentle'], [43.5, 'happy']];
const exprAt = (arr, t) => { let n = arr[0][1]; for (const [k, name] of arr) if (t >= k) n = name; return n; };

const LINES = [
  [8.6, 12.6, 'g', '……圣诞夜的雪,比我想象的还要安静呢。'],
  [12.9, 16.9, 'g', '今天把你叫出来,是有一句话,在心里练习了好多遍。'],
  [17.4, 21.2, 'g', '可是真的站在你面前,脑子里全都空白了……'],
  [21.8, 24.8, 'g', '所以,我只说一次。'],
  [25.6, 32.4, 'g', '我喜欢你。不是朋友的那种——是想一直站在你身边的那种。'],
  [36.6, 39.4, 'b', '……这句话,应该由我先说才对吧。'],
  [40.2, 43.8, 'g', '那……从今天开始,请多指教了。'],
  [44.4, 47.2, 'b', '嗯。请多指教。'],
];
const NAMES = { g: '澪', b: '朔' };

/* ================= 镜头 ================= */
// 锚点:world 固定世界坐标;girl/boy 以对应头部为原点。p=机位,l=注视点,fov。
const SHOTS = [
  { t0: 0, t1: 8.2, anchor: 'world', ease: 'io', a: { p: [15, 10, 21], l: [2, 3, -4], fov: 44 }, b: { p: [4.4, 2.5, 9.2], l: [0.3, 1.45, 0], fov: 33 }, shake: 0.004, ap: 0.22, key: 0 },
  { t0: 8.2, t1: 17, anchor: 'world', ease: 'lin', a: { p: [1.0, 1.4, 5.6], l: [0.15, 1.25, 0], fov: 32 }, b: { p: [0.55, 1.38, 4.2], l: [0.1, 1.28, 0], fov: 30 }, shake: 0.005, ap: 0.5, key: 0.4 },
  { t0: 17, t1: 25, anchor: 'girl', ease: 'lin', a: { p: [-1.0, 0.07, 1.25], l: [-0.12, -0.01, 0], fov: 28 }, b: { p: [-0.9, 0.05, 1.0], l: [-0.1, 0, 0], fov: 26 }, shake: 0.004, ap: 0.9, key: 1.0 },
  { t0: 25, t1: 33, anchor: 'girl', ease: 'lin', a: { p: [-0.95, 0.06, 1.0], l: [-0.08, -0.005, 0], fov: 26 }, b: { p: [-0.75, 0.04, 0.75], l: [-0.05, -0.01, 0], fov: 22 }, shake: 0.003, ap: 1.1, key: 1.1 },
  { t0: 33, t1: 39.5, anchor: 'boy', ease: 'lin', a: { p: [0.85, 0.05, 1.25], l: [0.1, 0, 0], fov: 28 }, b: { p: [0.72, 0.04, 1.0], l: [0.08, 0, 0], fov: 24 }, shake: 0.004, ap: 1.0, key: 1.0 },
  { t0: 39.5, t1: 47.5, anchor: 'orbit', ease: 'io', a: { phi: -38, R: 3.8, h: 0.45, l: [0, 1.2, 0], fov: 38 }, b: { phi: 22, R: 3.0, h: 1.25, l: [0, 1.2, 0], fov: 34 }, shake: 0.004, ap: 0.6, key: 0.7 },
  { t0: 47.5, t1: 58, anchor: 'world', ease: 'io', a: { p: [0, 1.7, 4.8], l: [0, 1.5, 0], fov: 38 }, b: { p: [0, 6.0, 17], l: [0, 5.5, -20], fov: 50 }, shake: 0.002, ap: 0.3, key: 0 },
];
const ease = (k, u) => (k === 'io' ? smooth(u) : k === 'out' ? 1 - (1 - u) * (1 - u) : u);
export const SHOT_TIMES = SHOTS.map((s) => s.t0);

/* ================= 慢动作:fx 时间是 t 的确定积分 ================= */
export const slowScale = (t) => 1 - 0.72 * smooth((t - 24.2) / 1.2) * (1 - smooth((t - 38.8) / 1.4));
const FX_STEP = 0.02;
const FX_TABLE = (() => {
  const n = Math.ceil(DURATION / FX_STEP) + 2, a = new Float32Array(n);
  for (let i = 1; i < n; i++) a[i] = a[i - 1] + slowScale(i * FX_STEP) * FX_STEP;
  return a;
})();
export function fxTime(t) {
  const f = Math.max(0, t) / FX_STEP, i = Math.floor(f);
  if (i >= FX_TABLE.length - 1) return FX_TABLE[FX_TABLE.length - 1] + (t - (FX_TABLE.length - 1) * FX_STEP) * slowScale(t);
  return lerp(FX_TABLE[i], FX_TABLE[i + 1], f - i);
}

/* ================= 事件(仅音频触发,正常播放跨过时间点才响) ================= */
const FIREWORK_T = [47.8, 48.9, 50.1, 51.6, 52.9, 54.2, 55.6];
const EVENTS = [
  [27.2, (a) => { a.chime([79, 84, 88, 91, 96], 0.1, 0.09); a.level = 1; }],
  [32.4, (a) => a.heartbeat(84, 7, 0.55)],
  [36.0, (a) => a.heartbeat(118, 5, 0.6)],
  [37.0, (a) => a.chime([76, 79, 83, 88], 0.12, 0.07)],
  [43.0, (a) => a.chime([84, 88, 91, 96, 100], 0.1, 0.08)],
  ...FIREWORK_T.map((ft) => [ft, (a) => { a.pop(0.2); setTimeout(() => a.pop(0.08), 700); }]),
  [57.0, (a) => { a.level = 0.4; }],
];

/* ================= 烟花与爱心的"剧本" ================= */
export function scheduleFx(world) {
  const f = (t) => fxTime(t);
  world.hearts.emit(new THREE.Vector3(0, 0, 0.1), 80, f(37.8), f(48), 1.0, 0.7, 0.4, 1.8);
  world.hearts.emit(new THREE.Vector3(0, 0, 0.1), 50, f(48), f(57), 1.2, 0.8, 0.4, 2.0);
  world.hearts.emit(new THREE.Vector3(0.1, 0, 0.1), 14, f(27.2), f(28.6), 0.7, 0.4, 0.8, 1.8); // 告白瞬间的一小簇
  const cols = [[1, 0.78, 0.35], [1, 0.45, 0.7], [0.4, 0.85, 1], [0.75, 0.6, 1], [1, 0.9, 0.7], [0.5, 1, 0.8], [1, 0.55, 0.45]];
  const pos = [[-18, 20, -42], [20, 23, -48], [-6, 17, -40], [0, 19, -44], [-24, 18, -38], [12, 16, -40], [26, 21, -46]];
  FIREWORK_T.forEach((ft, i) => {
    const heart = i === 3;
    world.fireworks.burst(new THREE.Vector3(...pos[i]), f(ft), heart ? [1, 0.4, 0.62] : cols[i % cols.length], heart ? 280 : 300, heart ? 12.5 : 15, heart ? 'heart' : i % 3 === 2 ? 'ring' : 'sphere');
  });
}

/* ================= 导演 ================= */
export function createDirector({ girl, boy, camera }) {
  const gp = {}, bp = {};
  const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), head = new THREE.Vector3(), M = new THREE.Vector3(), E = new THREE.Vector3();
  const hg = new THREE.Vector3(), hb = new THREE.Vector3(), hgW = new THREE.Vector3(), hbW = new THREE.Vector3();
  const camP = new THREE.Vector3(), camL = new THREE.Vector3();
  let lastT = -1, lastGE = '', lastBE = '';

  function poses(t, snap) {
    sampleTrack(girlTrack, t, gp);
    sampleTrack(boyTrack, t, bp);
    // 牵手的世界目标点:两人中点偏向镜头一侧
    M.set((gp.x + bp.x) / 2, 1.08, 0.26);
    E.set(1, 0, 0);
    hgW.copy(M).addScaledVector(E, 0.045);
    hbW.copy(M).addScaledVector(E, -0.045);
    girl.applyPose(gp, t, hgW);
    boy.applyPose(bp, t, hbW);
    const ge = exprAt(girlExpr, t), be = exprAt(boyExpr, t);
    if (ge !== lastGE) { girl.setExpression(ge, snap); lastGE = ge; }
    if (be !== lastBE) { boy.setExpression(be, snap); lastBE = be; }
    girl.ball.getWorldPosition(hg);
    boy.ball.getWorldPosition(hb);
  }

  function frame(t, dt, env) {
    const { audio, live, free } = env;
    const seek = Math.abs(t - lastT) > 0.5 || lastT < 0;
    poses(t, seek);

    /* ---- 镜头 ---- */
    let si = SHOTS.findIndex((s) => t >= s.t0 && t < s.t1);
    if (si < 0) si = SHOTS.length - 1;
    const S = SHOTS[si];
    const u = ease(S.ease, clamp01((t - S.t0) / (S.t1 - S.t0)));
    let fov, focusPt;
    if (S.anchor === 'orbit') {
      const phi = lerp(S.a.phi, S.b.phi, u) * D, R = lerp(S.a.R, S.b.R, u), h = lerp(S.a.h, S.b.h, u);
      camP.set(Math.sin(phi) * R, h, Math.cos(phi) * R);
      camL.set(...lerp3(S.a.l, S.b.l, u));
      fov = lerp(S.a.fov, S.b.fov, u);
      focusPt = camL;
    } else {
      const p = lerp3(S.a.p, S.b.p, u), l = lerp3(S.a.l, S.b.l, u);
      fov = lerp(S.a.fov, S.b.fov, u);
      if (S.anchor === 'world') { camP.set(...p); camL.set(...l); }
      else {
        head.copy(S.anchor === 'girl' ? hg : hb);
        camP.set(...p).add(head);
        camL.set(...l).add(head);
      }
      focusPt = camL;
    }
    const sh = S.shake;
    const sx = Math.sin(t * 1.1 + 1) * 0.6 + Math.sin(t * 2.3) * 0.4, sy = Math.sin(t * 0.9) * 0.5 + Math.sin(t * 2.9 + 2) * 0.3, sz = Math.sin(t * 1.3 + 4) * 0.5;
    camP.x += sx * sh; camP.y += sy * sh; camP.z += sz * sh;
    camL.x += sy * sh * 0.5; camL.y += sx * sh * 0.4;

    const focus = (S.anchor === 'world' || S.anchor === 'orbit')
      ? camP.distanceTo(v1.set(0, 1.4, 0))
      : camP.distanceTo(focusPt);
    const keyK = lerp(si > 0 ? SHOTS[si - 1].key : S.key, S.key, smooth((t - S.t0) / 0.6));

    /* ---- 后期参数 ---- */
    const cu = S.anchor === 'girl' || S.anchor === 'boy';
    let bloom = cu ? 0.62 : 0.55, vig = cu ? 0.5 : 0.36;
    bloom += 0.22 * smooth((t - 25) / 2) * (1 - smooth((t - 31) / 3));
    if (t > 32.4 && t < 39) vig += 0.2;
    const cutFade = si > 0 ? Math.max(0, 1 - (t - S.t0) / 0.3) * 0.7 : 0;
    const fade = Math.max(1 - smooth(t / 1.6), cutFade);
    const flash = t > 27.2 ? Math.exp(-(t - 27.2) * 3.4) * 0.9 : 0;
    // 心跳脉冲(同步灯光闪烁)
    let pulse = 0.1 * (0.5 + 0.5 * Math.sin(t * 2));
    if (t > 32.4 && t < 38.8) {
      const bpm = lerp(84, 118, smooth((t - 32.4) / 5));
      const ph = (((t - 32.4) * bpm) / 60) % 1;
      pulse = Math.exp(-ph * 7) * 0.9 + Math.exp(-Math.abs(ph - 0.3) * 16) * 0.45;
    }
    if (t > 27.2 && t < 29) pulse = Math.max(pulse, 0.9 * (1 - (t - 27.2) / 1.8));

    /* ---- 字幕 ---- */
    let sub = null;
    for (const [t0, t1, who, text] of LINES) {
      if (t >= t0 && t < t1 + 0.7) {
        const n = Math.min(text.length, Math.floor((t - t0) * 15) + 1);
        sub = { who: NAMES[who], tone: who, text: text.slice(0, n), alpha: clamp01((t1 + 0.7 - t) / 0.5) * clamp01((t - t0) / 0.15 + 0.3) };
        break;
      }
    }
    /* ---- 标题卡 ---- */
    let title = null;
    if (t > 0.8 && t < 5.8) title = { a: '雪夜 · 告白', b: 'SNOWY NIGHT · A CONFESSION', c: '原创角色 / 3D 实时渲染', alpha: smooth((t - 0.8) / 1.2) * (1 - smooth((t - 4.6) / 1.2)) };
    else if (t > 50.4) title = { a: '圣诞快乐', b: 'MERRY CHRISTMAS', c: '', alpha: smooth((t - 50.4) / 1.4) };

    /* ---- 音频事件 ---- */
    if (live && audio && !seek) for (const [et, fn] of EVENTS) if (lastT < et && t >= et) fn(audio);

    lastT = t;
    return { fov, camP, camL, focus, aperture: S.ap * (cu ? 1 : 1), keyK, bloom, vig, fade, flash, pulse, sub, title, shot: si, free };
  }

  return { frame, reset() { lastT = -1; lastGE = lastBE = ''; } };
}
