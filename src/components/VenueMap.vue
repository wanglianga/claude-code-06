<script setup lang="ts">
import { computed } from 'vue'
import { useShowStore } from '@/stores/show'
import { crowdLevelOf } from '@/domain/engine'
import { ZONES } from '@/domain/seed'
import type { StaffRole, Zone } from '@/domain/types'

const props = withDefaults(
  defineProps<{
    showCrowd?: boolean
    lastSeenZoneId?: string
    lastSeenZoneIds?: string[]
    interceptZoneIds?: string[]
    assignedZoneIds?: string[]
    foundZoneIds?: string[]
    staffRoles?: StaffRole[]
    selectable?: boolean
    height?: number
  }>(),
  {
    showCrowd: false,
    lastSeenZoneId: '',
    lastSeenZoneIds: () => [],
    interceptZoneIds: () => [],
    assignedZoneIds: () => [],
    foundZoneIds: () => [],
    staffRoles: () => ['usher', 'security', 'desk'],
    selectable: false,
    height: 460,
  }
)

const emit = defineEmits<{ (e: 'select', zoneId: string): void }>()

const store = useShowStore()

const DIMS: Record<Zone['type'], { w: number; h: number }> = {
  stage: { w: 34, h: 9 },
  seat: { w: 21, h: 12 },
  facility: { w: 17, h: 9.5 },
  exit: { w: 13, h: 6.5 },
  desk: { w: 15, h: 8 },
  gate: { w: 13, h: 7 },
}

const ROLE_MARK: Record<StaffRole, { ch: string; fill: string }> = {
  usher: { ch: '务', fill: '#2a78d6' },
  security: { ch: '安', fill: '#44414c' },
  desk: { ch: '台', fill: '#4a3aa7' },
}

interface RenderZone {
  z: Zone
  x: number
  y: number
  w: number
  h: number
}

const rendered = computed<RenderZone[]>(() =>
  ZONES.map((z) => {
    const d = DIMS[z.type]
    return { z, x: z.x - d.w / 2, y: z.y - d.h / 2, w: d.w, h: d.h }
  })
)

function crowdOf(z: Zone) {
  return crowdLevelOf(store.crowdReports, z.id, store.now)
}

function zoneClass(rz: RenderZone) {
  return [
    'zone-box',
    `type-${rz.z.type}`,
    props.showCrowd && rz.z.type === 'facility' ? `crowd-${crowdOf(rz.z)}` : '',
    props.interceptZoneIds.includes(rz.z.id) ? 'intercept' : '',
    props.lastSeenZoneId === rz.z.id || props.lastSeenZoneIds.includes(rz.z.id) ? 'last-seen' : '',
    props.assignedZoneIds.includes(rz.z.id) ? 'assigned' : '',
  ].join(' ')
}

/** 同区域人员扇形展开，避免重叠 */
const markerPositions = computed(() => {
  const byZone = new Map<string, { id: string; ch: string; fill: string; busy: boolean }[]>()
  for (const s of store.staff.filter((x) => props.staffRoles.includes(x.role))) {
    const arr = byZone.get(s.zoneId) ?? []
    arr.push({ id: s.id, ch: ROLE_MARK[s.role].ch, fill: ROLE_MARK[s.role].fill, busy: s.status === 'busy' })
    byZone.set(s.zoneId, arr)
  }
  const out: { x: number; y: number; ch: string; fill: string; busy: boolean }[] = []
  for (const [zoneId, arr] of byZone) {
    const z = ZONES.find((x) => x.id === zoneId)!
    arr.forEach((m, i) => {
      const angle = -Math.PI / 2 + (i - (arr.length - 1) / 2) * 0.55
      const r = 4.2
      out.push({ x: z.x + Math.cos(angle) * r + 9, y: z.y + Math.sin(angle) * r + 5, ...m })
    })
  }
  return out
})

const crowdLabel: Record<string, string> = { low: '畅通', medium: '较挤', high: '拥挤' }
</script>

<template>
  <div>
    <svg class="venue-map" :viewBox="`0 0 100 100`" :style="{ height: height + 'px' }" preserveAspectRatio="xMidYMid meet">
      <!-- 区域 -->
      <g v-for="rz in rendered" :key="rz.z.id">
        <rect
          :x="rz.x"
          :y="rz.y"
          :width="rz.w"
          :height="rz.h"
          :class="zoneClass(rz)"
          @click="selectable && emit('select', rz.z.id)"
        />
        <text :x="rz.z.x" :y="rz.z.y - (rz.z.type === 'stage' ? -0.5 : 1.6)" class="zone-label" :class="{ 'stage-label': rz.z.type === 'stage' }">
          {{ rz.z.shortName }}
        </text>
        <text
          v-if="showCrowd && rz.z.type === 'facility' && crowdOf(rz.z) !== 'low'"
          :x="rz.z.x"
          :y="rz.z.y + 3.4"
          class="zone-sub"
        >
          {{ crowdLabel[crowdOf(rz.z)] }}
        </text>
        <text
          v-else-if="foundZoneIds.includes(rz.z.id)"
          :x="rz.z.x"
          :y="rz.z.y + 3.4"
          class="zone-sub"
          style="fill: var(--good); font-weight: 700"
        >
          ✓ 发现
        </text>
      </g>

      <!-- 人员位置 -->
      <g class="map-marker">
        <template v-for="(m, i) in markerPositions" :key="i">
          <circle :cx="m.x" :cy="m.y" r="3.1" :fill="m.fill" :stroke="m.busy ? '#d23b3b' : '#fff'" stroke-width="1.1" />
          <text :x="m.x" :y="m.y + 1.35" text-anchor="middle" style="font-size: 3.4px; fill: #fff; font-weight: 700">
            {{ m.ch }}
          </text>
        </template>
      </g>
    </svg>

    <div class="legend-chips">
      <span class="chip"><span class="sw" style="background:var(--serious-soft);border-color:var(--serious)"></span>拥挤</span>
      <span class="chip"><span class="sw" style="background:var(--gold-soft);border-color:#e2b254"></span>较挤</span>
      <span class="chip"><span class="sw" style="background:var(--critical-soft);border-color:var(--critical)"></span>拦截出口</span>
      <span class="chip"><span class="sw" style="border:2.4px dashed var(--critical)"></span>最后出现</span>
      <span class="chip"><span class="sw" style="border:2.4px solid var(--info)"></span>搜寻分区</span>
      <span class="chip">
        <span style="display:inline-flex;gap:3px">
          <span style="width:12px;height:12px;border-radius:50%;background:#2a78d6;color:#fff;font-size:8px;text-align:center;line-height:12px">务</span>
          <span style="width:12px;height:12px;border-radius:50%;background:#44414c;color:#fff;font-size:8px;text-align:center;line-height:12px">安</span>
          <span style="width:12px;height:12px;border-radius:50%;background:#4a3aa7;color:#fff;font-size:8px;text-align:center;line-height:12px">台</span>
        </span>
        人员位置（红圈=执行任务中）
      </span>
    </div>
  </div>
</template>
