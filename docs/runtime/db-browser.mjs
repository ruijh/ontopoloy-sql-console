/**
 * 浏览器端 SQLite 适配层。
 *
 * 接口与 src/db.mjs 对齐（TODAY / DB_ENGINE / query / explain / dbSummary），
 * 由 build-pages.mjs 在静态产物里替换 src/db.mjs。数据库是构建时用
 * node:sqlite 导出的全量 .sqlite 文件，运行时由 sql.js（SQLite WASM）打开，
 * 所以 Pages 版仍是真的执行 SQL，不是截图或预计算答案。
 */
export const TODAY = '2026-11-06'
export const DB_ENGINE = 'sql.js 1.15.2 (SQLite WASM)'
export const DB_ENGINE_LABEL = 'SQLite WASM（sql.js）'

let database = null

export function setDatabase(next) {
  database = next
}

function requireDb() {
  if (!database) throw new Error('SQLite WASM 尚未初始化')
  return database
}

export function query(sql) {
  const db = requireDb()
  const started = performance.now()
  const results = db.exec(sql)
  const ms = Math.round((performance.now() - started) * 10) / 10
  if (!results.length) return { columns: [], rows: [], ms, row_count: 0 }
  const { columns, values } = results[results.length - 1]
  const rows = values.map((value) => Object.fromEntries(columns.map((column, index) => [column, value[index]])))
  return { columns, rows, ms, row_count: rows.length }
}

export function explain(sql) {
  const db = requireDb()
  try {
    const stmt = db.prepare(sql)
    try {
      stmt.step()
      return { ok: true, columns: stmt.getColumnNames() }
    } finally {
      stmt.free()
    }
  } catch (error) {
    return { ok: false, error: String(error.message ?? error) }
  }
}

export function dbSummary() {
  const { rows } = query(`
    SELECT 'dws_brand_trade_m' AS name, COUNT(*) AS n FROM dws_brand_trade_m
    UNION ALL SELECT 'dwd_trade_order_di', COUNT(*) FROM dwd_trade_order_di
    UNION ALL SELECT 'ads_channel_daily', COUNT(*) FROM ads_channel_daily
    UNION ALL SELECT 'dim_brand', COUNT(*) FROM dim_brand
    UNION ALL SELECT 'dim_shop', COUNT(*) FROM dim_shop
    UNION ALL SELECT 'dim_category', COUNT(*) FROM dim_category
  `)
  return Object.fromEntries(rows.map((row) => [row.name, row.n]))
}
