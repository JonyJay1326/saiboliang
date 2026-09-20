// 厂商 / 工具图标映射。
// 依据 public/icons/vendors/vendor-map.json 的自身约定：
// 「前端应在构建期 import 本表，不要运行时 fetch」；icon 为 null 时必须降级，
// 不得引用不存在的文件（降级方式：显示名称首字）。
import fs from 'node:fs';
import path from 'node:path';
import vendorMap from '../../public/icons/vendors/vendor-map.json';

const PLAN_VENDORS = vendorMap.planVendors ?? {};
const MODEL_VENDORS = vendorMap.byVendor ?? {};
const ICON_DIR = path.resolve(import.meta.dirname, '..', '..', 'public', 'icons', 'vendors');
const iconCache = new Map();

function readIcon(slug) {
  const file = `${slug}.svg`;
  if (!iconCache.has(file)) {
    let svg = null;
    try {
      svg = fs.readFileSync(path.join(ICON_DIR, file), 'utf8');
    } catch {
      svg = null;
    }
    iconCache.set(
      file,
      svg === null ? null : { mono: svg.includes('currentColor') && !svg.includes('#') && !svg.includes('url(#') }
    );
  }
  return iconCache.get(file);
}

/**
 * 套餐厂商 → 图标信息；无对应图标时返回 null，调用方须降级。
 * mono 为 true 表示单色 currentColor 图标，作为 <img> 加载时是纯黑，
 * 深色底上需由调用方加浅色圆角底；彩色标与自带底色的标不加。
 * @param {string} vendor 契约里的 plans[].vendor 原值
 */
export function planIcon(vendor) {
  const slug = PLAN_VENDORS[vendor];
  if (!slug) return null;
  const meta = readIcon(slug);
  if (!meta) return null;
  return { url: `/icons/vendors/${slug}.svg`, mono: meta.mono };
}

/**
 * 模型厂商 → 图标信息；AA 厂商名不能直接 slug 化，必须查 byVendor 表。
 * 无对应图标时返回 null，调用方须降级（如显示厂商名首字），不得引用不存在的文件。
 * @param {string} vendor 契约 models[].vendor 原值（AA `model_creator.name`）
 */
export function modelIcon(vendor) {
  const slug = MODEL_VENDORS[vendor]?.icon;
  if (!slug) return null;
  if (readIcon(slug) === null) return null;
  return { url: `/icons/vendors/${slug}.svg` };
}

/** 无图标时的降级文字：取厂商名首个字符。 */
export function vendorInitial(vendor) {
  return String(vendor ?? '').trim().slice(0, 1);
}
