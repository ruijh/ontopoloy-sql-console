import { createHash } from './crypto-shim.mjs'
import {
  DOMAIN, LINEAGE, METRICS, RULES, RULES_BY_GROUP, SQL_FACTS,
  TABLES, VALUE_PROFILES, tableByName
} from './ontology.mjs'

export const ROUTES = [
  { id: 'R1', name: '表/字段语义', weight: 1.0, quota: 800, icon: 'semantic' },
  { id: 'R2', name: '同域表族', weight: 0.7, quota: 400, icon: 'family' },
  { id: 'R3', name: '血缘邻接', weight: 0.8, quota: 600, icon: 'lineage' },
  { id: 'R4', name: '指标口径', weight: 1.2, quota: 600, icon: 'metric' },
  { id: 'R5', name: '规则三元组', weight: 1.4, quota: 3000, icon: 'rule' },
  { id: 'R6', name: '历史 SQL', weight: 0.6, quota: 1800, icon: 'sql' },
  { id: 'R7', name: '生产证据', weight: 1.0, quota: 1500, icon: 'evidence' }
]

const BUDGET = 9000
const HARD_CAP = 12000

function tokensOf(value) {
  const raw = typeof value === 'string' ? value : JSON.stringify(value)
  return Math.max(18, Math.ceil(raw.length / 1.7))
}

function mkItem(route, id, kind, title, detail, rank, extra = {}) {
  const item = { id, kind, title, detail, route, rank, tokens: tokensOf(detail) + 12, ...extra }
  return item
}

function hasAny(text, words) {
  return words.some((word) => text.includes(word))
}

function relevantGroups(intent) {
  const groups = new Set(['valid_trade'])
  const dims = new Set(intent.dimensions.map((d) => d.id))
  if (dims.has('shop_type')) groups.add('shop_type')
  if (dims.has('channel_name')) groups.add('channel_group')
  if (intent.metrics.some((m) => m.id === 'new_buyer_cnt')) groups.add('new_buyer')
  if (dims.has('category_name')) groups.add('category_fallback')
  if (dims.has('brand_level')) groups.add('brand_level')
  groups.add('fiscal_calendar')
  return groups
}

function relevantProfiles(intent) {
  const fields = new Set()
  for (const dim of intent.dimensions) {
    if (dim.id === 'shop_type') fields.add('shop_name')
    if (dim.id === 'channel_name') fields.add('channel_name')
    if (dim.id === 'category_name') fields.add('category_name')
    if (dim.id === 'brand_level') fields.add('brand_level')
  }
  return VALUE_PROFILES.filter((p) => fields.has(p.field))
}

function searchTables(question, intent) {
  const labels = intent.dimensions.map((d) => d.label)
  const metrics = intent.metrics.map((m) => m.name)
  return TABLES.map((table) => {
    let score = 0
    if (table.role === 'delivery') score += 4
    if (intent.metrics.some((m) => METRICS.find((x) => x.id === m.id)?.source_tables.includes(table.name))) score += 5
    if (labels.some((label) => table.description.includes(label))) score += 2
    if (questionsFields(table, labels)) score += 2
    if (question.includes(table.name)) score += 6
    if (metrics.some((m) => table.description.includes(m))) score += 2
    return { table, score }
  }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score || a.table.name.localeCompare(b.table.name)).slice(0, 6)
}

function questionsFields(table, labels) {
  return table.fields.some((f) => labels.some((label) => f.semantic.includes(label) || f.meaning.includes(label)))
}

export function recall(question, intent) {
  const base = 'dws_brand_trade_m'
  const routeItems = new Map()
  const add = (routeId, items) => routeItems.set(routeId, items.slice(0, 30))

  // R1：表 / 字段语义召回，主表必须命中。
  const tableHits = searchTables(question, intent)
  const r1 = []
  const seenTables = new Set()
  for (const { table } of tableHits) {
    seenTables.add(table.name)
    r1.push(mkItem('R1', `table:${table.name}`, 'table', table.name,
      `${table.role} · ${table.grain}；${table.description}`, r1.length + 1))
  }
  if (!seenTables.has(base)) {
    const table = tableByName(base)
    r1.unshift(mkItem('R1', `table:${base}`, 'table', base, `${table.role} · ${table.grain}；${table.description}`, 1))
  }
  if (seenTables.has(base)) {
    const idx = r1.findIndex((item) => item.id === `table:${base}`)
    if (idx > 0) r1.unshift(r1.splice(idx, 1)[0])
  }
  for (const dim of intent.dimensions) {
    const column = dim.id === 'shop_type' ? 'shop_name' : dim.id
    const field = tableByName(base).fields.find((f) => f.name === column)
    if (field) {
      r1.push(mkItem('R1', `field:${column}`, 'field', `${base}.${column}`,
        `${field.semantic}：${field.meaning}`, r1.length + 1))
    }
  }
  r1.forEach((item, index) => { item.rank = index + 1 })
  add('R1', r1)

  // R2：同域表族，补齐维表与临近事实表。
  const r2 = TABLES.filter((t) => t.name !== base && ['dim', 'application'].includes(t.role))
    .map((table, index) => mkItem('R2', `table:${table.name}`, 'table', `${table.name} · ${table.role}`,
      `${table.grain}；${table.description}`, index + 1))
  add('R2', r2)

  // R3：沿血缘 BFS 两跳内，带上作业与延迟。
  const r3 = []
  for (const edge of LINEAGE) {
    if (edge.from === base || edge.to === base) {
      r3.push(mkItem('R3', `lineage:${edge.from}->${edge.to}`, 'lineage', `${edge.from} → ${edge.to}`,
        `${edge.op} · job ${edge.job} · ${edge.lag}`, r3.length + 1))
    }
  }
  add('R3', r3)

  // R4：指标口径；命中指标排前，相关派生指标排后。
  const r4 = []
  for (const metric of intent.metrics) {
    const m = METRICS.find((x) => x.id === metric.id)
    if (m) r4.push(mkItem('R4', `metric:${m.id}`, 'metric', m.name, `${m.definition} 公式：${m.formula}`, r4.length + 1))
  }
  for (const m of METRICS) {
    if (!intent.metrics.some((x) => x.id === m.id) && r4.length < 5) {
      r4.push(mkItem('R4', `metric:${m.id}`, 'metric', m.name, `${m.definition} 公式：${m.formula}`, r4.length + 1))
    }
  }
  add('R4', r4)

  // R5：规则三元组，按业务相关性与 branch_order 排序。
  const groups = relevantGroups(intent)
  const groupOrder = ['shop_type', 'channel_group', 'new_buyer', 'valid_trade', 'category_fallback', 'brand_level', 'fiscal_calendar']
  const r5 = []
  for (const group of groupOrder) {
    if (!groups.has(group)) continue
    for (const rule of (RULES_BY_GROUP[group] ?? []).sort((a, b) => a.branch_order - b.branch_order)) {
      if (rule.status !== 'active') continue
      const detail = `${rule.condition_sql} ${rule.action_sql}；证据 ${rule.evidence_sql_node}；fp ${rule.fingerprint}`
      r5.push(mkItem('R5', `rule:${rule.id}`, 'rule', rule.name, detail, r5.length + 1, {
        rule_id: rule.id, case_group: group, fingerprint: rule.fingerprint
      }))
    }
  }
  add('R5', r5)

  // R6：历史 SQL 惯用法，按标签/标题与问题重叠度召回。
  const r6 = SQL_FACTS.map((fact, index) => {
    const overlap = [fact.title, ...fact.tags].filter((tag) => question.includes(tag) || intent.metrics.some((m) => m.name === tag)).length
    return { fact, score: overlap, index }
  }).sort((a, b) => b.score - a.score || a.index - b.index).slice(0, 3)
    .map(({ fact }, index) => mkItem('R6', `sql:${fact.id}`, 'sql', fact.title,
      `${fact.snippet.replace(/\n/g, ' ')}；owner ${fact.owner}；hash ${fact.hash}`, index + 1))
  add('R6', r6)

  // R7：生产证据（值分布），只给材料，不直接给硬规则。
  const r7 = []
  for (const profile of relevantProfiles(intent)) {
    const values = profile.values.map((v) => `${v.value} ${v.pct}%`).join(' / ')
    r7.push(mkItem('R7', `value:${profile.table}.${profile.field}`, 'evidence', `${profile.field} 值分布`,
      `${profile.table}.${profile.field}：${values}`, r7.length + 1))
  }
  add('R7', r7)

  // 加权 RRF：score = Σ w_r / (60 + rank)。
  const merged = new Map()
  const routeReports = []
  for (const route of ROUTES) {
    const items = routeItems.get(route.id) ?? []
    let used = 0
    const packed = []
    for (const item of items) {
      if (used + item.tokens > route.quota && packed.length > 0) continue
      used += item.tokens
      packed.push(item)
      const key = item.id
      if (!merged.has(key)) {
        merged.set(key, {
          id: item.id, kind: item.kind, title: item.title, detail: item.detail,
          tokens: item.tokens, routes: [], contributions: [], score: 0
        })
      }
      const candidate = merged.get(key)
      candidate.routes.push(route.id)
      candidate.contributions.push({
        route: route.id, weight: route.weight, rank: item.rank,
        score: Math.round((route.weight / (60 + item.rank)) * 100000) / 100000
      })
      candidate.score += route.weight / (60 + item.rank)
    }
    routeReports.push({
      ...route, hit_count: packed.length, tokens: used, items: packed,
      status: packed.length ? 'hit' : 'miss'
    })
  }

  const rankWeight = { rule: 0, metric: 1, table: 2, field: 3, sql: 4, lineage: 5, evidence: 6 }
  const candidates = [...merged.values()]
    .map((c) => ({ ...c, score: Math.round(c.score * 100000) / 100000 }))
    .sort((a, b) => b.score - a.score || (rankWeight[a.kind] ?? 9) - (rankWeight[b.kind] ?? 9) || a.id.localeCompare(b.id))

  let usedTokens = 0
  const kept = []
  const dropped = []
  const dropOrder = ['R6', 'R2', 'R7', 'R1', 'R3']
  const excluded = new Set()
  for (const candidate of candidates) {
    if (usedTokens + candidate.tokens <= BUDGET) {
      kept.push(candidate)
      usedTokens += candidate.tokens
    } else {
      excluded.add(candidate.id)
      dropped.push(candidate.id)
    }
  }

  const routeTokens = Object.fromEntries(routeReports.map((r) => [r.id, r.tokens]))
  const coverage = {
    routes_hit: routeReports.filter((r) => r.hit_count > 0).length,
    routes_total: ROUTES.length,
    rules: r5.length,
    tables: new Set([...kept.filter((c) => c.kind === 'table').map((c) => c.id)]).size,
    budget_used: usedTokens,
    budget_total: BUDGET,
    hard_cap: HARD_CAP
  }

  const packSeed = JSON.stringify({
    q: question,
    version: DOMAIN.version,
    ids: kept.map((c) => c.id),
    tokens: usedTokens
  })
  const packId = createHash('sha256').update(packSeed).digest('hex').slice(0, 12)

  return {
    routes: routeReports,
    candidates: kept,
    dropped,
    pack: {
      pack_id: packId,
      domain: DOMAIN.id,
      version: DOMAIN.version,
      used_tokens: usedTokens,
      budget: BUDGET,
      hard_cap: HARD_CAP,
      sections: routeReports.map((route) => ({
        route: route.id,
        name: route.name,
        weight: route.weight,
        items: route.items.map((item) => ({
          id: item.id, kind: item.kind, title: item.title, detail: item.detail,
          tokens: item.tokens, rank: item.rank
        }))
      })),
      dropped,
      pack_hash_inputs: { question, version: DOMAIN.version, route_tokens: routeTokens }
    },
    coverage
  }
}
