<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useShowStore } from '@/stores/show'
import { useToastStore } from '@/stores/toast'
import { formatTime, minutesAgo } from '@/domain/engine'
import { ZONES_BY_ID } from '@/domain/seed'
import VenueMap from '@/components/VenueMap.vue'
import IncidentTimeline from '@/components/IncidentTimeline.vue'
import type { ShowPhase } from '@/domain/types'

const store = useShowStore()
const toast = useToastStore()
const { now } = storeToRefs(store)

const PHASE_FLOW: { key: ShowPhase; label: string; next?: ShowPhase; confirm: string }[] = [
  { key: 'entry', label: '入场核验', next: 'performance', confirm: '确认入场结束、演出开始？（安全列表将冻结为已核验儿童）' },
  { key: 'performance', label: '演出中', next: 'intermission', confirm: '进入中场休息？场务将开始按拥挤度更新重点巡查区域。' },
  { key: 'intermission', label: '中场休息', next: 'exit', confirm: '中场结束、开始散场？系统将按场务最后巡查位置自动生成出口拦截计划。' },
  { key: 'exit', label: '散场', next: 'closed', confirm: '结束本场演出？仍未找到的事件将归档并进入复盘（此操作不可撤销）。' },
  { key: 'closed', label: '已结束', confirm: '' },
]

const nextPhaseLabel = computed(() => {
  const idx = PHASE_FLOW.findIndex((p) => p.key === store.show.phase)
  return PHASE_FLOW[idx + 1]?.label ?? ''
})

function advance() {
  const cur = PHASE_FLOW.find((p) => p.key === store.show.phase)!
  if (!cur.next) return
  if (store.activeIncidents.length && cur.next === 'closed') {
    if (!window.confirm(cur.confirm + '\n\n当前仍有 ' + store.activeIncidents.length + ' 起未结事件，确认结束？')) return
  } else if (!window.confirm(cur.confirm)) return
  if (cur.next === 'closed') {
    store.closeShow()
    toast.push('演出已结束，复盘报告已生成', 'good')
  } else {
    store.setPhase(cur.next)
    toast.push(`已进入「${PHASE_FLOW.find((p) => p.key === cur.next)?.label}」阶段`, 'good')
  }
}

const stats = computed(() => ({
  registered: store.children.length,
  admitted: store.children.filter((c) => c.admitted).length,
  risk: store.children.filter((c) => c.admitted && c.highRiskFamily).length,
  active: store.activeIncidents.length,
  closed: store.closedIncidents.length,
}))

const stageLabel: Record<string, string> = { entry: '入场', intermission: '中场', exit: '散场' }
const statusMeta: Record<string, { cls: string; text: string }> = {
  searching: { cls: 'pill-warn', text: '搜寻中' },
  broadcast: { cls: 'pill-serious', text: '广播寻人' },
  police: { cls: 'pill-critical', text: '警方协助' },
  reunited: { cls: 'pill-good', text: '已团聚' },
  closed_lost: { cls: 'pill-gray', text: '未找到归档' },
}

const activeInterceptIds = computed(() => [
  ...new Set(store.activeIncidents.flatMap((i) => i.interceptions.filter((x) => x.active).map((x) => x.zoneId))),
])
const lastSeenIds = computed(() => store.activeIncidents.map((i) => i.lastSeenZoneId))

// 复盘柱状图（单序列，直接标签 + 表格视图）
const maxCount = computed(() => Math.max(1, ...store.review.byStage.map((s) => s.count)))
function barHeight(count: number) {
  return Math.round((count / maxCount.value) * 110) + 6
}

const areaLabel: Record<string, string> = { staffing: '场务站位', toilet: '厕所引导', exit: '出口提示', signage: '临时指示牌' }
const areaCls: Record<string, string> = { staffing: 'pill-brand', toilet: 'pill-gold', exit: 'pill-critical', signage: 'pill-serious' }

const intermissionAlertRows = computed(() =>
  store.activeAlerts.map((a) => ({
    a,
    zoneName: ZONES_BY_ID.get(a.zoneId)?.name ?? a.zoneId,
    crowdedNames: a.crowdedZoneIds.map((z) => ZONES_BY_ID.get(z)?.shortName).join('、'),
  }))
)

function broadcastAgain(id: string) {
  store.escalateBroadcast(id, '值班经理')
  toast.push('已追加一次全场广播')
}
</script>

<template>
  <div class="stack">
    <!-- 阶段推进 -->
    <div class="card tight row">
      <strong>演出阶段控制：</strong>
      <span class="tag-pill pill-brand">当前：{{ PHASE_FLOW.find((p) => p.key === store.show.phase)?.label }}</span>
      <span style="flex:1"></span>
      <button v-if="store.show.phase !== 'closed'" @click="advance">
        推进到「{{ nextPhaseLabel }}」 →
      </button>
    </div>

    <!-- 态势统计 -->
    <div class="grid-3" style="grid-template-columns:repeat(5,1fr)">
      <div class="stat"><div class="k">已登记安全服务</div><div class="v">{{ stats.registered }}</div></div>
      <div class="stat"><div class="k">已核验入场</div><div class="v good">{{ stats.admitted }}</div></div>
      <div class="stat"><div class="k">高风险家庭在场</div><div class="v" :class="stats.risk ? 'critical' : ''">{{ stats.risk }}</div></div>
      <div class="stat"><div class="k">处置中事件</div><div class="v" :class="stats.active ? 'critical' : ''">{{ stats.active }}</div></div>
      <div class="stat"><div class="k">已关闭事件</div><div class="v">{{ stats.closed }}</div></div>
    </div>

    <!-- 全场地图 -->
    <div class="card">
      <div class="card-title">
        <h2>🗺️ 全场实时态势</h2>
        <span class="hint">红框=拦截出口，虚线框=最后出现位置，圆点为各类人员实时位置与任务状态</span>
      </div>
      <VenueMap
        :height="420"
        show-crowd
        :last-seen-zone-ids="lastSeenIds"
        :intercept-zone-ids="activeInterceptIds"
        :alert-zone-ids="store.activeAlerts.filter(a => a.level !== 'low').map(a => a.zoneId)"
        :diversion-channels="store.diversions.filter(d => d.active).map(d => ({ zoneId: d.zoneId, exitId: d.exitId, active: d.active }))"
      />
    </div>

    <!-- 中场高风险预警态势 -->
    <div v-if="['intermission', 'exit'].includes(store.show.phase)" class="card">
      <div class="card-title">
        <h2>🚨 中场高风险预警与分流态势</h2>
        <span class="hint">系统按儿童年龄/座位距出口/单人带娃/离座报备/厕所卖品拥堵给场务生成巡查优先级；被反复触发的区域会进入下一场排班与指示牌建议</span>
      </div>
      <div v-if="!intermissionAlertRows.length" class="empty">当前没有生效中的预警（均已解除或无已入场儿童）。</div>
      <table v-else class="tbl">
        <thead>
          <tr><th>优先级</th><th>座位分区</th><th>分值</th><th>关联拥堵区</th><th>离座未归</th><th>场务确认拥挤</th><th>触发次数</th></tr>
        </thead>
        <tbody>
          <tr v-for="{ a, zoneName, crowdedNames } in intermissionAlertRows" :key="a.id">
            <td>
              <span class="tag-pill" :class="a.level === 'high' ? 'pill-critical' : a.level === 'medium' ? 'pill-serious' : 'pill-gray'">
                {{ { high: '高', medium: '中', low: '低' }[a.level] }}
              </span>
            </td>
            <td><strong>{{ zoneName }}</strong></td>
            <td class="mono">{{ a.score }}</td>
            <td>{{ crowdedNames || '—' }}</td>
            <td>
              <span v-if="a.leftSeatChildIds.length" class="tag-pill pill-warn">{{ a.leftSeatChildIds.length }} 名</span>
              <span v-else class="muted">—</span>
            </td>
            <td>
              <span v-if="a.confirmCount" class="tag-pill pill-critical">{{ a.confirmCount }} 次</span>
              <span v-else class="muted">未确认</span>
            </td>
            <td>
              <strong :class="a.triggerCount >= 2 ? 'pill-gold tag-pill' : ''">{{ a.triggerCount }}</strong>
              <span v-if="a.triggerCount >= 2" class="muted small-text"> → 影响下一场</span>
            </td>
          </tr>
        </tbody>
      </table>
      <div v-if="store.activeDiversions.length" class="section-gap">
        <h3 style="margin-bottom:6px">安保端临时分流通道（{{ store.activeDiversions.length }}）</h3>
        <div v-for="d in store.activeDiversions" :key="d.id" class="list-row">
          <span class="dot dot-critical"></span>
          <span class="small-text">
            <strong>{{ ZONES_BY_ID.get(d.zoneId)?.name }} → {{ ZONES_BY_ID.get(d.exitId)?.name }}</strong>
            <span class="muted"> · {{ d.reason }}</span>
          </span>
        </div>
      </div>
    </div>

    <!-- 处置中事件 -->
    <h2 style="margin-top:4px">🚨 处置中事件（{{ store.activeIncidents.length }}）</h2>
    <div v-if="!store.activeIncidents.length" class="empty">暂无走失事件</div>
    <div v-for="i in store.activeIncidents" :key="i.id" class="card" :class="i.status === 'police' ? 'pulse' : ''" style="border-color:#e7c8c8">
      <div class="card-title">
        <h2>{{ i.childSnapshot.nickname }}（{{ i.childSnapshot.age }}岁）</h2>
        <span class="tag-pill" :class="statusMeta[i.status].cls">{{ statusMeta[i.status].text }}</span>
        <span class="tag-pill" :class="i.stage === 'exit' ? 'pill-critical' : i.stage === 'intermission' ? 'pill-serious' : 'pill-warn'">
          {{ stageLabel[i.stage] }}阶段报案
        </span>
        <span class="muted small-text">事件 {{ i.id }} · 已持续 {{ minutesAgo(i.createdAt, now) }} 分钟</span>
        <span class="spacer"></span>
        <button class="small ghost" @click="broadcastAgain(i.id)">📢 追加广播</button>
      </div>

      <div class="grid-3">
        <div class="card tight">
          <h3 style="margin-bottom:8px">协同任务（{{ i.tasks.length }}）</h3>
          <div v-for="t in i.tasks" :key="t.id" class="small-text" style="padding:5px 0;border-bottom:1px dashed var(--border)">
            <div class="row" style="gap:6px">
              <span class="tag-pill" :class="{ usher: 'pill-info', security: 'pill-gray', desk: 'pill-brand' }[t.role]">
                {{ { usher: '场务', security: '安保', desk: '服务台' }[t.role] }}
              </span>
              <strong>{{ t.staffName }}</strong>
              <span class="muted">{{ { pending: '待接单', accepted: '处置中', done: '完成' }[t.status] }}</span>
            </div>
            <div class="muted" style="margin-top:2px">
              {{ t.zoneIds.map((z) => ZONES_BY_ID.get(z)?.shortName).join('、') }}
            </div>
          </div>
        </div>

        <div class="card tight">
          <h3 style="margin-bottom:8px">出口 / 监控 / 警方</h3>
          <div class="small-text stack" style="gap:6px">
            <div>
              <strong>拦截出口：</strong>
              <span v-if="i.interceptions.filter((x) => x.active).length">
                <span v-for="x in i.interceptions.filter((x) => x.active)" :key="x.zoneId" class="tag-pill pill-critical" style="margin:2px">
                  {{ ZONES_BY_ID.get(x.zoneId)?.shortName }}
                </span>
              </span>
              <span v-else class="muted">暂无（场务巡查位置与散场阶段会自动触发）</span>
            </div>
            <div>
              <strong>监控调阅：</strong>
              <span :class="i.cctvRequested ? 'tag-pill pill-info' : 'muted'">
                {{ i.cctvRequested ? '✓ 已申请：' + i.cctvNote : '未申请' }}
              </span>
            </div>
            <div>
              <strong>警方协助：</strong>
              <span :class="i.policeCalled ? 'tag-pill pill-critical' : 'muted'">
                {{ i.policeCalled ? '✓ 已报警：' + i.policeNote : '未报警' }}
              </span>
            </div>
            <div>
              <strong>广播：</strong>
              <span :class="i.broadcast ? 'tag-pill pill-serious' : 'muted'">
                {{ i.broadcast ? `已播 ${i.broadcast.times} 次` : '未广播' }}
              </span>
            </div>
            <div>
              <strong>家长通知：</strong><span class="muted">{{ i.parentNotifyWay || '电话告知搜寻进展，App 推送' }}</span>
            </div>
            <div v-if="i.broughtAlertChecks.length">
              <strong>带入的中场巡查记录：</strong>
              <div class="small-text stack" style="gap:4px;margin-top:4px">
                <div v-for="c in i.broughtAlertChecks" :key="c.id" class="list-row" style="align-items:flex-start">
                  <span class="dot" :class="c.crowded ? 'dot-critical' : 'dot-good'" style="margin-top:5px"></span>
                  <span class="small-text">
                    {{ c.staffName }} 在{{ ZONES_BY_ID.get(c.zoneId)?.name }}
                    <span :class="c.crowded ? 'tag-pill pill-critical' : 'tag-pill pill-good'" style="margin:0 4px">{{ c.crowded ? '确认拥挤' : '人流正常' }}</span>
                    {{ c.note }}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="card tight" style="max-height:260px;overflow:auto">
          <h3 style="margin-bottom:6px">最新动态</h3>
          <IncidentTimeline :incident="i" :limit="9" />
        </div>
      </div>
    </div>

    <!-- 已关闭事件 -->
    <template v-if="store.closedIncidents.length">
      <h2 style="margin-top:4px">✅ 已关闭事件（{{ store.closedIncidents.length }}）</h2>
      <div class="card">
        <table class="tbl">
          <thead>
            <tr><th>事件</th><th>儿童</th><th>报案阶段</th><th>结果</th><th>关闭时间</th><th>处置摘要</th></tr>
          </thead>
          <tbody>
            <tr v-for="i in store.closedIncidents" :key="i.id">
              <td class="mono">{{ i.id }}</td>
              <td>{{ i.childSnapshot.nickname }}（{{ i.childSnapshot.age }}岁）</td>
              <td>{{ stageLabel[i.stage] }}</td>
              <td><span class="tag-pill" :class="statusMeta[i.status].cls">{{ statusMeta[i.status].text }}</span></td>
              <td>{{ i.closedAt ? formatTime(i.closedAt) : '—' }}</td>
              <td class="muted" style="max-width:340px">{{ i.resolutionNote }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>

    <!-- 复盘 -->
    <template v-if="store.show.phase === 'closed'">
      <h2 style="margin-top:4px">📈 本场复盘与下一场调整建议</h2>
      <div class="grid-2">
        <div class="card">
          <div class="card-title"><h2>走失发生阶段分布</h2><span class="hint">共 {{ store.review.total }} 起；鼠标悬停柱体查看说明</span></div>
          <div class="bar-chart" role="img" :aria-label="`走失阶段柱状图：入场 ${store.review.byStage[0].count} 起，中场 ${store.review.byStage[1].count} 起，散场 ${store.review.byStage[2].count} 起`">
            <div v-for="s in store.review.byStage" :key="s.stage" class="bar-col">
              <span class="val">{{ s.count }}</span>
              <div
                class="bar"
                :class="{ zero: s.count === 0 }"
                :style="{ height: barHeight(s.count) + 'px' }" :title="`${s.label}阶段发生 ${s.count} 起走失`"
              ></div>
              <span class="lbl">{{ s.label }}</span>
            </div>
          </div>
          <table class="tbl section-gap">
            <thead><tr><th>阶段</th><th>走失起数</th><th>占比</th></tr></thead>
            <tbody>
              <tr v-for="s in store.review.byStage" :key="s.stage">
                <td>{{ s.label }}</td>
                <td>{{ s.count }}</td>
                <td>{{ store.review.total ? Math.round((s.count / store.review.total) * 100) : 0 }}%</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="card">
          <div class="card-title"><h2>下一场调整建议</h2><span class="hint">依据走失发生阶段与涉及区域自动生成</span></div>
          <div v-for="sg in store.review.suggestions" :key="sg.id" class="list-row" style="align-items:flex-start">
            <span class="tag-pill" :class="areaCls[sg.area]">{{ areaLabel[sg.area] }}</span>
            <div>
              <div class="small-text">{{ sg.text }}</div>
              <div class="muted" style="font-size:11px;margin-top:3px">依据：{{ sg.basedOn }}</div>
            </div>
          </div>
          <div class="list-row section-gap">
            <span class="dot dot-good"></span>
            <div class="small-text">
              <strong>调整项已对应到下一场执行清单：</strong>
              场务站位（带位引导/巡查重心/反复预警区提前到位）、厕所排队引导（备用厕所与分段放行）、出口提示（提前 5 分钟屏幕提示 + 高风险家庭护送出闸）、临时指示牌（反复拥堵区入口的排队方向/备用通道牌）。
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
