// ============ 演出与场馆 ============

/** 演出阶段：入场核验 → 演出中 → 中场休息 → 散场 → 已结束 */
export type ShowPhase = 'entry' | 'performance' | 'intermission' | 'exit' | 'closed'

export type ZoneType =
  | 'seat' // 座位分区
  | 'facility' // 厕所/卖品/互动等功能区
  | 'exit' // 出口
  | 'desk' // 服务台
  | 'gate' // 闸机
  | 'stage' // 舞台

export type CrowdLevel = 'low' | 'medium' | 'high'

export interface Zone {
  id: string
  name: string
  shortName: string
  type: ZoneType
  /** SVG 地图坐标（百分比） */
  x: number
  y: number
  /** 出口可被安保拦截；功能区可被巡查 */
  interceptable?: boolean
}

export interface Seat {
  id: string
  zoneId: string // 所属座位分区
  row: string
  no: number
  /** 登记在该座位的儿童 id */
  childId?: string
}

export interface CrowdReport {
  zoneId: string
  level: CrowdLevel
  reportedBy: string
  at: number
}

export interface Show {
  id: string
  name: string
  date: string
  startTime: string
  phase: ShowPhase
  seatsTotal: number
}

// ============ 儿童安全档案 ============

export interface Guardian {
  name: string
  relation: string
  phone: string
}

export interface ChildProfile {
  id: string
  orderNo: string
  showId: string
  nickname: string
  age: number
  /** 上装/下装/明显特征 */
  topColor: string
  bottomColor: string
  features: string
  seatId: string
  guardians: Guardian[]
  emergencyContact: string
  /** 是否允许工作人员临时看护 */
  temporaryCareAllowed: boolean
  /** 高风险家庭标记：首次到场 / 多孩同行 / 沟通障碍等 */
  highRiskFamily: boolean
  highRiskReason?: string
  registeredAt: number
  /** 闸机核验入场 */
  admitted: boolean
  admittedAt?: number
  gateId?: string
  /** 中场休息家长报备：孩子曾离开座位（如厕/买东西等），尚未返回 */
  leftSeatAt?: number
  leftSeatNote?: string
  returnedAt?: number
}

// ============ 中场休息高风险预警 ============

/** 预警等级：分值 ≥24 高 / ≥14 中 / 其余低 */
export type AlertLevel = 'low' | 'medium' | 'high'

/** 场务对预警区域的巡查反馈（同时是后续找回事件的"巡查记录"来源） */
export interface AlertCheck {
  id: string
  alertId: string
  zoneId: string
  staffId: string
  staffName: string
  at: number
  /** true=确认区域拥挤（触发安保临时分流）；false=到场查看，人流可接受 */
  crowded: boolean
  note: string
}

/**
 * 中场休息高风险预警：按"座位分区"聚合该区域已入场儿童的风险因子
 * （儿童年龄、座位距出口远近、是否单人带娃、是否曾离座）与功能区拥堵情况，
 * 给场务生成巡查优先级。
 */
export interface IntermissionAlert {
  id: string
  showId: string
  /** 预警锚定的座位分区 */
  zoneId: string
  level: AlertLevel
  /** 综合优先级分（越高越优先巡查） */
  score: number
  /** 逐条可解释的加分因子 */
  factors: string[]
  /** 构成预警的儿童 id */
  childIds: string[]
  /** 周边被纳入拥堵考量的功能区/出口 id */
  crowdedZoneIds: string[]
  /** 最拥堵周边的人流等级 */
  crowdLevel: CrowdLevel
  /** 被家长报备"曾离座"的儿童 id */
  leftSeatChildIds: string[]
  /** 场务确认拥挤的次数（推动安保分流） */
  confirmCount: number
  /** 累计触发（生成/仍为中高风险）次数，用于下一场排班与指示牌 */
  triggerCount: number
  /** 场务巡查反馈 */
  checks: AlertCheck[]
  /** 最近一次"确认拥挤"的时间 */
  lastConfirmedAt?: number
  /** 场务人工解除（查看后认为无需再预警） */
  dismissed: boolean
  createdAt: number
  updatedAt: number
}

/** 安保端临时分流通道：场务确认区域拥挤后生成，散场或人工确认后解除 */
export interface DiversionChannel {
  id: string
  showId: string
  /** 拥堵源（功能区） */
  zoneId: string
  /** 分流引导前往的出口/通道 */
  exitId: string
  reason: string
  /** 触发该通道的预警 id */
  alertId: string
  active: boolean
  createdAt: number
  /** 安保确认疏导完成 / 人流回落的时间 */
  closedAt?: number
  closeNote?: string
}

// ============ 工作人员 ============

export type StaffRole = 'usher' | 'security' | 'desk'
export type StaffStatus = 'idle' | 'patrolling' | 'busy'

export interface Staff {
  id: string
  name: string
  role: StaffRole
  /** 当前所在区域 */
  zoneId: string
  status: StaffStatus
  /** 正在执行的任务 id */
  taskId?: string
  /** 最近一次巡查区域记录：zoneId -> 时间戳 */
  lastPatrolAt: Record<string, number>
}

// ============ 走失事件与协同任务 ============

export type IncidentStage = 'entry' | 'intermission' | 'exit'
export type IncidentStatus =
  | 'searching' // 搜寻中
  | 'reunited' // 已与家长团聚（关闭）
  | 'broadcast' // 已升级广播
  | 'police' // 已报警、出口拦截中
  | 'closed_lost' // 散场结束仍未找到

export interface TimelineEntry {
  t: number
  actor: string
  text: string
  kind: 'report' | 'dispatch' | 'patrol' | 'desk' | 'guardian' | 'broadcast' | 'security' | 'system'
}

export type TaskType = 'search' | 'intercept' | 'desk_alert'
export type TaskStatus = 'pending' | 'accepted' | 'done'

export interface AssignedTask {
  id: string
  staffId: string
  staffName: string
  role: StaffRole
  type: TaskType
  /** 任务涉及区域（搜寻分区 / 拦截出口） */
  zoneIds: string[]
  instruction: string
  priority: 'normal' | 'high'
  status: TaskStatus
  createdAt: number
  acceptedAt?: number
  result?: string
  doneAt?: number
}

/** 场务巡查反馈 */
export interface PatrolCheck {
  id: string
  staffId: string
  staffName: string
  zoneId: string
  at: number
  found: boolean
  note: string
}

/** 服务台核验疑似儿童 */
export type DeskDecision = 'notify_parent' | 'escort_seat' | 'broadcast'

export interface DeskCheck {
  id: string
  at: number
  childAppearance: string
  featureMatch: boolean
  seatMatch: boolean
  guardianMatch: boolean
  /** 与登记信息不符的说明 */
  mismatchNote?: string
  decision: DeskDecision
  handler: string
}

/** 安保出口拦截状态 */
export interface ExitInterception {
  zoneId: string
  active: boolean
  staffId?: string
  /** 最近巡查该出口的时间，用于决定是否重点拦截 */
  reason: string
  updatedAt: number
}

export interface BroadcastRecord {
  at: number
  content: string
  times: number
}

export interface Incident {
  id: string
  showId: string
  childId: string
  /** 报案时的儿童信息快照 */
  childSnapshot: {
    nickname: string
    age: number
    topColor: string
    bottomColor: string
    features: string
    seatId: string
    guardians: Guardian[]
    emergencyContact: string
    temporaryCareAllowed: boolean
  }
  /** 报案发生阶段 */
  stage: IncidentStage
  reportedBy: string
  reporterPhone: string
  lastSeenZoneId: string
  lastSeenAt: number
  lastSeenNote: string
  status: IncidentStatus
  timeline: TimelineEntry[]
  tasks: AssignedTask[]
  patrolChecks: PatrolCheck[]
  deskChecks: DeskCheck[]
  /** 报案时自动带入的中场预警巡查记录（用于缩小"最后出现范围"） */
  broughtAlertChecks: AlertCheck[]
  interceptions: ExitInterception[]
  broadcast?: BroadcastRecord
  cctvRequested: boolean
  cctvNote?: string
  policeCalled: boolean
  policeNote?: string
  parentNotifyWay?: string
  resolutionNote?: string
  closedAt?: number
  createdAt: number
}

// ============ 复盘 ============

export interface StageStat {
  stage: IncidentStage
  label: string
  count: number
}

export interface ReviewSuggestion {
  id: string
  /** staffing=场务排班/站位 toilet=厕所排队引导 exit=出口提示 signage=临时指示牌 */
  area: 'staffing' | 'toilet' | 'exit' | 'signage'
  text: string
  basedOn: string
}

export interface ShowReview {
  showId: string
  total: number
  byStage: StageStat[]
  suggestions: ReviewSuggestion[]
}
