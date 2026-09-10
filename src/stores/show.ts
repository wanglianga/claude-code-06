import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import {
  buildBroadcast,
  buildIntermissionAlerts,
  nearestStaff,
  parentNotifyWay,
  planDiversions,
  planExitInterceptions,
  planSearchZones,
  reconcileAlerts,
  reviewShow,
  selectAlertSightings,
  verifyDeskCandidate,
} from '@/domain/engine'
import {
  buildChildren,
  buildCrowdReports,
  buildShow,
  buildStaff,
  SEATS_BY_ID,
  ZONES,
  ZONES_BY_ID,
} from '@/domain/seed'
import type {
  AlertCheck,
  AssignedTask,
  ChildProfile,
  CrowdLevel,
  CrowdReport,
  DeskCheck,
  DiversionChannel,
  Incident,
  IncidentStatus,
  IntermissionAlert,
  PatrolCheck,
  Show,
  ShowPhase,
  Staff,
  TimelineEntry,
} from '@/domain/types'

const STORAGE_KEY = 'theater-safety-v1'
const STORAGE_VERSION = 2

interface PersistShape {
  version?: number
  show: Show
  children: ChildProfile[]
  staff: Staff[]
  crowdReports: CrowdReport[]
  incidents: Incident[]
  alerts: IntermissionAlert[]
  diversions: DiversionChannel[]
  seq: number
}

export interface ReportPayload {
  childId: string
  reportedBy: string
  reporterPhone: string
  lastSeenZoneId: string
  lastSeenNote: string
}

export interface DeskCheckPayload {
  incidentId: string
  childAppearance: string
  featureMatch: boolean
  seatMatch: boolean
  guardianMatch: boolean
  mismatchNote?: string
  handlerId: string
}

export const useShowStore = defineStore('show', () => {
  // ---------- state ----------
  const now = ref(Date.now())
  const show = ref<Show>(buildShow(now.value))
  const children = ref<ChildProfile[]>(buildChildren(now.value))
  const staff = ref<Staff[]>(buildStaff(now.value))
  const crowdReports = ref<CrowdReport[]>(buildCrowdReports(now.value))
  const incidents = ref<Incident[]>([])
  const alerts = ref<IntermissionAlert[]>([])
  const diversions = ref<DiversionChannel[]>([])
  const seq = ref(100)

  let timer: number | undefined

  // ---------- 持久化 ----------
  function persist() {
    const data: PersistShape = {
      version: STORAGE_VERSION,
      show: show.value,
      children: children.value,
      staff: staff.value,
      crowdReports: crowdReports.value,
      incidents: incidents.value,
      alerts: alerts.value,
      diversions: diversions.value,
      seq: seq.value,
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  }

  function restore(): boolean {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return false
    try {
      const data = JSON.parse(raw) as Partial<PersistShape>
      show.value = data.show!
      children.value = data.children!
      staff.value = data.staff!
      crowdReports.value = data.crowdReports!
      incidents.value = data.incidents ?? []
      alerts.value = data.alerts ?? []
      diversions.value = data.diversions ?? []
      seq.value = data.seq ?? 100
      // 兼容旧版持久化：缺少新字段的数据统一回到干净状态
      if (data.version !== STORAGE_VERSION) {
        incidents.value = []
        alerts.value = []
        diversions.value = []
      }
      return true
    } catch {
      return false
    }
  }

  function resetDemo() {
    const t = Date.now()
    now.value = t
    show.value = buildShow(t)
    children.value = buildChildren(t)
    staff.value = buildStaff(t)
    crowdReports.value = buildCrowdReports(t)
    incidents.value = []
    alerts.value = []
    diversions.value = []
    seq.value = 100
    persist()
  }

  function startClock() {
    if (timer) window.clearInterval(timer)
    timer = window.setInterval(() => {
      now.value = Date.now()
      if (incidents.value.some((i) => isActive(i.status))) persist()
    }, 1000)
  }

  // ---------- 基础派生 ----------
  const childrenBySeat = computed(() => {
    const m = new Map<string, ChildProfile>()
    for (const c of children.value) m.set(c.seatId, c)
    return m
  })

  const activeIncidents = computed(() => incidents.value.filter((i) => isActive(i.status)))
  const closedIncidents = computed(() => incidents.value.filter((i) => !isActive(i.status)))

  function childById(id: string) {
    return children.value.find((c) => c.id === id)
  }
  function staffById(id: string) {
    return staff.value.find((s) => s.id === id)
  }
  function incidentById(id: string) {
    return incidents.value.find((i) => i.id === id)
  }

  const review = computed(() => reviewShow(incidents.value, alerts.value, ZONES_BY_ID))

  // ---------- 中场休息高风险预警 ----------

  /** 已入场儿童按座位分区聚合 */
  const admittedChildrenBySeatZone = computed(() => {
    const m = new Map<string, ChildProfile[]>()
    for (const c of children.value) {
      if (!c.admitted) continue
      const seat = SEATS_BY_ID.get(c.seatId)
      if (!seat) continue
      const arr = m.get(seat.zoneId) ?? []
      arr.push(c)
      m.set(seat.zoneId, arr)
    }
    return m
  })

  /** 场务端可见的预警：中场/散场阶段，未被解除（高风险会自动复活） */
  const activeAlerts = computed(() =>
    alerts.value
      .filter((a) => !a.dismissed && ['intermission', 'exit'].includes(show.value.phase))
      .sort((a, b) => b.score - a.score)
  )

  /** 安保端临时分流通道 */
  const activeDiversions = computed(() => diversions.value.filter((d) => d.active))

  /** 全部预警巡查记录（用于报案时带入找回事件） */
  const allAlertChecks = computed(() => alerts.value.flatMap((a) => a.checks))

  function alertById(id: string) {
    return alerts.value.find((a) => a.id === id)
  }

  /** 按当前儿童状态/拥堵上报重算预警，保留巡查历史与触发次数 */
  function refreshAlerts() {
    if (!['intermission', 'exit'].includes(show.value.phase)) return
    const fresh = buildIntermissionAlerts(
      ZONES,
      admittedChildrenBySeatZone.value,
      crowdReports.value,
      show.value.id,
      now.value
    )
    alerts.value = reconcileAlerts(alerts.value, fresh, now.value)
    diversions.value = planDiversions({
      alerts: alerts.value,
      zones: ZONES,
      existing: diversions.value,
      showId: show.value.id,
      now: now.value,
    })
  }

  // ---------- 工具 ----------
  function nextId(prefix: string) {
    seq.value += 1
    return `${prefix}${seq.value}`
  }

  function log(incident: Incident, kind: TimelineEntry['kind'], actor: string, text: string) {
    incident.timeline.push({ t: now.value, actor, text, kind })
  }

  function isActive(status: IncidentStatus) {
    return status === 'searching' || status === 'broadcast' || status === 'police'
  }

  // ---------- 家长：购票后登记儿童安全服务 ----------
  function registerChild(input: Omit<ChildProfile, 'id' | 'showId' | 'registeredAt' | 'admitted'>): ChildProfile {
    const child: ChildProfile = {
      ...input,
      id: nextId('C'),
      showId: show.value.id,
      registeredAt: now.value,
      admitted: false,
    }
    children.value.push(child)
    persist()
    return child
  }

  // ---------- 闸机：核验入场，进入当场演出安全列表 ----------
  function admitByOrder(orderNo: string, gateId: string): ChildProfile | { error: string } {
    const child = children.value.find((c) => c.orderNo === orderNo.trim())
    if (!child) return { error: '未找到该订单登记的儿童安全档案，请家长先在购票页完成安全服务登记。' }
    if (child.admitted) return { error: `该儿童已于 ${new Date(child.admittedAt!).toLocaleTimeString()} 核验入场，请勿重复过闸。` }
    child.admitted = true
    child.admittedAt = now.value
    child.gateId = gateId
    refreshAlerts()
    persist()
    return child
  }

  // ---------- 阶段切换 ----------
  function setPhase(phase: ShowPhase) {
    show.value.phase = phase
    // 进入中场休息：按儿童年龄/座位距出口/单人带娃/曾离座/功能区拥堵生成巡查优先级
    if (phase === 'intermission') {
      alerts.value = buildIntermissionAlerts(
        ZONES,
        admittedChildrenBySeatZone.value,
        crowdReports.value,
        show.value.id,
        now.value
      )
      diversions.value = planDiversions({
        alerts: alerts.value,
        zones: ZONES,
        existing: diversions.value,
        showId: show.value.id,
        now: now.value,
      })
    }
    // 进入散场：仍有未结事件 → 依据场务最后巡查位置重算出口拦截，并给安保派单
    if (phase === 'exit') {
      refreshAlerts()
      for (const inc of activeIncidents.value) {
        applyExitInterceptions(inc, '演出进入散场阶段，系统按场务最后巡查位置重算出口拦截')
      }
    }
    persist()
  }

  // ---------- 场务：拥挤度上报 ----------
  function reportCrowd(zoneId: string, level: CrowdLevel, staffId: string) {
    const s = staffById(staffId)
    crowdReports.value.push({ zoneId, level, reportedBy: staffId, at: now.value })
    // 拥堵变化会重算各座位分区的中场预警（周边厕所/卖品区因子）
    refreshAlerts()
    for (const inc of activeIncidents.value) {
      log(inc, 'patrol', s?.name ?? '场务', `更新「${ZONES_BY_ID.get(zoneId)?.name}」拥挤度为 ${crowdText(level)}，搜寻优先级已重算`)
    }
    persist()
  }

  // ---------- 家长：中场报备孩子离座 ----------
  function markTemporaryLeave(childId: string, note: string) {
    const c = childById(childId)
    if (!c) return
    c.leftSeatAt = now.value
    c.leftSeatNote = note
    c.returnedAt = undefined
    refreshAlerts()
    persist()
  }

  /** 家长确认孩子已回座 */
  function markReturned(childId: string) {
    const c = childById(childId)
    if (!c || !c.leftSeatAt) return
    c.returnedAt = now.value
    refreshAlerts()
    persist()
  }

  // ---------- 场务：中场预警巡查反馈 ----------
  /**
   * 场务对预警区域巡查：
   * - crowded=true 确认区域拥挤 → confirmCount+1，安保端出现临时分流通道；
   * - crowded=false 到场查看人流正常 → 记录巡查，不触发分流。
   * 所有记录都会在该区域儿童走失报案时自动带入找回事件。
   */
  function alertCheck(
    alertId: string,
    staffId: string,
    zoneId: string,
    crowded: boolean,
    note: string
  ): AlertCheck | undefined {
    const alert = alertById(alertId)
    const s = staffById(staffId)
    if (!alert || !s) return undefined
    const check: AlertCheck = {
      id: nextId('AC'),
      alertId,
      zoneId,
      staffId,
      staffName: s.name,
      at: now.value,
      crowded,
      note,
    }
    alert.checks.push(check)
    s.zoneId = zoneId
    s.lastPatrolAt[zoneId] = now.value
    alert.updatedAt = now.value
    if (crowded) {
      alert.confirmCount += 1
      alert.lastConfirmedAt = now.value
    }
    // 巡查后用最新状态重算评分（保留本次记录），分流通道随之生成/更新
    const fresh = buildIntermissionAlerts(
      ZONES,
      admittedChildrenBySeatZone.value,
      crowdReports.value,
      show.value.id,
      now.value
    )
    alerts.value = reconcileAlerts(alerts.value, fresh, now.value)
    // reconcile 会用 fresh 覆盖 updatedAt，但 checks/confirmCount 已保留
    diversions.value = planDiversions({
      alerts: alerts.value,
      zones: ZONES,
      existing: diversions.value,
      showId: show.value.id,
      now: now.value,
    })
    persist()
    return check
  }

  /** 场务查看后认为预警可解除；重新升至高风险时会自动复活 */
  function dismissAlert(alertId: string, staffId: string) {
    const alert = alertById(alertId)
    const s = staffById(staffId)
    if (!alert) return
    alert.dismissed = true
    alert.updatedAt = now.value
    for (const inc of activeIncidents.value) {
      log(inc, 'patrol', s?.name ?? '场务', `中场预警「${ZONES_BY_ID.get(alert.zoneId)?.name}」经现场查看后解除`)
    }
    persist()
  }

  // ---------- 安保：临时分流通道 ----------
  /** 安保确认疏导完成，关闭临时分流通道 */
  function closeDiversion(diversionId: string, note: string, staffId: string) {
    const d = diversions.value.find((x) => x.id === diversionId)
    const s = staffById(staffId)
    if (!d) return
    d.active = false
    d.closedAt = now.value
    d.closeNote = note
    for (const inc of activeIncidents.value) {
      log(inc, 'security', s?.name ?? '安保', `临时分流通道关闭（${ZONES_BY_ID.get(d.zoneId)?.shortName}→${ZONES_BY_ID.get(d.exitId)?.shortName}）：${note}`)
    }
    persist()
  }

  /** 场务/安保移动并打卡（更新最后巡查位置，会影响散场出口拦截） */
  function moveStaff(staffId: string, zoneId: string, incidentId?: string) {
    const s = staffById(staffId)
    if (!s) return
    s.zoneId = zoneId
    s.lastPatrolAt[zoneId] = now.value
    if (incidentId) {
      const inc = incidentById(incidentId)
      if (inc) {
        log(inc, 'patrol', s.name, `巡查到位：${ZONES_BY_ID.get(zoneId)?.name}`)
        // 散场阶段，场务新巡查位置实时影响出口拦截计划
        if (show.value.phase === 'exit') applyExitInterceptions(inc, `场务${s.name}更新最后巡查位置，出口拦截计划刷新`)
      }
    }
    persist()
  }

  // ---------- 家长报案：生成找回任务 ----------
  function reportMissing(payload: ReportPayload): Incident {
    const child = childById(payload.childId)!
    const stage =
      show.value.phase === 'entry'
        ? 'entry'
        : show.value.phase === 'exit'
          ? 'exit'
          : 'intermission'
    const seat = SEATS_BY_ID.get(child.seatId)

    const incident: Incident = {
      id: nextId('I'),
      showId: show.value.id,
      childId: child.id,
      childSnapshot: {
        nickname: child.nickname,
        age: child.age,
        topColor: child.topColor,
        bottomColor: child.bottomColor,
        features: child.features,
        seatId: child.seatId,
        guardians: child.guardians.map((g) => ({ ...g })),
        emergencyContact: child.emergencyContact,
        temporaryCareAllowed: child.temporaryCareAllowed,
      },
      stage,
      reportedBy: payload.reportedBy,
      reporterPhone: payload.reporterPhone,
      lastSeenZoneId: payload.lastSeenZoneId,
      lastSeenAt: now.value,
      lastSeenNote: payload.lastSeenNote,
      status: 'searching',
      timeline: [],
      tasks: [],
      patrolChecks: [],
      deskChecks: [],
      broughtAlertChecks: [],
      interceptions: [],
      cctvRequested: false,
      policeCalled: false,
      createdAt: now.value,
    }

    log(
      incident,
      'report',
      payload.reportedBy,
      `家长在${stageText(stage)}报案：${child.nickname}（${child.age}岁，${child.topColor}上装/${child.bottomColor}下装）最后出现于${ZONES_BY_ID.get(payload.lastSeenZoneId)?.name}，座位 ${seat?.id ?? child.seatId}。${payload.lastSeenNote}`
    )

    // 1) 搜寻分区：座位 + 最后位置 + 拥挤功能区 + 出口；带入中场预警巡查记录收窄最后出现范围
    const lastSeenZone = ZONES_BY_ID.get(payload.lastSeenZoneId)!
    const sightings = selectAlertSightings(allAlertChecks.value, ZONES_BY_ID, lastSeenZone, now.value)
    incident.broughtAlertChecks = sightings
    if (sightings.length) {
      const crowdedNames = [
        ...new Set(
          sightings
            .filter((c) => c.crowded)
            .map((c) => ZONES_BY_ID.get(c.zoneId)?.shortName)
        ),
      ].filter(Boolean)
      log(
        incident,
        'system',
        '协同系统',
        `带入中场巡查记录 ${sightings.length} 条（场务：${[...new Set(sightings.map((c) => c.staffName))].join('、')}），` +
          `最后出现范围收窄至最后位置周边${crowdedNames.length ? `，重点关注曾确认拥挤的：${crowdedNames.join('、')}` : ''}。`
      )
    }
    const plan = planSearchZones(ZONES, lastSeenZone, crowdReports.value, now.value, sightings)
    const searchZones = plan.slice(0, 6).map((p) => p.zone)

    // 2) 派最近的两名空闲场务，主攻分区不同
    const featureLine = `${child.topColor}上装、${child.bottomColor}下装${child.features ? '，' + child.features : ''}`
    const primaryGroups = [searchZones.slice(0, 3), searchZones.slice(3, 6)]
    primaryGroups.forEach((group, idx) => {
      const target = group[0] ?? lastSeenZone
      const pick = nearestStaff(staff.value, ZONES_BY_ID, target, 'usher')
      const zonesText = group.map((z) => z.name).join('、') || target.name
      const priorityHint = plan
        .filter((p) => group.some((g) => g.id === p.zone.id))
        .map((p) => `${p.zone.shortName}（${p.reason}）`)
        .join('；')
      const task: AssignedTask = {
        id: nextId('T'),
        staffId: pick?.id ?? '',
        staffName: pick?.name ?? '待派单（当前无空闲场务）',
        role: 'usher',
        type: 'search',
        zoneIds: group.map((z) => z.id),
        instruction: `搜寻「${child.nickname}」：${featureLine}。重点巡查 ${zonesText}。判定依据：${priorityHint || '就近搜寻'}。座位 ${seat?.id} 同步核对。`,
        priority: idx === 0 ? 'high' : 'normal',
        status: 'pending',
        createdAt: now.value,
      }
      if (pick) {
        pick.status = 'busy'
        pick.taskId = task.id
      }
      incident.tasks.push(task)
      log(
        incident,
        'dispatch',
        '协同系统',
        `找回任务 ${task.id} 派发场务：${task.staffName} → ${zonesText}`
      )
    })

    // 3) 派最近安保关注高优先级出口
    const topExit = plan.find((p) => p.zone.type === 'exit')!.zone
    const sec = nearestStaff(staff.value, ZONES_BY_ID, topExit, 'security')
    const exitIds = ZONES.filter((z) => z.type === 'exit').map((z) => z.id)
    const secTask: AssignedTask = {
      id: nextId('T'),
      staffId: sec?.id ?? '',
      staffName: sec?.name ?? '待派单（安保均在任务中）',
      role: 'security',
      type: 'intercept',
      zoneIds: exitIds,
      instruction: `关注全部出口，防止「${child.nickname}」自行离场；优先赶往 ${topExit.name}（距最后出现位置最近）。发现独行儿童立即拦下并通知服务台。`,
      priority: 'high',
      status: 'pending',
      createdAt: now.value,
    }
    if (sec) {
      sec.status = 'busy'
      sec.taskId = secTask.id
    }
    incident.tasks.push(secTask)
    log(incident, 'dispatch', '协同系统', `出口关注任务 ${secTask.id} 派发安保：${secTask.staffName}`)

    // 4) 通知服务台待命
    const deskStaff = staff.value.find((s) => s.role === 'desk' && s.status === 'idle')
    const deskTask: AssignedTask = {
      id: nextId('T'),
      staffId: deskStaff?.id ?? 'D1',
      staffName: deskStaff?.name ?? '服务台',
      role: 'desk',
      type: 'desk_alert',
      zoneIds: ['desk'],
      instruction: `服务台待命接报疑似儿童：「${child.nickname}」，${featureLine}，座位 ${seat?.id}。家长${child.temporaryCareAllowed ? '已' : '未'}授权临时看护；紧急联系 ${child.emergencyContact}。接到儿童须逐项核对特征/座位/家长信息。`,
      priority: 'high',
      status: 'pending',
      createdAt: now.value,
    }
    if (deskStaff) {
      deskStaff.status = 'busy'
      deskStaff.taskId = deskTask.id
    }
    incident.tasks.push(deskTask)
    log(incident, 'dispatch', '协同系统', `服务台接报待命：${deskTask.staffName}`)
    log(incident, 'system', '协同系统', `家长通知策略：${parentNotifyWay(incident)}`)

    incidents.value.unshift(incident)
    if (show.value.phase === 'exit') applyExitInterceptions(incident, '报案发生在散场阶段')
    persist()
    return incident
  }

  // ---------- 接单 / 改派 ----------
  function acceptTask(incidentId: string, taskId: string, staffId: string) {
    const inc = incidentById(incidentId)
    const task = inc?.tasks.find((t) => t.id === taskId)
    if (!inc || !task) return
    task.status = 'accepted'
    task.acceptedAt = now.value
    const s = staffById(staffId)
    if (s) {
      task.staffId = s.id
      task.staffName = s.name
      s.status = 'busy'
      s.taskId = task.id
    }
    log(inc, 'dispatch', task.staffName, `已接任务 ${task.id} 开始处置`)
    persist()
  }

  function reassignTask(incidentId: string, taskId: string) {
    const inc = incidentById(incidentId)
    const task = inc?.tasks.find((t) => t.id === taskId)
    if (!inc || !task) return
    const target = ZONES_BY_ID.get(task.zoneIds[0]) ?? ZONES_BY_ID.get('desk')!
    const pick = nearestStaff(staff.value, ZONES_BY_ID, target, task.role)
    if (!pick) {
      log(inc, 'dispatch', '协同系统', `任务 ${task.id} 暂无空闲${roleText(task.role)}可改派，等待人员释放`)
    } else {
      task.staffId = pick.id
      task.staffName = pick.name
      task.status = 'pending'
      pick.status = 'busy'
      pick.taskId = task.id
      log(inc, 'dispatch', '协同系统', `任务 ${task.id} 已改派给${pick.name}`)
    }
    persist()
  }

  // ---------- 场务巡查反馈 ----------
  function patrolCheck(
    incidentId: string,
    staffId: string,
    zoneId: string,
    found: boolean,
    note: string
  ): PatrolCheck {
    const inc = incidentById(incidentId)!
    const s = staffById(staffId)!
    s.zoneId = zoneId
    s.lastPatrolAt[zoneId] = now.value
    const check: PatrolCheck = {
      id: nextId('P'),
      staffId,
      staffName: s.name,
      zoneId,
      at: now.value,
      found,
      note,
    }
    inc.patrolChecks.push(check)
    log(
      inc,
      'patrol',
      s.name,
      found
        ? `在${ZONES_BY_ID.get(zoneId)?.name}发现疑似儿童！${note}`
        : `已排查${ZONES_BY_ID.get(zoneId)?.name}，未见目标。${note}`
    )
    if (!found && show.value.phase === 'exit') {
      applyExitInterceptions(inc, `${s.name}排查${ZONES_BY_ID.get(zoneId)?.name}未见，出口拦截计划刷新`)
    }
    persist()
    return check
  }

  // ---------- 服务台核验 ----------
  function submitDeskCheck(payload: DeskCheckPayload) {
    const inc = incidentById(payload.incidentId)!
    const handler = staffById(payload.handlerId)
    const result = verifyDeskCandidate({
      featureMatch: payload.featureMatch,
      seatMatch: payload.seatMatch,
      guardianMatch: payload.guardianMatch,
      temporaryCareAllowed: inc.childSnapshot.temporaryCareAllowed,
      previousDeskChecks: inc.deskChecks,
    })
    const check: DeskCheck = {
      id: nextId('D'),
      at: now.value,
      childAppearance: payload.childAppearance,
      featureMatch: payload.featureMatch,
      seatMatch: payload.seatMatch,
      guardianMatch: payload.guardianMatch,
      mismatchNote: payload.mismatchNote,
      decision: result.decision,
      handler: handler?.name ?? '服务台',
    }
    inc.deskChecks.push(check)
    inc.parentNotifyWay = result.notifyWay
    log(
      inc,
      'desk',
      check.handler,
      `服务台核验：特征${payload.featureMatch ? '✓' : '✗'} / 座位${payload.seatMatch ? '✓' : '✗'} / 家长${payload.guardianMatch ? '✓' : '✗'} → ${decisionText(result.decision)}。${result.text} 家长通知：${result.notifyWay}`
    )

    if (result.decision === 'broadcast') {
      inc.broadcast = buildBroadcast(inc, now.value)
      inc.status = 'police' === inc.status ? 'police' : 'broadcast'
      log(inc, 'broadcast', '服务台', `已触发全场广播（第 ${inc.broadcast.times} 次），广播内容已按核验结果更正`)
      // 广播同时要求全部出口保持关注
      applyExitInterceptions(inc, '广播寻人启动，全部出口进入关注状态', true)
    }
    persist()
    return check
  }

  /** 服务台完成交接（家长认领 / 护送回座） */
  function resolveAtDesk(incidentId: string, way: 'parent_pickup' | 'escort_done', handlerId: string) {
    const inc = incidentById(incidentId)!
    const note =
      way === 'parent_pickup'
        ? '家长已到服务台当面认领，身份与紧急联系人一致，儿童安全交接'
        : '工作人员双人护送回座位，与同行家长完成交接'
    closeIncident(inc, 'reunited', note, staffById(handlerId)?.name ?? '服务台')
  }

  /** 场务现场找到并带回 */
  function resolveByUsher(incidentId: string, staffId: string, note: string) {
    const inc = incidentById(incidentId)!
    closeIncident(inc, 'reunited', `现场找到并控制住儿童：${note}`, staffById(staffId)?.name ?? '场务')
  }

  // ---------- 广播（服务台/经理手动升级） ----------
  function escalateBroadcast(incidentId: string, actor: string) {
    const inc = incidentById(incidentId)!
    inc.broadcast = buildBroadcast(inc, now.value)
    if (inc.status !== 'police') inc.status = 'broadcast'
    inc.parentNotifyWay = parentNotifyWay(inc)
    log(inc, 'broadcast', actor, `手动升级全场广播（第 ${inc.broadcast.times} 次）`)
    applyExitInterceptions(inc, '广播寻人启动，全部出口进入关注状态', true)
    persist()
  }

  // ---------- 监控 / 警方 ----------
  function requestCctv(incidentId: string, note: string, actor: string) {
    const inc = incidentById(incidentId)!
    inc.cctvRequested = true
    inc.cctvNote = note
    log(inc, 'security', actor, `已申请调阅监控：${note}`)
    persist()
  }

  function callPolice(incidentId: string, note: string, actor: string) {
    const inc = incidentById(incidentId)!
    inc.policeCalled = true
    inc.policeNote = note
    inc.status = 'police'
    inc.parentNotifyWay = parentNotifyWay(inc)
    log(inc, 'security', actor, `已报警并请求警方协助（110 已接通）：${note}。全部出口进入拦截状态，家长改由专人电话陪同`)
    applyExitInterceptions(inc, '警方协助已启动，全部出口强制拦截', true)
    persist()
  }

  // ---------- 散场出口拦截（核心联动） ----------
  function applyExitInterceptions(inc: Incident, reason: string, forceAll = false) {
    const currentIds = inc.interceptions.filter((i) => i.active).map((i) => i.zoneId)
    const plan = planExitInterceptions(ZONES, staff.value, inc.patrolChecks, currentIds, now.value)
    if (forceAll) for (const p of plan) p.active = true
    inc.interceptions = plan

    // 给处于 active 的出口派/刷新安保任务
    const activeExits = plan.filter((p) => p.active).map((p) => p.zoneId)
    for (const exitId of activeExits) {
      ensureExitTask(inc, exitId)
    }
    log(inc, 'security', '协同系统', `${reason}；当前重点拦截出口：${activeExits.map((id) => ZONES_BY_ID.get(id)?.shortName).join('、') || '无'}（共 ${activeExits.length} 个）`)
  }

  /** 安保手动布控/解除单个出口 */
  function setManualIntercept(incidentId: string, zoneId: string, active: boolean, actor: string) {
    const inc = incidentById(incidentId)!
    let item = inc.interceptions.find((x) => x.zoneId === zoneId)
    if (item) {
      item.active = active
      item.updatedAt = now.value
      item.reason = `${active ? '安保手动加派布控' : '安保确认无异常后解除'}（${ZONES_BY_ID.get(zoneId)?.shortName}）`
    } else {
      item = {
        zoneId,
        active,
        reason: `${active ? '安保手动加派布控' : '安保解除'}（${ZONES_BY_ID.get(zoneId)?.shortName}）`,
        updatedAt: now.value,
      }
      inc.interceptions.push(item)
    }
    if (active) ensureExitTask(inc, zoneId)
    log(
      inc,
      'security',
      actor,
      `${active ? '加派布控' : '解除拦截'}：${ZONES_BY_ID.get(zoneId)?.name}`
    )
    persist()
  }

  /** 为指定出口确保有一条安保拦截任务 */
  function ensureExitTask(inc: Incident, exitId: string) {
    const existing = inc.tasks.find(
      (t) => t.role === 'security' && t.type === 'intercept' && t.zoneIds.length === 1 && t.zoneIds[0] === exitId
    )
    if (existing) return
    const zone = ZONES_BY_ID.get(exitId)!
    const sec = nearestStaff(staff.value, ZONES_BY_ID, zone, 'security')
    const task: AssignedTask = {
      id: nextId('T'),
      staffId: sec?.id ?? '',
      staffName: sec?.name ?? '待派单（安保均在任务中）',
      role: 'security',
      type: 'intercept',
      zoneIds: [exitId],
      instruction: `出口拦截：守住${zone.name}，对独行儿童一律拦下并联系服务台。`,
      priority: 'high',
      status: 'pending',
      createdAt: now.value,
    }
    if (sec) {
      sec.status = 'busy'
      sec.taskId = task.id
    }
    inc.tasks.push(task)
  }

  // ---------- 关闭事件 / 散场结束 ----------
  function closeIncident(inc: Incident, status: IncidentStatus, note: string, actor: string) {
    inc.status = status
    inc.resolutionNote = note
    inc.closedAt = now.value
    inc.parentNotifyWay =
      status === 'reunited'
        ? '电话 + App 推送：儿童已安全交接，事件关闭'
        : inc.parentNotifyWay
    log(inc, status === 'reunited' ? 'guardian' : 'system', actor, note)
    // 释放该事件占用的人员
    for (const t of inc.tasks) {
      if (isActive(status) === false && t.status !== 'done') {
        t.status = 'done'
        t.doneAt = now.value
        t.result = note
      }
      const s = staffById(t.staffId)
      if (s && s.taskId === t.id) {
        s.status = 'idle'
        s.taskId = undefined
      }
    }
    persist()
  }

  /** 散场结束：仍未找到的事件标记 closed_lost，进入复盘 */
  function closeShow() {
    show.value.phase = 'closed'
    for (const inc of activeIncidents.value) {
      closeIncident(
        inc,
        'closed_lost',
        '散场结束仍未找到，出口拦截记录、监控调阅与警方协助状态已归档，转入线下持续搜寻',
        '值班经理'
      )
    }
    // 分流通道随演出结束全部关闭；预警记录保留（triggerCount 用于复盘）
    for (const d of diversions.value) {
      if (d.active) {
        d.active = false
        d.closedAt = now.value
        d.closeNote = '演出结束，临时分流通道撤除'
      }
    }
    persist()
  }

  return {
    // state
    now,
    show,
    children,
    staff,
    crowdReports,
    incidents,
    alerts,
    diversions,
    // lifecycle
    restore,
    resetDemo,
    startClock,
    persist,
    // derived
    childrenBySeat,
    activeIncidents,
    closedIncidents,
    review,
    activeAlerts,
    activeDiversions,
    allAlertChecks,
    childById,
    staffById,
    incidentById,
    alertById,
    // actions
    registerChild,
    admitByOrder,
    setPhase,
    reportCrowd,
    moveStaff,
    markTemporaryLeave,
    markReturned,
    alertCheck,
    dismissAlert,
    closeDiversion,
    reportMissing,
    acceptTask,
    reassignTask,
    patrolCheck,
    submitDeskCheck,
    resolveAtDesk,
    resolveByUsher,
    escalateBroadcast,
    requestCctv,
    callPolice,
    setManualIntercept,
    closeShow,
  }
})

function crowdText(level: CrowdLevel) {
  return { low: '低', medium: '中', high: '高' }[level]
}
function stageText(stage: string) {
  return { entry: '入场阶段', intermission: '中场休息', exit: '散场阶段' }[stage] ?? stage
}
function roleText(role: string) {
  return { usher: '场务', security: '安保', desk: '服务台' }[role] ?? role
}
function decisionText(d: string) {
  return { notify_parent: '通知家长到服务台', escort_seat: '派人护送回座位', broadcast: '升级广播' }[d] ?? d
}
