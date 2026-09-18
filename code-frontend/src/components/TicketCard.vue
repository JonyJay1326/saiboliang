<script setup>
// 票证卡（frontend-spec §5.1）—— Vue 版。
// ⚠️ 本组件与 TicketCard.astro 是同一张卡的两份标记（TASKS.md F7 方案 b）。
// 数据派生与标签映射一律取自 src/lib/，两端共用；**标记结构改动必须两边同步**。
import { computed } from 'vue';
import { durationLabel, expiredLabel, overdue, serial } from '../lib/format.js';
import { CATEGORY } from '../lib/labels.js';

const props = defineProps({
  ticket: { type: Object, required: true },
});

const isExpired = computed(() => props.ticket.expired === true);
const isOverdue = computed(() => !isExpired.value && overdue(props.ticket));
</script>

<template>
  <article class="ticket" :data-category="ticket.category" :data-expired="String(isExpired)">
    <span class="ticket__serial">{{ serial(ticket) }}</span>

    <header class="ticket__head">
      <h3 class="ticket__title">
        <a :href="`/tickets/${ticket.id}/`">{{ ticket.title }}</a>
      </h3>
      <p class="ticket__vendor">{{ ticket.vendor }}</p>
    </header>

    <dl class="ticket__fields">
      <div><dt>分类</dt><dd>{{ CATEGORY[ticket.category] ?? ticket.category }}</dd></div>
      <div><dt>期限</dt><dd>{{ durationLabel(ticket) }}</dd></div>
    </dl>

    <p v-if="ticket.summary" class="ticket__summary">{{ ticket.summary }}</p>

    <p v-if="isOverdue" class="ticket__overdue">已逾期 · 待核实</p>

    <footer class="ticket__foot">
      <span class="ticket__score">推荐 {{ ticket.score }}</span>
      <a class="ticket__cta" :href="ticket.link" target="_blank" rel="noopener noreferrer">去领取</a>
      <button type="button" :data-claim="ticket.id">我领到了</button>
    </footer>

    <div v-if="isExpired" class="ticket__seal">作废</div>
    <span v-if="isExpired" class="visually-hidden">{{ expiredLabel(ticket) }}</span>

    <span v-if="ticket.affiliate === true" class="ticket__flag">含推广</span>
  </article>
</template>
