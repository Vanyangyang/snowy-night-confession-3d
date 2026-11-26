// 场景:雪夜广场、圣诞树、路灯与彩灯串、天际线、天空、灯光。
import * as THREE from 'three';
import { rng, Bulbs, createSnow, createGlitter, createHearts, createFireworks } from './fx.js';

const TAU = Math.PI * 2;
export const TREE_POS = new THREE.Vector3(5.2, 0, -8.5);
const LAMP_N = 8, LAMP_R = 13, LAMP_H = 4.3;

const PAL = {
  warm: [3.2, 2.1, 1.0], gold: [3.4, 2.3, 0.7], pink: [3.0, 0.95, 1.6],
  cyan: [0.9, 2.2, 3.4], red: [3.2, 0.5, 0.45], white: [2.8, 2.7, 3.0], mint: [0.9, 3.2, 2.2],
};
const TREE_COLORS = ['warm', 'warm', 'gold', 'gold', 'pink', 'cyan', 'white', 'red'];

function canvasTex(w, h, draw, o = {}) {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  draw(cv.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  if (o.repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(o.repeat[0], o.repeat[1]); }
  t.anisotropy = 8;
  return t;
}
function radialTex(stops, size = 256) {
  return canvasTex(size, size, (c, w, h) => {
    const g = c.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    for (const [o, col] of stops) g.addColorStop(o, col);
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
  });
}
const std = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0, ...o });

export function buildWorld(scene, camera) {
  const R = rng(2025);
  const bulbs = new Bulbs(7000);
  const addBulb = (v, name, size, ph) => bulbs.add(v.x, v.y, v.z, PAL[name][0], PAL[name][1], PAL[name][2], size, ph ?? R());

  scene.fog = new THREE.FogExp2(0x3a2f6e, 0.0085);
  scene.background = new THREE.Color(0x060922);

  /* ---------- 天空 ---------- */
  const sky = new THREE.Group();
  scene.add(sky);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      uTop: { value: new THREE.Color(0x060922) }, uMid: { value: new THREE.Color(0x1a2158) },
      uHor: { value: new THREE.Color(0x40307a) }, uGlow: { value: new THREE.Color(0xd77fa0) },
    },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform vec3 uTop, uMid, uHor, uGlow; varying vec3 vDir;
      void main(){
        float h = clamp(vDir.y, 0.0, 1.0);
        vec3 c = mix(uHor, uMid, smoothstep(0.0, 0.38, h));
        c = mix(c, uTop, smoothstep(0.3, 0.95, h));
        c += uGlow * 0.16 * pow(1.0 - h, 8.0);
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(450, 32, 20), skyMat);
  dome.renderOrder = -10;
  sky.add(dome);

  const starN = 1400;
  const sp = new Float32Array(starN * 3), ss = new Float32Array(starN);
  for (let i = 0; i < starN; i++) {
    const u = 0.04 + R() * 0.96, th = R() * TAU, s = Math.sqrt(1 - u * u);
    sp.set([Math.cos(th) * s * 430, u * 430, Math.sin(th) * s * 430], i * 3);
    ss[i] = R();
  }
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
  sg.setAttribute('aSeed', new THREE.BufferAttribute(ss, 1));
  const starU = { uTime: { value: 0 }, uH: { value: 1080 } };
  const stars = new THREE.Points(sg, new THREE.ShaderMaterial({
    uniforms: starU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    vertexShader: `attribute float aSeed; uniform float uTime, uH; varying float vA;
      void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0);
        float tw = 0.55 + 0.45 * sin(uTime * (0.8 + aSeed * 2.0) + aSeed * 90.0);
        vA = (0.35 + aSeed * 0.65) * tw;
        gl_PointSize = (1.2 + aSeed * 2.2) * uH / 1080.0; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `varying float vA; void main(){ float d = length(gl_PointCoord - 0.5) * 2.0; float a = exp(-d * d * 4.0); gl_FragColor = vec4(vec3(0.8, 0.88, 1.5) * 1.4, a * vA); }`,
  }));
  stars.renderOrder = -9;
  sky.add(stars);

  const moonDir = new THREE.Vector3(-0.5, 0.52, -0.69).normalize();
  const moon = new THREE.Mesh(new THREE.CircleGeometry(15, 48), new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.95, 0.82).multiplyScalar(1.7), fog: false }));
  moon.position.copy(moonDir).multiplyScalar(380);
  moon.lookAt(0, 0, 0);
  moon.renderOrder = -8;
  sky.add(moon);
  const moonGlow = new THREE.Mesh(new THREE.PlaneGeometry(190, 190), new THREE.MeshBasicMaterial({
    map: radialTex([[0, 'rgba(255,240,210,0.7)'], [0.25, 'rgba(190,200,255,0.22)'], [1, 'rgba(120,130,220,0)']]),
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
  }));
  moonGlow.position.copy(moonDir).multiplyScalar(375);
  moonGlow.lookAt(0, 0, 0);
  moonGlow.renderOrder = -8;
  sky.add(moonGlow);

  /* ---------- 地面 ---------- */
  const snowTex = canvasTex(512, 512, (c, w, h) => {
    c.fillStyle = '#e6edff';
    c.fillRect(0, 0, w, h);
    const r = rng(5);
    for (let i = 0; i < 2600; i++) {
      const x = r() * w, y = r() * h, rad = 4 + r() * 26;
      const g = c.createRadialGradient(x, y, 0, x, y, rad);
      g.addColorStop(0, r() < 0.55 ? 'rgba(150,165,215,0.12)' : 'rgba(255,255,255,0.18)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = g;
      c.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    }
  }, { repeat: [28, 28] });
  const ground = new THREE.Mesh(new THREE.CircleGeometry(160, 64), std(0xc9d4f0, { map: snowTex, roughness: 0.92 }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const plazaTex = canvasTex(1024, 1024, (c, w, h) => {
    const cx = w / 2, cy = h / 2, rmax = (w / 2) * 0.98, r = rng(9);
    c.save();
    c.beginPath(); c.arc(cx, cy, rmax, 0, TAU); c.clip();
    c.fillStyle = '#6d7599'; c.fillRect(0, 0, w, h);
    for (let ring = 0; ring < 16; ring++) {
      const r0 = ring * (rmax / 16), r1 = (ring + 1) * (rmax / 16), n = Math.max(6, ring * 7 + 8);
      for (let k = 0; k < n; k++) {
        const a0 = (k / n) * TAU, a1 = ((k + 1) / n) * TAU, v = 0.85 + r() * 0.3;
        c.fillStyle = `rgb(${(109 * v) | 0},${(117 * v) | 0},${(153 * v) | 0})`;
        c.beginPath(); c.arc(cx, cy, r1, a0, a1); c.arc(cx, cy, r0, a1, a0, true); c.closePath(); c.fill();
        c.strokeStyle = 'rgba(30,34,60,0.55)'; c.lineWidth = 2; c.stroke();
      }
    }
    for (let i = 0; i < 800; i++) {
      const a = r() * TAU, rr = Math.sqrt(r()) * rmax, x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr, rad = 6 + r() * 34;
      const g = c.createRadialGradient(x, y, 0, x, y, rad);
      g.addColorStop(0, 'rgba(240,246,255,0.55)'); g.addColorStop(1, 'rgba(240,246,255,0)');
      c.fillStyle = g; c.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    }
    c.restore();
    c.globalCompositeOperation = 'destination-in';
    const m = c.createRadialGradient(cx, cy, rmax * 0.8, cx, cy, rmax);
    m.addColorStop(0, 'rgba(0,0,0,1)'); m.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = m; c.fillRect(0, 0, w, h);
  });
  const plaza = new THREE.Mesh(new THREE.PlaneGeometry(15, 15), std(0xffffff, { map: plazaTex, transparent: true, roughness: 0.55, depthWrite: false }));
  plaza.rotation.x = -Math.PI / 2;
  plaza.position.y = 0.006;
  plaza.receiveShadow = true;
  scene.add(plaza);

  const poolTexWarm = radialTex([[0, 'rgba(255,205,140,1)'], [0.4, 'rgba(255,170,95,0.42)'], [1, 'rgba(255,150,80,0)']]);
  const poolTexPink = radialTex([[0, 'rgba(255,170,200,1)'], [0.4, 'rgba(255,130,190,0.35)'], [1, 'rgba(255,120,180,0)']]);
  function pool(x, z, r, op, tex = poolTexWarm) {
    const m = new THREE.Mesh(new THREE.CircleGeometry(r, 48), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: op, fog: false }));
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, 0.02, z);
    m.renderOrder = 1;
    scene.add(m);
    return m;
  }
  pool(0.1, 0.4, 4.2, 0.16, poolTexPink);
  pool(0, 0.2, 7, 0.12);

  /* ---------- 圣诞树 ---------- */
  const tree = new THREE.Group();
  tree.position.copy(TREE_POS);
  scene.add(tree);
  const green = std(0x16513f, { roughness: 0.9 }), snowW = std(0xe9f0ff, { roughness: 1 });
  const tiers = [{ r: 3.5, h: 3.5, y: 0.9 }, { r: 2.8, h: 3.1, y: 2.7 }, { r: 2.1, h: 2.7, y: 4.4 }, { r: 1.4, h: 2.3, y: 5.9 }];
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.46, 1.6, 14), std(0x3a2a22));
  trunk.position.set(0, 0.8, 0);
  tree.add(trunk);
  tiers.forEach((t, ti) => {
    const cone = new THREE.Mesh(new THREE.ConeGeometry(t.r, t.h, 44, 1), green);
    cone.position.y = t.y + t.h / 2;
    tree.add(cone);
    const capH = t.h * 0.34, capR = t.r * 0.34 * 1.06;
    const cap = new THREE.Mesh(new THREE.ConeGeometry(capR, capH, 44, 1), snowW);
    cap.position.y = t.y + t.h - capH / 2 + 0.02;
    tree.add(cap);
    const turns = 5 + ti, n = Math.floor(70 + t.r * 36);
    for (let g = 0; g < 2; g++) {
      for (let i = 0; i < n; i++) {
        const s = i / n, f = 0.1 + 0.82 * s, a = s * turns * TAU + g * Math.PI, rad = t.r * (1 - f) * 1.03 + 0.07;
        const v = new THREE.Vector3(Math.cos(a) * rad, t.y + f * t.h, Math.sin(a) * rad).add(TREE_POS);
        addBulb(v, TREE_COLORS[(R() * TREE_COLORS.length) | 0], 0.05 + R() * 0.025);
      }
    }
    // 球形挂饰
    for (let i = 0; i < 9 + ti; i++) {
      const f = 0.15 + R() * 0.7, a = R() * TAU, rad = t.r * (1 - f) * 1.0 + 0.1;
      const col = [0xd43a4a, 0xe6b84a, 0x4a78d6, 0xc7d0ff][(R() * 4) | 0];
      const o = new THREE.Mesh(new THREE.SphereGeometry(0.13 + R() * 0.04, 14, 12), std(col, { roughness: 0.3, metalness: 0.5, emissive: col, emissiveIntensity: 0.55 }));
      o.position.set(Math.cos(a) * rad, t.y + f * t.h - 0.1, Math.sin(a) * rad);
      tree.add(o);
    }
  });
  // 树顶星
  const starShape = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const rr = i % 2 === 0 ? 0.62 : 0.27, a = (i / 10) * TAU + Math.PI / 2;
    i === 0 ? starShape.moveTo(Math.cos(a) * rr, Math.sin(a) * rr) : starShape.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  starShape.closePath();
  const starMesh = new THREE.Mesh(new THREE.ExtrudeGeometry(starShape, { depth: 0.16, bevelEnabled: true, bevelSize: 0.04, bevelThickness: 0.04, bevelSegments: 2 }), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.3, 1.7, 0.65) }));
  starMesh.position.set(0, 8.4, -0.08);
  tree.add(starMesh);
  bulbs.add(TREE_POS.x, 8.4, TREE_POS.z, 2.4, 1.7, 0.7, 0.5, 0.3);
  // 礼物
  const giftCols = [0xd9485a, 0x4a86d9, 0xe5b848, 0x58b894, 0xa56bd8, 0xf08a9c];
  for (let i = 0; i < 9; i++) {
    const a = R() * TAU, rad = 1.9 + R() * 2.2, w = 0.5 + R() * 0.6, h = 0.4 + R() * 0.5, d = 0.5 + R() * 0.5, col = giftCols[i % giftCols.length];
    const g = new THREE.Group();
    g.position.set(Math.cos(a) * rad, 0, Math.sin(a) * rad);
    g.rotation.y = R() * TAU;
    const box = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), std(col, { roughness: 0.55 }));
    box.position.y = h / 2;
    const rib1 = new THREE.Mesh(new THREE.BoxGeometry(w * 1.02, h * 1.01, 0.08), std(0xf5e9c8, { emissive: 0xf5e9c8, emissiveIntensity: 0.15 }));
    rib1.position.y = h / 2;
    const rib2 = new THREE.Mesh(new THREE.BoxGeometry(0.08, h * 1.01, d * 1.02), rib1.material);
    rib2.position.y = h / 2;
    g.add(box, rib1, rib2);
    tree.add(g);
  }
  pool(TREE_POS.x, TREE_POS.z, 9, 0.38);

  /* ---------- 路灯 + 彩灯串 ---------- */
  const lampTops = [];
  const metal = std(0x20243e, { roughness: 0.55, metalness: 0.4 });
  const lanternMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 2.2, 1.1) });
  for (let k = 0; k < LAMP_N; k++) {
    const a = ((k + 0.5) / LAMP_N) * TAU, x = Math.cos(a) * LAMP_R, z = Math.sin(a) * LAMP_R;
    const post = new THREE.Group();
    post.position.set(x, 0, z);
    scene.add(post);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.26, 0.6, 12), metal);
    base.position.y = 0.3;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.11, LAMP_H, 10), metal);
    pole.position.y = LAMP_H / 2;
    const lantern = new THREE.Mesh(new THREE.SphereGeometry(0.24, 16, 12), lanternMat);
    lantern.position.y = LAMP_H + 0.22;
    const cap = new THREE.Mesh(new THREE.ConeGeometry(0.34, 0.28, 14), metal);
    cap.position.y = LAMP_H + 0.58;
    post.add(base, pole, lantern, cap);
    bulbs.add(x, LAMP_H + 0.22, z, 3.4, 2.3, 1.1, 0.85, R());
    pool(x, z, 4.8, 0.3);
    lampTops.push(new THREE.Vector3(x, LAMP_H + 0.05, z));
  }
  const wireMat = new THREE.MeshBasicMaterial({ color: 0x12142a });
  for (let k = 0; k < LAMP_N; k++) {
    const A = lampTops[k], B = lampTops[(k + 1) % LAMP_N], sag = 1.0;
    const C = A.clone().add(B).multiplyScalar(0.5);
    C.y -= 2 * sag;
    const curve = new THREE.QuadraticBezierCurve3(A, C, B);
    scene.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 28, 0.013, 5, false), wireMat));
    const names = ['warm', 'gold', 'pink', 'cyan', 'white', 'warm'];
    for (let i = 0; i < 22; i++) addBulb(curve.getPoint((i + 0.5) / 22), names[i % names.length], 0.055);
  }

  /* ---------- 松树(实例化) ---------- */
  const pineN = 30;
  const coneG = new THREE.ConeGeometry(1, 1, 10, 1);
  const treeInst = new THREE.InstancedMesh(coneG, std(0x123c3a, { roughness: 0.95 }), pineN * 3);
  const snowInst = new THREE.InstancedMesh(coneG, snowW, pineN * 3);
  const trunkInst = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.2, 0.28, 1, 8), std(0x30241f), pineN);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), ps = new THREE.Vector3();
  for (let i = 0; i < pineN; i++) {
    const a = R() * TAU, rad = 17 + R() * 20, s = 0.8 + R() * 0.9, x = Math.cos(a) * rad, z = Math.sin(a) * rad;
    if (Math.hypot(x - TREE_POS.x, z - TREE_POS.z) < 6) { /* 避开圣诞树 */ }
    for (let j = 0; j < 3; j++) {
      const r = (1.9 - j * 0.5) * s, h = (2.3 - j * 0.25) * s, y = (0.9 + j * 1.05) * s;
      m4.compose(ps.set(x, y + h / 2, z), q.identity(), sc.set(r, h, r));
      treeInst.setMatrixAt(i * 3 + j, m4);
      m4.compose(ps.set(x, y + h * 0.66, z), q.identity(), sc.set(r * 0.4 * 1.05, h * 0.36, r * 0.4 * 1.05));
      snowInst.setMatrixAt(i * 3 + j, m4);
    }
    m4.compose(ps.set(x, 0.5 * s, z), q.identity(), sc.set(s, s, s));
    trunkInst.setMatrixAt(i, m4);
  }
  scene.add(treeInst, snowInst, trunkInst);

  /* ---------- 长椅 ---------- */
  const benchMat = std(0x4a3a35, { roughness: 0.8 });
  for (const [x, z, ry] of [[-6.2, -3.2, 0.5], [6.4, 3.6, -0.7], [-3.5, 7.5, 2.6]]) {
    const b = new THREE.Group();
    b.position.set(x, 0, z);
    b.rotation.y = ry;
    const seat = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.07, 0.5), benchMat);
    seat.position.y = 0.48;
    const back = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.4, 0.06), benchMat);
    back.position.set(0, 0.8, -0.22);
    const snowTop = new THREE.Mesh(new THREE.BoxGeometry(1.76, 0.06, 0.46), snowW);
    snowTop.position.y = 0.54;
    b.add(seat, back, snowTop);
    for (const sx of [-0.8, 0.8]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.48, 0.45), metal);
      leg.position.set(sx, 0.24, 0);
      b.add(leg);
    }
    scene.add(b);
  }

  /* ---------- 天际线 ---------- */
  const winTexA = (seed) => canvasTex(256, 512, (c, w, h) => {
    const r = rng(seed), cols = 8, rows = 24, cw = w / cols, ch = h / rows;
    c.fillStyle = '#000'; c.fillRect(0, 0, w, h);
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      if ((x === 0 && y === 0) || r() > 0.4) continue;
      const k = r();
      c.fillStyle = k < 0.68 ? `rgb(255,${(185 + r() * 55) | 0},${(105 + r() * 60) | 0})` : k < 0.9 ? 'rgb(190,222,255)' : 'rgb(255,160,190)';
      c.globalAlpha = 0.55 + r() * 0.45;
      c.fillRect(x * cw + 4, y * ch + 4, cw - 8, ch - 8);
    }
    c.globalAlpha = 1;
  }, {});
  const winTexes = [winTexA(1), winTexA(2), winTexA(3)];
  winTexes.forEach((t) => { t.wrapS = t.wrapT = THREE.RepeatWrapping; });
  const bMats = winTexes.map((t) => std(0x121830, { roughness: 0.9, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: 1.25 }));
  for (let i = 0; i < 96; i++) {
    const a = (i / 96) * TAU + (R() - 0.5) * 0.06;
    // 朝向 -z(开场与终场镜头的方向)的扇区放低矮、更远的楼,把天空与月亮让出来
    const wedge = Math.acos(-Math.sin(a)) < 0.8;
    const rad = wedge ? 80 + R() * 32 : 50 + R() * 46;
    const w = 6 + R() * 11, d = 6 + R() * 10;
    const h = wedge ? 7 + R() * 14 : 14 + Math.pow(R(), 1.8) * 44;
    const geo = new THREE.BoxGeometry(w, h, d);
    const uv = geo.attributes.uv, ou = R(), ov = R();
    for (let v = 0; v < uv.count; v++) {
      const face = Math.floor(v / 4), hw = face < 2 ? d : w;
      if (face === 2 || face === 3) { uv.setXY(v, 0.02, 0.02); continue; }
      uv.setXY(v, uv.getX(v) * (hw / 6.4) + ou, uv.getY(v) * (h / 53) + ov);
    }
    const b = new THREE.Mesh(geo, bMats[i % 3]);
    b.position.set(Math.cos(a) * rad, h / 2, Math.sin(a) * rad);
    b.rotation.y = R() * 0.6;
    scene.add(b);
  }
  // 远处城市光斑(失焦后变散景)
  const cityNames = ['warm', 'warm', 'gold', 'cyan', 'pink', 'white'];
  for (let i = 0; i < 300; i++) {
    const a = R() * TAU, wedge = Math.acos(-Math.sin(a)) < 0.8, rad = wedge ? 80 + R() * 30 : 42 + R() * 60, y = 1 + Math.pow(R(), 1.3) * (wedge ? 15 : 40);
    bulbs.add(Math.cos(a) * rad, y, Math.sin(a) * rad, ...PAL[cityNames[(R() * cityNames.length) | 0]].map((x) => x * 0.8), 0.7 + R() * 0.9, R());
  }

  bulbs.commit();
  scene.add(bulbs.points);

  /* ---------- 雪、闪光、爱心、烟花 ---------- */
  const snow = createSnow();
  const glitter = createGlitter();
  const hearts = createHearts();
  const fireworks = createFireworks();
  scene.add(snow.points, glitter.points, hearts.points, fireworks.points);

  /* ---------- 灯光 ---------- */
  const hemi = new THREE.HemisphereLight(0x7f90e6, 0x2c2552, 0.85);
  const moonL = new THREE.DirectionalLight(0xb6c8ff, 1.35);
  moonL.position.set(-14, 19, -16);
  moonL.castShadow = true;
  moonL.shadow.mapSize.set(2048, 2048);
  const sc2 = moonL.shadow.camera;
  sc2.left = -5; sc2.right = 5; sc2.top = 5; sc2.bottom = -5; sc2.near = 1; sc2.far = 60;
  moonL.shadow.bias = -0.0004;
  moonL.shadow.normalBias = 0.02;
  const fill = new THREE.DirectionalLight(0xffd6aa, 0.35);
  fill.position.set(5, 3.5, 9);
  const treeLight = new THREE.PointLight(0xffb866, 110, 36, 2);
  treeLight.position.set(TREE_POS.x, 7.0, TREE_POS.z + 1.5);
  const key = new THREE.PointLight(0xffe0c4, 8, 14, 2);
  key.position.set(0.25, 0.15, 0);
  camera.add(key);
  scene.add(hemi, moonL, fill, treeLight);

  const _v = new THREE.Vector3();
  return {
    bulbs, snow, glitter, hearts, fireworks, lights: { hemi, moon: moonL, fill, tree: treeLight, key },
    update({ amb, fxT, pulse, focus, aperture, H }) {
      sky.position.copy(camera.position);
      starU.uTime.value = amb; starU.uH.value = H;
      const scale = H * 0.5 * camera.projectionMatrix.elements[5];
      const bu = bulbs.uniforms;
      bu.uTime.value = amb; bu.uFocus.value = focus; bu.uAperture.value = aperture; bu.uScale.value = scale; bu.uH.value = H; bu.uPulse.value = pulse;
      bu.uMaxSize.value = Math.min(190, H * 0.2);
      snow.uniforms.uTime.value = amb; snow.uniforms.uScale.value = scale; snow.uniforms.uCam.value.copy(camera.position);
      glitter.uniforms.uTime.value = amb; glitter.uniforms.uScale.value = scale;
      hearts.uniforms.uTime.value = fxT; hearts.uniforms.uScale.value = scale;
      fireworks.uniforms.uTime.value = fxT; fireworks.uniforms.uScale.value = scale;
      treeLight.intensity = 110 * (1 + 0.05 * Math.sin(amb * 2.3) + pulse * 0.5);
      void _v;
    },
  };
}
