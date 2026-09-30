// R4 定稿的构建期展示层：输入正式契约数据，输出静态 HTML，不把详情数据内联进列表。
import { scoreTier, serial, hasFreeTier, startingPrice as contractStartingPrice, toBeijing, currencySymbol, periodLabel, planStatusLabel } from './format.js';
import { CATEGORY, REGION } from './labels.js';
const CATEGORY_CODE = { 'api-quota': 'API', token: 'TOK', credits: 'CRD' };
const REGION_CODE = { cn: 'CN', global: 'GL', 'overseas-only': 'OS', unknown: '??' };
const TIER_ASSET = { 甲: 'jia', 乙: 'yi', 丙: 'bing' };
const FONT_IMG = '/font-images/';
const MARKET = { domestic: { name: '东市 · 国内', sym: '¥', code: 'CN' }, overseas: { name: '西市 · 海外', sym: '$', code: 'GL' } };
const URGENT_DAYS = 7;
const AXIS_PAD = 6;

/** HTML 转义（数据进 innerHTML 前统一过一遍） */
function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** 受控 Markdown 行内：先转义，再只放行 **粗体** 与 http(s) 链接（契约 §4.2 白名单） */
function inline(s) {
  return esc(s)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
}

/** 纯文本里的域名 / 链接放行为可点链接（同 plans/[id].astro 的 linkify） */
function linkify(text) {
  const re = /(https?:\/\/[^\s，。；、）)"'<>]+)|(?<![\w@./-])((?:[a-z0-9-]+\.)+(?:com|cn|org|net|io|ai|dev|top)(?:\/[^\s，。；、）)"'<>]*)?)/gi;
  return esc(text).replace(re, (m, full, bare) => `<a href="${full ?? `https://${bare}`}" target="_blank" rel="noopener noreferrer">${m}</a>`);
}

/** id 的 31 进制滚动哈希，与 format.js serial 同算法 */
function idHash(id) {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return h;
}

/** 装饰条形码：由 id 哈希派生的宽窄竖条（纯装饰，读屏隐藏） */
function barcode(id) {
  let h = idHash(id) || 1;
  let x = 0;
  let rects = '';
  for (let i = 0; i < 38; i++) {
    h = (h * 1103515245 + 12345) >>> 0;
    const w = 1 + ((h >>> 28) % 3);
    if (i % 2 === 0) rects += `<rect x="${x}" width="${w}" height="16"/>`;
    x += w;
  }
  return `<svg class="barcode" viewBox="0 0 ${x} 16" preserveAspectRatio="none" fill="currentColor" aria-hidden="true">${rects}</svg>`;
}

// ======================================================================
// 粮票
// ======================================================================



/** 票码：RATION//类别-地区 */
function ticketCode(t) {
  return `RATION//${CATEGORY_CODE[t.category]}-${REGION_CODE[t.tags.region]}`;
}

function overdue(t, now = Date.now()) {
  return Boolean(t.expiryDate) && new Date(t.expiryDate).getTime() < now;
}

/** 额度大字：正文首个加粗句；没有就退回摘要 */
function highlight(t) {
  return String(t.content ?? '').match(/\*\*(.+?)\*\*/)?.[1] ?? t.summary ?? t.title;
}

/** 摘要去重：与额度大字重复的前缀砍掉，只留增量信息 */
function summaryHtml(t) {
  const hi = highlight(t);
  const raw = String(t.summary ?? '');
  let s = raw;
  if (s.startsWith(hi)) s = s.slice(hi.length).replace(/^[，,、；;\s]+/, '');
  if (!s || s === hi) return '';
  // 砍完前缀仍与大字讲同一件事时，只保留大字里没有的那部分（例如括号补充、额外档位）
  if (isEchoOfSummary(hi, s)) {
    const rest = stripEcho(hi, s);
    if (!rest) return '';
    s = rest;
  }
  return `<p class="stub__summary">${esc(s)}</p>`;
}

/** 从摘要里挖出大字没有的增量片段：按分隔符切成小段，逐段判断是否在大字里出现过 */
function stripEcho(hi, s) {
  const parts = String(s).split(/[，,、；;。]/).map(p => p.trim()).filter(Boolean);
  if (!parts.length) return '';
  const keep = parts.filter(p => !isEchoOfSummary(hi, p));
  if (!keep.length) return '';
  // 增量太短就整段留白不如不显示：单字残片（如「300」）会读成悬空的数字
  const joined = keep.join('，');
  return joined.length < 6 ? '' : joined;
}

function dailyBadge(text, summary) {
  if (/每日|每天/.test(text)) return '';
  return /每日|每天/.test(String(summary ?? '')) ? '<em>每日</em>' : '';
}

function normText(s) {
  return String(s ?? '')
    .replace(/[\s，,。、；;：:（）()【】\[\]"'`~—\-·|/]/g, '')
    .replace(/领|送|给|到|可|共|即|的|了|再|又|每|个|次|元|万|亿|千|百|\d+/g, '');
}

/** 摘要是否只是把大字换了个说法：整体包含、或去掉数量单位后仍高度重合，则视为重复 */
function isEchoOfSummary(text, summary) {
  const a = normText(text);
  const b = normText(summary);
  if (!a || !b) return false;
  if (summary.includes(text) || text.includes(summary)) return true;
  // 取较长者的前 60% 做包含判断，留住「括号补充」「第二档位」这类真正的增量
  const [shortS, longS] = a.length <= b.length ? [a, b] : [b, a];
  if (shortS.length < 4) return false;
  return longS.slice(0, Math.ceil(longS.length * 0.6)).includes(shortS);
}

/** 剩余毫秒；长期票返回 null */
function msLeft(t, now = Date.now()) {
  return t.expiryDate ? Math.max(0, new Date(t.expiryDate).getTime() - now) : null;
}

/** 倒计时文案：「6 天 07:12:05」 */
function clockText(ms) {
  const s = Math.floor(ms / 1000);
  const pad = (n) => String(n).padStart(2, '0');
  return `${Math.floor(s / 86400)} 天 ${pad(Math.floor(s / 3600) % 24)}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`;
}

/** 是否进入 7 天倒计时 */
function isUrgent(t) {
  const ms = msLeft(t);
  return ms !== null && ms > 0 && ms <= URGENT_DAYS * 86400000;
}

/** 期限块：长期 / 余 N 天 / 7 天内实时倒计时 */
function timeBlock(t) {
  const ms = msLeft(t);
  if (ms === null) return t.tags.duration === 'longterm' ? '长期有效<small>以官方为准</small>' : '期限未提供';
  if (ms === 0) return '已逾期<small>待核实</small>'; 
  const end = toBeijing(t.expiryDate)?.slice(5, 10) ?? '未提供';
  // 逾期时「即将截止」是标签、倒计时是主体，分开两级，不再同色同字号糊成一团
  if (isUrgent(t)) return `<b>即将截止 · ${end}</b><span class="clock" data-end="${esc(t.expiryDate)}">${clockText(ms)}</span>`;
  return `余 ${Math.ceil(ms / 86400000)} 天<small>${end} 截止</small>`;
}

/** 渲染一张粮票票根卡 */
function ticketStub(t, i) {
  const tier = scoreTier(t.score);
  const text = highlight(t);
  return `
    <article class="stub" data-tier="${tier}" ${isUrgent(t) ? 'data-urgent' : ''} style="--i:${i};--foil:${idHash(t.id) % 7}px">
      <a class="stub__main" href="/tickets/${esc(t.id)}/" aria-label="查看详情：${esc(t.title)}">
        <span class="stub__hud" aria-hidden="true"></span>
        <span class="stub__hud-r" aria-hidden="true"></span>
        <span class="stub__rule" aria-hidden="true"></span>
        <span class="stub__scan" aria-hidden="true"></span>
        <div class="stub__eyebrow">
          <span class="stub__code" aria-hidden="true">${ticketCode(t)}</span>
          <span>${esc(t.vendor)}</span><i aria-hidden="true">◆</i><span>${CATEGORY[t.category]}</span>
        </div>
        <h3 class="stub__title">${esc(t.title)}</h3>
        <p class="stub__amount"><span class="glitch" data-text="${esc(text)}">${esc(text)}</span>${dailyBadge(text, t.summary)}</p>
        ${summaryHtml(t)}
        <span class="stub__foil" aria-hidden="true"></span>
        <p class="stub__meta"><span>地区<b>${REGION[t.tags.region]}</b></span><span>收录<b>${t.publishedAt.slice(5)}</b></span><span>核验<b>${t.updatedAt.slice(5)}</b></span></p>
      </a>
      <div class="stub__side">
        <span class="stub__notch stub__notch--t" aria-hidden="true"></span>
        <span class="stub__notch stub__notch--b" aria-hidden="true"></span>
        <span class="stub__holo" aria-hidden="true"></span>
        <div class="stub__badge">
          <img class="stub__seal" src="${FONT_IMG}tier-${TIER_ASSET[tier]}.png" width="54" height="54" alt="推荐等级 ${tier}等">
        </div>
        <div class="stub__left" data-expiry="${esc(t.expiryDate)}">${timeBlock(t)}</div>
        <div class="stub__act">
          <a class="cta" href="${esc(t.link)}" target="_blank" rel="noopener noreferrer">去领取<span aria-hidden="true">›</span></a>
          ${barcode(t.id)}
          <span class="stub__serial">${serial(t)}</span>
        </div>
      </div>
    </article>`;
}

function parseContent(md) {
  const out = { lead: [], spec: [], stepsTitle: '领取步骤', steps: [], note: null, tail: [] };
  for (const raw of String(md ?? '').split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const bullet = /^[-*]\s+(.*)$/.exec(line);
    const step = /^\d+[.、]\s*(.*)$/.exec(line);
    const note = /^\*\*注意\*\*[:：]\s*(.*)$/.exec(line);
    if (bullet) {
      const kv = /^([^：:]{1,6})[：:]\s*(.+)$/.exec(bullet[1]);
      out.spec.push(kv ? { key: kv[1], value: kv[2] } : { key: null, value: bullet[1] });
    } else if (step) out.steps.push(step[1]);
    else if (note) out.note = out.note ? `${out.note}\n${note[1]}` : note[1];
    else if (/步骤[:：]$/.test(line)) out.stepsTitle = line.replace(/[:：]$/, '');
    else (out.steps.length || out.spec.length ? out.tail : out.lead).push(line);
  }
  return out;
}

/** 粮票详情弹框内容 */
function ticketSheet(t, listedTickets = []) {
  const backHref = '/tickets/';
  const tier = scoreTier(t.score);
  const text = highlight(t);
  const body = parseContent(t.content);
  const related = listedTickets
    .filter((x) => x.id !== t.id && (x.vendor === t.vendor || x.category === t.category))
    .slice(0, 4);
  const tip = `/tip/?from=/tickets/${t.id}/&type=rotten&ticket=${t.id}&title=${encodeURIComponent(t.title.slice(0, 120))}&url=${encodeURIComponent(t.link)}`;
  return {
    tier,
    urgent: isUrgent(t),
    html: `
    <div class="sheet__panel">
      <span class="sheet__scanline" aria-hidden="true"></span>
      <header class="sheet__bar">
        <span>${ticketCode(t)}</span><span>${serial(t)}</span>
        <a class="sheet__close" href="${backHref}" data-sheet-back>返回列表</a>
      </header>
      <div class="sheet__scroll">
        <section class="sheet__hero">
          <span class="stub__hud" aria-hidden="true"></span>
          <span class="stub__hud-r" aria-hidden="true"></span>
          <div>
            <p class="sheet__who">
              <span>${esc(t.vendor)}</span><i aria-hidden="true">◆</i><span>${CATEGORY[t.category]}</span><i aria-hidden="true">◆</i><span>${REGION[t.tags.region]}</span>
              ${t.affiliate ? '<span class="flag flag--ad">含推广</span>' : ''}
            </p>
            <h1 class="sheet__title">${esc(t.title)}</h1>
            <p class="sheet__big"><span class="glitch" data-text="${esc(text)}">${esc(text)}</span>${dailyBadge(text, t.summary)}</p>
            ${body.lead.map((p) => `<p class="sheet__lead">${inline(p)}</p>`).join('')}
          </div>
          <div class="sheet__stamp">
            <img class="stub__seal" src="${FONT_IMG}tier-${TIER_ASSET[tier]}.png" width="72" height="72" alt="推荐等级 ${tier}等">
            <div class="stub__left" data-expiry="${esc(t.expiryDate)}">${timeBlock(t)}</div>
          </div>
        </section>
        <div class="perf" aria-hidden="true"></div>
        ${body.spec.length ? `
        <section class="sheet__sec">
          <h3>票面条款 <small>${body.spec.length} 条</small></h3>
          <dl class="spec">${body.spec.map((r) => r.key ? `<dt>${esc(r.key)}</dt><dd>${inline(r.value)}</dd>` : `<dd class="is-wide">${inline(r.value)}</dd>`).join('')}</dl>
        </section>` : ''}
        ${body.steps.length || body.tail.length ? `
        <section class="sheet__sec">
          <h3>${esc(body.stepsTitle)} <small>${body.steps.length} 步</small></h3>
          <ol class="steps">${body.steps.map((s, k) => `<li style="--k:${k}">${inline(s)}</li>`).join('')}</ol>
          ${body.tail.map((p) => `<p>${inline(p)}</p>`).join('')}
        </section>` : ''}
        ${body.note ? `<aside class="sheet__note"><b>注意</b><div>${inline(body.note)}</div></aside>` : ''}
        <section class="sheet__sec">
          <h3>核实信息</h3>
          <dl class="ledger">
            <div><dt>首次收录</dt><dd>${t.publishedAt}</dd></div>
            <div><dt>最后编辑</dt><dd>${t.updatedAt}</dd></div>
            <div><dt>推荐等级</dt><dd>${tier}等</dd></div>
            <div><dt>期限</dt><dd>${t.expiryDate ? toBeijing(t.expiryDate) : (t.tags.duration === 'longterm' ? '长期' : '期限未提供')}</dd></div>
          </dl>
          <p class="fine">推荐等级为人工判断，不代表客观评测。</p>
        </section>
        ${related.length ? `
        <section class="sheet__sec">
          <h3>相关票</h3>
          <ul class="minis">${related.map((r) => `<li><a class="mini" data-tier="${scoreTier(r.score)}" href="/tickets/${esc(r.id)}/"><div><b>${esc(r.title)}</b><small>${esc(r.vendor)} · ${CATEGORY[r.category]}</small></div><span>${scoreTier(r.score)}等 ›</span></a></li>`).join('')}</ul>
        </section>` : ''}
      </div>
      <footer class="sheet__dock">
        <a href="${tip}">此票不作数？</a>
        ${barcode(t.id)}
        <a class="cta" href="${esc(t.link)}" target="_blank" rel="noopener noreferrer">去领取<span aria-hidden="true">›</span></a>
      </footer>
    </div>`,
  };
}

// ======================================================================
// 粮市
// ======================================================================

/** 推荐序分三档配色：1–3 甲 / 4–6 乙 / 其余与未评级丙（展示派生） */
function rankTier(rank) {
  if (typeof rank !== 'number') return '丙';
  if (rank <= 3) return '甲';
  if (rank <= 6) return '乙';
  return '丙';
}

function planSeal(rank, size) {
  if (typeof rank !== 'number') return '<span class="stub__seal" role="img" aria-label="未评级">未</span>';
  const grade = rankTier(rank);
  return `<img class="stub__seal" src="${FONT_IMG}tier-${TIER_ASSET[grade]}.png" width="${size}" height="${size}" alt="推荐等级 ${grade}等，推荐序 ${rank}">`;
}

/** 档位价文案：免费 / ¥118/月 */
function priceText(price, sym, period = 'month') {
  return price == null ? '价格未提供' : price === 0 ? '免费' : `${sym}${price}/${periodLabel(period)}`;
}

/** 起步价：offerType=standard 且 price>0 的最低档，与 format.js startingPrice 同口径 */
function startingPrice(plan) { return contractStartingPrice(plan)?.price ?? null; }


/** 促销 / 首购口径词，与 format.js tierOfferLabel 同口径 */
function dealLabel(tier) {
  return tier.offerType === 'new-user' ? '首购' : '限时';
}

/** 把促销 / 首购档并进同名常规档（「Lite 限时」→「Lite」）；配不上的促销档单独成行 */
function pairTiers(plan) {
  const rows = plan.tiers.filter((t) => t.offerType === 'standard').map((tier) => ({ tier, deal: null }));
  const orphans = [];
  for (const d of plan.tiers.filter((t) => t.offerType !== 'standard')) {
    const row = rows.find((r) => !r.deal && d.currency === r.tier.currency && d.period === r.tier.period && d.name.startsWith(`${r.tier.name} `));
    if (row) row.deal = d;
    else orphans.push({ tier: d, deal: null });
  }
  return [...rows, ...orphans];
}

/** 最低促销价：{ price, label }；没有促销档返回 null */
function bestDeal(plan) {
  const deals = plan.tiers.filter((t) => t.offerType !== 'standard' && t.price > 0);
  if (!deals.length) return null;
  const d = deals.reduce((a, b) => (a.price <= b.price ? a : b));
  return { price: d.price, label: dealLabel(d), sym: currencySymbol(d.currency), period: d.period };
}

/** 本市价格轴的对数区间：取本市所有正价档，两端各留一点余量 */
function marketDomain(list) {
  const groups = new Map();
  for (const plan of list) for (const tier of plan.tiers) {
    if (!(tier.price > 0)) continue;
    const key = `${tier.currency}/${tier.period}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(tier.price);
  }
  return Object.fromEntries([...groups].map(([key, prices]) => [key, {
    lo: Math.log(Math.min(...prices) * .85), hi: Math.log(Math.max(...prices) * 1.15),
  }]));
}

function planDomain(plan, domains) {
  const keys = [...new Set(plan.tiers.filter((t) => t.price > 0).map((t) => `${t.currency}/${t.period}`))];
  return keys.length === 1 ? domains?.[keys[0]] : null;
}

/** 价格 → 轴上百分比位置（左侧留 AXIS_PAD 给「免费」签） */
function pos(price, dom) {
  return AXIS_PAD + ((Math.log(price) - dom.lo) / (dom.hi - dom.lo)) * (100 - AXIS_PAD - 2);
}

/** 厂商图标；无映射时降级为首字 */
function iconHtml(plan, size = 24) {
  if (!plan.icon) return `<span class="icon" aria-hidden="true">${esc(plan.vendor.slice(0, 1))}</span>`;
  return `<img class="icon ${plan.icon.mono ? 'icon--mono' : ''}" src="${esc(plan.icon.url)}" width="${size}" height="${size}" style="width:${size}px;height:${size}px" alt="">`;
}

/** 模型 / 工具芯片：最多 limit 枚，余下折成 +N */
function chipsHtml(items, limit = Infinity) {
  if (!items.length) return '<span class="fine">未提供</span>';
  const rest = items.length - limit;
  return `<ul class="chips">${items.slice(0, limit).map((m) => `<li>${esc(m)}</li>`).join('')}${rest > 0 ? `<li>+${rest}</li>` : ''}</ul>`;
}

/** 起步价块公共数据 */
function priceInfo(plan) {
  const start = startingPrice(plan);
  const tier = plan.tiers.find((t) => t.offerType === 'standard' && t.price === start && start !== null);
  const sym = tier ? currencySymbol(tier.currency) : MARKET[plan.group].sym;
  const period = tier ? periodLabel(tier.period) : null;
  return { sym, start, period, free: hasFreeTier(plan), deal: bestDeal(plan), startText: start === null ? '未提供' : `${sym}${start}` };
}

/** 档位提示文案 */
function tierTip(tier) {
  return esc(`<b>${esc(tier.name)}</b> · ${priceText(tier.price, currencySymbol(tier.currency), tier.period)}${tier.note ? `<br>${esc(tier.note)}` : ''}`);
}

/** 秤杆上的点、线、免费签（卡片与弹框共用） */
function beamParts(plan, dom) {
  dom = planDomain(plan, dom);
  if (!dom) return '<p class="fine">按各档币种与周期查看价格</p>';
  const paid = plan.tiers.filter((t) => t.offerType === 'standard' && t.price > 0).map((t) => t.price);
  const parts = [];
  if (paid.length) {
    const a = pos(Math.min(...paid), dom);
    parts.push(`<span class="beam__span" style="left:${a}%;width:${Math.max(pos(Math.max(...paid), dom) - a, .6)}%"></span>`);
  }
  sortedTiers(plan).forEach(({ tier, deal }, k) => {
    if (tier.price === 0) { parts.push(`<span class="beam__free" data-k="${k}" data-tip="${tierTip(tier)}">免费</span>`); return; }
    if (tier.price === null) return;
    const x = pos(tier.price, dom);
    parts.push(`<span class="${tier.offerType === 'standard' ? 'beam__tick' : 'beam__deal'}" data-k="${k}" style="left:${x}%;--k:${k}" data-tip="${tierTip(tier)}"></span>`);
    if (deal && deal.price > 0) {
      const dx = pos(deal.price, dom);
      parts.push(`<span class="beam__link" data-k="${k}" style="left:${Math.min(x, dx)}%;width:${Math.abs(x - dx)}%"></span>`);
      parts.push(`<span class="beam__deal" data-k="${k}" style="left:${dx}%;--k:${k}" data-tip="${tierTip(deal)}"></span>`);
    }
  });
  const label = `档位刻度：${sortedTiers(plan).map(({ tier }) => `${tier.name} ${priceText(tier.price, currencySymbol(tier.currency), tier.period)}`).join('，')}`;
  return `<div class="beam" role="img" aria-label="${esc(label)}"><span class="beam__rod"></span>${parts.join('')}</div>`;
}

/** 档位按价升序（免费档在最前）；秤杆点与价签用同一序号 data-k 对应 */
function sortedTiers(plan) {
  return pairTiers(plan).sort((a, b) => (a.tier.price ?? Infinity) - (b.tier.price ?? Infinity));
}

/** 秤杆下的档位价签：档名 + 价格，促销档写成「原价划掉 → 促销价 + 口径」，起步档描亮 */
function tierTags(plan) {
  const start = startingPrice(plan);
  const items = sortedTiers(plan).map(({ tier, deal }, k) => {
    const sym = currencySymbol(tier.currency);
    const isStart = start !== null && tier.offerType === 'standard' && tier.price === start;
    const price = tier.price === null ? '<b>未提供</b>' : tier.price === 0
      ? '<b>免费</b>'
      : deal && deal.price !== null
        ? `<s>${sym}${tier.price}</s><b class="is-deal">${sym}${deal.price}</b><i>${dealLabel(deal)}</i>`
        : `<b>${sym}${tier.price}</b>${tier.offerType !== 'standard' ? `<i>${dealLabel(tier)}</i>` : ''}`;
    return `<li data-k="${k}" ${isStart ? 'data-start' : ''} ${tier.price === 0 ? 'data-free' : ''}><a class="tag" data-k="${k}" data-tip="${tierTip(deal ?? tier)}" href="/plans/${esc(plan.id)}/" title="查看${esc(plan.product)}档位全表"><span>${esc(tier.name)}</span>${price}${tier.period === 'year' ? '<i>年付</i>' : ''}</a></li>`;
  });
  return `<ul class="tags" aria-label="档位价格">${items.join('')}</ul>`;
}

/** 套餐票码：PLAN//CN-01 */
function planCode(plan) {
  return `PLAN//${MARKET[plan.group].code}-${String(plan.rank ?? 0).padStart(2, '0')}`;
}

/** 渲染一张套餐票根卡 */
function planStub(plan, i, dom) {
  const { startText, free, deal, period } = priceInfo(plan);
  const rank = plan.rank;
  const grade = rankTier(rank);
  return `
    <article class="stub stub--plan" data-tier="${grade}" style="--i:${i}">
      <div class="stub__main">
        <span class="stub__hud" aria-hidden="true"></span>
        <span class="stub__hud-r" aria-hidden="true"></span>
        <span class="stub__rule" aria-hidden="true"></span>
        <span class="stub__scan" aria-hidden="true"></span>
        <div class="stub__eyebrow">
          <span class="stub__code" aria-hidden="true">${planCode(plan)}</span>
          ${iconHtml(plan)}<span>${esc(plan.vendor)}</span>
          ${plan.status !== 'available' ? `<span class="flag flag--off">${planStatusLabel(plan.status)}</span>` : ''}
        </div>
        <h3 class="stub__title"><a href="/plans/${esc(plan.id)}/">${esc(plan.product)}</a></h3>
        ${plan.rankBasis ? `<p class="stub__why">「${esc(plan.rankBasis)}」</p>` : ''}
        <p class="stub__quota"><span>额度</span>${esc(plan.quotaBasis ?? "未提供")}</p>
        ${beamParts(plan, dom)}
        ${tierTags(plan)}
        <span class="stub__foil" aria-hidden="true"></span>
        ${chipsHtml(plan.models, 4)}
      </div>
      <div class="stub__side">
        <span class="stub__notch stub__notch--t" aria-hidden="true"></span>
        <span class="stub__notch stub__notch--b" aria-hidden="true"></span>
        <span class="stub__holo" aria-hidden="true"></span>
        ${planSeal(rank, 54)}
        <div class="stub__price">
          <span class="glitch" data-text="${startText}">${startText}</span>
          ${period ? `<small>${free ? '付费档 ' : ''}/${period}起</small>` : ''}
        </div>
        ${deal ? `<span class="tag-deal">${deal.label}低至 ${deal.sym}${deal.price}${deal.period === 'year' ? '/年' : ''}</span>` : ''}
        <div class="stub__act">
          <a class="cta" href="/plans/${esc(plan.id)}/">看档位<span aria-hidden="true">›</span></a>
          ${barcode(plan.id)}
          <span class="stub__serial">核验 ${plan.updatedAt.slice(5)}</span>
        </div>
      </div>
    </article>`;
}

/** 弹框里的大秤杆：在卡片秤杆上加档名 / 价格刻度，上下交错防挤 */
function scaleHtml(plan, dom) {
  const axis = planDomain(plan, dom);
  if (!axis) return '<p class="fine">暂无可共用的价格刻度，请查看各档原始报价。</p>';
  const labels = pairTiers(plan)
    .flatMap(({ tier, deal }) => [tier, deal].filter(Boolean))
    .filter((t) => t.price > 0)
    .sort((a, b) => a.price - b.price)
    .map((t, k) => `<span class="scale__lab ${k % 2 ? 'is-down' : 'is-up'} ${t.offerType !== 'standard' ? 'is-deal' : ''}" style="left:${pos(t.price, axis)}%">${k % 2 ? '' : `<b>${esc(t.name)}</b>`}${currencySymbol(t.currency)}${t.price}${t.period === 'year' ? '/年' : ''}${k % 2 ? `<b>${esc(t.name)}</b>` : ''}</span>`)
    .join('');
  return `<div class="scale">${labels}${beamParts(plan, dom)}</div>`;
}

/** 套餐详情弹框内容 */
function planSheet(plan, dom) {
  const backHref = '/plans/';
  const { startText, free, deal, period } = priceInfo(plan);
  const grade = rankTier(plan.rank);
  const start = startingPrice(plan);
  const rows = pairTiers(plan).sort((a, b) => (a.tier.price ?? Infinity) - (b.tier.price ?? Infinity));
  const conds = [...new Set(plan.tiers.map((t) => t.conditions).filter(Boolean))];
  const shared = conds.length === 1 ? conds[0] : null;
  let host = plan.sourceUrl;
  try { host = new URL(plan.sourceUrl).host; } catch { host = plan.sourceUrl || '来源未提供'; }
  const tip = `/tip/?from=/plans/${plan.id}/&type=feedback&title=${encodeURIComponent(`${plan.vendor} ${plan.product}`.slice(0, 120))}&url=${encodeURIComponent(`https://saiboliang.top/plans/${plan.id}/`)}`;
  const tierCard = ({ tier, deal: d }, k) => `
    <section class="tier" style="--k:${k}" ${start !== null && tier.offerType === 'standard' && tier.price === start ? 'data-start' : ''}>
      <h4>${esc(tier.name)}</h4>
      <p class="tier__price ${tier.price === 0 ? 'is-free' : ''}">${tier.price === null ? '未提供' : tier.price === 0 ? '免费' : `${currencySymbol(tier.currency)}${tier.price}<small>/${periodLabel(tier.period)}</small>`}</p>
      ${d && d.price !== null ? `<p class="tier__deal"><s>${currencySymbol(tier.currency)}${tier.price}</s><b>${currencySymbol(d.currency)}${d.price}</b><i>${dealLabel(d)}</i></p>` : tier.offerType !== 'standard' ? `<p class="tier__deal"><i>${dealLabel(tier)}</i></p>` : ''}
      ${[...new Set([tier.note, d?.note].filter(Boolean))].map((note) => `<p class="tier__note">${esc(note)}</p>`).join('')}
      ${tier.features?.length ? `<ul>${tier.features.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>` : ''}
      ${d?.conditions && d.conditions !== tier.conditions ? `<p class="basis"><b>${dealLabel(d)}条件</b><span>${linkify(d.conditions)}</span></p>` : ''}
      ${d?.features?.filter((f) => !tier.features?.includes(f)).length ? `<ul>${d.features.filter((f) => !tier.features?.includes(f)).map((f) => `<li>${inline(f)}</li>`).join('')}</ul>` : ''}
      ${!shared && tier.conditions ? `<p class="basis"><b>价格依据</b><span>${linkify(tier.conditions)}</span></p>` : ''}
    </section>`;
  return {
    tier: grade,
    urgent: false,
    html: `
    <div class="sheet__panel">
      <span class="sheet__scanline" aria-hidden="true"></span>
      <header class="sheet__bar">
        <span>${planCode(plan)}</span><span>核验 ${plan.updatedAt}</span>
        <a class="sheet__close" href="${backHref}" data-sheet-back>返回列表</a>
      </header>
      <div class="sheet__scroll">
        <section class="sheet__hero">
          <span class="stub__hud" aria-hidden="true"></span>
          <span class="stub__hud-r" aria-hidden="true"></span>
          <div>
            <p class="sheet__who">
              ${iconHtml(plan, 28)}<span>${esc(plan.vendor)}</span><i aria-hidden="true">◆</i><span>${MARKET[plan.group].name}</span>
              ${plan.status !== 'available' ? `<span class="flag flag--off">${planStatusLabel(plan.status)}</span>` : ''}
              ${plan.source === 'aggregator' ? '<span class="flag flag--src">第三方价</span>' : ''}
            </p>
            <h1 class="sheet__title">${esc(plan.product)}</h1>
            ${plan.tagline ? `<p class="sheet__lead">${esc(plan.tagline)}</p>` : ''}
            ${plan.rankBasis ? `<p class="sheet__quote">「${esc(plan.rankBasis)}」</p>` : ''}
          </div>
          <div class="sheet__stamp">
            ${planSeal(plan.rank, 72)}
            <div class="stub__price">
              ${free ? '<span class="tag-free">有免费档</span>' : ''}
              <span class="glitch" data-text="${startText}">${startText}</span>
              ${period ? `<small>常规${free ? '付费' : ''}档 /${period}起</small>` : ''}
            </div>
            ${deal ? `<span class="tag-deal">${deal.label}低至 ${deal.sym}${deal.price}${deal.period === 'year' ? '/年' : ''}</span>` : ''}
          </div>
        </section>
        <div class="perf" aria-hidden="true"></div>
        <section class="sheet__sec">
          <h3>秤杆 <small>与本市其他套餐同一刻度</small></h3>
          ${scaleHtml(plan, dom)}
        </section>
        <section class="sheet__sec">
          <h3>档位与额度 <small>${rows.length} 档 · 额度 ${esc(plan.quotaBasis ?? "未提供")}</small></h3>
          <div class="tiers">${rows.map(tierCard).join('')}</div>
          ${shared ? `<p class="basis"><b>价格依据</b><span>${linkify(shared)}</span></p>` : ''}
        </section>
        ${plan.highlights?.length ? `
        <section class="sheet__sec">
          <h3>亮点</h3>
          <ul class="perks">${plan.highlights.map((h) => `<li>${esc(h)}</li>`).join('')}</ul>
        </section>` : ''}
        <section class="sheet__sec">
          <h3>模型与工具</h3>
          <div class="pair"><span>可用模型</span>${chipsHtml(plan.models)}</div>
          <div class="pair"><span>支持工具</span>${chipsHtml(plan.supportedTools ?? [])}</div>
          <p class="evidence">
            ${plan.source === 'aggregator' ? '官方页' : '价格依据'}：<a href="${esc(plan.sourceUrl)}" target="_blank" rel="noopener noreferrer">${esc(host)} ↗</a><i>·</i>${plan.source === 'aggregator' ? '第三方整理价' : '官方页标价'}<i>·</i>核验于 ${plan.updatedAt}<i>·</i>购买前以<strong>官方结算页</strong>为准
          </p>
        </section>
      </div>
      <footer class="sheet__dock">
        <a href="${tip}">信息有误？</a>
        ${barcode(plan.id)}
        <a class="cta" href="${esc(plan.sourceUrl)}" target="_blank" rel="noopener noreferrer">去订阅<span aria-hidden="true">›</span></a>
      </footer>
    </div>`,
  };
}

// 统一命名空间，避免实验稿的短类名影响站点其他组件。
function namespace(html) {
  return html.replace(/class="([^"]+)"/g, (_, names) => `class="${names.split(/\s+/).filter(Boolean).map((name) => `r4-${name}`).join(' ')}"`);
}
export const renderTicketCard = (ticket, index = 0) => namespace(ticketStub(ticket, index));
export const renderPlanCard = (plan, index, domain) => namespace(planStub(plan, index, domain));
export const renderTicketSheet = (ticket, related) => {
  const view = ticketSheet(ticket, related);
  return { ...view, html: namespace(view.html) };
};
export const renderPlanSheet = (plan, domain) => {
  const view = planSheet(plan, domain);
  return { ...view, html: namespace(view.html) };
};
export { marketDomain };
