import type {
  BroadcastRecord,
  ChildProfile,
  CrowdLevel,
  CrowdReport,
  DeskCheck,
  ExitInterception,
  Incident,
  IncidentStage,
  PatrolCheck,
  ReviewSuggestion,
  ShowReview,
  Staff,
  Zone,
} from './types'

/** ---------- 时间 ---------- */

export function formatTime(ts: number): string {
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(
    d.getSeconds()
  ).padStart(2, '0')}`
}

export function minutesAgo(ts: number, now: number): number {
  return Math.max(0, Math.round((now - ts) / 60000))
}

/** ---------- 高风险家庭评估 ---------- */

export interface RiskResult {
  high: boolean
  score: number
  reasons: string[]
}

export function assessRisk(child: ChildProfile, now: number): RiskResult {
  let score = 0
  const reasons: string[] = []

  if (child.highRiskFamily) {
    score += 3
    reasons.push(child.highRiskReason || '系统标记的高风险家庭')
  }
  if (child.age <= 4) {
    score += 2
    reasons.push(`儿童仅 ${child.age} 岁，自我保护能力弱`)
  } else if (child.age <= 6) {
    score += 1
    reasons.push('学龄前儿童，易被人流冲散')
  }
  if (child.guardians.length <= 1) {
    score += 1
    reasons.push('仅登记 1 名同行家长，无替补看护人')
  }
  if (!child.temporaryCareAllowed) {
    score += 1
    reasons.push('家长不允许工作人员临时看护，找到后须当面交接')
  }
  if (!child.features.trim()) {
    score += 1
    reasons.push('缺少明显特征描述，识别难度高')
  }
  if (child.admitted && child.admittedAt && now - child.admittedAt < 15 * 60 * 1000) {
    reasons.push('刚完成入场核验，尚在熟悉环境')
  }

  return { high: score >= 4, score, reasons }
}

/** ---------- 距离（以地图百分比坐标计算） ---------- */

export function zoneDistance(a: Zone, b: Zone): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

/** ---------- 拥挤度 ---------- */

const CROWD_SCORE: Record<CrowdLevel, number> = { low: 0, medium: 1, high: 2 }

export function crowdLevelOf(reports: CrowdReport[], zoneId: string, now: number): CrowdLevel {
  // 取该区域 10 分钟内最新一次上报
  const latest = reports
    .filter((r) => r.zoneId === zoneId && now - r.at <= 10 * 60 * 1000)
    .sort((a, b) => b.at - a.at)[0]
  return latest?.level ?? 'low'
}

/**
 * 中场重点巡查区域：拥挤度越高 + 场务越久没巡查，优先级越高。
 * 仅对厕所/卖品/互动区等功能区排序（出口在散场阶段单独处理）。
 */
export function recommendPatrolZones(
  zones: Zone[],
  staff: Staff[],
  reports: CrowdReport[],
  now: number
): { zone: Zone; level: CrowdLevel; priorityScore: number; staleMinutes: number }[] {
  const usable = zones.filter((z) => z.type === 'facility')
  return usable
    .map((z) => {
      const level = crowdLevelOf(reports, z.id, now)
      const latestPatrol = staff
        .flatMap((s) => Object.entries(s.lastPatrolAt))
        .filter(([zid]) => zid === z.id)
        .map(([, t]) => t)
        .sort((a, b) => b - a)[0]
      const staleMinutes = latestPatrol ? minutesAgo(latestPatrol, now) : 99
      const priorityScore = CROWD_SCORE[level] * 10 + Math.min(staleMinutes, 30)
      return { zone: z, level, priorityScore, staleMinutes }
    })
    .sort((a, b) => b.priorityScore - a.priorityScore)
}

/** ---------- 找回任务生成 ---------- */

export interface SearchZone {
  zone: Zone
  reason: string
  priorityScore: number
}

/**
 * 搜寻分区：以最后出现位置为圆心，优先拥挤区域与厕所/卖品/互动区，
 * 并始终包含座位分区。
 */
export function planSearchZones(
  zones: Zone[],
  lastSeen: Zone,
  reports: CrowdReport[],
  now: number
): SearchZone[] {
  const candidates = zones.filter((z) => ['facility', 'seat', 'exit'].includes(z.type))
  return candidates
    .map((z) => {
      const dist = zoneDistance(lastSeen, z)
      const crowd = CROWD_SCORE[crowdLevelOf(reports, z.id, now)]
      let score = 0
      const reasons: string[] = []
      if (z.id === lastSeen.id) {
        score += 60
        reasons.push('最后出现位置')
      }
      score += Math.max(0, 40 - dist * 0.8)
      if (z.type === 'facility') {
        score += crowd * 12
        if (crowd === 2) reasons.push('当前人流拥挤，儿童易滞留')
      }
      if (z.type === 'exit') {
        score += 8
        reasons.push('需防止儿童自行离场')
      }
      if (z.type === 'seat') {
        score += 10
        reasons.push('核对座位及周边')
      }
      return { zone: z, reason: reasons.join('；'), priorityScore: Math.round(score) }
    })
    .sort((a, b) => b.priorityScore - a.priorityScore)
}

/**
 * 最近人员：空闲 + 距目标区域近 + 距上次巡查该区域久（避免重复派同一人）。
 */
export function nearestStaff(
  staff: Staff[],
  zonesById: Map<string, Zone>,
  target: Zone,
  role: Staff['role']
): Staff | undefined {
  const pool = staff.filter((s) => s.role === role && s.status !== 'busy')
  if (!pool.length) return undefined
  return pool
    .map((s) => {
      const pos = zonesById.get(s.zoneId)
      const dist = pos ? zoneDistance(pos, target) : 100
      const idlePenalty = s.status === 'idle' ? 0 : 20
      return { s, cost: dist + idlePenalty }
    })
    .sort((a, b) => a.cost - b.cost)[0].s
}

/** ---------- 散场出口拦截计划 ---------- */

/**
 * 场务最后巡查位置会影响安保拦截哪些出口：
 * 超过 staleLimit 分钟没人巡查过的出口自动纳入重点拦截；
 * 已有搜寻线索（patrolChecks 未发现）的出口同样保持拦截。
 */
export function planExitInterceptions(
  zones: Zone[],
  staff: Staff[],
  patrolChecks: PatrolCheck[],
  activeIds: string[],
  now: number,
  staleLimit = 8
): ExitInterception[] {
  const exits = zones.filter((z) => z.type === 'exit')
  return exits.map((z) => {
    const latestPatrol = staff
      .flatMap((s) => Object.entries(s.lastPatrolAt).filter(([patrolZoneId]) => patrolZoneId === z.id))
      .map(([, t]) => t)
      .sort((a, b) => b - a)[0]
    const stale = latestPatrol ? minutesAgo(latestPatrol, now) : 99
    const searchedNoFind = patrolChecks.some((c) => c.zoneId === z.id && !c.found)
    let active = activeIds.includes(z.id)
    const reasons: string[] = []
    if (stale >= staleLimit) {
      active = true
      reasons.push(`已 ${stale === 99 ? '从未' : stale + ' 分钟'}巡查，存在盲区`)
    }
    if (searchedNoFind) {
      active = true
      reasons.push('场务搜寻未见，保持拦截防自行离场')
    }
    if (!active && latestPatrol) reasons.push(`${stale} 分钟前刚巡查，可常规关注`)
    if (!active && !latestPatrol) reasons.push('等待安保布控')
    return {
      zoneId: z.id,
      active,
      reason: reasons.join('；'),
      updatedAt: now,
    }
  })
}

/** ---------- 服务台核验 ---------- */

export interface DeskVerifyInput {
  featureMatch: boolean
  seatMatch: boolean
  guardianMatch: boolean
  temporaryCareAllowed: boolean
  previousDeskChecks: DeskCheck[]
}

export interface DeskVerifyResult {
  decision: DeskCheck['decision']
  text: string
  notifyWay: string
}

/**
 * 三项（衣着特征 / 座位 / 家长信息）核对：
 * - 全部匹配且允许临时看护 → 派人护送回座位；
 * - 匹配但家长未授权看护 → 通知家长到服务台当面认领；
 * - 任一不符或已是第二次疑似误报 → 升级广播（特征不匹配会改变广播口径）。
 */
export function verifyDeskCandidate(input: DeskVerifyInput): DeskVerifyResult {
  const all = input.featureMatch && input.seatMatch && input.guardianMatch
  if (all && input.temporaryCareAllowed) {
    return {
      decision: 'escort_seat',
      text: '特征、座位、家长信息三项均匹配，且家长已授权临时看护，派双人护送回座位并与家长交接。',
      notifyWay: 'App 推送 + 电话告知家长「已找到，正在护送回座」',
    }
  }
  if (all) {
    return {
      decision: 'notify_parent',
      text: '三项均匹配，但家长未授权工作人员临时看护，通知家长立即到服务台当面认领，期间儿童留在服务台。',
      notifyWay: '紧急联系人电话 + App 推送，请家长到服务台',
    }
  }
  const mismatchCount = [input.featureMatch, input.seatMatch, input.guardianMatch].filter((v) => !v).length
  const repeat = input.previousDeskChecks.length > 0
  return {
    decision: 'broadcast',
    text: `${mismatchCount} 项信息不匹配${repeat ? '，且此前已出现疑似儿童' : ''}，不放行、不护送，升级全场广播并请安保关注各出口。`,
    notifyWay: '广播寻人（按实际衣着描述更正）+ 电话向报案家长核对',
  }
}

/** ---------- 广播文案：受服务台核验结果影响 ---------- */

export function buildBroadcast(incident: Incident, now: number): BroadcastRecord {
  const c = incident.childSnapshot
  const latestDesk = [...incident.deskChecks].sort((a, b) => b.at - a.at)[0]
  const times = incident.broadcast ? incident.broadcast.times + 1 : 1

  let content: string
  if (latestDesk) {
    if (latestDesk.decision === 'broadcast' && !latestDesk.featureMatch) {
      content =
        `【寻人更正 · 第 ${times} 次】服务台刚接到一名疑似儿童，但衣着特征与登记不符。` +
        `请家长注意：走失儿童「${c.nickname}」，${c.age} 岁，实际穿着${c.topColor}上装、${c.bottomColor}下装，${c.features || '无明显特征'}。` +
        `如您身边的孩子与以上描述一致，请立即送至服务台；也请「${c.nickname}」的家长不要离开座位区域，工作人员会主动与您联系。`
    } else if (latestDesk.decision === 'notify_parent') {
      content =
        `【寻人 · 第 ${times} 次】服务台接到一名与登记信息相符的儿童，请「${c.nickname}」的家长` +
        `凭预留紧急联系方式（${c.emergencyContact.replace(/(\d{3})\d{4}(\d{4})/, '$1****$2')}）立即到服务台认领，勿委托他人代领。`
    } else {
      content =
        `【寻人 · 第 ${times} 次】请「${c.nickname}」（${c.age} 岁，${c.topColor}上装、${c.bottomColor}下装）听到广播后，` +
        `在原地等候穿制服的工作人员；也请就近的观众留意身边是否有独行儿童，并引导至服务台。`
    }
  } else {
    content =
      `【寻人 · 第 ${times} 次】请「${c.nickname}」（${c.age} 岁，${c.topColor}上装、${c.bottomColor}下装，${c.features || '无明显特征'}）` +
      `听到广播后在原地不要走动；请就近工作人员立即前往接应，并请观众协助留意。`
  }
  return { at: now, content, times }
}

/** ---------- 家长通知方式：随处置进展变化 ---------- */

export function parentNotifyWay(incident: Incident): string {
  const latestDesk = [...incident.deskChecks].sort((a, b) => b.at - a.at)[0]
  if (incident.status === 'police') {
    return '电话持续连线 + 专人到场陪同，同步警方与监控进展'
  }
  if (incident.status === 'broadcast') return '电话告知已全场广播，每 5 分钟回拨同步进展'
  if (latestDesk?.decision === 'notify_parent') return '紧急联系人电话 + App 推送：请到服务台认领'
  if (latestDesk?.decision === 'escort_seat') return 'App 推送 + 电话：已找到，工作人员护送回座中'
  return '电话告知搜寻分区与预计反馈时间，App 实时推送进展'
}

/** ---------- 散场复盘 ---------- */

const STAGE_LABEL: Record<IncidentStage, string> = {
  entry: '入场',
  intermission: '中场',
  exit: '散场',
}

export function reviewShow(incidents: Incident[]): ShowReview {
  const showId = incidents[0]?.showId ?? ''
  const stages: IncidentStage[] = ['entry', 'intermission', 'exit']
  const byStage = stages.map((stage) => ({
    stage,
    label: STAGE_LABEL[stage],
    count: incidents.filter((i) => i.stage === stage).length,
  }))

  const suggestions: ReviewSuggestion[] = []
  const entry = byStage.find((s) => s.stage === 'entry')!
  const mid = byStage.find((s) => s.stage === 'intermission')!
  const ex = byStage.find((s) => s.stage === 'exit')!

  if (entry.count > 0) {
    suggestions.push({
      id: 's-entry-staff',
      area: 'staffing',
      text: '下一场在闸机至座位区的连廊增设 1 名引导员，高风险家庭入场后由专人带位并复核同行家长人数。',
      basedOn: `${entry.count} 起走失发生在入场阶段`,
    })
  }
  if (mid.count > 0) {
    const toiletIncidents = incidents.filter(
      (i) =>
        i.stage === 'intermission' &&
        (i.lastSeenZoneId.includes('toilet') || i.patrolChecks.some((c) => c.zoneId.includes('toilet')))
    )
    suggestions.push({
      id: 's-toilet-queue',
      area: 'toilet',
      text:
        toiletIncidents.length > 0
          ? '中场前 3 分钟开放备用厕所并安排分段排队引导，工作人员在队首/队尾双向清点同行儿童。'
          : '中场在卖品区与互动区之间设置导流隔离带，减少儿童逆向穿行；厕所维持常规排队引导。',
      basedOn: `${mid.count} 起走失发生在中场休息${toiletIncidents.length ? '，且涉及厕所区域' : ''}`,
    })
    suggestions.push({
      id: 's-mid-patrol',
      area: 'staffing',
      text: '下一场中场把场务巡查重心前移至拥挤度上报最高的两个功能区，每 5 分钟一轮并回传位置。',
      basedOn: `中场 ${mid.count} 起走失，搜寻依赖实时拥挤度`,
    })
  }
  if (ex.count > 0 || incidents.some((i) => i.status === 'closed_lost' || i.status === 'police')) {
    suggestions.push({
      id: 's-exit-tip',
      area: 'exit',
      text: '散场提前 5 分钟在各出口立柱与闸机屏播放「牵手离场、独行儿童请找工作人员」提示，高风险家庭由场务护送至出口外。',
      basedOn:
        ex.count > 0 ? `${ex.count} 起走失发生在散场阶段` : '存在未找到即散场的事件，出口拦截压力大',
    })
  }
  if (suggestions.length === 0) {
    suggestions.push({
      id: 's-keep',
      area: 'staffing',
      text: '本场无走失事件，维持当前场务站位，可将富余人力投入到厕所排队引导。',
      basedOn: '0 起走失',
    })
  }

  return { showId, total: incidents.length, byStage, suggestions }
}
