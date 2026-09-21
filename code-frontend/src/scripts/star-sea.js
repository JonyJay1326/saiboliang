/* 观星台页头 · 星海装饰层（粒子太极）
   依据：frontend-spec.md §4.4 / §11.1（2026-09-20 用户拍板：甲形态 + 极 5000 + 联动开）。
   试作来源：cache-tools/design-lab/observatory-taiji-v1.html（本机对照，不发布）。

   纪律（§10.1 / §10.2 / §11.1）：
   ① canvas 只画形状、零数据，aria-hidden；
   ② 强度只从 CSS 变量读（--sea-count / --sea-motion），皮肤档只改变量、不改 DOM；
   ③ prefers-reduced-motion、离屏、切后台一律不跑循环（只画一帧静止等价物）；
   ④ DPR 上限 1.5；窄屏 / 触屏按设备分档降级；
   ⑤ 太极只绑已有交互：周 / 月切换 = 两仪互易（转半圈），不新增状态位。 */

const TAU = Math.PI * 2;
const HEAD_K = 0.5; /* 鱼头圆心距 = R × 0.5 */
const EYE_K = 0.095; /* 鱼眼半径 = R × 0.095 */
const SIZE_K = 1.6; /* 粒子尺寸（2026-09-20 定稿） */
const GOLD = '#e8b73a';
const CYAN = '#3fd9c0';

const ROLE = {
  rim: { r: [0.72, 0.95], a: [0.5, 0.62], w: 0.9 },
  rim2: { r: [0.64, 0.86], a: [0.4, 0.52], w: 0.9 },
  seam: { r: [0.8, 1.05], a: [0.72, 0.98], w: 0.8 },
  eye: { r: [0.8, 1.05], a: [0.7, 0.95], w: 0.6 },
  body: { r: [0.55, 0.9], a: [0.16, 0.34], w: 1.6 },
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

/* 采样五族：外圈 34%（两层各 17%）/ S 分界 23% / 鱼眼 8% / 鱼身 35% */
function rimPoint(R, ring) {
  const t = Math.random() * TAU;
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

function eyePoint(R) {
  const white = Math.random() < 0.5;
  const a = Math.random() * TAU;
  const d = Math.sqrt(Math.random()) * R * EYE_K;
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
    this.turns = 0;
    this.frame = 0;
    this.running = false;
    this.visible = false;
    this.motion = opts.motion;

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
    this.R = Math.min(w, h) * cfg.fit;
    this.cx = w * cfg.cx;
    this.cy = h * cfg.cy;
    this.seed();
    this.paint(0);
  }

  seed() {
    const { R, cx, cy, count } = this;
    const parts = [];
    const nRim = Math.round(count * 0.17);
    const nSeam = Math.round(count * 0.23);
    const nEye = Math.round(count * 0.08);
    const nBody = Math.max(0, count - nRim * 2 - nSeam - nEye);

    const push = (sp) => {
      const t = ROLE[sp.role];
      const grow = sp.role === 'body' ? Math.max(0.6, 1.35 - 0.55 * sp.dh) : 1;
      const tipK = sp.tp == null ? 1 : sp.tp;
      const tipG = 0.58 + 0.42 * tipK;
      const r0 = (t.r[0] + Math.random() * (t.r[1] - t.r[0])) * grow * tipG;
      parts.push({
        bx: sp.x,
        by: sp.y,
        x: cx + sp.x,
        y: cy + sp.y,
        vx: 0,
        vy: 0,
        lobe: sp.white ? 0 : 1,
        r: r0 * SIZE_K,
        a: (t.a[0] + Math.random() * (t.a[1] - t.a[0])) * (0.7 + 0.3 * tipK),
        ph: Math.random() * TAU,
        sp: 0.5 + Math.random() * 0.9,
        wob: t.w,
      });
    };

    for (let i = 0; i < nRim; i++) push(rimPoint(R, 1));
    for (let i = 0; i < nRim; i++) push(rimPoint(R, 2));
    for (let i = 0; i < nSeam; i++) push(seamPoint(R));
    for (let i = 0; i < nEye; i++) push(eyePoint(R));
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
      this.spinT = Math.min(1, this.spinT + dt / 1200);
      this.spin = this.spinFrom + (this.spinTo - this.spinFrom) * easeInOut(this.spinT);
    }
    const cos = Math.cos(this.spin);
    const sin = Math.sin(this.spin);
    const { cx, cy, parts } = this;
    const infl = Math.max(70, this.R * this.opts.influence);
    const step = Math.max(0.25, dt / 16.7);

    for (const p of parts) {
      p.ph += 0.0022 * p.sp * dt;
      const bx = p.bx + Math.cos(p.ph) * p.wob;
      const by = p.by + Math.sin(p.ph * 1.27) * p.wob;
      const tx = cx + bx * cos - by * sin;
      const ty = cy + bx * sin + by * cos;
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
      p.vx *= 0.9;
      p.vy *= 0.9;
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

    const buckets = [
      [[], [], []],
      [[], [], []],
    ];
    const heroes = [];
    for (const p of this.parts) {
      buckets[p.lobe][p.a < 0.4 ? 0 : p.a < 0.65 ? 1 : 2].push(p);
      if (p.hero) heroes.push(p);
    }
    const cols = [GOLD, CYAN];
    const alphas = [0.26, 0.72, 0.88]; /* 中档只覆盖两圈外环，调它即调外圈整体亮度 */
    for (let lobe = 0; lobe < 2; lobe++) {
      for (let t = 0; t < 3; t++) {
        const arr = buckets[lobe][t];
        if (!arr.length) continue;
        ctx.globalAlpha = alphas[t];
        ctx.fillStyle = cols[lobe];
        ctx.beginPath();
        for (const p of arr) {
          ctx.moveTo(p.x + p.r, p.y);
          ctx.arc(p.x, p.y, p.r, 0, TAU);
        }
        ctx.fill();
      }
    }
    ctx.globalCompositeOperation = 'lighter';
    for (const p of heroes) {
      ctx.globalAlpha = 0.09;
      ctx.fillStyle = cols[p.lobe];
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * 3.4, 0, TAU);
      ctx.fill();
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

  flip() {
    this.turns += 1;
    this.spinFrom = this.spin;
    this.spinTo = Math.PI * this.turns;
    this.spinT = 0;
    if (!this.running) {
      this.spinT = 1;
      this.spin = this.spinTo;
      this.paint(0);
    }
  }

  burst(power = 2) {
    const { cx, cy, parts } = this;
    for (const p of parts) {
      const dx = p.x - cx;
      const dy = p.y - cy;
      const d = Math.hypot(dx, dy) || 1;
      const f = (0.5 + Math.random()) * power;
      p.vx += (dx / d) * f;
      p.vy += (dy / d) * f;
    }
    if (!this.running) this.paint(0);
  }

  destroy() {
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
  if (!canvas.offsetWidth || !canvas.offsetHeight) return { release() {} };

  const style = getComputedStyle(host);
  const want = Number.parseInt(style.getPropertyValue('--sea-count'), 10);
  const motion = style.getPropertyValue('--sea-motion').trim() !== '0';
  const count = Math.min(Number.isFinite(want) ? want : deviceCap(), deviceCap());

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const field = new StarField(canvas, host, {
    count,
    motion,
    fit: 0.46,
    cx: 0.71,
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

  /* 周 / 月切换 = 两仪互易：只监听已有按钮，不加 DOM、不加状态位 */
  const onToggle = (event) => {
    const btn = event.target instanceof Element ? event.target.closest('[data-toggle-value]') : null;
    if (!btn || !btn.closest('[data-toggle]')) return;
    field.flip();
    field.burst(2.2);
  };

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
  document.addEventListener('click', onToggle);
  document.addEventListener('visibilitychange', onVisibility);
  reduced.addEventListener?.('change', onReduced);
  if (!reduced.matches && field.visible) field.start();

  return {
    release() {
      io?.disconnect();
      document.removeEventListener('click', onToggle);
      document.removeEventListener('visibilitychange', onVisibility);
      reduced.removeEventListener?.('change', onReduced);
      host.removeEventListener('pointermove', onPointerMove);
      host.removeEventListener('pointerleave', onPointerLeave);
      field.destroy();
    },
  };
}

export default mount;
