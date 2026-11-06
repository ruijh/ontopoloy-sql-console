import { DOMAIN, METRICS } from './ontology.mjs'
import { TODAY } from './db-browser.mjs'

const DIMENSIONS = [
  { id: 'category_name', label: '品类', aliases: ['品类', '类目', '分类', '各品类'] },
  { id: 'brand_name', label: '品牌', aliases: ['品牌', '各品牌'] },
  { id: 'shop_type', label: '店铺类型', aliases: ['店铺类型', '店型', '店铺', '各店铺'] },
  { id: 'channel_name', label: '渠道', aliases: ['渠道', '各渠道'] },
  { id: 'brand_level', label: '品牌等级', aliases: ['品牌等级', '品牌分层', '品牌档位'] }
]

const METRIC_ALIASES = METRICS
  .flatMap((metric) => metric.aliases.map((alias) => ({ alias, metric })))
  .sort((a, b) => b.alias.length - a.alias.length)

function pad(n) {
  return String(n).padStart(2, '0')
}

function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

function monthRange(year, month) {
  return {
    start: `${year}-${pad(month)}-01`,
    end: `${year}-${pad(month)}-${pad(daysInMonth(year, month))}`
  }
}

function addDays(date, n) {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

function shiftMonth(year, month, delta) {
  const idx = year * 12 + (month - 1) + delta
  return { year: Math.floor(idx / 12), month: (idx % 12) + 1 }
}

function parseTime(question) {
  const now = new Date(`${TODAY}T00:00:00Z`)
  const currentYear = now.getUTCFullYear()
  const currentMonth = now.getUTCMonth() + 1
  const explicit = /(\d{4})\s*年\s*(\d{1,2})\s*月/.exec(question)
  if (explicit) {
    const y = Number(explicit[1])
    const m = Number(explicit[2])
    const range = monthRange(y, m)
    return { ...range, label: `${y} 年 ${m} 月`, kind: 'month' }
  }

  if (question.includes('上月')) {
    const { year, month } = shiftMonth(currentYear, currentMonth, -1)
    return { ...monthRange(year, month), label: `${year} 年 ${month} 月（上月）`, kind: 'month' }
  }
  if (question.includes('本月')) {
    return {
      ...monthRange(currentYear, currentMonth),
      label: `${currentYear} 年 ${currentMonth} 月（本月，截至 ${TODAY}）`,
      kind: 'month'
    }
  }
  if (question.includes('近7天') || question.includes('近 7 天') || question.includes('过去7天')) {
    return { start: addDays(TODAY, -6), end: TODAY, label: '近 7 天', kind: 'rolling' }
  }
  if (question.includes('近30天') || question.includes('近 30 天') || question.includes('过去30天')) {
    return { start: addDays(TODAY, -29), end: TODAY, label: '近 30 天', kind: 'rolling' }
  }
  if (question.includes('昨天')) {
    const day = addDays(TODAY, -1)
    return { start: day, end: day, label: '昨天', kind: 'day' }
  }
  const { year, month } = shiftMonth(currentYear, currentMonth, -1)
  return { ...monthRange(year, month), label: `${year} 年 ${month} 月（默认上月）`, kind: 'default' }
}

function compareRange(time, comparison) {
  if (comparison === 'yoy') {
    if (time.kind === 'day') return { start: addDays(time.start, -365), end: addDays(time.end, -365), label: '去年同期' }
    const y = Number(time.start.slice(0, 4)) - 1
    const m = Number(time.start.slice(5, 7))
    const r = monthRange(y, m)
    return { ...r, label: `${y} 年 ${m} 月（去年同期）` }
  }
  if (comparison === 'mom') {
    if (time.kind === 'day') {
      return { start: addDays(time.start, -1), end: addDays(time.end, -1), label: '前一日' }
    }
    const y = Number(time.start.slice(0, 4))
    const m = Number(time.start.slice(5, 7))
    const prev = shiftMonth(y, m, -1)
    const r = monthRange(prev.year, prev.month)
    return { ...r, label: `${prev.year} 年 ${prev.month} 月（上期）` }
  }
  return null
}

function detectDimensions(question) {
  const hits = []
  for (const dim of DIMENSIONS) {
    if (dim.aliases.some((alias) => question.includes(alias))) hits.push(dim)
  }
  // “各店铺类型”同时命中“店铺”和“店铺类型”，只保留更具体的那个。
  if (hits.some((d) => d.id === 'shop_type')) return hits.filter((d) => d.id !== 'brand_name' || question.includes('品牌'))
  return hits
}

function detectMetrics(question) {
  const found = []
  const consumed = []
  for (const { alias, metric } of METRIC_ALIASES) {
    if (!question.includes(alias)) continue
    if (consumed.some((part) => part.includes(alias) || alias.includes(part))) continue
    if (!found.some((m) => m.id === metric.id)) found.push(metric)
    consumed.push(alias)
  }
  return found
}

function detectFilters(question) {
  const filters = []
  const channels = ['天猫', '淘宝', '京东', '抖音', '快手', '拼多多']
  for (const channel of channels) {
    if (question.includes(channel)) {
      filters.push({ label: `渠道 = ${channel}`, sql: `channel_name = '${channel}'` })
      break
    }
  }
  for (const category of ['美妆', '服饰', '食品', '家居']) {
    if (question.includes(category)) {
      filters.push({ label: `品类 = ${category}`, sql: `category_name = '${category}'` })
      break
    }
  }
  for (const brand of ['花漾', '山野', '初见', '北纬', '云栖', '拾光']) {
    if (question.includes(brand)) {
      filters.push({ label: `品牌 = ${brand}`, sql: `brand_name = '${brand}'` })
      break
    }
  }
  return filters
}

function parseLimit(question) {
  const top = /(?:top|TOP|前)\s*(\d+)/.exec(question)
  if (top) return Math.min(50, Math.max(1, Number(top[1])))
  if (question.includes('排名') || question.includes('排行') || question.includes('top')) return 10
  return 10
}

/**
 * 轻量意图解析：演示版不调用 LLM，用词典 + 时间解析保证确定性。
 * 生产实现见方案 §5.1，这一步会输出 IntentSpec 并经过 schema 校验。
 */
export function parseIntent(question) {
  const text = String(question ?? '').trim()
  if (!text) throw new Error('问题不能为空')

  const metrics = detectMetrics(text)
  let dimensions = detectDimensions(text)
  const comparisons = []
  if (text.includes('同比') || text.includes('年同比')) comparisons.push({ type: 'yoy', label: '同比' })
  if (text.includes('环比') || text.includes('月环比')) comparisons.push({ type: 'mom', label: '环比' })
  if (text.includes('占比')) comparisons.push({ type: 'share', label: '占比' })

  if (metrics.length === 0) metrics.push(METRICS.find((m) => m.id === 'gmv_paid'))
  if (dimensions.length === 0) dimensions.push(DIMENSIONS.find((d) => d.id === 'category_name'))

  // 同一指标 + 同一维度多次命中只保留一次。
  const seen = new Set()
  dimensions = dimensions.filter((d) => (seen.has(d.id) ? false : seen.add(d.id)))

  const time = parseTime(text)
  const comparison = comparisons[0] ?? null
  const compare = comparison ? compareRange(time, comparison.type) : null
  const filters = detectFilters(text)

  const ambiguities = []
  if (!detectMetrics(text).length) ambiguities.push('未显式指定指标，按「成交额（实付）」处理')
  if (time.kind === 'default') ambiguities.push('未显式指定时间，按「上月」处理')
  if (comparisons.some((c) => c.type === 'share')) ambiguities.push('“占比”将按当前分组内的指标占比计算，分母为总计')

  return {
    question: text,
    domain: DOMAIN.id,
    task: 'aggregate',
    metrics: metrics.slice(0, 2).map((m) => ({ id: m.id, name: m.name, unit: m.unit })),
    dimensions: dimensions.map((d) => ({ id: d.id, label: d.label })),
    filters,
    comparisons,
    comparison: comparison?.type ?? null,
    comparison_label: comparison?.label ?? null,
    time_range: {
      ...time,
      compare_start: compare?.start ?? null,
      compare_end: compare?.end ?? null,
      compare_label: compare?.label ?? null
    },
    top_n: parseLimit(text),
    ambiguities,
    confidence: ambiguities.length > 1 ? 0.72 : ambiguities.length === 1 ? 0.84 : 0.93
  }
}
