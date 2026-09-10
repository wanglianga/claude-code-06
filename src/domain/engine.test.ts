import { describe, expect, it } from 'vitest'
import {
  alertBasedReviewSuggestions,
  alertGeoContext,
  assessRisk,
  buildBroadcast,
  buildIntermissionAlerts,
  nearestStaff,
  parentNotifyWay,
  planDiversions,
  planExitInterceptions,
  planSearchZones,
  reconcileAlerts,
  recommendPatrolZones,
  reviewShow,
  scoreIntermissionAlert,
  selectAlertSightings,
  verifyDeskCandidate,
} from './engine'
import { buildChildren, buildCrowdReports, buildStaff, SEATS_BY_ID, ZONES, ZONES_BY_ID } from './seed'
import type { AlertCheck, ChildProfile, Incident, IntermissionAlert, Staff } from './types'

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

describe('中场高风险预警 scoreIntermissionAlert / buildIntermissionAlerts', () => {
  function admittedByZone() {
    const m = new Map<string, ChildProfile[]>()
    for (const c of buildChildren(NOW)) {
      if (!c.admitted) continue
      const zoneId = SEATS_BY_ID.get(c.seatId)!.zoneId
      const arr = m.get(zoneId) ?? []
      arr.push(c)
      m.set(zoneId, arr)
    }
    return m
  }

  it('五因子全部计入：年龄/距出口/单人带娃/离座/周边拥堵', () => {
    const zone = ZONES_BY_ID.get('seat-a')!
    const kids = [child({ age: 3, guardians: [{ name: '妈', relation: '妈妈', phone: '1' }] })]
    kids[0].leftSeatAt = NOW - 2 * 60000
    const s = scoreIntermissionAlert(kids, buildCrowdReports(NOW), alertGeoContext(ZONES, zone), NOW)
    expect(s.score).toBeGreaterThanOrEqual(26)
    expect(s.level).toBe('high')
    expect(s.factors.join('|')).toContain('低龄')
    expect(s.factors.join('|')).toContain('单人带娃')
    expect(s.factors.join('|')).toContain('离座未归')
    expect(s.factors.join('|')).toContain('出口')
    expect(s.factors.join('|')).toContain('人流')
  })

  it('按座位分区生成预警并按分值降序', () => {
    const alerts = buildIntermissionAlerts(
      ZONES,
      admittedByZone(),
      buildCrowdReports(NOW),
      'S1',
      NOW
    )
    expect(alerts.length).toBe(3)
    expect(alerts[0].score).toBeGreaterThanOrEqual(alerts[1].score)
    // B 区紧邻被报为高拥堵的家庭厕所 → 高风险
    expect(alerts.find((a) => a.zoneId === 'seat-b')!.level).toBe('high')
    expect(alerts.find((a) => a.zoneId === 'seat-b')!.crowdedZoneIds).toContain('toilet-family')
    // C 区周边无拥堵且紧邻出口 → 低风险
    expect(alerts.find((a) => a.zoneId === 'seat-c')!.level).toBe('low')
  })

  it('家长报备离座会抬升对应分区预警', () => {
    const byZone = admittedByZone()
    const before = buildIntermissionAlerts(ZONES, byZone, buildCrowdReports(NOW), 'S1', NOW)
    const seatABefore = before.find((a) => a.zoneId === 'seat-a')!
    const doubao = byZone.get('seat-a')!.find((c) => c.nickname === '豆包')!
    doubao.leftSeatAt = NOW - 60000
    const after = buildIntermissionAlerts(ZONES, byZone, buildCrowdReports(NOW), 'S1', NOW)
    const seatAAfter = after.find((a) => a.zoneId === 'seat-a')!
    expect(seatAAfter.score).toBeGreaterThan(seatABefore.score)
    expect(seatAAfter.leftSeatChildIds).toContain(doubao.id)
  })
})

describe('reconcileAlerts 预警历史合并与触发计数', () => {
  function alert(partial: Partial<IntermissionAlert>): IntermissionAlert {
    return {
      id: 'ALERT-seat-a',
      showId: 'S1',
      zoneId: 'seat-a',
      level: 'low',
      score: 0,
      factors: [],
      childIds: ['C1'],
      crowdedZoneIds: [],
      crowdLevel: 'low',
      leftSeatChildIds: [],
      confirmCount: 0,
      triggerCount: 0,
      checks: [],
      dismissed: false,
      createdAt: NOW - 60000,
      updatedAt: NOW - 60000,
      ...partial,
    }
  }

  it('保留巡查记录与确认次数', () => {
    const prev = [alert({ level: 'medium', score: 20, triggerCount: 1, confirmCount: 1, checks: [{ id: 'AC1', alertId: 'ALERT-seat-a', zoneId: 'shop', staffId: 'U1', staffName: '赵强', at: NOW - 30000, crowded: true, note: '挤' }] })]
    const fresh = [alert({ level: 'high', score: 30 })]
    const out = reconcileAlerts(prev, fresh, NOW)
    expect(out[0].checks).toHaveLength(1)
    expect(out[0].confirmCount).toBe(1)
  })

  it('等级升级才累计触发次数，降级不累计', () => {
    const prev = [alert({ level: 'medium', triggerCount: 1 })]
    expect(reconcileAlerts(prev, [alert({ level: 'high', score: 30 })], NOW)[0].triggerCount).toBe(2)
    expect(reconcileAlerts(prev, [alert({ level: 'low', score: 4 })], NOW)[0].triggerCount).toBe(1)
  })

  it('被解除的预警在重新升至高风险时自动复活', () => {
    const prev = [alert({ level: 'medium', dismissed: true })]
    expect(reconcileAlerts(prev, [alert({ level: 'medium', score: 20 })], NOW)[0].dismissed).toBe(true)
    expect(reconcileAlerts(prev, [alert({ level: 'high', score: 30 })], NOW)[0].dismissed).toBe(false)
  })
})

describe('planDiversions 场务确认拥挤 → 安保临时分流通道', () => {
  function alerts(confirmCount: number, level: IntermissionAlert['level']): IntermissionAlert[] {
    return [
      {
        id: 'ALERT-seat-b',
        showId: 'S1',
        zoneId: 'seat-b',
        level,
        score: 30,
        factors: [],
        childIds: ['C2'],
        crowdedZoneIds: ['toilet-family'],
        crowdLevel: 'high',
        leftSeatChildIds: [],
        confirmCount,
        triggerCount: 1,
        checks: [],
        dismissed: false,
        createdAt: NOW,
        updatedAt: NOW,
      },
    ]
  }

  it('确认拥挤后生成指向最近出口的分流通道', () => {
    const divs = planDiversions({ alerts: alerts(1, 'high'), zones: ZONES, existing: [], showId: 'S1', now: NOW })
    expect(divs).toHaveLength(1)
    expect(divs[0].zoneId).toBe('toilet-family')
    // 家庭厕所(88,66) 最近的是东出口(96,82)
    expect(divs[0].exitId).toBe('exit-east')
    expect(divs[0].active).toBe(true)
  })

  it('未确认拥挤 / 已解除 / 风险回落时不生成通道；已有关联通道被保留', () => {
    expect(planDiversions({ alerts: alerts(0, 'high'), zones: ZONES, existing: [], showId: 'S1', now: NOW })).toHaveLength(0)
    expect(planDiversions({ alerts: alerts(1, 'low'), zones: ZONES, existing: [], showId: 'S1', now: NOW })).toHaveLength(0)
    const existing = planDiversions({ alerts: alerts(1, 'high'), zones: ZONES, existing: [], showId: 'S1', now: NOW })
    const again = planDiversions({ alerts: alerts(2, 'high'), zones: ZONES, existing, showId: 'S1', now: NOW + 1000 })
    expect(again).toHaveLength(1)
    expect(again[0].id).toBe(existing[0].id)
  })
})

describe('selectAlertSightings 报案带入中场巡查记录', () => {
  function check(partial: Partial<AlertCheck>): AlertCheck {
    return {
      id: 'AC' + Math.random(),
      alertId: 'ALERT-seat-a',
      zoneId: 'shop',
      staffId: 'U2',
      staffName: '赵强',
      at: NOW - 5 * 60000,
      crowded: false,
      note: '巡查',
      ...partial,
    }
  }

  it('附近区域的人流正常记录、任意位置的确认拥挤记录均被带入', () => {
    const shop = ZONES_BY_ID.get('shop')!
    const sightings = selectAlertSightings(
      [
        check({ zoneId: 'shop' }),
        check({ zoneId: 'toilet-family', crowded: true, at: NOW - 2 * 60000 }),
        check({ zoneId: 'exit-n', at: NOW - 2 * 60000 }), // 北出口离卖品区很远且未确认拥挤 → 排除
      ],
      ZONES_BY_ID,
      shop,
      NOW
    )
    const ids = sightings.map((c) => c.zoneId)
    expect(ids).toContain('shop')
    expect(ids).toContain('toilet-family')
    expect(ids).not.toContain('exit-n')
    // 确认拥挤的记录排最前
    expect(sightings[0].crowded).toBe(true)
  })

  it('超过时效的巡查记录不再带入', () => {
    const shop = ZONES_BY_ID.get('shop')!
    const sightings = selectAlertSightings([check({ at: NOW - 25 * 60000 })], ZONES_BY_ID, shop, NOW)
    expect(sightings).toHaveLength(0)
  })

  it('带入的确认拥挤记录会抬高搜寻分区优先级', () => {
    const shop = ZONES_BY_ID.get('shop')!
    const plan = planSearchZones(
      ZONES,
      shop,
      buildCrowdReports(NOW),
      NOW,
      [check({ zoneId: 'toilet-family', crowded: true, at: NOW - 2 * 60000 })]
    )
    const toilet = plan.find((p) => p.zone.id === 'toilet-family')!
    expect(toilet.priorityScore).toBeGreaterThan(
      planSearchZones(ZONES, shop, buildCrowdReports(NOW), NOW).find((p) => p.zone.id === 'toilet-family')!.priorityScore
    )
    expect(toilet.reason).toContain('确认拥挤')
  })
})

describe('alertBasedReviewSuggestions 反复触发 → 下一场排班与指示牌', () => {
  function alert(partial: Partial<IntermissionAlert>): IntermissionAlert {
    return {
      id: 'ALERT-' + (partial.zoneId ?? 'seat-a'),
      showId: 'S1',
      zoneId: 'seat-a',
      level: 'medium',
      score: 20,
      factors: [],
      childIds: ['C1'],
      crowdedZoneIds: ['shop'],
      crowdLevel: 'medium',
      leftSeatChildIds: [],
      confirmCount: 0,
      triggerCount: 1,
      checks: [],
      dismissed: false,
      createdAt: NOW,
      updatedAt: NOW,
      ...partial,
    }
  }

  it('触发不足 2 次不产生建议', () => {
    expect(alertBasedReviewSuggestions([alert({})], ZONES_BY_ID)).toHaveLength(0)
  })

  it('反复触发产生排班建议；被确认拥挤的区域额外产生临时指示牌建议', () => {
    const s = alertBasedReviewSuggestions(
      [alert({ zoneId: 'seat-a', triggerCount: 3, confirmCount: 2 })],
      ZONES_BY_ID
    )
    expect(s.some((x) => x.area === 'staffing')).toBe(true)
    expect(s.some((x) => x.area === 'signage')).toBe(true)
    expect(s.find((x) => x.area === 'signage')!.text).toContain('指示牌')
  })

  it('复盘 reviewShow 透传预警建议', () => {
    const review = reviewShow([], [alert({ zoneId: 'seat-a', triggerCount: 2, confirmCount: 1 })], ZONES_BY_ID)
    expect(review.suggestions.some((x) => x.area === 'signage')).toBe(true)
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
    broughtAlertChecks: [],
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
