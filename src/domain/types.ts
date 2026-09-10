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
  area: 'staffing' | 'toilet' | 'exit'
  text: string
  basedOn: string
}

export interface ShowReview {
  showId: string
  total: number
  byStage: StageStat[]
  suggestions: ReviewSuggestion[]
}
