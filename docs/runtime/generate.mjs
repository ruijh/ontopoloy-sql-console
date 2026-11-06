import {
  DOMAIN, METRICS, RULES, RULES_BY_GROUP, SQL_FACTS,
  VALUE_PROFILES, tableByName
} from './ontology.mjs'

const DIM_ALIAS = {
  category_name: 'category',
  brand_name: 'brand',
  shop_type: 'shop_type',
  channel_name: 'channel_group',
  brand_level: 'brand_level'
}

const METRIC_ALIAS = {
  gmv_paid: 'gmv',
  refund_rate: 'refund_rate',
  order_cnt: 'order_cnt',
  aov: 'aov',
  new_buyer_cnt: 'new_buyer_cnt',
  buyer_cnt: 'buyer_cnt'
}

function literal(actionSql) {
  const m = /'([^']*)'/.exec(actionSql)
  return m ? m[1] : ''
}

function caseFromRules(group, column, fallback) {
  const rules = (RULES_BY_GROUP[group] ?? [])
    .filter((r) => r.status === 'active' && r.branch_order > 0)
    .sort((a, b) => a.branch_order - b.branch_order)
  const branches = []
  for (const rule of rules) {
    if (rule.condition_sql === 'ELSE') continue
    const value = literal(rule.action_sql)
    if (!value) continue
    const condition = rule.condition_sql.replace(/\b(shop_name|channel_name)\b/g, 't.$1')
    branches.push(`WHEN ${condition} THEN '${value}'`)
  }
  return `CASE ${branches.join('\n       ')}\n       ELSE '${fallback}' END`
}

function dimensionExpr(dim, baseline) {
  if (baseline) {
    if (dim.id === 'shop_type') return 't.shop_name'
    if (dim.id === 'channel_name') return 't.channel_name'
    if (dim.id === 'category_name') return 't.category_name'
    return `t.${dim.id}`
  }
  switch (dim.id) {
    case 'category_name':
      return "COALESCE(t.category_name, '未分类')"
    case 'brand_name':
      return 't.brand_name'
    case 'shop_type':
      return caseFromRules('shop_type', 'shop_name', '其他')
    case 'channel_name':
      return caseFromRules('channel_group', 'channel_name', '其他')
    case 'brand_level':
      return "COALESCE(b.brand_level, '未分级')"
    default:
      return `t.${dim.id}`
  }
}

function dimensionAlias(dim) {
  return DIM_ALIAS[dim.id] ?? dim.id
}

function metricExpr(metricId, periodCond, baseline) {
  const c = periodCond
  if (baseline) {
    switch (metricId) {
      case 'refund_rate':
        return `ROUND(SUM(CASE WHEN ${c} THEN t.refund_amt ELSE 0 END) * 1.0 / NULLIF(SUM(CASE WHEN ${c} THEN t.pay_amt ELSE 0 END), 0), 4)`
      case 'order_cnt':
        return `SUM(CASE WHEN ${c} THEN t.order_cnt ELSE 0 END)`
      case 'aov':
        return `ROUND(SUM(CASE WHEN ${c} THEN t.pay_amt ELSE 0 END) * 1.0 / NULLIF(SUM(CASE WHEN ${c} THEN t.order_cnt ELSE 0 END), 0), 2)`
      case 'new_buyer_cnt':
        return `SUM(CASE WHEN ${c} THEN t.buyer_cnt ELSE 0 END)`
      case 'buyer_cnt':
        return `SUM(CASE WHEN ${c} THEN t.buyer_cnt ELSE 0 END)`
      default:
        return `SUM(CASE WHEN ${c} THEN t.pay_amt ELSE 0 END)`
    }
  }
  switch (metricId) {
    case 'gmv_paid':
      return `SUM(CASE WHEN ${c} AND t.is_refund = 0 THEN t.pay_amt ELSE 0 END)`
    case 'order_cnt':
      return `SUM(CASE WHEN ${c} AND t.is_refund = 0 THEN t.order_cnt ELSE 0 END)`
    case 'new_buyer_cnt':
      return `SUM(CASE WHEN ${c} AND t.is_refund = 0 THEN t.new_buyer_cnt ELSE 0 END)`
    case 'buyer_cnt':
      return `SUM(CASE WHEN ${c} AND t.is_refund = 0 THEN t.buyer_cnt ELSE 0 END)`
    case 'aov':
      return `ROUND(SUM(CASE WHEN ${c} AND t.is_refund = 0 THEN t.pay_amt ELSE 0 END) * 1.0 / NULLIF(SUM(CASE WHEN ${c} AND t.is_refund = 0 THEN t.order_cnt ELSE 0 END), 0), 2)`
    case 'refund_rate':
      return `ROUND(SUM(CASE WHEN ${c} THEN t.refund_amt ELSE 0 END) * 1.0 / NULLIF(SUM(CASE WHEN ${c} AND t.is_refund = 0 THEN t.pay_amt ELSE 0 END), 0), 4)`
    default:
      return `SUM(CASE WHEN ${c} AND t.is_refund = 0 THEN t.pay_amt ELSE 0 END)`
  }
}

function filterClause(filters) {
  return filters.map((f) => f.sql.replace(/^(\w+)/, 't.$1')).join('\n  AND ')
}

function usedRules(intent, baseline) {
  if (baseline) return []
  const groups = new Set(['valid_trade'])
  const dims = new Set(intent.dimensions.map((d) => d.id))
  if (dims.has('shop_type')) groups.add('shop_type')
  if (dims.has('channel_name')) groups.add('channel_group')
  if (dims.has('category_name')) groups.add('category_fallback')
  if (dims.has('brand_level')) groups.add('brand_level')
  if (intent.metrics.some((m) => m.id === 'new_buyer_cnt')) groups.add('new_buyer')
  groups.add('fiscal_calendar')
  return RULES.filter((r) => groups.has(r.case_group) && r.status === 'active')
    .sort((a, b) => a.case_group.localeCompare(b.case_group) || a.branch_order - b.branch_order)
}

/**
 * 生成只读 SQL，并返回生成所需证据。
 * baseline=true 模拟“没有本体”的对照组：表名对、字段在、语法可跑，但口径与规则缺失。
 */
export function generateSQL(intent, { baseline = false } = {}) {
  // 演示版支持同一聚合粒度上的最多两个指标；复杂跨粒度指标仍需拆查询。
  const metrics = intent.metrics.slice(0, 2)
  const metricAlias = METRIC_ALIAS[metrics[0].id] ?? 'metric_value'
  const dims = intent.dimensions.slice(0, 3)
  const time = intent.time_range
  const compare = Boolean(intent.comparison && time.compare_start && time.compare_end)
  const dimSelects = dims.map((dim) => `${dimensionExpr(dim, baseline)} AS ${dimensionAlias(dim)}`)
  const dimAliases = dims.map((dim) => dimensionAlias(dim))

  const currentCond = `t.dt BETWEEN '${time.start}' AND '${time.end}'`
  let where
  if (compare) {
    where = `(${currentCond} OR t.dt BETWEEN '${time.compare_start}' AND '${time.compare_end}')`
  } else {
    where = currentCond
  }
  const filters = filterClause(intent.filters)
  if (filters) where += `\n  AND ${filters}`

  const metricSelects = []
  const metricAliases = []
  const comparisonAliases = []
  const share = intent.comparisons.some((c) => c.type === 'share')
  for (const metric of metrics) {
    const alias = METRIC_ALIAS[metric.id] ?? 'metric_value'
    metricAliases.push(alias)
    const decimals = metric.id === 'refund_rate' ? 4 : 2
    const expr = metricExpr(metric.id, currentCond, baseline)
    if (compare) {
      const prev = metricExpr(metric.id, `t.dt BETWEEN '${time.compare_start}' AND '${time.compare_end}'`, baseline)
      const suffix = intent.comparison === 'yoy' ? 'yoy_pct' : 'mom_pct'
      const cAlias = `${alias}_${suffix}`
      comparisonAliases.push(cAlias)
      metricSelects.push(`ROUND(${expr}, ${decimals}) AS ${alias}`)
      metricSelects.push(`ROUND((${expr} - ${prev}) * 100.0 / NULLIF(${prev}, 0), 2) AS ${cAlias}`)
    } else if (share) {
      metricSelects.push(`ROUND(${expr}, ${decimals}) AS ${alias}`)
      metricSelects.push(`ROUND(${expr} * 100.0 / SUM(${expr}) OVER (), 2) AS ${alias}_share_pct`)
    } else {
      metricSelects.push(`ROUND(${expr}, ${decimals}) AS ${alias}`)
    }
  }
  // 兼容单指标消费者：首个指标 / 首个对比列。
  const comparisonAlias = comparisonAliases[0] ?? null
  const metricSelect = metricSelects.join(',\n  ')

  const needBrandDim = dims.some((d) => d.id === 'brand_level') && !baseline
  const joins = needBrandDim ? '\nLEFT JOIN dim_brand b ON t.brand_id = b.brand_id' : ''
  const groupBy = dims.map((_, index) => index + 1).join(', ')
  const sql = `SELECT
  ${dimSelects.join(',\n  ')},
  ${metricSelect}
FROM dws_brand_trade_m t${joins}
WHERE ${where}
GROUP BY ${groupBy}
ORDER BY ${metricAlias} DESC
LIMIT ${intent.top_n}`

  const rules = usedRules(intent, baseline)
  const tables = ['dws_brand_trade_m', ...(needBrandDim ? ['dim_brand'] : [])]
  return {
    sql,
    dialect: 'hive',
    engine_dialect: 'sqlite-demo',
    tables,
    output_columns: [...dimAliases, ...metricSelects.map((part) => /\bAS\s+(\w+)\s*$/i.exec(part)?.[1]).filter(Boolean)],
    dim_aliases: dimAliases,
    metric_alias: metricAlias,
    metric_aliases: metricAliases,
    comparison_alias: comparisonAlias,
    comparison_aliases: comparisonAliases,
    rules: rules.map((r) => ({ id: r.id, case_group: r.case_group, title: r.name, fingerprint: r.fingerprint })),
    baseline,
    generated_at: new Date().toISOString()
  }
}

export function buildCitations(intent, recallResult, generation) {
  const citations = []
  for (const requested of intent.metrics) {
    const metric = METRICS.find((m) => m.id === requested.id)
    if (!metric) continue
    citations.push({
      type: 'metric', id: metric.id, title: metric.name,
      detail: `${metric.definition} 公式：${metric.formula}`,
      source: 'R4', route_weight: 1.2
    })
  }
  for (const rule of generation.rules) {
    const full = RULES.find((r) => r.id === rule.id)
    citations.push({
      type: 'rule', id: rule.id, title: rule.title,
      detail: `${full.condition_sql} ${full.action_sql} · ${full.evidence_sql_node}`,
      fingerprint: rule.fingerprint, source: 'R5', route_weight: 1.4
    })
  }
  for (const table of generation.tables) {
    const t = tableByName(table)
    citations.push({
      type: 'table', id: table, title: table,
      detail: `${t.role} · ${t.grain}`,
      source: 'R1', route_weight: 1.0
    })
  }
  for (const dim of intent.dimensions) {
    const fieldName = dim.id === 'shop_type' ? 'shop_name' : dim.id
    const field = tableByName('dws_brand_trade_m').fields.find((f) => f.name === fieldName)
    if (field && !generation.baseline) {
      citations.push({
        type: 'field', id: fieldName, title: `${field.semantic}（${fieldName}）`,
        detail: field.meaning, source: 'R1', route_weight: 1.0
      })
    }
  }
  for (const profile of VALUE_PROFILES) {
    if (intent.dimensions.some((d) => d.id === profile.field) && !generation.baseline) {
      citations.push({
        type: 'evidence', id: `${profile.table}.${profile.field}`,
        title: `${profile.field} 值分布`,
        detail: profile.values.slice(0, 4).map((v) => `${v.value} ${v.pct}%`).join(' / '),
        source: 'R7', route_weight: 1.0
      })
    }
  }
  // 去重，保留首次出现（指标/规则优先）。
  const seen = new Set()
  return citations.filter((c) => {
    const key = `${c.type}:${c.id}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function buildAssumptions(intent) {
  const list = [...intent.ambiguities]
  list.push('演示数据截至 2026-11-06，本月为不完整月')
  list.push('金额单位：元；比率保留 4 位小数，展示时转为百分比')
  return list
}

export function buildWarnings(intent, validation) {
  const warnings = []
  if (!validation.ok) warnings.push('存在未通过的校验项，结果按 fail-closed 处理')
  if (intent.comparison === 'yoy') warnings.push('同比基期与本期分区均需扫描，成本高于单期查询')
  return warnings
}

export function lineageFor(tables) {
  return SQL_FACTS.filter((fact) => fact.tags.some((tag) => tables.includes(tag) || tables.some((t) => t.includes(tag))))
}
