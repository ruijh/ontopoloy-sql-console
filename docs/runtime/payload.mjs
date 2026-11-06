import {
  DOMAIN, LINEAGE, METRICS, ONTOLOGY_STATS, RULES, RULES_BY_GROUP,
  SQL_FACTS, TABLES, TIME_SWITCHES, VALUE_PROFILES
} from './ontology.mjs'
import { DB_ENGINE, dbSummary } from './db-browser.mjs'

/** /api/health 的响应体；静态版由浏览器适配层覆盖 engine / runtime。 */
export function healthPayload() {
  return {
    ok: true,
    service: 'ontsql-console',
    domain: DOMAIN.id,
    version: DOMAIN.version,
    engine: DB_ENGINE,
    runtime: 'server',
    llm_used: false,
    generator: 'deterministic-template-v1',
    ...dbSummary()
  }
}

/** /api/ontology 的响应体；表行数来自当前执行库，而不是写死常量。 */
export function ontologyPayload() {
  const db = dbSummary()
  return {
    domain: DOMAIN,
    stats: ONTOLOGY_STATS,
    tables: TABLES.map((table) => ({ ...table, row_count: db[table.name] ?? table.row_count })),
    metrics: METRICS,
    rules: RULES,
    rules_by_group: RULES_BY_GROUP,
    lineage: LINEAGE,
    value_profiles: VALUE_PROFILES,
    sql_facts: SQL_FACTS,
    time_switches: TIME_SWITCHES,
    db
  }
}
