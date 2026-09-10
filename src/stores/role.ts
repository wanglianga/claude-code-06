import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { useShowStore } from './show'

export type RoleView = 'parent' | 'gate' | 'usher' | 'security' | 'desk' | 'manager'

export const ROLE_META: Record<RoleView, { label: string; desc: string; icon: string }> = {
  parent: { label: '家长端', desc: '购票后登记儿童安全服务 / 中场报案', icon: '👨‍👩‍👧' },
  gate: { label: '入场闸机', desc: '核验订单，儿童信息进入当场安全列表', icon: '🎫' },
  usher: { label: '场务端', desc: '分区座位、高风险提示、巡查与拥挤度上报', icon: '🧑‍🤝‍🧑' },
  security: { label: '安保端', desc: '接单、出口拦截、监控与警方协助', icon: '🛡️' },
  desk: { label: '服务台', desc: '接报疑似儿童，特征/座位/家长三项核验', icon: 'ℹ️' },
  manager: { label: '值班经理', desc: '全场态势、阶段推进与散场复盘', icon: '🎯' },
}

export const useRoleStore = defineStore('role', () => {
  const view = ref<RoleView>('manager')
  /** 当前登录的工作人员 id（场务/安保/服务台） */
  const staffId = ref<string>('')
  /** 家长端当前选中的订单号 */
  const orderNo = ref<string>('')

  const showStore = useShowStore()

  const currentStaff = computed(() => showStore.staffById(staffId.value))

  function switchView(next: RoleView) {
    view.value = next
  }

  function loginAs(staff: string) {
    staffId.value = staff
  }

  function selectOrder(no: string) {
    orderNo.value = no
  }

  return { view, staffId, orderNo, currentStaff, switchView, loginAs, selectOrder }
})
