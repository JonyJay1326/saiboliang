// 只做「时间与数字的展示口径」，不含任何视觉决策。
// 契约 §1：时间字段存 UTC，展示层转北京时间；「今天」「本周新增」统一按 Asia/Shanghai 计算。

const SHANGHAI_OFFSET_MINUTES = 8 * 60;

function pad(n) {
  return String(n).padStart(2, '0');
}

/** UTC ISO 时间戳 → 北京时间 'YYYY-MM-DD HH:mm'；null/无效返回 null。 */
export function toBeijing(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const t = new Date(d.getTime() + SHANGHAI_OFFSET_MINUTES * 60_000);
  return (
    `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())} ` +
    `${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}`
  );
}

/** 北京时间「今天」的 YYYY-MM-DD。 */
export function shanghaiToday(now = new Date()) {
  const t = new Date(now.getTime() + SHANGHAI_OFFSET_MINUTES * 60_000);
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

const CN_DIGITS = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'];

/** 1–31 的中文数字：十 / 十一 / 二十 / 三十一。 */
function cnNumber(n) {
  if (n <= 10) return n === 10 ? '十' : CN_DIGITS[n];
  if (n < 20) return `十${CN_DIGITS[n - 10]}`;
  return `${CN_DIGITS[Math.floor(n / 10)]}十${n % 10 ? CN_DIGITS[n % 10] : ''}`;
}

/** 邸报日期（北京时间自然日）：「九月十六」「九月一日」；null/无效返回 null。 */
export function dibaoDate(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const t = new Date(d.getTime() + SHANGHAI_OFFSET_MINUTES * 60_000);
  const day = t.getUTCDate();
  return `${cnNumber(t.getUTCMonth() + 1)}月${day <= 10 ? `${cnNumber(day)}日` : cnNumber(day)}`;
}

/** 数字千分位；null/非数字返回 null。 */
export function thous(n) {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return null;
  return Number(n).toLocaleString('en-US');
}

/** 契约 §1.1 新鲜度：null → 尚未核验；>24h 提醒；>72h 明显提示。 */
export function freshness(dataUpdatedAt, now = new Date()) {
  if (!dataUpdatedAt) return { level: 'none', text: '尚未核验' };
  const hours = (now.getTime() - new Date(dataUpdatedAt).getTime()) / 3_600_000;
  if (hours > 72) return { level: 'stale', text: `更新于 ${Math.floor(hours / 24)} 天前` };
  if (hours > 24) return { level: 'warn', text: `更新于 ${Math.floor(hours / 24)} 天前` };
  return { level: 'ok', text: `更新于 ${toBeijing(dataUpdatedAt)?.slice(11) ?? ''}` };
}

/** 契约 §3：overdue 前端只读派生。 */
export function overdue(ticket, now = new Date()) {
  if (!ticket?.expiryDate) return false;
  return new Date(ticket.expiryDate).getTime() < now.getTime();
}

/** 契约 §3：期限展示口径。 */
export function durationLabel(ticket) {
  if (ticket?.expiryDate) return toBeijing(ticket.expiryDate);
  return ticket?.tags?.duration === 'longterm' ? '长期有效（以官方为准）' : '期限未提供';
}

/** 前端只读派生：在架票数 = expired === false 的条数（契约 §4.2 / §5.2）。 */
export function activeCount(list) {
  return list.filter((t) => t.expired === false).length;
}

/** 前端只读派生：本周新增 = publishedAt 落在北京时间本周一至今天（契约 §4.2 / §5.2）。 */
export function addedThisWeek(list, now = new Date()) {
  const t = new Date(now.getTime() + SHANGHAI_OFFSET_MINUTES * 60_000);
  const since = new Date(t.getTime() - ((t.getUTCDay() + 6) % 7) * 86_400_000);
  const from = `${since.getUTCFullYear()}-${pad(since.getUTCMonth() + 1)}-${pad(since.getUTCDate())}`;
  const to = shanghaiToday(now);
  return list.filter((x) => x.publishedAt >= from && x.publishedAt <= to);
}

/** 契约 §3.4：票号 = No. {publishedAt 月日 4 位}-{id 的 3 位 hash}。 */
export function serial(ticket) {
  const md = String(ticket?.publishedAt ?? '').slice(5, 10).replace('-', '');
  let h = 0;
  for (const ch of String(ticket?.id ?? '')) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  const hex = h.toString(16).slice(-3).toUpperCase().padStart(3, '0');
  return `No. ${md}-${hex}`;
}

/** 契约 §4.2：票证默认排序 —— expired 升序 → score 降序 → publishedAt 降序 → id 升序。 */
export function ticketDefaultOrder(a, b) {
  if (a.expired !== b.expired) return a.expired ? 1 : -1;
  if (a.score !== b.score) return b.score - a.score;
  if (a.publishedAt !== b.publishedAt) return a.publishedAt < b.publishedAt ? 1 : -1;
  return a.id < b.id ? -1 : 1;
}

/** 契约 §3：失效态章面 / 文字层用词。 */
export function expiredLabel(ticket) {
  return ticket?.expiryDate ? '已作废' : '已结束';
}

/**
 * 推荐分展示分档（2026-09-18 用户定，前端只读派生）：
 * 甲等 = >90；乙等 = 80–90；丙等 = 70–79；<70 不上架（返回 null）。
 * 用老票证/执照的甲乙丙分等，贴合站点「古意 · 批号感」。
 */
export function scoreTier(score) {
  if (typeof score !== 'number') return null;
  if (score > 90) return '甲';
  if (score >= 80) return '乙';
  if (score >= 70) return '丙';
  return null;
}

/**
 * 上架票证（2026-09-18 用户定）：
 * 推荐分 ≥70 且未失效；<70 与已失效全站不展示（含详情页不生成、sitemap 排除）。
 */
export function listedTickets(list) {
  return list.filter((t) => t.expired !== true && scoreTier(t.score) !== null);
}

// ---------------------------------------------------------------- 模型（/models）

/** 模型报价展示（USD / 百万 Token）：`$10`、`$0.15`；null 显示「—」。 */
export function usdPrice(n) {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return '—';
  return `$${Number(n)}`;
}

/** 契约 §4.3：输入 / 输出俸禄展示；两者均无报价时统一显示「暂无对应报价」。 */
export function modelPriceLabel(model) {
  if (!model || (model.inputCost === null && model.outputCost === null)) return '暂无对应报价';
  return `${usdPrice(model.inputCost)} / ${usdPrice(model.outputCost)}`;
}

/** 前端只读派生：距榜首 = 榜首 score − 本行 score（同榜内，取两位内差值，去浮点噪声）。 */
export function scoreGap(topScore, score) {
  const gap = Math.round((Number(topScore) - Number(score)) * 100) / 100;
  if (Number.isNaN(gap)) return '—';
  return gap > 0 ? `-${gap}` : `${gap}`;
}

// ---------------------------------------------------------------- 套餐（/plans）

/** 币种符号。契约只允许 CNY / USD。 */
export function currencySymbol(currency) {
  return currency === 'CNY' ? '¥' : currency === 'USD' ? '$' : '';
}

/** 周期中文。 */
export function periodLabel(period) {
  return period === 'year' ? '年' : '月';
}

/** 档位价格标签：¥118/月、$10/月；price 为 null 显示「未提供」。 */
export function tierPrice(tier) {
  if (tier?.price === null || tier?.price === undefined) return '未提供';
  return `${currencySymbol(tier.currency)}${tier.price}/${periodLabel(tier.period)}`;
}

/**
 * 起步价（前端只读派生，契约 §5.2）：
 * 同套餐内 `offerType=standard` 且 `price>0` 的最低档；排除免费档与促销/新用户档。
 * 返回 { price, currency } 或 null。
 */
export function startingPrice(plan) {
  const standard = (plan?.tiers ?? []).filter(
    (t) => t.offerType === 'standard' && typeof t.price === 'number' && t.price > 0
  );
  if (standard.length === 0) return null;
  const min = standard.reduce((a, b) => (a.price <= b.price ? a : b));
  return { price: min.price, currency: min.currency };
}

/** 起步价展示：`¥118/月起`；无常规价时显示「价格未提供」。 */
export function startingPriceLabel(plan) {
  const start = startingPrice(plan);
  if (!start) return '价格未提供';
  return `${currencySymbol(start.currency)}${start.price}/月起`;
}

/** 排序用：起步价数值，无价视为正无穷（排最后）。 */
export function startingPriceValue(plan) {
  return startingPrice(plan)?.price ?? Number.POSITIVE_INFINITY;
}

/** 排序用：编辑推荐序 `rank`，缺省视为正无穷（排最后）。契约 §4.3。 */
export function planRankValue(plan) {
  return typeof plan?.rank === 'number' ? plan.rank : Number.POSITIVE_INFINITY;
}

/** 契约 §4.3 的 status → 状态角标文案。 */
export function planStatusLabel(status) {
  if (status === 'available') return '可购买';
  if (status === 'unavailable') return '暂不可购';
  return '状态未核实';
}

/** 契约 §4.3 的 source → 来源标记；official 时不显示。 */
export function planSourceLabel(source) {
  return source === 'aggregator' ? '数据来源：第三方整理，以官方页为准' : null;
}
