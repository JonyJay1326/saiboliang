// 太仓 · 首页图腾「赛博粮站通宝」：上万颗粮粒粒子聚成一枚方孔钱，钱文取站名字图（授权内的图片产出物）。
// 交互：指针拨粮（推开 + 涡旋）、点击放粮（钱身一震，粮粒从方孔喷涌而出、落下再归位）、导航 / 入口悬停时变形为对应板块图腾。
// 纪律同虎符 / 星海：独立 chunk、首屏后取件；画布 aria-hidden、零数据；离屏 / 隐藏即停；
// reduced-motion 只画静止单帧。
import { STATIONS } from '../lib/stations.js';

const VERT = `
attribute vec4 a_dyn;
attribute vec2 a_meta;
uniform mat3 u_rot;
uniform vec2 u_center;
uniform vec2 u_res;
uniform float u_radius;
uniform float u_persp;
uniform float u_size;
uniform float u_time;
uniform float u_flash;
uniform float u_mode;
uniform float u_fade;
uniform float u_glint;
uniform float u_glow;
varying vec3 v_col;
varying float v_soft;
void main() {
  float kind = a_meta.x;
  float seed = a_meta.y;
  float speed = a_dyn.w;
  bool dust = kind > 2.5 && kind < 3.5;
  bool halo = kind > 1.5 && kind < 2.5;
  // 辉光遍只取一部分钱身 / 光环粒子，画成大而淡的光斑，叠出泛光
  if (u_glow > .5 && (dust || seed > (halo ? .5 : .32))) {
    gl_Position = vec4(2., 2., 2., 1.);
    gl_PointSize = 0.;
    v_col = vec3(0.);
    v_soft = 0.;
    return;
  }
  vec3 p = a_dyn.xyz;
  vec3 q = u_rot * p;
  float s = u_persp / max(u_persp - q.z, .4);
  vec2 px = u_center + vec2(q.x, -q.y) * s * u_radius;
  gl_Position = vec4(px / u_res * 2. - 1., 0., 1.);
  gl_Position.y = -gl_Position.y;
  float tw = .8 + .2 * sin(u_time * (1.3 + seed * 3.1) + seed * 61.);
  vec3 gold = mix(vec3(1., .74, .26), vec3(1., .93, .7), seed);
  vec3 deep = mix(vec3(.7, .43, .1), vec3(1., .77, .3), seed);
  vec3 cyan = mix(vec3(.18, .8, .7), vec3(.75, 1., .95), seed);
  vec3 c = kind < .5 ? gold : kind < 1.5 ? deep : halo ? cyan : dust ? mix(deep, cyan, step(.62, seed)) : deep * .8;
  if (!halo && !dust) c = mix(c, seed > .45 ? cyan : gold, u_mode);
  c = mix(c, vec3(.88, 1., .97), halo ? clamp(speed * .2, 0., .85) : clamp(speed * .07, 0., .4));
  // 金属高光：一道斜向光带掠过钱面（空闲时定时扫过，指针在场时跟随指针）
  float glint = 0.;
  if (!halo && !dust) {
    float band = p.x * .55 + p.y * .83 - u_glint;
    glint = exp(-band * band * 16.) * (1. - u_mode * .55);
    c = mix(c, vec3(1., .97, .86), glint * .75);
  }
  float depth = clamp(.68 + q.z * .42, .25, 1.25);
  float energy = dust ? .7 : halo ? 1.15 : kind < .5 ? 1.9 : kind < 1.5 ? 1.55 : mix(.42, 1.5, u_mode);
  energy *= (1. + glint * 1.5) * (1. + min(speed * .12, .9));
  float base = dust ? .7 + seed * 1.9 : halo ? .8 + seed * 1.1 : kind < .5 ? .95 + seed * .9 : kind < 1.5 ? .9 + seed * 1.1 : .8 + seed * .9;
  float size = base * u_size * s * (1. + min(speed * (halo ? .12 : .05), .5));
  v_soft = 0.;
  if (u_glow > .5) { size *= 4.6; energy *= .075; v_soft = 1.; }
  v_col = c * depth * tw * energy * (1. + u_flash * 1.4) * u_fade;
  gl_PointSize = size;
}`;

const FRAG = `
precision mediump float;
varying vec3 v_col;
varying float v_soft;
void main() {
  vec2 d = gl_PointCoord - .5;
  float r = dot(d, d) * 4.;
  if (r > 1.) discard;
  float a = exp(-r * mix(3.4, 2.2, v_soft)) * (1. - r * v_soft);
  gl_FragColor = vec4(v_col * a, a * .5);
}`;

// 钱身实体：一块细分的平面网格，与粒子共用旋转与透视；片元里画出外郭、方孔、斜面车纹与金属高光
const DISC_VERT = `
attribute vec2 a_uv;
uniform mat3 u_rot;
uniform vec2 u_center;
uniform vec2 u_res;
uniform float u_radius;
uniform float u_persp;
varying vec2 v_uv;
varying float v_light;
void main() {
  vec3 q = u_rot * vec3(a_uv, 0.);
  float s = u_persp / max(u_persp - q.z, .4);
  vec2 px = u_center + vec2(q.x, -q.y) * s * u_radius;
  gl_Position = vec4(px / u_res * 2. - 1., 0., 1.);
  gl_Position.y = -gl_Position.y;
  vec3 n = u_rot * vec3(0., 0., 1.);
  v_light = .5 + .35 * abs(n.z) + .45 * max(dot(n, normalize(vec3(-.45, .55, .7))), 0.);
  v_uv = a_uv;
}`;

const DISC_FRAG = `
precision mediump float;
varying vec2 v_uv;
varying float v_light;
uniform float u_glint;
uniform float u_solid;
uniform float u_fade;
uniform float u_flash;
void main() {
  vec2 p = v_uv;
  float r = length(p);
  float sq = max(abs(p.x), abs(p.y));
  float a = 1. - smoothstep(.994, 1.006, r);
  if (a <= 0.) discard;
  // 方孔：不挖空，压成近黑的深井，带出孔壁的纵深
  float hole = 1. - smoothstep(.159, .171, sq);
  float raised = max(smoothstep(.862, .874, r), 1. - smoothstep(.246, .258, sq));
  vec3 c = mix(vec3(.07, .047, .022), vec3(.2, .13, .05), raised);
  float bevel = exp(-pow((r - .868) / .011, 2.)) + exp(-pow((sq - .252) / .009, 2.)) + exp(-pow((r - .992) / .01, 2.)) * .6;
  c += vec3(.55, .38, .13) * bevel * .38;
  c *= .9 + .1 * sin(r * 300.);
  float band = p.x * .55 + p.y * .83 - u_glint;
  c += vec3(.6, .44, .18) * exp(-band * band * 5.) * (.3 + raised * .55);
  c *= (.82 + .3 * (1. - r)) * v_light * (1. + u_flash * .5);
  c *= 1. - hole * .9;
  float alpha = a * u_solid * u_fade * mix(.94, .8, hole);
  gl_FragColor = vec4(c * alpha, alpha);
}`;

const KIND = { char: 0, rim: 1, halo: 2, dust: 3, field: 4 };
const TAU = Math.PI * 2;

/** 光栅采样器：把绘制结果里不透明的像素收成点池，按需随机取点（附亚像素抖动），返回 [0,1] 坐标。 */
function rasterPool(size, draw) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  draw(ctx, size);
  const { data } = ctx.getImageData(0, 0, size, size);
  const pool = [];
  for (let i = 0; i < size * size; i++) if (data[i * 4 + 3] > 110) pool.push(i);
  return () => {
    if (!pool.length) return null;
    const index = pool[(Math.random() * pool.length) | 0];
    return [((index % size) + Math.random()) / size, (Math.floor(index / size) + Math.random()) / size];
  };
}

function tierFor() {
  const narrow = matchMedia('(max-width: 760px)').matches;
  const coarse = matchMedia('(pointer: coarse)').matches || matchMedia('(max-width: 1100px)').matches;
  if (narrow) return { count: 5200, dpr: Math.min(devicePixelRatio || 1, 1.5) };
  if (coarse) return { count: 9000, dpr: Math.min(devicePixelRatio || 1, 1.75) };
  return { count: 15000, dpr: Math.min(devicePixelRatio || 1, 2) };
}

async function loadBrand() {
  const img = new Image();
  img.src = '/font-images/brand.png';
  try { await img.decode(); return img; } catch { return null; }
}

export async function mount(root) {
  const canvas = root.querySelector('[data-coin-canvas]');
  const anchor = root.querySelector('[data-coin-anchor]');
  const gl = canvas?.getContext('webgl', { antialias: false, premultipliedAlpha: true, alpha: true, powerPreference: 'high-performance' });
  if (!gl || !anchor) throw new Error('webgl unavailable');

  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const { count: N, dpr } = tierFor();
  const brand = await loadBrand();

  // ---- 粒子分工：钱文 / 钱地（凹面） / 郭（钱身） / 浑仪光环 / 游尘 ----
  const nHalo = Math.round(N * .13);
  const nDust = Math.round(N * .05);
  const nBody = N - nHalo - nDust;
  const nChar = brand ? Math.round(nBody * .4) : 0;
  const nField = Math.round(nBody * .1);
  const kind = new Float32Array(N);
  const seed = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    kind[i] = i < nChar ? KIND.char : i < nChar + nField ? KIND.field : i < nBody ? KIND.rim : i < nBody + nHalo ? KIND.halo : KIND.dust;
    seed[i] = Math.random();
  }

  // ---- 队形：钱 + 五个板块图腾（只给钱身 / 钱文粒子用）----
  // 钱面立体：钱地 z=0 下凹，钱文与内外郭 z=RELIEF 凸起，外缘有厚度（正反两面 + 侧壁）
  const RELIEF = .05;
  function coinForm() {
    const out = new Float32Array(nBody * 3);
    const put = (i, x, y, z) => { out[i * 3] = x; out[i * 3 + 1] = y; out[i * 3 + 2] = z; };
    const jitter = amount => (Math.random() - .5) * amount;
    let i = 0;
    if (brand) {
      // 钱文对读：上「赛」下「博」右「粮」左「站」
      const slots = [[0, .54], [0, -.54], [.54, 0], [-.54, 0]];
      const quarter = brand.naturalWidth / 4;
      const samplers = slots.map((_, k) => rasterPool(220, (ctx, size) => {
        ctx.drawImage(brand, quarter * k, 0, quarter, brand.naturalHeight, 4, 4, size - 8, size - 8);
      }));
      for (; i < nChar; i++) {
        const k = i % 4;
        const p = samplers[k]() ?? [.5, .5];
        put(i, slots[k][0] + (p[0] - .5) * .46, slots[k][1] - (p[1] - .5) * .46, RELIEF + jitter(.02));
      }
    }
    // 钱地：内郭到方孔之间的凹面，稀疏铺一层暗金
    for (const end = i + nField; i < end; i++) {
      let x, y;
      do { x = Math.random() * 1.6 - .8; y = Math.random() * 1.6 - .8; } while (x * x + y * y > .76 * .76 || (Math.abs(x) < .27 && Math.abs(y) < .27));
      put(i, x, y, jitter(.012));
    }
    // 郭与孔：按权重分到各条轮廓，轮廓线密、面带疏，小尺寸下也清楚
    function square(w, z) {
      const side = (Math.random() * 4) | 0, along = (Math.random() * 2 - 1) * w;
      return side === 0 ? [along, w, z] : side === 1 ? [along, -w, z] : side === 2 ? [w, along, z] : [-w, along, z];
    }
    const ring = (r, z) => { const a = Math.random() * TAU; return [Math.cos(a) * r, Math.sin(a) * r, z]; };
    const parts = [
      [.2, () => ring(1 + jitter(.008), RELIEF)],
      [.07, () => ring(1, -RELIEF)],
      [.1, () => ring(1, jitter(RELIEF * 2))],
      [.14, () => ring(.87 + Math.random() * .13, RELIEF + jitter(.01))],
      [.13, () => ring(.865 + jitter(.008), RELIEF)],
      [.1, () => {
        // 连珠：48 颗小圆珠
        const a = Math.floor(Math.random() * 48) / 48 * TAU, r = Math.sqrt(Math.random()) * .014, b = Math.random() * TAU;
        return [Math.cos(a) * .805 + Math.cos(b) * r, Math.sin(a) * .805 + Math.sin(b) * r, RELIEF * .6];
      }],
      [.12, () => square(.25 + jitter(.006), RELIEF)],
      [.12, () => square(.165 + jitter(.006), RELIEF)],
      [.12, () => square(.165 + Math.random() * .085, RELIEF + jitter(.01))],
    ];
    const total = parts.reduce((sum, [w]) => sum + w, 0);
    for (; i < nBody; i++) {
      let roll = Math.random() * total, k = 0;
      while (roll > parts[k][0] && k < parts.length - 1) roll -= parts[k++][0];
      const [x, y, z] = parts[k][1]();
      put(i, x, y, z);
    }
    return out;
  }
  function glyphForm(path) {
    const out = new Float32Array(nBody * 3);
    const sample = rasterPool(192, (ctx, size) => {
      ctx.scale(size / 48, size / 48);
      ctx.lineWidth = 1.9;
      ctx.lineCap = ctx.lineJoin = 'round';
      ctx.strokeStyle = '#fff';
      ctx.stroke(new Path2D(path));
    });
    for (let i = 0; i < nBody; i++) {
      const p = sample() ?? [.5, .5];
      out[i * 3] = (p[0] - .5) * 2.35;
      out[i * 3 + 1] = -(p[1] - .5) * 2.35;
      out[i * 3 + 2] = (Math.random() - .5) * .16;
    }
    return out;
  }
  const forms = { coin: coinForm() };
  for (const station of STATIONS) if (station.form !== 'coin') forms[station.form] = glyphForm(station.glyph);

  // ---- 状态 ----
  const pos = new Float32Array(N * 3);
  const vel = new Float32Array(N * 3);
  const dyn = new Float32Array(N * 4);
  const stiff = new Float32Array(N);
  const arrive = new Float32Array(N);
  const hold = new Float32Array(N);
  const haloRing = new Uint8Array(N);
  const haloAngle = new Float32Array(N);
  const haloRadius = new Float32Array(N);
  const haloSpeed = new Float32Array(N);
  const comet = new Float32Array(N);
  let target = forms.coin;
  let bounds = { x0: -3, x1: 3, y0: -2, y1: 2 };

  const rings = [
    { tiltX: 1.18, tiltZ: .32 },
    { tiltX: 1.32, tiltZ: -.62 },
    { tiltX: .2, tiltZ: 0 },
  ];
  function haloTarget(i, t, out) {
    const ring = rings[haloRing[i]];
    const a = haloAngle[i] + t * haloSpeed[i];
    const r = haloRadius[i];
    let x = Math.cos(a) * r;
    let y = Math.sin(a) * r;
    let z = 0;
    // 绕 X 倾倒，再绕 Z 偏转
    const cx = Math.cos(ring.tiltX), sx = Math.sin(ring.tiltX);
    const y1 = y * cx - z * sx;
    z = y * sx + z * cx;
    y = y1;
    const cz = Math.cos(ring.tiltZ), sz = Math.sin(ring.tiltZ);
    out[0] = x * cz - y * sz;
    out[1] = x * sz + y * cz;
    out[2] = z;
  }
  function seedDust(i, anywhere) {
    pos[i * 3] = bounds.x0 + Math.random() * (bounds.x1 - bounds.x0);
    pos[i * 3 + 1] = anywhere ? bounds.y0 + Math.random() * (bounds.y1 - bounds.y0) : bounds.y0 - .1;
    pos[i * 3 + 2] = (Math.random() - .5) * 1.6;
    vel[i * 3] = (Math.random() - .5) * .04;
    vel[i * 3 + 1] = .05 + Math.random() * .16;
    vel[i * 3 + 2] = 0;
  }

  const tmp = [0, 0, 0];
  for (let i = 0; i < N; i++) {
    stiff[i] = 9 + Math.random() * 16;
    if (kind[i] === KIND.halo) {
      const ring = Math.random();
      haloRing[i] = ring < .42 ? 0 : ring < .84 ? 1 : 2;
      haloAngle[i] = Math.random() * TAU;
      haloRadius[i] = haloRing[i] === 2 ? 1.12 + Math.random() * .06 : 1.3 + (haloRing[i] * .16) + (Math.random() - .5) * .05;
      haloSpeed[i] = (haloRing[i] === 1 ? -1 : 1) * (.16 + Math.random() * .1);
    }
  }

  // ---- GL ----
  function shader(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  }
  const program = gl.createProgram();
  gl.attachShader(program, shader(gl.VERTEX_SHADER, VERT));
  gl.attachShader(program, shader(gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
  gl.useProgram(program);
  const meta = new Float32Array(N * 2);
  for (let i = 0; i < N; i++) { meta[i * 2] = kind[i]; meta[i * 2 + 1] = seed[i]; }
  const metaBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, metaBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, meta, gl.STATIC_DRAW);
  const aMeta = gl.getAttribLocation(program, 'a_meta');
  gl.enableVertexAttribArray(aMeta);
  gl.vertexAttribPointer(aMeta, 2, gl.FLOAT, false, 0, 0);
  const dynBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, dynBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, dyn.byteLength, gl.DYNAMIC_DRAW);
  const aDyn = gl.getAttribLocation(program, 'a_dyn');
  gl.enableVertexAttribArray(aDyn);
  gl.vertexAttribPointer(aDyn, 4, gl.FLOAT, false, 0, 0);
  const U = {};
  for (const name of ['u_rot', 'u_center', 'u_res', 'u_radius', 'u_persp', 'u_size', 'u_time', 'u_flash', 'u_mode', 'u_fade', 'u_glint', 'u_glow']) U[name] = gl.getUniformLocation(program, name);
  gl.enable(gl.BLEND);
  gl.disable(gl.DEPTH_TEST);
  gl.uniform1f(U.u_persp, 3.6);

  const disc = gl.createProgram();
  gl.attachShader(disc, shader(gl.VERTEX_SHADER, DISC_VERT));
  gl.attachShader(disc, shader(gl.FRAGMENT_SHADER, DISC_FRAG));
  gl.linkProgram(disc);
  if (!gl.getProgramParameter(disc, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(disc));
  // 细分成 24×24 网格，倾斜时透视插值才不走样
  const GRID = 24;
  const grid = [];
  for (let gy = 0; gy < GRID; gy++) for (let gx = 0; gx < GRID; gx++) {
    const x0 = gx / GRID * 2.1 - 1.05, x1 = (gx + 1) / GRID * 2.1 - 1.05, y0 = gy / GRID * 2.1 - 1.05, y1 = (gy + 1) / GRID * 2.1 - 1.05;
    grid.push(x0, y0, x1, y0, x1, y1, x0, y0, x1, y1, x0, y1);
  }
  const discBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, discBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(grid), gl.STATIC_DRAW);
  const discCount = grid.length / 2;
  const aUv = gl.getAttribLocation(disc, 'a_uv');
  const D = {};
  for (const name of ['u_rot', 'u_center', 'u_res', 'u_radius', 'u_persp', 'u_glint', 'u_solid', 'u_fade', 'u_flash']) D[name] = gl.getUniformLocation(disc, name);
  gl.useProgram(disc);
  gl.uniform1f(D.u_persp, 3.6);
  gl.useProgram(program);

  // ---- 版面：画布铺满舞台，钱心与半径取自 anchor ----
  let width = 0, height = 0, cx = 0, cy = 0, radius = 200;
  function layout() {
    const box = canvas.getBoundingClientRect();
    const spot = anchor.getBoundingClientRect();
    width = Math.max(1, box.width);
    height = Math.max(1, box.height);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    gl.viewport(0, 0, canvas.width, canvas.height);
    cx = spot.left - box.left + spot.width / 2;
    cy = spot.top - box.top + spot.height / 2;
    radius = Math.max(60, Math.min(spot.width, spot.height) / 2 * .78);
    bounds = { x0: -cx / radius, x1: (width - cx) / radius, y0: -(height - cy) / radius, y1: cy / radius };
    gl.useProgram(disc);
    gl.uniform2f(D.u_res, canvas.width, canvas.height);
    gl.uniform2f(D.u_center, cx * dpr, cy * dpr);
    gl.uniform1f(D.u_radius, radius * dpr);
    gl.useProgram(program);
    gl.uniform2f(U.u_res, canvas.width, canvas.height);
    gl.uniform2f(U.u_center, cx * dpr, cy * dpr);
    gl.uniform1f(U.u_radius, radius * dpr);
    gl.uniform1f(U.u_size, dpr * Math.max(.75, Math.min(1.7, radius / 250)) * Math.sqrt(15000 / N) * 1.35);
  }

  // ---- 指针 / 交互状态 ----
  const pointer = { x: 0, y: 0, active: false, nx: 0, ny: 0, sx: 0, sy: 0 };
  let flash = 0, spin = 0, spinStart = -10, mode = 0, modeTarget = 0, formName = 'coin';
  let knockAt = -10, sweepFrom = 1.8;
  let glint = 9, nextTurn = 9, lastTouch = -10, ignited = false, solid = 0;
  let clock = 0, frame = 0, last = 0, visible = true, running = false, intro = !reduced.matches;
  let rot = new Float32Array(9);

  function rotation(yaw, pitch, roll) {
    const cy_ = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch), cr = Math.cos(roll), sr = Math.sin(roll);
    // R = Rz(roll) * Rx(pitch) * Ry(yaw)，按列主序写给 GL
    const m = [
      cr * cy_ - sr * sp * sy, sr * cy_ + cr * sp * sy, -cp * sy,
      -sr * cp, cr * cp, sp,
      cr * sy + sr * sp * cy_, sr * sy - cr * sp * cy_, cp * cy_,
    ];
    rot = new Float32Array(m);
    return rot;
  }
  // 屏幕点 → 钱身坐标（z=0 平面近似，用旋转矩阵的转置求逆）
  function toObject(px, py) {
    const wx = (px - cx) / radius;
    const wy = -(py - cy) / radius;
    return [rot[0] * wx + rot[1] * wy, rot[3] * wx + rot[4] * wy, rot[6] * wx + rot[7] * wy];
  }

  function placeAll(atTarget) {
    for (let i = 0; i < N; i++) {
      const k = kind[i];
      if (k === KIND.dust) { seedDust(i, true); continue; }
      if (k === KIND.halo) haloTarget(i, 0, tmp);
      else { tmp[0] = target[i * 3]; tmp[1] = target[i * 3 + 1]; tmp[2] = target[i * 3 + 2]; }
      if (atTarget) {
        pos[i * 3] = tmp[0]; pos[i * 3 + 1] = tmp[1]; pos[i * 3 + 2] = tmp[2];
        arrive[i] = 0;
      } else {
        // 开场：粮粒从舞台上方倾泻而下，按落点由低到高依次归位
        pos[i * 3] = tmp[0] * .35 + (Math.random() - .5) * 2.4;
        pos[i * 3 + 1] = bounds.y1 + .2 + Math.random() * 2.8;
        pos[i * 3 + 2] = (Math.random() - .5) * 1.2;
        vel[i * 3 + 1] = -1.5 - Math.random() * 2;
        arrive[i] = .1 + Math.random() * 1.15 + (1 - (tmp[1] + 1.4) / 2.8) * .45;
      }
    }
  }

  function step(dt) {
    clock += dt;
    const t = clock;
    flash *= Math.exp(-dt * 3.2);
    mode += (modeTarget - mode) * Math.min(1, dt * 4);
    // 指针平滑：钱身随指针轻微俯仰
    pointer.sx += ((pointer.active ? pointer.nx : 0) - pointer.sx) * Math.min(1, dt * 3);
    pointer.sy += ((pointer.active ? pointer.ny : 0) - pointer.sy) * Math.min(1, dt * 3);
    // 钱身翻转：开仓是快甩（ease-out），空闲时偶尔缓缓自转一周亮出钱缘厚度（ease-in-out）
    if (formName === 'coin' && !pointer.active && t > nextTurn && t - lastTouch > 4) {
      if (t - spinStart > 3.2) spinStart = t;
      nextTurn = t + 13 + Math.random() * 5;
    }
    const spinT = Math.min(1, (t - spinStart) / 3.2);
    const spinEase = spinT * spinT * (3 - 2 * spinT);
    spin = spinT >= 1 ? 0 : TAU * spinEase;
    // 高光：指针在场时追指针，否则每 6.5 秒扫过一次
    if (pointer.active) {
      glint += ((pointer.sx * .55 - pointer.sy * .83) * 1.5 - glint) * Math.min(1, dt * 5);
    } else {
      const phase = (t - sweepFrom) % 6.5;
      glint = phase > 0 && phase < 1.5 ? -1.5 + phase / 1.5 * 3 : 9;
    }
    // 钱身实体：钱形时显形（开场归位后才浮现），变形 / 开仓时隐去
    const solidTarget = formName === 'coin' && (!intro || t > 1.45) ? 1 : 0;
    solid += (solidTarget - solid) * Math.min(1, dt * (solidTarget > solid ? 1.6 : 7));
    // 开场归位完成的一瞬：点火闪光
    if (intro && !ignited && t > 1.75) { ignited = true; flash = Math.max(flash, .75); }
    const sway = formName === 'coin' ? .5 : .22;
    // 放粮时钱身被「敲」一下：向后一仰再回弹的阻尼振动
    const since = t - knockAt;
    const knock = since < 1.6 ? -.32 * Math.exp(-since * 4.5) * Math.cos(since * 13) : 0;
    rotation(Math.sin(t * .33) * sway + pointer.sx * .5 + spin, -pointer.sy * .32 + Math.sin(t * .27) * .07 + knock, Math.sin(t * .19) * .03);

    const hit = pointer.active ? toObject(pointer.x, pointer.y) : null;
    const reach = .34, reach2 = reach * reach;
    const damp = Math.exp(-dt * 4.2);
    for (let i = 0; i < N; i++) {
      const o = i * 3;
      const k = kind[i];
      let vx = vel[o], vy = vel[o + 1], vz = vel[o + 2];
      if (k === KIND.dust) {
        vx += Math.sin(t * .6 + seed[i] * 40) * .02 * dt;
        pos[o] += vx * dt; pos[o + 1] += vy * dt;
        vel[o] = vx;
        if (pos[o + 1] > bounds.y1 + .1) seedDust(i, false);
      } else {
        if (k === KIND.halo) {
          haloTarget(i, t, tmp);
          // 每条光环上有一颗彗头，身后拖一段渐暗的尾迹（借 dyn.w 通道提亮）
          const ringIndex = haloRing[i];
          const dir = ringIndex === 1 ? -1 : 1;
          const head = t * .9 * dir + ringIndex * 2.1;
          const behind = (((head - haloAngle[i] - t * haloSpeed[i]) * dir) % TAU + TAU) % TAU;
          comet[i] = Math.exp(-behind * 2.4) * 6;
        } else {
          const wob = .01 * Math.sin(t * 1.7 + seed[i] * 50);
          tmp[0] = target[o] + wob; tmp[1] = target[o + 1] + wob * .6; tmp[2] = target[o + 2];
        }
        const held = t < hold[i];
        if (held) {
          // 还在孔口候着：速度原样保留，位置不动
        } else if (t < arrive[i]) {
          vy -= 5.5 * dt;
        } else {
          const kk = stiff[i];
          let ax = (tmp[0] - pos[o]) * kk, ay = (tmp[1] - pos[o + 1]) * kk, az = (tmp[2] - pos[o + 2]) * kk;
          const am = Math.hypot(ax, ay, az);
          if (am > 60) { ax *= 60 / am; ay *= 60 / am; az *= 60 / am; }
          vx = vx * damp + ax * dt; vy = vy * damp + ay * dt; vz = vz * damp + az * dt;
        }
        if (hit && !held) {
          const dx = pos[o] - hit[0], dy = pos[o + 1] - hit[1];
          const d2 = dx * dx + dy * dy;
          if (d2 < reach2) {
            const d = Math.sqrt(d2) + 1e-4;
            const f = (1 - d / reach) ** 2 * 26 * dt;
            vx += (dx / d) * f - (dy / d) * f * .55;
            vy += (dy / d) * f + (dx / d) * f * .55;
            vz += f * (seed[i] - .3) * 1.2;
          }
        }
        if (!held) { pos[o] += vx * dt; pos[o + 1] += vy * dt; pos[o + 2] += vz * dt; }
        vel[o] = vx; vel[o + 1] = vy; vel[o + 2] = vz;
      }
      const d4 = i * 4;
      dyn[d4] = pos[o]; dyn[d4 + 1] = pos[o + 1]; dyn[d4 + 2] = pos[o + 2];
      dyn[d4 + 3] = Math.hypot(vx, vy, vz) + (k === KIND.halo ? comet[i] : 0);
    }
    if (intro && t > 2.4) intro = false;
  }

  function fadeForScroll() {
    const box = root.getBoundingClientRect();
    const gone = Math.min(1, Math.max(0, -box.top / Math.max(1, box.height)));
    return 1 - gone * .85;
  }

  function draw() {
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const fade = fadeForScroll();
    if (solid > .01) {
      gl.useProgram(disc);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.disableVertexAttribArray(aMeta);
      gl.disableVertexAttribArray(aDyn);
      gl.bindBuffer(gl.ARRAY_BUFFER, discBuffer);
      gl.enableVertexAttribArray(aUv);
      gl.vertexAttribPointer(aUv, 2, gl.FLOAT, false, 0, 0);
      gl.uniformMatrix3fv(D.u_rot, false, rot);
      gl.uniform1f(D.u_glint, glint);
      gl.uniform1f(D.u_solid, solid);
      gl.uniform1f(D.u_fade, fade);
      gl.uniform1f(D.u_flash, flash);
      gl.drawArrays(gl.TRIANGLES, 0, discCount);
      gl.disableVertexAttribArray(aUv);
      gl.useProgram(program);
    }
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.bindBuffer(gl.ARRAY_BUFFER, metaBuffer);
    gl.enableVertexAttribArray(aMeta);
    gl.vertexAttribPointer(aMeta, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, dynBuffer);
    gl.enableVertexAttribArray(aDyn);
    gl.vertexAttribPointer(aDyn, 4, gl.FLOAT, false, 0, 0);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, dyn);
    gl.uniformMatrix3fv(U.u_rot, false, rot);
    gl.uniform1f(U.u_time, clock);
    gl.uniform1f(U.u_flash, flash);
    gl.uniform1f(U.u_mode, mode);
    gl.uniform1f(U.u_fade, fade);
    gl.uniform1f(U.u_glint, glint);
    gl.uniform1f(U.u_glow, 1);
    gl.drawArrays(gl.POINTS, 0, nBody + nHalo);
    gl.uniform1f(U.u_glow, 0);
    gl.drawArrays(gl.POINTS, 0, N);
  }

  function tick(now) {
    frame = 0;
    if (!running) return;
    const dt = Math.min(.033, Math.max(.001, (now - (last || now)) / 1000));
    last = now;
    step(dt || .016);
    draw();
    frame = requestAnimationFrame(tick);
  }
  function start() {
    if (reduced.matches || running || !visible || document.hidden) return;
    running = true;
    last = 0;
    frame = requestAnimationFrame(tick);
  }
  function stop() {
    running = false;
    cancelAnimationFrame(frame);
    frame = 0;
  }
  function still() {
    // 静止单帧：直接摆好队形
    placeAll(true);
    for (let i = 0; i < N; i++) { const o = i * 3; dyn[i * 4] = pos[o]; dyn[i * 4 + 1] = pos[o + 1]; dyn[i * 4 + 2] = pos[o + 2]; dyn[i * 4 + 3] = 0; }
    rotation(-.32, -.08, 0);
    glint = .35;
    solid = formName === 'coin' ? 1 : 0;
    draw();
  }

  // ---- 对外：变形 / 开仓 ----
  function setForm(name) {
    const next = forms[name] ? name : 'coin';
    if (next === formName) return;
    formName = next;
    target = forms[next];
    modeTarget = next === 'coin' ? 0 : 1;
    if (reduced.matches) { still(); return; }
    // 变形时轻推一把，让粒子带着涡旋飞向新队形
    for (let i = 0; i < nBody; i++) {
      const o = i * 3;
      vel[o] += -pos[o + 1] * 1.4 + (Math.random() - .5) * .6;
      vel[o + 1] += pos[o] * 1.4 + (Math.random() - .5) * .6;
      vel[o + 2] += (Math.random() - .5) * 1.2;
    }
    flash = Math.max(flash, .35);
  }
  function burst() {
    if (reduced.matches || formName !== 'coin') return;
    // 开仓放粮：从郭与钱地里借一批粮粒，挪到方孔口，向上呈扇形喷出；落下后各自弹回原位
    for (let i = nChar; i < nBody; i++) {
      if (Math.random() > .55) continue;
      const o = i * 3;
      pos[o] = (Math.random() - .5) * .22;
      pos[o + 1] = (Math.random() - .5) * .22;
      pos[o + 2] = .08;
      const angle = Math.PI / 2 + (Math.random() - .5) * .85;
      const speed = 2.5 + Math.random() * 1.4;
      vel[o] = Math.cos(angle) * speed;
      vel[o + 1] = Math.sin(angle) * speed;
      vel[o + 2] = .15 + Math.random() * .6;
      // 错开升空：前后约 0.4 秒陆续从孔口喷出，连成一道粮柱而不是一次炸开
      hold[i] = clock + Math.random() * .4;
      arrive[i] = hold[i] + .95 + Math.random() * .8;
    }
    // 钱文一颤，光环外扩一圈
    for (let i = 0; i < N; i++) {
      const k = kind[i];
      if (k === KIND.dust) continue;
      const o = i * 3;
      if (k === KIND.halo) { vel[o] += pos[o] * .9; vel[o + 1] += pos[o + 1] * .9; continue; }
      if (k === KIND.char) vel[o + 2] += (Math.random() - .3) * .9;
    }
    flash = Math.max(flash, .55);
    knockAt = clock;
    sweepFrom = clock;
  }

  // ---- 事件 ----
  const events = new AbortController();
  const on = { signal: events.signal };
  const stage = root;
  stage.addEventListener('pointermove', event => {
    const box = canvas.getBoundingClientRect();
    pointer.x = event.clientX - box.left;
    pointer.y = event.clientY - box.top;
    pointer.nx = Math.max(-1, Math.min(1, (pointer.x - cx) / (radius * 2.2)));
    pointer.ny = Math.max(-1, Math.min(1, (pointer.y - cy) / (radius * 2.2)));
    pointer.active = event.pointerType === 'mouse' || event.pressure > 0;
    lastTouch = clock;
  }, { ...on, passive: true });
  stage.addEventListener('pointerleave', () => { pointer.active = false; }, on);
  canvas.addEventListener('pointerdown', burst, on);
  const io = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    if (visible) start(); else stop();
  });
  io.observe(root);
  const sizing = new ResizeObserver(() => { layout(); if (!running) still(); });
  sizing.observe(root);
  document.addEventListener('visibilitychange', () => (document.hidden ? stop() : start()), on);
  reduced.addEventListener('change', () => { if (reduced.matches) { stop(); still(); } else start(); }, on);

  layout();
  if (reduced.matches) still();
  else { placeAll(false); start(); }
  root.setAttribute('data-coin', 'on');

  return {
    setForm,
    burst,
    release() {
      stop();
      events.abort();
      io.disconnect();
      sizing.disconnect();
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    },
  };
}
