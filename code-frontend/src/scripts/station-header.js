// 站头交互：当前项同步、磁吸光束、横滑边缘提示。
// 悬停 / 聚焦某个入口时广播 `cg:station-hover`（detail.form），首页图腾据此变形；离开时 form 为 null。
const lifetime = new AbortController();
let release = () => {};

function mount() {
  release();
  const header = document.querySelector('[data-station-header]');
  if (!header) return;
  const events = new AbortController();
  const options = { signal: events.signal };
  const nav = header.querySelector('.station-nav');
  const links = [...nav.querySelectorAll('.station-link')];
  const fine = matchMedia('(hover: hover) and (pointer: fine)');
  let activeLink = null;

  const current = () => links.find(link => link.getAttribute('aria-current') === 'page') ?? null;

  function placeBeam(link, mode) {
    if (!link) {
      nav.removeAttribute('data-beam');
      return;
    }
    nav.style.setProperty('--beam-x', `${link.offsetLeft}px`);
    nav.style.setProperty('--beam-w', `${link.offsetWidth}px`);
    nav.setAttribute('data-beam', mode);
  }
  function rest() {
    placeBeam(current(), 'rest');
  }
  function broadcast(form) {
    document.dispatchEvent(new CustomEvent('cg:station-hover', { detail: { form } }));
  }

  function close() {
    activeLink?.classList.remove('is-energized');
    if (activeLink) broadcast(null);
    activeLink = null;
    rest();
  }
  function show(link) {
    if (activeLink === link) return;
    activeLink?.classList.remove('is-energized');
    activeLink = link;
    link.classList.add('is-energized');
    placeBeam(link, 'hover');
    broadcast(link.dataset.form);
  }
  function updateEdges() {
    nav.toggleAttribute('data-nav-start', nav.scrollLeft > 1);
    nav.toggleAttribute('data-nav-end', nav.scrollLeft + nav.clientWidth < nav.scrollWidth - 1);
  }
  function revealLink(link) {
    if (!link) return;
    const item = link.getBoundingClientRect();
    const box = nav.getBoundingClientRect();
    // 只移动导航自身；避免切页或聚焦导航时把正文一并滚动。
    if (item.left < box.left + 2) nav.scrollLeft += item.left - box.left - 2;
    else if (item.right > box.right - 2) nav.scrollLeft += item.right - box.right + 2;
    updateEdges();
  }
  function syncLayout() {
    document.documentElement.style.setProperty('--menubar-height', `${header.getBoundingClientRect().height}px`);
    revealLink(current());
    updateEdges();
    if (activeLink) placeBeam(activeLink, 'hover');
    else rest();
  }

  for (const link of [...links, header.querySelector('.station-about')]) {
    const href = link.getAttribute('href');
    const on = href === '/' ? location.pathname === '/' : location.pathname.startsWith(href);
    if (on) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  for (const link of links) {
    link.addEventListener('pointerenter', event => { if (fine.matches && event.pointerType === 'mouse') show(link); }, options);
    link.addEventListener('focus', () => { revealLink(link); if (link.matches(':focus-visible')) show(link); }, options);
  }
  nav.addEventListener('pointerleave', () => { if (!links.some(link => link === document.activeElement && link.matches(':focus-visible'))) close(); }, options);
  header.addEventListener('focusout', () => {
    queueMicrotask(() => { if (!links.includes(document.activeElement)) close(); });
  }, options);
  header.addEventListener('click', close, options);
  nav.addEventListener('scroll', updateEdges, { ...options, passive: true });
  document.addEventListener('keydown', event => { if (event.key === 'Escape') close(); }, options);
  window.addEventListener('resize', () => { close(); syncLayout(); }, options);
  fine.addEventListener('change', close, options);
  const sizing = new ResizeObserver(syncLayout);
  sizing.observe(header);
  syncLayout();
  // 首次定位不带过渡，之后光束才「弹」过去
  requestAnimationFrame(() => requestAnimationFrame(() => nav.setAttribute('data-beam-ready', '')));
  release = () => { events.abort(); sizing.disconnect(); close(); };
}
document.addEventListener('astro:before-swap', () => release(), { signal: lifetime.signal });
document.addEventListener('astro:after-swap', mount, { signal: lifetime.signal });
document.addEventListener('astro:page-load', mount, { signal: lifetime.signal });
mount();
if (import.meta.hot) import.meta.hot.dispose(() => { release(); lifetime.abort(); });
