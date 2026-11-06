import { createHash } from 'node:crypto'

/** 固定演示域与版本：任何结果都可回溯到这一版本体。 */
export const DOMAIN = {
  id: 'b2c_trade',
  name: 'B2C 品牌电商交易域',
  version: 'ont-b2c-trade@2026.11.1',
  owner: '数据研发 · 交易域',
  description: '品牌成交、退款、客单与新客口径；覆盖 6 张核心表与 12 条生产规则。'
}

/** 稳定指纹：本体侧唯一计算，模型只能回显，不能自行编造。 */
export function fingerprint(text) {
  return createHash('sha256').update(String(text)).digest('hex').slice(0, 16)
}

function rule(input) {
  const canonical = `${input.case_group}|${input.branch_order}|${input.condition_sql}|${input.action_sql}`
  return {
    ...input,
    fingerprint: fingerprint(canonical),
    source_sql_hash: fingerprint(input.source_sql),
    created_at: '2026-10-18',
    last_verified: '2026-11-04'
  }
}

export const TABLES = [
  {
    name: 'dws_brand_trade_m',
    role: 'delivery',
    grain: '品牌 × 品类 × 店铺 × 渠道 × 天',
    partition: 'dt（天分区）',
    owner: '交易数仓',
    row_count: 3371,
    description: '品牌交易月度汇总事实表，所有成交/退款指标的默认主表。',
    fields: [
      { name: 'dt', type: 'string', semantic: '分区日期', meaning: '业务日期，格式 yyyy-MM-dd' },
      { name: 'brand_id', type: 'string', semantic: '品牌ID', meaning: '品牌唯一标识' },
      { name: 'brand_name', type: 'string', semantic: '品牌名称', meaning: '品牌展示名' },
      { name: 'category_id', type: 'string', semantic: '品类ID', meaning: '叶子类目ID' },
      { name: 'category_name', type: 'string', semantic: '品类名称', meaning: '叶子类目名称，存在空值' },
      { name: 'shop_id', type: 'string', semantic: '店铺ID', meaning: '店铺唯一标识' },
      { name: 'shop_name', type: 'string', semantic: '店铺名称', meaning: '店铺全称，用于派生店铺类型' },
      { name: 'channel_id', type: 'string', semantic: '渠道ID', meaning: '成交渠道标识' },
      { name: 'channel_name', type: 'string', semantic: '渠道名称', meaning: '原始渠道：天猫/淘宝/京东/抖音/拼多多' },
      { name: 'pay_amt', type: 'double', semantic: '实付金额', meaning: '订单实付金额；退款记录为 0' },
      { name: 'refund_amt', type: 'double', semantic: '退款金额', meaning: '仅退款记录非 0' },
      { name: 'order_cnt', type: 'bigint', semantic: '订单数', meaning: '支付订单数，未去重' },
      { name: 'buyer_cnt', type: 'bigint', semantic: '买家数', meaning: '支付买家数（含老客）' },
      { name: 'new_buyer_cnt', type: 'bigint', semantic: '新客数', meaning: '历史首单买家数' },
      { name: 'is_refund', type: 'int', semantic: '退款标记', meaning: '1=退款记录，0=正向成交记录' },
      { name: 'order_status', type: 'string', semantic: '订单状态', meaning: 'paid/finished/refunded 等，汇总后仅保留主状态' }
    ]
  },
  {
    name: 'dim_brand',
    role: 'dim',
    grain: '品牌',
    partition: '无',
    owner: '品牌中台',
    row_count: 6,
    description: '品牌维表，提供品牌等级与主营品类。',
    fields: [
      { name: 'brand_id', type: 'string', semantic: '品牌ID', meaning: '主键' },
      { name: 'brand_name', type: 'string', semantic: '品牌名称', meaning: '品牌展示名' },
      { name: 'brand_level', type: 'string', semantic: '品牌等级', meaning: 'S/A/B/C，可能为空' },
      { name: 'main_category', type: 'string', semantic: '主营品类', meaning: '品牌主营一级类目' },
      { name: 'is_active', type: 'int', semantic: '是否有效', meaning: '1=有效品牌' }
    ]
  },
  {
    name: 'dim_shop',
    role: 'dim',
    grain: '店铺',
    partition: '无',
    owner: '商家中台',
    row_count: 8,
    description: '店铺维表；店铺类型以本表 shop_type 为准，不要在 SQL 里硬编码。',
    fields: [
      { name: 'shop_id', type: 'string', semantic: '店铺ID', meaning: '主键' },
      { name: 'shop_name', type: 'string', semantic: '店铺名称', meaning: '店铺全称' },
      { name: 'shop_type', type: 'string', semantic: '店铺类型', meaning: '品牌旗舰店/品牌专卖店/其他' },
      { name: 'brand_id', type: 'string', semantic: '品牌ID', meaning: '所属品牌' },
      { name: 'channel_id', type: 'string', semantic: '主渠道ID', meaning: '店铺主营渠道' },
      { name: 'open_date', type: 'string', semantic: '开店日期', meaning: 'yyyy-MM-dd' }
    ]
  },
  {
    name: 'dim_category',
    role: 'dim',
    grain: '类目',
    partition: '无',
    owner: '商品中台',
    row_count: 4,
    description: '叶子类目维表。',
    fields: [
      { name: 'category_id', type: 'string', semantic: '品类ID', meaning: '主键' },
      { name: 'category_name', type: 'string', semantic: '品类名称', meaning: '叶子类目名称' },
      { name: 'parent_id', type: 'string', semantic: '父类目ID', meaning: '一级类目ID' },
      { name: 'is_active', type: 'int', semantic: '是否有效', meaning: '1=有效' }
    ]
  },
  {
    name: 'dwd_trade_order_di',
    role: 'detail',
    grain: '订单',
    partition: 'dt（天分区）',
    owner: '交易明细',
    row_count: 120,
    description: '订单明细，用于归因与证据回溯，不作为汇总指标主表。',
    fields: [
      { name: 'order_id', type: 'string', semantic: '订单ID', meaning: '主键' },
      { name: 'dt', type: 'string', semantic: '分区日期', meaning: '支付日期' },
      { name: 'brand_id', type: 'string', semantic: '品牌ID', meaning: '品牌' },
      { name: 'shop_id', type: 'string', semantic: '店铺ID', meaning: '店铺' },
      { name: 'channel_id', type: 'string', semantic: '渠道ID', meaning: '成交渠道' },
      { name: 'buyer_id', type: 'string', semantic: '买家ID', meaning: '脱敏买家标识' },
      { name: 'pay_amt', type: 'double', semantic: '实付金额', meaning: '订单实付' },
      { name: 'refund_amt', type: 'double', semantic: '退款金额', meaning: '退款金额' },
      { name: 'order_status', type: 'string', semantic: '订单状态', meaning: 'paid/finished/refunded/closed' },
      { name: 'is_new_buyer', type: 'int', semantic: '是否新客', meaning: '1=历史首单' },
      { name: 'is_refund', type: 'int', semantic: '退款标记', meaning: '1=退款单' },
      { name: 'created_at', type: 'string', semantic: '创建时间', meaning: '订单创建时间' }
    ]
  },
  {
    name: 'ads_channel_daily',
    role: 'application',
    grain: '渠道 × 天',
    partition: 'dt（天分区）',
    owner: '经营分析',
    row_count: 294,
    description: '渠道日汇总应用表，口径已按渠道分组，不允许再叠加店铺类型规则。',
    fields: [
      { name: 'dt', type: 'string', semantic: '分区日期', meaning: '业务日期' },
      { name: 'channel_name', type: 'string', semantic: '渠道组', meaning: '阿里系/京东系/内容电商' },
      { name: 'gmv', type: 'double', semantic: '成交额', meaning: '已剔除退款' },
      { name: 'refund_amt', type: 'double', semantic: '退款额', meaning: '退款金额' },
      { name: 'order_cnt', type: 'bigint', semantic: '订单数', meaning: '支付订单数' },
      { name: 'buyer_cnt', type: 'bigint', semantic: '买家数', meaning: '支付买家数' }
    ]
  }
]

export const METRICS = [
  {
    id: 'gmv_paid',
    name: '成交额',
    aliases: ['成交额', '销售额', 'gmv', 'GMV', '交易额', '大盘成交'],
    definition: '统计周期内、剔除退款记录后的订单实付金额之和。',
    formula: 'SUM(pay_amt) WHERE is_refund = 0',
    numerator: 'pay_amt',
    denominator: null,
    filters: ['dt ∈ 统计周期', 'is_refund = 0'],
    time_window: '自然月（可覆盖为近 N 天）',
    source_tables: ['dws_brand_trade_m'],
    unit: '元',
    owner: '交易域',
    status: 'active'
  },
  {
    id: 'refund_rate',
    name: '退款率',
    aliases: ['退款率', '退货率', '退款占比'],
    definition: '退款金额 / 正向成交实付金额；分子含退款记录，分母剔除退款记录。',
    formula: 'SUM(refund_amt) / SUM(CASE WHEN is_refund = 0 THEN pay_amt END)',
    numerator: 'refund_amt',
    denominator: 'pay_amt (is_refund=0)',
    filters: ['dt ∈ 统计周期'],
    time_window: '自然月',
    source_tables: ['dws_brand_trade_m'],
    unit: 'ratio',
    owner: '交易域',
    status: 'active'
  },
  {
    id: 'order_cnt',
    name: '订单量',
    aliases: ['订单量', '订单数', '单量', '成交单量'],
    definition: '统计周期内正向成交订单数；退款记录不计入。',
    formula: 'SUM(order_cnt) WHERE is_refund = 0',
    numerator: 'order_cnt',
    denominator: null,
    filters: ['dt ∈ 统计周期', 'is_refund = 0'],
    time_window: '自然月',
    source_tables: ['dws_brand_trade_m'],
    unit: '单',
    owner: '交易域',
    status: 'active'
  },
  {
    id: 'aov',
    name: '客单价',
    aliases: ['客单价', '平均客单价', 'aov', 'AOV'],
    definition: '成交额 / 订单量；分子分母都剔除退款记录。',
    formula: 'SUM(pay_amt) / SUM(order_cnt) WHERE is_refund = 0',
    numerator: 'pay_amt',
    denominator: 'order_cnt',
    filters: ['dt ∈ 统计周期', 'is_refund = 0'],
    time_window: '自然月',
    source_tables: ['dws_brand_trade_m'],
    unit: '元/单',
    owner: '经营分析',
    status: 'active'
  },
  {
    id: 'new_buyer_cnt',
    name: '新客数',
    aliases: ['新客数', '新客', '新买家', '新买家数', '拉新数'],
    definition: '统计周期内历史首单买家数，使用 new_buyer_cnt，不得用 buyer_cnt 代替。',
    formula: 'SUM(new_buyer_cnt) WHERE is_refund = 0',
    numerator: 'new_buyer_cnt',
    denominator: null,
    filters: ['dt ∈ 统计周期', 'is_refund = 0'],
    time_window: '自然月',
    source_tables: ['dws_brand_trade_m'],
    unit: '人',
    owner: '用户增长',
    status: 'active'
  },
  {
    id: 'buyer_cnt',
    name: '买家数',
    aliases: ['买家数', '用户数', '成交用户数'],
    definition: '统计周期内支付买家数，包含老客。',
    formula: 'SUM(buyer_cnt) WHERE is_refund = 0',
    numerator: 'buyer_cnt',
    denominator: null,
    filters: ['dt ∈ 统计周期', 'is_refund = 0'],
    time_window: '自然月',
    source_tables: ['dws_brand_trade_m'],
    unit: '人',
    owner: '用户增长',
    status: 'active'
  }
]

export const RULES = [
  rule({
    id: 'rule_shop_type_flagship',
    case_group: 'shop_type',
    branch_order: 1,
    name: '店铺类型：旗舰店',
    condition_sql: "shop_name LIKE '%旗舰店%'",
    action_sql: "THEN '品牌旗舰店'",
    scope: { domain: 'b2c_trade', tables: ['dws_brand_trade_m'], fields: ['shop_name'] },
    status: 'active',
    confidence: 0.99,
    source_sql: "CASE WHEN shop_name LIKE '%旗舰店%' THEN '品牌旗舰店' ...",
    evidence_sql_node: 'sqlfact_shop_type_v3#branch_1',
    owner: '交易域',
    rationale: '生产 SQL 统一按店铺全称后缀派生，不允许直接使用 dim_shop.shop_type 之外的枚举。'
  }),
  rule({
    id: 'rule_shop_type_specialty',
    case_group: 'shop_type',
    branch_order: 2,
    name: '店铺类型：专卖店',
    condition_sql: "shop_name LIKE '%专卖店%'",
    action_sql: "THEN '品牌专卖店'",
    scope: { domain: 'b2c_trade', tables: ['dws_brand_trade_m'], fields: ['shop_name'] },
    status: 'active',
    confidence: 0.98,
    source_sql: "CASE WHEN shop_name LIKE '%专卖店%' THEN '品牌专卖店' ...",
    evidence_sql_node: 'sqlfact_shop_type_v3#branch_2',
    owner: '交易域',
    rationale: '注意顺序：先判旗舰店，再判专卖店，避免“旗舰专卖店”被误分。'
  }),
  rule({
    id: 'rule_shop_type_other',
    case_group: 'shop_type',
    branch_order: 3,
    name: '店铺类型：兜底',
    condition_sql: 'ELSE',
    action_sql: "THEN '其他'",
    scope: { domain: 'b2c_trade', tables: ['dws_brand_trade_m'], fields: ['shop_name'] },
    status: 'active',
    confidence: 0.95,
    source_sql: 'CASE ... ELSE \'其他\' END',
    evidence_sql_node: 'sqlfact_shop_type_v3#branch_3',
    owner: '交易域',
    rationale: '未命中的店铺必须归入“其他”，不能丢弃。'
  }),
  rule({
    id: 'rule_channel_ali',
    case_group: 'channel_group',
    branch_order: 1,
    name: '渠道组：阿里系',
    condition_sql: "channel_name IN ('天猫', '淘宝')",
    action_sql: "THEN '阿里系'",
    scope: { domain: 'b2c_trade', tables: ['dws_brand_trade_m'], fields: ['channel_name'] },
    status: 'active',
    confidence: 0.99,
    source_sql: "CASE WHEN channel_name IN ('天猫','淘宝') THEN '阿里系' ...",
    evidence_sql_node: 'sqlfact_channel_group_v2#branch_1',
    owner: '经营分析',
    rationale: '对外经营口径按渠道组汇报，不按原始渠道拆分。'
  }),
  rule({
    id: 'rule_channel_jd',
    case_group: 'channel_group',
    branch_order: 2,
    name: '渠道组：京东系',
    condition_sql: "channel_name IN ('京东', '京东自营')",
    action_sql: "THEN '京东系'",
    scope: { domain: 'b2c_trade', tables: ['dws_brand_trade_m'], fields: ['channel_name'] },
    status: 'active',
    confidence: 0.98,
    source_sql: "CASE WHEN channel_name IN ('京东','京东自营') THEN '京东系' ...",
    evidence_sql_node: 'sqlfact_channel_group_v2#branch_2',
    owner: '经营分析',
    rationale: '京东自营并入京东系，避免双算。'
  }),
  rule({
    id: 'rule_channel_content',
    case_group: 'channel_group',
    branch_order: 3,
    name: '渠道组：内容电商',
    condition_sql: "channel_name IN ('抖音', '快手', '小红书')",
    action_sql: "THEN '内容电商'",
    scope: { domain: 'b2c_trade', tables: ['dws_brand_trade_m'], fields: ['channel_name'] },
    status: 'active',
    confidence: 0.98,
    source_sql: "CASE WHEN channel_name IN ('抖音','快手','小红书') THEN '内容电商' ...",
    evidence_sql_node: 'sqlfact_channel_group_v2#branch_3',
    owner: '经营分析',
    rationale: '内容电商是经营分析固定分组。'
  }),
  rule({
    id: 'rule_valid_trade',
    case_group: 'valid_trade',
    branch_order: 1,
    name: '有效成交：剔除退款记录',
    condition_sql: 'is_refund = 1',
    action_sql: 'WHERE is_refund = 0',
    scope: { domain: 'b2c_trade', tables: ['dws_brand_trade_m'], fields: ['is_refund', 'pay_amt'] },
    status: 'active',
    confidence: 1,
    source_sql: 'WHERE dt BETWEEN ... AND is_refund = 0',
    evidence_sql_node: 'sqlfact_gmv_v5#where_1',
    owner: '交易域',
    rationale: '退款记录与正向成交同表，成交类指标必须显式剔除，否则金额被低估。'
  }),
  rule({
    id: 'rule_new_buyer',
    case_group: 'new_buyer',
    branch_order: 1,
    name: '新客口径',
    condition_sql: "metric_alias IN ('新客数', '新买家数')",
    action_sql: 'SUM(new_buyer_cnt)',
    scope: { domain: 'b2c_trade', tables: ['dws_brand_trade_m'], fields: ['new_buyer_cnt'] },
    status: 'active',
    confidence: 0.99,
    source_sql: 'SUM(new_buyer_cnt) AS new_buyer_cnt',
    evidence_sql_node: 'sqlfact_new_buyer_v2#metric_1',
    owner: '用户增长',
    rationale: 'buyer_cnt 含老客，不能代替新客数。'
  }),
  rule({
    id: 'rule_category_fallback',
    case_group: 'category_fallback',
    branch_order: 1,
    name: '品类空值兜底',
    condition_sql: 'category_name IS NULL',
    action_sql: "COALESCE(category_name, '未分类')",
    scope: { domain: 'b2c_trade', tables: ['dws_brand_trade_m'], fields: ['category_name'] },
    status: 'active',
    confidence: 0.97,
    source_sql: "COALESCE(category_name, '未分类') AS category_name",
    evidence_sql_node: 'sqlfact_category_v4#select_2',
    owner: '商品中台',
    rationale: 'NULL 品类直接分组会丢失，经营报表要求归入“未分类”。'
  }),
  rule({
    id: 'rule_brand_level_fallback',
    case_group: 'brand_level',
    branch_order: 1,
    name: '品牌等级兜底',
    condition_sql: 'brand_level IS NULL',
    action_sql: "COALESCE(brand_level, '未分级')",
    scope: { domain: 'b2c_trade', tables: ['dim_brand'], fields: ['brand_level'] },
    status: 'active',
    confidence: 0.96,
    source_sql: "COALESCE(b.brand_level, '未分级') AS brand_level",
    evidence_sql_node: 'sqlfact_brand_level_v1#select_3',
    owner: '品牌中台',
    rationale: '品牌等级为空时保留行，不因维表缺失丢成交。'
  }),
  rule({
    id: 'rule_time_fiscal',
    case_group: 'fiscal_calendar',
    branch_order: 1,
    name: '时间口径：自然月优先',
    condition_sql: "time_granularity = 'month' AND fiscal_flag = 0",
    action_sql: '自然月 1 日至月末',
    scope: { domain: 'b2c_trade', tables: ['dws_brand_trade_m'], fields: ['dt'] },
    status: 'active',
    confidence: 0.94,
    source_sql: 'dt >= 月初 AND dt <= 月末',
    evidence_sql_node: 'sqlfact_time_v2#calendar_1',
    owner: '交易域',
    rationale: '默认自然月；财年口径仅在明确说“财年/财月”时启用。'
  }),
  rule({
    id: 'rule_order_dedup',
    case_group: 'order_dedup',
    branch_order: 1,
    name: '订单去重口径',
    condition_sql: 'grain = order_id',
    action_sql: 'COUNT(DISTINCT order_id)',
    scope: { domain: 'b2c_trade', tables: ['dwd_trade_order_di'], fields: ['order_id'] },
    status: 'active',
    confidence: 0.99,
    source_sql: 'COUNT(DISTINCT order_id) AS order_cnt',
    evidence_sql_node: 'sqlfact_order_dedup_v2#metric_1',
    owner: '交易明细',
    rationale: '明细表按订单去重；汇总表直接 SUM(order_cnt) 不重复去重。'
  })
]

export const LINEAGE = [
  { from: 'dwd_trade_order_di', to: 'dws_brand_trade_m', op: '聚合', job: 'dws_brand_trade_m_daily', lag: 'T+1' },
  { from: 'dim_brand', to: 'dws_brand_trade_m', op: '维表关联', job: 'dws_brand_trade_m_daily', lag: 'T+1' },
  { from: 'dim_shop', to: 'dws_brand_trade_m', op: '维表关联', job: 'dws_brand_trade_m_daily', lag: 'T+1' },
  { from: 'dim_category', to: 'dws_brand_trade_m', op: '维表关联', job: 'dws_brand_trade_m_daily', lag: 'T+1' },
  { from: 'dws_brand_trade_m', to: 'ads_channel_daily', op: '渠道汇总', job: 'ads_channel_daily', lag: 'T+1' },
  { from: 'dim_brand', to: 'ads_channel_daily', op: '品牌属性', job: 'ads_channel_daily', lag: 'T+1' },
  { from: 'dwd_trade_order_di', to: 'ads_channel_daily', op: '明细校验', job: 'ads_channel_daily', lag: 'T+1' }
]

export const VALUE_PROFILES = [
  { table: 'dws_brand_trade_m', field: 'shop_name', values: [
    { value: '花漾旗舰店', pct: 18.2 }, { value: '花漾专卖店', pct: 11.4 },
    { value: '山野官方旗舰店', pct: 17.1 }, { value: '山野优选店', pct: 9.8 },
    { value: '初见旗舰店', pct: 15.6 }, { value: '北纬旗舰店', pct: 12.3 },
    { value: '云栖专卖店', pct: 8.9 }, { value: '拾光旗舰店', pct: 6.7 }
  ] },
  { table: 'dws_brand_trade_m', field: 'channel_name', values: [
    { value: '天猫', pct: 42.1 }, { value: '京东', pct: 26.4 },
    { value: '抖音', pct: 21.7 }, { value: '拼多多', pct: 9.8 }
  ] },
  { table: 'dwd_trade_order_di', field: 'order_status', values: [
    { value: 'finished', pct: 61.2 }, { value: 'paid', pct: 24.6 },
    { value: 'refunded', pct: 9.4 }, { value: 'closed', pct: 4.8 }
  ] }
]

export const SQL_FACTS = [
  {
    id: 'sqlfact_gmv_v5',
    title: '大促成交额标准写法',
    owner: '交易域',
    hash: fingerprint('sqlfact_gmv_v5'),
    snippet: "SELECT category_name, SUM(pay_amt) AS gmv\nFROM dws_brand_trade_m\nWHERE dt BETWEEN '2026-10-01' AND '2026-10-31'\n  AND is_refund = 0\nGROUP BY category_name",
    tags: ['成交额', 'gmv', 'is_refund', '自然月'],
    branch: 'where_1'
  },
  {
    id: 'sqlfact_shop_type_v3',
    title: '店铺类型 CASE 分支',
    owner: '交易域',
    hash: fingerprint('sqlfact_shop_type_v3'),
    snippet: "CASE WHEN shop_name LIKE '%旗舰店%' THEN '品牌旗舰店'\n     WHEN shop_name LIKE '%专卖店%' THEN '品牌专卖店'\n     ELSE '其他' END AS shop_type",
    tags: ['店铺类型', '旗舰店', '专卖店', 'case when'],
    branch: 'branch_2'
  },
  {
    id: 'sqlfact_channel_group_v2',
    title: '渠道组映射',
    owner: '经营分析',
    hash: fingerprint('sqlfact_channel_group_v2'),
    snippet: "CASE WHEN channel_name IN ('天猫','淘宝') THEN '阿里系'\n     WHEN channel_name IN ('京东','京东自营') THEN '京东系'\n     ELSE '内容电商' END AS channel_group",
    tags: ['渠道', '渠道组', '阿里系', '内容电商'],
    branch: 'branch_1'
  },
  {
    id: 'sqlfact_refund_rate_v4',
    title: '退款率分子分母',
    owner: '交易域',
    hash: fingerprint('sqlfact_refund_rate_v4'),
    snippet: "ROUND(SUM(refund_amt) / NULLIF(SUM(CASE WHEN is_refund = 0 THEN pay_amt END), 0), 4) AS refund_rate",
    tags: ['退款率', '退款', '分母', 'nullif'],
    branch: 'metric_1'
  }
]

export const TIME_SWITCHES = [
  { id: 'ts_natural_month', name: '自然月', expression: '当月 1 日 ~ 月末', enabled: true, effective_from: '2026-01-01' },
  { id: 'ts_fiscal', name: '财月（4 月制）', expression: '财年 4 月起算', enabled: false, effective_from: '2026-04-01' }
]

export const ONTOLOGY_STATS = {
  tables: TABLES.length,
  fields: TABLES.reduce((sum, table) => sum + table.fields.length, 0),
  metrics: METRICS.length,
  rules: RULES.length,
  activeRules: RULES.filter((r) => r.status === 'active').length,
  lineageEdges: LINEAGE.length,
  sqlFacts: SQL_FACTS.length,
  valueProfiles: VALUE_PROFILES.length
}

export const RULES_BY_GROUP = RULES.reduce((acc, r) => {
  ;(acc[r.case_group] ??= []).push(r)
  return acc
}, {})

export function tableByName(name) {
  return TABLES.find((table) => table.name === name)
}

export function metricById(id) {
  return METRICS.find((metric) => metric.id === id)
}
