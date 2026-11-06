import { explain } from './db.mjs?v=ontsql-20261106-3'
import { DOMAIN, RULES, TABLES } from './ontology.mjs?v=ontsql-20261106-3'

const FORBIDDEN = /\b(insert|update|delete|drop|alter|create|truncate|merge|grant|revoke|call|copy)\b/i
const TABLE_NAMES = new Set(TABLES.map((t) => t.name))

function tablesIn(sql) {
  const found = new Set()
  const re = /\b(?:FROM|JOIN)\s+([a-zA-Z_][\w.]*)/gi
  let m
  while ((m = re.exec(sql)) !== null) {
    const name = m[1].split('.').pop()
    if (!['select', 'where', 'group', 'order', 'limit'].includes(name.toLowerCase())) found.add(name)
  }
  return found
}

function semicolons(sql) {
  return (sql.match(/;/g) ?? []).length
}

function dateBounds(sql) {
  const dates = [...sql.matchAll(/'(\d{4}-\d{2}-\d{2})'/g)].map((m) => m[1])
  if (dates.length < 2) return { ok: false, detail: '未找到完整分区日期范围' }
  const sorted = [...dates].sort()
  const start = sorted[0]
  const end = sorted[sorted.length - 1]
  const inRange = dates.every((d) => d >= '2025-01-01' && d <= '2026-12-31')
  return { ok: inRange && start <= end, start, end, detail: `${start} ~ ${end}` }
}

/**
 * 12 项确定性校验：任何一项失败都不能把结果当“可交付 SQL”。
 * 这里不调用 LLM，避免“模型自证正确”。
 */
export function validateSQL(sql, intent, generation, recallResult) {
  const checks = []
  const push = (id, label, pass, detail) => checks.push({ id, label, pass, detail })

  push('V01', '只读语句', !FORBIDDEN.test(sql), FORBIDDEN.test(sql) ? '检测到写操作关键字' : '仅 SELECT / CASE / 聚合')
  push('V02', '单条语句', semicolons(sql) === 0, `${semicolons(sql)} 个分号（生成器不追加分号）`)

  const parsed = explain(sql)
  push('V03', '语法可解析', parsed.ok, parsed.ok ? `SQLite prepare 通过，输出 ${parsed.columns.length} 列` : parsed.error)

  const tables = tablesIn(sql)
  const unknown = [...tables].filter((t) => !TABLE_NAMES.has(t))
  push('V04', '表白名单', unknown.length === 0, unknown.length ? `未知表：${unknown.join(', ')}` : [...tables].join('、'))

  const hasPartition = /\bdt\b\s*(BETWEEN|=|IN)\b/i.test(sql)
  push('V05', '分区过滤', hasPartition, hasPartition ? 'dt 谓词已命中' : '缺少 dt 分区谓词，禁止全表扫描')

  const caliberIssues = []
  const caliberNotes = []
  for (const metric of intent.metrics) {
    if (['gmv_paid', 'order_cnt', 'aov', 'new_buyer_cnt', 'buyer_cnt'].includes(metric.id)) {
      if (!/\bis_refund\s*=\s*0\b/i.test(sql)) {
        caliberIssues.push(`${metric.name} 缺少 is_refund = 0`)
      } else {
        caliberNotes.push(`${metric.name} 已剔除退款`)
      }
    }
    if (metric.id === 'refund_rate') {
      if (!(/\brefund_amt\b/i.test(sql) && /\bNULLIF\s*\(/i.test(sql))) {
        caliberIssues.push('退款率缺少 refund_amt 或 NULLIF 保护')
      } else {
        caliberNotes.push('退款率分子/分母与零分母保护齐全')
      }
    }
    if (metric.id === 'new_buyer_cnt') {
      if (!/\bnew_buyer_cnt\b/i.test(sql)) {
        caliberIssues.push('新客数误用了 buyer_cnt')
      } else {
        caliberNotes.push('使用 new_buyer_cnt')
      }
    }
  }
  push('V06', '指标口径', caliberIssues.length === 0,
    caliberIssues.length ? [...new Set(caliberIssues)].join('；') : [...new Set(caliberNotes)].join('；') || '指标表达式符合本体')

  const requiredGroups = new Set()
  for (const dim of intent.dimensions) {
    if (dim.id === 'shop_type') requiredGroups.add('shop_type')
    if (dim.id === 'channel_name') requiredGroups.add('channel_group')
  }
  const ruleGroups = new Set(generation.rules.map((r) => r.case_group))
  const missingRules = [...requiredGroups].filter((g) => !ruleGroups.has(g))
  push('V07', '规则分支引用', missingRules.length === 0,
    missingRules.length ? `缺少规则：${missingRules.join(', ')}` : requiredGroups.size ? [...requiredGroups].join('、') : '本题无需 CASE 规则')

  const hasLimit = /\bLIMIT\s+\d+/i.test(sql)
  push('V08', '结果上限', hasLimit, hasLimit ? `LIMIT ${intent.top_n}` : '缺少 LIMIT')

  const pii = /\b(buyer_id|phone|mobile|id_card|email)\b/i.test(sql)
  push('V09', 'PII 最小化', !pii, pii ? '查询触及敏感字段' : '未选择敏感字段')

  const bounds = dateBounds(sql)
  push('V10', '时间边界', bounds.ok, bounds.detail)

  const fpOk = generation.rules.every((rule) => {
    const source = RULES.find((r) => r.id === rule.id)
    return source && source.fingerprint === rule.fingerprint && /^[0-9a-f]{16}$/.test(rule.fingerprint)
  })
  push('V11', '规则指纹', fpOk, fpOk ? `${generation.rules.length} 条规则指纹与本体一致` : '规则指纹不匹配，可能被模型改写')

  const packOk = Boolean(recallResult?.pack?.pack_id && recallResult.coverage.routes_hit >= 6)
  push('V12', '上下文可回溯', packOk, packOk ? `pack ${recallResult.pack.pack_id}，${recallResult.coverage.routes_hit}/7 路由命中` : '上下文包不完整')

  const failed = checks.filter((c) => !c.pass)
  return {
    ok: failed.length === 0,
    fail_closed: failed.length > 0,
    checks,
    failed: failed.map((c) => c.id),
    version: DOMAIN.version
  }
}
