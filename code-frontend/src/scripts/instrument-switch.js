// 三器切换控件引擎（frontend-spec §7.1）。
// 来源：cache-tools/design-lab/three-instruments-v3.html（2026-09-23 用户拍板移植到实际页面）。
// 分工：显隐 / 键盘 / aria 由 Base.astro 的原生切换脚本负责（本脚本只监听 data-toggle-current 的变化）；
// 本脚本负责三件事——① 按按钮盒画静置美术与切换动效（canvas + WAAPI）；② 新面板前三 / 六项的错落入场；
// ③ 「流光」：从被点按钮飞向图腾落点（全屏固定画布，1.35s 后自清）。
// 流光落点有讲究（2026-09-23 用户口径）：
//   army   错金兵符 → **虎符投影中心**（虎符引擎每帧写 canvas.__modelAnchor，拆解姿态也跟着走）；
//   market 悬签     → **秤砣换位后的新位置**（杆秤引擎的 canvas.__bobAnchor() 读 armT 目标位）；
//   sky    星历拨盘 → 器物位中心（星海是「场」没有器物锚点，用兜底）。
// 画布纯装饰：aria-hidden、零数据（不映射任何榜单 / 套餐字段）。
const KIND_RGB = { army: '246,195,81', market: '230,190,112', sky: '161,206,226' };

export function mount() {
  const handles = [...document.querySelectorAll('[data-instrument]')].map(mountOne);
  return {
    release() {
      for (const handle of handles) handle.release();
    },
  };
}

export default mount;

function mountOne(widget) {
  const root = widget.closest('[data-toggle]');
  const canvas = widget.querySelector('.instrument__canvas');
  const c = canvas?.getContext('2d');
  if (!root || !c) return { release() {} };

  const kind = widget.dataset.kind;
  const rgb = KIND_RGB[kind] || KIND_RGB.army;
  const beam = widget.querySelector('.instrument__beam');
  const dial = widget.querySelector('.instrument__dial');
  const buttons = [...widget.querySelectorAll('.instrument__tab')];
  const values = buttons.map((button) => button.dataset.toggleValue);
  if (!values.length) return { release() {} };

  const media = matchMedia('(prefers-reduced-motion: reduce)');
  const abort = new AbortController();
  const on = (target, type, fn) => target.addEventListener(type, fn, { signal: abort.signal });
  const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(v, b));
  const lerp = (a, b, t) => a + (b - a) * t;
  const tau = Math.PI * 2;

  const index0 = Math.max(0, values.indexOf(root.dataset.toggleCurrent));
  const state = {
    index: index0,
    pos: index0,
    velocity: 0,
    time: 0,
    age: 10,
    hover: -1,
    heat: [0, 0],
    width: 0,
    height: 0,
    boxes: [],
    parts: [],
    visible: true,
    anims: [],
    fx: null,
    drag: null,
  };

  let raf = 0;
  let last = 0;
  let disposed = false;

  function line(ctx, points, color, width = 1) {
    ctx.beginPath();
    points.forEach((p, i) => (i ? ctx.lineTo(...p) : ctx.moveTo(...p)));
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.stroke();
  }

  function light(ctx, x, y, r, color, power = 1) {
    if (power <= 0) return;
    ctx.save();
    ctx.globalAlpha = clamp(power);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, color);
    g.addColorStop(.16, color);
    g.addColorStop(1, 'transparent');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
    ctx.restore();
  }

  function dot(ctx, x, y, r, color) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, tau);
    ctx.fillStyle = color;
    ctx.fill();
  }

  function polygon(ctx, x, y, w, h, fill, stroke) {
    ctx.beginPath();
    ctx.moveTo(x + 6, y);
    ctx.lineTo(x + w - 6, y);
    ctx.lineTo(x + w, y + 6);
    ctx.lineTo(x + w, y + h - 6);
    ctx.lineTo(x + w - 6, y + h);
    ctx.lineTo(x + 6, y + h);
    ctx.lineTo(x, y + h - 6);
    ctx.lineTo(x, y + 6);
    ctx.closePath();
    if (fill) {
      ctx.fillStyle = fill;
      ctx.fill();
    }
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.stroke();
    }
  }

  function animate(el, frames, options) {
    const animation = el.animate(frames, options);
    state.anims.push(animation);
    return animation;
  }

  /* 图腾落点（视口坐标）：虎符 = 投影中心；杆秤 = 秤砣换位后的新位置；星海没有器物锚点。 */
  function totemEnd() {
    const target =
      kind === 'army'
        ? document.querySelector('[data-tiger-canvas]')
        : kind === 'market'
          ? document.querySelector('[data-steelyard-canvas]')
          : null;
    if (!target) return null;
    const point = kind === 'army' ? target.__modelAnchor : target.__bobAnchor?.();
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
    const rect = target.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    return { x: rect.left + point.x, y: rect.top + point.y };
  }

  /* 切换：按钮分片 / 悬签 / 盘心的动作 + 面板错落 + 光束 + 流光起点 + 过程文字重新起拍。 */
  function fire() {
    state.age = 0;
    state.parts = [];
    state.anims.forEach((animation) => animation.cancel());
    state.anims = [];
    if (media.matches) {
      state.age = 10;
      state.pos = state.index;
      state.velocity = 0;
      return;
    }
    const duration = 680;
    const button = buttons[state.index];

    if (kind === 'army') {
      for (const [i, leaf] of [...button.querySelectorAll('.instrument__leaf')].entries()) {
        const sign = i ? 1 : -1;
        animate(
          leaf,
          [
            { transform: 'translateY(0) rotateX(0)' },
            { transform: `translateY(${sign * 8}px) rotateX(${sign * -48}deg)`, offset: .22 },
            { transform: `translateY(${sign * 12}px) rotateX(${sign * -25}deg)`, offset: .43 },
            { transform: `translateY(${-sign * 1.6}px) rotateX(0)`, offset: .76 },
            { transform: 'translateY(0) rotateX(0)' },
          ],
          { duration, easing: 'cubic-bezier(.21,.7,.3,1)' }
        );
      }
      animate(button.querySelector('.instrument__label'), [{ opacity: 1 }, { opacity: .38, offset: .25 }, { opacity: 1, offset: .75 }], { duration });
    }

    if (kind === 'market') {
      const direction = state.index ? 1 : -1;
      animate(
        button.querySelector('.instrument__sign'),
        [
          { transform: `translateY(2px) rotate(${direction * 3}deg) rotateX(0deg)` },
          { transform: `translateY(-10px) rotate(${-direction * 6}deg) rotateX(-76deg)`, offset: .26 },
          { transform: `translateY(-7px) rotate(${direction * 4}deg) rotateX(17deg)`, offset: .55 },
          { transform: `translateY(-3px) rotate(${-direction * 2}deg) rotateX(-5deg)`, offset: .78 },
          { transform: 'translateY(-4px) rotate(0deg) rotateX(0deg)' },
        ],
        { duration: duration * 1.25, easing: 'cubic-bezier(.18,.7,.3,1)' }
      );
    }

    const panel = root.querySelector(`[data-toggle-panel="${values[state.index]}"]`);
    const targets =
      kind === 'army'
        ? panel?.querySelectorAll('.podium__card')
        : kind === 'market'
          ? panel?.querySelectorAll('.cards > li')
          : panel?.querySelectorAll('.ledger li');
    [...(targets || [])].slice(0, kind === 'sky' ? 6 : 3).forEach((el, i) => {
      const from =
        kind === 'army'
          ? 'perspective(600px) rotateX(4deg) translateY(12px)'
          : kind === 'market'
            ? `translateX(${state.index ? 14 : -14}px)`
            : 'translateY(8px)';
      animate(el, [{ opacity: .25, transform: from }, { opacity: 1, transform: 'none' }], {
        duration: duration * .65,
        delay: i * 45,
        easing: 'cubic-bezier(.16,1,.3,1)',
        fill: 'backwards',
      });
      if (kind === 'army') {
        animate(
          el,
          [
            { boxShadow: '0 0 0 transparent' },
            { boxShadow: '0 0 25px #e8b73a4d', offset: .55 },
            { boxShadow: '0 0 0 transparent' },
          ],
          { duration: duration * 1.2, delay: duration * .4 + i * 55 }
        );
      }
    });

    animate(
      beam,
      [
        { transform: 'scaleX(0)', opacity: 0 },
        { transform: 'scaleX(.22)', opacity: 1, offset: .3 },
        { transform: 'scaleX(1)', opacity: .3, offset: .8 },
        { transform: 'scaleX(1)', opacity: 0 },
      ],
      { duration: duration * 1.35, easing: 'cubic-bezier(.25,.7,.3,1)' }
    );

    const start = button.getBoundingClientRect();
    const plate = document.querySelector('.totem-plate, [data-plate-probe]');
    if (plate && plate.getBoundingClientRect().width && innerWidth > 760) {
      const rect = plate.getBoundingClientRect();
      const head = document.querySelector('.page-head')?.getBoundingClientRect();
      state.fx = {
        start: { x: start.x + start.width / 2, y: start.bottom + 10 },
        end: totemEnd() || { x: rect.x + rect.width / 2, y: (head ? head.bottom : rect.bottom) - 52 },
      };
    }

    const box = state.boxes[state.index];
    if (box) {
      for (let i = 0; i < 24; i++) {
        const a = Math.random() * tau;
        state.parts.push({
          x: box.x + box.w / 2,
          y: box.y + box.h / 2,
          vx: Math.cos(a) * (25 + Math.random() * 75),
          vy: Math.sin(a) * 45,
          life: 0,
          max: .3 + Math.random() * .65,
        });
      }
    }
    wake();
  }

  /* —— 三型静置美术（逐帧）—— */
  function electric(points, energy) {
    if (energy <= 0) return;
    line(c, points, `rgba(${rgb},${energy * .22})`, 4);
    line(c, points, `rgba(255,245,198,${energy})`, .8);
  }

  function army() {
    const a = state.boxes[0];
    const b = state.boxes[1];
    const left = a.x - 11;
    const right = b.x + b.w + 11;
    const top = a.y - 6;
    const bottom = a.y + a.h + 8;
    polygon(c, left, top, right - left, bottom - top, null, '#b6a46a40');
    line(c, [[left + 8, bottom + 5], [right - 8, bottom + 5]], '#d7b57229');
    for (let i = 0; i < 2; i++) {
      const box = state.boxes[i];
      const active = 1 - Math.abs(state.pos - i);
      const heat = state.heat[i];
      const cx = box.x + box.w / 2;
      const retract = state.age < .64 && i === state.index ? Math.sin(clamp(state.age / .64) * Math.PI) * 8 : 0;
      for (const side of [-1, 1]) {
        const x = side < 0 ? box.x - 5 : box.x + box.w + 1;
        const y = box.y + box.h / 2;
        c.fillStyle = '#544b2d';
        c.fillRect(x + side * retract, y - 9, 4, 18);
        c.fillStyle = `rgba(${rgb},${.2 + active * .6})`;
        c.fillRect(x + 1 + side * retract, y - 7, 1, 14);
        if (i === state.index && state.age < .68) {
          const strength = Math.sin(clamp(state.age / .68) * Math.PI);
          const points = Array.from({ length: 12 }, (_, k) => [
            x + 2 + side * retract + Math.sin(k * 5 + state.time * 92) * 4 * strength,
            y - 12 + (k * 24) / 11,
          ]);
          electric(points, strength);
          light(c, x, y, 20, `rgba(${rgb},.7)`, strength * .4);
        }
      }
      const len = box.w - 24;
      const p = (state.time * .65 + i * .5) % 1;
      line(c, [[box.x + 12, top - 4], [box.x + box.w - 12, top - 4]], `rgba(${rgb},${.15 + heat * .25})`);
      if (heat > .02) {
        const x = box.x + 12 + p * len;
        light(c, x, top - 4, 10, `rgba(${rgb},.9)`, heat * .6);
        line(c, [[x - 12, top - 4], [x, top - 4]], `rgba(${rgb},${heat})`);
      }
      for (let k = 0; k < 3; k++) {
        c.fillStyle = `rgba(${rgb},${.17 + active * .65})`;
        c.fillRect(cx - 13 + k * 10, bottom + 8, 6, 1);
      }
      if (state.age > .58 && state.age < 1.05 && i === state.index) {
        const t = (state.age - .58) / .47;
        light(c, cx, box.y + box.h / 2, box.w * .7, `rgba(${rgb},.25)`, 1 - t);
      }
    }
  }

  function market() {
    const a = state.boxes[0];
    const b = state.boxes[1];
    const y = a.y - 18;
    const left = a.x - 10;
    const right = b.x + b.w + 10;
    line(c, [[left, y], [right, y]], '#d5bd7955');
    line(c, [[left, y + 2], [right, y + 2]], '#735e3833');
    for (let i = 0; i < 2; i++) {
      const box = state.boxes[i];
      const cx = box.x + box.w / 2;
      const active = 1 - Math.abs(state.pos - i);
      const lift = lerp(2, -4, active);
      const pull = state.age < .85 && state.index === i ? Math.sin(clamp(state.age / .85) * Math.PI) * 4 : 0;
      const eyeY = box.y + 6 + lift - pull;
      c.beginPath();
      c.ellipse(cx, y, 4, 5, 0, 0, tau);
      c.strokeStyle = '#d8c695';
      c.lineWidth = 1;
      c.stroke();
      for (const side of [-1, 1]) {
        const xx = cx + side * (box.w / 2 - 18);
        line(c, [[cx, y + 4], [xx, eyeY]], '#b4a270aa', 1.2);
        line(c, [[cx + 1, y + 4], [xx + 1, eyeY]], '#f5df9d33', .6);
      }
      if (active > .01) light(c, cx, y, 12, '#f4d688', active * .35);
      if (state.heat[i] > .01) {
        const p = (state.time * .8) % 1;
        const xx = lerp(cx, cx + box.w / 2 - 18, p);
        const yy = lerp(y + 4, eyeY, p);
        light(c, xx, yy, 8, '#ffdf98', state.heat[i] * .7);
      }
      if (i === state.index && state.age > .58 && state.age < 1.2) {
        const t = (state.age - .58) / .62;
        line(c, [[box.x + 10, box.y + box.h - 7], [box.x + 10 + (box.w - 20) * t, box.y + box.h - 7]], `rgba(255,232,171,${1 - t})`, 1.5);
      }
    }
    const cx = lerp(a.x + a.w / 2, b.x + b.w / 2, state.pos);
    light(c, cx, y, 15, '#ebc883', Math.min(.5, Math.abs(state.velocity) * .3));
  }

  function sky() {
    const cx = state.width / 2;
    const cy = state.height / 2;
    const r = 39;
    const turn = state.pos * Math.PI;
    const beat = state.age < 1.05 ? Math.sin((state.age / 1.05) * Math.PI) : 0;
    const polar = (angle, radius) => [cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius];
    const metal = c.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
    metal.addColorStop(0, '#b7a575');
    metal.addColorStop(.18, '#36362f');
    metal.addColorStop(.47, '#827557');
    metal.addColorStop(.6, '#242a29');
    metal.addColorStop(1, '#a89a73');
    c.save();
    c.shadowColor = '#000';
    c.shadowBlur = 11;
    c.shadowOffsetY = 4;
    dot(c, cx, cy, r + 2, metal);
    c.restore();
    dot(c, cx, cy, r - 3, '#0f161b');
    c.beginPath();
    c.arc(cx, cy, r - 5, 0, tau);
    c.strokeStyle = '#b9a67866';
    c.stroke();
    for (let i = 0; i < 48; i++) {
      const angle = (i / 48) * tau + turn;
      const major = i % 6 === 0;
      line(c, [polar(angle, r - 1), polar(angle, r - (major ? 8 : 4))], major ? '#decf9b' : '#9e956d88', major ? 1.2 : .7);
    }
    /* 内环十二弧（2026-09-23 用户定：与刻线 / 指针同向，整盘顺时针转）——
       原稿内环反向（-turn*.72），与刻线、指针、观星台星海（顺时针）反着转，已改同向。 */
    for (let i = 0; i < 12; i++) {
      const angle = (i / 12) * tau + turn * .72;
      c.beginPath();
      c.arc(cx, cy, 26, angle + .03, angle + .43);
      c.strokeStyle = i % 3 === 0 ? '#89cfd4aa' : '#617d8566';
      c.lineWidth = 2;
      c.stroke();
      if (i % 3 === 0) {
        const p = polar(angle + .23, 26);
        dot(c, ...p, 1.2, '#d3e7db');
      }
    }
    const center = c.createRadialGradient(cx - 4, cy - 5, 1, cx, cy, 22);
    center.addColorStop(0, '#21373b');
    center.addColorStop(1, '#0a1018');
    dot(c, cx, cy, 21, center);
    for (let i = 0; i < 6; i++) {
      const angle = (i / 6) * tau + turn * .22;
      const outer = 22;
      const inner = 18 - beat * 12;
      const p1 = polar(angle, outer);
      const p2 = polar(angle + .9, outer);
      const p3 = polar(angle + .55, inner);
      const p4 = polar(angle + .05, inner);
      c.beginPath();
      c.moveTo(...p1);
      c.lineTo(...p2);
      c.lineTo(...p3);
      c.lineTo(...p4);
      c.closePath();
      c.fillStyle = `rgba(87,109,111,${.22 + beat * .48})`;
      c.fill();
      c.strokeStyle = '#b4c5b422';
      c.lineWidth = .6;
      c.stroke();
    }
    c.save();
    c.globalAlpha = 1 - beat * .7;
    c.font = '20px SimSun,serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillStyle = '#ead7a6';
    c.shadowColor = '#bdded4';
    c.shadowBlur = beat ? 8 : 0;
    c.fillText(state.index ? '月' : '周', cx, cy + 1);
    c.restore();
    const angle = Math.PI + turn;
    const tip = polar(angle, r + 4);
    const tail = polar(angle, r - 10);
    line(c, [tail, tip], '#fae4a8', 2);
    dot(c, ...tip, 2, '#fff0c7');
    light(c, ...tip, 10, '#dfc48b', .5);
    for (const [index, box] of state.boxes.entries()) {
      const side = index ? 1 : -1;
      const active = 1 - Math.abs(state.pos - index);
      const x = index ? box.x + 7 : box.x + box.w - 7;
      line(c, [[cx + side * (r + 7), cy], [x, cy]], `rgba(221,198,141,${.12 + active * .4})`);
      const x2 = index ? box.x + box.w - 5 : box.x + 5;
      line(c, [[x2, cy - 8], [x2, cy + 8]], `rgba(${rgb},${.15 + state.heat[index] * .7})`);
    }
    line(c, [[cx, cy - r - 4], [cx - 3, cy - r - 9], [cx + 3, cy - r - 9], [cx, cy - r - 4]], '#e9d598aa');
    if (state.age > .72 && state.age < 1.35) {
      const t = (state.age - .72) / .63;
      c.beginPath();
      c.arc(cx, cy, r + 4 + t * 7, 0, tau);
      c.strokeStyle = `rgba(${rgb},${(1 - t) * .6})`;
      c.lineWidth = 1;
      c.stroke();
    }
  }

  /* —— 流光：从按钮出发、按贝塞尔曲线飞向图腾，落点每帧重取（拆解 / 秤砣走位都跟得上）—— */
  const field = document.createElement('canvas');
  field.className = 'instrument__field';
  field.setAttribute('aria-hidden', 'true');
  const f = field.getContext('2d');

  function curve(t, start, end) {
    const p1 = { x: start.x + (end.x - start.x) * .35, y: start.y + 20 };
    const p2 = { x: end.x - 40, y: end.y + 55 };
    const u = 1 - t;
    return {
      x: u * u * u * start.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * end.x,
      y: u * u * u * start.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * end.y,
    };
  }

  function sceneFx() {
    if (!f) return;
    f.clearRect(0, 0, innerWidth, innerHeight);
    if (!state.fx || media.matches || state.age > 1.35) return;
    const start = state.fx.start;
    const end = totemEnd() || state.fx.end;
    const t = clamp(state.age / .78);
    state.fx.end = end;
    if (t < 1) {
      for (let i = 0; i < 42; i++) {
        const tt = t - i * .007;
        if (tt < 0) continue;
        const p = curve(tt, start, end);
        dot(f, p.x, p.y, i ? 1 : 2, `rgba(${rgb},${(1 - i / 42) * .8})`);
        if (!i) light(f, p.x, p.y, 17, `rgba(${rgb},.55)`, .6);
      }
    } else {
      const fade = 1 - (state.age - .78) / .57;
      const r = 10 + (1 - fade) * 60;
      f.beginPath();
      f.ellipse(end.x, end.y, r, r * .4, 0, 0, tau);
      f.strokeStyle = `rgba(${rgb},${Math.max(0, fade) * .45})`;
      f.stroke();
    }
  }

  function paint(dt) {
    c.clearRect(0, 0, state.width, state.height);
    if (!state.boxes.length) return;
    if (kind === 'army') army();
    else if (kind === 'market') market();
    else sky();
    for (const p of state.parts) {
      p.life += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 25 * dt;
      const alpha = 1 - p.life / p.max;
      if (alpha > 0) line(c, [[p.x, p.y], [p.x - p.vx * .017, p.y - p.vy * .017]], `rgba(${rgb},${alpha * .7})`);
    }
    state.parts = state.parts.filter((p) => p.life < p.max);
    sceneFx();
  }

  function tick(now) {
    raf = 0;
    if (disposed || document.hidden) return;
    const dt = last ? Math.min(.033, (now - last) / 1000) : .016;
    last = now;
    if (media.matches) {
      state.pos = state.index;
      state.velocity = 0;
      state.age = 10;
      state.parts = [];
      state.heat = [0, 0];
    } else {
      state.time += dt;
      state.age += dt;
      if (!state.drag) {
        state.velocity += ((state.index - state.pos) * 115 - state.velocity * 20) * dt;
        state.pos += state.velocity * dt;
      }
      state.heat = state.heat.map((v, i) => lerp(v, state.hover === i ? 1 : 0, 1 - Math.exp(-dt * 10)));
    }
    paint(media.matches ? 0 : dt);
    if (!media.matches && state.visible) raf = requestAnimationFrame(tick);
  }

  function wake() {
    if (!raf && !document.hidden && !disposed) {
      last = 0;
      raf = requestAnimationFrame(tick);
    }
  }

  function size() {
    if (!widget.offsetWidth) return;
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(devicePixelRatio || 1, 2);
    state.width = rect.width;
    state.height = rect.height;
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    state.boxes = buttons.map((button) => {
      const b = button.getBoundingClientRect();
      return { x: b.x - rect.x, y: b.y - rect.y, w: b.width, h: b.height };
    });
    field.width = Math.round(innerWidth * dpr);
    field.height = Math.round(innerHeight * dpr);
    if (f) f.setTransform(dpr, 0, 0, dpr, 0, 0);
    state.fx = null;
    paint(0);
    wake();
  }

  /* 显隐切换由 Base.astro 的原生脚本写 data-toggle-current；这里只跟状态，不抢点击。 */
  const observer = new MutationObserver(() => {
    const next = values.indexOf(root.dataset.toggleCurrent);
    if (next < 0 || next === state.index) return;
    state.index = next;
    fire();
  });
  observer.observe(root, { attributes: true, attributeFilter: ['data-toggle-current'] });

  const ro = new ResizeObserver(size);
  ro.observe(widget);

  let io = null;
  if ('IntersectionObserver' in window) {
    io = new IntersectionObserver(
      (entries) => {
        state.visible = entries[0].isIntersecting;
        if (state.visible) wake();
      },
      { threshold: .02 }
    );
    io.observe(widget);
  }

  buttons.forEach((button, i) => {
    on(button, 'pointerenter', () => {
      state.hover = i;
      wake();
    });
    on(button, 'pointerleave', () => {
      state.hover = -1;
    });
    on(button, 'focus', () => {
      state.hover = i;
      wake();
    });
    on(button, 'blur', () => {
      state.hover = -1;
    });
    on(button, 'pointermove', (event) => {
      if (media.matches || event.pointerType === 'touch') return;
      const rect = button.getBoundingClientRect();
      button.style.setProperty('--px', `${event.clientX - rect.x}px`);
      button.style.setProperty('--py', `${event.clientY - rect.y}px`);
    });
  });

  /* 星历盘：点击切换，左右拨动即转盘（同一次选榜，属这条 UI 的既有交互）。 */
  if (kind === 'sky' && dial) {
    const choose = (index) => {
      buttons[index]?.click();
    };
    on(dial, 'pointerdown', (event) => {
      if (event.button !== 0) return;
      state.drag = { id: event.pointerId, x: event.clientX, start: state.pos, dx: 0 };
      state.velocity = 0;
      dial.setPointerCapture(event.pointerId);
      wake();
    });
    on(dial, 'pointermove', (event) => {
      if (!state.drag || state.drag.id !== event.pointerId) return;
      state.drag.dx = event.clientX - state.drag.x;
      if (!media.matches) state.pos = clamp(state.drag.start + state.drag.dx / 85);
      wake();
    });
    on(dial, 'pointerup', (event) => {
      if (!state.drag || state.drag.id !== event.pointerId) return;
      const drag = state.drag;
      state.drag = null;
      const index = Math.abs(drag.dx) > 12 ? (clamp(drag.start + drag.dx / 85) > .5 ? 1 : 0) : (state.index + 1) % values.length;
      dial.releasePointerCapture(event.pointerId);
      choose(index);
    });
    const cancel = () => {
      state.drag = null;
      state.velocity = 0;
      wake();
    };
    on(dial, 'pointercancel', cancel);
    on(dial, 'lostpointercapture', cancel);
    on(dial, 'click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.detail === 0) choose((state.index + 1) % values.length);
    });
    on(dial, 'keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      choose(event.key === 'ArrowLeft' || event.key === 'Home' ? 0 : 1);
    });
  }

  on(document, 'visibilitychange', () => {
    if (document.hidden) {
      cancelAnimationFrame(raf);
      raf = 0;
    } else wake();
  });
  on(media, 'change', () => {
    state.anims.forEach((animation) => animation.cancel());
    state.anims = [];
    state.parts = [];
    state.age = 10;
    state.pos = state.index;
    state.velocity = 0;
    state.fx = null;
    paint(0);
    wake();
  });
  on(window, 'resize', size);

  document.body.append(field);
  size();
  if (!media.matches) wake();

  return {
    release() {
      disposed = true;
      cancelAnimationFrame(raf);
      raf = 0;
      state.anims.forEach((animation) => animation.cancel());
      state.anims = [];
      observer.disconnect();
      ro.disconnect();
      io?.disconnect();
      abort.abort();
      field.remove();
    },
  };
}
