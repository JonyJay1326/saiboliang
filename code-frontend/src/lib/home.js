import { currencySymbol, listedTickets, periodLabel, planRankValue, startingPrice, startingPriceValue, ticketDefaultOrder } from './format.js';

/** 保留所选常规档的付款周期，不把年付总额标成月价。 */
export function homePlanPrice(plan) {
  const start = startingPrice(plan);
  if (!start) return '常规价未提供';
  const tier = plan.tiers.find((item) => item.offerType === 'standard' && item.price === start.price && item.currency === start.currency);
  return `${currencySymbol(start.currency)}${start.price}/${periodLabel(tier.period)}起`;
}

/** 两市独立排序后交错取样，不产生跨市排名，不修改输入批次。 */
export function homeContent(ticketFile, modelFile, githubFile, now = new Date()) {
  const listed = listedTickets(ticketFile.tickets ?? [], now).sort(ticketDefaultOrder);
  const rotationPool = listed.filter((ticket) => ticket.affiliate === false && ticket.score >= 80).slice(0, 5);
  // 北京时间跨日后轮换，同一日、同一批次保持稳定；仅取高分非推广票的前五张。
  const beijingDay = Math.floor((now.getTime() + 8 * 60 * 60 * 1000) / (24 * 60 * 60 * 1000));
  const headTicket = rotationPool.length ? rotationPool[beijingDay % rotationPool.length] : null;
  const markets = ['domestic', 'overseas'].map((group) => ({
    group,
    items: (modelFile.plans ?? []).filter((plan) => plan.group === group).sort((a, b) =>
      planRankValue(a) - planRankValue(b) || startingPriceValue(a) - startingPriceValue(b) || a.id.localeCompare(b.id)
    ),
  }));
  const marketTop = [];
  for (let index = 0; index < Math.max(...markets.map((market) => market.items.length)) && marketTop.length < 5; index++) {
    for (const market of markets) {
      if (market.items[index] && marketTop.length < 5) marketTop.push(market.items[index]);
    }
  }
  return {
    listed,
    headTicket,
    restTickets: listed.filter((ticket) => ticket.id !== headTicket?.id).slice(0, 3),
    markets,
    marketTop,
    ghTop: (githubFile.week?.items ?? []).slice(0, 10),
    modelTop: (modelFile.rankings?.intelligence ?? []).slice(0, 5),
    modelById: new Map((modelFile.models ?? []).map((model) => [model.id, model])),
    oldest: [ticketFile.dataUpdatedAt, modelFile.dataUpdatedAt, githubFile.dataUpdatedAt].filter(Boolean).sort()[0] ?? null,
  };
}
