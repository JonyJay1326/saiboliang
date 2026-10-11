// 首页舞台：图腾取件与联动、解码眉标、计数、分区浮现、网格追光、入口刻光。
// 全部是装饰层：无 JS 时文字与链接完整可读；reduced-motion 下只保留静态终态。
import { STATIONS } from '../lib/stations.js';

const LABELS = Object.fromEntries(STATIONS.map(station => [station.form, `${station.name} · ${station.verb}`]));
LABELS.coin = '太仓 · 赛博粮站通宝';
const NOISE = '粮票仓斗升合01#%&*+/<>ABCDEFXYZ';

export function mountHome() {
  const root = document.querySelector('[data-granary]');
  if (!root) return () => {};
  const stage = root.querySelector('[data-coin-stage]');
  const events = new AbortController();
  const on = { signal: events.signal };
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const fine = matchMedia('(hover: hover) and (pointer: fine)');
  const timers = new Set();
  const frames = new Set();
  let coin = null;
  let idle = 0;
  let dead = false;
  const raf = fn => { const id = requestAnimationFrame(time => { frames.delete(id); fn(time); }); frames.add(id); return id; };
  const later = (fn, ms) => { const id = setTimeout(() => { timers.delete(id); fn(); }, ms); timers.add(id); return id; };

  root.setAttribute('data-motion', reduced ? 'off' : 'on');

  // ---- 解码眉标 ----
  function decode(el, duration = 900) {
    const text = el.dataset.text ?? el.textContent;
    el.dataset.text = text;
    if (reduced) return;
    const start = performance.now();
    const step = now => {
      const progress = Math.min(1, (now - start) / duration);
      let out = '';
      for (let i = 0; i < text.length; i++) {
        const settle = i / text.length;
        out += progress >= settle * .85 + .15 || text[i] === ' ' ? text[i] : NOISE[(Math.random() * NOISE.length) | 0];
      }
      el.textContent = out;
      if (progress < 1 && !dead) raf(step);
    };
    raf(step);
  }
  root.querySelectorAll('[data-decode]').forEach(el => decode(el));

  // ---- 计数 ----
  function countUp(el) {
    const value = Number(el.dataset.count);
    if (reduced || !Number.isFinite(value) || value <= 0) return;
    const start = performance.now();
    const step = now => {
      const progress = Math.min(1, (now - start) / 1300);
      el.textContent = String(Math.round(value * (1 - Math.pow(1 - progress, 3))));
      if (progress < 1 && !dead) raf(step);
    };
    raf(step);
  }
  root.querySelectorAll('[data-count]').forEach(el => later(() => countUp(el), 350));

  // ---- 分区浮现（只在有动效时隐藏初态） ----
  let reveal = null;
  if (!reduced && 'IntersectionObserver' in window) {
    reveal = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.setAttribute('data-revealed', '');
        reveal.unobserve(entry.target);
      }
    }, { rootMargin: '0px 0px -12% 0px' });
    root.querySelectorAll('[data-reveal]').forEach(el => {
      if (el.getBoundingClientRect().top < innerHeight * .9) el.setAttribute('data-revealed', '');
      else { el.setAttribute('data-reveal-armed', ''); reveal.observe(el); }
    });
  }

  // ---- 网格追光 + 入口刻光 / 倾斜 ----
  let pending = null;
  stage?.addEventListener('pointermove', event => {
    if (!fine.matches || reduced) return;
    const box = stage.getBoundingClientRect();
    const first = !pending;
    pending = [event.clientX - box.left, event.clientY - box.top];
    if (!first) return;
    raf(() => {
      if (!pending) return;
      stage.style.setProperty('--mx', `${pending[0]}px`);
      stage.style.setProperty('--my', `${pending[1]}px`);
      stage.setAttribute('data-lit', '');
      pending = null;
    });
  }, { ...on, passive: true });
  stage?.addEventListener('pointerleave', () => stage.removeAttribute('data-lit'), on);

  for (const panel of root.querySelectorAll('[data-etched]')) {
    panel.addEventListener('pointermove', event => {
      if (!fine.matches || reduced || event.pointerType !== 'mouse') return;
      const box = panel.getBoundingClientRect();
      const x = event.clientX - box.left;
      const y = event.clientY - box.top;
      panel.style.setProperty('--etch-x', `${x}px`);
      panel.style.setProperty('--etch-y', `${y}px`);
      panel.setAttribute('data-etch-active', '');
    }, { ...on, passive: true });
    panel.addEventListener('pointerleave', () => {
      panel.removeAttribute('data-etch-active');
    }, on);
  }

  // ---- 图腾：变形联动 ----
  const label = stage?.querySelector('[data-coin-label]');
  let formTimer = 0;
  let currentForm = 'coin';
  function morph(form) {
    clearTimeout(formTimer);
    const next = form && LABELS[form] ? form : 'coin';
    // 离开入口时稍等再回钱形，避免在相邻入口间划过时来回抖
    formTimer = setTimeout(() => {
      if (next === currentForm) return;
      currentForm = next;
      coin?.setForm(next);
      if (label) { label.dataset.text = LABELS[next]; decode(label, 420); }
      stage?.setAttribute('data-form', next);
    }, next === 'coin' ? 260 : 40);
  }
  for (const door of root.querySelectorAll('.taicang-door[data-form]')) {
    door.addEventListener('pointerenter', () => morph(door.dataset.form), on);
    door.addEventListener('focus', () => morph(door.dataset.form), on);
    door.addEventListener('pointerleave', () => morph(null), on);
    door.addEventListener('blur', () => morph(null), on);
  }
  document.addEventListener('cg:station-hover', event => morph(event.detail?.form ?? null), on);

  // 引擎排在首屏之后取件（独立 chunk，不进首屏 JS）
  if (stage && 'WebGLRenderingContext' in window) {
    const queue = window.requestIdleCallback || (fn => setTimeout(fn, 200));
    idle = queue(() => {
      idle = 0;
      import('./granary-coin.js')
        .then(({ mount }) => mount(stage))
        .then(engine => {
          if (dead) { engine.release(); return; }
          coin = engine;
          if (currentForm !== 'coin') engine.setForm(currentForm);
        })
        .catch(error => {
          console.warn('太仓图腾未能启用：', error);
          stage.setAttribute('data-coin', 'off');
        });
    });
  }

  return () => {
    dead = true;
    events.abort();
    reveal?.disconnect();
    clearTimeout(formTimer);
    if (idle) (window.cancelIdleCallback || clearTimeout)(idle);
    timers.forEach(clearTimeout);
    frames.forEach(cancelAnimationFrame);
    coin?.release();
    coin = null;
  };
}
