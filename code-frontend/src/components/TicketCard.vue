<script setup>
// 票证卡（frontend-spec.md §5.1）—— Vue 版，全站唯一实现（构建期渲染、零客户端 JS，TASKS.md F7）。
// 数据派生与标签映射一律取自 src/lib/。
// 版式（2026-09-18 用户定）：竖版票面（形式参照 demo-html/cyberpunk-grain-station-design.html），
// 整卡配色按甲 / 乙 / 丙三档；中央等级章与左侧等级字为字体图 / 文字，分数值不上卡。
import { computed } from 'vue';
import { durationLabel, expiredLabel, overdue, scoreTier, serial } from '../lib/format.js';
import { CATEGORY } from '../lib/labels.js';

const TIER_ASSET = { 甲: 'jia', 乙: 'yi', 丙: 'bing' };

const props = defineProps({
  ticket: { type: Object, required: true },
});

const isExpired = computed(() => props.ticket.expired === true);
const isOverdue = computed(() => !isExpired.value && overdue(props.ticket));
const tier = computed(() => scoreTier(props.ticket.score));
const tierAsset = computed(() => TIER_ASSET[tier.value] ?? null);
</script>

<template>
  <article
    class="ticket"
    :data-tier="tier"
    :data-category="ticket.category"
    :data-expired="String(isExpired)"
  >
    <span class="ticket__frame" aria-hidden="true"></span>
    <span class="ticket__side" aria-hidden="true">{{ tier }}等</span>
    <span v-if="ticket.affiliate === true" class="ticket__flag">含推广</span>

    <header class="ticket__head">
      <h3 class="ticket__title">
        <a :href="`/tickets/${ticket.id}/`">{{ ticket.title }}</a>
      </h3>
      <p class="ticket__vendor">{{ ticket.vendor }}</p>
    </header>

    <img
      v-if="tierAsset"
      class="ticket__grade"
      :src="`/font-images/tier-${tierAsset}.png`"
      width="220"
      height="220"
      :alt="`推荐等级 ${tier}等`"
    />

    <dl class="ticket__fields">
      <div><dt>分类</dt><dd>{{ CATEGORY[ticket.category] ?? ticket.category }}</dd></div>
      <div><dt>期限</dt><dd>{{ durationLabel(ticket) }}</dd></div>
    </dl>

    <p v-if="ticket.summary" class="ticket__summary">{{ ticket.summary }}</p>

    <p v-if="isOverdue" class="ticket__overdue">已逾期 · 待核实</p>

    <footer class="ticket__foot">
      <p class="ticket__meta">
        <span class="ticket__serial">{{ serial(ticket) }}</span>
        <span class="ticket__motto" aria-hidden="true">凭票领饭</span>
      </p>
      <a class="ticket__cta" :href="ticket.link" target="_blank" rel="noopener noreferrer">去领取</a>
    </footer>

    <div v-if="isExpired" class="ticket__seal" aria-hidden="true">
      <img src="/font-images/seal-zuofei.png" width="220" height="220" alt="" />
    </div>
    <span v-if="isExpired" class="visually-hidden">{{ expiredLabel(ticket) }}</span>
  </article>
</template>
