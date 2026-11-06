/**
 * 生成 docs/：可直接由 GitHub Pages（branch: main / folder: /docs）托管的静态站。
 *
 * 做法不是录制 API 快照，而是把同一套确定性引擎搬到浏览器：
 * - 构建时用 node:sqlite 导出全量 ontsql.sqlite；
 * - 运行时用 sql.js（SQLite WASM）打开，query/explain 接口与 src/db.mjs 对齐；
 * - src/*.mjs 的 node:crypto 与 db 导入在复制时替换为浏览器实现；
 * - static-boot.mjs 接管 fetch('api/*')，再启动未改动的 public/app.js。
 *
 * 这样 Pages 与在线版的生成、校验、执行、评测、反馈走同一份业务代码。
 */
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DOCS = join(ROOT, 'docs')
const RUNTIME = join(DOCS, 'runtime')

if (dirname(DOCS) !== ROOT) throw new Error(`拒绝清理非项目目录：${DOCS}`)
rmSync(DOCS, { recursive: true, force: true })
mkdirSync(RUNTIME, { recursive: true })

for (const file of ['index.html', 'style.css', 'app.js']) {
  cpSync(join(ROOT, 'public', file), join(DOCS, file))
}

mkdirSync(join(ROOT, 'vendor', 'sql.js'), { recursive: true })
for (const file of ['sql-wasm.js', 'sql-wasm.wasm', 'LICENSE']) {
  cpSync(join(ROOT, 'vendor', 'sql.js', file), join(RUNTIME, file))
}
cpSync(join(ROOT, 'web', 'browser-db.mjs'), join(RUNTIME, 'db-browser.mjs'))
cpSync(join(ROOT, 'web', 'crypto-shim.mjs'), join(RUNTIME, 'crypto-shim.mjs'))
cpSync(join(ROOT, 'web', 'static-boot.mjs'), join(RUNTIME, 'static-boot.mjs'))

const MODULES = ['ontology.mjs', 'intent.mjs', 'recall.mjs', 'generate.mjs', 'validate.mjs', 'engine.mjs', 'eval.mjs', 'payload.mjs']
for (const file of MODULES) {
  let source = readFileSync(join(ROOT, 'src', file), 'utf8')
  source = source.replaceAll("'node:crypto'", "'./crypto-shim.mjs'")
  source = source.replace(/(\.\/[^'"]+\.mjs)\?v=[^'"]+/g, '$1')
  source = source.replaceAll("'./db.mjs'", "'./db-browser.mjs'")
  writeFileSync(join(RUNTIME, file), source)
}

const { db } = await import('../src/db.mjs')
const dbPath = join(RUNTIME, 'ontsql.sqlite')
db.exec(`VACUUM INTO '${dbPath.replaceAll("'", "''")}'`)

const indexPath = join(DOCS, 'index.html')
let index = readFileSync(indexPath, 'utf8')
const bootTag = '  <script src="./runtime/sql-wasm.js"></script>\n  <script src="./runtime/static-boot.mjs" type="module"></script>'
if (!index.includes('<script src="./app.js" type="module"></script>')) {
  throw new Error('index.html 里找不到 app.js 启动标签')
}
index = index.replace('  <script src="./app.js" type="module"></script>', bootTag)
writeFileSync(indexPath, index)
writeFileSync(join(DOCS, '.nojekyll'), '')

console.log(`docs/ 已生成：${DOCS}`)
console.log('  runtime/ontsql.sqlite + sql.js WASM')
console.log('  fetch(api/*) → 浏览器内 engine/eval/feedback')
