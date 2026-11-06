const API = 'api';
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const state = {
  tab: 'generate',
  answer: null,
  evalData: null,
  ontology: null,
  feedback: [],
  ontTab: 'tables',
  ontSearch: '',
  runSeq: 0,
};

const THEME_KEY = 'ontsql.theme.v1';
const THEMES = [
  {
    id: 'palantir-dark', label: 'Palantir · 深色', family: 'Palantir', mode: '深色',
    desc: '指挥台 · 琥珀/青', colors: ['#06090d', '#e8a94f', '#67d8d0'],
  },
  {
    id: 'palantir-light', label: 'Palantir · 浅色', family: 'Palantir', mode: '浅色',
    desc: '图纸 · 赭石/墨', colors: ['#f2efe7', '#965c16', '#2b62a4'],
  },
  {
    id: 'macos-dark', label: 'macOS · 深色', family: 'macOS', mode: '深色',
    desc: '石墨玻璃 · SF 蓝', colors: ['#161617', '#409cff', '#bf5af2'],
  },
  {
    id: 'macos-light', label: 'macOS · 浅色', family: 'macOS', mode: '浅色',
    desc: '雾白玻璃 · SF 蓝', colors: ['#f5f5f7', '#0066cc', '#8944ab'],
  },
  {
    id: 'console-dark', label: 'Console · 深色', family: 'Console', mode: '深色',
    desc: '磷光终端 · 网格', colors: ['#070b08', '#5ee6a8', '#72c7ff'],
  },
  {
    id: 'console-light', label: 'Console · 浅色', family: 'Console', mode: '浅色',
    desc: '绿纸终端 · 墨绿', colors: ['#eff4ef', '#126e46', '#236b9e'],
  },
];
let currentTheme = 'palantir-dark';

const themeById = (id) => THEMES.find((theme) => theme.id === id);

function renderThemes() {
  const grid = $('#theme-grid');
  if (!grid) return;
  grid.innerHTML = THEMES.map((theme) => `
    <button type="button" class="theme-option" data-theme="${theme.id}" role="radio"
            aria-checked="${theme.id === currentTheme}" tabindex="${theme.id === currentTheme ? '0' : '-1'}"
            title="${esc(theme.label)}">
      <span class="theme-option-swatch" aria-hidden="true">${theme.colors.map((color) => `<i style="background:${color}"></i>`).join('')}</span>
      <span class="theme-option-copy"><b>${esc(theme.family)}</b><small>${esc(theme.mode)} · ${esc(theme.desc)}</small></span>
      <span class="theme-option-check" aria-hidden="true">✓</span>
    </button>`).join('');
}

function applyTheme(id, { persist = true, announce = false } = {}) {
  const theme = themeById(id);
  if (!theme) return;
  currentTheme = theme.id;
  document.documentElement.setAttribute('data-theme', theme.id);
  document.documentElement.style.colorScheme = theme.mode === '深色' ? 'dark' : 'light';

  const label = $('#theme-label');
  if (label) label.textContent = theme.label;
  const trigger = $('#theme-trigger');
  if (trigger) {
    trigger.setAttribute('aria-label', `界面主题：${theme.label}`);
    trigger.title = `界面主题：${theme.label}（Ctrl/Cmd + Shift + L 轮换）`;
  }
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme.colors[0]);

  if (persist) {
    try { localStorage.setItem(THEME_KEY, theme.id); } catch (e) {}
  }
  renderThemes();
  if (announce) toast(`主题已切换：${theme.label}`);
}

function setThemeMenu(open) {
  const popover = $('#theme-popover');
  const trigger = $('#theme-trigger');
  if (!popover || !trigger) return;
  popover.hidden = !open;
  trigger.setAttribute('aria-expanded', String(open));
  if (open) {
    const checked = popover.querySelector('[aria-checked="true"]');
    if (checked && typeof checked.focus === 'function') checked.focus();
  }
}

function bindTheme() {
  const trigger = $('#theme-trigger');
  const popover = $('#theme-popover');
  const grid = $('#theme-grid');
  if (!trigger || !popover || !grid) return;

  trigger.addEventListener('click', () => setThemeMenu(popover.hidden));

  grid.addEventListener('click', (event) => {
    const option = event.target.closest?.('[data-theme]');
    if (!option) return;
    applyTheme(option.dataset.theme, { persist: true, announce: true });
    setThemeMenu(false);
    trigger.focus();
  });

  grid.addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    const options = $$('#theme-grid .theme-option');
    if (!options.length) return;
    event.preventDefault();
    const step = (event.key === 'ArrowRight' || event.key === 'ArrowDown') ? 1 : -1;
    const at = options.indexOf(document.activeElement);
    const next = options[(at + step + options.length) % options.length];
    if (next && typeof next.focus === 'function') next.focus();
  });

  document.addEventListener('click', (event) => {
    if (popover.hidden) return;
    if (event.target.closest?.('#theme-menu')) return;
    setThemeMenu(false);
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !popover.hidden) {
      setThemeMenu(false);
      trigger.focus();
      return;
    }
    if (event.repeat) return;
    if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'l') {
      event.preventDefault();
      const at = THEMES.findIndex((theme) => theme.id === currentTheme);
      const next = THEMES[(at + 1) % THEMES.length];
      applyTheme(next.id, { persist: true, announce: true });
      if (!popover.hidden) setThemeMenu(true);
    }
  });
}

function initTheme() {
  let stored = null;
  try { stored = localStorage.getItem(THEME_KEY); } catch (e) {}
  const booted = document.documentElement.dataset.theme;
  const initial = themeById(stored) ? stored : (themeById(booted) ? booted : 'palantir-dark');
  applyTheme(initial, { persist: false });
  setThemeMenu(false);
  bindTheme();
}

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[ch]));

const fmtInt = (n) => Number(n).toLocaleString('zh-CN');
const fmtDate = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return esc(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

async function api(path, options = {}) {
  const init = { headers: {}, ...options };
  if (init.body && typeof init.body !== 'string') {
    init.body = JSON.stringify(init.body);
    init.headers['content-type'] = 'application/json';
  }
  const res = await fetch(`${API}/${path}`, init);
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { error: text || '响应不是 JSON' }; }
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  return data;
}

let toastTimer = 0;
function toast(message, bad = false) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.toggle('bad', bad);
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

/* ---------- tabs ---------- */
function showTab(name) {
  state.tab = name;
  $$('.tab').forEach((btn) => btn.classList.toggle('active', btn.dataset.tab === name));
  $$('.view').forEach((view) => { view.hidden = view.id !== `view-${name}`; });
  if (name === 'eval' && state.evalData) renderEval(state.evalData);
  if (name === 'ontology' && state.ontology) renderOntology();
  if (name === 'feedback') loadFeedback();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ---------- health ---------- */
async function loadHealth() {
  try {
    const data = await api('health');
    const total = ['dws_brand_trade_m', 'dwd_trade_order_di', 'ads_channel_daily', 'dim_brand', 'dim_shop', 'dim_category']
      .reduce((sum, key) => sum + (Number(data[key]) || 0), 0);
    $('#health-text').textContent = data.runtime === 'static'
      ? `SQLite WASM · ${fmtInt(total)} 行`
      : `SQLite 在线 · ${fmtInt(total)} 行`;
    $('#version-pill').textContent = data.version || 'ont-b2c-trade@2026.11.1';
  } catch (error) {
    $('#health-text').textContent = '服务不可达';
    $('#health-text').previousElementSibling?.style.setProperty('background', 'var(--red)');
    console.warn('health failed', error);
  }
}

/* ---------- pipeline ---------- */
const PIPE_ORDER = ['intent', 'recall', 'generate', 'validate', 'execute'];
function pipelineBusy() {
  $$('.pipe-step').forEach((el, i) => {
    el.classList.remove('done', 'fail');
    el.classList.toggle('active', i === 0);
    const em = el.querySelector('em');
    if (em) em.textContent = '—';
  });
}
function pipelineDone(trace = [], failed = false) {
  $$('.pipe-step').forEach((el, i) => {
    el.classList.remove('active');
    const t = trace[i];
    const em = el.querySelector('em');
    if (em && t) em.textContent = `${Number(t.ms).toFixed(t.ms < 10 ? 1 : 0)}ms`;
    if (failed && i === PIPE_ORDER.length - 1) {
      el.classList.remove('done');
      el.classList.add('fail');
      if (em) em.textContent = '拦截';
    } else {
      el.classList.add('done');
    }
  });
}

/* ---------- SQL highlight ---------- */
const SQL_KEYWORDS = new Set('SELECT FROM WHERE GROUP BY ORDER LIMIT AS AND OR CASE WHEN THEN ELSE END JOIN LEFT RIGHT INNER OUTER ON WITH UNION ALL DISTINCT BETWEEN IN IS NOT NULL DESC ASC HAVING EXISTS'.split(' '));
const SQL_FUNCS = new Set('ROUND SUM COUNT AVG MIN MAX COALESCE NULLIF CAST ABS'.split(' '));

function sqlHtml(sql) {
  const re = /(--[^\n]*|'(?:[^']|'')*'|\b\d+(?:\.\d+)?\b|\b[A-Za-z_]+\b)/g;
  let out = '';
  let last = 0;
  let match;
  while ((match = re.exec(sql)) !== null) {
    out += esc(sql.slice(last, match.index));
    const token = match[0];
    let cls = '';
    if (token.startsWith('--')) cls = 'hl-com';
    else if (token.startsWith("'")) cls = 'hl-str';
    else if (/^\d/.test(token)) cls = 'hl-num';
    else if (SQL_KEYWORDS.has(token.toUpperCase())) cls = 'hl-kw';
    else if (SQL_FUNCS.has(token.toUpperCase())) cls = 'hl-fn';
    out += cls ? `<span class="${cls}">${esc(token)}</span>` : esc(token);
    last = match.index + token.length;
  }
  return out + esc(sql.slice(last));
}

/* ---------- answer ---------- */
function renderIntent(data) {
  const intent = data.intent;
  const chips = [];
  intent.metrics.forEach((m) => chips.push(`<span class="chip accent"><span class="chip-label">指标</span><span class="chip-value">${esc(m.name)}</span><span class="mono muted">${esc(m.id)}</span></span>`));
  intent.dimensions.forEach((d) => chips.push(`<span class="chip blue"><span class="chip-label">维度</span><span class="chip-value">${esc(d.label)}</span></span>`));
  chips.push(`<span class="chip violet"><span class="chip-label">时间</span><span class="chip-value">${esc(intent.time_range.label)}</span><span class="mono muted">${esc(intent.time_range.start)} ~ ${esc(intent.time_range.end)}</span></span>`);
  if (intent.time_range.compare_label) {
    chips.push(`<span class="chip violet"><span class="chip-label">对比</span><span class="chip-value">${esc(intent.comparison_label || '对比')}</span><span class="mono muted">${esc(intent.time_range.compare_start)} ~ ${esc(intent.time_range.compare_end)}</span></span>`);
  }
  intent.filters.forEach((f) => chips.push(`<span class="chip green"><span class="chip-label">过滤</span><span class="chip-value">${esc(f.label)}</span></span>`));
  chips.push(`<span class="chip"><span class="chip-label">TopN</span><span class="chip-value">${esc(intent.top_n)}</span></span>`);
  if (intent.ambiguities.length) {
    intent.ambiguities.forEach((a) => chips.push(`<span class="chip" style="border-color:rgba(255,125,136,.3)"><span class="chip-label">歧义</span><span class="chip-value">${esc(a)}</span></span>`));
  }
  chips.push(`<div class="intent-note">意图由确定性字典解析，未调用 LLM；领域 <span class="mono">${esc(intent.domain)}</span>，任务 <span class="mono">${esc(intent.task)}</span>。</div>`);
  $('#intent-body').className = 'intent-body';
  $('#intent-body').innerHTML = chips.join('');
  const badge = $('#confidence-badge');
  badge.textContent = `置信度 ${intent.confidence.toFixed(2)}`;
  badge.className = `badge ${intent.confidence >= 0.8 ? 'badge-pass' : 'badge-warn'}`;
}

function renderSQL(data) {
  const sql = data.sql;
  $('#sql-code').innerHTML = sqlHtml(sql);
  $('#sql-dialect').textContent = `${data.sql_meta.dialect} → ${data.sql_meta.engine_dialect}`;
  const meta = [];
  data.sql_meta.tables.forEach((t) => meta.push(`<span class="badge mono">FROM ${esc(t)}</span>`));
  data.sql_meta.rules.forEach((r) => meta.push(`<span class="badge rule" title="${esc(r.fingerprint)}">${esc(r.title)}</span>`));
  meta.push(`<span class="badge mono">${sql.split('\n').length} 行</span>`);
  meta.push(`<span class="badge mono">${esc(data.version)}</span>`);
  $('#sql-meta').innerHTML = meta.join('');
}

function renderValidation(data) {
  const checks = data.validation.checks || [];
  const passed = checks.filter((c) => c.pass).length;
  const total = checks.length;
  const summary = $('#val-summary');
  summary.innerHTML = `<strong>${passed}</strong><span>/ ${total}</span>`;
  summary.classList.toggle('fail', passed !== total);
  $('#check-grid').innerHTML = checks.map((c) => `
    <div class="check-item ${c.pass ? '' : 'fail'}" title="${esc(c.detail)}">
      <span class="check-mark">${c.pass ? '✓' : '×'}</span>
      <span class="check-copy"><span class="check-id">${esc(c.id)}</span><span class="check-name">${esc(c.label)}</span><span class="check-detail">${esc(c.detail)}</span></span>
    </div>`).join('');
}

function cellValue(column, value) {
  if (value === null || value === undefined) return '<span class="muted">—</span>';
  if (typeof value === 'number') {
    if (/_pct$/.test(column)) return `${value.toFixed(2)}%`;
    if (/rate$/.test(column)) return `${(value * 100).toFixed(2)}%`;
    if (/^(gmv|aov|pay_amt|refund_amt|amount)$/.test(column)) return `¥${value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    if (Number.isInteger(value)) return fmtInt(value);
    return value.toFixed(2);
  }
  return esc(value);
}

function renderExecution(data) {
  const execution = data.execution;
  if (execution.skipped) {
    $('#result-meta').textContent = '已跳过执行';
    $('#result-table').innerHTML = `<p class="empty">${esc(execution.error || '校验未通过，按 fail-closed 策略不执行 SQL')}</p>`;
    $('#data-quality').innerHTML = '';
    return;
  }
  const columns = execution.columns || [];
  const rows = execution.rows || [];
  $('#result-meta').textContent = `${fmtInt(execution.row_count)} 行 · ${execution.ms} ms`;
  if (!rows.length) {
    $('#result-table').innerHTML = '<p class="empty">查询成功，但没有返回数据。</p>';
  } else {
    const numeric = new Set(columns.filter((c) => rows.some((r) => typeof r[c] === 'number')));
    const thead = `<thead><tr>${columns.map((c) => `<th class="${numeric.has(c) ? 'num' : ''}">${esc(c)}</th>`).join('')}</tr></thead>`;
    const tbody = rows.map((row) => `<tr>${columns.map((c) => `<td class="${numeric.has(c) ? 'num' : 'dim'}">${cellValue(c, row[c])}</td>`).join('')}</tr>`).join('');
    $('#result-table').innerHTML = `<table>${thead}<tbody>${tbody}</tbody></table>`;
  }
  const dq = data.data_quality;
  const notes = [];
  notes.push(`扫描 ${fmtInt(execution.scanned_rows || 0)} 行`);
  notes.push(dq.empty ? '结果为空' : '结果非空');
  notes.push(dq.null_dimension ? '维度存在空值（已按规则兜底）' : '维度无空值');
  notes.push(dq.fully_qualified ? '字段全限定' : '存在未限定字段');
  (data.warnings || []).forEach((w) => notes.push(`⚠ ${w}`));
  (data.assumptions || []).forEach((a) => notes.push(`假设：${a}`));
  $('#data-quality').innerHTML = notes.map((n) => `<span>${esc(n)}</span>`).join('');
}

function renderRecall(data) {
  const coverage = data.recall.coverage;
  $('#recall-coverage').textContent = `${coverage.routes_hit} / ${coverage.routes_total}`;
  const maxHits = Math.max(1, ...data.recall.routes.map((r) => r.hit_count));
  $('#routes').innerHTML = data.recall.routes.map((r) => {
    const miss = r.hit_count === 0;
    const width = Math.max(4, (r.hit_count / maxHits) * 100);
    const items = r.items.length
      ? `<ul class="route-items">${r.items.slice(0, 3).map((x) => `<li><b>${esc(x.title)}</b> · ${esc((x.detail || '').slice(0, 80))}</li>`).join('')}</ul>`
      : '<div class="route-items muted">本问题未命中该路</div>';
    return `<details class="route ${miss ? 'miss' : ''}" ${miss ? '' : 'open'}>
      <summary><div class="route-head"><span class="route-code">${esc(r.id)}</span><span class="route-name">${esc(r.name)}</span><span class="route-stats">w${r.weight} · ${r.hit_count}</span></div>
      <div class="route-bar"><span class="route-fill" style="width:${width}%"></span></div></summary>${items}</details>`;
  }).join('');
}

function renderPack(data) {
  const pack = data.pack;
  $('#pack-id').textContent = pack.pack_id;
  const pct = Math.min(100, (pack.used_tokens / pack.budget) * 100);
  $('#token-fill').style.width = `${Math.max(3, pct)}%`;
  $('#token-used').textContent = `${fmtInt(pack.used_tokens)} tokens`;
  $('#token-budget').textContent = `预算 ${fmtInt(pack.budget)}`;
  const maxSection = Math.max(1, ...pack.sections.map((s) => s.items.reduce((sum, i) => sum + (i.tokens || 0), 0)));
  $('#pack-list').innerHTML = pack.sections.map((s) => {
    const used = s.items.reduce((sum, i) => sum + (i.tokens || 0), 0);
    return `<div class="pack-row"><span>${esc(s.route)} ${esc(s.name)}</span><span class="pack-mini"><i style="width:${Math.max(2, (used / maxSection) * 100)}%"></i></span><em>${used}t</em></div>`;
  }).join('');
  const dropped = pack.dropped?.length || 0;
  $('#pack-list').insertAdjacentHTML('beforeend', `<div class="pack-note">pack 指纹 ${esc(pack.pack_id)} · 硬上限 ${fmtInt(pack.hard_cap)} tokens · 丢弃 ${dropped} 项</div>`);
}

function renderCitations(data) {
  $('#citation-count').textContent = data.citations.length;
  $('#citations').innerHTML = data.citations.length
    ? data.citations.map((c) => `<div class="citation ${esc(c.type)}">
        <div class="cite-top"><span class="cite-type">${esc(c.type)}</span><span class="cite-title">${esc(c.title)}</span></div>
        <div class="cite-detail">${esc(c.detail)} ${c.fingerprint ? `· <code>${esc(c.fingerprint)}</code>` : ''} <span class="mono">· ${esc(c.source)} w${c.route_weight}</span></div>
      </div>`).join('')
    : '<p class="empty">无引用</p>';
}

function renderAnswer(data) {
  state.answer = data;
  renderIntent(data);
  renderSQL(data);
  renderValidation(data);
  renderExecution(data);
  renderRecall(data);
  renderPack(data);
  renderCitations(data);
  pipelineDone(data.trace, data.status === 'fail_closed');
  const statusLabel = { ok: '校验通过', fail_closed: '已拦截', baseline: 'baseline' }[data.status] || data.status;
  $('#run-status').textContent = `${statusLabel} · ${data.total_ms} ms · 12 项校验`;
  $('#run-status').classList.toggle('badge-fail', data.status === 'fail_closed');

  if (data.status === 'fail_closed') {
    const failed = data.validation.failed?.join('、') || '未知';
    $('#error-banner').hidden = false;
    $('#error-banner').textContent = `校验未通过（${failed}），按 fail-closed 策略拦截执行。请查看校验清单与引用。`;
  }
  syncFeedbackPrefill(data);
}

function syncFeedbackPrefill(data) {
  const q = data.intent.question;
  if ($('#fb-question').dataset.q === q) return;
  $('#fb-question').value = q;
  $('#fb-ai').value = data.sql;
  $('#fb-final').value = '';
  $('#fb-question').dataset.q = q;
}

async function runQuery(question) {
  const q = String(question || '').trim();
  if (!q) return;
  const seq = ++state.runSeq;
  $('#question').value = q;
  $('#run-btn').disabled = true;
  $('#error-banner').hidden = true;
  $('#run-status').textContent = '召回与校验中…';
  pipelineBusy();
  try {
    const data = await api('generate', { method: 'POST', body: { question: q } });
    if (seq !== state.runSeq) return;
    renderAnswer(data);
    const url = new URL(window.location.href);
    url.searchParams.set('q', q);
    history.replaceState(null, '', url);
  } catch (error) {
    if (seq !== state.runSeq) return;
    pipelineDone([], true);
    $('#run-status').textContent = '请求失败';
    $('#error-banner').hidden = false;
    $('#error-banner').textContent = `生成失败：${error.message}`;
    toast(error.message, true);
  } finally {
    if (seq === state.runSeq) $('#run-btn').disabled = false;
  }
}

/* ---------- eval ---------- */
const LAYERS = [
  { key: 'syntax', name: '语法层', sub: 'syntax', max: 80 },
  { key: 'table', name: '表层', sub: 'table', max: 160 },
  { key: 'field', name: '字段层', sub: 'field', max: 160 },
  { key: 'rule', name: '规则层', sub: 'rule', max: 320 },
  { key: 'data', name: '数据层', sub: 'data', max: 80 },
];
const DIMS = [
  { key: 'syntax', max: 10, label: '语法' },
  { key: 'table', max: 20, label: '表' },
  { key: 'field', max: 20, label: '字段' },
  { key: 'rule', max: 40, label: '规则' },
  { key: 'data', max: 10, label: '数据' },
];

function scClass(value, max) {
  if (value >= max) return 'full';
  if (value <= 0) return 'zero';
  return 'part';
}

function renderEval(data) {
  const ont = data.ontology;
  const base = data.baseline;
  const cmp = data.comparison;
  const layerRows = LAYERS.map((layer) => {
    const onVal = ont.summary.layers[layer.key] || 0;
    const baseVal = base.summary.layers[layer.key] || 0;
    return `<div class="layer-row">
      <div class="layer-name">${layer.name}<small>${layer.sub} · ${layer.max}</small></div>
      <div class="layer-bar">
        <span class="on"><i style="width:${(onVal / layer.max) * 100}%"></i></span>
        <span class="base"><i style="width:${(baseVal / layer.max) * 100}%"></i></span>
      </div>
      <div class="layer-nums"><b>${onVal}</b> / ${baseVal}</div>
    </div>`;
  }).join('');

  const baseById = new Map(base.cases.map((c) => [c.id, c]));
  const caseRows = ont.cases.map((c) => {
    const b = baseById.get(c.id);
    const scores = DIMS.map((d) => {
      const v = c.scores[d.key];
      return `<span class="sc ${scClass(v, d.max)}" title="${d.label} ${v}/${d.max}">${v}</span>`;
    }).join('');
    const baseWhy = !b ? '—' : b.pass
      ? '<span class="good">baseline 也通过</span>'
      : b.attribution.slice(0, 2).map((x) => `<span class="bad">${esc(x)}</span>`).join('<br>');
    return `<tr>
      <td class="case-id">${esc(c.id)}</td>
      <td><div class="case-q">${esc(c.question)}</div><div class="case-layer">${esc(c.layer)} · ${esc(c.difficulty)}</div></td>
      <td><div class="case-scores">${scores}</div></td>
      <td class="case-total pass">${c.total}</td>
      <td class="case-total ${b?.pass ? 'pass' : 'fail'}">${b ? b.total : '—'}</td>
      <td class="case-delta">${b ? (c.total - b.total > 0 ? '+' : '') + (c.total - b.total) : '—'}</td>
      <td class="case-why">${baseWhy}</td>
    </tr>`;
  }).join('');

  $('#eval-body').innerHTML = `
    <div class="score-hero">
      <div class="score-panel win">
        <div class="score-label"><span>本体增强</span><span class="mono">${esc(data.version)}</span></div>
        <div class="score-big"><strong>${ont.summary.avg_score}</strong><span>/ 100 均分</span></div>
        <div class="score-stats"><span>通过 <b>${ont.summary.passed}/${ont.summary.total}</b></span><span>严格通过 <b>${ont.summary.strict_passed}</b></span><span>规则层 <b>${ont.summary.layers.rule}/320</b></span></div>
      </div>
      <div class="score-panel lose">
        <div class="score-label"><span>无本体 baseline</span><span class="mono">同模板 · 去规则</span></div>
        <div class="score-big"><strong>${base.summary.avg_score}</strong><span>/ 100 均分</span></div>
        <div class="score-stats"><span>通过 <b>${base.summary.passed}/${base.summary.total}</b></span><span>严格通过 <b>${base.summary.strict_passed}</b></span><span>规则层 <b>${base.summary.layers.rule}/320</b></span></div>
      </div>
    </div>
    <div class="delta-strip">
      <span>本体带来的增量：通过 <strong>+${cmp.pass_delta}</strong> 例 · 均分 <strong>+${cmp.avg_delta}</strong></span>
      <span>规则层 <strong>+${cmp.rule_layer_delta}</strong> · 数据层 <strong>+${cmp.data_layer_delta}</strong></span>
      <span class="mono">${data.duration_ms}ms · ${esc(data.run_at)}</span>
    </div>
    <section class="card layer-card">
      <div class="card-head"><div><div class="eyebrow">Score Layers</div><h3>五层评分（本体 vs baseline）</h3></div><span class="badge mono">10 / 20 / 20 / 40 / 10</span></div>
      <div class="layer-list">${layerRows}</div>
      <div class="legend"><span>上层色条 = 本体增强</span><span>下层色条 = baseline</span><span>分值按层汇总，满分 800</span></div>
    </section>
    <section class="card cases-card">
      <div class="card-head"><div><div class="eyebrow">Cases</div><h3>逐例对比</h3></div><span class="badge mono">8 cases</span></div>
      <div class="table-wrap"><table class="case-table">
        <thead><tr><th>ID</th><th>问题 / 层</th><th>五维得分</th><th>本体</th><th>baseline</th><th>Δ</th><th>baseline 归因</th></tr></thead>
        <tbody>${caseRows}</tbody>
      </table></div>
      <div class="legend">
        <span>评分：语法 10 · 表 20 · 字段 20 · 规则 40 · 数据 10；<b>pass = 总分 ≥ 80</b></span>
        <span>strict = pass 且规则满分且数据满分</span>
        <span>防泄漏：${esc(data.anti_leak)}</span>
      </div>
    </section>`;
}

async function loadEval(refresh = false) {
  const btn = $('#refresh-eval');
  btn.disabled = true;
  btn.textContent = refresh ? '评测中…' : '加载中…';
  try {
    const data = refresh
      ? await api('eval', { method: 'POST', body: { refresh: true } })
      : await api('eval');
    state.evalData = data;
    if (state.tab === 'eval') renderEval(data);
  } catch (error) {
    toast(`评测加载失败：${error.message}`, true);
    if (state.tab === 'eval') $('#eval-body').innerHTML = `<div class="empty-block">评测加载失败：${esc(error.message)}</div>`;
  } finally {
    btn.disabled = false;
    btn.textContent = '重新评测';
  }
}

/* ---------- ontology ---------- */
const GROUP_LABELS = {
  shop_type: '店铺类型派生', channel_group: '渠道分组', valid_trade: '有效成交 / 退款', new_buyer: '新客口径',
  category_fallback: '品类空值兜底', brand_level: '品牌等级', fiscal_calendar: '自然月 / 财年', order_dedup: '订单去重',
};

function matches(query, ...values) {
  if (!query) return true;
  return values.join(' ').toLowerCase().includes(query);
}

function renderOntologyStats() {
  const s = state.ontology.stats;
  const cards = [
    [s.tables, '核心表'], [s.fields, '字段语义'], [s.metrics, '指标口径'], [s.rules, '生产规则'],
    [s.lineageEdges, '血缘边'], [s.sqlFacts + s.valueProfiles, '生产证据'],
  ];
  $('#ontology-stats').innerHTML = cards.map(([num, label]) => `<div class="stat-card"><div class="stat-num">${num}</div><div class="stat-label">${label}</div></div>`).join('');
}

function renderOntologyTables(q) {
  const tables = state.ontology.tables;
  const cards = tables.map((t) => {
    const fields = q ? t.fields.filter((f) => matches(q, f.name, f.semantic, f.meaning, t.name)) : t.fields;
    if (q && fields.length === 0 && !matches(q, t.name, t.description, t.grain, t.role)) return '';
    return `<article class="asset-card">
      <div class="asset-title"><h4>${esc(t.name)}</h4><span class="mono">${esc(t.role)}</span></div>
      <p class="asset-desc">${esc(t.description)}</p>
      <div class="asset-meta"><span class="badge">粒度 ${esc(t.grain)}</span><span class="badge mono">${esc(t.partition)}</span><span class="badge mono">${fmtInt(t.row_count)} rows</span><span class="badge">${fields.length} 字段</span></div>
      <details ${q ? 'open' : ''}><summary>字段语义（${fields.length}）</summary>
        <table class="field-table"><thead><tr><th>字段</th><th>类型</th><th>语义</th></tr></thead><tbody>
        ${fields.map((f) => `<tr><td class="mono">${esc(f.name)}${f.pii ? ' <span class="pii">PII</span>' : ''}</td><td class="mono">${esc(f.type)}</td><td>${esc(f.semantic)}<br><span class="muted">${esc(f.meaning)}</span></td></tr>`).join('')}
        </tbody></table></details>
    </article>`;
  }).filter(Boolean).join('');
  return `<div class="asset-grid">${cards || '<div class="empty-block">没有匹配的表或字段</div>'}</div>`;
}

function renderOntologyMetrics(q) {
  const metrics = state.ontology.metrics.filter((m) => matches(q, m.name, m.id, m.definition, m.formula, ...(m.aliases || [])));
  if (!metrics.length) return '<div class="empty-block">没有匹配的指标</div>';
  return `<div class="asset-grid">${metrics.map((m) => `<article class="asset-card">
    <div class="asset-title"><h4>${esc(m.name)}</h4><span class="mono">${esc(m.id)}</span>${m.status === 'active' ? '<span class="badge badge-pass">active</span>' : ''}</div>
    <p class="asset-desc">${esc(m.definition)}</p>
    <div class="asset-meta"><span class="badge mono">${esc(m.unit)}</span><span class="badge">${esc(m.time_window)}</span><span class="badge mono">${esc(m.owner)}</span></div>
    <div class="evidence-row"><b>公式</b> <code>${esc(m.formula)}</code></div>
    <div class="evidence-row" style="border-left-color:var(--line)"><b>别名</b> ${esc((m.aliases || []).join(' / '))}</div>
    <div class="asset-meta" style="margin-top:8px">${m.source_tables.map((t) => `<span class="badge mono">${esc(t)}</span>`).join('')}</div>
  </article>`).join('')}</div>`;
}

function renderOntologyRules(q) {
  const groups = Object.entries(state.ontology.rules_by_group).map(([group, rules]) => {
    const filtered = rules.filter((r) => matches(q, group, GROUP_LABELS[group] || group, r.name, r.condition_sql, r.action_sql, r.rationale, r.fingerprint));
    if (!filtered.length) return '';
    return `<article class="asset-card wide">
      <div class="asset-title"><h4>${esc(GROUP_LABELS[group] || group)}</h4><span class="mono">${esc(group)} · ${filtered.length} branches</span></div>
      ${filtered.map((r) => `<div class="rule-card">
        <div class="rule-head"><h4>${esc(r.name)}</h4><span class="mono">#${r.branch_order} · ${esc(r.fingerprint)}</span></div>
        <dl class="rule-triple">
          <dt>IF</dt><dd><code>${esc(r.condition_sql)}</code></dd>
          <dt>THEN</dt><dd class="rule-branch"><code>${esc(r.action_sql)}</code></dd>
          <dt>证据</dt><dd><code>${esc(r.evidence_sql_node)}</code> · 置信度 ${r.confidence} · ${esc(r.last_verified)} 复核</dd>
          <dt>依据</dt><dd>${esc(r.rationale)}</dd>
        </dl>
      </div>`).join('')}
    </article>`;
  }).filter(Boolean).join('');
  return `<div class="asset-grid">${groups || '<div class="empty-block">没有匹配的规则</div>'}</div>`;
}

function renderOntologyEvidence(q) {
  const d = state.ontology;
  const lineages = d.lineage.filter((l) => matches(q, l.from, l.to, l.op, l.job));
  const profiles = d.value_profiles.filter((p) => matches(q, p.table, p.field, ...p.values.map((v) => v.value)));
  const facts = d.sql_facts.filter((f) => matches(q, f.title, f.id, f.snippet, ...(f.tags || [])));
  const switches = d.time_switches.filter((t) => matches(q, t.name, t.id, t.expression));
  return `<div class="asset-grid">
    <article class="asset-card wide"><div class="asset-title"><h4>生产血缘</h4><span class="mono">${lineages.length} edges</span></div>
      ${lineages.length ? lineages.map((l) => `<div class="lineage-row"><span class="mono">${esc(l.from)}</span><span class="arrow">→</span><span class="mono">${esc(l.to)}</span><span class="op">${esc(l.op)} · ${esc(l.job)} · ${esc(l.lag)}</span></div>`).join('') : '<p class="empty">没有匹配的血缘边</p>'}
    </article>
    <article class="asset-card"><div class="asset-title"><h4>值分布画像</h4><span class="mono">value profile</span></div>
      <div class="evidence-list">${profiles.length ? profiles.map((p) => `<div class="evidence-row"><b>${esc(p.table)}.${esc(p.field)}</b><br>${p.values.map((v) => `${esc(v.value)} <span class="mono">${v.pct}%</span>`).join(' · ')}</div>`).join('') : '<p class="empty">没有匹配的画像</p>'}</div>
    </article>
    <article class="asset-card"><div class="asset-title"><h4>时间口径开关</h4><span class="mono">time switch</span></div>
      <div class="evidence-list">${switches.length ? switches.map((t) => `<div class="evidence-row"><b>${esc(t.name)}</b> <span class="badge ${t.enabled ? 'badge-pass' : ''}">${t.enabled ? 'enabled' : 'off'}</span><br><code>${esc(t.expression)}</code> · 生效 ${esc(t.effective_from)}</div>`).join('') : '<p class="empty">没有匹配的开关</p>'}</div>
    </article>
    ${facts.map((f) => `<article class="asset-card wide"><div class="asset-title"><h4>${esc(f.title)}</h4><span class="mono">${esc(f.id)} · ${esc(f.branch)}</span></div>
      <div class="asset-meta"><span class="badge mono">hash ${esc(f.hash)}</span>${f.tags.map((t) => `<span class="badge">${esc(t)}</span>`).join('')}</div>
      <pre class="sql-block" style="max-height:180px;font-size:10.5px">${sqlHtml(f.snippet)}</pre>
    </article>`).join('')}
  </div>`;
}

function renderOntology() {
  if (!state.ontology) return;
  renderOntologyStats();
  $$('.sub-tab').forEach((b) => b.classList.toggle('active', b.dataset.ont === state.ontTab));
  const q = state.ontSearch.trim().toLowerCase();
  const renderers = { tables: renderOntologyTables, metrics: renderOntologyMetrics, rules: renderOntologyRules, evidence: renderOntologyEvidence };
  $('#ontology-body').innerHTML = renderers[state.ontTab](q);
}

async function loadOntology() {
  try {
    state.ontology = await api('ontology');
    if (state.tab === 'ontology') renderOntology();
  } catch (error) {
    $('#ontology-body').innerHTML = `<div class="empty-block">本体加载失败：${esc(error.message)}</div>`;
  }
}

/* ---------- feedback ---------- */
function renderFeedbackResult(entry) {
  const el = $('#fb-result');
  el.hidden = false;
  el.innerHTML = `<h4>分诊结果 · ${esc(entry.category)} / ${esc(entry.priority)}</h4>
    <div class="fb-meta"><span class="badge mono">${esc(entry.id)}</span><span class="badge mono">fp ${esc(entry.fingerprint)}</span><span class="badge prio-${esc(entry.priority)}">${esc(entry.priority)}</span></div>
    <div class="fb-ops">${entry.ops.map((o) => `<span class="badge mono">${esc(o.op)} · ${esc(o.target)}</span>`).join('')}</div>
    <div class="fb-suggestion">${esc(entry.suggestion)}</div>
    <div class="fb-suggestion" style="margin-top:5px">进入评审后仍需三闸：指纹校验 → 生产 SQL 回trace → schema/格式完整性。演示只生成草稿，不自动发布本体版本。</div>`;
  toast('已进入分诊队列');
}

function renderFeedbackQueue() {
  const items = state.feedback;
  $('#feedback-count').textContent = `队列 ${items.length}`;
  $('#fb-queue-count').textContent = String(items.length);
  if (!items.length) {
    $('#fb-queue').innerHTML = '<p class="empty">还没有反馈，先提交一条</p>';
    return;
  }
  $('#fb-queue').innerHTML = items.slice().reverse().map((entry) => {
    const statusBadge = entry.status === 'accepted' ? '<span class="badge badge-pass">accepted</span>'
      : entry.status === 'rejected' ? '<span class="badge badge-fail">rejected</span>'
        : '<span class="badge badge-warn">pending review</span>';
    return `<div class="fb-card">
      <div class="fb-top"><span class="badge prio-${esc(entry.priority)}">${esc(entry.priority)} · ${esc(entry.category)}</span><span class="mono">${esc(entry.id)} · ${fmtDate(entry.created_at)}</span></div>
      <div class="fb-q">${esc(entry.question)}</div>
      <div class="fb-meta">${statusBadge}<span class="badge mono">fp ${esc(entry.fingerprint)}</span></div>
      <div class="fb-ops">${entry.ops.map((o) => `<span class="badge mono">${esc(o.op)}</span>`).join('')}</div>
      <div class="fb-suggestion">${esc(entry.suggestion)}</div>
      ${entry.ontology_draft ? `<div class="fb-suggestion" style="color:var(--amber)">草稿 ${esc(entry.ontology_draft.id)} · ${esc(entry.ontology_draft.gate)}</div>` : ''}
      ${entry.status === 'pending_review' ? `<div class="fb-actions"><button class="ghost-btn" data-fb-id="${esc(entry.id)}" data-decision="accepted">接受草稿</button><button class="ghost-btn" data-fb-id="${esc(entry.id)}" data-decision="rejected">拒绝</button></div>` : ''}
    </div>`;
  }).join('');
}

async function loadFeedback() {
  try {
    const data = await api('feedback');
    state.feedback = data.items || [];
    renderFeedbackQueue();
  } catch (error) {
    $('#fb-queue').innerHTML = `<p class="empty">队列加载失败：${esc(error.message)}</p>`;
  }
}

async function resolveFeedback(id, decision) {
  try {
    const data = await api(`feedback/${encodeURIComponent(id)}/resolve`, { method: 'POST', body: { decision } });
    const entry = data.entry;
    state.feedback = state.feedback.map((x) => (x.id === entry.id ? entry : x));
    renderFeedbackQueue();
    toast(decision === 'accepted' ? '已接受，生成待评审本体草稿' : '已拒绝并保留审计记录');
  } catch (error) {
    toast(error.message, true);
  }
}

/* ---------- wiring ---------- */
function bind() {
  $$('.tab').forEach((btn) => btn.addEventListener('click', () => showTab(btn.dataset.tab)));
  $$('.sub-tab').forEach((btn) => btn.addEventListener('click', () => {
    state.ontTab = btn.dataset.ont;
    renderOntology();
  }));

  $('#query-form').addEventListener('submit', (event) => {
    event.preventDefault();
    runQuery($('#question').value);
  });
  $('#question').addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      $('#query-form').requestSubmit();
    }
  });

  $('#presets').addEventListener('click', (event) => {
    const btn = event.target.closest('.preset');
    if (!btn) return;
    $('#question').value = btn.dataset.q;
    runQuery(btn.dataset.q);
  });

  $('#copy-sql').addEventListener('click', async () => {
    if (!state.answer) return;
    try {
      await navigator.clipboard.writeText(state.answer.sql);
      toast('SQL 已复制');
    } catch {
      const area = document.createElement('textarea');
      area.value = state.answer.sql;
      document.body.appendChild(area);
      area.select();
      document.execCommand('copy');
      area.remove();
      toast('SQL 已复制');
    }
  });

  $('#refresh-eval').addEventListener('click', () => loadEval(true));

  let searchTimer = 0;
  $('#ontology-search').addEventListener('input', (event) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.ontSearch = event.target.value;
      renderOntology();
    }, 120);
  });

  $('#feedback-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const payload = {
      question: $('#fb-question').value.trim(),
      aiSql: $('#fb-ai').value.trim(),
      finalSql: $('#fb-final').value.trim(),
      note: $('#fb-note').value.trim(),
    };
    if (!payload.question || !payload.aiSql || !payload.finalSql) {
      toast('问题、AI SQL、修正 SQL 都必须填写', true);
      return;
    }
    const btn = event.currentTarget.querySelector('button[type="submit"]');
    btn.disabled = true;
    try {
      const data = await api('feedback', { method: 'POST', body: payload });
      renderFeedbackResult(data.entry);
      await loadFeedback();
    } catch (error) {
      toast(`提交失败：${error.message}`, true);
    } finally {
      btn.disabled = false;
    }
  });

  $('#fb-queue').addEventListener('click', (event) => {
    const btn = event.target.closest('[data-fb-id]');
    if (!btn) return;
    resolveFeedback(btn.dataset.fbId, btn.dataset.decision);
  });
}

async function init() {
  initTheme();
  bind();
  loadHealth();
  loadFeedback();
  loadEval().catch(() => {});
  loadOntology();
  const params = new URLSearchParams(window.location.search);
  const q = params.get('q') || '上月各品类成交额及同比';
  $('#question').value = q;
  await runQuery(q);
}

init();
