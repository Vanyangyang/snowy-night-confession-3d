// 原创角色:澪(女)与朔(男)。全部由基础几何体 + 卡通渲染 + 反壳描边拼成。
import * as THREE from 'three';

const D = Math.PI / 180;
const TAU = Math.PI * 2;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

/* ================= 卡通材质 & 描边 ================= */
export const outlineUniforms = { uThick: { value: 0.0036 }, uAspect: { value: 16 / 9 } };

const outlineMat = new THREE.ShaderMaterial({
  uniforms: outlineUniforms,
  vertexShader: /* glsl */ `
    uniform float uThick; uniform float uAspect;
    void main() {
      vec4 clip = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      vec3 vn = normalize(normalMatrix * normal);
      vec2 dir = vn.xy;
      float l = length(dir);
      dir = l > 1e-4 ? dir / l : vec2(0.0);
      clip.xy += dir * vec2(1.0 / uAspect, 1.0) * uThick * clip.w;
      gl_Position = clip;
    }`,
  fragmentShader: /* glsl */ `void main(){ gl_FragColor = vec4(0.05, 0.035, 0.09, 1.0); }`,
  side: THREE.BackSide,
});

const gradientMap = (() => {
  const data = new Uint8Array([84, 146, 206, 255]);
  const tex = new THREE.DataTexture(data, 4, 1, THREE.RedFormat);
  tex.minFilter = tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
})();

const toon = (color, extra = {}) => new THREE.MeshToonMaterial({ color, gradientMap, ...extra });

function add(parent, geo, mat, o = {}) {
  const m = new THREE.Mesh(geo, mat);
  if (o.pos) m.position.set(o.pos[0], o.pos[1], o.pos[2]);
  if (o.rot) m.rotation.set(o.rot[0], o.rot[1], o.rot[2]);
  if (o.scale) Array.isArray(o.scale) ? m.scale.set(o.scale[0], o.scale[1], o.scale[2]) : m.scale.setScalar(o.scale);
  m.castShadow = o.cast !== false;
  if (o.outline !== false) {
    const ol = new THREE.Mesh(geo, outlineMat);
    ol.castShadow = false;
    ol.receiveShadow = false;
    m.add(ol);
  }
  parent.add(m);
  return m;
}

/* ================= 头型 / 发型工具 ================= */
// 下巴收窄(脸贴花球面用同一个函数,保证贴合)
function taper(geo, R) {
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    if (y < 0) {
      const k = Math.min(1, -y / R);
      const s = k * k * (3 - 2 * k);
      p.setX(i, p.getX(i) * (1 - 0.30 * s));
      p.setZ(i, p.getZ(i) * (1 - 0.16 * s));
      p.setY(i, y * (1 + 0.05 * s));
    }
  }
  p.needsUpdate = true;
}

// 发壳:球壳挖掉脸部"U 形"窗口,得到自然发际线
function hairShell(R, thetaMax, halfWin, hl0, hl1) {
  const g = new THREE.SphereGeometry(R, 96, 64, 0, TAU, 0, thetaMax);
  const pos = g.attributes.position;
  const idx = g.index.array;
  const keep = [];
  for (let i = 0; i < idx.length; i += 3) {
    let cx = 0, cy = 0, cz = 0;
    for (let k = 0; k < 3; k++) {
      const v = idx[i + k];
      cx += pos.getX(v); cy += pos.getY(v); cz += pos.getZ(v);
    }
    cx /= 3; cy /= 3; cz /= 3;
    const len = Math.hypot(cx, cy, cz) || 1;
    const th = Math.acos(clamp(cy / len, -1, 1));
    let dph = Math.atan2(cz, -cx) - Math.PI / 2;
    dph = Math.atan2(Math.sin(dph), Math.cos(dph));
    const u = Math.abs(dph) / halfWin;
    const hl = hl0 + (hl1 - hl0) * u * u;
    if (!(u < 1 && th > hl)) keep.push(idx[i], idx[i + 1], idx[i + 2]);
  }
  g.setIndex(keep);
  return g;
}

// 贴着头皮、沿经线向下的发束(锥形压扁)
function lock(parent, mat, o) {
  const { R, th0, ph, len, wid } = o;
  const flat = o.flat ?? 0.42;
  const sp = (th, f) => new THREE.Vector3(R * Math.sin(th) * Math.sin(f), R * Math.cos(th), R * Math.sin(th) * Math.cos(f));
  const p0 = sp(th0, ph);
  const n = p0.clone().normalize();
  const t = new THREE.Vector3(Math.cos(th0) * Math.sin(ph), -Math.sin(th0), Math.cos(th0) * Math.cos(ph)).normalize();
  const delta = (len * 0.5) / R + (o.bend ?? 0);
  const axis = t.clone().multiplyScalar(Math.cos(delta)).addScaledVector(n, -Math.sin(delta)).normalize();
  if (o.sweep) axis.add(new THREE.Vector3(Math.cos(ph), 0, -Math.sin(ph)).multiplyScalar(o.sweep)).normalize();
  const center = p0.clone().addScaledVector(axis, len / 2).addScaledVector(n, o.lift ?? 0.012);
  const z = n.clone().sub(axis.clone().multiplyScalar(n.dot(axis))).normalize();
  const x = new THREE.Vector3().crossVectors(axis, z).normalize();
  const m = add(parent, new THREE.ConeGeometry(wid, len, 10, 1), mat);
  m.position.copy(center);
  m.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, axis, z));
  m.scale.set(1, 1, flat);
  return m;
}

/* ================= 脸部贴图(Canvas 实时绘制) ================= */
const FW = 768, FH = 528, PX = 6.1;
const FX = (deg) => FW / 2 + deg * PX; // 以正前方为 0 的水平角度 → 像素
const FY = (th) => (th - 54) * PX; // 极角(度) → 像素

function star(ctx, x, y, r) {
  ctx.beginPath();
  ctx.moveTo(x, y - r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.quadraticCurveTo(x, y, x, y + r);
  ctx.quadraticCurveTo(x, y, x - r, y);
  ctx.quadraticCurveTo(x, y, x, y - r);
  ctx.fill();
}

function flick(ctx, x, y, side, st) {
  ctx.strokeStyle = st.lid;
  ctx.lineWidth = st.lidW * 0.85;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.quadraticCurveTo(x + side * 14, y - 3, x + side * 26, y - 17);
  ctx.stroke();
}

function eye(ctx, cx, cy, side, s, st) {
  const ew = st.ew, eh = st.eh;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (s.shape === 'happy') {
    ctx.strokeStyle = st.lid;
    ctx.lineWidth = st.lidW + 2;
    ctx.beginPath();
    ctx.arc(cx, cy + eh * 0.42, ew * 0.74, Math.PI * 1.1, Math.PI * 1.9);
    ctx.stroke();
    if (st.lash) flick(ctx, cx + side * ew * 0.66, cy + eh * 0.02, side, st);
    if (s.tear > 0.05) tearDrop(ctx, cx + side * ew * 0.5, cy + eh * 0.5, s.tear);
    return;
  }
  const open = s.open;
  if (open < 0.2) {
    ctx.strokeStyle = st.lid;
    ctx.lineWidth = st.lidW + 1;
    ctx.beginPath();
    ctx.moveTo(cx - ew * 0.82, cy - eh * 0.1);
    ctx.quadraticCurveTo(cx, cy + eh * 0.42, cx + ew * 0.82, cy - eh * 0.1);
    ctx.stroke();
    if (st.lash) flick(ctx, cx + side * ew * 0.8, cy - eh * 0.08, side, st);
    return;
  }
  const h = eh * Math.min(open, 1.12);
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(cx, cy, ew, h, 0, 0, TAU);
  ctx.clip();
  ctx.fillStyle = '#fdfbff';
  ctx.fillRect(cx - ew - 2, cy - h - 2, ew * 2 + 4, h * 2 + 4);
  const ix = cx + s.gx * ew * 0.3, iy = cy + s.gy * h * 0.22 + h * 0.03;
  const irx = ew * 0.7, iry = h * 1.02;
  let g = ctx.createLinearGradient(0, iy - iry, 0, iy + iry);
  g.addColorStop(0, st.iris[0]);
  g.addColorStop(0.5, st.iris[1]);
  g.addColorStop(1, st.iris[2]);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(ix, iy, irx, iry, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = st.pupil;
  ctx.beginPath();
  ctx.ellipse(ix, iy - iry * 0.02, irx * 0.46 * s.pupil, iry * 0.56 * s.pupil, 0, 0, TAU);
  ctx.fill();
  g = ctx.createRadialGradient(ix, iy + iry * 0.58, 1, ix, iy + iry * 0.58, irx * 0.85);
  g.addColorStop(0, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(ix - irx, iy, irx * 2, iry);
  const sg = ctx.createLinearGradient(0, cy - h, 0, cy - h * 0.15);
  sg.addColorStop(0, 'rgba(20,10,40,0.55)');
  sg.addColorStop(1, 'rgba(20,10,40,0)');
  ctx.fillStyle = sg;
  ctx.fillRect(cx - ew, cy - h, ew * 2, h * 0.95);
  if (s.tear > 0.02) {
    const wg = ctx.createLinearGradient(0, cy + h * 0.2, 0, cy + h);
    wg.addColorStop(0, 'rgba(190,230,255,0)');
    wg.addColorStop(1, `rgba(200,235,255,${0.75 * s.tear})`);
    ctx.fillStyle = wg;
    ctx.fillRect(cx - ew, cy + h * 0.2, ew * 2, h * 0.9);
  }
  ctx.fillStyle = '#ffffff';
  const sp = s.sparkle;
  ctx.beginPath();
  ctx.ellipse(ix - irx * 0.34, iy - iry * 0.36, irx * (0.27 + 0.05 * sp), iry * (0.25 + 0.05 * sp), 0, 0, TAU);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(ix + irx * 0.38, iy + iry * 0.42, irx * 0.12, iry * 0.12, 0, 0, TAU);
  ctx.fill();
  if (sp > 0.05) {
    star(ctx, ix + irx * 0.12, iy - iry * 0.02, irx * 0.2 * sp);
    star(ctx, ix - irx * 0.5, iy + iry * 0.38, irx * 0.13 * sp);
  }
  ctx.restore();
  ctx.strokeStyle = st.lid;
  ctx.lineWidth = st.lidW;
  ctx.beginPath();
  ctx.ellipse(cx, cy, ew, h, 0, Math.PI * 1.03, Math.PI * 1.97);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(80,45,90,0.4)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.ellipse(cx, cy, ew * 0.96, h * 0.98, 0, Math.PI * 0.14, Math.PI * 0.86);
  ctx.stroke();
  if (st.lash) flick(ctx, cx + side * ew * 0.93, cy - h * 0.28, side, st);
  if (s.tear > 0.05) tearDrop(ctx, cx + side * ew * 0.55, cy + h * 0.9, s.tear);
}

function tearDrop(ctx, x, y, a) {
  const len = 70 * a;
  const g = ctx.createLinearGradient(0, y, 0, y + len);
  g.addColorStop(0, `rgba(215,240,255,${0.7 * a})`);
  g.addColorStop(1, 'rgba(215,240,255,0)');
  ctx.strokeStyle = g;
  ctx.lineWidth = 11;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + 2, y + len);
  ctx.stroke();
}

function brow(ctx, cx, by, side, s, st) {
  const L = st.browLen;
  const lift = s.browY;
  const ox = cx + side * L * 0.5, ix = cx - side * L * 0.5;
  const oy = by + lift + s.brow * 4 * 0 + (s.brow < 0 ? s.brow * 4 : 0);
  const iy = by + lift - s.brow * 20;
  ctx.strokeStyle = st.browInk;
  ctx.lineWidth = st.browW;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(ox, oy);
  ctx.quadraticCurveTo((ox + ix) / 2, Math.min(oy, iy) - 9, ix, iy);
  ctx.stroke();
}

function mouth(ctx, s, st) {
  const cx = FX(0), cy = FY(st.mouthTh);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = st.mouthInk;
  ctx.lineWidth = 6;
  switch (s.mouth) {
    case 'smile':
      ctx.beginPath();
      ctx.moveTo(cx - 30, cy - 4);
      ctx.quadraticCurveTo(cx, cy + 24, cx + 30, cy - 4);
      ctx.stroke();
      break;
    case 'smallSmile':
      ctx.beginPath();
      ctx.moveTo(cx - 22, cy - 2);
      ctx.quadraticCurveTo(cx, cy + 14, cx + 22, cy - 2);
      ctx.stroke();
      break;
    case 'open': {
      ctx.fillStyle = '#7a2438';
      ctx.beginPath();
      ctx.moveTo(cx - 40, cy - 8);
      ctx.quadraticCurveTo(cx, cy + 4, cx + 40, cy - 8);
      ctx.quadraticCurveTo(cx + 34, cy + 52, cx, cy + 54);
      ctx.quadraticCurveTo(cx - 34, cy + 52, cx - 40, cy - 8);
      ctx.fill();
      ctx.save();
      ctx.clip();
      ctx.fillStyle = '#ff8fa3';
      ctx.beginPath();
      ctx.ellipse(cx, cy + 52, 26, 20, 0, 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.fillRect(cx - 40, cy - 10, 80, 11);
      ctx.restore();
      ctx.beginPath();
      ctx.moveTo(cx - 40, cy - 8);
      ctx.quadraticCurveTo(cx, cy + 4, cx + 40, cy - 8);
      ctx.quadraticCurveTo(cx + 34, cy + 52, cx, cy + 54);
      ctx.quadraticCurveTo(cx - 34, cy + 52, cx - 40, cy - 8);
      ctx.stroke();
      break;
    }
    case 'o':
      ctx.fillStyle = '#7a2438';
      ctx.beginPath();
      ctx.ellipse(cx, cy + 6, 14, 19, 0, 0, TAU);
      ctx.fill();
      ctx.lineWidth = 5;
      ctx.stroke();
      break;
    case 'wavy':
      ctx.beginPath();
      ctx.moveTo(cx - 32, cy);
      ctx.quadraticCurveTo(cx - 21, cy - 11, cx - 10, cy);
      ctx.quadraticCurveTo(cx, cy + 11, cx + 11, cy);
      ctx.quadraticCurveTo(cx + 22, cy - 11, cx + 32, cy);
      ctx.stroke();
      break;
    case 'press': // 抿嘴
      ctx.beginPath();
      ctx.moveTo(cx - 26, cy + 2);
      ctx.quadraticCurveTo(cx, cy - 4, cx + 26, cy + 2);
      ctx.stroke();
      break;
    default: // line
      ctx.beginPath();
      ctx.moveTo(cx - 22, cy);
      ctx.quadraticCurveTo(cx, cy + 7, cx + 22, cy);
      ctx.stroke();
  }
}

function drawFace(ctx, s, st) {
  ctx.clearRect(0, 0, FW, FH);
  const bl = s.blush;
  if (bl > 0.02) {
    for (const side of [-1, 1]) {
      const cx = FX(side * 27), cy = FY(114);
      const g = ctx.createRadialGradient(cx, cy, 2, cx, cy, 62);
      g.addColorStop(0, `rgba(255,105,135,${0.68 * bl})`);
      g.addColorStop(0.6, `rgba(255,120,150,${0.3 * bl})`);
      g.addColorStop(1, 'rgba(255,120,150,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(cx, cy, 66, 38, 0, 0, TAU);
      ctx.fill();
      if (bl > 0.7) {
        ctx.strokeStyle = `rgba(255,70,110,${0.6 * (bl - 0.6)})`;
        ctx.lineWidth = 4;
        ctx.lineCap = 'round';
        for (let i = -1; i <= 1; i++) {
          ctx.beginPath();
          ctx.moveTo(cx + i * 22 - 6, cy + 11);
          ctx.lineTo(cx + i * 22 + 6, cy - 11);
          ctx.stroke();
        }
      }
    }
  }
  for (const side of [-1, 1]) {
    brow(ctx, FX(side * st.eyeDX), FY(st.browTh), side, s, st);
    eye(ctx, FX(side * st.eyeDX), FY(st.eyeTh), side, s, st);
  }
  ctx.strokeStyle = 'rgba(190,110,110,0.4)';
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(FX(-3), FY(109));
  ctx.quadraticCurveTo(FX(0), FY(111), FX(3), FY(109));
  ctx.stroke();
  mouth(ctx, s, st);
}

/* 表情数值:连续量平滑插值,离散量(shape/mouth)直接切换 */
const E = (o) => ({ open: 0.95, shape: 'open', gx: 0, gy: 0, brow: 0, browY: 0, mouth: 'line', blush: 0.35, tear: 0, sparkle: 0, pupil: 1, ...o });
export const EXPR = {
  girl: {
    nervous: E({ open: 0.9, gx: -0.2, gy: 0.4, brow: 0.55, browY: -4, mouth: 'wavy', blush: 0.6 }),
    soft: E({ open: 0.92, gx: 0.15, gy: 0.05, brow: 0.2, mouth: 'smallSmile', blush: 0.55, sparkle: 0.3 }),
    down: E({ open: 0.78, gx: -0.1, gy: 0.9, brow: 0.7, browY: -2, mouth: 'wavy', blush: 0.75 }),
    resolve: E({ open: 1.05, gx: 0.05, gy: -0.05, brow: -0.35, browY: -6, mouth: 'press', blush: 0.8, sparkle: 0.6, pupil: 0.95 }),
    confess: E({ open: 1.08, gx: 0.1, gy: -0.1, brow: 0.2, browY: -8, mouth: 'o', blush: 1.0, sparkle: 1.0, tear: 0.25, pupil: 0.9 }),
    wait: E({ open: 0.0, shape: 'open', gx: 0, gy: 0, brow: 0.8, browY: -4, mouth: 'press', blush: 1.0, tear: 0.3 }),
    teary: E({ open: 1.0, gx: 0.1, gy: 0.0, brow: 0.5, browY: -6, mouth: 'smile', blush: 1.0, sparkle: 1.0, tear: 1.0, pupil: 1.05 }),
    happy: E({ shape: 'happy', brow: 0.1, browY: -10, mouth: 'open', blush: 1.0, tear: 0.7, sparkle: 0 }),
  },
  boy: {
    calm: E({ open: 0.9, gx: 0, gy: 0, brow: 0, mouth: 'line', blush: 0 }),
    surprised: E({ open: 1.1, gx: 0, gy: 0, brow: 0.35, browY: -14, mouth: 'o', blush: 0.35, pupil: 0.72 }),
    blush: E({ open: 1.0, gx: -0.5, gy: 0.5, brow: 0.45, browY: -6, mouth: 'wavy', blush: 1.0, pupil: 0.82 }),
    gentle: E({ open: 0.82, gx: 0.1, gy: 0.1, brow: 0.2, browY: -2, mouth: 'smile', blush: 0.85, sparkle: 0.6 }),
    happy: E({ shape: 'happy', brow: 0.1, browY: -8, mouth: 'smile', blush: 0.9 }),
  },
};

function makeFace(st) {
  const cv = document.createElement('canvas');
  cv.width = FW; cv.height = FH;
  const ctx = cv.getContext('2d');
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const num = ['open', 'gx', 'gy', 'brow', 'browY', 'blush', 'tear', 'sparkle', 'pupil'];
  let cur = { ...E({}) };
  let tgt = cur;
  let blinkT = 2 + Math.random() * 2, blinkP = -1, since = 1, dirty = true, lastKey = '';
  return {
    tex,
    set(name, snap) {
      tgt = EXPR[st.kind][name] || tgt;
      if (snap) { cur = { ...tgt }; dirty = true; }
    },
    update(dt) {
      let ch = 0;
      const k = 1 - Math.exp(-dt * 9);
      for (const key of num) {
        const d = tgt[key] - cur[key];
        cur[key] += d * k;
        ch += Math.abs(d);
      }
      cur.shape = tgt.shape; cur.mouth = tgt.mouth;
      blinkT -= dt;
      let blink = 0;
      if (blinkT <= 0 && blinkP < 0) blinkP = 0;
      if (blinkP >= 0) {
        blinkP += dt / 0.16;
        blink = Math.sin(Math.min(1, blinkP) * Math.PI);
        if (blinkP >= 1) { blinkP = -1; blinkT = 2.2 + Math.random() * 3.2; }
      }
      since += dt;
      const draw = { ...cur, open: cur.open * (1 - blink) };
      const key = draw.shape + draw.mouth + blink.toFixed(2);
      if ((ch > 0.004 || key !== lastKey || dirty) && since > 1 / 30) {
        drawFace(ctx, draw, st);
        tex.needsUpdate = true;
        since = 0; dirty = false; lastKey = key;
      }
    },
  };
}

/* ================= 角色规格 ================= */
const SPEC = {
  girl: {
    scale: 0.93, hipY: 0.74, shX: 0.2, shY: 0.46, coatSX: 1.05, coatSZ: 0.8,
    legR: 0.055, legGap: 0.085, armR: 0.046, L1: 0.29, L2: 0.27, neckY: 0.585, R: 0.185,
    coat: [[0.29, -0.32], [0.255, -0.15], [0.185, 0.17], [0.205, 0.33], [0.16, 0.5], [0.09, 0.585]],
    c: { skin: 0xffe0d1, coat: 0xf3e1b9, trim: 0xcaa35a, scarf: 0x2e8f9c, legs: 0x4a3260, boots: 0x6a4638, hair: 0xb9a8f0, hairHi: 0xe0d6ff, accent: 0x74f2d0 },
    face: { kind: 'girl', ew: 62, eh: 56, lidW: 9, lash: true, iris: ['#232f6b', '#4a74da', '#a2e8ff'], pupil: '#12183a', lid: '#271a3d', browInk: '#7a63b8', browW: 8, browLen: 72, mouthInk: '#9a4258', eyeDX: 21, eyeTh: 99, browTh: 83, mouthTh: 121 },
  },
  boy: {
    scale: 0.97, hipY: 0.86, shX: 0.235, shY: 0.47, coatSX: 1.12, coatSZ: 0.82,
    legR: 0.066, legGap: 0.095, armR: 0.052, L1: 0.31, L2: 0.29, neckY: 0.6, R: 0.185,
    coat: [[0.31, -0.4], [0.275, -0.2], [0.2, 0.18], [0.225, 0.34], [0.18, 0.5], [0.1, 0.6]],
    c: { skin: 0xf6d2b8, coat: 0x2e3b55, trim: 0x1f2840, scarf: 0xb03a4c, legs: 0x23283a, boots: 0x3d2d29, hair: 0x6e4932, hairHi: 0x9a6d4d, accent: 0xe9e1d0 },
    face: { kind: 'boy', ew: 52, eh: 47, lidW: 8, lash: false, iris: ['#4a2a12', '#b9741f', '#ffd98a'], pupil: '#1d1008', lid: '#2a1b14', browInk: '#3b2a22', browW: 11, browLen: 70, mouthInk: '#8a4a48', eyeDX: 20, eyeTh: 100, browTh: 85, mouthTh: 122 },
  },
};

/* ================= 角色构造 ================= */
export function buildCharacter(kind) {
  const S = SPEC[kind];
  const girl = kind === 'girl';
  const C = S.c;
  const R = S.R;
  const phase = girl ? 0.7 : 2.1;

  const root = new THREE.Group();
  root.name = kind;
  const hips = new THREE.Group();
  hips.position.y = S.hipY;
  root.add(hips);
  const torso = new THREE.Group();
  hips.add(torso);

  const skinMat = toon(C.skin);
  const coatMat = toon(C.coat, { side: THREE.DoubleSide });
  const trimMat = toon(C.trim);
  const scarfMat = toon(C.scarf);
  const legMat = toon(C.legs);
  const bootMat = toon(C.boots);

  // --- 腿与靴 ---
  for (const s of [-1, 1]) {
    const total = S.hipY - 0.05;
    add(hips, new THREE.CapsuleGeometry(S.legR, total - 2 * S.legR, 6, 12), legMat, { pos: [s * S.legGap, -total / 2, 0] });
    add(hips, new THREE.CylinderGeometry(S.legR * 1.2, S.legR * 1.3, 0.2, 16), bootMat, { pos: [s * S.legGap, -S.hipY + 0.14, 0] });
    add(hips, new THREE.SphereGeometry(1, 16, 12), bootMat, { pos: [s * S.legGap, -S.hipY + 0.05, 0.035], scale: [S.legR * 1.35, 0.055, 0.115] });
  }

  // --- 外套(车削面,光滑曲线) ---
  const spline = new THREE.SplineCurve(S.coat.map(([r, y]) => new THREE.Vector2(r, y)));
  const prof = spline.getPoints(28);
  prof.push(new THREE.Vector2(0.001, S.coat[S.coat.length - 1][1]));
  const coat = add(torso, new THREE.LatheGeometry(prof, 40), coatMat, { scale: [S.coatSX, 1, S.coatSZ] });
  // 腰带
  add(torso, new THREE.TorusGeometry(girl ? 0.188 : 0.205, 0.013, 8, 40), trimMat, { pos: [0, 0.17, 0], rot: [Math.PI / 2, 0, 0], scale: [S.coatSX, S.coatSZ, 1], outline: false });
  // 纽扣
  for (const [bx, by] of girl ? [[-0.045, 0.3], [0.045, 0.3], [-0.045, 0.4], [0.045, 0.4]] : [[0, 0.26], [0, 0.36], [0, 0.46]]) {
    const r = prof.reduce((a, p) => (Math.abs(p.y - by) < Math.abs(a.y - by) ? p : a)).x;
    add(torso, new THREE.SphereGeometry(0.017, 10, 8), trimMat, { pos: [bx, by, r * S.coatSZ + 0.003], outline: false });
  }

  // --- 围巾 ---
  add(torso, new THREE.TorusGeometry(girl ? 0.102 : 0.114, 0.041, 12, 32), scarfMat, { pos: [0, S.neckY - 0.02, 0], rot: [Math.PI / 2, 0, 0], scale: [1.04, 0.92, 1] });
  add(torso, new THREE.CapsuleGeometry(0.043, 0.26, 4, 10), scarfMat, { pos: [girl ? 0.075 : 0.08, S.neckY - 0.2, (girl ? 0.082 : 0.095)], rot: [0.12, 0, girl ? 0.06 : 0.04], scale: [1, 1, 0.45] });
  const scarfTail = new THREE.Group();
  scarfTail.position.set(girl ? -0.08 : -0.09, S.neckY - 0.03, -0.1);
  torso.add(scarfTail);
  add(scarfTail, new THREE.CapsuleGeometry(0.05, girl ? 0.42 : 0.4, 4, 10), scarfMat, { pos: [0, -0.26, 0], scale: [1, 1, 0.42] });
  add(scarfTail, new THREE.BoxGeometry(0.1, 0.02, 0.025), trimMat, { pos: [0, -0.5, 0], outline: false });

  // --- 手臂 ---
  const arms = [];
  for (const s of [1, -1]) {
    const sh = new THREE.Group();
    sh.position.set(s * S.shX, S.shY, 0);
    sh.rotation.order = 'XYZ';
    torso.add(sh);
    add(sh, new THREE.SphereGeometry(S.armR * 1.25, 16, 12), coatMat);
    add(sh, new THREE.CapsuleGeometry(S.armR, S.L1 - 2 * S.armR, 6, 12), coatMat, { pos: [0, -S.L1 / 2 + 0.02, 0] });
    const el = new THREE.Group();
    el.position.y = -S.L1 + 0.025;
    el.rotation.order = 'XYZ';
    sh.add(el);
    add(el, new THREE.SphereGeometry(S.armR * 1.02, 12, 10), coatMat);
    add(el, new THREE.CapsuleGeometry(S.armR * 0.9, S.L2 - 1.8 * S.armR, 6, 12), coatMat, { pos: [0, -S.L2 / 2 + 0.02, 0] });
    add(el, new THREE.CylinderGeometry(S.armR * 0.97, S.armR * 0.97, 0.035, 16), trimMat, { pos: [0, -S.L2 + 0.045, 0] });
    add(el, new THREE.SphereGeometry(0.048, 14, 12), skinMat, { pos: [0, -S.L2 - 0.018, 0], scale: [1, 1.12, 0.86] });
    arms.push({ sh, el, s });
  }
  const [armL, armR] = arms; // armL: 角色左手(+x)

  // --- 头 ---
  const head = new THREE.Group();
  head.position.y = S.neckY;
  torso.add(head);
  add(head, new THREE.CylinderGeometry(0.05, 0.055, 0.12, 12), skinMat, { pos: [0, 0.03, 0] });
  const ball = new THREE.Group();
  ball.position.y = 0.192; // 头抬高一点,下巴不被围巾吞掉
  head.add(ball);

  const headGeo = new THREE.SphereGeometry(R, 48, 36);
  taper(headGeo, R);
  add(ball, headGeo, skinMat);

  // 脸部贴花(球面局部,和头同形变)
  const face = makeFace(S.face);
  const patch = new THREE.SphereGeometry(R * 1.004, 56, 40, Math.PI / 2 - 63 * D, 126 * D, 54 * D, 86 * D);
  taper(patch, R * 1.004);
  const faceMat = new THREE.MeshToonMaterial({
    map: face.tex, gradientMap, transparent: true, depthWrite: false,
    emissive: 0xffffff, emissiveMap: face.tex, emissiveIntensity: 0.38,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  const faceMesh = new THREE.Mesh(patch, faceMat);
  faceMesh.renderOrder = 2;
  ball.add(faceMesh);

  const hairMat = toon(C.hair);
  const hairHiMat = toon(C.hairHi);
  let ahoge = null;

  if (girl) {
    // 及下巴的内扣短发 + 刘海 + 侧发
    const shell = hairShell(R * 1.1, 128 * D, 60 * D, 56 * D, 90 * D);
    add(ball, shell, new THREE.MeshToonMaterial({ color: C.hair, gradientMap, side: THREE.DoubleSide }), { pos: [0, 0.008, -0.006] });
    const Rh = R * 1.1;
    // 刘海:中间长、两侧短,略向外扫;起点贴着发际线(角度单位统一为弧度)
    const bangs = [
      [-48, 0.1, 0.034], [-36, 0.118, 0.037], [-24, 0.132, 0.04], [-12, 0.142, 0.04], [0, 0.136, 0.04],
      [12, 0.142, 0.04], [24, 0.132, 0.04], [36, 0.118, 0.037], [48, 0.1, 0.034],
    ];
    for (const [deg, len, wid] of bangs) {
      lock(ball, hairMat, { R: Rh * 1.005, th0: (55 + Math.abs(deg) * 0.1) * D, ph: deg * D, len, wid, flat: 0.38, sweep: deg * 0.0016 });
    }
    // 侧发:从发壳边缘垂直下垂,贴着脸颊外侧(不再横在嘴前)
    for (const s of [-1, 1]) {
      const th = 80 * D, ph = s * 63 * D;
      const bx = Rh * Math.sin(th) * Math.sin(ph), by = Rh * Math.cos(th), bz = Rh * Math.sin(th) * Math.cos(ph);
      const L = 0.2;
      const m = add(ball, new THREE.ConeGeometry(0.042, L, 10, 1), hairMat, { rot: [Math.PI, 0, 0] });
      m.position.set(bx * 1.0, by - L / 2 + 0.01, bz * 0.98);
      m.rotation.set(Math.PI, 0, 0);
      m.scale.set(1, 1, 0.5);
      m.rotateZ(-s * 0.06);
    }
    // 呆毛:细而短的小卷
    ahoge = new THREE.Group();
    ahoge.position.set(0.02, R * 1.1, 0.035);
    ball.add(ahoge);
    add(ahoge, new THREE.ConeGeometry(0.011, 0.07, 8, 1), hairMat, { pos: [0.0, 0.035, 0], rot: [0, 0, -0.5] });
    add(ahoge, new THREE.ConeGeometry(0.008, 0.045, 8, 1), hairMat, { pos: [-0.04, 0.07, 0], rot: [0, 0, -1.3] });
    // 雪花发饰(发光)
    const pin = new THREE.Group();
    const pinPos = new THREE.Vector3(R * 1.1 * Math.sin(66 * D) * Math.sin(-48 * D), R * 1.1 * Math.cos(66 * D), R * 1.1 * Math.sin(66 * D) * Math.cos(-48 * D));
    pin.position.copy(pinPos);
    pin.lookAt(pinPos.clone().multiplyScalar(2));
    ball.add(pin);
    const pinMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(C.accent).multiplyScalar(2.4) });
    for (let i = 0; i < 3; i++) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.011, 0.011), pinMat);
      b.rotation.z = (i * Math.PI) / 3;
      b.position.z = 0.012;
      pin.add(b);
    }
  } else {
    // 短发 + 针织帽
    const shell = hairShell(R * 1.07, 94 * D, 62 * D, 58 * D, 86 * D);
    add(ball, shell, new THREE.MeshToonMaterial({ color: C.hair, gradientMap, side: THREE.DoubleSide }), { pos: [0, 0.004, -0.006] });
    const Rh = R * 1.07;
    const bangs = [[-40, 0.062, 0.034, -0.5], [-24, 0.078, 0.036, -0.3], [-8, 0.085, 0.036, 0.1], [9, 0.082, 0.036, 0.4], [26, 0.076, 0.036, 0.5], [42, 0.062, 0.034, 0.4]];
    for (const [deg, len, wid, sw] of bangs) {
      lock(ball, hairMat, { R: Rh * 1.005, th0: 64 * D, ph: deg * D, len, wid, sweep: sw * 0.25 });
    }
    for (const s of [-1, 1]) {
      lock(ball, hairMat, { R: Rh * 1.005, th0: 80 * D, ph: s * 66 * D, len: 0.09, wid: 0.034, flat: 0.5 });
      // 耳朵
      add(ball, new THREE.SphereGeometry(0.032, 12, 10), skinMat, { pos: [s * R * 0.985, -0.025, 0.0], scale: [0.45, 1, 0.8] });
    }
    // 帽子
    const beanie = new THREE.Group();
    beanie.rotation.x = -0.2;
    ball.add(beanie);
    const Rb = R * 1.14;
    const capMat = new THREE.MeshToonMaterial({ color: C.accent, gradientMap, side: THREE.DoubleSide });
    add(beanie, new THREE.SphereGeometry(Rb, 44, 26, 0, TAU, 0, 78 * D), capMat, { pos: [0, 0.0, -0.004] });
    add(beanie, new THREE.SphereGeometry(Rb * 1.006, 44, 6, 0, TAU, 56 * D, 8 * D), toon(C.scarf, { side: THREE.DoubleSide }), { pos: [0, 0.0, -0.004], outline: false });
    add(beanie, new THREE.TorusGeometry(Rb * Math.sin(78 * D) * 1.005, 0.03, 10, 44), capMat, { pos: [0, Rb * Math.cos(78 * D), -0.004], rot: [Math.PI / 2, 0, 0] });
    add(beanie, new THREE.IcosahedronGeometry(0.052, 1), toon(0xffffff), { pos: [0, Rb + 0.02, -0.004] });
  }

  /* ---------- 双骨骼 IK:手部目标点(躯干局部坐标) → 肩/肘旋转 ---------- */
  const L1 = S.L1 - 0.025; // 肩→肘
  const L2 = S.L2 + 0.018; // 肘→手心
  const _t = new THREE.Vector3(), _w = new THREE.Vector3(), _pole = new THREE.Vector3();
  const _dir = new THREE.Vector3(), _pp = new THREE.Vector3(), _u = new THREE.Vector3();
  const _xb = new THREE.Vector3(), _yb = new THREE.Vector3(), _zb = new THREE.Vector3(), _m4 = new THREE.Matrix4();
  function solveArm(arm, target, pole) {
    _dir.copy(target).sub(arm.sh.position);
    const dist = clamp(_dir.length(), Math.abs(L1 - L2) + 0.03, L1 + L2 - 0.004);
    _dir.normalize();
    _pp.copy(pole).addScaledVector(_dir, -pole.dot(_dir));
    if (_pp.lengthSq() < 1e-6) _pp.set(0, -1, 0);
    _pp.normalize();
    const a = Math.acos(clamp((L1 * L1 + dist * dist - L2 * L2) / (2 * L1 * dist), -1, 1));
    _u.copy(_dir).multiplyScalar(Math.cos(a)).addScaledVector(_pp, Math.sin(a)); // 上臂方向
    const bend = Math.PI - Math.acos(clamp((L1 * L1 + L2 * L2 - dist * dist) / (2 * L1 * L2), -1, 1));
    _yb.copy(_u).negate();
    _zb.copy(_pp).addScaledVector(_u, -_pp.dot(_u)).normalize().negate();
    _xb.crossVectors(_yb, _zb).normalize();
    arm.sh.quaternion.setFromRotationMatrix(_m4.makeBasis(_xb, _yb, _zb));
    arm.el.rotation.set(-bend, 0, 0);
  }

  /* ---------- 姿态驱动 ---------- */
  function applyPose(p, t, holdW) {
    root.position.set(p.x, 0, p.z);
    root.rotation.y = p.yaw;
    hips.position.y = S.hipY - p.crouch;
    const br = Math.sin(t * 1.9 + phase) * 0.007;
    torso.rotation.set(p.lean + br * 1.4, p.twist, p.sway);
    torso.scale.set(1 + br * 0.5, 1 + br, 1 + br * 0.6);
    head.rotation.set(
      p.hp + Math.sin(t * 0.8 + phase) * 0.012,
      p.hy + Math.sin(t * 0.55 + phase * 2) * 0.02,
      p.hr + Math.sin(t * 0.43 + phase) * 0.012,
    );
    root.updateMatrixWorld(true);
    for (const [arm, px, py, pz, isHold] of [
      [armL, p.lx, p.ly, p.lz, girl],
      [armR, p.rx, p.ry, p.rz, !girl],
    ]) {
      _t.set(px, py, pz);
      if (isHold && p.hold > 0.001 && holdW) {
        _w.copy(holdW);
        torso.worldToLocal(_w);
        _t.lerp(_w, p.hold);
      }
      _pole.set(arm.s * p.out, -0.6, -0.45);
      solveArm(arm, _t, _pole);
    }
    // 围巾尾 & 呆毛的随风摆动
    scarfTail.rotation.set(0.18 + Math.sin(t * 2.1 + phase) * 0.09, Math.sin(t * 1.3 + phase) * 0.1, Math.sin(t * 1.7 + phase * 3) * 0.06);
    if (ahoge) ahoge.rotation.z = Math.sin(t * 2.6) * 0.18;
  }

  root.scale.setScalar(S.scale);
  return {
    root, head, ball, face, applyPose,
    headWorld(out) { return ball.getWorldPosition(out); },
    setExpression: (n, snap) => face.set(n, snap),
    update: (dt) => face.update(dt),
    // 供外部调节描边/阴影
    traverse(fn) { root.traverse(fn); },
  };
}

// 手部目标(lx..rz)是躯干局部坐标:肩在 (±0.2, 0.46),下垂时手在肩下约 0.55
export const POSE0 = {
  x: 0, z: 0, yaw: 0, lean: 0, sway: 0, twist: 0, hp: 0, hy: 0, hr: 0, crouch: 0,
  lx: 0.27, ly: -0.1, lz: 0.04, rx: -0.27, ry: -0.1, rz: 0.04, out: 0.5, hold: 0,
};
