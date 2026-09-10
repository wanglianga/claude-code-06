<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useShowStore } from '@/stores/show'
import { useRoleStore } from '@/stores/role'
import { useToastStore } from '@/stores/toast'
import { formatTime, minutesAgo } from '@/domain/engine'
import { ZONES, ZONES_BY_ID } from '@/domain/seed'
import VenueMap from '@/components/VenueMap.vue'
import IncidentTimeline from '@/components/IncidentTimeline.vue'
import type { Incident } from '@/domain/types'

const store = useShowStore()
const role = useRoleStore()
const toast = useToastStore()
const { now } = storeToRefs(store)

const securities = computed(() => store.staff.filter((s) => s.role === 'security'))
if (!role.staffId || !securities.value.some((s) => s.id === role.staffId)) {
  role.loginAs(securities.value[0]?.id ?? 'S1')
}
const me = computed(() => store.staffById(role.staffId)!)

const exits = ZONES.filter((z) => z.type === 'exit')

const myTasks = computed(() =>
  store.activeIncidents.flatMap((i) => i.tasks.filter((t) => t.role === 'security').map((t) => ({ i, t })))
)

const selectedId = ref<string>('')
const selected = computed<Incident | undefined>(
  () => store.incidentById(selectedId.value) ?? store.activeIncidents[0]
)
if (!selectedId.value && store.activeIncidents[0]) selectedId.value = store.activeIncidents[0].id

function selectIncident(id: string) {
  selectedId.value = id
}

function accept(i: Incident, taskId: string) {
  store.acceptTask(i.id, taskId, role.staffId)
  toast.push('已接单：请立即前往指定出口', 'good')
}

function reassign(i: Incident, taskId: string) {
  store.reassignTask(i.id, taskId)
  toast.push('已请求系统改派最近空闲安保')
}

function moveHere(zoneId: string, incId?: string) {
  store.moveStaff(role.staffId, zoneId, incId)
  toast.push(`已到「${ZONES_BY_ID.get(zoneId)?.name}」打卡，拦截计划将参考此巡查位置`)
}

function toggleExit(i: Incident, zoneId: string, active: boolean) {
  store.setManualIntercept(i.id, zoneId, active, me.value.name)
  toast.push(active ? '已加派布控该出口' : '已解除该出口拦截')
}

const cctvNote = reactive<Record<string, string>>({})
const policeNote = reactive<Record<string, string>>({})

function requestCctv(i: Incident) {
  if (!cctvNote[i.id]?.trim()) return toast.push('请填写需要调阅的摄像点位与时段', 'critical')
  store.requestCctv(i.id, cctvNote[i.id], me.value.name)
  toast.push('监控调阅请求已发送安防中心')
}
function callPolice(i: Incident) {
  if (!policeNote[i.id]?.trim()) return toast.push('请填写警情说明（体貌/最后位置/停留时长）', 'critical')
  if (!window.confirm('确认拨打 110 请求警方协助？确认后全部出口强制拦截。')) return
  store.callPolice(i.id, policeNote[i.id], me.value.name)
  toast.push('已报警，全部出口进入强制拦截', 'critical', 6000)
}

function interceptionOf(i: Incident, zoneId: string) {
  return i.interceptions.find((x) => x.zoneId === zoneId)
}
const activeExitIds = computed(() => {
  if (!selected.value) return []
  return selected.value.interceptions.filter((x) => x.active).map((x) => x.zoneId)
})

// ---------- 中场预警触发的临时分流通道 ----------
const diversionNotes = reactive<Record<string, string>>({})
function closeDiversion(d: { id: string }) {
  if (!diversionNotes[d.id]?.trim()) return toast.push('请填写疏导处置说明后再关闭通道', 'critical')
  store.closeDiversion(d.id, diversionNotes[d.id].trim(), role.staffId)
  toast.push('临时分流通道已关闭并回传场务端', 'good')
}
function diversionMapLayers() {
  return store.activeDiversions.map((d) => ({ zoneId: d.zoneId, exitId: d.exitId, active: d.active }))
}

const mySelectedTasks = computed(() =>
  selected.value ? myTasks.value.filter((x) => x.i.id === selected.value!.id) : []
)
</script>

<template>
  <div class="stack">
    <div class="card tight row">
      <span style="font-size:20px">🛡️</span>
      <strong>当前安保：</strong>
      <select v-model="role.staffId" style="width:150px">
        <option v-for="s in securities" :key="s.id" :value="s.id">{{ s.name }}（{{ s.id }}）</option>
      </select>
      <span class="tag-pill" :class="me.status === 'busy' ? 'pill-critical' : 'pill-good'">
        {{ me.status === 'busy' ? '执行任务中' : '岗哨待命' }}
      </span>
      <span class="muted small-text">当前位置：{{ ZONES_BY_ID.get(me.zoneId)?.name }}</span>
    </div>

    <!-- 中场预警触发的临时分流通道（无走失事件时也显示） -->
    <div v-if="['intermission', 'exit'].includes(store.show.phase)" class="card" :class="store.activeDiversions.length ? 'pulse' : ''" style="border-color:#e7c8c8">
      <div class="card-title">
        <h2>🔀 临时分流通道</h2>
        <span class="hint">场务在中场高风险预警中「确认区域拥挤」后同步生成，用于快速分流观众、冲散拥堵点</span>
        <span class="tag-pill" :class="store.activeDiversions.length ? 'pill-critical' : 'pill-good'">
          {{ store.activeDiversions.length }} 条生效中
        </span>
      </div>
      <div v-if="!store.activeDiversions.length" class="empty">
        当前没有临时分流通道。中场休息期间若场务确认厕所/卖品区拥挤，对应通道会自动出现在这里。
      </div>
      <div v-for="d in store.activeDiversions" :key="d.id" class="list-row" style="align-items:flex-start">
        <span class="dot dot-critical" style="margin-top:5px"></span>
        <div style="flex:1">
          <div class="row">
            <strong>{{ ZONES_BY_ID.get(d.zoneId)?.name }} → {{ ZONES_BY_ID.get(d.exitId)?.name }}</strong>
            <span class="tag-pill pill-critical">分流中</span>
            <span class="muted small-text mono">{{ formatTime(d.createdAt) }} 建立</span>
          </div>
          <div class="small-text muted" style="margin:4px 0">{{ d.reason }}</div>
          <div class="row" style="gap:8px">
            <button class="small" @click="moveHere(d.exitId)">到{{ ZONES_BY_ID.get(d.exitId)?.shortName }}打卡</button>
            <input v-model="diversionNotes[d.id]" placeholder="疏导处置说明，如：已拉隔离带、引导排队改道" style="flex:1;min-width:220px" />
            <button class="small good" @click="closeDiversion(d)">人流回落，关闭通道</button>
          </div>
        </div>
      </div>
      <VenueMap
        :height="320"
        show-crowd
        :alert-zone-ids="store.activeAlerts.filter(a => a.level !== 'low').map(a => a.zoneId)"
        :diversion-channels="diversionMapLayers()"
        :staff-roles="['usher', 'security']"
        class="section-gap"
      />
    </div>

    <div v-if="!store.activeIncidents.length" class="empty">
      暂无走失事件。安保岗保持关注各出口，散场阶段系统会根据场务最后巡查位置自动生成出口拦截任务。
    </div>

    <template v-else>
      <!-- 事件选择 -->
      <div class="card tight row">
        <strong>处置中事件：</strong>
        <button
          v-for="i in store.activeIncidents"
          :key="i.id"
          class="small"
          :class="selected?.id === i.id ? '' : 'ghost'"
          @click="selectIncident(i.id)"
        >
          {{ i.childSnapshot.nickname }} · {{ i.id }}
          <span v-if="i.status === 'police'" class="tag-pill pill-critical" style="margin-left:6px">警方</span>
          <span v-else-if="i.status === 'broadcast'" class="tag-pill pill-serious" style="margin-left:6px">广播</span>
        </button>
      </div>

      <template v-if="selected">
        <!-- 广播横幅 -->
        <div v-if="selected.broadcast" class="broadcast-banner">
          <div class="bb-title">📢 全场广播进行中（第 {{ selected.broadcast.times }} 次）· {{ formatTime(selected.broadcast.at) }}</div>
          <div class="bb-body">{{ selected.broadcast.content }}</div>
        </div>

        <div class="layout-map">
          <!-- 左：地图 + 拦截控制 -->
          <div class="stack">
            <div class="card">
              <div class="card-title">
                <h2>🚪 出口拦截态势</h2>
                <span class="hint">红色出口=拦截中；场务最后巡查位置会自动影响布控，安保可手动调整</span>
              </div>
              <VenueMap
                :height="380"
                show-crowd
                :last-seen-zone-id="selected.lastSeenZoneId"
                :intercept-zone-ids="activeExitIds"
                :alert-zone-ids="store.activeAlerts.filter(a => a.level !== 'low').map(a => a.zoneId)"
                :diversion-channels="diversionMapLayers()"
                :staff-roles="['usher', 'security']"
              />
              <table class="tbl section-gap">
                <thead><tr><th>出口</th><th>状态</th><th>系统依据</th><th>操作</th></tr></thead>
                <tbody>
                  <tr v-for="z in exits" :key="z.id">
                    <td><strong>{{ z.name }}</strong></td>
                    <td>
                      <span :class="interceptionOf(selected, z.id)?.active ? 'tag-pill pill-critical' : 'tag-pill pill-gray'">
                        {{ interceptionOf(selected, z.id)?.active ? '● 拦截中' : '○ 常规关注' }}
                      </span>
                    </td>
                    <td class="small-text muted" style="max-width:260px">
                      {{ interceptionOf(selected, z.id)?.reason || '尚无计划（等待散场阶段或场务巡查数据）' }}
                      <div v-if="interceptionOf(selected, z.id)" class="mono" style="font-size:10.5px">
                        更新于 {{ formatTime(interceptionOf(selected, z.id)!.updatedAt) }}
                      </div>
                    </td>
                    <td>
                      <div class="row" style="gap:6px">
                        <button class="small" @click="moveHere(z.id, selected.id)">到场打卡</button>
                        <button
                          v-if="!interceptionOf(selected, z.id)?.active"
                          class="small danger"
                          @click="toggleExit(selected, z.id, true)"
                        >加派布控</button>
                        <button v-else class="small ghost" @click="toggleExit(selected, z.id, false)">解除</button>
                      </div>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <!-- 监控与警方 -->
            <div class="card">
              <div class="card-title"><h2>📹 监控调阅 / 🚓 警方协助</h2><span class="hint">散场仍未找到时，与拦截、广播状态归在同一事件</span></div>
              <div class="grid-2">
                <div>
                  <label>监控调阅申请（点位 + 时段）</label>
                  <textarea
                    v-model="cctvNote[selected.id]"
                    rows="2"
                    :disabled="selected.cctvRequested"
                    placeholder="如：调阅家庭厕所门口 19:55-20:05、东出口通道近 10 分钟画面"
                  ></textarea>
                  <div class="row" style="margin-top:6px">
                    <button :disabled="selected.cctvRequested" @click="requestCctv(selected)">
                      {{ selected.cctvRequested ? '✓ 已申请调阅' : '申请调阅监控' }}
                    </button>
                  </div>
                  <div v-if="selected.cctvNote" class="small-text muted section-gap">已申请：{{ selected.cctvNote }}（{{ formatTime(selected.createdAt) }} 后由安防中心回传）</div>
                </div>
                <div>
                  <label>110 警情说明</label>
                  <textarea
                    v-model="policeNote[selected.id]"
                    rows="2"
                    :disabled="selected.policeCalled"
                    placeholder="体貌特征、最后出现位置、已停留时长、家长联系方式"
                  ></textarea>
                  <div class="row" style="margin-top:6px">
                    <button class="danger" :disabled="selected.policeCalled" @click="callPolice(selected)">
                      {{ selected.policeCalled ? '✓ 已报警（全出口强制拦截）' : '🚓 报警请求警方协助' }}
                    </button>
                  </div>
                  <div v-if="selected.policeNote" class="small-text muted section-gap">警情：{{ selected.policeNote }}</div>
                </div>
              </div>
            </div>
          </div>

          <!-- 右：儿童信息 + 任务 + 时间线 -->
          <div class="stack">
            <div class="card" :class="selected.status === 'police' ? 'pulse' : ''" style="border-color:#e7c8c8">
              <div class="card-title">
                <h2>🧒 走失目标：{{ selected.childSnapshot.nickname }}</h2>
                <span class="tag-pill" :class="selected.stage === 'exit' ? 'pill-critical' : selected.stage === 'intermission' ? 'pill-serious' : 'pill-warn'">
                  {{ { entry: '入场走失', intermission: '中场走失', exit: '散场走失' }[selected.stage] }}
                </span>
              </div>
              <div class="kv">
                <span class="k">年龄</span><span>{{ selected.childSnapshot.age }} 岁</span>
                <span class="k">衣着</span><span>{{ selected.childSnapshot.topColor }}上装 / {{ selected.childSnapshot.bottomColor }}下装</span>
                <span class="k">特征</span><span>{{ selected.childSnapshot.features || '—' }}</span>
                <span class="k">座位</span><span class="mono">{{ selected.childSnapshot.seatId }}</span>
                <span class="k">最后出现</span>
                <span>{{ ZONES_BY_ID.get(selected.lastSeenZoneId)?.name }} · {{ minutesAgo(selected.lastSeenAt, now) }} 分钟前</span>
                <span class="k">家长</span>
                <span>{{ selected.childSnapshot.guardians.map((g) => `${g.relation}${g.name} ${g.phone}`).join('；') }}</span>
                <span class="k">紧急联系</span><span>{{ selected.childSnapshot.emergencyContact }}</span>
                <span class="k">看护授权</span>
                <span :style="!selected.childSnapshot.temporaryCareAllowed ? 'color:var(--critical);font-weight:600' : ''">
                  {{ selected.childSnapshot.temporaryCareAllowed ? '允许临时看护（可护送回座）' : '未授权（必须家长当面认领）' }}
                </span>
                <span class="k">报案人</span><span>{{ selected.reportedBy }} {{ selected.reporterPhone }}</span>
              </div>
            </div>

            <div class="card">
              <div class="card-title"><h2>📋 安保任务</h2></div>
              <div v-for="{ t } in mySelectedTasks" :key="t.id" class="list-row" style="align-items:flex-start">
                <span class="dot" :class="t.status === 'done' ? 'dot-good' : t.status === 'accepted' ? 'dot-critical' : 'dot-warn'"></span>
                <div style="flex:1">
                  <div class="row">
                    <strong>任务 {{ t.id }}</strong>
                    <span class="tag-pill" :class="t.status === 'done' ? 'pill-good' : t.status === 'accepted' ? 'pill-critical' : 'pill-warn'">
                      {{ { pending: '待接单', accepted: '处置中', done: '已完成' }[t.status] }}
                    </span>
                  </div>
                  <div class="small-text" style="margin:4px 0">{{ t.instruction }}</div>
                  <div class="small-text muted">指派：{{ t.staffName }}</div>
                  <div class="row" style="margin-top:6px">
                    <button v-if="t.status === 'pending'" class="small" @click="accept(selected, t.id)">接单</button>
                    <button v-if="t.status === 'pending'" class="small ghost" @click="reassign(selected, t.id)">改派最近人员</button>
                  </div>
                </div>
              </div>
              <div v-if="!mySelectedTasks.length" class="empty">本事件暂无安保任务</div>
            </div>

            <div class="card">
              <div class="card-title"><h2>🕓 协同动态</h2></div>
              <IncidentTimeline :incident="selected" :limit="12" />
            </div>
          </div>
        </div>
      </template>
    </template>
  </div>
</template>
