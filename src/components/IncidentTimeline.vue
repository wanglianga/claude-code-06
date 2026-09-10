<script setup lang="ts">
import { computed } from 'vue'
import { formatTime } from '@/domain/engine'
import type { Incident } from '@/domain/types'

const props = defineProps<{ incident: Incident; limit?: number }>()

const items = computed(() => {
  const all = [...props.incident.timeline].sort((a, b) => b.t - a.t)
  return props.limit ? all.slice(0, props.limit) : all
})
</script>

<template>
  <div v-if="items.length" class="timeline">
    <div v-for="(e, idx) in items" :key="idx" class="tl-item" :class="`k-${e.kind}`">
      <div class="tl-meta">
        <span class="mono">{{ formatTime(e.t) }}</span>
        <span>{{ e.actor }}</span>
      </div>
      <div>{{ e.text }}</div>
    </div>
  </div>
  <div v-else class="empty">暂无进展记录</div>
</template>
