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

export const EVENT_TYPE = {
  'action-required': '需行动',
  'model-release': '模型发布',
  'major-update': '重要更新',
  'price-or-free': '价格·免费',
  'model-review': '评测',
  'hands-on': '产品体验',
  'deep-analysis': '深度分析',
};

export const SORT_VIEWS = [
  { key: 'default', label: '默认' },
  { key: 'newest', label: '最新' },
  { key: 'score', label: '等级最高' },
];
