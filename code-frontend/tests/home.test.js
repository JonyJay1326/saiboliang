import assert from 'node:assert/strict';
import test from 'node:test';
import { homeContent, homePlanPrice } from '../src/lib/home.js';

const now = new Date('2026-10-02T12:00:00+08:00');
const ticket = (id, overrides = {}) => ({ id, score: 85, publishedAt: '2026-09-28', expired: false, expiryDate: null, affiliate: false, ...overrides });
const plan = (id, group, rank, price = 20) => ({ id, group, rank, tiers: [{ name: '常规', offerType: 'standard', price, currency: group === 'domestic' ? 'CNY' : 'USD', period: 'month' }] });

test('口粮同源排序且不重复，失效、低分和过期票不上架', () => {
  const file = { tickets: [ticket('low', { score: 69 }), ticket('expired', { expired: true }), ticket('overdue', { expiryDate: '2026-10-01T00:00:00+08:00' }), ticket('b'), ticket('a'), ticket('best', { score: 95 }), ticket('new', { publishedAt: '2026-10-01' }), ticket('fifth', { score: 80 })] };
  const before = structuredClone(file);
  const result = homeContent(file, {}, {}, now);
  assert.deepEqual(result.listed.map((item) => item.id), ['best', 'new', 'a', 'b', 'fifth']);
  assert.ok(result.listed.some((item) => item.id === result.headTicket.id));
  assert.deepEqual(result.restTickets.map((item) => item.id), result.listed.filter((item) => item.id !== result.headTicket.id).slice(0, 3).map((item) => item.id));
  assert.equal(new Set([result.headTicket, ...result.restTickets].map((item) => item.id)).size, 4);
  assert.equal(result.listed.length, 5);
  assert.deepEqual(file, before);
});

test('推广票不占主票；高分非推广票按日完整轮换，输入顺序不影响选择', () => {
  const items = [ticket('advert', { score: 99, affiliate: true }), ticket('a'), ticket('b'), ticket('c')];
  const selected = [];
  for (let day = 2; day < 5; day++) {
    const date = new Date(`2026-10-0${day}T12:00:00+08:00`);
    const result = homeContent({ tickets: items }, {}, {}, date);
    selected.push(result.headTicket.id);
    assert.equal(result.headTicket.affiliate, false);
    assert.equal(result.restTickets[0].id, 'advert');
    assert.equal(homeContent({ tickets: [...items].reverse() }, {}, {}, date).headTicket.id, result.headTicket.id);
  }
  assert.deepEqual([...selected].sort(), ['a', 'b', 'c']);
});

test('主票门槛包含 80 分，79 分票保留上架但不参与轮换', () => {
  const file = { tickets: [ticket('below', { score: 79 }), ticket('threshold', { score: 80 })] };
  const result = homeContent(file, {}, {}, now);
  assert.equal(result.headTicket.id, 'threshold');
  assert.deepEqual(result.restTickets.map((item) => item.id), ['below']);
  const noCandidate = homeContent({ tickets: [ticket('below', { score: 79 })] }, {}, {}, now);
  assert.equal(noCandidate.headTicket, null);
  assert.equal(noCandidate.listed.length, 1);
  assert.equal(noCandidate.restTickets[0].id, 'below');
});

test('主票只轮换推荐序前五张，不足五张不补位', () => {
  const items = Array.from({ length: 6 }, (_, index) => ticket(`t-${index}`, { score: 90 - index }));
  const selected = [];
  for (let day = 2; day < 7; day++) {
    const result = homeContent({ tickets: [...items].reverse() }, {}, {}, new Date(`2026-10-0${day}T12:00:00+08:00`));
    selected.push(result.headTicket.id);
    assert.equal(result.listed.length, 6);
  }
  assert.deepEqual([...selected].sort(), ['t-0', 't-1', 't-2', 't-3', 't-4']);
  assert.equal(homeContent({ tickets: [ticket('only')] }, {}, {}, now).headTicket.id, 'only');
});

test('轮换以北京时间零点为边界，同一天不会随刷新变动', () => {
  const file = { tickets: [ticket('a'), ticket('b'), ticket('c')] };
  const select = (date) => homeContent(file, {}, {}, new Date(date)).headTicket.id;
  assert.equal(select('2026-10-01T16:00:00Z'), select('2026-10-02T15:59:59Z'));
  assert.notEqual(select('2026-10-02T15:59:59Z'), select('2026-10-02T16:00:00Z'));
});

test('只有推广票或缺少推广标记时保留普通票区，不回退到推广主票', () => {
  const result = homeContent({ tickets: [ticket('advert', { affiliate: true }), ticket('unknown', { affiliate: undefined })] }, {}, {}, now);
  assert.equal(result.headTicket, null);
  assert.deepEqual(result.restTickets.map((item) => item.id), ['advert', 'unknown']);
});

test('各市按编辑推荐序排序后交错，不按跨市价格排列', () => {
  const file = { plans: [plan('east-2', 'domestic', 2, 1), plan('west-1', 'overseas', 1, 200), plan('east-1', 'domestic', 1, 100), plan('west-2', 'overseas', 2, 2), plan('east-3', 'domestic', 3), plan('west-3', 'overseas', 3)] };
  const before = structuredClone(file);
  assert.deepEqual(homeContent({}, file, {}, now).marketTop.map((item) => item.id), ['east-1', 'west-1', 'east-2', 'west-2', 'east-3']);
  assert.deepEqual(file, before);
});

test('单市为空时正常填充；全部空数据保留空状态', () => {
  assert.deepEqual(homeContent({}, { plans: [plan('b', 'overseas', 2), plan('a', 'overseas', 1)] }, {}, now).marketTop.map((item) => item.id), ['a', 'b']);
  const empty = homeContent({}, {}, {}, now);
  assert.equal(empty.headTicket, null);
  for (const key of ['restTickets', 'marketTop', 'modelTop', 'ghTop']) assert.deepEqual(empty[key], []);
  assert.equal(empty.oldest, null);
});

test('起步价排除免费、首购和促销，保留年付周期与币种', () => {
  const item = { tiers: [{ offerType: 'promotion', price: 5, currency: 'USD', period: 'month' }, { offerType: 'new-user', price: 1, currency: 'USD', period: 'month' }, { offerType: 'standard', price: 0, currency: 'USD', period: 'month' }, { offerType: 'standard', price: 120, currency: 'USD', period: 'year' }] };
  assert.equal(homePlanPrice(item), '$120/年起');
  assert.equal(homePlanPrice(plan('east', 'domestic', 1, 49)), '¥49/月起');
  assert.equal(homePlanPrice({ tiers: [{ offerType: 'standard', price: null }] }), '常规价未提供');
  assert.equal(homePlanPrice(null), '常规价未提供');
});

test('摘要遵守数量上限，核验时间取实际消费文件最旧批次', () => {
  const result = homeContent({ dataUpdatedAt: '2026-10-02T00:00:00Z' }, { dataUpdatedAt: '2026-09-29T00:00:00Z', rankings: { intelligence: Array.from({ length: 8 }, (_, i) => ({ modelId: `m-${i}`, score: i, rank: i + 1 })) } }, { dataUpdatedAt: '2026-10-01T00:00:00Z', week: { items: Array.from({ length: 12 }, (_, i) => ({ repo: `r-${i}` })) } }, now);
  assert.equal(result.oldest, '2026-09-29T00:00:00Z');
  assert.equal(result.modelTop.length, 5);
  assert.equal(result.ghTop.length, 10);
  assert.equal(result.modelById.get('m-0'), undefined);
});
