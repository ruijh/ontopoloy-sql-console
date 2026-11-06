/**
 * GitHub Pages 启动器。
 *
 * 顺序：加载 sql.js → 打开构建时导出的 ontsql.sqlite → 用本地 API 适配器
 * 接管 fetch('api/*') → 再启动原来的 app.js。页面与交互和 DSH 在线版一致，
 * 但 SQL 在浏览器内的 SQLite WASM 里执行，反馈只存在当前页面内存中。
 */
import { setDatabase } from './db-browser.mjs'
import { answer, listFeedback, resolveFeedback, submitFeedback } from './engine.mjs'
import { runEvaluation } from './eval.mjs'
import { healthPayload, ontologyPayload } from './payload.mjs'

const REPO_URL = 'https://github.com/ruijh/ontopoloy-sql-console'
const nativeFetch = window.fetch.bind(window)

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' }
  })
}

function parseBody(init) {
  if (!init?.body) return {}
  if (typeof init.body !== 'string') throw new Error('静态版只接受字符串请求体')
  return JSON.parse(init.body)
}

function installStaticApi() {
  window.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url, window.location.href)
    const marker = '/api/'
    const index = url.pathname.lastIndexOf(marker)
    if (index < 0) return nativeFetch(input, init)

    const route = url.pathname.slice(index + marker.length)
    const method = String(init.method ?? 'GET').toUpperCase()
    try {
      if (route === 'health' && method === 'GET') {
        return jsonResponse({ ...healthPayload(), runtime: 'static' })
      }
      if (route === 'ontology' && method === 'GET') {
        return jsonResponse(ontologyPayload())
      }
      if (route === 'eval' && (method === 'GET' || method === 'POST')) {
        const refresh = method === 'POST' ? Boolean(parseBody(init).refresh) : url.searchParams.get('refresh') === '1'
        return jsonResponse(runEvaluation({ refresh }))
      }
      if (route === 'generate' && method === 'POST') {
        const body = parseBody(init)
        const question = String(body.question ?? '').trim()
        if (!question) return jsonResponse({ ok: false, error: 'question 不能为空' }, 400)
        if (question.length > 300) return jsonResponse({ ok: false, error: 'question 最长 300 字' }, 400)
        return jsonResponse(answer(question, { baseline: Boolean(body.baseline) }))
      }
      if (route === 'feedback' && method === 'GET') {
        return jsonResponse({ items: listFeedback() })
      }
      if (route === 'feedback' && method === 'POST') {
        const body = parseBody(init)
        const entry = submitFeedback({
          question: String(body.question ?? '').trim(),
          aiSql: String(body.aiSql ?? ''),
          finalSql: String(body.finalSql ?? ''),
          note: String(body.note ?? ''),
          author: String(body.author ?? 'pages-visitor')
        })
        return jsonResponse({ ok: true, entry })
      }
      const resolve = /^feedback\/([^/]+)\/resolve$/.exec(route)
      if (resolve && method === 'POST') {
        const entry = resolveFeedback(decodeURIComponent(resolve[1]), String(parseBody(init).decision ?? ''))
        if (!entry) return jsonResponse({ ok: false, error: '反馈不存在' }, 404)
        return jsonResponse({ ok: true, entry })
      }
      return jsonResponse({ ok: false, error: 'API 不存在' }, 404)
    } catch (error) {
      return jsonResponse({ ok: false, error: String(error?.message ?? error) }, 400)
    }
  }
}

function showStaticChrome() {
  const strip = document.getElementById('static-strip')
  if (strip) strip.hidden = false
  const link = document.getElementById('static-repo')
  if (link) link.href = REPO_URL
  const note = document.querySelector('.footer span:nth-of-type(2)')
  if (note) note.textContent = 'SQLite WASM 在浏览器内执行 · 确定性模板生成（非在线 LLM）· 数据截至 2026-11-06'
  const status = document.getElementById('run-status')
  if (status) status.textContent = '加载 SQLite WASM…'
}

async function boot() {
  showStaticChrome()
  const SQL = await window.initSqlJs({
    locateFile: (file) => new URL(`./${file}`, import.meta.url).href
  })
  const bytes = await nativeFetch(new URL('./ontsql.sqlite', import.meta.url)).then((response) => {
    if (!response.ok) throw new Error(`数据库加载失败：HTTP ${response.status}`)
    return response.arrayBuffer()
  })
  setDatabase(new SQL.Database(new Uint8Array(bytes)))
  installStaticApi()
  window.__ONTSQL_STATIC__ = { mode: 'static', engine: 'sql.js 1.15.2' }
  if (window.__ONTSQL_SKIP_APP__ !== true) await import('../app.js')
}

boot().catch((error) => {
  console.error('static boot failed', error)
  const status = document.getElementById('run-status')
  if (status) status.textContent = 'SQLite WASM 初始化失败'
  const health = document.getElementById('health-text')
  if (health) health.textContent = 'WASM 初始化失败'
  const banner = document.getElementById('error-banner')
  if (banner) {
    banner.hidden = false
    banner.textContent = `静态版初始化失败：${String(error?.message ?? error)}`
  }
})
