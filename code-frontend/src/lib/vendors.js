// 厂商 / 工具图标映射。
// 依据 public/icons/vendors/vendor-map.json 的自身约定：
// 「前端应在构建期 import 本表，不要运行时 fetch」；icon 为 null 时必须降级，
// 不得引用不存在的文件（降级方式：显示名称首字）。
import vendorMap from '../../public/icons/vendors/vendor-map.json';

const PLAN_VENDORS = vendorMap.planVendors ?? {};

/**
 * 套餐厂商 → 图标 URL；无对应图标时返回 null，调用方须降级。
 * @param {string} vendor 契约里的 plans[].vendor 原值
 */
export function planIconUrl(vendor) {
  const slug = PLAN_VENDORS[vendor];
  if (!slug) return null;
  return `/icons/vendors/${slug}.svg`;
}

/** 无图标时的降级文字：取厂商名首个字符。 */
export function vendorInitial(vendor) {
  return String(vendor ?? '').trim().slice(0, 1);
}
