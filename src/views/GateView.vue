<script setup lang="ts">
import { computed, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useShowStore } from '@/stores/show'
import { useToastStore } from '@/stores/toast'
import { assessRisk, formatTime, minutesAgo } from '@/domain/engine'
import { SEATS_BY_ID } from '@/domain/seed'

const store = useShowStore()
const toast = useToastStore()
const { now } = storeToRefs(store)

const orderInput = ref('')
const lastScanned = ref<string | null>(null)

function scan() {
  const v = orderInput.value.trim()
  if (!v) return toast.push('请扫描或输入订单号', 'critical')
  const res = store.admitByOrder(v, 'gate')
  if ('error' in res) {
    toast.push(res.error, 'critical')
    return
  }
  lastScanned.value = res.id
  const risk = assessRisk(res, now.value)
  toast.push(`核验通过：${res.nickname} → 座位 ${res.seatId}${risk.high ? '（⚠️ 高风险家庭，请安排带位）' : ''}`, 'good', 5200)
  orderInput.value = ''
}

function quickFill(o: string) {
  orderInput.value = o
}

const admitted = computed(() =>
  [...store.children].filter((c) => c.admitted).sort((a, b) => (b.admittedAt ?? 0) - (a.admittedAt ?? 0))
)
const waiting = computed(() => store.children.filter((c) => !c.admitted))

const riskOf = (id: string) => assessRisk(store.childById(id)!, now.value)

const admittedCount = computed(() => admitted.value.length)
const riskCount = computed(() => admitted.value.filter((c) => riskOf(c.id).high).length)
</script>

<template>
  <div class="stack">
    <div class="grid-3">
      <div class="stat"><div class="k">已核验入场儿童</div><div class="v good">{{ admittedCount }}</div></div>
      <div class="stat"><div class="k">待核验（已登记）</div><div class="v">{{ waiting.length }}</div></div>
      <div class="stat"><div class="k">高风险家庭（已入场）</div><div class="v critical">{{ riskCount }}</div></div>
    </div>

    <div class="grid-2">
      <!-- 扫码核验 -->
      <div class="card">
        <div class="card-title">
          <h2>🎫 闸机核验</h2>
          <span class="hint">核验通过后，儿童信息进入当场演出安全列表，场务端立即可见</span>
        </div>
        <div class="row">
          <input
            v-model="orderInput"
            placeholder="扫描家长票/订单二维码（订单号 DD…）"
            @keyup.enter="scan"
            style="flex:1;min-width:200px"
          />
          <button @click="scan">核验入场</button>
        </div>
        <div class="muted small-text" style="margin:10px 0 6px">待核验订单（演示数据，点击填入）：</div>
        <div class="row">
          <button v-for="c in waiting" :key="c.id" class="ghost small" @click="quickFill(c.orderNo)">
            {{ c.orderNo }} · {{ c.nickname }}
            <span v-if="c.highRiskFamily" style="color:var(--critical)"> ⚠</span>
          </button>
          <span v-if="!waiting.length" class="muted small-text">全部核验完毕</span>
        </div>

        <div v-if="lastScanned" class="section-gap">
          <template v-for="c in admitted.filter((x) => x.id === lastScanned)" :key="c.id">
            <div class="list-row" :class="riskOf(c.id).high ? 'danger' : ''">
              <span class="dot" :class="riskOf(c.id).high ? 'dot-critical' : 'dot-good'"></span>
              <div style="flex:1">
                <strong>{{ c.nickname }}，{{ c.age }} 岁 → {{ c.seatId }}（{{ SEATS_BY_ID.get(c.seatId)?.zoneId }}）</strong>
                <div class="small-text muted">
                  {{ c.topColor }}上装 / {{ c.bottomColor }}下装 · 入场 {{ formatTime(c.admittedAt!) }} · {{ minutesAgo(c.admittedAt!, now) }} 分钟前
                </div>
                <div v-if="riskOf(c.id).high" class="small-text" style="color:var(--critical);margin-top:3px">
                  ⚠ 高风险：{{ riskOf(c.id).reasons.join('；') }}
                </div>
              </div>
              <span class="tag-pill pill-good">已入安全列表</span>
            </div>
          </template>
        </div>
      </div>

      <!-- 当场安全列表 -->
      <div class="card">
        <div class="card-title">
          <h2>🛡️ 当场演出儿童安全列表</h2>
          <span class="hint">《{{ store.show.name }}》 · 仅本场有效，演出结束归档</span>
        </div>
        <div style="overflow:auto;max-height:430px">
          <table class="tbl">
            <thead>
              <tr><th>昵称/年龄</th><th>座位</th><th>衣着特征</th><th>家长</th><th>看护</th><th>提示</th></tr>
            </thead>
            <tbody>
              <tr v-for="c in admitted" :key="c.id" :style="riskOf(c.id).high ? 'background:var(--critical-soft)' : ''">
                <td><strong>{{ c.nickname }}</strong><div class="muted">{{ c.age }}岁</div></td>
                <td class="mono">{{ c.seatId }}</td>
                <td style="max-width:150px">{{ c.topColor }}/{{ c.bottomColor }}<div class="muted" style="font-size:11px">{{ c.features || '—' }}</div></td>
                <td>{{ c.guardians.length }} 人</td>
                <td>
                  <span :class="c.temporaryCareAllowed ? 'tag-pill pill-good' : 'tag-pill pill-warn'">
                    {{ c.temporaryCareAllowed ? '可临看' : '须当面' }}
                  </span>
                </td>
                <td>
                  <span v-if="riskOf(c.id).high" class="tag-pill pill-critical">高风险</span>
                  <span v-else class="tag-pill pill-gray">常规</span>
                </td>
              </tr>
            </tbody>
          </table>
          <div v-if="!admitted.length" class="empty">尚无儿童通过闸机核验</div>
        </div>
      </div>
    </div>
  </div>
</template>
