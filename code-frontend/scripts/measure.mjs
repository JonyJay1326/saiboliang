import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const DIST = path.resolve('dist');

function kb(n) {
  return `${(n / 1024).toFixed(2)} KB`;
}

function gzipSize(buf) {
  return zlib.gzipSync(buf, { level: 9 }).length;
}

function scriptsIn(htmlFile) {
  const html = fs.readFileSync(htmlFile, 'utf8');
  const entry = new Set();
  for (const m of html.matchAll(/<script[^>]*src="([^"]+)"/g)) entry.add(m[1]);
  for (const m of html.matchAll(/<link[^>]*rel="modulepreload"[^>]*href="([^"]+)"/g)) entry.add(m[1]);
  // Astro 岛：JS 地址在 astro-island 的属性里，不在 <script src>
  for (const m of html.matchAll(/(?:component-url|renderer-url)="([^"]+\.js)"/g)) entry.add(m[1]);

  // 解析传递依赖：ESM 的静态 import 会连带下载，必须计入首屏
  const seen = new Set();
  const queue = [...entry];
  while (queue.length) {
    const ref = queue.shift();
    const rel = ref.replace(/^\//, '');
    if (seen.has(rel)) continue;
    const abs = path.join(DIST, rel);
    if (!fs.existsSync(abs)) continue;
    seen.add(rel);
    const src = fs.readFileSync(abs, 'utf8');
    for (const m of src.matchAll(/from"\.\/([^"]+\.js)"/g)) queue.push(`/_astro/${m[1]}`);
  }
  return { html, refs: seen };
}

const PAGES = [
  ['/ (首页，无岛)', 'index.html'],
  ['/tickets/ (筛选岛)', 'tickets/index.html'],
  ['/github/ (无岛)', 'github/index.html'],
  ['/tickets/[id]/ (详情)', 'tickets/qoder-qwen38flash-free-202609/index.html'],
  ['/news/ (施工页)', 'news/index.html'],
  ['/tip/ (驿传，无岛)', 'tip/index.html'],
  ['/about/ (无岛)', 'about/index.html'],
];

console.log('页面'.padEnd(26) + 'HTML raw'.padStart(11) + 'HTML gzip'.padStart(11) + 'JS gzip'.padStart(10) + '  脚本');
console.log('-'.repeat(96));

let ticketsProbe = null;

for (const [label, rel] of PAGES) {
  const file = path.join(DIST, rel);
  const { html, refs } = scriptsIn(file);

  let jsGzip = 0;
  const names = [];
  for (const ref of refs) {
    const asset = path.join(DIST, ref.replace(/^\//, ''));
    if (!fs.existsSync(asset)) continue;
    const buf = fs.readFileSync(asset);
    jsGzip += gzipSize(buf);
    names.push(path.basename(ref).slice(0, 28));
  }

  const htmlBuf = Buffer.from(html);
  console.log(
    label.padEnd(26) +
      kb(htmlBuf.length).padStart(11) +
      kb(gzipSize(htmlBuf)).padStart(11) +
      kb(jsGzip).padStart(10) +
      '  ' +
      names.join(', ')
  );

  if (rel === 'tickets/index.html') {
    // 岛 props 是否在 HTML 里重复了一份完整数据
    const propsMatch = html.match(/props="([^"]*)"/);
    ticketsProbe = {
      hasPropsAttr: Boolean(propsMatch),
      cardCount: (html.match(/class="ticket"/g) || []).length,
    };
  }
}

console.log('\n=== /tickets 结构探测 ===');
console.log('  服务端渲染的票卡数 :', ticketsProbe?.cardCount);
console.log('  岛 props 内联在 HTML:', ticketsProbe?.hasPropsAttr ? '是（列表数据会重复一份）' : '否');

console.log('\n=== 预算对照（frontend-spec §10.2：首屏 JS gzip < 30KB）===');
