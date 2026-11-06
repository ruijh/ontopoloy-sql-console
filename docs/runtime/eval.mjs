import { DOMAIN } from './ontology.mjs'
import { query, explain } from './db-browser.mjs'
import { parseIntent } from './intent.mjs'
import { recall } from './recall.mjs'
import { generateSQL } from './generate.mjs'
import { validateSQL } from './validate.mjs'

export const EVAL_CASES = [
  { id: 'E01', question: '上月各品类成交额', groups: [], layer: '聚合', difficulty: 'easy' },
  { id: 'E02', question: '上月各品牌成交额 top 3', groups: [], layer: 'TopN', difficulty: 'easy' },
  { id: 'E03', question: '上月各店铺类型成交额', groups: ['shop_type'], layer: '规则分支', difficulty: 'hard' },
  { id: 'E04', question: '上月各渠道退款率', groups: ['channel_group'], layer: '比率口径', difficulty: 'hard' },
  { id: 'E05', question: '上月各品类客单价', groups: [], layer: '派生指标', difficulty: 'medium' },
  { id: 'E06', question: '上月各渠道新客数', groups: ['channel_group', 'new_buyer'], layer: '字段语义', difficulty: 'hard' },
  { id: 'E07', question: '上月各品类成交额同比', groups: [], layer: '时间对比', difficulty: 'medium' },
  { id: 'E08', question: '上月各店铺类型成交额同比', groups: ['shop_type'], layer: '规则+对比', difficulty: 'hard' }
]

function f1(expected, actual) {
  const e = new Set(expected)
  const a = new Set(actual)
  if (e.size === 0 && a.size === 0) return 1
  if (e.size === 0 || a.size === 0) return 0
  let inter = 0
  for (const x of e) if (a.has(x)) inter += 1
  const precision = inter / a.size
  const recall = inter / e.size
  if (precision + recall === 0) return 0
  return (2 * precision * recall) / (precision + recall)
}

function caliberOk(intent, sql) {
  return intent.metrics.every((metric) => {
    if (['gmv_paid', 'order_cnt', 'aov', 'new_buyer_cnt', 'buyer_cnt'].includes(metric.id)) {
      return /\bis_refund\s*=\s*0\b/i.test(sql)
    }
    if (metric.id === 'refund_rate') return /\brefund_amt\b/i.test(sql) && /NULLIF\s*\(/i.test(sql)
    if (metric.id === 'new_buyer_cnt') return /\bnew_buyer_cnt\b/i.test(sql)
    return true
  })
}

function compareResults(gt, cand) {
  if (gt.columns.length !== cand.columns.length) {
    return { score: 0, reason: `结果列数不一致：${gt.columns.join(',')} vs ${cand.columns.join(',')}` }
  }
  if (gt.rows.length !== cand.rows.length) {
    return { score: 0, reason: `行数不一致：${gt.rows.length} vs ${cand.rows.length}` }
  }
  if (gt.rows.length === 0) return { score: 10, reason: '双方均为空' }
  let bad = 0
  for (let i = 0; i < gt.rows.length; i += 1) {
    const a = gt.rows[i]
    const b = cand.rows[i]
    for (let j = 0; j < gt.columns.length; j += 1) {
      const av = a[gt.columns[j]]
      const bv = b[cand.columns[j]]
      const same = typeof av === 'number' && typeof bv === 'number'
        ? Math.abs(av - bv) < 0.011
        : String(av) === String(bv)
      if (!same) { bad += 1; break }
    }
  }
  const score = Math.round(10 * (1 - bad / gt.rows.length) * 10) / 10
  return { score, reason: bad === 0 ? '逐行逐列一致' : `${bad}/${gt.rows.length} 行不一致` }
}

function scoreCase(testCase, baseline) {
  const intent = parseIntent(testCase.question)
  const pack = recall(testCase.question, intent)
  const gtGen = generateSQL(intent)
  const candGen = generateSQL(intent, { baseline })
  const gt = query(gtGen.sql)
  const cand = query(candGen.sql)
  const validation = validateSQL(candGen.sql, intent, candGen, pack)
  const parsed = explain(candGen.sql)

  const syntax = parsed.ok ? 10 : 0
  const tableF1 = f1(gtGen.tables, candGen.tables)
  const table = Math.round(20 * tableF1 * 10) / 10
  const fieldF1 = f1(gtGen.output_columns, candGen.output_columns)
  const caliber = caliberOk(intent, candGen.sql) ? 8 : 0
  const field = Math.round((12 * fieldF1 + caliber) * 10) / 10

  const expectedGroups = testCase.groups
  const actualGroups = [...new Set(candGen.rules.map((r) => r.case_group))]
  const hitGroups = expectedGroups.filter((g) => actualGroups.includes(g))
  const rule = expectedGroups.length === 0 ? 40 : Math.round((40 * hitGroups.length / expectedGroups.length) * 10) / 10

  const dataCompare = compareResults(gt, cand)
  const data = dataCompare.score
  const total = Math.round((syntax + table + field + rule + data) * 10) / 10
  const passed = total >= 80
  const strict = passed && rule === 40 && data === 10

  const missing = expectedGroups.filter((g) => !actualGroups.includes(g))
  const attribution = []
  if (!parsed.ok) attribution.push('SQL 语法/字段解析')
  if (table < 20) attribution.push('表召回错误')
  if (field < 20) attribution.push('字段语义/口径错误')
  if (missing.length) attribution.push(`规则缺失：${missing.join('、')}`)
  if (data < 10) attribution.push(dataCompare.reason)
  if (attribution.length === 0) attribution.push('通过')

  return {
    id: testCase.id,
    question: testCase.question,
    layer: testCase.layer,
    difficulty: testCase.difficulty,
    scores: { syntax, table, field, rule, data },
    total,
    pass: passed,
    strict_pass: strict,
    attribution,
    expected: {
      tables: gtGen.tables,
      columns: gtGen.output_columns,
      groups: expectedGroups,
      rule_count: gtGen.rules.length
    },
    candidate: {
      sql: candGen.sql,
      tables: candGen.tables,
      columns: candGen.output_columns,
      groups: actualGroups,
      validation_ok: validation.ok,
      failed_checks: validation.failed,
      row_count: cand.row_count,
      elapsed_ms: cand.ms
    },
    gt_row_count: gt.row_count,
    data_reason: dataCompare.reason,
    dimensions: {
      syntax: 10, table: 20, field: 20, rule: 40, data: 10
    }
  }
}

function evaluateMode(baseline) {
  const cases = EVAL_CASES.map((testCase) => scoreCase(testCase, baseline))
  const sum = (key) => Math.round(cases.reduce((acc, c) => acc + c.scores[key], 0) * 10) / 10
  const passed = cases.filter((c) => c.pass).length
  const strict = cases.filter((c) => c.strict_pass).length
  const total = Math.round(cases.reduce((acc, c) => acc + c.total, 0) / cases.length * 10) / 10
  return {
    mode: baseline ? 'baseline' : 'ontology',
    label: baseline ? '无本体 baseline' : '本体增强',
    cases,
    summary: {
      passed, strict_passed: strict, total: cases.length,
      avg_score: total,
      layers: { syntax: sum('syntax'), table: sum('table'), field: sum('field'), rule: sum('rule'), data: sum('data') }
    }
  }
}

let cache = null

export function runEvaluation({ refresh = false } = {}) {
  if (cache && !refresh) return cache
  const started = Date.now()
  const ontology = evaluateMode(false)
  const baseline = evaluateMode(true)
  const delta = Math.round((ontology.summary.avg_score - baseline.summary.avg_score) * 10) / 10
  cache = {
    version: DOMAIN.version,
    run_at: new Date().toISOString(),
    duration_ms: Date.now() - started,
    anti_leak: 'GT 只在评分进程内生成，不回灌候选上下文；候选侧只看到意图与召回包',
    ontology,
    baseline,
    comparison: {
      pass_delta: ontology.summary.passed - baseline.summary.passed,
      avg_delta: delta,
      rule_layer_delta: Math.round((ontology.summary.layers.rule - baseline.summary.layers.rule) * 10) / 10,
      data_layer_delta: Math.round((ontology.summary.layers.data - baseline.summary.layers.data) * 10) / 10
    }
  }
  return cache
}
