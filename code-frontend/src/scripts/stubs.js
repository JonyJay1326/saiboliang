// 卡片只在构建期渲染；本模块负责可释放的渐进增强。
let release;

function boot() {
  release?.();
  release = null;
  const cards = [...document.querySelectorAll('.r4-stub')];
  if (!cards.length && !document.querySelector('[data-sheet]')) return;
  const controller = new AbortController();
  const { signal } = controller;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const fine = matchMedia('(hover: hover) and (pointer: fine)');
  let tip;
  let activeTip;
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add('r4-is-in');
      observer.unobserve(entry.target);
    }
  }, { threshold: .15 });
  const calm = () => reduced.matches || document.documentElement.dataset.skin === 'plain';
  for (const card of cards) {
    if (calm()) card.classList.add('r4-is-in');
    else observer.observe(card);
    card.addEventListener('pointermove', (event) => {
      if (calm() || !fine.matches) return;
      const box = card.getBoundingClientRect();
      const x = (event.clientX - box.left) / box.width;
      const y = (event.clientY - box.top) / box.height;
      card.classList.add('r4-is-live');
      card.style.setProperty('--mx', `${x * 100}%`);
      card.style.setProperty('--my', `${y * 100}%`);
      card.style.setProperty('--ry', `${(x - .5) * 8}deg`);
      card.style.setProperty('--rx', `${(.5 - y) * 8}deg`);
    }, { signal });
    card.addEventListener('pointerleave', () => {
      card.classList.remove('r4-is-live');
      card.style.setProperty('--rx', '0deg');
      card.style.setProperty('--ry', '0deg');
    }, { signal });
  }

  const tick = () => {
    const now = Date.now();
    for (const block of document.querySelectorAll('.r4-stub__left[data-expiry]')) {
      const end = block.dataset.expiry;
      if (!end) continue;
      const left = new Date(end).getTime() - now;
      if (!Number.isFinite(left)) continue;
      const surface = block.closest('.r4-stub, .r4-sheet');
      surface?.toggleAttribute('data-urgent', left > 0 && left <= 7 * 86400000);
      /* 内容未变则不写 DOM：实测列表页 14 个块里只有 3 个是「即将截止」（需秒级刷新），
         其余是「长期有效」「余 N 天」—— 文案一天只变一次，却在每秒重写 innerHTML，
         白白制造 14 次 DOM mutation/秒。改为先拼字符串、与现状比对，不同才写。
         2026-10-01 移动端适配。 */
      const paint = (html) => { if (block.innerHTML !== html) block.innerHTML = html; };
      if (left <= 0) {
        paint('已逾期<small>待核实</small>');
      } else if (left <= 7 * 86400000) {
        const seconds = Math.floor(left / 1000);
        const pad = (n) => String(n).padStart(2, '0');
        const text = `${Math.floor(seconds / 86400)} 天 ${pad(Math.floor(seconds / 3600) % 24)}:${pad(Math.floor(seconds / 60) % 60)}:${pad(seconds % 60)}`;
        let clock = block.querySelector('.r4-clock');
        if (!clock) {
          const date = new Date(new Date(end).getTime() + 8 * 3600000).toISOString().slice(5, 10);
          block.innerHTML = `<b>即将截止</b><span class="r4-clock"></span><small>${date} 截止</small>`;
          clock = block.querySelector('.r4-clock');
        }
        if (clock.textContent !== text) clock.textContent = text;
      } else {
        const date = new Date(new Date(end).getTime() + 8 * 3600000).toISOString().slice(5, 10);
        paint(`余 ${Math.ceil(left / 86400000)} 天<small>${date} 截止</small>`);
      }
    }
  };
  const toggleTier = (target, on) => {
    const item = target.closest('[data-k]');
    const box = item?.closest('.r4-stub__main, .r4-scale');
    if (!box) return;
    for (const node of box.querySelectorAll('[data-k]')) {
      if (node.dataset.k === item.dataset.k) node.classList.toggle('r4-is-hot', on);
    }
  };
  const hideTip = () => {
    tip?.classList.remove('r4-is-on');
    activeTip?.removeAttribute('aria-describedby');
    activeTip = null;
  };
  const showTip = (target) => {
    const item = target.closest('[data-tip]');
    if (!item) return;
    hideTip();
    if (!tip) {
      tip = document.createElement('div');
      tip.className = 'r4-tip';
      tip.id = 'r4-price-tip';
      tip.setAttribute('role', 'tooltip');
      document.body.appendChild(tip);
    }
    activeTip = item;
    // data-tip 来自构建期受控模板，业务文本已逐项转义。
    tip.innerHTML = item.dataset.tip;
    tip.classList.add('r4-is-on');
    item.setAttribute('aria-describedby', tip.id);
    const box = item.getBoundingClientRect();
    tip.style.left = `${Math.max(8, Math.min(box.left, innerWidth - tip.offsetWidth - 8))}px`;
    tip.style.top = `${Math.max(8, Math.min(box.bottom + 8, innerHeight - tip.offsetHeight - 8))}px`;
  };
  /* 触摸端不弹 tooltip：触摸时 pointerover 紧随 pointerdown 触发，气泡弹出后
     pointer-events:none 按不掉，且会盖住下一张票卡。判据用 fine（hover:hover +
     pointer:fine）；focusin/out 分支不加守卫，键盘可达性不受影响。
     2026-10-01 移动端适配。 */
  for (const type of ['pointerover', 'focusin']) document.addEventListener(type, (event) => {
    if (!(event.target instanceof Element)) return;
    if (type === 'pointerover' && !fine.matches) return;
    toggleTier(event.target, true);
    showTip(event.target);
  }, { signal });
  for (const type of ['pointerout', 'focusout']) document.addEventListener(type, (event) => {
    if (!(event.target instanceof Element)) return;
    if (type === 'pointerout' && !fine.matches) return;
    toggleTier(event.target, false);
    hideTip();
  }, { signal });
  document.addEventListener('scroll', hideTip, { signal, capture: true });
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') hideTip(); }, { signal });
  document.addEventListener('cg:sheet-ready', tick, { signal });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); }, { signal });
  tick();
  /* 窄屏降频到 5s：配合上面的「比对后写入」，秒级刷新的意义只剩「即将截止」那 3 块，
     而倒计时本身不要求亚秒精度（页面也无实时性承诺）。5s 一次把窄屏的定时唤醒
     降到 1/5，同时内容依旧实时。2026-10-01 移动端适配。 */
  const narrow = matchMedia('(max-width: 760px)');
  const period = () => (narrow.matches ? 5000 : 1000);
  let timer = setInterval(() => { if (!document.hidden) tick(); }, period());
  narrow.addEventListener('change', () => {
    clearInterval(timer);
    timer = setInterval(() => { if (!document.hidden) tick(); }, period());
  }, { signal });

  release = () => {
    controller.abort();
    observer.disconnect();
    clearInterval(timer);
    hideTip();
    tip?.remove();
  };
}

document.addEventListener('astro:page-load', boot);
document.addEventListener('astro:before-swap', () => { release?.(); release = null; });
