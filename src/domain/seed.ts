import type { ChildProfile, CrowdReport, Seat, Show, Staff, Zone } from './types'

/**
 * 场馆布局（坐标用于 SVG 平面地图与距离计算，百分比 0-100）
 *
 *        北出口(exit-n)
 *          舞台(stage)
 *   C区座位
 *      A区座位      B区座位
 *  卖品区              男厕/家庭厕所
 *                      互动区
 *  服务台                  东出口(exit-east)
 *   闸机
 *        西出口(exit-west)
 */
export const ZONES: Zone[] = [
  { id: 'gate', name: '入场闸机', shortName: '闸机', type: 'gate', x: 16, y: 90 },
  { id: 'desk', name: '观众服务台', shortName: '服务台', type: 'desk', x: 30, y: 80 },
  { id: 'stage', name: '舞台', shortName: '舞台', type: 'stage', x: 48, y: 10 },
  { id: 'seat-a', name: 'A 区座位', shortName: 'A区', type: 'seat', x: 28, y: 42 },
  { id: 'seat-b', name: 'B 区座位', shortName: 'B区', type: 'seat', x: 66, y: 42 },
  { id: 'seat-c', name: 'C 区座位（亲子座）', shortName: 'C区', type: 'seat', x: 48, y: 26 },
  { id: 'shop', name: '卖品区', shortName: '卖品', type: 'facility', x: 8, y: 62 },
  { id: 'toilet-family', name: '家庭厕所', shortName: '家庭厕所', type: 'facility', x: 88, y: 66 },
  { id: 'toilet-m', name: '男厕', shortName: '男厕', type: 'facility', x: 92, y: 54 },
  { id: 'interact', name: '互动体验区', shortName: '互动区', type: 'facility', x: 86, y: 28 },
  { id: 'exit-n', name: '北侧出口', shortName: '北出口', type: 'exit', x: 48, y: 3, interceptable: true },
  { id: 'exit-east', name: '东侧出口（近厕所）', shortName: '东出口', type: 'exit', x: 96, y: 82, interceptable: true },
  { id: 'exit-west', name: '西侧出口（近卖品区）', shortName: '西出口', type: 'exit', x: 3, y: 82, interceptable: true },
]

export const ZONES_BY_ID = new Map(ZONES.map((z) => [z.id, z]))

function buildSeats(): Seat[] {
  const layout: Record<string, string[]> = {
    'seat-a': ['A', 'B', 'C'],
    'seat-b': ['A', 'B', 'C'],
    'seat-c': ['D', 'E'],
  }
  const seats: Seat[] = []
  for (const [zoneId, rows] of Object.entries(layout)) {
    for (const row of rows) {
      for (let no = 1; no <= 6; no++) {
        seats.push({ id: `${zoneId}-${row}${no}`, zoneId, row, no })
      }
    }
  }
  return seats
}

export const SEATS: Seat[] = buildSeats()
export const SEATS_BY_ID = new Map(SEATS.map((s) => [s.id, s]))

export function buildShow(now: number): Show {
  const d = new Date(now)
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  return {
    id: 'SHOW-1930',
    name: '《森林漫游指南》亲子互动剧场',
    date,
    startTime: '19:30',
    phase: 'entry',
    seatsTotal: SEATS.length,
  }
}

export function buildStaff(now: number): Staff[] {
  // 给个别人预置巡查时间，让“巡查盲区”排序更真实
  const recent = now - 3 * 60 * 1000
  const stale = now - 12 * 60 * 1000
  return [
    { id: 'U1', name: '李晓雯', role: 'usher', zoneId: 'seat-a', status: 'idle', lastPatrolAt: { 'seat-a': recent } },
    { id: 'U2', name: '赵强', role: 'usher', zoneId: 'shop', status: 'idle', lastPatrolAt: { shop: stale } },
    { id: 'U3', name: '孙悦', role: 'usher', zoneId: 'interact', status: 'idle', lastPatrolAt: { interact: recent, 'toilet-family': stale } },
    { id: 'S1', name: '周磊', role: 'security', zoneId: 'exit-east', status: 'idle', lastPatrolAt: { 'exit-east': recent } },
    { id: 'S2', name: '吴敏', role: 'security', zoneId: 'exit-west', status: 'idle', lastPatrolAt: { 'exit-west': stale } },
    { id: 'D1', name: '陈雨桐', role: 'desk', zoneId: 'desk', status: 'idle', lastPatrolAt: {} },
    { id: 'D2', name: '林可', role: 'desk', zoneId: 'desk', status: 'idle', lastPatrolAt: {} },
  ]
}

export function buildChildren(now: number): ChildProfile[] {
  const base: Omit<ChildProfile, 'registeredAt' | 'showId'>[] = [
    {
      id: 'C001',
      orderNo: 'DD20260910001',
      nickname: '豆包',
      age: 4,
      topColor: '黄色',
      bottomColor: '蓝色',
      features: '背绿色小恐龙背包，左脸颊有贴纸印',
      seatId: 'seat-a-A6',
      guardians: [{ name: '王梅', relation: '妈妈', phone: '13800000001' }],
      emergencyContact: '13800000001（妈妈 王梅）',
      temporaryCareAllowed: false,
      highRiskFamily: true,
      highRiskReason: '首次到场，单家长带两名儿童',
      admitted: true,
      admittedAt: now - 18 * 60 * 1000,
      gateId: 'gate',
    },
    {
      id: 'C002',
      orderNo: 'DD20260910002',
      nickname: '小糯米',
      age: 5,
      topColor: '粉色',
      bottomColor: '白色',
      features: '扎双马尾，戴粉色发箍',
      seatId: 'seat-b-B3',
      guardians: [
        { name: '张伟', relation: '爸爸', phone: '13800000002' },
        { name: '李娜', relation: '妈妈', phone: '13800000003' },
      ],
      emergencyContact: '13800000003（妈妈 李娜）',
      temporaryCareAllowed: true,
      highRiskFamily: false,
      admitted: true,
      admittedAt: now - 16 * 60 * 1000,
      gateId: 'gate',
    },
    {
      id: 'C003',
      orderNo: 'DD20260910003',
      nickname: '糖糖',
      age: 3,
      topColor: '红色',
      bottomColor: '牛仔色',
      features: '佩戴人工耳蜗，听到呼喊可能不回头',
      seatId: 'seat-c-D2',
      guardians: [{ name: '刘洋', relation: '外婆', phone: '13800000004' }],
      emergencyContact: '13800000004（外婆 刘洋）',
      temporaryCareAllowed: false,
      highRiskFamily: true,
      highRiskReason: '听障儿童，祖辈单家长陪同',
      admitted: true,
      admittedAt: now - 10 * 60 * 1000,
      gateId: 'gate',
    },
    {
      id: 'C004',
      orderNo: 'DD20260910004',
      nickname: '浩浩',
      age: 6,
      topColor: '蓝色',
      bottomColor: '灰色',
      features: '手持蓝色荧光棒',
      seatId: 'seat-a-C2',
      guardians: [
        { name: '陈晨', relation: '爸爸', phone: '13800000005' },
        { name: '周晴', relation: '妈妈', phone: '13800000006' },
      ],
      emergencyContact: '13800000005（爸爸 陈晨）',
      temporaryCareAllowed: true,
      highRiskFamily: false,
      admitted: false,
    },
    {
      id: 'C005',
      orderNo: 'DD20260910005',
      nickname: '朵朵',
      age: 4,
      topColor: '紫色',
      bottomColor: '白色',
      features: '穿发光白球鞋',
      seatId: 'seat-b-A1',
      guardians: [{ name: '黄敏', relation: '妈妈', phone: '13800000007' }],
      emergencyContact: '13800000007（妈妈 黄敏）',
      temporaryCareAllowed: true,
      highRiskFamily: true,
      highRiskReason: '首次到场，儿童容易害羞不敢求助',
      admitted: false,
    },
    {
      id: 'C006',
      orderNo: 'DD20260910006',
      nickname: '乐乐',
      age: 7,
      topColor: '绿色',
      bottomColor: '黑色',
      features: '戴黑框眼镜',
      seatId: 'seat-b-C5',
      guardians: [
        { name: '吴凯', relation: '爸爸', phone: '13800000008' },
        { name: '郑爽', relation: '妈妈', phone: '13800000009' },
      ],
      emergencyContact: '13800000009（妈妈 郑爽）',
      temporaryCareAllowed: true,
      highRiskFamily: false,
      admitted: false,
    },
  ]
  return base.map((c) => ({ ...c, showId: 'SHOW-1930', registeredAt: now - 30 * 60 * 1000 }))
}

/** 入场阶段初始拥挤度上报 */
export function buildCrowdReports(now: number): CrowdReport[] {
  return [
    { zoneId: 'toilet-family', level: 'high', reportedBy: 'U3', at: now - 2 * 60 * 1000 },
    { zoneId: 'shop', level: 'medium', reportedBy: 'U2', at: now - 4 * 60 * 1000 },
    { zoneId: 'interact', level: 'low', reportedBy: 'U3', at: now - 3 * 60 * 1000 },
  ]
}
