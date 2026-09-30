<script setup>
import { computed } from 'vue';
import { renderTicketCard } from '../lib/stubs.js';
const props = defineProps({ ticket: { type: Object, required: true }, index: { type: Number, default: 0 } });
const html = computed(() => renderTicketCard(props.ticket, props.index));
</script>

<template>
  <div class="r4-card" v-html="html"></div>
</template>
