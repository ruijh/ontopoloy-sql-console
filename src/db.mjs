import { DatabaseSync } from 'node:sqlite'

/**
 * 演示数据库：SQLite 内存实例。
 * 表结构、分区字段和指标口径与方案中的 Hive 资产保持同名，
 * 这样生成的 SQL 既能展示，也能真实执行并做结果比对（不是写死的截图数据）。
 */
export const TODAY = '2026-11-06'
export const DB_ENGINE = 'node:sqlite (in-memory)'
export const DB_ENGINE_LABEL = 'node:sqlite 内存库'

export const db = new DatabaseSync(':memory:')

const DDL = `
CREATE TABLE dim_brand (
  brand_id TEXT PRIMARY KEY, brand_name TEXT, brand_level TEXT,
  main_category TEXT, is_active INTEGER
);
CREATE TABLE dim_category (
  category_id TEXT PRIMARY KEY, category_name TEXT, parent_id TEXT, is_active INTEGER
);
CREATE TABLE dim_shop (
  shop_id TEXT PRIMARY KEY, shop_name TEXT, shop_type TEXT,
  brand_id TEXT, channel_id TEXT, open_date TEXT
);
CREATE TABLE dws_brand_trade_m (
  dt TEXT, brand_id TEXT, brand_name TEXT, category_id TEXT, category_name TEXT,
  shop_id TEXT, shop_name TEXT, channel_id TEXT, channel_name TEXT,
  pay_amt REAL, refund_amt REAL, order_cnt INTEGER, buyer_cnt INTEGER,
  new_buyer_cnt INTEGER, is_refund INTEGER, order_status TEXT
);
CREATE TABLE dwd_trade_order_di (
  order_id TEXT PRIMARY KEY, dt TEXT, brand_id TEXT, shop_id TEXT, channel_id TEXT,
  buyer_id TEXT, pay_amt REAL, refund_amt REAL, order_status TEXT,
  is_new_buyer INTEGER, is_refund INTEGER, created_at TEXT
);
CREATE TABLE ads_channel_daily (
  dt TEXT, channel_name TEXT, gmv REAL, refund_amt REAL, order_cnt INTEGER, buyer_cnt INTEGER
);
CREATE INDEX idx_dws_dt ON dws_brand_trade_m(dt);
CREATE INDEX idx_dws_dim ON dws_brand_trade_m(category_name, brand_name);
`

db.exec(DDL)

/** 固定种子，保证每次启动的数据、指标结果与评测分数一致。 */
function mulberry32(seed) {
  let a = seed >>> 0
  return function random() {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const rand = mulberry32(20261106)
const pick = (arr) => arr[Math.floor(rand() * arr.length)]
const between = (min, max) => min + rand() * (max - min)

const BRANDS = [
  { id: 'b1', name: '花漾', cat: 'c1', level: 'S' },
  { id: 'b2', name: '山野', cat: 'c3', level: 'A' },
  { id: 'b3', name: '初见', cat: 'c1', level: 'A' },
  { id: 'b4', name: '北纬', cat: 'c2', level: 'B' },
  { id: 'b5', name: '云栖', cat: 'c4', level: 'B' },
  { id: 'b6', name: '拾光', cat: 'c2', level: 'C' }
]
const CATEGORIES = [
  { id: 'c1', name: '美妆' },
  { id: 'c2', name: '服饰' },
  { id: 'c3', name: '食品' },
  { id: 'c4', name: '家居' }
]
const CHANNELS = [
  { id: 'ch1', name: '天猫' },
  { id: 'ch2', name: '京东' },
  { id: 'ch3', name: '抖音' },
  { id: 'ch4', name: '拼多多' }
]
const SHOPS = [
  { id: 's1', name: '花漾旗舰店', brand: 'b1', type: '品牌旗舰店', channel: 'ch1' },
  { id: 's2', name: '花漾专卖店', brand: 'b1', type: '品牌专卖店', channel: 'ch3' },
  { id: 's3', name: '山野官方旗舰店', brand: 'b2', type: '品牌旗舰店', channel: 'ch1' },
  { id: 's4', name: '山野优选店', brand: 'b2', type: '其他', channel: 'ch4' },
  { id: 's5', name: '初见旗舰店', brand: 'b3', type: '品牌旗舰店', channel: 'ch2' },
  { id: 's6', name: '北纬旗舰店', brand: 'b4', type: '品牌旗舰店', channel: 'ch1' },
  { id: 's7', name: '云栖专卖店', brand: 'b5', type: '品牌专卖店', channel: 'ch3' },
  { id: 's8', name: '拾光旗舰店', brand: 'b6', type: '品牌旗舰店', channel: 'ch2' }
]

function insertBrands() {
  const stmt = db.prepare('INSERT INTO dim_brand VALUES (?, ?, ?, ?, 1)')
  for (const b of BRANDS) {
    const cat = CATEGORIES.find((c) => c.id === b.cat)
    stmt.run(b.id, b.name, b.level, cat.name)
  }
  const catStmt = db.prepare('INSERT INTO dim_category VALUES (?, ?, ?, 1)')
  for (const c of CATEGORIES) catStmt.run(c.id, c.name, 'root')
  const shopStmt = db.prepare('INSERT INTO dim_shop VALUES (?, ?, ?, ?, ?, ?)')
  for (const s of SHOPS) shopStmt.run(s.id, s.name, s.type, s.brand, s.channel, '2024-01-01')
}

function dateRange(start, end) {
  const out = []
  const d = new Date(`${start}T00:00:00Z`)
  const stop = new Date(`${end}T00:00:00Z`)
  while (d <= stop) {
    out.push(d.toISOString().slice(0, 10))
    d.setUTCDate(d.getUTCDate() + 1)
  }
  return out
}

/** 回填数据：YoY 基期 + 近三个月，订单量足够让分组查询有真实差异。 */
function insertFacts() {
  const normal = db.prepare(`INSERT INTO dws_brand_trade_m VALUES
    (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, 0, ?)`)
  const refund = db.prepare(`INSERT INTO dws_brand_trade_m VALUES
    (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 0, 0, 0, 1, 'refunded')`)
  const days = [
    ...dateRange('2025-10-01', '2025-10-31'),
    ...dateRange('2026-09-01', '2026-09-30'),
    ...dateRange('2026-10-01', '2026-10-31'),
    ...dateRange('2026-11-01', '2026-11-06')
  ]
  const brandFactor = { b1: 1.35, b2: 1.1, b3: 0.95, b4: 0.8, b5: 0.7, b6: 0.55 }
  let seq = 0
  for (const dt of days) {
    const isOld = dt.startsWith('2025-')
    const month = dt.slice(0, 7)
    const season = month === '2026-10' ? 1.18 : month === '2026-11' ? 1.05 : 1
    for (const brand of BRANDS) {
      const shopList = SHOPS.filter((s) => s.brand === brand.id)
      for (const cat of [brand.cat, CATEGORIES[(CATEGORIES.findIndex((c) => c.id === brand.cat) + 2) % 4].id]) {
        for (const shop of shopList) {
          for (const channel of [CHANNELS.find((c) => c.id === shop.channel), CHANNELS[(CHANNELS.findIndex((c) => c.id === shop.channel) + 1) % 4]]) {
            seq += 1
            const base = between(900, 4600) * brandFactor[brand.id] * season * (isOld ? 0.78 : 1)
            const pay = Math.round(base * 100) / 100
            const orders = Math.max(1, Math.round(pay / between(95, 145)))
            const buyers = Math.max(1, Math.round(orders * between(0.64, 0.88)))
            const newBuyers = Math.max(0, Math.round(buyers * between(0.08, 0.34)))
            const status = rand() < 0.14 ? 'paid' : 'finished'
            normal.run(dt, brand.id, brand.name, cat, CATEGORIES.find((c) => c.id === cat).name,
              shop.id, shop.name, channel.id, channel.name, pay, orders, buyers, newBuyers, status)
            // 约 7% 记录产生退款行，金额与正向成交分离，便于真实计算退款率。
            if (rand() < 0.07) {
              const amount = Math.round(pay * between(0.12, 0.58) * 100) / 100
              refund.run(dt, brand.id, brand.name, cat, CATEGORIES.find((c) => c.id === cat).name,
                shop.id, shop.name, channel.id, channel.name, amount)
              seq += 1
            }
          }
        }
      }
    }
  }
  return seq
}

function insertOrders(count) {
  const stmt = db.prepare('INSERT INTO dwd_trade_order_di VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
  const statuses = ['finished', 'finished', 'finished', 'paid', 'refunded', 'closed']
  for (let i = 0; i < count; i += 1) {
    const brand = pick(BRANDS)
    const shop = pick(SHOPS.filter((s) => s.brand === brand.id))
    const channel = pick(CHANNELS)
    const status = pick(statuses)
    const dt = `2026-10-${String(1 + Math.floor(rand() * 31)).padStart(2, '0')}`
    const pay = Math.round(between(120, 2600) * 100) / 100
    const refunded = status === 'refunded'
    stmt.run(
      `o${String(100000 + i)}`, dt, brand.id, shop.id, channel.id,
      `u${Math.floor(rand() * 5000)}`,
      refunded ? 0 : pay, refunded ? Math.round(pay * 0.7 * 100) / 100 : 0,
      status, rand() < 0.24 ? 1 : 0, refunded ? 1 : 0,
      `${dt} 10:${String(i % 60).padStart(2, '0')}:00`
    )
  }
}

function insertAdsDaily() {
  db.exec(`
    INSERT INTO ads_channel_daily
    SELECT dt,
      CASE WHEN channel_name IN ('天猫','淘宝') THEN '阿里系'
           WHEN channel_name IN ('京东','京东自营') THEN '京东系'
           ELSE '内容电商' END AS channel_name,
      ROUND(SUM(CASE WHEN is_refund = 0 THEN pay_amt ELSE 0 END), 2) AS gmv,
      ROUND(SUM(refund_amt), 2) AS refund_amt,
      SUM(CASE WHEN is_refund = 0 THEN order_cnt ELSE 0 END) AS order_cnt,
      SUM(CASE WHEN is_refund = 0 THEN buyer_cnt ELSE 0 END) AS buyer_cnt
    FROM dws_brand_trade_m
    GROUP BY dt, 2
  `)
}

insertBrands()
insertFacts()
insertOrders(120)
insertAdsDaily()

export function query(sql) {
  const started = performance.now()
  const stmt = db.prepare(sql)
  const rows = stmt.all()
  const ms = Math.round((performance.now() - started) * 10) / 10
  const columns = rows.length > 0
    ? Object.keys(rows[0])
    : (typeof stmt.columns === 'function' ? stmt.columns().map((c) => c.name) : [])
  return { columns, rows, ms, row_count: rows.length }
}

export function explain(sql) {
  try {
    const stmt = db.prepare(sql)
    return { ok: true, columns: typeof stmt.columns === 'function' ? stmt.columns().map((c) => c.name) : [] }
  } catch (error) {
    return { ok: false, error: String(error.message ?? error) }
  }
}

export function dbSummary() {
  const tableRows = db.prepare(`
    SELECT 'dws_brand_trade_m' AS name, COUNT(*) AS n FROM dws_brand_trade_m
    UNION ALL SELECT 'dwd_trade_order_di', COUNT(*) FROM dwd_trade_order_di
    UNION ALL SELECT 'ads_channel_daily', COUNT(*) FROM ads_channel_daily
    UNION ALL SELECT 'dim_brand', COUNT(*) FROM dim_brand
    UNION ALL SELECT 'dim_shop', COUNT(*) FROM dim_shop
    UNION ALL SELECT 'dim_category', COUNT(*) FROM dim_category
  `).all()
  return Object.fromEntries(tableRows.map((r) => [r.name, r.n]))
}
