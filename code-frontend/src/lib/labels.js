// 枚举的中文标签。Astro 与 Vue 两端共用同一份，避免重复维护（TASKS.md F7）。

export const CATEGORY = {
  'api-quota': 'API 额度',
  token: 'Token',
  credits: '积分',
};

export const REGION = {
  cn: '国内',
  global: '全球',
  'overseas-only': '仅海外',
  unknown: '地区未提供',
};

export const DURATION = {
  limited: '限时',
  longterm: '长期',
  unknown: '未知',
};

// 事件类型角标（frontend-spec.md §5.5 / §8）：与契约 eventType 枚举一一对应。
// 2026-09-24 用户拍板：原 `action-required`（旧文案「需行动」读者看不懂）一分为二——
// `security-risk`「安全风险」（漏洞 / 数据泄露 / 安全公告）与 `service-retirement`「停服·迁移」
// （服务或模型停用、下线、弃用，可能要迁移）。契约 `cyber-granary-data-contract.md` §4.5 同批改。
export const EVENT_TYPE = {
  'security-risk': '安全风险',
  'service-retirement': '停服·迁移',
  'model-release': '模型发布',
  'major-update': '重要更新',
  'price-or-free': '价格·免费',
  upcoming: '官方预告',
  'model-review': '评测',
  'hands-on': '产品体验',
  'deep-analysis': '深度分析',
};

export const SORT_VIEWS = [
  { key: 'default', label: '默认' },
  { key: 'newest', label: '最新' },
  { key: 'score', label: '等级最高' },
];
