import { createServer } from 'node:http'
import { createHandler } from './src/http.mjs'

const port = Number(process.env.ONTSQL_PORT ?? 43960)
const handler = createHandler({ prefix: '/ontsql' })
const server = createServer((req, res) => {
  handler(req, res).catch((error) => {
    console.error('[ontsql] request failed', error)
    if (!res.headersSent) {
      res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ ok: false, error: String(error?.message ?? error) }))
    } else {
      res.end()
    }
  })
})
server.listen(port, '127.0.0.1', () => {
  console.log(`[ontsql] local demo on http://127.0.0.1:${port}/ontsql/`)
})
