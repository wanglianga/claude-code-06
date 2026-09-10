<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { ROLE_META, useRoleStore, type RoleView } from './stores/role'
import { useShowStore } from './stores/show'
import { useToastStore } from './stores/toast'
import { formatTime } from './domain/engine'
import type { ShowPhase } from './domain/types'

import ParentView from './views/ParentView.vue'
import GateView from './views/GateView.vue'
import UsherView from './views/UsherView.vue'
import SecurityView from './views/SecurityView.vue'
import DeskView from './views/DeskView.vue'
import ManagerView from './views/ManagerView.vue'

const role = useRoleStore()
const showStore = useShowStore()
const toast = useToastStore()
const { view } = storeToRefs(role)
const { now, show, activeIncidents } = storeToRefs(showStore)

const NAV: RoleView[] = ['parent', 'gate', 'usher', 'security', 'desk', 'manager']

const PHASES: { key: ShowPhase; label: string }[] = [
  { key: 'entry', label: '入场核验' },
  { key: 'performance', label: '演出中' },
  { key: 'intermission', label: '中场休息' },
  { key: 'exit', label: '散场' },
  { key: 'closed', label: '已结束' },
]
const phaseIndex = computed(() => PHASES.findIndex((p) => p.key === show.value.phase))

const viewComp = computed(() => {
  return {
    parent: ParentView,
    gate: GateView,
    usher: UsherView,
    security: SecurityView,
    desk: DeskView,
    manager: ManagerView,
  }[view.value]
})

function resetDemo() {
  if (!window.confirm('将清空全部事件与操作记录，恢复到演出入场前的演示数据，确定？')) return
  showStore.resetDemo()
  toast.push('演示数据已重置', 'good')
}
</script>

<template>
  <div class="page">
    <aside class="sidebar">
      <div class="brand">
        <span class="logo">🎭</span>
        <div>
          <div class="name">星豆亲子剧场</div>
          <div class="tag">儿童安全协同台 · v1.0</div>
        </div>
      </div>

      <button
        v-for="r in NAV"
        :key="r"
        class="nav-item"
        :class="{ active: view === r }"
        @click="role.switchView(r)"
      >
        <span class="ico">{{ ROLE_META[r].icon }}</span>
        <span>{{ ROLE_META[r].label }}</span>
        <span v-if="r === 'manager' && activeIncidents.length" class="badge pulse">{{ activeIncidents.length }}</span>
        <span v-else-if="r === 'usher' && activeIncidents.length" class="badge">{{ activeIncidents.length }}</span>
        <span v-else-if="r === 'security' && activeIncidents.length" class="badge">{{ activeIncidents.length }}</span>
        <span v-else-if="r === 'desk' && activeIncidents.length" class="badge">{{ activeIncidents.length }}</span>
      </button>

      <div class="sidebar-foot">
        <div style="margin-bottom:6px">协同流程：登记 → 闸机核验 → 巡查预警 → 找回派单 → 服务台核验 → 出口拦截 → 复盘</div>
        <button class="ghost small" style="width:100%" @click="resetDemo">↺ 重置演示数据</button>
      </div>
    </aside>

    <main class="main">
      <header class="page-head">
        <div>
          <h1>{{ ROLE_META[view].icon }} {{ ROLE_META[view].label }}</h1>
          <div class="sub">{{ ROLE_META[view].desc }}</div>
        </div>
        <div style="text-align:right">
          <div class="mono" style="font-size:18px;font-weight:700">{{ formatTime(now) }}</div>
          <div class="muted small-text">{{ show.name }} · {{ show.date }} {{ show.startTime }}</div>
        </div>
      </header>

      <div class="card tight" style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:16px">
        <span class="muted small-text" style="font-weight:600">演出阶段（由值班经理推进）</span>
        <div class="phase-bar">
          <template v-for="(p, idx) in PHASES" :key="p.key">
            <span class="phase-step" :class="{ active: idx === phaseIndex, done: idx < phaseIndex }">
              {{ idx < phaseIndex ? '✓ ' : '' }}{{ p.label }}
            </span>
            <span v-if="idx < PHASES.length - 1" class="phase-arrow">→</span>
          </template>
        </div>
        <span style="flex:1"></span>
        <span v-if="activeIncidents.length" class="tag-pill pill-critical pulse">
          ● {{ activeIncidents.length }} 起走失事件处置中
        </span>
      </div>

      <component :is="viewComp" />
    </main>

    <div class="toast-wrap">
      <div v-for="t in toast.items" :key="t.id" class="toast" :class="t.kind" @click="toast.dismiss(t.id)">
        {{ t.text }}
      </div>
    </div>
  </div>
</template>
