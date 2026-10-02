// 三器切换控件引擎（frontend-spec §7.1）。
// 来源：cache-tools/design-lab/three-instruments-v3.html（2026-09-23 用户拍板移植到实际页面）。
// 分工：显隐 / 键盘 / aria 由 Base.astro 的原生切换脚本负责（本脚本只监听 data-toggle-current 的变化）；
// 本脚本负责三件事——① 按按钮盒画静置美术与切换动效（canvas + WAAPI）；② 新面板前三 / 六项的错落入场；
// ③ 「流光」：从被点按钮飞向图腾落点（全屏固定画布，1.35s 后自清）。
// 流光落点有讲究（2026-09-23 用户口径）：
//   army   错金兵符 → **虎符投影中心**（虎符引擎每帧写 canvas.__modelAnchor，拆解姿态也跟着走）；
//   market 悬签     → **秤砣换位后的新位置**（杆秤引擎的 canvas.__bobAnchor() 读 armT 目标位）；
//   sky    星历拨盘 → 太极圆心（星海引擎提供随画布尺寸更新的锚点）。
// 画布纯装饰：aria-hidden、零数据（不映射任何榜单 / 套餐字段）。
import { SKY_TIMING } from './sky-switch-timing.js';

const KIND_RGB = { army: '246,195,81', market: '230,190,112', sky: '161,206,226' };
// 兵符交接时长（秒）：旧格合拢 → 电弧沿提梁跑到新格，之后新格才翻片（2026-09-29）
const HANDOFF = .18;
const MARKET_TIMING = { move: .27, lock: .1, inkStart: .35, finish: .58 };
// 云雷纹单元（单位方格，u 由外缘向字、v 由上沿向中缝）：从中缝一侧起笔，向外回旋
const SPIRAL = [[0, 1], [0, 0], [1, 0], [1, .72], [.3, .72], [.3, .32], [.7, .32], [.7, .55]];

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
  const marketRig = kind === 'market' ? buttons.map(button => ({
    sign: button.querySelector('.instrument__sign'),
    hangers: [...button.querySelectorAll('.instrument__hanger')],
  })) : [];
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
    from: index0,
    glyph: index0,
    velocity: 0,
    time: 0,
    age: 10,
    hover: -1,
    heat: [0, 0],
    // 悬停描亮（0~1）：未选中格从中缝向外走一遍后停住，移开收回；选中格不用它
    gleam: values.map(() => 0),
    // 描金进度（0~1）：选中格从中缝向两端描出错金纹，离任格快速熄灭
    ink: values.map((_, i) => (i === index0 ? 1 : 0)),
    // 交接：prev = 上一个选中格（无交接为 -1），lead = 本次翻片相对切换起点的延迟（秒）
    prev: -1,
    lead: 0,
    // 本次流光是否已经落到虎符上（一次切换只触发一波）
    pulsed: false,
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

  /* 确定性噪声（0~1）：电弧抖动按帧节拍取样，同一拍内形状稳定，不会每帧乱闪 */
  function noise(n) {
    const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
    return s - Math.floor(s);
  }

  /* 沿折线描到总长的 t 比例，返回笔尖位置（描金 / 暗刻共用） */
  function trace(ctx, points, t, color, width) {
    const lengths = points.slice(1).map((p, i) => Math.hypot(p[0] - points[i][0], p[1] - points[i][1]));
    let left = lengths.reduce((a, b) => a + b, 0) * clamp(t);
    ctx.beginPath();
    ctx.moveTo(...points[0]);
    let tip = points[0];
    for (let i = 0; i < lengths.length && left > 0; i++) {
      const k = Math.min(1, left / lengths[i]);
      tip = [lerp(points[i][0], points[i + 1][0], k), lerp(points[i][1], points[i + 1][1], k)];
      ctx.lineTo(...tip);
      left -= lengths[i];
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.stroke();
    return tip;
  }

  function animate(el, frames, options) {
    const animation = el.animate(frames, options);
    state.anims.push(animation);
    return animation;
  }

  /* 图腾落点（视口坐标）：投影中心、秤砣目标位、太极圆心。 */
  function totemEnd() {
    const target =
      kind === 'army'
        ? document.querySelector('[data-tiger-canvas]')
        : kind === 'market'
          ? document.querySelector('[data-steelyard-canvas]')
          : document.querySelector('[data-star-sea-canvas]');
    if (!target) return null;
    const point = kind === 'army' ? target.__modelAnchor : kind === 'market' ? target.__bobAnchor?.() : target.__seaAnchor?.();
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
    const rect = target.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    return { x: rect.left + point.x, y: rect.top + point.y };
  }

  /* 切换：按钮分片 / 悬签 / 盘心的动作 + 面板错落 + 光束 + 流光起点 + 过程文字重新起拍。 */
  function fire() {
    const marketPoses = kind === 'market'
      ? marketRig.map(({ sign }) => getComputedStyle(sign).transform)
      : null;
    const prev = Math.round(state.pos);
    state.from = state.pos;
    state.age = 0;
    state.parts = [];
    state.fx = null;
    state.pulsed = false;
    if (kind === 'sky') state.drag = null;
    state.anims.forEach((animation) => animation.cancel());
    state.anims = [];
    state.prev = kind === 'army' && prev !== state.index ? prev : -1;
    state.lead = state.prev >= 0 ? HANDOFF : 0;
    if (media.matches) {
      state.age = 10;
      state.pos = state.index;
      state.glyph = state.index;
      state.velocity = 0;
      state.prev = -1;
      state.ink = values.map((_, i) => (i === state.index ? 1 : 0));
      paint(0);
      return;
    }
    const duration = 680;
    const button = buttons[state.index];
    const lead = state.lead * 1000;

    if (kind === 'army') {
      // 旧格先合拢：两片向中缝一收再回弹，交出令符
      for (const [i, leaf] of [...(buttons[state.prev]?.querySelectorAll('.instrument__leaf') || [])].entries()) {
        const sign = i ? 1 : -1;
        animate(
          leaf,
          [
            { transform: 'translateY(0) scaleY(1)' },
            { transform: `translateY(${-sign * 1.5}px) scaleY(.9)`, offset: .45 },
            { transform: 'translateY(0) scaleY(1)' },
          ],
          { duration: 240, easing: 'cubic-bezier(.3,0,.2,1)' }
        );
      }
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
          { duration, delay: lead, easing: 'cubic-bezier(.21,.7,.3,1)' }
        );
      }
      animate(button.querySelector('.instrument__label'), [{ opacity: 1 }, { opacity: .38, offset: .25 }, { opacity: 1, offset: .75 }], { duration, delay: lead });
    }

    if (kind === 'market') {
      marketRig.forEach((rig, i) => {
        const selected = i === state.index;
        const rest = `translateY(1.5px) rotate(${i ? 1.4 : -1.4}deg)`;
        animate(rig.sign, selected ? [
          { transform: marketPoses[i], easing: 'cubic-bezier(.22,.75,.3,1)' },
          { transform: 'translateY(0) rotate(0deg)', offset: MARKET_TIMING.move / MARKET_TIMING.finish, easing: 'cubic-bezier(.4,0,.6,1)' },
          { transform: 'translateY(1.4px) rotate(0deg)', offset: .32 / MARKET_TIMING.finish, easing: 'cubic-bezier(.18,.7,.3,1)' },
          { transform: 'translateY(-.35px) rotate(0deg)', offset: .42 / MARKET_TIMING.finish, easing: 'ease-out' },
          { transform: 'translateY(0) rotate(0deg)' },
        ] : [{ transform: marketPoses[i] }, { transform: rest }], {
          duration: selected ? MARKET_TIMING.finish * 1000 : 180,
          easing: selected ? 'linear' : 'cubic-bezier(.2,.7,.3,1)',
        });
      });
      for (const eyelet of button.querySelectorAll('.instrument__eyelet')) {
        animate(eyelet, [
          { boxShadow: 'inset 0 1px 2px #010704,0 1px #ead39a52' },
          { boxShadow: 'inset 0 1px 2px #010704,0 0 7px #efd29aa6', offset: .35 },
          { boxShadow: 'inset 0 1px 2px #010704,0 1px #ead39a52' },
        ], { duration: 230, delay: MARKET_TIMING.inkStart * 1000, easing: 'ease-out' });
      }
    }

    const panel = root.querySelector(`[data-toggle-panel="${values[state.index]}"]`);
    const targets =
      kind === 'army'
        ? panel?.querySelectorAll('.podium__card')
        : kind === 'market'
          ? panel?.querySelectorAll('.r4-stubs--plan > li, .cards > li')
          : panel?.querySelectorAll('.ledger li');
    [...(targets || [])].slice(0, kind === 'sky' ? 6 : 3).forEach((el, i) => {
      const from =
        kind === 'army'
          ? 'perspective(600px) rotateX(4deg) translateY(12px)'
          : kind === 'market'
            ? 'translateY(4px)'
            : 'translateY(4px)';
      animate(el, [{ opacity: kind === 'sky' ? .65 : kind === 'market' ? .8 : .25, transform: from }, { opacity: 1, transform: 'none' }], {
        duration: kind === 'sky' ? 280 : kind === 'market' ? 260 : duration * .65,
        delay: (kind === 'market' ? 150 : 0) + i * (kind === 'sky' ? 25 : kind === 'market' ? 35 : 45),
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
    // 点卯簿：领奖台之下的前八行自左向右错落补位，只动 transform / opacity，不影响排版
    if (kind === 'army') {
      [...(panel?.querySelectorAll('.roll__rows > li') || [])].slice(0, 8).forEach((el, i) => {
        animate(el, [{ opacity: .2, transform: 'translateX(-10px)' }, { opacity: 1, transform: 'none' }], {
          duration: 380,
          delay: 140 + i * 28,
          easing: 'cubic-bezier(.16,1,.3,1)',
          fill: 'backwards',
        });
      });
    }

    if (kind !== 'sky') animate(
      beam,
      [
        { transform: 'scaleX(0)', opacity: 0 },
        { transform: 'scaleX(.22)', opacity: 1, offset: .3 },
        { transform: 'scaleX(1)', opacity: .3, offset: .8 },
        { transform: 'scaleX(1)', opacity: 0 },
      ],
      { duration: duration * 1.35, delay: (kind === 'sky' ? SKY_TIMING.finish : kind === 'market' ? MARKET_TIMING.finish : 0) * 1000, easing: 'cubic-bezier(.25,.7,.3,1)' }
    );

    const start = button.getBoundingClientRect();
    const plate = document.querySelector('.totem-plate, [data-plate-probe]');
    if (plate && plate.getBoundingClientRect().width && innerWidth > 760) {
      const rect = plate.getBoundingClientRect();
      const head = document.querySelector('.page-head')?.getBoundingClientRect();
      state.fx = {
        start: { x: start.x + start.width / 2, y: kind === 'sky' ? start.y + start.height / 2 : start.bottom + 10 },
        end: totemEnd() || { x: rect.x + rect.width / 2, y: (head ? head.bottom : rect.bottom) - 52 },
      };
    }

    const box = state.boxes[state.index];
    if (box && kind === 'army') {
      // 兵符火花从中缝两端迸出（分片的真实开口处），等新格翻片时才起跳
      for (let i = 0; i < 20; i++) {
        const side = i % 2 ? 1 : -1;
        state.parts.push({
          x: side < 0 ? box.x + 6 : box.x + box.w - 6,
          y: box.y + box.h / 2,
          vx: side * (40 + Math.random() * 90),
          vy: (Math.random() - .5) * 70,
          life: 0,
          max: .3 + Math.random() * .5,
          wait: state.lead + .1,
        });
      }
    } else if (box) {
      for (let i = 0; i < 6; i++) {
        const a = Math.random() * tau;
        state.parts.push({
          x: kind === 'market' ? box.x + (i % 2 ? box.w - 20 : 20) : box.x + box.w / 2,
          y: kind === 'market' ? box.y + 8 : box.y + box.h / 2,
          vx: Math.cos(a) * (25 + Math.random() * 75),
          vy: Math.sin(a) * 45,
          life: 0,
          max: .3 + Math.random() * .65,
          wait: kind === 'market' ? MARKET_TIMING.inkStart : SKY_TIMING.inkStart + .1,
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

  /* 错金纹：两端各一对云雷纹（以中缝上下镜像，呼应兵符两片）+ 上下两道金丝。
     常态为暗刻；选中格按 ink 从中缝 / 中线起笔向两端描金，笔尖带一点亮光。 */
  function inlay(box, i) {
    const seam = box.y + box.h / 2;
    const cx = box.x + box.w / 2;
    const units = [];
    for (const sx of [-1, 1]) {
      const edge = sx < 0 ? box.x + 9 : box.x + box.w - 9;
      for (const sy of [-1, 1]) {
        units.push(SPIRAL.map(([u, v]) => [edge - sx * u * 17, sy < 0 ? box.y + 7 + v * 12 : box.y + box.h - 7 - v * 12]));
      }
      units.push([[cx, box.y + 4.5], [edge + sx * -5, box.y + 4.5]]);
      units.push([[cx, box.y + box.h - 4.5], [edge + sx * -5, box.y + box.h - 4.5]]);
    }
    // 翻片期间画布上的纹不跟 DOM 片转，先藏起、落定后再现
    const flipping = i === state.index && state.prev >= 0 ? clamp((state.age - state.lead - .4) / .2) : 1;
    const heat = state.heat[i];
    c.save();
    c.lineCap = 'square';
    for (const points of units) {
      trace(c, points, 1, `rgba(6,6,4,${.55 * flipping})`, 1.5);
      trace(c, points.map(([x, y]) => [x, y + .7]), 1, `rgba(214,184,110,${.08 * flipping})`, .6);
    }
    const ink = state.ink[i];
    if (ink > .001) {
      const eased = 1 - Math.pow(1 - ink, 2);
      c.shadowColor = `rgba(${rgb},.85)`;
      c.shadowBlur = 4;
      const tips = units.map((points, k) =>
        trace(c, points, k % 4 < 2 ? clamp(eased * 1.25 - .25) : clamp(eased * 1.6), `rgba(255,218,140,${.9 * flipping})`, 1)
      );
      c.shadowBlur = 0;
      if (ink < 1) for (const tip of tips) light(c, tip[0], tip[1], 7, 'rgba(255,238,190,.9)', .7 * (1 - ink) + .2);
    }
    // 悬停：未选中格从中缝描一笔淡金，走完停在略亮；选中格只在已有描金上再亮一档
    const gleam = state.gleam[i];
    if (i !== state.index && gleam > .001) {
      const eased = 1 - Math.pow(1 - gleam, 2);
      c.shadowColor = `rgba(${rgb},.5)`;
      c.shadowBlur = 3;
      units.forEach((points, k) => {
        trace(c, points, k % 4 < 2 ? clamp(eased * 1.25 - .25) : clamp(eased * 1.6), `rgba(255,218,140,${.5 * flipping})`, .8);
      });
      c.shadowBlur = 0;
    } else if (i === state.index && ink > .92 && heat > .02) {
      c.shadowColor = `rgba(${rgb},.65)`;
      c.shadowBlur = 3;
      for (const points of units) trace(c, points, 1, `rgba(255,236,190,${.32 * heat * flipping})`, .7);
      c.shadowBlur = 0;
    }
    c.restore();
    return seam;
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
    const age = state.age - state.lead;
    for (let i = 0; i < 2; i++) {
      const box = state.boxes[i];
      const active = 1 - Math.abs(state.pos - i);
      const heat = state.heat[i];
      const cx = box.x + box.w / 2;
      inlay(box, i);
      const retract = age > 0 && age < .64 && i === state.index ? Math.sin(clamp(age / .64) * Math.PI) * 8 : 0;
      for (const side of [-1, 1]) {
        const x = side < 0 ? box.x - 5 : box.x + box.w + 1;
        const y = box.y + box.h / 2;
        c.fillStyle = '#544b2d';
        c.fillRect(x + side * retract, y - 9, 4, 18);
        c.fillStyle = `rgba(${rgb},${.2 + active * .6})`;
        c.fillRect(x + 1 + side * retract, y - 7, 1, 14);
        if (i === state.index && age > 0 && age < .68) {
          // 夹扣放电：按 30Hz 节拍取噪声（两端钉住），偶尔向外分一枝
          const strength = Math.sin(clamp(age / .68) * Math.PI);
          const beat = Math.floor(state.time * 30) + side * 17;
          const points = Array.from({ length: 12 }, (_, k) => [
            x + 2 + side * retract + (noise(k * 7.3 + beat * 1.7) - .5) * 8 * strength * Math.sin((k / 11) * Math.PI),
            y - 12 + (k * 24) / 11,
          ]);
          electric(points, strength);
          if (noise(beat * .37) > .55) {
            const k = 3 + Math.floor(noise(beat * .91) * 6);
            const [bx, by] = points[k];
            electric([[bx, by], [bx + side * (4 + noise(beat) * 5), by + (noise(beat * 2.3) - .5) * 8]], strength * .7);
          }
          light(c, x, y, 20, `rgba(${rgb},.7)`, strength * .4);
        }
        // 悬停夹扣：一粒稳定的光，不放电、不跑动；翻片放电那一段让给电弧
        const discharging = i === state.index && age > 0 && age < .68;
        if (heat > .02 && !discharging) light(c, x + 2, y, 11, `rgba(${rgb},.8)`, heat * .5);
      }
      // 提梁静置：只留一道暗线，跑光留给交接电弧
      line(c, [[box.x + 12, top - 4], [box.x + box.w - 12, top - 4]], `rgba(${rgb},.15)`);
      // 选中标记：底线下一枚小菱形铆点，随 pos 渐变；未选中只留一粒暗钉
      const my = bottom + 9;
      const size = 1.2 + active * 2.3;
      c.beginPath();
      c.moveTo(cx, my - size);
      c.lineTo(cx + size, my);
      c.lineTo(cx, my + size);
      c.lineTo(cx - size, my);
      c.closePath();
      c.fillStyle = `rgba(${rgb},${.25 + active * .7})`;
      c.fill();
      light(c, cx, my, 9, `rgba(${rgb},.6)`, active * .5);
      if (age > .58 && age < 1.05 && i === state.index) {
        const t = (age - .58) / .47;
        light(c, cx, box.y + box.h / 2, box.w * .7, `rgba(${rgb},.25)`, 1 - t);
      }
    }
    // 令符交接：电弧沿上方提梁从旧格跑向新格，到位后在新格上沿炸一点亮
    const from = state.boxes[state.prev];
    const to = state.boxes[state.index];
    if (from && to && state.age < state.lead + .14) {
      const y = top - 4;
      const x0 = from.x + from.w / 2;
      const x1 = to.x + to.w / 2;
      const p = clamp(state.age / state.lead);
      const eased = p * p * (3 - 2 * p);
      const head = lerp(x0, x1, eased);
      const tail = lerp(x0, x1, clamp(eased - .45));
      const fade = state.age > state.lead ? 1 - (state.age - state.lead) / .14 : 1;
      const beat = Math.floor(state.time * 30);
      const points = Array.from({ length: 10 }, (_, k) => {
        const x = lerp(tail, head, k / 9);
        return [x, y + (noise(k * 3.1 + beat) - .5) * 5 * Math.sin((k / 9) * Math.PI)];
      });
      electric(points, fade);
      light(c, head, y, 14, `rgba(${rgb},.8)`, fade * .7);
    }
  }

  function market() {
    const a = state.boxes[0], b = state.boxes[1];
    const y = a.y - 12, left = a.x - 5, right = b.x + b.w + 5;
    const rail = c.createLinearGradient(0, y - 2, 0, y + 5);
    rail.addColorStop(0, '#d8bf86'); rail.addColorStop(.2, '#8a774d');
    rail.addColorStop(.45, '#2c3528'); rail.addColorStop(.8, '#665a38'); rail.addColorStop(1, '#a08954');
    polygon(c, left, y - 2, right - left, 7, rail, '#ad945c55');
    line(c, [[left + 7,y + 2],[right - 7,y + 2]], '#08120a', 2);
    line(c, [[left + 7,y + 1],[right - 7,y + 1]], '#c2a67355', .8);
    for (const x of [left,right]) {
      polygon(c,x - 3,y - 3,6,10,'#52492f','#ceb278');
      dot(c,x,y + 1,1.5,'#101a10');
      dot(c,x - .4,y + .5,.7,'#d3bb80');
    }
    for (let i = 0; i < 2; i++) {
      const box = state.boxes[i], bx = box.x + box.w / 2;
      const rig = marketRig[i];
      const transform = getComputedStyle(rig.sign).transform;
      const pose = transform === 'none' ? new DOMMatrixReadOnly() : new DOMMatrixReadOnly(transform);
      // 挂环上端留在横轨，下面跟随牌孔；按牌面实际姿态计算，连续切换也不会脱节。
      rig.hangers.forEach((hanger, side) => {
        const anchorX = side ? box.w - 16.5 : 16.5;
        const armX = anchorX - box.w / 2;
        const dx = (pose.a - 1) * armX + pose.c * 18 + pose.e;
        const dy = 19 + pose.b * armX + (pose.d - 1) * 18 + pose.f;
        const linkPose = `rotate(${Math.atan2(-dx, dy).toFixed(4)}rad) scaleY(${(Math.hypot(dx, dy) / 19).toFixed(4)})`;
        if (hanger.style.transform !== linkPose) hanger.style.transform = linkPose;
      });
      const ink = state.ink[i];
      const inkValue = ink.toFixed(3);
      if (buttons[i].style.getPropertyValue('--market-ink') !== inkValue) {
        buttons[i].style.setProperty('--market-ink', inkValue);
      }
      const markY = box.y + box.h + 7;
      line(c,[[bx - 10,markY],[bx + 10,markY]],`rgba(${rgb},${.05 + ink * .3})`,.7);
      line(c,[[bx,markY - 2],[bx + 2,markY],[bx,markY + 2],[bx - 2,markY],[bx,markY - 2]],`rgba(${rgb},${.1 + ink * .55})`,.8);
      light(c,bx,markY,5,`rgba(${rgb},.35)`,ink * .08);
    }
    const cx = lerp(a.x + a.w / 2,b.x + b.w / 2,clamp(state.pos));
    const lockProgress = clamp((state.age - MARKET_TIMING.move) / MARKET_TIMING.lock);
    const press = Math.sin(lockProgress * Math.PI) * 1.5;
    const sy = y + press;
    c.save();
    c.translate(cx, sy);
    c.scale(.75, .75);
    c.translate(-cx, -sy);
    const copper = c.createLinearGradient(cx - 12,sy - 13,cx + 12,sy + 15);
    copper.addColorStop(0,'#eddbac'); copper.addColorStop(.23,'#bb995b');
    copper.addColorStop(.57,'#434934'); copper.addColorStop(.82,'#ac8c50'); copper.addColorStop(1,'#e0be7e');
    polygon(c,cx - 14,sy - 9,28,26,'#0a140c','#5c5837');
    polygon(c,cx - 12,sy - 12,24,24,copper,'#e1c58c');
    polygon(c,cx - 8,sy - 8,16,16,'#303c2a','#d2b47399');
    line(c,[[cx - 5,sy - 4],[cx + 4,sy - 4],[cx + 4,sy + 3],[cx - 2,sy + 3],[cx - 2,sy]],'#debd7e',1.1);
    line(c,[[cx - 9,sy + 13],[cx + 9,sy + 13]],'#c8b582',1.5);
    const knob = c.createLinearGradient(cx - 4,sy - 15,cx + 4,sy - 9);
    knob.addColorStop(0,'#e5cd96'); knob.addColorStop(1,'#68633d');
    polygon(c,cx - 5,sy - 16,10,6,knob,'#c3ab70');
    c.restore();
    if (state.age > 0 && state.age < MARKET_TIMING.move) {
      const tail = lerp(a.x + a.w / 2,b.x + b.w / 2,clamp(state.pos - Math.sign(state.index - state.from) * .2));
      line(c,[[tail,y + 2],[cx,y + 2]],'#93e5be77',1.1);
      light(c,cx,y + 2,12,'#a6e2ba',.25);
    }
    if (state.age > MARKET_TIMING.move && state.age < MARKET_TIMING.inkStart + .1) {
      light(c,cx,sy + 10,10,'#e4c78a',Math.sin(clamp((state.age - MARKET_TIMING.move) / .18) * Math.PI) * .4);
    }
  }

  function sky() {
    const cx = state.width / 2;
    const cy = state.height / 2;
    const r = 39;
    const turn = state.pos * Math.PI;
    const beat = state.drag ? .75 : state.age < SKY_TIMING.turnEnd
      ? Math.sin(clamp(state.age / SKY_TIMING.turnEnd) * Math.PI) : 0;
    const polar = (angle, radius) => [cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius];
    // 端座与盘壳共用一根铜槽；描金从内侧接点分向上下两条暗刻。
    for (const [index, box] of state.boxes.entries()) {
      const side = index ? 1 : -1;
      const x = box.x + 2;
      const y = box.y + 4;
      const w = box.w - 4;
      const h = box.h - 8;
      const innerX = index ? x : x + w;
      const outerX = index ? x + w : x;
      const ink = state.ink[index];
      const hover = state.gleam[index] * .34;
      const bronze = c.createLinearGradient(x, y, x, y + h);
      bronze.addColorStop(0, '#938363');
      bronze.addColorStop(.1, '#455044');
      bronze.addColorStop(.52, '#26352b');
      bronze.addColorStop(.86, '#4b4c33');
      bronze.addColorStop(1, '#756544');
      c.save();
      c.shadowColor = '#020706'; c.shadowBlur = 6; c.shadowOffsetY = 2;
      polygon(c, x, y + 2, w, h, '#101b16', '#4c5037');
      polygon(c, x, y, w, h - 1, bronze, '#91805a88');
      c.restore();
      const face = c.createLinearGradient(x, y + 3, x + w, y + h - 4);
      face.addColorStop(0, `rgb(${29 + Math.round(ink * 23)},${41 + Math.round(ink * 9)},${31 + Math.round(ink * 2)})`);
      face.addColorStop(.38, `rgb(${15 + Math.round(ink * 23)},${27 + Math.round(ink * 7)},${22 + Math.round(ink * 2)})`);
      face.addColorStop(1, '#101b17');
      polygon(c, x + 3, y + 3, w - 6, h - 7, face, '#08130f');
      line(c, [[x + 8, y + 3], [x + w - 8, y + 3]], '#020b08', 1.5);
      line(c, [[x + 8, y + 1], [x + w - 8, y + 1]], '#d6c39199');
      line(c, [[x + 8, y + h - 3], [x + w - 8, y + h - 3]], '#a090584d');
      line(c, [[x + 7, y + h], [x + w - 7, y + h]], '#040c08', 1.5);
      c.save();
      polygon(c, x + 4, y + 4, w - 8, h - 9, null, null);
      c.clip();
      const reflection = c.createLinearGradient(x, y, x + w, y + h);
      reflection.addColorStop(0, `rgba(204,167,96,${ink * .17 + hover * .04})`);
      reflection.addColorStop(.32, `rgba(204,167,96,${ink * .06})`);
      reflection.addColorStop(.58, 'rgba(204,167,96,0)');
      c.fillStyle = reflection; c.fillRect(x, y, w, h);
      c.restore();
      const bridge = [[cx + side * (r + 3), cy], [innerX, cy]];
      line(c, bridge, '#071211', 3);
      line(c, bridge, '#8d80544d', 1);
      trace(c, bridge, ink, '#d7c08f', 1.3);
      if (index === state.index && state.age > .46 && state.age < SKY_TIMING.inkStart) {
        const tip = trace(c, bridge, (state.age - .46) / (SKY_TIMING.inkStart - .46), '#f1e0af', 1.5);
        light(c, ...tip, 7, '#c4ead3', .7);
      }
      for (const vertical of [-1, 1]) {
        const railY = cy + vertical * (h / 2 - 6);
        const points = [[innerX, cy], [innerX + side * 5, cy], [innerX + side * 5, railY],
          [outerX - side * 9, railY], [outerX - side * 9, railY - vertical * 5],
          [outerX - side * 15, railY - vertical * 5]];
        line(c, points, '#000a08', 2.8);
        line(c, points, '#81907a45', .8);
        trace(c, points, Math.max(ink, hover), `rgba(224,198,140,${.28 + ink * .62})`, 1.1);
      }
      const mark = [outerX - side * 5, cy];
      dot(c, ...mark, 2.1, '#07120d');
      dot(c, ...mark, 1.2, ink > .95 ? '#f0d396' : '#68644c');
      if (ink > 0 && state.age > SKY_TIMING.inkStart && state.age < 1.02) {
        light(c, ...mark, 8, '#d8bf82', Math.sin(clamp((state.age - SKY_TIMING.inkStart) / .46) * Math.PI) * .5);
      }
    }
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
    dot(c, cx, cy + 3, r + 3, '#172328');
    dot(c, cx, cy, r + 2, metal);
    c.restore();
    c.beginPath();c.arc(cx,cy,r+1,Math.PI*1.08,Math.PI*1.87);
    c.strokeStyle='#eee0b1';c.lineWidth=1.2;c.stroke();
    c.beginPath();c.arc(cx,cy+2,r+1,0,Math.PI);
    c.strokeStyle='#665d41';c.lineWidth=1.5;c.stroke();
    dot(c, cx, cy, r - 3, '#0f161b');
    c.beginPath();
    c.arc(cx, cy, r - 5, 0, tau);
    c.strokeStyle = '#b9a67866';
    c.stroke();
    // 刻度坐在凹槽内；四枚铆钉固定外壳，内盘独立转位。
    for(let i=0;i<4;i++) {
      const p=polar(Math.PI*.25+i*Math.PI*.5,r-1);
      dot(c,...p,2.1,'#101a1e');dot(c,p[0]-.4,p[1]-.4,1,'#cbb783');
    }
    c.beginPath();c.arc(cx,cy,29,0,tau);c.strokeStyle='#020a10';c.lineWidth=3;c.stroke();
    c.beginPath();c.arc(cx,cy,28,-Math.PI*.9,-Math.PI*.1);c.strokeStyle='#8e805955';c.lineWidth=.8;c.stroke();
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
      c.strokeStyle = '#050f16';
      c.lineWidth = 4;
      c.stroke();
      c.strokeStyle = i % 3 === 0 ? '#92e3d0' : '#426765';
      c.lineWidth = i % 3 === 0 ? 1.5 : .8;c.stroke();
      if (i % 3 === 0) {
        const p = polar(angle + .23, 26);
        dot(c, ...p, 1.2, '#d3e7db');
      }
    }
    const center = c.createRadialGradient(cx - 4, cy - 5, 1, cx, cy, 22);
    center.addColorStop(0, '#21373b');
    center.addColorStop(1, '#0a1018');
    c.save();
    c.translate(0, beat * 1.1);
    dot(c, cx, cy, 21, center);
    for (let i = 0; i < 6; i++) {
      const angle = (i / 6) * tau + turn * .22;
      const outer = 22;
      const inner = 18 - beat * 9;
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
    c.globalAlpha = state.drag ? .5 : state.age < SKY_TIMING.unlock
      ? 1 - clamp(state.age / SKY_TIMING.unlock)
      : state.age < SKY_TIMING.turnEnd ? 0 : clamp((state.age - SKY_TIMING.turnEnd) / .12);
    c.font = '20px SimSun,serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillStyle = '#ead7a6';
    c.shadowColor = '#bdded4';
    c.shadowBlur = beat ? 8 : 0;
    c.fillText(state.glyph ? '月' : '周', cx, cy + 1);
    c.restore();
    c.restore();
    const angle = Math.PI + turn;
    const tip = polar(angle, r + 4);
    const tail = polar(angle, r - 10);
    const wingA=polar(angle-.095,r-7), wingB=polar(angle+.095,r-7);
    c.beginPath();c.moveTo(...tip);c.lineTo(...wingA);c.lineTo(...tail);c.lineTo(...wingB);c.closePath();
    c.fillStyle='#d9bf84';c.fill();c.strokeStyle='#f7e6b9';c.lineWidth=.7;c.stroke();
    line(c, [tail, tip], '#c5ffe7', .9);
    dot(c, ...tip, 2, '#fff0c7');
    light(c, ...tip, 10, '#dfc48b', .5);
    line(c, [[cx, cy - r - 4], [cx - 3, cy - r - 9], [cx + 3, cy - r - 9], [cx, cy - r - 4]], '#e9d598aa');
    if (state.age > SKY_TIMING.turnEnd && state.age < SKY_TIMING.finish + .2) {
      const t = clamp((state.age - SKY_TIMING.turnEnd) / .42);
      c.beginPath();
      c.arc(cx, cy, r + 4 + t * 4, angle-.32, angle+.32);
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

  /* 悬停描亮：未选中格进入时从 0 走到 1，移开收回；选中格保持 0，避免重描一遍。 */
  function advanceGleam(dt) {
    for (let i = 0; i < state.gleam.length; i++) {
      const target = state.hover === i && i !== state.index ? 1 : 0;
      const rate = target > state.gleam[i] ? 8 : 7;
      state.gleam[i] += (target - state.gleam[i]) * (1 - Math.exp(-dt * rate));
    }
  }

  /* 描金进度：选中格等翻片过半再从中缝描满，离任格在合拢期间熄灭。 */
  function advanceInk(dt) {
    const riseStart = state.lead + 0.32;
    for (let i = 0; i < state.ink.length; i++) {
      const selected = i === state.index;
      const target = selected && state.age >= riseStart ? 1 : 0;
      const rate = selected ? 3.6 : 10;
      state.ink[i] += (target - state.ink[i]) * (1 - Math.exp(-dt * rate));
    }
  }

  /* 流光头到达虎符投影中心时触发一次弱化波光；入口还没挂上就留到下一帧再试。 */
  function landPulse(arrived) {
    if (kind !== 'army' || state.pulsed || !arrived) return;
    const tiger = document.querySelector('[data-tiger-canvas]');
    if (typeof tiger?.__pulse !== 'function') return;
    state.pulsed = true;
    tiger.__pulse();
  }

  function sceneFx() {
    if (!f) return;
    f.clearRect(0, 0, innerWidth, innerHeight);
    const fxAge = state.age - (kind === 'sky' ? SKY_TIMING.finish : kind === 'market' ? MARKET_TIMING.finish : 0);
    const flight = kind === 'sky' ? SKY_TIMING.flight : kind === 'market' ? .55 : .78;
    const afterglow = kind === 'market' ? .4 : .57;
    if (!state.fx || media.matches || fxAge < 0 || fxAge > flight + afterglow) return;
    const start = state.fx.start;
    const end = totemEnd() || state.fx.end;
    const t = clamp(fxAge / flight);
    state.fx.end = end;
    landPulse(t >= 1);
    if (t < 1) {
      for (let i = 0; i < 42; i++) {
        const tt = t - i * .007;
        if (tt < 0) continue;
        const p = curve(tt, start, end);
        dot(f, p.x, p.y, i ? 1 : 2, `rgba(${rgb},${(1 - i / 42) * .8})`);
        if (!i) light(f, p.x, p.y, 17, `rgba(${rgb},.55)`, .6);
      }
    } else {
      const fade = 1 - (fxAge - flight) / afterglow;
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
      // wait：兵符火花等新格翻片再迸，等待期间停在中缝端点
      if ((p.wait || 0) > 0) {
        p.wait -= dt;
        continue;
      }
      p.life += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 25 * dt;
      const alpha = 1 - p.life / p.max;
      if (alpha > 0) line(c, [[p.x, p.y], [p.x - p.vx * .017, p.y - p.vy * .017]], `rgba(${rgb},${alpha * .7})`);
    }
    state.parts = state.parts.filter((p) => (p.wait || 0) > 0 || p.life < p.max);
    sceneFx();
  }

  function tick(now) {
    raf = 0;
    if (disposed || document.hidden) return;
    const elapsed = last ? Math.max(0, (now - last) / 1000) : .016;
    const dt = Math.min(.033, elapsed);
    last = now;
    if (media.matches) {
      state.pos = state.index;
      state.glyph = state.index;
      state.velocity = 0;
      state.age = 10;
      state.parts = [];
      state.heat = [0, 0];
      state.gleam = values.map(() => 0);
      state.ink = values.map((_, i) => (i === state.index ? 1 : 0));
    } else {
      state.time += dt;
      state.age += kind === 'sky' ? elapsed : dt;
      if (!state.drag) {
        if(kind === 'sky') {
          const p = clamp((state.age - SKY_TIMING.unlock) / (SKY_TIMING.turnEnd - SKY_TIMING.unlock));
          const eased = p < .5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
          const settle = clamp((state.age - SKY_TIMING.turnEnd) / (SKY_TIMING.finish - SKY_TIMING.turnEnd));
          const recoil = Math.sin(settle * Math.PI * 2) * (1 - settle) * .012 * Math.sign(state.index - state.from);
          const previous = state.pos;
          state.pos = lerp(state.from, state.index, eased) + recoil;
          state.velocity = (state.pos - previous) / dt;
          if (state.age >= SKY_TIMING.turnEnd) state.glyph = state.index;
        } else if (kind === 'market') {
          const p = clamp(state.age / MARKET_TIMING.move);
          const eased = 1 - Math.pow(1 - p, 3);
          const previous = state.pos;
          state.pos = lerp(state.from, state.index, eased);
          state.velocity = (state.pos - previous) / dt;
        } else {
          state.velocity += ((state.index - state.pos) * 115 - state.velocity * 20) * dt;
          state.pos += state.velocity * dt;
        }
      }
      state.heat = state.heat.map((v, i) => lerp(v, state.hover === i ? 1 : 0, 1 - Math.exp(-dt * 10)));
      if (kind === 'army') {
        advanceInk(dt);
        advanceGleam(dt);
      } else if (kind === 'market') {
        state.ink = state.ink.map((ink, i) => i === state.index
          ? clamp((state.age - MARKET_TIMING.inkStart) / (MARKET_TIMING.finish - MARKET_TIMING.inkStart))
          : ink * Math.exp(-dt * 14));
      } else if (kind === 'sky') {
        advanceGleam(dt);
        state.ink = state.ink.map((ink, i) => i === state.index
          ? clamp((state.age - SKY_TIMING.inkStart) / (SKY_TIMING.finish - SKY_TIMING.inkStart))
          : ink * Math.exp(-dt * 16));
      }
    }
    paint(media.matches ? 0 : dt);
    const settling = state.age < (kind === 'sky' ? 1.8 : 1.6) || state.drag ||
      state.heat.some((heat, i) => Math.abs(heat - (state.hover === i ? 1 : 0)) > .001) ||
      (kind === 'sky' && state.gleam.some((gleam, i) => Math.abs(gleam - (state.hover === i && i !== state.index ? 1 : 0)) > .001));
    if (!media.matches && state.visible && (kind === 'army' || settling)) raf = requestAnimationFrame(tick);
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
      // 每次进入都从头描一遍，避免接着上次的进度闪一下
      if ((kind === 'army' || kind === 'sky') && i !== state.index) state.gleam[i] = 0;
      wake();
    });
    on(button, 'pointerleave', () => {
      state.hover = -1;
      if (kind !== 'army') wake();
    });
    on(button, 'focus', () => {
      state.hover = i;
      if ((kind === 'army' || kind === 'sky') && i !== state.index) state.gleam[i] = 0;
      wake();
    });
    on(button, 'blur', () => {
      state.hover = -1;
      if (kind !== 'army') wake();
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
      if (!media.matches) {
        const raw = clamp(state.drag.start + state.drag.dx / 85);
        state.pos = raw < .16 ? raw * raw / .16 : raw > .84 ? 1 - Math.pow(1 - raw, 2) / .16 : raw;
      }
      wake();
    });
    on(dial, 'pointerup', (event) => {
      if (!state.drag || state.drag.id !== event.pointerId) return;
      const drag = state.drag;
      state.drag = null;
      const index = Math.abs(drag.dx) > 12 ? (clamp(drag.start + drag.dx / 85) > .5 ? 1 : 0) : (state.index + 1) % values.length;
      dial.releasePointerCapture(event.pointerId);
      if(index===state.index) { state.from=state.pos;state.age=0; wake(); }
      choose(index);
    });
    const cancel = () => {
      if(!state.drag) return;
      state.drag = null;
      state.from = state.pos;
      state.age = 0;
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
    state.glyph = state.index;
    state.drag = null;
    state.velocity = 0;
    state.fx = null;
    state.pulsed = true;
    state.prev = -1;
    state.ink = values.map((_, i) => (i === state.index ? 1 : 0));
    state.gleam = values.map(() => 0);
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
      if (kind === 'market') {
        buttons.forEach(button => button.style.removeProperty('--market-ink'));
        marketRig.forEach(({ hangers }) => hangers.forEach(hanger => hanger.style.removeProperty('transform')));
      }
      field.remove();
    },
  };
}
