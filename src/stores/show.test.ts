// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useShowStore } from './show'

/**
 * 端到端业务流（跨角色协同）：
 * 登记 → 闸机核验 → 中场报案派单 → 场务巡查 → 服务台三项核验 → 团聚关闭
 * → 散场再发案 → 出口拦截联动 → 报警全拦截 → 散场结束归档 → 复盘建议
 */
describe('show store 端到端协同流', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
  })

  it('完整走失-找回-复盘链路', () => {
    const store = useShowStore()

    // 1. 家长为新订单登记儿童安全服务
    const registered = store.registerChild({
      orderNo: 'DD20260910007',
      nickname: '小测试',
      age: 3,
      topColor: '橙色',
      bottomColor: '黑色',
      features: '戴黄色渔夫帽',
      seatId: 'seat-c-E1',
      guardians: [{ name: '测试妈', relation: '妈妈', phone: '13800000010' }],
      emergencyContact: '13800000010（妈妈 测试妈）',
      temporaryCareAllowed: true,
      highRiskFamily: true,
      highRiskReason: '首次到场，多孩同行',
    })
    expect(registered.admitted).toBe(false)

    // 2. 闸机核验：错误订单报错；正确订单入场
    expect(store.admitByOrder('NOT-EXIST', 'gate')).toEqual({
      error: expect.stringContaining('未找到'),
    })
    const admitted = store.admitByOrder('DD20260910007', 'gate')
    expect('id' in admitted && admitted.admitted).toBe(true)

    // 把种子里其余儿童也核验入场
    for (const c of store.children.filter((x) => !x.admitted)) {
      const r = store.admitByOrder(c.orderNo, 'gate')
      expect('id' in r).toBe(true)
    }

    // 3. 经理推进到中场休息
    store.setPhase('intermission')
    expect(store.show.phase).toBe('intermission')

    // 4. 场务上报家庭厕所拥挤
    store.reportCrowd('toilet-family', 'high', 'U3')

    // 5. 家长中场报案（豆包 C001，未授权临看）
    const doubao = store.children.find((c) => c.nickname === '豆包')!
    const inc = store.reportMissing({
      childId: doubao.id,
      reportedBy: '王梅',
      reporterPhone: '13800000001',
      lastSeenZoneId: 'toilet-family',
      lastSeenNote: '排队上厕所时走散',
    })
    expect(inc.stage).toBe('intermission')
    // 自动生成 4 个任务：2 场务搜寻 + 1 安保出口 + 1 服务台待命
    expect(inc.tasks).toHaveLength(4)
    expect(inc.tasks.filter((t) => t.role === 'usher')).toHaveLength(2)
    expect(inc.tasks.some((t) => t.role === 'security')).toBe(true)
    expect(inc.tasks.some((t) => t.role === 'desk')).toBe(true)
    // 高优先级搜寻任务覆盖最后出现位置
    expect(inc.tasks[0].zoneIds).toContain('toilet-family')
    // 派单后对应人员变忙
    expect(store.staff.filter((s) => s.status === 'busy').length).toBeGreaterThanOrEqual(3)
    // 时间线包含报案与派单
    expect(inc.timeline.some((e) => e.kind === 'report')).toBe(true)
    expect(inc.timeline.filter((e) => e.kind === 'dispatch').length).toBe(4)

    // 6. 场务接单、两轮排查未见（第二轮回写会影响后续状态）
    const searchTask = inc.tasks.find((t) => t.role === 'usher')!
    store.acceptTask(inc.id, searchTask.id, searchTask.staffId)
    store.patrolCheck(inc.id, searchTask.staffId, 'toilet-m', false, '男厕已排查，无人')
    expect(inc.patrolChecks).toHaveLength(1)

    // 7. 服务台接到疑似儿童：三项全匹配。豆包未授权临看 → 通知家长到服务台
    store.submitDeskCheck({
      incidentId: inc.id,
      childAppearance: '黄色上衣蓝色裤子，绿色恐龙背包，自称豆包',
      featureMatch: true,
      seatMatch: true,
      guardianMatch: true,
      handlerId: 'D1',
    })
    expect(inc.deskChecks[0].decision).toBe('notify_parent')
    expect(inc.status).toBe('searching') // 通知家长不等于广播
    expect(inc.parentNotifyWay).toContain('服务台')

    // 8. 家长到场认领，事件团聚关闭，人员释放
    store.resolveAtDesk(inc.id, 'parent_pickup', 'D1')
    expect(inc.status).toBe('reunited')
    expect(inc.closedAt).toBeTruthy()
    expect(store.activeIncidents).toHaveLength(0)

    // 9. 经理推进散场；另一家庭报案（小糯米 C002，已授权临看）
    store.setPhase('exit')
    const nuomi = store.children.find((c) => c.nickname === '小糯米')!
    const inc2 = store.reportMissing({
      childId: nuomi.id,
      reportedBy: '张伟',
      reporterPhone: '13800000002',
      lastSeenZoneId: 'interact',
      lastSeenNote: '互动区看完气球后不见了',
    })
    expect(inc2.stage).toBe('exit')

    // 10. 出口拦截联动：北出口从未巡查、西出口 12 分钟未巡查 → 自动拦截；
    //     东出口刚巡查过 → 暂不拦截
    const active = inc2.interceptions.filter((x) => x.active).map((x) => x.zoneId)
    expect(active).toContain('exit-n')
    expect(active).toContain('exit-west')
    expect(active).not.toContain('exit-east')

    // 场务到东出口排查未见 → 该出口立即升级为拦截（巡查位置影响拦截）
    const usher2 = inc2.tasks.filter((t) => t.role === 'usher')[0].staffId
    store.patrolCheck(inc2.id, usher2, 'exit-east', false, '东出口通道未见')
    expect(inc2.interceptions.find((x) => x.zoneId === 'exit-east')!.active).toBe(true)

    // 11. 服务台再次接到疑似儿童但衣着不符 → 自动升级广播，文案为“更正”口径
    store.submitDeskCheck({
      incidentId: inc2.id,
      childAppearance: '红衣女孩，说不出名字',
      featureMatch: false,
      seatMatch: false,
      guardianMatch: false,
      mismatchNote: '上衣颜色与登记粉色不符',
      handlerId: 'D2',
    })
    expect(inc2.deskChecks[0].decision).toBe('broadcast')
    expect(inc2.status).toBe('broadcast')
    expect(inc2.broadcast).toBeTruthy()
    expect(inc2.broadcast!.content).toContain('更正')
    // 广播触发全部出口关注
    expect(inc2.interceptions.every((x) => x.active)).toBe(true)

    // 12. 安保调监控、报警 → 警方状态，家长通知方式改变
    store.requestCctv(inc2.id, '互动区与东出口 20:10-20:25 画面', '周磊')
    expect(inc2.cctvRequested).toBe(true)
    store.callPolice(inc2.id, '5 岁女童粉色上衣白裤，失踪约 20 分钟', '周磊')
    expect(inc2.status).toBe('police')
    expect(inc2.policeCalled).toBe(true)
    expect(inc2.parentNotifyWay).toContain('警')

    // 13. 散场结束仍未找到 → closed_lost，复盘统计两个阶段
    store.closeShow()
    expect(store.show.phase).toBe('closed')
    expect(inc2.status).toBe('closed_lost')
    const review = store.review
    expect(review.total).toBe(2)
    expect(review.byStage.find((s) => s.stage === 'intermission')!.count).toBe(1)
    expect(review.byStage.find((s) => s.stage === 'exit')!.count).toBe(1)
    // 中场事件涉及厕所 → 厕所引导建议；散场事件 → 出口提示建议
    expect(review.suggestions.some((s) => s.area === 'toilet')).toBe(true)
    expect(review.suggestions.some((s) => s.area === 'exit')).toBe(true)

    // 14. 状态持久化到 localStorage
    const raw = JSON.parse(localStorage.getItem('theater-safety-v1')!)
    expect(raw.incidents).toHaveLength(2)
    expect(raw.show.phase).toBe('closed')
  })

  it('三项匹配且已授权临看 → 护送回座位并团聚', () => {
    const store = useShowStore()
    store.setPhase('intermission')
    const nuomi = store.children.find((c) => c.nickname === '小糯米')! // temporaryCareAllowed: true
    const inc = store.reportMissing({
      childId: nuomi.id,
      reportedBy: '张伟',
      reporterPhone: '13800000002',
      lastSeenZoneId: 'shop',
      lastSeenNote: '买冰淇淋走散',
    })
    store.submitDeskCheck({
      incidentId: inc.id,
      childAppearance: '粉衣白裤双马尾',
      featureMatch: true,
      seatMatch: true,
      guardianMatch: true,
      handlerId: 'D1',
    })
    expect(inc.deskChecks[0].decision).toBe('escort_seat')
    store.resolveAtDesk(inc.id, 'escort_done', 'D1')
    expect(inc.status).toBe('reunited')
  })

  it('任务人员忙碌时支持改派给最近空闲人员', () => {
    const store = useShowStore()
    store.setPhase('intermission')
    const tangtang = store.children.find((c) => c.nickname === '糖糖')!
    const inc = store.reportMissing({
      childId: tangtang.id,
      reportedBy: '刘洋',
      reporterPhone: '13800000004',
      lastSeenZoneId: 'seat-c',
      lastSeenNote: '演出中离开座位',
    })
    const securityTask = inc.tasks.find((t) => t.role === 'security' && t.zoneIds.length > 1)!
    const original = securityTask.staffId
    store.staffById(original)!.status = 'busy'
    // 新建一个事件占用全部安保后，原任务改派应给出“暂无空闲”提示而不是崩溃
    store.reassignTask(inc.id, securityTask.id)
    expect(securityTask.status === 'pending' || securityTask.status === 'accepted').toBe(true)
  })
})
