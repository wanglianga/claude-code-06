// @vitest-environment jsdom
import { nextTick } from 'vue'
import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import App from '../App.vue'
import { createApp } from 'vue'
import { useRoleStore } from '../stores/role'
import { useShowStore } from '../stores/show'
import type { RoleView } from '../stores/role'

async function mountApp() {
  const el = document.createElement('div')
  document.body.appendChild(el)
  const app = createApp(App)
  app.use(createPinia())
  app.mount(el)
  await nextTick()
  await nextTick()
  return { el, app }
}

describe('六角色视图渲染冒烟测试', () => {
  beforeEach(() => {
    localStorage.clear()
    document.body.innerHTML = ''
    setActivePinia(createPinia())
  })

  const ROLES: RoleView[] = ['parent', 'gate', 'usher', 'security', 'desk', 'manager']

  it.each(ROLES)('初始入场数据下 %s 视图无运行时错误', async (r) => {
    const { el, app } = await mountApp()
    const role = useRoleStore()
    role.switchView(r)
    await nextTick()
    await nextTick()
    expect(el.textContent).toContain('星豆亲子剧场')
    app.unmount()
  })

  it('在中场报案产生事件后，所有角色视图仍可正常渲染', async () => {
    const { el, app } = await mountApp()
    const store = useShowStore()
    const role = useRoleStore()

    // 核验所有儿童并推进到中场
    for (const c of store.children) store.admitByOrder(c.orderNo, 'gate')
    store.setPhase('performance')
    store.setPhase('intermission')
    store.reportCrowd('toilet-family', 'high', 'U3')

    const doubao = store.children.find((c) => c.nickname === '豆包')!
    store.reportMissing({
      childId: doubao.id,
      reportedBy: '王梅',
      reporterPhone: '13800000001',
      lastSeenZoneId: 'toilet-family',
      lastSeenNote: '排队走散',
    })

    // 场务确认家庭厕所拥挤 → 安保端临时分流通道渲染
    const seatBAlert = store.activeAlerts.find((a) => a.zoneId === 'seat-b')!
    store.alertCheck(seatBAlert.id, 'U3', 'toilet-family', true, '排队堵到通道')
    expect(store.activeDiversions.length).toBe(1)

    // 打开场务端"中场高风险预警"Tab 并渲染
    role.switchView('usher')
    await nextTick()
    const alertTab = [...el.querySelectorAll('button')].find((b) => b.textContent?.includes('中场高风险预警'))
    expect(alertTab).toBeTruthy()
    alertTab!.dispatchEvent(new Event('click', { bubbles: true }))
    await nextTick()
    expect(el.textContent).toContain('中场休息高风险巡查优先级')
    expect(el.textContent).toContain('确认拥挤并通知安保分流')

    // 安保端渲染分流通道卡片
    role.switchView('security')
    await nextTick()
    expect(el.textContent).toContain('临时分流通道')
    expect(el.textContent).toContain('分流中')

    for (const r of ROLES) {
      role.switchView(r)
      await nextTick()
      await nextTick()
      if (r === 'parent') {
        // 家长端需选中报案儿童的订单才能看到事件
        role.selectOrder(doubao.orderNo)
        await nextTick()
        expect(el.textContent).toContain('豆包')
      } else {
        // 事件中的关键信息（昵称/任务文案）在工作人员视图里可见
        expect(el.textContent).toContain('豆包')
      }
    }

    // 服务台三项匹配但未授权 → 通知家长
    role.switchView('desk')
    await nextTick()
    const inc = store.incidents[0]
    store.submitDeskCheck({
      incidentId: inc.id,
      childAppearance: '黄衣蓝裤',
      featureMatch: true,
      seatMatch: true,
      guardianMatch: true,
      handlerId: 'D1',
    })
    await nextTick()
    expect(el.textContent).toContain('通知家长')

    // 推进散场：出口拦截卡片渲染
    role.switchView('manager')
    store.setPhase('exit')
    await nextTick()
    await nextTick()
    expect(el.textContent).toContain('出口拦截')

    // 再制造一起散场事件并广播
    const nuomi = store.children.find((c) => c.nickname === '小糯米')!
    store.reportMissing({
      childId: nuomi.id,
      reportedBy: '张伟',
      reporterPhone: '13800000002',
      lastSeenZoneId: 'interact',
      lastSeenNote: '互动区走散',
    })
    store.escalateBroadcast(store.incidents[0].id, '值班经理')
    for (const r of ['security', 'desk', 'manager'] as RoleView[]) {
      role.switchView(r)
      await nextTick()
      await nextTick()
      expect(el.textContent).toContain('广播')
    }

    // 结束演出 → 复盘视图
    store.closeShow()
    role.switchView('manager')
    await nextTick()
    await nextTick()
    expect(el.textContent).toContain('复盘')
    expect(el.textContent).toContain('厕所')

    app.unmount()
  })
})
