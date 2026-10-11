// 枚举的中文标签。Astro 与 Vue 两端共用同一份，避免重复维护（TASKS.md F7）。
// 只保留实际有消费方的枚举：DURATION（契约 §3 时长）与 SORT_VIEWS（筛选档位）随
// /tickets 筛选区于 2026-09-21 撤除后已无引用，一并删除（2026-09-30 死代码清理）。

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
