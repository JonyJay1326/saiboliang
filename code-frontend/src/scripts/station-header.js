// 当前项由真实路径决定。光带只在导航条内反馈指针和键盘焦点。
const lifetime = new AbortController();
let mounted = null;
let release = () => {};
let refresh = () => {};

function mount() {
  const header = document.querySelector('[data-station-header]');
  if (header === mounted && header) return refresh();
  release();
  mounted = header;
  if (!header) return;

  const events = new AbortController();
  const options = { signal: events.signal };
  const nav = header.querySelector('.station-nav');
  const links = [...nav.querySelectorAll('a[href]')];
  let pointerLink = null;
  let frame = 0;

  const focusLink = () => links.find(link => link === document.activeElement && link.matches(':focus-visible'));
  function placeLight() {
    const link = pointerLink || focusLink();
    nav.toggleAttribute('data-lit', Boolean(link));
    if (!link) return;
    const rect = link.getBoundingClientRect();
    const parent = nav.getBoundingClientRect();
    nav.style.setProperty('--station-light-width', `${rect.width}px`);
    nav.style.setProperty('--station-light-x', `${rect.left - parent.left}px`);
  }
  function scheduleLight() {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(placeLight);
  }
  function sync() {
    pointerLink = null;
    for (const link of header.querySelectorAll('a[href]')) {
      const href = link.getAttribute('href');
      const active = href === '/' ? location.pathname === '/' : location.pathname.startsWith(href);
      if (active) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    }
    placeLight();
    header.toggleAttribute('data-scrolled', window.scrollY > 8);
  }
  for (const link of links) {
    link.addEventListener('pointerenter', event => {
      if (event.pointerType !== 'mouse') return;
      pointerLink = link;
      placeLight();
    }, options);
  }
  nav.addEventListener('pointerleave', () => { pointerLink = null; placeLight(); }, options);
  nav.addEventListener('focusin', scheduleLight, options);
  nav.addEventListener('focusout', scheduleLight, options);
  header.addEventListener('click', () => { pointerLink = null; nav.removeAttribute('data-lit'); }, options);
  window.addEventListener('scroll', () => header.toggleAttribute('data-scrolled', window.scrollY > 8), { ...options, passive: true });
  window.addEventListener('resize', scheduleLight, { ...options, passive: true });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { pointerLink = null; nav.removeAttribute('data-lit'); }
  }, options);
  refresh = sync;
  sync();
  release = () => { events.abort(); cancelAnimationFrame(frame); };
}

document.addEventListener('astro:page-load', mount, { signal: lifetime.signal });
mount();
if (import.meta.hot) import.meta.hot.dispose(() => { release(); lifetime.abort(); });
