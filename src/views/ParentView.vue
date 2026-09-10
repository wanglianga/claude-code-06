<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useShowStore } from '@/stores/show'
import { useRoleStore } from '@/stores/role'
import { useToastStore } from '@/stores/toast'
import { assessRisk, formatTime, minutesAgo } from '@/domain/engine'
import { SEATS, ZONES, ZONES_BY_ID } from '@/domain/seed'
import type { Guardian } from '@/domain/types'
import IncidentTimeline from '@/components/IncidentTimeline.vue'

const store = useShowStore()
const role = useRoleStore()
const toast = useToastStore()
const { now } = storeToRefs(store)

// ---------- 订单选择（演示用：家长用订单号进入） ----------
const myOrders = computed(() => store.children.map((c) => c.orderNo))
const currentOrder = computed({
  get: () => role.orderNo,
  set: (v: string) => role.selectOrder(v),
})
const myChild = computed(() => store.children.find((c) => c.orderNo === currentOrder.value))
const myIncident = computed(() => store.incidents.find((i) => i.childId === myChild.value?.id))

// ---------- 登记表单 ----------
const seatOptions = computed(() =>
  SEATS.filter((s) => !store.children.some((c) => c.seatId === s.id)).sort((a, b) => a.id.localeCompare(b.id))
)

interface FormState {
  orderNo: string
  nickname: string
  age: number | ''
  topColor: string
  bottomColor: string
  features: string
  seatId: string
  guardians: Guardian[]
  emergencyContact: string
  temporaryCareAllowed: boolean
  firstVisit: boolean
  multiChild: boolean
  communication: boolean
}

const emptyForm = (): FormState => ({
  orderNo: '',
  nickname: '',
  age: 5,
  topColor: '',
  bottomColor: '',
  features: '',
  seatId: '',
  guardians: [{ name: '', relation: '妈妈', phone: '' }],
  emergencyContact: '',
  temporaryCareAllowed: false,
  firstVisit: false,
  multiChild: false,
  communication: false,
})

const form = ref<FormState>(emptyForm())
const showForm = ref(false)

function addGuardian() {
  form.value.guardians.push({ name: '', relation: '', phone: '' })
}
function removeGuardian(idx: number) {
  form.value.guardians.splice(idx, 1)
}

const riskPreview = computed(() => {
  if (!form.value.nickname) return null
  return assessRisk(
    {
      highRiskFamily: form.value.firstVisit || form.value.multiChild || form.value.communication,
      highRiskReason: riskReason.value,
      age: Number(form.value.age) || 5,
      guardians: form.value.guardians,
      temporaryCareAllowed: form.value.temporaryCareAllowed,
      features: form.value.features,
    } as any,
    now.value
  )
})

const riskReason = computed(() => {
  const r: string[] = []
  if (form.value.firstVisit) r.push('首次到场')
  if (form.value.multiChild) r.push('多孩同行')
  if (form.value.communication) r.push('儿童存在沟通/听力障碍')
  return r.join('，')
})

function submitRegister() {
  const f = form.value
  if (!/^DD\d{8,}$/.test(f.orderNo.trim())) return toast.push('订单号格式应为 DD + 8 位以上数字（如 DD20260910007）', 'critical')
  if (store.children.some((c) => c.orderNo === f.orderNo.trim())) return toast.push('该订单号已登记儿童安全服务', 'critical')
  if (!f.nickname.trim()) return toast.push('请填写儿童昵称', 'critical')
  if (!f.age || f.age < 1 || f.age > 14) return toast.push('请填写有效年龄（1-14 岁）', 'critical')
  if (!f.topColor.trim() || !f.bottomColor.trim()) return toast.push('请填写上装与下装颜色，便于工作人员识别', 'critical')
  if (!f.seatId) return toast.push('请选择座位号（与购票座位一致）', 'critical')
  if (!f.guardians[0]?.name || !f.guardians[0]?.phone) return toast.push('请至少填写 1 名同行家长姓名与电话', 'critical')
  if (!f.emergencyContact.trim()) return toast.push('请填写紧急联系人', 'critical')

  const high = f.firstVisit || f.multiChild || f.communication
  const child = store.registerChild({
    orderNo: f.orderNo.trim(),
    nickname: f.nickname.trim(),
    age: Number(f.age),
    topColor: f.topColor.trim(),
    bottomColor: f.bottomColor.trim(),
    features: f.features.trim(),
    seatId: f.seatId,
    guardians: f.guardians.filter((g) => g.name && g.phone),
    emergencyContact: f.emergencyContact.trim(),
    temporaryCareAllowed: f.temporaryCareAllowed,
    highRiskFamily: high,
    highRiskReason: high ? riskReason.value : undefined,
  })
  toast.push(`安全档案已建立：${child.nickname}（${child.id}），请在入场时走闸机核验`, 'good')
  currentOrder.value = child.orderNo
  showForm.value = false
  form.value = emptyForm()
}

// ---------- 中场报案 ----------
const showReport = ref(false)
const report = reactive({ zoneId: 'toilet-family', note: '' })
const reporterName = ref('')
const reporterPhone = ref('')
const reportZones = ZONES.filter((z) => ['facility', 'seat', 'exit', 'gate', 'desk'].includes(z.type))

function submitReport() {
  if (!myChild.value) return
  if (store.show.phase === 'closed') return toast.push('演出已结束，无法报案', 'critical')
  if (!reporterName.value.trim() || !/^\d{11}$/.test(reporterPhone.value.trim()))
    return toast.push('请填写报案家长姓名与 11 位手机号', 'critical')
  const inc = store.reportMissing({
    childId: myChild.value.id,
    reportedBy: reporterName.value.trim(),
    reporterPhone: reporterPhone.value.trim(),
    lastSeenZoneId: report.zoneId,
    lastSeenNote: report.note.trim() || '无补充',
  })
  toast.push(`已立案 ${inc.id}，找回任务已推送给最近的场务、安保和服务台`, 'critical', 6000)
  showReport.value = false
  report.note = ''
}

// ---------- 中场临时离座报备 ----------
const showLeave = ref(false)
const leaveNote = ref('')

function submitLeave() {
  if (!myChild.value) return
  if (!leaveNote.value.trim()) return toast.push('请简单说明去向（如上厕所、去卖品区）', 'critical')
  store.markTemporaryLeave(myChild.value.id, leaveNote.value.trim())
  toast.push('已报备孩子临时离座，场务中场预警将重点关注该区域', 'good', 4600)
  leaveNote.value = ''
  showLeave.value = false
}
function submitReturned() {
  if (!myChild.value) return
  store.markReturned(myChild.value.id)
  toast.push('已确认孩子回座，预警已更新', 'good')
}

const phaseHint = computed(() => {
  switch (store.show.phase) {
    case 'entry': return '当前为入场阶段'
    case 'performance': return '演出进行中，如需报案请告知引座员'
    case 'intermission': return '当前为中场休息，是走失高发时段'
    case 'exit': return '当前为散场阶段，出口已加强值守'
    default: return '演出已结束'
  }
})
</script>

<template>
  <div class="stack">
    <!-- 订单选择 -->
    <div class="card">
      <div class="card-title">
        <h2>🎫 我的订单 / 儿童安全服务</h2>
        <span class="hint">家长购票后可勾选儿童安全服务，登记信息仅用于当场演出的安全协同</span>
      </div>
      <div class="row">
        <select v-model="currentOrder" style="max-width: 320px">
          <option value="" disabled>选择订单号进入…</option>
          <option v-for="o in myOrders" :key="o" :value="o">{{ o }}</option>
        </select>
        <button class="ghost" @click="showForm = !showForm">＋ 新订单登记儿童安全服务</button>
        <span class="muted small-text">{{ phaseHint }}</span>
      </div>
    </div>

    <!-- 登记表单 -->
    <div v-if="showForm" class="card">
      <div class="card-title"><h2>登记儿童安全档案</h2><span class="hint">标 * 为必填；信息越完整，找回越快</span></div>
      <div class="form-grid">
        <div>
          <label>订单号 *</label>
          <input v-model="form.orderNo" placeholder="如 DD20260910007" />
        </div>
        <div>
          <label>座位号 *（与购票座位一致）</label>
          <select v-model="form.seatId">
            <option value="" disabled>选择空座位…</option>
            <option v-for="s in seatOptions" :key="s.id" :value="s.id">{{ s.id }}</option>
          </select>
        </div>
        <div>
          <label>儿童昵称 *</label>
          <input v-model="form.nickname" placeholder="工作人员广播时使用" />
        </div>
        <div>
          <label>年龄 *</label>
          <input v-model.number="form.age" type="number" min="1" max="14" />
        </div>
        <div>
          <label>上装颜色 *</label>
          <input v-model="form.topColor" placeholder="如 黄色外套" />
        </div>
        <div>
          <label>下装颜色 *</label>
          <input v-model="form.bottomColor" placeholder="如 蓝色裤子" />
        </div>
        <div class="full">
          <label>明显衣着/体貌特征</label>
          <input v-model="form.features" placeholder="如 背绿色小恐龙背包、扎双马尾、戴眼镜、戴人工耳蜗…" />
        </div>

        <div class="full">
          <label>同行家长（至少 1 名）*</label>
          <div class="stack" style="gap:8px">
            <div v-for="(g, idx) in form.guardians" :key="idx" class="row">
              <input v-model="g.name" placeholder="姓名" style="width:140px" />
              <input v-model="g.relation" placeholder="关系" style="width:100px" />
              <input v-model="g.phone" placeholder="手机号" style="width:160px" />
              <button v-if="form.guardians.length > 1" class="ghost small" @click="removeGuardian(idx)">移除</button>
            </div>
            <button class="ghost small" style="width:fit-content" @click="addGuardian">＋ 添加同行家长</button>
          </div>
        </div>

        <div>
          <label>紧急联系人 *</label>
          <input v-model="form.emergencyContact" placeholder="如 13800000001（妈妈 王梅）" />
        </div>
        <div></div>

        <div class="full">
          <label>需要场务特别关注的情况（将触发高风险家庭提示）</label>
          <div class="row">
            <label class="switch-row" style="flex:1">
              <input type="checkbox" v-model="form.firstVisit" />
              <span><span class="t">首次到场</span><span class="d" style="display:block">孩子不熟悉剧场路线</span></span>
            </label>
            <label class="switch-row" style="flex:1">
              <input type="checkbox" v-model="form.multiChild" />
              <span><span class="t">单家长带多名儿童</span><span class="d" style="display:block">照护容易顾此失彼</span></span>
            </label>
            <label class="switch-row" style="flex:1">
              <input type="checkbox" v-model="form.communication" />
              <span><span class="t">沟通/听力障碍</span><span class="d" style="display:block">听到广播可能无反应</span></span>
            </label>
          </div>
        </div>

        <div class="full">
          <label class="switch-row">
            <input type="checkbox" v-model="form.temporaryCareAllowed" />
            <span>
              <span class="t">允许工作人员在找回过程中临时看护孩子</span>
              <span class="d" style="display:block">
                勾选后，服务台核对特征/座位/家长信息一致即可派人护送回座位；不勾选则必须请家长到服务台当面认领
              </span>
            </span>
          </label>
        </div>

        <div v-if="riskPreview" class="full">
          <div class="list-row" :class="riskPreview.high ? 'danger' : ''">
            <span class="dot" :class="riskPreview.high ? 'dot-critical' : 'dot-good'"></span>
            <div style="flex:1">
              <strong>系统风险预判：{{ riskPreview.high ? '高风险家庭（场务将收到重点提示）' : '一般家庭' }}</strong>
              <div class="muted small-text">{{ riskPreview.reasons.join('；') || '信息完整，无额外风险因素' }}</div>
            </div>
          </div>
        </div>

        <div class="full row" style="margin-top:4px">
          <button @click="submitRegister">提交并开通儿童安全服务</button>
          <button class="ghost" @click="showForm = false">取消</button>
        </div>
      </div>
    </div>

    <template v-if="myChild">
      <!-- 我的儿童档案卡 -->
      <div class="grid-2">
        <div class="card">
          <div class="card-title">
            <h2>👧 安全档案：{{ myChild.nickname }}</h2>
            <span class="spacer"></span>
            <span v-if="myChild.admitted" class="tag-pill pill-good">● 已核验入场</span>
            <span v-else class="tag-pill pill-warn">● 待闸机核验</span>
            <span v-if="myChild.highRiskFamily" class="tag-pill pill-critical">高风险家庭</span>
          </div>
          <div class="kv">
            <span class="k">订单号</span><span class="mono">{{ myChild.orderNo }}</span>
            <span class="k">座位</span><span class="mono">{{ myChild.seatId }}</span>
            <span class="k">年龄</span><span>{{ myChild.age }} 岁</span>
            <span class="k">衣着</span><span>{{ myChild.topColor }}上装 / {{ myChild.bottomColor }}下装</span>
            <span class="k">特征</span><span>{{ myChild.features || '—' }}</span>
            <span class="k">同行家长</span>
            <span>{{ myChild.guardians.map((g) => `${g.relation} ${g.name} ${g.phone}`).join('；') }}</span>
            <span class="k">紧急联系</span><span>{{ myChild.emergencyContact }}</span>
            <span class="k">临时看护</span>
            <span>{{ myChild.temporaryCareAllowed ? '✓ 已授权，可护送回座' : '✗ 未授权，须当面认领' }}</span>
            <span class="k">登记时间</span><span>{{ formatTime(myChild.registeredAt) }}</span>
            <span v-if="myChild.admitted" class="k">入场时间</span>
            <span v-if="myChild.admitted">{{ formatTime(myChild.admittedAt!) }}（闸机核验）</span>
          </div>
        </div>

        <!-- 报案入口 / 事件状态 -->
        <div class="card" :class="myIncident && myIncident.status !== 'reunited' ? 'pulse' : ''" style="border-color:#f3c2c2">
          <div class="card-title"><h2>🚨 孩子不见了？</h2></div>
          <template v-if="!myIncident || myIncident.status === 'reunited' || myIncident.status === 'closed_lost'">
            <p class="small-text muted" style="margin-bottom:10px">
              中场休息人多时如与孩子走散，请立即报案。系统会从座位号、最后出现位置、儿童特征和场内人流状态
              <strong>自动生成找回任务</strong>，推送给距您最近的场务、出口安保与服务台。
            </p>
            <div v-if="!myChild.admitted" class="empty">孩子尚未通过闸机核验，入场后才可报案</div>
            <button v-else-if="store.show.phase !== 'closed'" class="danger" @click="showReport = !showReport">
              🚨 报告孩子不见
            </button>

            <div v-if="showReport" class="stack section-gap">
              <div class="form-grid">
                <div>
                  <label>报案家长姓名 *</label>
                  <input v-model="reporterName" :placeholder="myChild.guardians[0]?.name" />
                </div>
                <div>
                  <label>联系电话 *</label>
                  <input v-model="reporterPhone" :placeholder="myChild.guardians[0]?.phone" />
                </div>
                <div class="full">
                  <label>最后出现位置 *</label>
                  <select v-model="report.zoneId">
                    <option v-for="z in reportZones" :key="z.id" :value="z.id">{{ z.name }}</option>
                  </select>
                </div>
                <div class="full">
                  <label>当时情况（排队上厕所 / 去买东西 / 最后穿着…）</label>
                  <textarea v-model="report.note" rows="2" placeholder="如：中场带她去家庭厕所排队，我接了个电话就不见了"></textarea>
                </div>
              </div>
              <div class="row">
                <button class="danger" @click="submitReport">确认报案，立即生成找回任务</button>
                <button class="ghost" @click="showReport = false">取消</button>
              </div>
            </div>
          </template>

          <template v-else>
            <div class="row" style="margin-bottom:8px">
              <span class="tag-pill" :class="{
                'pill-critical': myIncident.status === 'searching',
                'pill-serious': myIncident.status === 'broadcast' || myIncident.status === 'police',
              }">
                事件 {{ myIncident.id }} · {{ { searching: '搜寻中', broadcast: '已广播寻人', police: '警方协助中' }[myIncident.status] }}
              </span>
              <span class="muted small-text">已持续 {{ minutesAgo(myIncident.createdAt, now) }} 分钟</span>
            </div>
            <div class="list-row" v-if="myIncident.status === 'searching'">
              <span class="dot dot-critical"></span>
              <span class="small-text">场务与安保正在按搜寻分区处置，请您留在 <strong class="mono">{{ myChild.seatId }}</strong> 座位附近，不要自行寻找以免错过对接。</span>
            </div>
            <div class="list-row" v-if="myIncident.status === 'broadcast'">
              <span class="dot dot-serious"></span>
              <span class="small-text">已启动全场广播，工作人员每 5 分钟向您回拨同步进展。</span>
            </div>
            <div class="list-row" v-if="myIncident.status === 'police'">
              <span class="dot dot-critical"></span>
              <span class="small-text">已报警，专人到场陪同并同步监控与出口拦截进展。</span>
            </div>
            <div v-if="myIncident.parentNotifyWay" class="small-text" style="margin-top:8px">
              <strong>当前通知方式：</strong>{{ myIncident.parentNotifyWay }}
            </div>
            <div v-if="myIncident.deskChecks.length" class="section-gap">
              <strong class="small-text">服务台最新核验：</strong>
              <div v-for="d in [...myIncident.deskChecks].reverse().slice(0, 1)" :key="d.id" class="list-row" style="margin-top:6px">
                <span class="dot" :class="d.decision === 'notify_parent' ? 'dot-warn' : d.decision === 'escort_seat' ? 'dot-good' : 'dot-serious'"></span>
                <span class="small-text">
                  <template v-if="d.decision === 'notify_parent'">✅ 信息匹配，请立即到 <strong>观众服务台</strong> 当面认领，勿委托他人代领</template>
                  <template v-else-if="d.decision === 'escort_seat'">✅ 已确认身份，工作人员正护送孩子回座位</template>
                  <template v-else>⚠️ 接到疑似儿童但信息不符，已升级广播，请继续在座位等候</template>
                </span>
              </div>
            </div>
          </template>
        </div>
      </div>

      <!-- 中场临时离座报备：喂给场务高风险预警 -->
      <div
        v-if="myChild.admitted && ['intermission', 'performance'].includes(store.show.phase)"
        class="card"
        :class="myChild.leftSeatAt && !myChild.returnedAt ? 'pulse' : ''"
        style="border-color:#e9d8b8"
      >
        <div class="card-title">
          <h2>🚻 中场临时离座报备</h2>
          <span class="hint">报备后该座位分区的中场预警会提级，场务优先巡查孩子去向附近的厕所/卖品区；一旦报案，这些巡查记录会自动带入找回事件</span>
        </div>
        <template v-if="myChild.leftSeatAt && !myChild.returnedAt">
          <div class="list-row danger">
            <span class="dot dot-critical"></span>
            <div class="small-text" style="flex:1">
              <strong>{{ myChild.nickname }} 已离座 {{ minutesAgo(myChild.leftSeatAt, now) }} 分钟</strong>
              <div class="muted">去向：{{ myChild.leftSeatNote }} · 报备时间 {{ formatTime(myChild.leftSeatAt) }}</div>
            </div>
            <button class="good" @click="submitReturned">孩子已回座</button>
          </div>
        </template>
        <template v-else>
          <div v-if="myChild.returnedAt" class="small-text muted" style="margin-bottom:8px">
            ✓ 上次离座已于 {{ formatTime(myChild.returnedAt) }} 确认回座。
          </div>
          <button v-if="!showLeave" class="ghost" @click="showLeave = !showLeave">孩子临时离开座位（上厕所/买东西），点此报备</button>
          <div v-else class="stack section-gap">
            <label>简单说明去向 *</label>
            <input v-model="leaveNote" placeholder="如：自己去家庭厕所，说好在门口等" />
            <div class="row">
              <button @click="submitLeave">提交报备</button>
              <button class="ghost" @click="showLeave = false">取消</button>
            </div>
          </div>
        </template>
      </div>

      <!-- 找回进展时间线（家长可见版） -->
      <div v-if="myIncident" class="card">
        <div class="card-title">
          <h2>📋 找回进展（事件 {{ myIncident.id }}）</h2>
          <span class="hint">最后出现：{{ ZONES_BY_ID.get(myIncident.lastSeenZoneId)?.name }} · {{ formatTime(myIncident.lastSeenAt) }}</span>
        </div>
        <IncidentTimeline :incident="myIncident" />
      </div>
    </template>

    <div v-else-if="!showForm" class="empty">
      请先在上方选择订单号，或点击「＋ 新订单登记儿童安全服务」开始登记
    </div>
  </div>
</template>
