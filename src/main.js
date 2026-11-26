import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { buildCharacter, outlineUniforms } from './character.js';
import { buildWorld } from './world.js';
import { createDirector, fxTime, slowScale, scheduleFx, DURATION, SHOT_TIMES } from './director.js';
import { AudioEngine } from './audio.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

function fail(msg) {
  const e = $('err');
  e.textContent = msg;
  e.style.display = 'grid';
  $('loading').style.display = 'none';
}

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
} catch (e) {
  fail('无法创建 WebGL 上下文。请使用最新版 Chrome / Edge / Firefox,并确认已开启硬件加速。');
  throw e;
}
let dpr = Math.min(window.devicePixelRatio || 1, params.get('q') === 'low' ? 1 : 1.75);
renderer.setPixelRatio(dpr);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
$('stage').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(34, 16 / 9, 0.1, 1200);
scene.add(camera);

const world = buildWorld(scene, camera);
const girl = buildCharacter('girl');
const boy = buildCharacter('boy');
scene.add(girl.root, boy.root);
scheduleFx(world);
const director = createDirector({ girl, boy, camera });
const audio = new AudioEngine();

/* ---------- 后期:MSAA 渲染目标 → 泛光 → 调色/暗角/颗粒 → 色调映射 ---------- */
const rt = new THREE.WebGLRenderTarget(16, 16, { type: THREE.HalfFloatType, samples: params.get('q') === 'low' ? 0 : 4 });
const composer = new EffectComposer(renderer, rt);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.6, 0.72, 1.0);
composer.addPass(bloom);
const grade = new ShaderPass({
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uVig: { value: 0.4 }, uGrain: { value: 0.035 }, uAber: { value: 0.0022 }, uFade: { value: 1 }, uFlash: { value: 0 }, uAspect: { value: 16 / 9 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform float uTime, uVig, uGrain, uAber, uFade, uFlash, uAspect; varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main(){
      vec2 c = vUv - 0.5;
      vec2 ca = c * vec2(uAspect, 1.0);
      float r2 = dot(ca, ca);
      vec2 off = c * r2 * uAber;
      vec3 col = vec3(texture2D(tDiffuse, vUv + off).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - off).b);
      float l = dot(col, vec3(0.299, 0.587, 0.114));
      col *= mix(vec3(0.94, 0.98, 1.08), vec3(1.07, 1.0, 0.93), smoothstep(0.1, 1.2, l));
      col *= 1.0 - uVig * smoothstep(0.18, 0.95, sqrt(r2) * 1.15);
      col += (hash(vUv * vec2(1920.0, 1080.0) + fract(uTime) * 91.0) - 0.5) * uGrain;
      col = col * (1.0 - uFade) + vec3(uFlash);
      gl_FragColor = vec4(max(col, 0.0), 1.0);
    }`,
});
composer.addPass(grade);
composer.addPass(new OutputPass());

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setPixelRatio(dpr);
  renderer.setSize(w, h);
  composer.setPixelRatio(dpr);
  composer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  outlineUniforms.uAspect.value = w / h;
  grade.uniforms.uAspect.value = w / h;
}
window.addEventListener('resize', resize);
resize();

/* ---------- 状态 ---------- */
const S = { t: 0, playing: false, started: false, ended: false, extra: 0, amb: 0, free: false, muted: false };
const T0 = parseFloat(params.get('t') || '0') || 0;
const AUTO = params.get('auto') === '1';
const PREVIEW_T = 6.4; // 开始界面背后展示的"静态开场"
let lastFrame = performance.now();
let uiSub = '', uiTitle = '';

/* ---------- 自由相机 / 视差 ---------- */
const mouse = { x: 0, y: 0, sx: 0, sy: 0 };
const free = { theta: 0.3, phi: 1.42, r: 4.6, tt: 0.3, tp: 1.42, tr: 4.6, pivot: new THREE.Vector3(0, 1.3, 0) };
const sph = new THREE.Spherical(), rel = new THREE.Vector3();
let dragging = false;
renderer.domElement.addEventListener('pointerdown', (e) => { dragging = true; renderer.domElement.setPointerCapture(e.pointerId); });
renderer.domElement.addEventListener('pointerup', () => { dragging = false; });
window.addEventListener('pointermove', (e) => {
  mouse.x = (e.clientX / innerWidth - 0.5) * 2;
  mouse.y = (e.clientY / innerHeight - 0.5) * 2;
  if (dragging && S.free) {
    free.tt -= e.movementX * 0.006;
    free.tp = clamp(free.tp - e.movementY * 0.006, 0.25, 2.2);
  }
});
renderer.domElement.addEventListener('wheel', (e) => {
  if (!S.free) return;
  free.tr = clamp(free.tr * Math.exp(e.deltaY * 0.0012), 0.9, 40);
  e.preventDefault();
}, { passive: false });

function setFree(on) {
  S.free = on;
  $('btnFree').classList.toggle('on', on);
  if (on) {
    rel.copy(camera.position).sub(free.pivot);
    sph.setFromVector3(rel);
    free.theta = free.tt = sph.theta;
    free.phi = free.tp = clamp(sph.phi, 0.25, 2.2);
    free.r = free.tr = clamp(sph.radius, 0.9, 40);
  }
}

/* ---------- 播放控制 ---------- */
function setPlaying(p) {
  if (S.ended && p) return replay();
  S.playing = p;
  $('btnPlay').textContent = p ? '❚❚' : '▶';
  p ? audio.resume() : audio.pause();
}
function seek(t) {
  S.t = clamp(t, 0, DURATION);
  S.ended = S.t >= DURATION;
  S.extra = 0;
  director.reset();
}
function replay() {
  seek(0);
  S.ended = false;
  audio.level = 0.7;
  audio.restartMusic();
  audio.fadeIn();
  setPlaying(true);
}
function startShow() {
  if (S.started) return;
  S.started = true;
  document.body.classList.remove('intro');
  $('start').style.opacity = '0';
  setTimeout(() => ($('start').style.display = 'none'), 950);
  if (!AUTO) audio.start();
  seek(T0);
  S.playing = params.get('pause') !== '1';
  $('btnPlay').textContent = S.playing ? '❚❚' : '▶';
}
$('btnStart').addEventListener('click', startShow);
$('btnPlay').addEventListener('click', () => setPlaying(!S.playing));
$('btnReplay').addEventListener('click', replay);
$('btnFree').addEventListener('click', () => setFree(!S.free));
$('btnMute').addEventListener('click', () => { S.muted = !S.muted; audio.setMuted(S.muted); $('btnMute').textContent = S.muted ? '🔇' : '🔊'; });
$('btnFs').addEventListener('click', () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()));
let wantShot = false;
$('btnShot').addEventListener('click', () => (wantShot = true));
$('prog').addEventListener('click', (e) => {
  const r = $('prog').getBoundingClientRect();
  const u = clamp((e.clientX - r.left - r.width * 0.04) / (r.width * 0.92), 0, 1);
  seek(u * DURATION);
});
SHOT_TIMES.forEach((st) => {
  const tick = document.createElement('u');
  tick.style.left = `${(st / DURATION) * 100}%`;
  $('progTicks').appendChild(tick);
});
window.addEventListener('keydown', (e) => {
  if (!S.started) { if (e.code === 'Space' || e.code === 'Enter') { e.preventDefault(); startShow(); } return; }
  switch (e.code) {
    case 'Space': e.preventDefault(); setPlaying(!S.playing); break;
    case 'KeyR': replay(); break;
    case 'KeyF': setFree(!S.free); break;
    case 'KeyM': $('btnMute').click(); break;
    case 'KeyP': wantShot = true; break;
    case 'ArrowRight': seek(S.t + 5); break;
    case 'ArrowLeft': seek(S.t - 5); break;
    case 'BracketRight': seek(SHOT_TIMES.find((s) => s > S.t + 0.05) ?? DURATION - 0.01); break;
    case 'BracketLeft': seek([...SHOT_TIMES].reverse().find((s) => s < S.t - 0.8) ?? 0); break;
    default:
  }
});
document.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => b.blur()));
let hudTimer;
window.addEventListener('pointermove', () => { document.body.classList.add('show-hud'); clearTimeout(hudTimer); hudTimer = setTimeout(() => document.body.classList.remove('show-hud'), 2600); });

/* ---------- 自适应分辨率 ---------- */
let acc = 0, accN = 0;
function adapt(dtMs) {
  if (dtMs > 120) return;
  acc += dtMs; accN++;
  if (accN >= 90) {
    const avg = acc / accN;
    acc = accN = 0;
    if (avg > 26 && dpr > 0.75) { dpr = Math.max(0.75, dpr - 0.25); resize(); }
  }
}

/* ---------- 每帧 ---------- */
function tick(now) {
  const dtMs = now - lastFrame;
  const dt = Math.min(0.05, dtMs / 1000);
  lastFrame = now;
  adapt(dtMs);

  const preview = !S.started && !AUTO;
  if (S.started || AUTO) {
    if (!S.started) startShow();
  }
  if (S.playing) {
    S.t += dt;
    if (S.t >= DURATION) { S.t = DURATION; S.playing = false; S.ended = true; $('btnPlay').textContent = '↺'; }
  }
  if (S.ended) S.extra += dt;
  const tt = preview ? PREVIEW_T : S.t;
  if (S.playing || S.ended || preview) S.amb += dt * (preview ? 1 : slowScale(tt));

  mouse.sx += (mouse.x - mouse.sx) * 0.05;
  mouse.sy += (mouse.y - mouse.sy) * 0.05;

  const info = director.frame(tt, dt, { audio, live: S.playing && !preview, free: S.free });
  girl.update(dt);
  boy.update(dt);

  let focus = info.focus, aperture = info.aperture, keyK = info.keyK;
  if (S.free) {
    free.theta += (free.tt - free.theta) * 0.12;
    free.phi += (free.tp - free.phi) * 0.12;
    free.r += (free.tr - free.r) * 0.12;
    camera.position.setFromSphericalCoords(free.r, free.phi, free.theta).add(free.pivot);
    camera.lookAt(free.pivot);
    camera.fov += (36 - camera.fov) * 0.1;
    focus = free.r;
    aperture = 0.35;
    keyK = 0.5;
  } else {
    // 轻微鼠标视差
    rel.copy(info.camP).sub(info.camL);
    sph.setFromVector3(rel);
    sph.theta += -mouse.sx * 0.035;
    sph.phi = clamp(sph.phi + mouse.sy * 0.02, 0.2, Math.PI - 0.2);
    rel.setFromSpherical(sph);
    camera.position.copy(info.camL).add(rel);
    camera.lookAt(info.camL);
    camera.fov = info.fov;
  }
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();

  const fxT = fxTime(tt) + S.extra;
  world.update({ amb: S.amb, fxT, pulse: info.pulse, focus, aperture, H: renderer.domElement.height });
  world.lights.key.intensity = 1.0 * keyK * focus * focus;

  bloom.strength += (info.bloom - bloom.strength) * 0.2;
  const g = grade.uniforms;
  g.uTime.value = now / 1000;
  g.uVig.value = info.vig;
  g.uFade.value = preview ? 0.0 : info.fade;
  g.uFlash.value = preview ? 0 : info.flash;

  composer.render(dt);

  if (wantShot) {
    wantShot = false;
    renderer.domElement.toBlob((b) => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(b);
      a.download = `snow-night-${S.t.toFixed(1)}s.png`;
      a.click();
    });
  }

  /* ---- DOM(只在变化时写) ---- */
  const bars = !preview && info.shot >= 0;
  document.body.classList.toggle('intro', preview);
  void bars;
  const sub = preview ? null : info.sub;
  const subKey = sub ? `${sub.who}|${sub.text}|${sub.alpha.toFixed(2)}` : '';
  if (subKey !== uiSub) {
    uiSub = subKey;
    const el = $('sub');
    if (sub) {
      el.querySelector('.who').textContent = sub.who;
      el.querySelector('.who').className = `who ${sub.tone}`;
      el.querySelector('.txt').textContent = sub.text;
      el.style.opacity = sub.alpha.toFixed(2);
    } else el.style.opacity = 0;
  }
  const ti = preview ? null : info.title;
  const titleKey = ti ? `${ti.a}|${ti.c}|${ti.alpha.toFixed(2)}` : '';
  if (titleKey !== uiTitle) {
    uiTitle = titleKey;
    const el = $('title');
    if (ti) {
      el.querySelector('.a').textContent = ti.a;
      el.querySelector('.b').textContent = ti.b;
      el.querySelector('.c').textContent = ti.c;
      el.style.opacity = ti.alpha.toFixed(2);
    } else el.style.opacity = 0;
  }
  document.body.classList.toggle('ended', S.ended);
  $('progFill').style.width = `${(S.t / DURATION) * 100}%`;
  if (!window.__ready) { window.__ready = true; $('loading').style.display = 'none'; }
}

let wasPlaying = false;
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { wasPlaying = S.playing; if (wasPlaying) setPlaying(false); }
  else if (wasPlaying) { wasPlaying = false; setPlaying(true); }
});

window.__app = { S, seek, setFree, replay, camera, girl, boy, world, director, THREE };
renderer.setAnimationLoop(tick);
