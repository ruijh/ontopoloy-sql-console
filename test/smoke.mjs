/**
 * 无浏览器冒烟测试：直接拉起 createHandler() 的 HTTP 服务，
 * 校验页面、静态资源、API、fail-closed、评测与反馈闭环。
 */
import http from 'node:http'
import assert from 'node:assert/strict'
import { createHandler } from '../src/http.mjs'

const PREFIX = '/ontsql'
const server = http.createServer(createHandler({ prefix: PREFIX }))
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const { port } = server.address()
const base = `http://127.0.0.1:${port}${PREFIX}`

async function request(path, { method = 'GET', body, headers = {} } = {}) {
  const payload = body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body))
  if (payload !== undefined) headers['content-type'] = 'application/json'
  const res = await fetch(`${base}${path}`, { method, body: payload, headers, redirect: 'manual' })
  const buf = Buffer.from(await res.arrayBuffer())
  let json = null
  try { json = JSON.parse(buf.toString('utf8')) } catch {}
  return { res, buf, text: buf.toString('utf8'), json }
}

let passed = 0
function ok(name, fn) {
  fn()
  passed += 1
  console.log(`  ✓ ${name}`)
}

try {
  console.log('OntopoloySQL smoke')

  {
    const { res, json } = await request('/api/health')
    ok('health 200 且返回真实行数', () => {
      assert.equal(res.status, 200)
      assert.equal(json.ok, true)
      assert.equal(json.llm_used, false)
      assert.equal(json.dws_brand_trade_m, 3371)
      assert.equal(json.ads_channel_daily, 294)
    })
  }

  {
    const { res, text } = await request('/')
    ok('首页可直接打开', () => {
      assert.equal(res.status, 200)
      assert.match(res.headers.get('content-type'), /text\/html/)
      assert.match(text, /OntopoloySQL Console/)
      assert.match(text, /\/ontsql\/app\.js|\.\/app\.js/)
    })
  }

  {
    const { res } = await request('')
    ok('缺少尾斜杠 308 到 /ontsql/', () => {
      assert.equal(res.status, 308)
      assert.equal(res.headers.get('location'), '/ontsql/')
    })
  }

  {
    const { res, buf } = await request('/app.js')
    ok('app.js 以 JS 类型返回', () => {
      assert.equal(res.status, 200)
      assert.match(res.headers.get('content-type'), /text\/javascript/)
      assert.ok(buf.length > 30000)
    })
  }

  {
    const { res, json } = await request('/api/ontology')
    ok('本体接口：6 表 / 12 规则 / 行数与 DB 一致', () => {
      assert.equal(res.status, 200)
      assert.equal(json.tables.length, 6)
      assert.equal(json.rules.length, 12)
      assert.equal(json.tables.find((t) => t.name === 'dws_brand_trade_m').row_count, 3371)
      assert.equal(json.tables.find((t) => t.name === 'ads_channel_daily').row_count, 294)
    })
  }

  {
    const { res, json } = await request('/api/generate', { method: 'POST', body: { question: '上月各品类成交额及同比' } })
    ok('生成接口：12 校验全过 + 真实执行 4 行', () => {
      assert.equal(res.status, 200)
      assert.equal(json.status, 'ok')
      assert.equal(json.llm_used, false)
      assert.equal(json.validation.checks.length, 12)
      assert.deepEqual(json.validation.failed, [])
      assert.equal(json.execution.row_count, 4)
      assert.equal(json.execution.rows[0].category, '食品')
      assert.ok(json.execution.rows[0].gmv_yoy_pct > 0)
      assert.match(json.sql, /COALESCE\(t\.category_name/)
      assert.match(json.sql, /is_refund = 0/)
      assert.ok(json.citations.length >= 6)
      assert.equal(json.trace.length, 5)
      assert.equal(json.pack.used_tokens <= json.pack.budget, true)
    })
  }

  {
    const { res, json } = await request('/api/generate', { method: 'POST', body: { question: '近30天新客数' } })
    ok('新客口径命中固定规则，且结果非空', () => {
      assert.equal(res.status, 200)
      assert.equal(json.status, 'ok')
      assert.deepEqual(json.validation.failed, [])
      assert.ok(json.execution.row_count > 0)
      assert.match(json.sql, /new_buyer_cnt/)
    })
  }

  {
    const { res, json } = await request('/api/generate', { method: 'POST', body: { question: '上月各渠道退款率' } })
    ok('退款率使用 NULLIF 防除零', () => {
      assert.equal(res.status, 200)
      assert.equal(json.status, 'ok')
      assert.match(json.sql, /NULLIF/)
      assert.match(json.sql, /refund_amt/)
    })
  }

  {
    const { res, json } = await request('/api/generate', { method: 'POST', body: { question: '上月各品类成交额和退款率' } })
    ok('双指标在同一粒度生成两列，并分别校验口径', () => {
      assert.equal(res.status, 200)
      assert.equal(json.status, 'ok')
      assert.equal(json.validation.failed.length, 0)
      assert.deepEqual(json.sql_meta.output_columns, ['category', 'gmv', 'refund_rate'])
      assert.equal(typeof json.execution.rows[0].gmv, 'number')
      assert.equal(typeof json.execution.rows[0].refund_rate, 'number')
      assert.equal(json.citations.filter((c) => c.type === 'metric').length, 2)
      assert.match(json.validation.checks.find((c) => c.id === 'V06').detail, /成交额 已剔除退款/)
      assert.match(json.validation.checks.find((c) => c.id === 'V06').detail, /退款率分子/)
    })
  }

  {
    const { res, json } = await request('/api/generate', { method: 'POST', body: { question: '上月各品类成交额', baseline: true } })
    ok('baseline 被标注为 baseline，并保留失败校验', () => {
      assert.equal(res.status, 200)
      assert.equal(json.status, 'baseline')
      assert.equal(json.validation.ok, false)
      assert.ok(json.validation.failed.includes('V06'))
    })
  }

  {
    const { res, json } = await request('/api/eval')
    ok('评测台：本体 8/8 均分 100，baseline 4/8 均分 68', () => {
      assert.equal(res.status, 200)
      assert.equal(json.ontology.summary.passed, 8)
      assert.equal(json.ontology.summary.avg_score, 100)
      assert.equal(json.ontology.summary.strict_passed, 8)
      assert.equal(json.baseline.summary.passed, 4)
      assert.equal(json.baseline.summary.avg_score, 68)
      assert.equal(json.comparison.pass_delta, 4)
      assert.equal(json.comparison.avg_delta, 32)
      assert.equal(json.ontology.cases.length, 8)
    })
  }

  {
    const question = '冒烟测试：退款率分子口径'
    const created = await request('/api/feedback', {
      method: 'POST',
      body: { question, aiSql: 'SELECT 1', finalSql: 'SELECT 2', note: '退款金额应剔除测试单' }
    })
    ok('反馈提交进入 pending_review，并完成分诊', () => {
      assert.equal(created.res.status, 200)
      assert.equal(created.json.entry.question, question)
      assert.equal(created.json.entry.status, 'pending_review')
      assert.ok(created.json.entry.fingerprint)
      assert.ok(created.json.entry.ops.length >= 1)
      assert.equal(created.json.entry.priority, 'P4')
    })

    const resolved = await request(`/api/feedback/${created.json.entry.id}/resolve`, {
      method: 'POST',
      body: { decision: 'accepted' }
    })
    ok('反馈评审只接受 accepted/rejected，并记录状态', () => {
      assert.equal(resolved.res.status, 200)
      assert.equal(resolved.json.entry.status, 'accepted')
      assert.match(resolved.json.entry.ontology_draft.gate, /待指纹校验/)
      assert.match(resolved.json.entry.ontology_draft.note, /不自动发布/)
    })

    const invalid = await request(`/api/feedback/${created.json.entry.id}/resolve`, {
      method: 'POST',
      body: { decision: 'maybe' }
    })
    ok('非法评审决定被拒（400）', () => {
      assert.equal(invalid.res.status, 400)
      assert.equal(invalid.json.ok, false)
    })

    const list = await request('/api/feedback')
    ok('反馈队列能读回已评审记录', () => {
      assert.equal(list.res.status, 200)
      assert.ok(list.json.items.some((item) => item.id === created.json.entry.id && item.status === 'accepted'))
    })
  }

  {
    const bad = await request('/api/generate', { method: 'POST', body: { question: '   ' } })
    ok('空问题 400', () => {
      assert.equal(bad.res.status, 400)
    })
    const malformed = await request('/api/generate', { method: 'POST', body: '{oops' })
    ok('非法 JSON 400', () => {
      assert.equal(malformed.res.status, 400)
    })
    const traversal = await request('/..%2f..%2fsrc%2fengine.mjs')
    ok('静态路径穿越被拒', () => {
      assert.equal(traversal.res.status, 404)
    })
    const postStatic = await request('/app.js', { method: 'POST', body: {} })
    ok('静态资源只允许读', () => {
      assert.equal(postStatic.res.status, 405)
    })
    const unknown = await request('/api/nope')
    ok('未知 API 404', () => {
      assert.equal(unknown.res.status, 404)
    })
  }

  console.log(`\n${passed} checks passed`)
} finally {
  await new Promise((resolve) => server.close(resolve))
}
