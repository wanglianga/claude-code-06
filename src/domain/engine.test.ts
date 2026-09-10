import { describe, expect, it } from 'vitest'
import {
  assessRisk,
  buildBroadcast,
  nearestStaff,
  parentNotifyWay,
  planExitInterceptions,
  planSearchZones,
  recommendPatrolZones,
  reviewShow,
  verifyDeskCandidate,
} from './engine'
import { buildChildren, buildCrowdReports, buildStaff, ZONES, ZONES_BY_ID } from './seed'
import type { ChildProfile, Incident, Staff } from './types'

const NOW = new Date('2026-09-10T19:20:00+08:00').getTime()

function child(partial: Partial<ChildProfile> = {}): ChildProfile {
  return {
    id: 'X1',
    orderNo: 'O1',
    showId: 'S1',
    nickname: '测试娃',
    age: 5,
    topColor: '红',
    bottomColor: '蓝',
    features: '背包',
    seatId: 'seat-a-A1',
    guardians: [{ name: '家长甲', relation: '爸爸', phone: '13800000000' }],
    emergencyContact: '13800000000',
    temporaryCareAllowed: true,
    highRiskFamily: false,
    registeredAt: NOW - 1000,
    admitted: false,
    ...partial,
  }
}

describe('assessRisk 高风险评估', () => {
  it('低龄 + 单家长 + 拒绝看护 + 无特征 → 高风险', () => {
    const r = assessRisk(child({ age: 3, temporaryCareAllowed: false, features: '  ' }), NOW)
    expect(r.high).toBe(true)
    expect(r.reasons.length).toBeGreaterThanOrEqual(4)
  })

  it('双家长、授权看护、信息完整的 7 岁儿童不是高风险', () => {
    const r = assessRisk(
      child({
        age: 7,
        temporaryCareAllowed: true,
        guardians: [
          { name: 'a', relation: '爸爸', phone: '1' },
          { name: 'b', relation: '妈妈', phone: '2' },
        ],
      }),
      NOW
    )
    expect(r.high).toBe(false)
  })
})

describe('recommendPatrolZones 中场巡查推荐', () => {
  it('高拥挤且久未巡查的家庭厕所排在最前', () => {
    const list = recommendPatrolZones(ZONES, buildStaff(NOW), buildCrowdReports(NOW), NOW)
    expect(list[0].zone.id).toBe('toilet-family')
    expect(list[0].level).toBe('high')
  })

  it('只输出功能区，不含座位/出口', () => {
    const list = recommendPatrolZones(ZONES, [], [], NOW)
    expect(list.every((x) => x.zone.type === 'facility')).toBe(true)
  })
})

describe('planSearchZones 找回搜寻分区', () => {
  it('最后出现位置排第一', () => {
    const family = ZONES_BY_ID.get('toilet-family')!
    const plan = planSearchZones(ZONES, family, buildCrowdReports(NOW), NOW)
    expect(plan[0].zone.id).toBe('toilet-family')
    expect(plan.some((p) => p.zone.type === 'exit')).toBe(true)
    expect(plan.some((p) => p.zone.type === 'seat')).toBe(true)
  })
})

describe('nearestStaff 最近人员派发', () => {
  it('派给离东出口更近的安保，忙碌人员不参与', () => {
    const staff = buildStaff(NOW)
    const target = ZONES_BY_ID.get('exit-east')!
    const pick = nearestStaff(staff, ZONES_BY_ID, target, 'security')
    expect(pick?.id).toBe('S1')
  })

  it('最近的人忙时自动改派其他人', () => {
    const staff = buildStaff(NOW)
    staff.find((s) => s.id === 'S1')!.status = 'busy'
    const target = ZONES_BY_ID.get('exit-east')!
    const pick = nearestStaff(staff, ZONES_BY_ID, target, 'security')
    expect(pick?.id).toBe('S2')
  })
})

describe('planExitInterceptions 出口拦截随巡查位置变化', () => {
  it('久未巡查的出口自动纳入拦截，刚巡查的出口默认不拦截', () => {
    const staff = buildStaff(NOW)
    const plan = planExitInterceptions(ZONES, staff, [], [], NOW)
    const byId = new Map(plan.map((p) => [p.zoneId, p]))
    // 北出口从未有人巡查 → 拦截
    expect(byId.get('exit-n')!.active).toBe(true)
    // 东出口 3 分钟前刚巡查 → 不拦截
    expect(byId.get('exit-east')!.active).toBe(false)
    // 西出口 12 分钟未巡查 → 拦截
    expect(byId.get('exit-west')!.active).toBe(true)
  })

  it('场务在出口搜寻未见 → 保持拦截', () => {
    const staff = buildStaff(NOW)
    const plan = planExitInterceptions(
      ZONES,
      staff,
      [{ id: 'p1', staffId: 'S1', staffName: '周磊', zoneId: 'exit-east', at: NOW, found: false, note: '未见' }],
      [],
      NOW
    )
    expect(plan.find((p) => p.zoneId === 'exit-east')!.active).toBe(true)
  })
})

describe('verifyDeskCandidate 服务台核验三分支', () => {
  it('全匹配 + 授权看护 → 护送回座位', () => {
    const r = verifyDeskCandidate({
      featureMatch: true,
      seatMatch: true,
      guardianMatch: true,
      temporaryCareAllowed: true,
      previousDeskChecks: [],
    })
    expect(r.decision).toBe('escort_seat')
  })

  it('全匹配但未授权 → 通知家长到服务台', () => {
    const r = verifyDeskCandidate({
      featureMatch: true,
      seatMatch: true,
      guardianMatch: true,
      temporaryCareAllowed: false,
      previousDeskChecks: [],
    })
    expect(r.decision).toBe('notify_parent')
  })

  it('特征不符 → 升级广播', () => {
    const r = verifyDeskCandidate({
      featureMatch: false,
      seatMatch: true,
      guardianMatch: true,
      temporaryCareAllowed: true,
      previousDeskChecks: [],
    })
    expect(r.decision).toBe('broadcast')
  })
})

function baseIncident(stage: Incident['stage']): Incident {
  const c = child()
  return {
    id: 'I1',
    showId: 'S1',
    childId: c.id,
    childSnapshot: {
      nickname: c.nickname,
      age: c.age,
      topColor: c.topColor,
      bottomColor: c.bottomColor,
      features: c.features,
      seatId: c.seatId,
      guardians: c.guardians,
      emergencyContact: c.emergencyContact,
      temporaryCareAllowed: c.temporaryCareAllowed,
    },
    stage,
    reportedBy: '家长甲',
    reporterPhone: '13800000000',
    lastSeenZoneId: 'toilet-family',
    lastSeenAt: NOW - 120000,
    lastSeenNote: '排队上厕所',
    status: 'searching',
    timeline: [],
    tasks: [],
    patrolChecks: [],
    deskChecks: [],
    interceptions: [],
    cctvRequested: false,
    policeCalled: false,
    createdAt: NOW,
  }
}

describe('buildBroadcast 广播文案随核验结果变化', () => {
  it('无核验记录 → 常规寻人，含衣着特征', () => {
    const b = buildBroadcast(baseIncident('intermission'), NOW)
    expect(b.times).toBe(1)
    expect(b.content).toContain('测试娃')
    expect(b.content).toContain('背包')
  })

  it('服务台特征不符 → 广播口径变为更正并提示真实衣着', () => {
    const inc = baseIncident('intermission')
    inc.deskChecks.push({
      id: 'd1',
      at: NOW,
      childAppearance: '蓝上衣',
      featureMatch: false,
      seatMatch: false,
      guardianMatch: false,
      decision: 'broadcast',
      handler: '陈雨桐',
    })
    const b = buildBroadcast(inc, NOW)
    expect(b.content).toContain('更正')
    expect(b.content).toContain('实际穿着')
    expect(b.times).toBe(1)
  })

  it('重复广播次数累加', () => {
    const inc = baseIncident('intermission')
    inc.broadcast = { at: NOW - 60000, content: '旧文案', times: 1 }
    expect(buildBroadcast(inc, NOW).times).toBe(2)
  })
})

describe('parentNotifyWay 家长通知方式随状态变化', () => {
  it('广播中 → 每 5 分钟回拨', () => {
    const inc = baseIncident('intermission')
    inc.status = 'broadcast'
    expect(parentNotifyWay(inc)).toContain('广播')
  })

  it('报警后 → 专人陪同同步警方', () => {
    const inc = baseIncident('exit')
    inc.status = 'police'
    expect(parentNotifyWay(inc)).toContain('警')
  })
})

describe('reviewShow 复盘按走失阶段给建议', () => {
  it('中场走失 → 建议厕所排队引导；散场走失 → 出口提示', () => {
    const incidents = [baseIncident('intermission'), baseIncident('exit')]
    const review = reviewShow(incidents)
    expect(review.byStage.find((s) => s.stage === 'intermission')!.count).toBe(1)
    expect(review.suggestions.some((s) => s.area === 'toilet')).toBe(true)
    expect(review.suggestions.some((s) => s.area === 'exit')).toBe(true)
  })

  it('无走失 → 维持站位', () => {
    const review = reviewShow([])
    expect(review.total).toBe(0)
    expect(review.suggestions[0].text).toContain('维持')
  })
})

describe('种子数据自洽', () => {
  it('所有儿童座位号存在，所有人员位置合法', () => {
    const children = buildChildren(NOW)
    for (const c of children) {
      expect(ZONES_BY_ID.has(c.seatId.split('-').slice(0, 2).join('-'))).toBe(true)
    }
    const staff: Staff[] = buildStaff(NOW)
    for (const s of staff) expect(ZONES_BY_ID.has(s.zoneId)).toBe(true)
  })
})
