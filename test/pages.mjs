/**
 * GitHub Pages 产物测试：不启 HTTP 服务，直接验证 docs/ 的浏览器模块。
 * 用 sql.js 打开构建出的 ontsql.sqlite，确认与在线版同样是真实 SQL 执行；
 * 再用最小 DOM/窗口桩跑 static-boot.mjs，验证 fetch('api/*') 本地接管。
 */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DOCS = join(ROOT, 'docs')
const require = createRequire(import.meta.url)
const initSqlJs = require('../vendor/sql.js/sql-wasm.js')

let passed = 0
async function ok(name, fn) {
  await fn()
  passed += 1
  console.log(`  ✓ ${name}`)
}

console.log('OntopoloySQL Pages smoke')

const index = readFileSync(join(DOCS, 'index.html'), 'utf8')
await ok('产物包含启动器、WASM 与 .nojekyll', () => {
  assert.match(index, /runtime\/sql-wasm\.js/)
  assert.match(index, /runtime\/static-boot\.mjs/)
  assert.match(index, /OntopoloySQL/)
  assert.ok(statSync(join(DOCS, 'runtime', 'sql-wasm.wasm')).size > 500_000)
  assert.ok(statSync(join(DOCS, 'runtime', 'ontsql.sqlite')).size > 400_000)
  assert.equal(statSync(join(DOCS, '.nojekyll')).size, 0)
})

await ok('浏览器模块不含 node: 内置依赖', () => {
  for (const file of ['engine.mjs', 'eval.mjs', 'intent.mjs', 'payload.mjs', 'static-boot.mjs']) {
    const source = readFileSync(join(DOCS, 'runtime', file), 'utf8')
    assert.doesNotMatch(source, /from ['"]node:/, file)
  }
})

const SQL = await initSqlJs({ locateFile: () => join(DOCS, 'runtime', 'sql-wasm.wasm') })
const { setDatabase, dbSummary, DB_ENGINE } = await import('../docs/runtime/db-browser.mjs')
setDatabase(new SQL.Database(new Uint8Array(readFileSync(join(DOCS, 'runtime', 'ontsql.sqlite')))))

await ok('WASM 打开的是全量 3,803 行数据库', () => {
  assert.match(DB_ENGINE, /SQLite WASM/)
  assert.deepEqual(dbSummary(), {
    dws_brand_trade_m: 3371,
    dwd_trade_order_di: 120,
    ads_channel_daily: 294,
    dim_brand: 6,
    dim_shop: 8,
    dim_category: 4
  })
})

const { answer, submitFeedback, resolveFeedback } = await import('../docs/runtime/engine.mjs')
await ok('五个预设都在 WASM 内执行成功', () => {
  const questions = [
    '上月各品类成交额及同比',
    '上月各店铺类型成交额',
    '上月各渠道退款率',
    '上月各渠道新客数',
    '上月各品牌成交额 top 3'
  ]
  for (const question of questions) {
    const result = answer(question)
    assert.equal(result.status, 'ok', question)
    assert.equal(result.validation.ok, true, question)
    assert.ok(result.execution.row_count > 0, question)
    assert.match(result.execution.engine, /SQLite WASM/, question)
  }
})

const { runEvaluation } = await import('../docs/runtime/eval.mjs')
await ok('五层评测与在线版数字一致', () => {
  const result = runEvaluation({ refresh: true })
  assert.equal(result.ontology.summary.passed, 8)
  assert.equal(result.ontology.summary.avg_score, 100)
  assert.equal(result.baseline.summary.passed, 4)
  assert.equal(result.baseline.summary.avg_score, 68)
})

await ok('反馈分诊与草稿门在静态模块里可运行', () => {
  const entry = submitFeedback({ question: 'q', aiSql: 'SELECT 1', finalSql: 'SELECT 1 WHERE is_refund = 0', note: 'n' })
  assert.match(entry.fingerprint, /^[0-9a-f]{16}$/)
  assert.equal(resolveFeedback(entry.id, 'accepted').ontology_draft.status, 'draft')
})

/* 最小浏览器桩：只够 static-boot 与 fetch 适配器运行，不加载真实 UI。 */
const elements = new Map()
for (const id of ['static-strip', 'static-repo', 'run-status', 'health-text', 'error-banner']) {
  elements.set(id, { hidden: true, href: '', textContent: '' })
}
globalThis.document = {
  getElementById: (id) => elements.get(id) ?? null,
  querySelector: () => ({ textContent: '' })
}
const nativeFetch = async (input) => {
  const path = String(input)
  if (path.endsWith('ontsql.sqlite')) return new Response(readFileSync(join(DOCS, 'runtime', 'ontsql.sqlite')))
  throw new Error(`unexpected native fetch: ${path}`)
}
globalThis.window = {
  location: { href: 'https://ruijh.github.io/ontopoloy-sql-console/' },
  fetch: nativeFetch,
  initSqlJs,
  __ONTSQL_SKIP_APP__: true
}

await import('../docs/runtime/static-boot.mjs')
for (let i = 0; i < 200 && !window.__ONTSQL_STATIC__; i += 1) {
  await new Promise((resolveWait) => setTimeout(resolveWait, 20))
}
assert.ok(window.__ONTSQL_STATIC__, 'static boot did not become ready')

const api = (path, init) => window.fetch(`https://ruijh.github.io/ontopoloy-sql-console/api/${path}`, init)

await ok('static-boot 接管 health 并显示 WASM 实际行数', async () => {
  const response = await api('health')
  const health = await response.json()
  assert.equal(response.status, 200)
  assert.equal(health.runtime, 'static')
  assert.match(health.engine, /SQLite WASM/)
  assert.equal(health.dws_brand_trade_m, 3371)
  assert.equal(elements.get('static-strip').hidden, false)
})

await ok('static-boot 本地执行 generate，不请求后端', async () => {
  const response = await api('generate', {
    method: 'POST',
    body: JSON.stringify({ question: '上月各渠道退款率' })
  })
  const result = await response.json()
  assert.equal(response.status, 200)
  assert.equal(result.status, 'ok')
  assert.equal(result.execution.row_count, 4)
  assert.match(result.sql, /NULLIF/)
})

await ok('静态 API 对空问题与未知路由返回结构化错误', async () => {
  const empty = await api('generate', { method: 'POST', body: JSON.stringify({ question: '' }) })
  assert.equal(empty.status, 400)
  assert.equal((await empty.json()).error, 'question 不能为空')
  const missing = await api('nope')
  assert.equal(missing.status, 404)
  assert.equal((await missing.json()).ok, false)
})

console.log(`\n${passed} Pages checks passed`)
