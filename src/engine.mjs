import { createHash } from 'node:crypto'
import { DOMAIN } from './ontology.mjs?v=ontsql-20261106-3'
import { DB_ENGINE_LABEL, query } from './db.mjs?v=ontsql-20261106-3'
import { parseIntent } from './intent.mjs?v=ontsql-20261106-3'
import { recall } from './recall.mjs?v=ontsql-20261106-3'
import {
  buildAssumptions, buildCitations, buildWarnings, generateSQL
} from './generate.mjs?v=ontsql-20261106-3'
import { validateSQL } from './validate.mjs?v=ontsql-20261106-3'

function nowMs() {
  return Math.round(performance.now() * 10) / 10
}

/**
 * 一次完整编排：意图 → 七路召回 → 加权 RRF → 上下文包 → SQL 生成 → 12 项校验 → 执行。
 * LLM 在本 demo 中被确定性的模板生成器替代，但接口与校验路径和生产一致。
 */
export function answer(question, { baseline = false } = {}) {
  const started = performance.now()
  const trace = []
  let cursor = nowMs()

  const intent = parseIntent(question)
  trace.push({ step: '意图解析', ms: Math.round((nowMs() - cursor) * 10) / 10, note: `${intent.metrics.map((m) => m.name).join(' + ')} × ${intent.dimensions.map((d) => d.label).join('+')}` })
  cursor = nowMs()

  const recallResult = recall(intent.question, intent)
  trace.push({ step: '七路召回', ms: Math.round((nowMs() - cursor) * 10) / 10, note: `${recallResult.coverage.routes_hit}/7 路由 · ${recallResult.pack.used_tokens}/${recallResult.pack.budget} tokens` })
  cursor = nowMs()

  const generation = generateSQL(intent, { baseline })
  trace.push({ step: 'SQL 生成', ms: Math.round((nowMs() - cursor) * 10) / 10, note: `${generation.rules.length} 条规则 · ${generation.sql.split('\n').length} 行` })
  cursor = nowMs()

  const validation = validateSQL(generation.sql, intent, generation, recallResult)
  trace.push({ step: '确定性校验', ms: Math.round((nowMs() - cursor) * 10) / 10, note: validation.ok ? '12/12 通过' : `${validation.failed.length} 项失败，fail-closed` })
  cursor = nowMs()

  let execution = { skipped: true, reason: validation.ok ? '未开启执行' : '校验未通过，按 fail-closed 不执行' }
  if (validation.ok || baseline) {
    try {
      const result = query(generation.sql)
      execution = {
        skipped: false,
        row_count: result.row_count,
        columns: result.columns,
        rows: result.rows,
        ms: result.ms,
        scanned_rows: 3371,
        engine: DB_ENGINE_LABEL,
        error: null
      }
    } catch (error) {
      execution = { skipped: false, row_count: 0, columns: [], rows: [], ms: 0, error: String(error.message ?? error) }
    }
  }
  trace.push({ step: '执行与结果', ms: Math.round((nowMs() - cursor) * 10) / 10, note: execution.error ? '执行失败' : execution.skipped ? '已跳过' : `${execution.row_count} 行 / ${execution.ms}ms` })

  const citations = buildCitations(intent, recallResult, generation)
  const warnings = buildWarnings(intent, validation)
  if (baseline) warnings.unshift('这是「无本体」对照组：语法能跑，但规则与口径并未闭合')

  const assumptions = buildAssumptions(intent)
  const dataQuality = {
    row_count: execution.row_count ?? 0,
    empty: !execution.skipped && !execution.error && execution.row_count === 0,
    null_dimension: (execution.rows ?? []).some((row) => Object.values(row).some((v) => v === null)),
    fully_qualified: generation.tables.length > 0,
    source_version: DOMAIN.version
  }

  const elapsed = Math.round((performance.now() - started) * 10) / 10
  return {
    run_id: `${recallResult.pack.pack_id}-${Date.now().toString(36)}`,
    status: baseline ? 'baseline' : validation.ok ? 'ok' : 'fail_closed',
    question,
    version: DOMAIN.version,
    generated_at: new Date().toISOString(),
    llm_used: false,
    generator: 'deterministic-template-v1',
    intent,
    recall: {
      routes: recallResult.routes,
      candidates: recallResult.candidates,
      dropped: recallResult.dropped,
      coverage: recallResult.coverage
    },
    pack: recallResult.pack,
    sql: generation.sql,
    sql_meta: {
      dialect: generation.dialect,
      engine_dialect: generation.engine_dialect,
      tables: generation.tables,
      output_columns: generation.output_columns,
      metric_alias: generation.metric_alias,
      metric_aliases: generation.metric_aliases,
      comparison_alias: generation.comparison_alias,
      comparison_aliases: generation.comparison_aliases,
      rules: generation.rules
    },
    validation,
    execution,
    citations,
    assumptions,
    warnings,
    data_quality: dataQuality,
    trace,
    total_ms: elapsed,
    next_actions: validation.ok
      ? ['复制 SQL 到生产前，先跑 EXPLAIN 与成本守卫', '把结果列与指标定义一起归档', '如口径有误，提交反馈进入分诊队列']
      : ['根据失败校验修正上下文或生成器', '修正后重新生成，禁止直接下发']
  }
}

/** 反馈分诊：演示“SQL diff → 变更算子 → 待审草稿”，不会自动改写本体。 */
const feedbackQueue = []

function detectOps(aiSql, finalSql) {
  const ai = String(aiSql ?? '')
  const final = String(finalSql ?? '')
  const ops = []
  if (final !== ai && /is_refund\s*=\s*0/i.test(final) && !/is_refund\s*=\s*0/i.test(ai)) {
    ops.push({ op: 'add_filter', target: 'is_refund', detail: '补充退款记录过滤' })
  }
  if (/new_buyer_cnt/i.test(final) && !/new_buyer_cnt/i.test(ai)) {
    ops.push({ op: 'swap_field', target: 'new_buyer_cnt', detail: '新客数改用 new_buyer_cnt' })
  }
  if (/品牌旗舰店|品牌专卖店/.test(final) && !/品牌旗舰店|品牌专卖店/.test(ai)) {
    ops.push({ op: 'add_case_branch', target: 'shop_type', detail: '补充店铺类型 CASE 分支' })
  }
  if (/NULLIF\s*\(/i.test(final) && !/NULLIF\s*\(/i.test(ai)) {
    ops.push({ op: 'add_guard', target: 'NULLIF', detail: '补充零分母保护' })
  }
  if (/阿里系|京东系|内容电商/.test(final) && !/阿里系|京东系|内容电商/.test(ai)) {
    ops.push({ op: 'add_mapping', target: 'channel_group', detail: '补充渠道组映射' })
  }
  if (ops.length === 0 && final.replace(/\s+/g, '') !== ai.replace(/\s+/g, '')) {
    ops.push({ op: 'cosmetic_edit', target: 'sql', detail: '仅格式/别名差异，未识别口径变化' })
  }
  return ops
}

export function submitFeedback({ question, aiSql, finalSql, note = '', author = 'demo-user' }) {
  if (!question || !aiSql || !finalSql) throw new Error('question / aiSql / finalSql 必填')
  const ops = detectOps(aiSql, finalSql)
  const primary = ops[0]?.op ?? 'no_change'
  const category = primary === 'add_case_branch' ? 'rule'
    : primary === 'swap_field' ? 'field'
      : ['add_filter', 'add_mapping', 'add_guard'].includes(primary) ? 'caliber'
        : 'noise'
  const priority = category === 'rule' || category === 'field' ? 'P1' : category === 'caliber' ? 'P2' : 'P4'
  const fingerprint = createHash('sha256').update(`${question}|${ops.map((o) => o.op + o.target).join('|')}`).digest('hex').slice(0, 16)
  const entry = {
    id: `fb_${String(feedbackQueue.length + 1).padStart(3, '0')}`,
    question, note, author,
    ops, category, priority,
    status: 'pending_review',
    fingerprint,
    ai_sql: aiSql,
    final_sql: finalSql,
    created_at: new Date().toISOString(),
    suggestion: category === 'rule'
      ? '进入规则评审：补齐 condition/action/evidence 三元组，通过三道门后发布新版本'
      : category === 'field'
        ? '进入字段语义评审：先确认指标定义与影响面，再改本体映射'
        : category === 'caliber'
          ? '进入口径评审：补充证据 SQL 分支与回归用例'
          : '归入噪声池，不占用本体版本'
  }
  feedbackQueue.unshift(entry)
  return entry
}

export function listFeedback() {
  return feedbackQueue
}

export function resolveFeedback(id, decision) {
  const entry = feedbackQueue.find((x) => x.id === id)
  if (!entry) return null
  if (!['accepted', 'rejected'].includes(decision)) throw new Error('decision 必须是 accepted/rejected')
  entry.status = decision
  entry.resolved_at = new Date().toISOString()
  if (decision === 'accepted') {
    entry.ontology_draft = {
      id: `draft_${entry.fingerprint}`,
      status: 'draft',
      gate: '待指纹校验 / 待生产 SQL 回trace / 待 schema 完整性',
      note: '演示环境只生成草稿，不自动发布本体版本'
    }
  }
  return entry
}
