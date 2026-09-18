<script setup>
// /tickets 筛选岛（frontend-spec §4.2、§5.6）
//
// 定位：**列表控制器**，不是列表渲染器。
// 票卡由页面在构建期通过 TicketCard.vue 渲染成静态 HTML（无 JS 可读、SEO 可抓）；
// 本岛只负责「算出该显示哪些、按什么顺序」，然后把结果写成已有卡片的
// hidden 属性与 CSS order —— **不重渲染卡片**。
//
// 这样做的原因：若由岛渲染列表，卡片数据必须同时以 props 形式内联进 HTML，
// 与已渲染的标记重复一份（实测仅 content 字段就占序列化的 52%）。
import { computed, onMounted, ref, watch } from 'vue';
import { addedThisWeek } from '../lib/format.js';
import { CATEGORY, DURATION, REGION, SORT_VIEWS } from '../lib/labels.js';

const props = defineProps({
  // 只传筛选与排序真正用到的字段，不含 content / summary / link 等卡片字段
  index: { type: Array, required: true },
});

const FILTERS = [
  { key: 'category', label: '分类', options: CATEGORY },
  { key: 'region', label: '地区', options: REGION },
  { key: 'duration', label: '时长', options: DURATION },
];

const selected = ref({ category: [], region: [], duration: [], fresh: false });
const sort = ref('default');

const readUrl = () => {
  const q = new URLSearchParams(window.location.search);
  return {
    category: q.getAll('category'),
    region: q.getAll('region'),
    duration: q.getAll('duration'),
    fresh: q.get('new') === '1',
    sort: SORT_VIEWS.some((v) => v.key === q.get('sort')) ? q.get('sort') : 'default',
  };
};

const writeUrl = () => {
  const q = new URLSearchParams();
  for (const key of ['category', 'region', 'duration']) {
    for (const v of selected.value[key]) q.append(key, v);
  }
  if (selected.value.fresh) q.set('new', '1');
  if (sort.value !== 'default') q.set('sort', sort.value);
  const search = q.toString();
  // 只改 query，不新增历史条目；保留 Astro 路由写在 history.state 里的状态。
  window.history.replaceState(
    window.history.state,
    '',
    `${window.location.pathname}${search ? `?${search}` : ''}`
  );
};

const toggle = (key, value) => {
  const list = selected.value[key];
  selected.value[key] = list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
  writeUrl();
};

const clearAll = () => {
  selected.value = { category: [], region: [], duration: [], fresh: false };
  writeUrl();
};

const hasAny = computed(
  () =>
    selected.value.category.length > 0 ||
    selected.value.region.length > 0 ||
    selected.value.duration.length > 0 ||
    selected.value.fresh
);

// 本周新增按北京时间周一至今天计算（契约 §4.2 / §5.2）。
// 这里只传了 publishedAt，故用同一口径现算。
const weeklyIds = computed(() => {
  const rows = props.index.map((t) => ({ id: t.id, publishedAt: t.publishedAt }));
  return new Set(addedThisWeek(rows).map((t) => t.id));
});

const visibleIds = computed(() => {
  const out = [];
  for (const t of props.index) {
    if (selected.value.category.length && !selected.value.category.includes(t.category)) continue;
    if (selected.value.region.length && !selected.value.region.includes(t.region)) continue;
    if (selected.value.duration.length && !selected.value.duration.includes(t.duration)) continue;
    if (selected.value.fresh && !weeklyIds.value.has(t.id)) continue;
    out.push(t.id);
  }
  return out;
});

const orderedIds = computed(() => {
  const rank = new Map(visibleIds.value.map((id) => [id, props.index.find((t) => t.id === id)]));
  const list = [...rank.values()];
  const byId = (a, b) => (a.id < b.id ? -1 : 1);
  if (sort.value === 'newest') {
    return list
      .sort((a, b) => (a.publishedAt < b.publishedAt ? 1 : a.publishedAt > b.publishedAt ? -1 : byId(a, b)))
      .map((t) => t.id);
  }
  if (sort.value === 'score') {
    return list.sort((a, b) => b.score - a.score || byId(a, b)).map((t) => t.id);
  }
  return list
    .sort((a, b) => Number(a.expired) - Number(b.expired) || b.score - a.score || (a.publishedAt < b.publishedAt ? 1 : a.publishedAt > b.publishedAt ? -1 : byId(a, b)))
    .map((t) => t.id);
});

// 把计算结果写到已有卡片上：hidden 控制显隐，order 控制顺序。
const applyToDom = () => {
  const rank = new Map(orderedIds.value.map((id, i) => [id, i + 1]));
  const visible = new Set(visibleIds.value);
  for (const li of document.querySelectorAll('[data-ticket-id]')) {
    const id = li.dataset.ticketId;
    li.hidden = !visible.has(id);
    li.style.order = String(rank.get(id) ?? 9999);
  }
};

watch([visibleIds, orderedIds], applyToDom);
onMounted(() => {
  const url = readUrl();
  selected.value = {
    category: url.category,
    region: url.region,
    duration: url.duration,
    fresh: url.fresh,
  };
  sort.value = url.sort;
  applyToDom();
});
</script>

<template>
  <section class="filters" aria-label="筛选与排序">
    <div v-for="f in FILTERS" :key="f.key" class="filters__group">
      <span class="filters__label">{{ f.label }}</span>
      <button
        v-for="(label, value) in f.options"
        :key="value"
        type="button"
        :aria-pressed="String(selected[f.key].includes(value))"
        @click="toggle(f.key, value)"
      >
        {{ label }}
      </button>
    </div>

    <div class="filters__group">
      <button
        type="button"
        :aria-pressed="String(selected.fresh)"
        @click="selected.fresh = !selected.fresh; writeUrl()"
      >
        本周新增
      </button>
    </div>

    <div class="filters__group">
      <span class="filters__label">排序</span>
      <button
        v-for="v in SORT_VIEWS"
        :key="v.key"
        type="button"
        :aria-pressed="String(sort === v.key)"
        @click="sort = v.key; writeUrl()"
      >
        {{ v.label }}
      </button>
    </div>

    <button v-if="hasAny" type="button" class="filters__clear" @click="clearAll">清除全部</button>

    <p class="filters__count" aria-live="polite">
      显示 {{ visibleIds.length }} / {{ index.length }} 张
    </p>
  </section>
</template>
