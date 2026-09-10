<script setup lang="ts">
import { computed, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useShowStore } from '@/stores/show'
import { useRoleStore } from '@/stores/role'
import { useToastStore } from '@/stores/toast'
import { assessRisk, crowdLevelOf, formatTime, minutesAgo, recommendPatrolZones } from '@/domain/engine'
import { SEATS, ZONES, ZONES_BY_ID } from '@/domain/seed'
import VenueMap from '@/components/VenueMap.vue'
import IncidentTimeline from '@/components/IncidentTimeline.vue'
import type { CrowdLevel, Incident } from '@/domain/types'

const store = useShowStore()
const role = useRoleStore()
const toast = useToastStore()
const { now } = storeToRefs(store)

const ushers = computed(() => store.staff.filter((s) => s.role === 'usher'))
if (!role.staffId || !ushers.value.some((u) => u.id === role.staffId)) {
  role.loginAs(ushers.value[0]?.id ?? 'U1')
}
const me = computed(() => store.staffById(role.staffId)!)

const tab = ref<'seats' | 'alerts' | 'patrol' | 'tasks'>('seats')
const seatZoneId = ref('seat-a')

// ---------- 分区座位 ----------
const seatZones = ZONES.filter((z) => z.type === 'seat')
function seatsOf(zoneId: string) {
  return SEATS.filter((s) => s.zoneId === zoneId)
}
function childOn(seatId: string) {
  return store.childrenBySeat.get(seatId)
}
const admittedChildren = computed(() => store.children.filter((c) => c.admitted))
const highRiskList = computed(() =>
  admittedChildren.value
    .map((c) => ({ c, risk: assessRisk(c, now.value) }))
    .filter((x) => x.risk.high)
    .sort((a, b) => b.risk.score - a.risk.score)
)

// ---------- 拥挤度上报 / 重点巡查 ----------
const facilityZones = ZONES.filter((z) => z.type === 'facility')
const patrolRecommend = computed(() => recommendPatrolZones(ZONES, store.staff, store.crowdReports, now.value))
const crowdText: Record<CrowdLevel, string> = { low: '畅通', medium: '较挤', high: '拥挤' }
const crowdClass: Record<CrowdLevel, string> = { low: 'pill-good', medium: 'pill-warn', high: 'pill-critical' }

function setCrowd(zoneId: string, level: CrowdLevel) {
  store.reportCrowd(zoneId, level, role.staffId)
  toast.push(`已上报「${ZONES_BY_ID.get(zoneId)?.name}」拥挤度：${crowdText[level]}`)
}

// ---------- 中场休息高风险预警 ----------
const intermissionAlerts = computed(() =>
  store.activeAlerts.map((a) => ({
    a,
    children: a.childIds.map((id) => store.childById(id)!).filter(Boolean),
    latestCheck: [...a.checks].sort((x, y) => y.at - x.at)[0],
  }))
)
const alertLevelMeta = {
  high: { cls: 'pill-critical', text: '高风险·立即巡查' },
  medium: { cls: 'pill-serious', text: '中风险·优先巡查' },
  low: { cls: 'pill-gray', text: '低风险·常规关注' },
} as const

const alertForms = ref<Record<string, { zoneId: string; crowded: boolean; note: string }>>({})
function alertFormOf(alertId: string, crowdedZoneIds: string[], zoneId: string) {
  if (!alertForms.value[alertId]) {
    alertForms.value[alertId] = {
      zoneId: crowdedZoneIds[0] ?? zoneId,
      crowded: true,
      note: '',
    }
  }
  return alertForms.value[alertId]
}

function submitAlertCheck(alertId: string) {
  const a = store.alertById(alertId)!
  const f = alertFormOf(alertId, a.crowdedZoneIds, a.zoneId)
  // 重算后关联拥堵区可能变化，失效的旧选择回落到当前首个拥堵区/座位分区
  if (![a.zoneId, ...a.crowdedZoneIds].includes(f.zoneId)) {
    f.zoneId = a.crowdedZoneIds[0] ?? a.zoneId
  }
  if (!f.note.trim()) return toast.push('请填写巡查说明（人流情况与现场处置）', 'critical')
  store.alertCheck(alertId, role.staffId, f.zoneId, f.crowded, f.note.trim())
  if (f.crowded) {
    toast.push('已确认区域拥挤，临时分流通道已同步给安保端', 'critical', 5200)
  } else {
    toast.push('巡查记录已提交，人流可接受')
  }
  f.note = ''
}

function clearAlert(alertId: string) {
  store.dismissAlert(alertId, role.staffId)
  toast.push('该预警已解除（重新升至高风险会自动恢复）')
}

const alertZoneIds = computed(() => new Set(store.activeAlerts.filter((a) => a.level !== 'low').map((a) => a.zoneId)))
const diversionChannels = computed(() =>
  store.diversions
    .filter((d) => d.active)
    .map((d) => ({ zoneId: d.zoneId, exitId: d.exitId, active: d.active }))
)
function zoneName(id: string) {
  return ZONES_BY_ID.get(id)?.name ?? id
}

function goPatrol(zoneId: string, incidentId?: string) {
  store.moveStaff(role.staffId, zoneId, incidentId)
  toast.push(`${me.value.name} 已到「${ZONES_BY_ID.get(zoneId)?.name}」打卡巡查`)
}

// ---------- 任务处置 ----------
const myTasks = computed(() =>
  store.activeIncidents.flatMap((i) => i.tasks.filter((t) => t.role === 'usher').map((t) => ({ i, t })))
)

const checkForms = ref<Record<string, { zoneId: string; found: boolean; note: string }>>({})
function formOf(incidentId: string) {
  if (!checkForms.value[incidentId]) {
    const inc = store.incidentById(incidentId)!
    const firstSearchZone = inc.tasks.find((t) => t.type === 'search')?.zoneIds[0] ?? inc.lastSeenZoneId
    checkForms.value[incidentId] = { zoneId: firstSearchZone, found: false, note: '' }
  }
  return checkForms.value[incidentId]
}

function accept(i: Incident, taskId: string) {
  store.acceptTask(i.id, taskId, role.staffId)
  toast.push(`已接任务，请注意孩子特征`, 'good')
}

function submitCheck(i: Incident) {
  const f = formOf(i.id)
  if (!f.note.trim()) return toast.push('请填写巡查说明（现场观察）', 'critical')
  if (f.found) {
    store.patrolCheck(i.id, role.staffId, f.zoneId, true, f.note)
    store.resolveByUsher(i.id, role.staffId, `在${ZONES_BY_ID.get(f.zoneId)?.name}找到，${f.note}`)
    toast.push('已找到儿童并完成家长交接，事件关闭 🎉', 'good', 5200)
  } else {
    store.patrolCheck(i.id, role.staffId, f.zoneId, false, f.note)
    toast.push('排查结果已同步，搜寻分区与出口拦截已重算')
    f.note = ''
  }
}

const assignedZoneIds = computed(() =>
  new Set(store.activeIncidents.flatMap((i) => i.tasks.filter((t) => t.type === 'search').flatMap((t) => t.zoneIds)))
)
const foundZoneIds = computed(() =>
  new Set(store.activeIncidents.flatMap((i) => i.patrolChecks.filter((p) => p.found).map((p) => p.zoneId)))
)
</script>

<template>
  <div class="stack">
    <!-- 身份条 -->
    <div class="card tight row">
      <span style="font-size:20px">🧑‍🤝‍🧑</span>
      <strong>当前场务：</strong>
      <select v-model="role.staffId" style="width:150px">
        <option v-for="u in ushers" :key="u.id" :value="u.id">{{ u.name }}（{{ u.id }}）</option>
      </select>
      <span class="tag-pill" :class="me.status === 'busy' ? 'pill-critical' : 'pill-good'">
        {{ me.status === 'busy' ? '执行任务中' : '空闲待命' }}
      </span>
      <span class="muted small-text">当前位置：{{ ZONES_BY_ID.get(me.zoneId)?.name }}</span>
      <span style="flex:1"></span>
      <button class="ghost small" :class="{ 'pill-brand': tab === 'seats' }" @click="tab = 'seats'">分区座位与高风险</button>
      <button class="ghost small" :class="{ 'pill-brand': tab === 'alerts' }" @click="tab = 'alerts'">
        🚨 中场高风险预警<span v-if="intermissionAlerts.filter(x => x.a.level !== 'low').length" class="tag-pill pill-critical" style="margin-left:6px">{{ intermissionAlerts.filter(x => x.a.level !== 'low').length }}</span>
      </button>
      <button class="ghost small" :class="{ 'pill-brand': tab === 'patrol' }" @click="tab = 'patrol'">
        中场巡查{{ store.show.phase === 'intermission' ? '（当前阶段）' : '' }}
      </button>
      <button class="ghost small" :class="{ 'pill-brand': tab === 'tasks' }" @click="tab = 'tasks'">
        找回任务<span v-if="myTasks.length" class="tag-pill pill-critical" style="margin-left:6px">{{ myTasks.length }}</span>
      </button>
    </div>

    <!-- TAB: 分区座位 -->
    <template v-if="tab === 'seats'">
      <div class="layout-map">
        <div class="card">
          <div class="card-title">
            <h2>分区座位图（入场核验后的安全列表）</h2>
            <span class="hint">红色=高风险家庭，点击座位旁按钮可定位带位</span>
          </div>
          <div class="row" style="margin-bottom:10px">
            <button
              v-for="z in seatZones"
              :key="z.id"
              class="small"
              :class="seatZoneId === z.id ? '' : 'ghost'"
              @click="seatZoneId = z.id"
            >
              {{ z.name }}
            </button>
          </div>
          <div class="seat-grid">
            <div
              v-for="s in seatsOf(seatZoneId)"
              :key="s.id"
              class="seat"
              :class="{
                occupied: childOn(s.id) && !assessRisk(childOn(s.id)!, now).high,
                risk: childOn(s.id) && assessRisk(childOn(s.id)!, now).high,
                found: false,
              }"
            >
              <span class="mono" style="font-size:9.5px;color:var(--ink-3)">{{ s.row }}{{ s.no }}</span>
              <template v-if="childOn(s.id)">
                <span class="nick">{{ childOn(s.id)!.nickname }}</span>
                <span style="font-size:9px">{{ childOn(s.id)!.age }}岁</span>
                <span v-if="assessRisk(childOn(s.id)!, now).high" style="font-size:9px;color:var(--critical)">⚠ 高风险</span>
              </template>
              <span v-else style="font-size:9px;color:var(--ink-3)">空</span>
            </div>
          </div>
          <VenueMap :height="300" :show-crowd="true" class="section-gap" :staff-roles="['usher']" />
        </div>

        <div class="stack">
          <div class="card">
            <div class="card-title"><h2>⚠️ 高风险家庭提示</h2><span class="spacer"></span>
              <span class="tag-pill pill-critical">{{ highRiskList.length }} 户</span>
            </div>
            <div v-for="{ c, risk } in highRiskList" :key="c.id" class="list-row danger" style="align-items:flex-start">
              <span class="dot dot-critical" style="margin-top:5px"></span>
              <div style="flex:1">
                <strong>{{ c.nickname }}（{{ c.age }}岁）</strong>
                <span class="mono muted small-text"> · 座位 {{ c.seatId }}</span>
                <div class="small-text" style="color:var(--serious)">
                  {{ c.highRiskReason }}
                </div>
                <div class="muted small-text" v-for="(r, idx) in risk.reasons" :key="idx">· {{ r }}</div>
                <div class="small-text section-gap" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
                  <span class="tag-pill" :class="c.temporaryCareAllowed ? 'pill-good' : 'pill-warn'">
                    {{ c.temporaryCareAllowed ? '家长允许临时看护' : '不允许临时看护·须当面交接' }}
                  </span>
                  <button class="ghost small" @click="goPatrol(c.seatId.slice(0, 6))">前往该座位分区巡查</button>
                </div>
              </div>
            </div>
            <div v-if="!highRiskList.length" class="empty">已入场儿童中暂无高风险家庭</div>
          </div>

          <div class="card">
            <div class="card-title"><h2>已入场儿童一览</h2></div>
            <table class="tbl">
              <thead><tr><th>昵称</th><th>座位</th><th>同行家长</th><th>入场</th></tr></thead>
              <tbody>
                <tr v-for="c in admittedChildren" :key="c.id">
                  <td>{{ c.nickname }} <span v-if="assessRisk(c, now).high" style="color:var(--critical)">⚠</span></td>
                  <td class="mono">{{ c.seatId }}</td>
                  <td>{{ c.guardians.length }} 名</td>
                  <td>{{ minutesAgo(c.admittedAt!, now) }} 分钟前</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </template>

    <!-- TAB: 中场高风险预警 -->
    <template v-if="tab === 'alerts'">
      <div v-if="!['intermission', 'exit'].includes(store.show.phase)" class="empty">
        中场高风险预警在值班经理把演出推进到「中场休息」后生成；评分综合儿童年龄、座位距出口、单人带娃、家长报备离座与厕所/卖品区拥堵情况。
      </div>
      <template v-else>
        <div class="card tight" style="border-color:#e7c8c8">
          <div class="row" style="align-items:center;gap:10px;flex-wrap:wrap">
            <span style="font-size:18px">🚨</span>
            <strong>中场休息高风险巡查优先级</strong>
            <span class="tag-pill pill-critical">{{ intermissionAlerts.filter((x) => x.a.level === 'high').length }} 高</span>
            <span class="tag-pill pill-serious">{{ intermissionAlerts.filter((x) => x.a.level === 'medium').length }} 中</span>
            <span class="muted small-text">按综合分排序；确认拥挤后安保端会同步出现临时分流通道，巡查记录将在家长报案时自动带入找回事件。</span>
          </div>
        </div>

        <div v-for="{ a, children, latestCheck } in intermissionAlerts" :key="a.id" class="card" :class="a.level === 'high' ? 'pulse' : ''" :style="a.level === 'high' ? 'border-color:#e7c8c8' : ''">
          <div class="card-title">
            <h2>{{ zoneName(a.zoneId) }}</h2>
            <span class="tag-pill" :class="alertLevelMeta[a.level].cls">{{ alertLevelMeta[a.level].text }}</span>
            <span class="tag-pill pill-gray">优先级分 {{ a.score }}</span>
            <span v-if="a.confirmCount" class="tag-pill pill-serious">已确认拥挤 ×{{ a.confirmCount }}</span>
            <span v-if="a.triggerCount >= 2" class="tag-pill pill-gold">本场反复预警 ×{{ a.triggerCount }}（影响下一场排班/指示牌）</span>
            <span class="spacer"></span>
            <button class="ghost small" @click="clearAlert(a.id)">现场无异常，解除预警</button>
          </div>

          <div class="grid-2">
            <div>
              <h3 style="margin-bottom:6px">评分依据</h3>
              <div v-for="(f, idx) in a.factors" :key="idx" class="list-row" style="align-items:flex-start">
                <span class="dot" :class="a.level === 'high' ? 'dot-critical' : 'dot-warn'" style="margin-top:5px"></span>
                <span class="small-text">{{ f }}</span>
              </div>
              <div v-if="!a.factors.length" class="muted small-text">该分区暂无额外风险因子。</div>

              <h3 class="section-gap" style="margin-bottom:6px">分区内儿童（{{ children.length }}）</h3>
              <div class="row" style="gap:6px;flex-wrap:wrap">
                <span v-for="c in children" :key="c.id" class="tag-pill" :class="c.age <= 4 ? 'pill-critical' : c.age <= 6 ? 'pill-gold' : 'pill-gray'">
                  {{ c.nickname }}·{{ c.age }}岁{{ c.guardians.length <= 1 ? '·单人带娃' : '' }}{{ c.leftSeatAt && !c.returnedAt ? '·离座未归' : '' }}
                </span>
              </div>
            </div>

            <div>
              <VenueMap
                :height="260"
                show-crowd
                :alert-zone-ids="[...alertZoneIds]"
                :diversion-channels="diversionChannels"
                :staff-roles="['usher']"
              />

              <div class="section-gap">
                <label>巡查区域</label>
                <select v-model="alertFormOf(a.id, a.crowdedZoneIds, a.zoneId).zoneId" style="margin-bottom:8px">
                  <option :value="a.zoneId">{{ zoneName(a.zoneId) }}（座位分区巡查）</option>
                  <option v-for="zid in a.crowdedZoneIds" :key="zid" :value="zid">{{ zoneName(zid) }}（预警关联功能区）</option>
                </select>
                <label class="switch-row" style="margin-bottom:8px">
                  <input type="checkbox" v-model="alertFormOf(a.id, a.crowdedZoneIds, a.zoneId).crowded" />
                  <span>
                    <span class="t">{{ alertFormOf(a.id, a.crowdedZoneIds, a.zoneId).crowded ? '确认该区域拥挤，需要安保临时分流' : '到场查看，人流可接受' }}</span>
                    <span class="d" style="display:block">确认拥挤会同步推送分流通道到安保端</span>
                  </span>
                </label>
                <textarea
                  v-model="alertFormOf(a.id, a.crowdedZoneIds, a.zoneId).note"
                  rows="2"
                  :placeholder="alertFormOf(a.id, a.crowdedZoneIds, a.zoneId).crowded ? '如：家庭厕所排队堵到通道，已有儿童与家长被冲散，建议分流东出口' : '如：队列为正常排队，未发现独行儿童'"
                ></textarea>
                <div class="row" style="margin-top:8px">
                  <button :class="alertFormOf(a.id, a.crowdedZoneIds, a.zoneId).crowded ? 'danger' : 'good'" @click="submitAlertCheck(a.id)">
                    {{ alertFormOf(a.id, a.crowdedZoneIds, a.zoneId).crowded ? '确认拥挤并通知安保分流' : '提交巡查记录' }}
                  </button>
                </div>
              </div>

              <div v-if="a.checks.length" class="section-gap">
                <h3 style="margin-bottom:6px">巡查记录（{{ a.checks.length }}）</h3>
                <div v-for="c in [...a.checks].reverse().slice(0, 4)" :key="c.id" class="list-row" style="align-items:flex-start">
                  <span class="dot" :class="c.crowded ? 'dot-critical' : 'dot-good'" style="margin-top:5px"></span>
                  <div class="small-text">
                    <strong>{{ c.staffName }}</strong> 在{{ zoneName(c.zoneId) }}
                    <span :class="c.crowded ? 'tag-pill pill-critical' : 'tag-pill pill-good'" style="margin:0 4px">
                      {{ c.crowded ? '确认拥挤' : '人流正常' }}
                    </span>
                    {{ c.note }}
                    <div class="muted mono" style="font-size:10.5px">{{ formatTime(c.at) }}</div>
                  </div>
                </div>
                <div v-if="latestCheck" class="muted small-text">最近巡查：{{ formatTime(latestCheck.at) }}（{{ latestCheck.staffName }}）</div>
              </div>
            </div>
          </div>
        </div>
      </template>
    </template>

    <!-- TAB: 中场巡查 -->
    <template v-if="tab === 'patrol'">
      <div class="grid-2">
        <div class="card">
          <div class="card-title">
            <h2>🚻 中场拥挤度上报</h2>
            <span class="hint">厕所 / 卖品区 / 互动区 / 出口附近；上报后自动重算重点巡查区域</span>
          </div>
          <div v-for="z in facilityZones" :key="z.id" class="list-row">
            <div style="flex:1">
              <strong>{{ z.name }}</strong>
              <span class="tag-pill" :class="crowdClass[crowdLevelOf(store.crowdReports, z.id, now)]" style="margin-left:8px">
                当前：{{ crowdText[crowdLevelOf(store.crowdReports, z.id, now)] }}
              </span>
              <div class="muted small-text">
                最近上报：
                {{ (store.crowdReports.filter((r) => r.zoneId === z.id).sort((a, b) => b.at - a.at)[0])
                  ? formatTime(store.crowdReports.filter((r) => r.zoneId === z.id).sort((a, b) => b.at - a.at)[0].at)
                  : '无' }}
              </div>
            </div>
            <button class="ghost small" @click="setCrowd(z.id, 'low')">畅通</button>
            <button class="ghost small" @click="setCrowd(z.id, 'medium')">较挤</button>
            <button class="small danger" @click="setCrowd(z.id, 'high')">拥挤</button>
            <button class="small" @click="goPatrol(z.id)">到场巡查</button>
          </div>
          <div class="muted small-text section-gap">
            散场阶段也可对出口附近人流上报；场务每次「到场巡查」的位置与时间会影响安保对出口的拦截选择。
          </div>
        </div>

        <div class="card">
          <div class="card-title"><h2>📊 重点巡查区域建议</h2><span class="hint">拥挤度 × 距上次巡查时长</span></div>
          <table class="tbl">
            <thead><tr><th>优先级</th><th>区域</th><th>人流</th><th>距上次巡查</th><th>操作</th></tr></thead>
            <tbody>
              <tr v-for="(r, idx) in patrolRecommend" :key="r.zone.id">
                <td>
                  <span class="tag-pill" :class="idx === 0 ? 'pill-critical' : idx < 2 ? 'pill-serious' : 'pill-gray'">
                    {{ idx + 1 }}
                  </span>
                </td>
                <td><strong>{{ r.zone.name }}</strong></td>
                <td><span class="tag-pill" :class="crowdClass[r.level]">{{ crowdText[r.level] }}</span></td>
                <td :style="r.staleMinutes >= 8 ? 'color:var(--critical);font-weight:700' : ''">
                  {{ r.staleMinutes === 99 ? '从未巡查' : r.staleMinutes + ' 分钟前' }}
                </td>
                <td>
                  <button class="small" @click="goPatrol(r.zone.id)">前往巡查</button>
                </td>
              </tr>
            </tbody>
          </table>
          <VenueMap :height="300" show-crowd class="section-gap" :staff-roles="['usher']" />
        </div>
      </div>
    </template>

    <!-- TAB: 找回任务 -->
    <template v-if="tab === 'tasks'">
      <div v-if="!myTasks.length" class="empty">当前没有分配给场务的搜寻任务</div>
      <div v-for="{ i, t } in myTasks" :key="t.id" class="card" :class="t.priority === 'high' ? 'pulse' : ''" style="border-color:#e7c8c8">
        <div class="card-title">
          <h2>🔎 搜寻任务 {{ t.id }}</h2>
          <span class="tag-pill" :class="t.priority === 'high' ? 'pill-critical' : 'pill-info'">
            {{ t.priority === 'high' ? '高优先级' : '常规' }}
          </span>
          <span class="tag-pill" :class="t.status === 'done' ? 'pill-good' : t.status === 'accepted' ? 'pill-info' : 'pill-warn'">
            {{ { pending: '待接单', accepted: '处置中', done: '已完成' }[t.status] }}
          </span>
          <span class="spacer"></span>
          <span class="muted small-text">事件 {{ i.id }} · {{ formatTime(t.createdAt) }}</span>
        </div>

        <div class="grid-2">
          <div>
            <p class="small-text" style="background:var(--surface-2);border:1px solid var(--border);border-radius:8px;padding:10px">
              {{ t.instruction }}
            </p>
            <div class="row section-gap">
              <button v-if="t.status === 'pending'" @click="accept(i, t.id)">接单并开始搜寻</button>
              <button class="ghost" @click="goPatrol(formOf(i.id).zoneId, i.id)">到所选分区打卡</button>
            </div>

            <div class="section-gap">
              <label>当前排查区域</label>
              <select v-model="formOf(i.id).zoneId" style="margin-bottom:8px">
                <option v-for="zid in t.zoneIds" :key="zid" :value="zid">{{ ZONES_BY_ID.get(zid)?.name }}</option>
              </select>
              <label class="switch-row" style="margin-bottom:8px">
                <input type="checkbox" v-model="formOf(i.id).found" />
                <span>
                  <span class="t">{{ formOf(i.id).found ? '✅ 在该区域发现目标儿童' : '该区域未发现，继续搜寻' }}</span>
                  <span class="d" style="display:block">勾选发现将引导与家长交接并关闭事件</span>
                </span>
              </label>
              <textarea v-model="formOf(i.id).note" rows="2" :placeholder="formOf(i.id).found ? '说明孩子状态与交接安排' : '现场观察，如：女厕排队约 15 人，已问队首未见'"></textarea>
              <div class="row" style="margin-top:8px">
                <button :class="formOf(i.id).found ? 'good' : ''" @click="submitCheck(i)">
                  {{ formOf(i.id).found ? '确认找到并完成交接' : '提交排查结果（系统重算搜寻/拦截）' }}
                </button>
              </div>
            </div>
          </div>

          <div>
            <VenueMap
              :height="280"
              show-crowd
              :last-seen-zone-id="i.lastSeenZoneId"
              :assigned-zone-ids="[...assignedZoneIds]"
              :found-zone-ids="[...foundZoneIds]"
              :alert-zone-ids="[...alertZoneIds]"
              :diversion-channels="diversionChannels"
              :staff-roles="['usher', 'security']"
            />
            <div class="section-gap">
              <h3 style="margin-bottom:6px">处置动态</h3>
              <IncidentTimeline :incident="i" :limit="8" />
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
