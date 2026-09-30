/* 观星台页头 · 星海装饰层（粒子太极）
   依据：frontend-spec.md §4.4 / §11.1（2026-09-20 用户拍板：甲形态 + 极 5000 + 联动开）。
   试作来源：cache-tools/design-lab/observatory-taiji-v1.html（本机对照，不发布）。

   纪律（§10.1 / §10.2 / §11.1）：
   ① canvas 只画形状、零数据，aria-hidden；
   ② 强度只从 CSS 变量读（--sea-count / --sea-motion），皮肤档只改变量、不改 DOM；
   ③ prefers-reduced-motion、离屏、切后台一律不跑循环（只画一帧静止等价物）；
   ④ DPR 上限 1.5；窄屏 / 触屏按设备分档降级；
   ⑤ 太极只绑已有交互：周 / 月切换 = 两仪互易（转半圈），不新增状态位；
   ⑥ 切榜爆散（2026-09-24 用户定：参考 `interactive-taiji-particle-animation` 的「先打散再聚合」）：
      每颗粒子按自己的幅度沿径向炸开（掺一点切向旋），包络与转半圈同长（1.2s）、
      起于 0 终于 0——散开与聚合都是确定性的，收束时精确回到太极原位。 */

const TAU = Math.PI * 2;
const HEAD_K = 0.5; /* 鱼头圆心距 = R × 0.5 */
const EYE_K = 0.095; /* 鱼眼半径 = R × 0.095 */
const SIZE_K = 1.45; /* 更细的粒径，用密度而非大光点塑形。 */
const SPIN_DUR = 1200; /* 两仪互易时长（ms）；爆散包络同长 */
const BURST_SWIRL = 0.25; /* 爆散切向分量：散开时整体带一点旋（参考稿量级） */
const SPREAD_K = 0.04; /* 静置散布：--sea-spread = 1 时每颗最远散到 0.04R（见 site.css 调参台） */
const GOLD = '#e8b73a';
const CYAN = '#3fd9c0';

const ROLE = {
  rim: { r: [0.7, 1.02], a: [0.76, 0.96], w: 0.35 },
  rim2: { r: [0.48, 0.76], a: [0.46, 0.68], w: 0.55 },
  seam: { r: [0.58, 0.88], a: [0.64, 0.94], w: 0.5 },
  eye: { r: [0.68, 0.96], a: [0.86, 1], w: 0.2 },
  body: { r: [0.46, 0.82], a: [0.22, 0.52], w: 1.1 },
};

/* 点是否落在「阳」半（金区）：上鱼头黑（留白眼）、下鱼头白（留黑眼）、其余按 S 分左右 */
function inWhite(x, y, R) {
  if (x * x + y * y > R * R) return false;
  const h = R * HEAD_K;
  const e = R * EYE_K;
  const du = x * x + (y - h) * (y - h);
  const dd = x * x + (y + h) * (y + h);
  if (du < h * h) return du < e * e;
  if (dd < h * h) return dd > e * e;
  return x >= 0;
}

/* 外圈 22% / S 分界 18% / 鱼眼 5% / 鱼身 55%；外沿分段随机落点，避免轮廓出现大缺口。 */
function rimPoint(R, ring, index, count) {
  const t = (index + Math.random()) / count * TAU;
  const rr = R * (ring === 2 ? 0.952 + 0.022 * Math.random() : 1 - 0.006 * Math.random());
  const x = Math.cos(t) * rr;
  return { x, y: Math.sin(t) * rr, white: x >= 0, role: ring === 2 ? 'rim2' : 'rim' };
}

/* S 分界：上鱼头圆的右半 + 下鱼头圆的左半，两色各贴一侧（各留 1.2%–2.4% R 的偏移）
   极点收尖：极点固定对应 u=+π/2，只在这一端让出 SEAM_PAD，圆心交点必须接满；
   tp = 离极点弧长 / 0.3R（截断），只用来给极点收稀收尖 */
const SEAM_PAD = 0.05;

function seamPoint(R) {
  let upper;
  let u;
  let k;
  for (let i = 0; i < 40; i++) {
    upper = Math.random() < 0.5;
    u = -Math.PI / 2 + Math.random() * (Math.PI - SEAM_PAD);
    k = Math.min(1, (Math.PI / 2 - u) / 0.6);
    if (Math.random() < 0.28 + 0.72 * k) break;
  }
  const sign = upper ? 1 : -1;
  const t = sign > 0 ? u : -u;
  const rr = (R / 2) * (1 - 0.005 * Math.random());
  const px = Math.cos(t) * rr * sign;
  const py = sign * R * HEAD_K + Math.sin(t) * rr;
  const off = (Math.random() < 0.5 ? 1 : -1) * R * (0.012 + 0.012 * Math.random()) * (0.3 + 0.7 * k);
  return {
    x: px + Math.cos(t) * sign * off,
    y: py + Math.sin(t) * off,
    white: off > 0 === upper,
    role: 'seam',
    tp: k,
  };
}

function eyePoint(R, white, index, count) {
  // 两眼各自定额，眼缘每个角度区间都有光点；内部按螺旋铺开，保留少量随机扰动。
  const rimCount = Math.ceil(count * 0.65);
  const onRim = index < rimCount;
  const interiorIndex = index - rimCount;
  const a = onRim
    ? (index + 0.25 + Math.random() * 0.5) / rimCount * TAU
    : interiorIndex * Math.PI * (3 - Math.sqrt(5)) + Math.random() * 0.15;
  const d = (onRim
    ? 0.96 + Math.random() * 0.04
    : Math.sqrt((interiorIndex + 0.5) / (count - rimCount)) * 0.88) * R * EYE_K;
  return {
    x: Math.cos(a) * d,
    y: (white ? 1 : -1) * R * HEAD_K + Math.sin(a) * d,
    white,
    role: 'eye',
  };
}

/* 鱼身：越靠鱼头越密越亮、越靠鱼尾越稀越小 */
function bodyPoint(R, wantWhite) {
  const hy = (wantWhite ? -1 : 1) * R * HEAD_K;
  for (let i = 0; i < 900; i++) {
    const a = Math.random() * TAU;
    const d = Math.sqrt(Math.random()) * R * 0.985;
    const x = Math.cos(a) * d;
    const y = Math.sin(a) * d;
    if (inWhite(x, y, R) !== wantWhite) continue;
    const dh = Math.hypot(x, y - hy) / R;
    if (Math.random() > Math.max(0.18, 1.12 - dh)) continue;
    return { x, y, white: wantWhite, role: 'body', dh };
  }
  return { x: 0, y: hy, white: wantWhite, role: 'body', dh: 0 };
}

function easeInOut(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

class StarField {
  constructor(canvas, host, opts) {
    this.canvas = canvas;
    this.host = host;
    this.ctx = canvas.getContext('2d');
    this.opts = opts;
    this.count = opts.count;
    this.ptr = { on: false, x: 0, y: 0 };
    this.parts = [];
    this.spin = 0;
    this.spinFrom = 0;
    this.spinTo = 0;
    this.spinT = 1;
    this.flipDir = 1; /* 最近一次互易方向：爆散旋向跟它走 */
    this.burstT = 1; /* 爆散包络进度（0→1），1 = 静止 */
    this.burstEnv = 0; /* 当前包络值（0..1）；名字避开 burst() 方法，实例属性会盖住原型方法 */
    this.burstPow = 1; /* 幅度倍率（1 = 参考稿量级） */
    this.burstDir = 1;
    this.frame = 0;
    this.running = false;
    this.visible = false;
    this.motion = opts.motion;
    this.padY = opts.padY || 0;
    this.sizeK = opts.size || 1; /* 粒子尺寸倍率（调参台 --sea-size，可热改） */
    this.dead = false; /* destroy 后拒绝调参重读，免得把粒子重新摆回来 */
    /* 调参台缺省值兜底（opts 由 mount 从 CSS 变量读出；变量缺失时与 site.css 的默认同值） */
    if (opts.damp == null) opts.damp = 0.9;
    if (opts.burst == null) opts.burst = 0.85;
    if (opts.spread == null) opts.spread = 1;

    this.ro = new ResizeObserver(() => {
      clearTimeout(this.rt);
      this.rt = setTimeout(() => this.resize(), 140);
    });
    this.ro.observe(canvas);
    this.resize();
  }

  resize() {
    const o = this.opts;
    const mobile = window.matchMedia('(max-width: 760px)').matches;
    const cfg = mobile ? { ...o, ...o.mobile } : o;
    const rect = this.canvas.getBoundingClientRect();
    const w = Math.max(140, Math.round(rect.width));
    const h = Math.max(140, Math.round(rect.height));
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    this.W = w;
    this.H = h;
    this.dpr = dpr;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    /* 画布上下各溢出 --sea-pad（CSS 同步放大画布盒），太极尺寸仍按页头带本体算
       （h - 2×pad），换来的余量给旋转滞回与爆散外冲用——不再被页头带边缘裁掉。 */
    this.R = Math.min(w, h - 2 * this.padY) * cfg.fit;
    this.cx = w * cfg.cx;
    this.cy = h * cfg.cy;
    this.seed();
    this.paint(0);
  }

  seed() {
    const { R, cx, cy, count } = this;
    const parts = [];
    const nOuterRim = Math.round(count * 0.14);
    const nInnerRim = Math.round(count * 0.08);
    const nSeam = Math.round(count * 0.18);
    const nEye = Math.round(count * 0.05);
    const nGoldEye = Math.floor(nEye / 2);
    const nCyanEye = nEye - nGoldEye;
    const nBody = Math.max(0, count - nOuterRim - nInnerRim - nSeam - nEye);

    const push = (sp) => {
      const t = ROLE[sp.role];
      const grow = sp.role === 'body' ? Math.max(0.6, 1.35 - 0.55 * sp.dh) : 1;
      const tipK = sp.tp == null ? 1 : sp.tp;
      const tipG = 0.58 + 0.42 * tipK;
      const r0 = (t.r[0] + Math.random() * (t.r[1] - t.r[0])) * grow * tipG;
      /* 爆散方向 = 原位径向（参考稿）；原位在圆心上的概率极低，兜底给随机角 */
      const d0 = Math.hypot(sp.x, sp.y);
      let ux;
      let uy;
      if (d0 > 0.001) {
        ux = sp.x / d0;
        uy = sp.y / d0;
      } else {
        const a0 = Math.random() * TAU;
        ux = Math.cos(a0);
        uy = Math.sin(a0);
      }
      /* 静置散布方向（调参台 --sea-spread 的乘子；固定随机，逐帧只乘系数、不重排） */
      const sA = Math.random() * TAU;
      const spreadK = sp.role === 'eye' ? 0.15 : sp.role === 'rim' ? 0.4 : 1;
      const sD = Math.pow(Math.random(), 1.5) * spreadK;
      parts.push({
        role: sp.role,
        bx: sp.x,
        by: sp.y,
        x: cx + sp.x,
        y: cy + sp.y,
        vx: 0,
        vy: 0,
        lobe: sp.white ? 0 : 1,
        r0,
        r: r0 * SIZE_K * this.sizeK,
        a: (t.a[0] + Math.random() * (t.a[1] - t.a[0])) * (0.7 + 0.3 * tipK) *
          (sp.role === 'body' ? Math.max(.48, 1.2 - sp.dh * .4) : 1),
        ph: Math.random() * TAU,
        sp: 0.5 + Math.random() * 0.9,
        wob: t.w,
        ux,
        uy,
        /* 爆散幅度：多数粒子小、少数飞得远，外圈再多一点（参考稿 bk） */
        bk: (0.07 + 0.34 * Math.pow(Math.random(), 1.4) + (d0 > R * 0.9 ? 0.06 : 0)) *
          (sp.role === 'eye' || (sp.role === 'seam' && parts.length % 3 === 0) ||
            (sp.role === 'rim' && parts.length % 3 === 0) ? .12 : 1),
        sox: Math.cos(sA) * sD,
        soy: Math.sin(sA) * sD,
        ox: 0,
        oy: 0,
      });
    };

    for (let i = 0; i < nOuterRim; i++) push(rimPoint(R, 1, i, nOuterRim));
    for (let i = 0; i < nInnerRim; i++) push(rimPoint(R, 2, i, nInnerRim));
    for (let i = 0; i < nSeam; i++) push(seamPoint(R));
    for (let i = 0; i < nGoldEye; i++) push(eyePoint(R, true, i, nGoldEye));
    for (let i = 0; i < nCyanEye; i++) push(eyePoint(R, false, i, nCyanEye));
    for (let i = 0; i < nBody; i++) push(bodyPoint(R, Math.random() < 0.5));

    /* 轮廓族挑 1/12 做辉光（`lighter`），鱼身不发光——形状才读得出来 */
    let k = 0;
    for (const p of parts) {
      if (p.role !== 'body' && k++ % 12 === 0) p.hero = true;
    }
    this.parts = parts;
  }

  step(dt) {
    if (this.spinT < 1) {
      this.spinT = Math.min(1, this.spinT + dt / SPIN_DUR);
      this.spin = this.spinFrom + (this.spinTo - this.spinFrom) * easeInOut(this.spinT);
    }
    /* 爆散包络（先打散再聚合）：与转半圈同长，起止都归 0（参考稿 sin(π p^0.7)² ） */
    if (this.burstT < 1) {
      this.burstT = Math.min(1, this.burstT + dt / SPIN_DUR);
      const s = Math.sin(Math.PI * Math.pow(this.burstT, 0.7));
      this.burstEnv = s * s;
    } else if (this.burstEnv !== 0) {
      this.burstEnv = 0;
    }
    const cos = Math.cos(this.spin);
    const sin = Math.sin(this.spin);
    const { cx, cy, parts } = this;
    const infl = Math.max(70, this.R * this.opts.influence);
    const step = Math.max(0.25, dt / 16.7);
    const bs = this.burstEnv * this.R * this.burstPow;
    const swirl = BURST_SWIRL * this.burstDir;
    const spreadPx = (this.opts.spread || 0) * this.R * SPREAD_K; /* 静置散布（热改即生效） */

    for (const p of parts) {
      p.ph += 0.0022 * p.sp * dt;
      const bx = p.bx + Math.cos(p.ph) * p.wob + p.sox * spreadPx;
      const by = p.by + Math.sin(p.ph * 1.27) * p.wob + p.soy * spreadPx;
      const tx = cx + bx * cos - by * sin;
      const ty = cy + bx * sin + by * cos;
      /* 爆散偏移是画位上的世界系加量（物理仍围绕原位跑，收束即精确归位） */
      if (bs > 0) {
        const b = bs * p.bk;
        const lx = p.ux * b - p.uy * b * swirl;
        const ly = p.uy * b + p.ux * b * swirl;
        p.ox = lx * cos - ly * sin;
        p.oy = lx * sin + ly * cos;
      } else {
        p.ox = 0;
        p.oy = 0;
      }
      if (dt === 0) {
        p.x = tx;
        p.y = ty;
        p.vx = 0;
        p.vy = 0;
        continue;
      }
      p.vx += (tx - p.x) * this.opts.k;
      p.vy += (ty - p.y) * this.opts.k;
      if (this.ptr.on) {
        const dx = p.x - this.ptr.x;
        const dy = p.y - this.ptr.y;
        const d = Math.hypot(dx, dy) || 1;
        if (d < infl) {
          const f = (1 - d / infl) * this.opts.push * step * (this.attract ? -1 : 1);
          p.vx += (dx / d) * f;
          p.vy += (dy / d) * f;
        }
      }
      p.vx *= this.opts.damp;
      p.vy *= this.opts.damp;
      p.x += p.vx;
      p.y += p.vy;
    }
  }

  paint(dt) {
    this.step(dt);
    const { ctx, W, H, R, cx, cy } = this;
    ctx.clearRect(0, 0, W, H);

    const glow = ctx.createRadialGradient(cx, cy, R * 0.15, cx, cy, R * 1.35);
    glow.addColorStop(0, 'rgba(232,183,58,.055)');
    glow.addColorStop(0.5, 'rgba(63,217,192,.03)');
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(cx, cy, R * 1.35, 0, TAU);
    ctx.fill();

    const buckets = Array.from({ length: 2 }, () => Array.from({ length: 6 }, () => []));
    const heroes = [];
    /* 顺带量一下里画布边最近的一颗：太近才上边缘软收（4 条渐隐带），远处不花这份钱 */
    const edge = Math.max(10, this.padY * 0.7);
    let nearEdge = Infinity;
    for (const p of this.parts) {
      buckets[p.lobe][Math.min(5, Math.floor(p.a * 6))].push(p);
      if (p.hero) heroes.push(p);
      const x = p.x + p.ox;
      const y = p.y + p.oy;
      const d = Math.min(x, W - x, y, H - y);
      if (d < nearEdge) nearEdge = d;
    }
    const cols = [GOLD, CYAN];
    const alphas = [.12, .24, .39, .55, .71, .86];
    const burstFade = 1 - 0.25 * this.burstEnv; /* 炸开时整片略淡（参考稿口径） */
    for (let lobe = 0; lobe < 2; lobe++) {
      for (let t = 0; t < 6; t++) {
        const arr = buckets[lobe][t];
        if (!arr.length) continue;
        ctx.globalAlpha = alphas[t] * burstFade;
        ctx.fillStyle = cols[lobe];
        ctx.beginPath();
        for (const p of arr) {
          ctx.moveTo(p.x + p.ox + p.r, p.y + p.oy);
          ctx.arc(p.x + p.ox, p.y + p.oy, p.r, 0, TAU);
        }
        ctx.fill();
      }
    }
    ctx.globalCompositeOperation = 'lighter';
    for (const p of heroes) {
      ctx.globalAlpha = 0.065 * burstFade;
      ctx.fillStyle = cols[p.lobe];
      ctx.beginPath();
      ctx.arc(p.x + p.ox, p.y + p.oy, p.r * 2.7, 0, TAU);
      ctx.fill();
    }
    /* 画布边缘软收（2026-09-24 用户反馈「放大最大时超出边界」）：
       外冲到画布边的粒子在这里柔和消失，不出硬切；渐隐带 = 0.7×pad（pad 调大即离边更远）。
       只在真有粒子贴近边时开（destination-out 擦掉四边一条渐隐带的 alpha），静止时零开销。 */
    if (nearEdge < edge) {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.globalAlpha = 1;
      const bands = [
        [0, 0, W, edge, 0, 0, 0, edge],
        [0, H - edge, W, edge, 0, H, 0, H - edge],
        [0, 0, edge, H, 0, 0, edge, 0],
        [W - edge, 0, edge, H, W, 0, W - edge, 0],
      ];
      for (const [bx, by, bw, bh, gx0, gy0, gx1, gy1] of bands) {
        const g = ctx.createLinearGradient(gx0, gy0, gx1, gy1);
        g.addColorStop(0, 'rgba(0,0,0,1)');
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.fillRect(bx, by, bw, bh);
      }
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }

  start() {
    if (this.running || !this.motion || this.reduced) {
      this.paint(0);
      return;
    }
    this.running = true;
    let last = performance.now();
    const loop = (now) => {
      if (!this.running) return;
      const dt = Math.min(48, Math.max(4, now - last));
      last = now;
      this.paint(dt);
      this.frame = requestAnimationFrame(loop);
    };
    this.frame = requestAnimationFrame(loop);
  }

  stop() {
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.running = false;
    this.paint(0);
  }

  flip(direction = 1) {
    /* 两仪互易：按目标榜位定方向（2026-09-23 用户定）——周榜 = 逆时针、月榜 = 顺时针，
       与同页星历拨盘的双向转动（pos 0↔1 来回）一致。 */
    this.flipDir = direction < 0 ? -1 : 1;
    this.spinFrom = this.spin;
    this.spinTo = direction > 0 ? Math.PI : 0;
    this.spinT = 0;
    if (!this.running) {
      this.spinT = 1;
      this.spin = this.spinTo;
      this.burstT = 1;
      this.burstEnv = 0;
      this.paint(0);
    }
  }

  /* 切榜爆散（2026-09-24）：确定性包络，散开—聚合都回到太极原位，旋向跟互易方向；
     缺省幅度取调参台的 --sea-burst（1 = 参考稿量级）。只跑循环时演（静止单帧不演）。 */
  burst(power) {
    if (!this.running) return;
    this.burstPow = power == null ? this.opts.burst : power; /* 0 = 关掉爆散（调参台 --sea-burst: 0） */
    this.burstDir = this.flipDir;
    this.burstT = 0;
  }

  /* 调参台重读（mount 每 0.5s 调一次；site.css 见 [data-star-sea] 那组变量）：
     count / fit / padY 变了要重摆（走 resize，等价 resize + re-seed）；
     spread / size / burst / damp / motion 是纯系数或开关，下一帧就生效。返回是否有变化。 */
  applyKnobs(k, force = false) {
    if (this.dead) return false;
    const o = this.opts;
    const relayout = force || k.count !== o.count || k.fit !== o.fit || k.padY !== o.padY;
    const changed =
      relayout ||
      k.spread !== o.spread ||
      k.size !== o.size ||
      k.burst !== o.burst ||
      k.damp !== o.damp ||
      k.motion !== o.motion;
    if (!changed) return false;
    o.count = k.count;
    o.fit = k.fit;
    o.padY = k.padY;
    o.spread = k.spread;
    o.burst = k.burst;
    o.damp = k.damp;
    o.motion = k.motion;
    /* 这几个在构造函数里各存了一份实例字段（seed / resize / start 读的是字段），一并跟上 */
    this.count = k.count;
    this.padY = k.padY;
    this.motion = k.motion;
    if (relayout) this.resize(); /* resize 内含 seed + paint(0) */
    if (k.size !== this.sizeK) {
      this.sizeK = k.size;
      for (const p of this.parts) p.r = p.r0 * SIZE_K * k.size;
    }
    if (!o.motion) this.stop(); /* 皮肤档把动关掉：回到静止单帧 */
    else if (this.visible && !this.running) this.start();
    else if (!this.running) this.paint(0);
    return true;
  }

  destroy() {
    this.dead = true;
    clearTimeout(this.rt);
    this.stop();
    this.ro.disconnect();
    this.parts = [];
  }
}

/* 设备分档：粒子数取「皮肤档变量」与「设备上限」的较小值（§11.1 降级 ⑥） */
function deviceCap() {
  if (window.innerWidth < 760) return 700;
  if (window.innerWidth < 1180 || !window.matchMedia('(pointer: fine)').matches) return 2000;
  return 5000;
}

export function mount() {
  const host = document.querySelector('[data-star-sea]');
  const canvas = host?.querySelector('[data-star-sea-canvas]');
  if (!host || !canvas?.getContext) return { release() {} };
  /* 画布被 CSS 关掉（窄屏 / 未启用装饰）时不起引擎——可见性由 CSS 决定 */
  if (!canvas.offsetWidth || !canvas.offsetHeight) {
    host.dataset.totem = 'off';
    return { release() {} };
  }

  /* 星海调参台（site.css [data-star-sea]）：引擎只读这组变量，皮肤档只改变量、JS 不判档（§10.1 约束 #5）。
     读一次 + 每 0.5s 重读（见下面的 tuneTimer）——devtools 里改完 ≤0.5s 见效，不用刷新。 */
  const readKnobs = () => {
    const style = getComputedStyle(host);
    const num = (name, fallback) => {
      const v = Number.parseFloat(style.getPropertyValue(name));
      return Number.isFinite(v) ? v : fallback;
    };
    const want = Number.parseInt(style.getPropertyValue('--sea-count'), 10);
    return {
      count: Math.min(Number.isFinite(want) ? want : deviceCap(), deviceCap()),
      fit: num('--sea-fit', 0.46),
      spread: num('--sea-spread', 1),
      damp: num('--sea-damp', 0.9),
      size: num('--sea-size', 1),
      burst: num('--sea-burst', 0.85),
      padY: num('--sea-pad', 0), /* 上下溢出余量：只放宽粒子活动范围，太极尺寸不变 */
      motion: style.getPropertyValue('--sea-motion').trim() !== '0',
    };
  };
  const knobs = readKnobs();

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  /* 三页图腾落位统一（2026-09-22）：星海铺满页头带，但太极中心对齐右侧器物位中心。
     器物位宽度只有一支来源（site.css :root --totem-plate），这里用组件里的探针量它，
     器物位改宽度时星海自动跟着走；量不到（老结构 / 变量缺失）就回落到原来的 0.71。 */
  const probe = host.querySelector('[data-plate-probe]');
  const bandW = host.getBoundingClientRect().width;
  const plateW = probe ? probe.getBoundingClientRect().width : 0;
  const cx = bandW > 0 && plateW > 0 && plateW < bandW ? 1 - plateW / (2 * bandW) : 0.71;
  const field = new StarField(canvas, host, {
    count: knobs.count,
    motion: knobs.motion,
    padY: knobs.padY,
    fit: knobs.fit,
    spread: knobs.spread,
    damp: knobs.damp,
    size: knobs.size,
    burst: knobs.burst,
    cx,
    cy: 0.5,
    push: 0.45,
    influence: 0.42,
    k: 0.019,
    attract: false,
    host,
    mobile: { fit: 0.3, cx: 0.5, cy: 0.66 },
  });

  const onPointerMove = (event) => {
    if (event.pointerType === 'touch' || !field.motion) return;
    const rect = canvas.getBoundingClientRect();
    field.ptr.x = event.clientX - rect.left;
    field.ptr.y = event.clientY - rect.top;
    field.ptr.on = true;
    if (!field.running) field.paint(0);
  };
  const onPointerLeave = () => {
    field.ptr.on = false;
    if (!field.running) field.paint(0);
  };

  // 与星历盘共用榜单状态；重复点击不重播，打断时从当前角度转向明确榜位。
  const toggleRoot = document.querySelector('[data-instrument][data-kind="sky"]')?.closest('[data-toggle]');
  let current = toggleRoot?.dataset.toggleCurrent || 'week';
  field.spin = field.spinFrom = field.spinTo = current === 'month' ? Math.PI : 0;
  field.paint(0);
  const onToggle = () => {
    const next = toggleRoot?.dataset.toggleCurrent;
    if (!['week', 'month'].includes(next) || next === current) return;
    current = next;
    field.flip(next === 'month' ? 1 : -1);
    field.burst();
  };
  const toggleObserver = new MutationObserver(onToggle);
  if (toggleRoot) toggleObserver.observe(toggleRoot, { attributes: true, attributeFilter: ['data-toggle-current'] });

  let io = null;
  if ('IntersectionObserver' in window) {
    io = new IntersectionObserver(
      (entries) => {
        field.visible = entries[0].isIntersecting;
        if (field.visible) field.start();
        else field.stop();
      },
      { threshold: 0.02 }
    );
    io.observe(canvas);
  } else {
    field.visible = true;
    field.start();
  }

  const onVisibility = () => (document.hidden ? field.stop() : field.visible && field.start());
  const onReduced = () => {
    field.reduced = reduced.matches;
    if (reduced.matches) field.stop();
    else field.start();
  };

  field.reduced = reduced.matches;
  host.addEventListener('pointermove', onPointerMove);
  host.addEventListener('pointerleave', onPointerLeave);
  document.addEventListener('visibilitychange', onVisibility);
  reduced.addEventListener?.('change', onReduced);
  if (!reduced.matches && field.visible) field.start();
  /* 调参台轮询：改 CSS 变量（devtools / site.css）≤0.5s 落到引擎；后台标签不读、无变化不重画 */
  const tuneTimer = setInterval(() => {
    if (!document.hidden) field.applyKnobs(readKnobs());
  }, 500);
  /* 引擎已绘出（首帧已画）：让页面收掉图腾区的 CSS 加载态（site.css「图腾区加载态」） */
  host.dataset.totem = 'ready';

  return {
    release() {
      clearInterval(tuneTimer);
      io?.disconnect();
      toggleObserver.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      reduced.removeEventListener?.('change', onReduced);
      host.removeEventListener('pointermove', onPointerMove);
      host.removeEventListener('pointerleave', onPointerLeave);
      field.destroy();
    },
  };
}

export default mount;
