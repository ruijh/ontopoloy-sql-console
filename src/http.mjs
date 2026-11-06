import { readFileSync, statSync } from 'node:fs'
import { dirname, extname, join, normalize, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { answer, listFeedback, resolveFeedback, submitFeedback } from './engine.mjs?v=ontsql-20261106-3'
import { runEvaluation } from './eval.mjs?v=ontsql-20261106-3'
import { healthPayload, ontologyPayload } from './payload.mjs?v=ontsql-20261106-3'

const HERE = dirname(fileURLToPath(import.meta.url))
const PUBLIC_DIR = join(HERE, '..', 'public')
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8'
}

const BASE_HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'cache-control': 'no-store'
}

function send(res, status, type, body, extra = {}) {
  res.writeHead(status, {
    'content-type': type,
    'content-length': Buffer.byteLength(body),
    ...BASE_HEADERS,
    ...extra
  })
  res.end(body)
}

function sendJSON(res, status, payload, headOnly = false) {
  const body = `${JSON.stringify(payload)}\n`
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    ...BASE_HEADERS
  })
  res.end(headOnly ? undefined : body)
}

function readJSON(req) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > 256 * 1024) {
        reject(new Error('请求体超过 256KB'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (chunks.length === 0) return resolve({})
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch {
        reject(new Error('请求体不是合法 JSON'))
      }
    })
    req.on('error', reject)
  })
}

function resolveFile(pathname, prefix) {
  let rel = pathname.slice(prefix.length)
  try {
    rel = decodeURIComponent(rel)
  } catch {
    return null
  }
  rel = rel.replace(/^\/+/, '')
  if (rel === '' || rel.endsWith('/')) rel += 'index.html'
  const abs = normalize(join(PUBLIC_DIR, rel))
  if (abs !== PUBLIC_DIR && !abs.startsWith(PUBLIC_DIR + sep)) return null
  try {
    if (statSync(abs).isDirectory()) return normalize(join(abs, 'index.html'))
  } catch {
    return null
  }
  return abs
}

export function createHandler({ prefix = '/ontsql' } = {}) {
  return async function handler(req, res) {
    const url = new URL(req.url ?? '/', 'http://dsh.invalid')
    const path = url.pathname

    if (path === prefix) {
      res.writeHead(308, { location: `${prefix}/${url.search}`, ...BASE_HEADERS })
      res.end()
      return
    }
    if (!path.startsWith(`${prefix}/`)) {
      sendJSON(res, 404, { ok: false, error: 'not found' })
      return
    }

    const rest = path.slice(prefix.length)
    const headOnly = req.method === 'HEAD'

    try {
      if (rest === '/api/health') {
        sendJSON(res, 200, healthPayload(), headOnly)
        return
      }

      if (rest === '/api/ontology' && (req.method === 'GET' || headOnly)) {
        sendJSON(res, 200, ontologyPayload(), headOnly)
        return
      }

      if (rest === '/api/generate' && req.method === 'POST') {
        const body = await readJSON(req)
        const question = String(body.question ?? '').trim()
        if (!question) {
          sendJSON(res, 400, { ok: false, error: 'question 不能为空' })
          return
        }
        if (question.length > 300) {
          sendJSON(res, 400, { ok: false, error: 'question 最长 300 字' })
          return
        }
        sendJSON(res, 200, answer(question, { baseline: Boolean(body.baseline) }))
        return
      }

      if (rest === '/api/eval' && (req.method === 'GET' || req.method === 'POST' || headOnly)) {
        const refresh = req.method === 'POST' ? Boolean((await readJSON(req)).refresh) : url.searchParams.get('refresh') === '1'
        sendJSON(res, 200, runEvaluation({ refresh }), headOnly)
        return
      }

      if (rest === '/api/feedback' && (req.method === 'GET' || headOnly)) {
        sendJSON(res, 200, { items: listFeedback() }, headOnly)
        return
      }

      if (rest === '/api/feedback' && req.method === 'POST') {
        const body = await readJSON(req)
        const entry = submitFeedback({
          question: String(body.question ?? '').trim(),
          aiSql: String(body.aiSql ?? ''),
          finalSql: String(body.finalSql ?? ''),
          note: String(body.note ?? ''),
          author: String(body.author ?? 'demo-user')
        })
        sendJSON(res, 200, { ok: true, entry })
        return
      }

      const resolveMatch = /^\/api\/feedback\/([^/]+)\/resolve$/.exec(rest)
      if (resolveMatch && req.method === 'POST') {
        const body = await readJSON(req)
        const entry = resolveFeedback(decodeURIComponent(resolveMatch[1]), String(body.decision ?? ''))
        if (!entry) {
          sendJSON(res, 404, { ok: false, error: '反馈不存在' })
          return
        }
        sendJSON(res, 200, { ok: true, entry })
        return
      }

      if (rest.startsWith('/api/')) {
        sendJSON(res, 404, { ok: false, error: 'API 不存在' })
        return
      }

      if (req.method !== 'GET' && !headOnly) {
        sendJSON(res, 405, { ok: false, error: '只支持 GET' })
        return
      }

      const file = resolveFile(path, prefix)
      if (file === null) {
        send(res, 404, 'text/plain; charset=utf-8', 'not found\n')
        return
      }
      let body
      try {
        body = readFileSync(file)
      } catch {
        send(res, 404, 'text/plain; charset=utf-8', 'not found\n')
        return
      }
      const type = TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream'
      res.writeHead(200, { 'content-type': type, 'content-length': body.length, ...BASE_HEADERS })
      res.end(headOnly ? undefined : body)
    } catch (error) {
      sendJSON(res, 400, { ok: false, error: String(error?.message ?? error) })
    }
  }
}
