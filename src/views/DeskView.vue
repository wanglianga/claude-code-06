<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useShowStore } from '@/stores/show'
import { useRoleStore } from '@/stores/role'
import { useToastStore } from '@/stores/toast'
import { formatTime, minutesAgo } from '@/domain/engine'
import { ZONES_BY_ID } from '@/domain/seed'
import type { Incident } from '@/domain/types'
import IncidentTimeline from '@/components/IncidentTimeline.vue'

const store = useShowStore()
const role = useRoleStore()
const toast = useToastStore()
const { now } = storeToRefs(store)

const deskStaff = computed(() => store.staff.filter((s) => s.role === 'desk'))
if (!role.staffId || !deskStaff.value.some((s) => s.id === role.staffId)) {
  role.loginAs(deskStaff.value[0]?.id ?? 'D1')
}
const me = computed(() => store.staffById(role.staffId)!)

const selectedId = ref('')
const incidents = computed(() => store.activeIncidents)
const selected = computed<Incident | undefined>(
  () => incidents.value.find((i) => i.id === selectedId.value) ?? incidents.value[0]
)

function selectId(id: string) {
  selectedId.value = id
}

// ---------- 核验表单 ----------
const v = reactive({
  appearance: '',
  featureMatch: false,
  seatMatch: false,
  guardianMatch: false,
  mismatchNote: '',
})

function resetForm() {
  v.appearance = ''
  v.featureMatch = false
  v.seatMatch = false
  v.guardianMatch = false
  v.mismatchNote = ''
}

function submitCheck() {
  if (!selected.value) return
  if (!v.appearance.trim()) return toast.push('请先记录疑似儿童的自述与实际衣着', 'critical')
  const matched = [v.featureMatch, v.seatMatch, v.guardianMatch].filter(Boolean).length
  if (matched === 0) return toast.push('请至少勾选一项核对结果，或在不符说明中描述', 'critical')
  if (!v.featureMatch && !v.mismatchNote.trim())
    return toast.push('特征不符时请填写不符点（广播将据此更正描述）', 'critical')
  store.submitDeskCheck({
    incidentId: selected.value.id,
    childAppearance: v.appearance.trim(),
    featureMatch: v.featureMatch,
    seatMatch: v.seatMatch,
    guardianMatch: v.guardianMatch,
    mismatchNote: v.mismatchNote.trim() || undefined,
    handlerId: role.staffId,
  })
  const decision = [...selected.value.deskChecks].pop()!.decision
  const msgMap: Record<string, string> = {
    notify_parent: '三项匹配但家长未授权临看：已通知家长到服务台认领',
    escort_seat: '三项匹配且已授权临看：请安排双人护送回座',
    broadcast: '信息不符：已升级全场广播（文案已按实际衣着更正）',
  }
  toast.push(msgMap[decision], decision === 'broadcast' ? 'critical' : 'good', 5600)
  resetForm()
}

function parentPickup() {
  if (!selected.value) return
  if (!window.confirm('确认家长已到场、身份与紧急联系人一致，完成当面认领？')) return
  store.resolveAtDesk(selected.value.id, 'parent_pickup', role.staffId)
  toast.push('儿童已交还家长，事件关闭', 'good')
}
function escortDone() {
  if (!selected.value) return
  if (!window.confirm('确认已双人护送回座位并与同行家长完成交接？')) return
  store.resolveAtDesk(selected.value.id, 'escort_done', role.staffId)
  toast.push('护送交接完成，事件关闭', 'good')
}

function reBroadcast() {
  if (!selected.value) return
  store.escalateBroadcast(selected.value.id, me.value.name)
  toast.push('已再次广播')
}

const statusPill = (i: Incident) =>
  ({
    searching: ['pill-warn', '搜寻中'],
    broadcast: ['pill-serious', '已广播'],
    police: ['pill-critical', '警方介入'],
    reunited: ['pill-good', '已团聚'],
    closed_lost: ['pill-gray', '未找到归档'],
  })[i.status] ?? ['pill-gray', i.status]
</script>

<template>
  <div class="stack">
    <div class="card tight row">
      <span style="font-size:20px">ℹ️</span>
      <strong>服务台值班：</strong>
      <select v-model="role.staffId" style="width:150px">
        <option v-for="s in deskStaff" :key="s.id" :value="s.id">{{ s.name }}（{{ s.id }}）</option>
      </select>
      <span class="tag-pill" :class="me.status === 'busy' ? 'pill-critical' : 'pill-good'">
        {{ me.status === 'busy' ? '有接报任务' : '值守中' }}
      </span>
      <span style="flex:1"></span>
      <span class="muted small-text">接到独行儿童一律先留在服务台，按「特征 → 座位 → 家长」逐项核对后再决定处置</span>
    </div>

    <div v-if="!incidents.length" class="empty">
      当前没有走失事件。服务台将在家长报案的同时收到待命任务，包含儿童衣着、座位与家长联系方式。
    </div>

    <template v-else>
      <div class="card tight row">
        <strong>待处置事件：</strong>
        <button
          v-for="i in incidents"
          :key="i.id"
          class="small"
          :class="selected?.id === i.id ? '' : 'ghost'"
          @click="selectId(i.id)"
        >
          {{ i.childSnapshot.nickname }} · {{ i.id }}
          <span class="tag-pill" :class="statusPill(i)[0]" style="margin-left:6px">{{ statusPill(i)[1] }}</span>
        </button>
      </div>

      <template v-if="selected">
        <div v-if="selected.broadcast" class="broadcast-banner">
          <div class="bb-title">
            📢 当前广播文案（第 {{ selected.broadcast.times }} 次 · {{ formatTime(selected.broadcast.at) }}）
            <button class="small ghost" style="margin-left:auto" @click="reBroadcast">🔁 再播一次</button>
          </div>
          <div class="bb-body">{{ selected.broadcast.content }}</div>
          <div class="small-text" style="opacity:.9;margin-top:6px">广播内容会随服务台核验结果变化：特征不符时改为「寻人更正」，家长待认领时提示凭预留电话到服务台。</div>
        </div>

        <div class="layout-map">
          <!-- 左：核验录入 -->
          <div class="stack">
            <div class="card">
              <div class="card-title">
                <h2>🧒 接到疑似儿童 · 三项核对</h2>
                <span class="hint">事件 {{ selected.id }} · 报案已 {{ minutesAgo(selected.createdAt, now) }} 分钟</span>
              </div>

              <label>疑似儿童自述 / 实际衣着记录 *</label>
              <textarea v-model="v.appearance" rows="2" placeholder="如：自称小糯米，穿粉色卫衣、白裤子，扎双马尾，说跟妈妈去厕所走散了" style="margin-bottom:10px"></textarea>

              <div class="stack" style="gap:8px">
                <label class="switch-row">
                  <input type="checkbox" v-model="v.featureMatch" />
                  <span>
                    <span class="t">① 衣着特征相符</span>
                    <span class="d" style="display:block">对照：{{ selected.childSnapshot.topColor }}上装 / {{ selected.childSnapshot.bottomColor }}下装{{ selected.childSnapshot.features ? '；' + selected.childSnapshot.features : '' }}</span>
                  </span>
                </label>
                <label class="switch-row">
                  <input type="checkbox" v-model="v.seatMatch" />
                  <span>
                    <span class="t">② 座位信息相符</span>
                    <span class="d" style="display:block">孩子自述座位与登记座位 <span class="mono">{{ selected.childSnapshot.seatId }}</span> 一致</span>
                  </span>
                </label>
                <label class="switch-row">
                  <input type="checkbox" v-model="v.guardianMatch" />
                  <span>
                    <span class="t">③ 家长信息相符</span>
                    <span class="d" style="display:block">能说出同行家长姓名/电话，与登记一致：{{ selected.childSnapshot.guardians.map((g) => g.name + g.phone).join('、') }}</span>
                  </span>
                </label>
              </div>

              <label class="section-gap">不符点 / 补充说明（特征不符时必填，将用于更正广播）</label>
              <textarea v-model="v.mismatchNote" rows="2" placeholder="如：孩子穿蓝色上衣，与登记的粉色不符，也说不出座位号"></textarea>

              <div class="row section-gap">
                <button class="danger" @click="submitCheck">提交核验，生成处置决定</button>
                <button class="ghost" @click="resetForm">清空</button>
                <span class="muted small-text">
                  已勾 {{ [v.featureMatch, v.seatMatch, v.guardianMatch].filter(Boolean).length }}/3 项
                </span>
              </div>
            </div>

            <!-- 历次核验与决定 -->
            <div class="card">
              <div class="card-title"><h2>📝 本事件核验记录</h2></div>
              <div v-if="!selected.deskChecks.length" class="empty">尚无核验记录</div>
              <div v-for="d in [...selected.deskChecks].reverse()" :key="d.id" class="list-row" style="align-items:flex-start">
                <span
                  class="dot"
                  :class="d.decision === 'escort_seat' ? 'dot-good' : d.decision === 'notify_parent' ? 'dot-warn' : 'dot-serious'"
                  style="margin-top:5px"
                ></span>
                <div style="flex:1">
                  <div class="row">
                    <strong>{{ formatTime(d.at) }} · {{ d.handler }} 受理</strong>
                    <span class="tag-pill" :class="{
                      'pill-good': d.decision === 'escort_seat',
                      'pill-warn': d.decision === 'notify_parent',
                      'pill-serious': d.decision === 'broadcast',
                    }">
                      {{ { notify_parent: '通知家长到服务台', escort_seat: '护送回座位', broadcast: '升级广播' }[d.decision] }}
                    </span>
                  </div>
                  <div class="small-text" style="margin-top:4px">
                    衣着记录：{{ d.childAppearance }}
                  </div>
                  <div class="small-text muted">
                    核对：特征 {{ d.featureMatch ? '✓' : '✗' }} / 座位 {{ d.seatMatch ? '✓' : '✗' }} / 家长 {{ d.guardianMatch ? '✓' : '✗' }}
                    <template v-if="d.mismatchNote">；不符点：{{ d.mismatchNote }}</template>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- 右：档案与处置动作 -->
          <div class="stack">
            <div class="card">
              <div class="card-title"><h2>🛡️ 登记档案（核对依据）</h2></div>
              <div class="kv">
                <span class="k">昵称/年龄</span><span>{{ selected.childSnapshot.nickname }}，{{ selected.childSnapshot.age }} 岁</span>
                <span class="k">登记衣着</span><span>{{ selected.childSnapshot.topColor }}上装 / {{ selected.childSnapshot.bottomColor }}下装</span>
                <span class="k">明显特征</span><span>{{ selected.childSnapshot.features || '—' }}</span>
                <span class="k">座位</span><span class="mono">{{ selected.childSnapshot.seatId }}（{{ ZONES_BY_ID.get(selected.childSnapshot.seatId.slice(0, 6))?.name }}）</span>
                <span class="k">同行家长</span>
                <span>{{ selected.childSnapshot.guardians.map((g) => `${g.relation} ${g.name} ${g.phone}`).join('；') }}</span>
                <span class="k">紧急联系人</span><span>{{ selected.childSnapshot.emergencyContact }}</span>
                <span class="k">临时看护</span>
                <span :style="!selected.childSnapshot.temporaryCareAllowed ? 'color:var(--critical);font-weight:600' : 'color:var(--good);font-weight:600'">
                  {{ selected.childSnapshot.temporaryCareAllowed ? '✓ 已授权，可护送回座' : '✗ 未授权，必须家长当面认领' }}
                </span>
                <span class="k">最后出现</span>
                <span>{{ ZONES_BY_ID.get(selected.lastSeenZoneId)?.name }}（{{ selected.lastSeenNote }}）</span>
              </div>
              <div class="list-row section-gap" :class="selected.parentNotifyWay?.includes('服务台') ? 'danger' : ''">
                <span class="dot dot-info"></span>
                <div class="small-text"><strong>家长通知方式（随处置自动变化）：</strong><br />{{ selected.parentNotifyWay || '电话告知搜寻分区与预计反馈时间，App 实时推送进展' }}</div>
              </div>
            </div>

            <!-- 执行处置 -->
            <div class="card">
              <div class="card-title"><h2>✅ 执行处置</h2><span class="hint">依据最近一次核验结论</span></div>
              <template v-if="selected.deskChecks.length">
                <div class="stack" style="gap:10px">
                  <div class="list-row">
                    <span class="dot dot-warn"></span>
                    <div style="flex:1" class="small-text">
                      <strong>通知家长到服务台</strong>
                      <div class="muted">适用于：三项匹配但家长未授权临时看护。家长到场前儿童留在服务台，不得交由他人代领。</div>
                    </div>
                    <button class="small good" @click="parentPickup">家长已当面认领</button>
                  </div>
                  <div class="list-row">
                    <span class="dot dot-good"></span>
                    <div style="flex:1" class="small-text">
                      <strong>派人护送回座位</strong>
                      <div class="muted">适用于：三项匹配且家长已授权临看。双人护送至 <span class="mono">{{ selected.childSnapshot.seatId }}</span> 并与家长交接。</div>
                    </div>
                    <button class="small good" @click="escortDone">护送交接完成</button>
                  </div>
                  <div class="list-row">
                    <span class="dot dot-serious"></span>
                    <div style="flex:1" class="small-text">
                      <strong>升级广播</strong>
                      <div class="muted">核验不符时已自动触发；如长时间无线索也可手动再播，安保同步关注全部出口。</div>
                    </div>
                    <button class="small danger" @click="reBroadcast">📢 手动广播</button>
                  </div>
                </div>
              </template>
              <div v-else class="empty">完成三项核对后，这里会出现对应的处置按钮</div>
            </div>

            <div class="card">
              <div class="card-title"><h2>🕓 协同动态</h2></div>
              <IncidentTimeline :incident="selected" :limit="10" />
            </div>
          </div>
        </div>
      </template>
    </template>
  </div>
</template>
