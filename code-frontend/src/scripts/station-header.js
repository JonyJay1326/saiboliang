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
  let litLink = null;
  let frame = 0;
  let arrivalTimer = 0;
  let pressTimer = 0;

  const focusLink = () => links.find(link => link === document.activeElement && link.matches(':focus-visible'));
  function placeLight() {
    const link = pointerLink || focusLink();
    if (link !== litLink) {
      litLink?.classList.remove('is-energized');
      link?.classList.add('is-energized');
      litLink = link;
    }
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
  function clearLight() {
    pointerLink = null;
    litLink?.classList.remove('is-energized');
    litLink = null;
    nav.removeAttribute('data-lit');
  }
  function sync() {
    clearLight();
    clearTimeout(arrivalTimer);
    clearTimeout(pressTimer);
    let current = null;
    for (const link of header.querySelectorAll('a[href]')) {
      const href = link.getAttribute('href');
      const active = href === '/' ? location.pathname === '/' : location.pathname.startsWith(href);
      if (active) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
      link.classList.remove('is-arriving');
      link.classList.remove('is-pressing');
      if (active && links.includes(link)) current = link;
    }
    if (current) {
      current.classList.add('is-arriving');
      arrivalTimer = window.setTimeout(() => current.classList.remove('is-arriving'), 500);
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
    link.addEventListener('click', event => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      clearTimeout(pressTimer);
      links.forEach(item => item.classList.remove('is-pressing'));
      link.classList.add('is-pressing');
      pressTimer = window.setTimeout(() => link.classList.remove('is-pressing'), 800);
    }, options);
  }
  nav.addEventListener('pointerleave', () => { pointerLink = null; placeLight(); }, options);
  nav.addEventListener('focusin', scheduleLight, options);
  nav.addEventListener('focusout', scheduleLight, options);
  header.addEventListener('click', clearLight, options);
  document.addEventListener('astro:before-swap', clearLight, options);
  window.addEventListener('scroll', () => header.toggleAttribute('data-scrolled', window.scrollY > 8), { ...options, passive: true });
  window.addEventListener('resize', scheduleLight, { ...options, passive: true });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) clearLight();
  }, options);
  refresh = sync;
  sync();
  release = () => { events.abort(); cancelAnimationFrame(frame); clearTimeout(arrivalTimer); clearTimeout(pressTimer); clearLight(); };
}

document.addEventListener('astro:page-load', mount, { signal: lifetime.signal });
mount();
if (import.meta.hot) import.meta.hot.dispose(() => { release(); lifetime.abort(); });
