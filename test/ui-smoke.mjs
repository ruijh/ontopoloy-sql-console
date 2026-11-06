/**
 * 轻量 UI 冒烟：用最小 DOM 桩执行 public/app.js 的真实渲染逻辑。
 * 目的不是像素级浏览器测试，而是抓初始化、四页渲染、事件绑定中的运行时错误。
 */
import http from 'node:http'
import assert from 'node:assert/strict'
import { createHandler } from '../src/http.mjs'

class El {
  constructor(id = '') {
    this.id = id
    this.dataset = {}
    this.style = { width: '', setProperty() {} }
    this.hidden = false
    this.disabled = false
    this.value = ''
    this._text = ''
    this._html = ''
    this.listeners = {}
    this._classes = new Set()
    this.className = ''
    this.attributes = {}
    this.title = ''
    this.classList = {
      add: (...names) => names.forEach((n) => this._classes.add(n)),
      remove: (...names) => names.forEach((n) => this._classes.delete(n)),
      toggle: (name, force) => {
        const on = force === undefined ? !this._classes.has(name) : Boolean(force)
        if (on) this._classes.add(name)
        else this._classes.delete(name)
        return on
      },
      contains: (name) => this._classes.has(name),
    }
  }
  set textContent(v) { this._text = String(v ?? ''); this._html = '' }
  get textContent() { return this._text }
  set innerHTML(v) { this._html = String(v ?? ''); this._text = '' }
  get innerHTML() { return this._html }
  addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn) }
  setAttribute(name, value) {
    this.attributes[name] = String(value)
    if (name.startsWith('data-')) {
      const key = name.slice(5).replace(/-([a-z])/g, (_, ch) => ch.toUpperCase())
      this.dataset[key] = String(value)
    }
  }
  getAttribute(name) { return this.attributes[name] ?? null }
  focus() { document.activeElement = this }
  querySelector(sel) {
    if (sel === 'em') return (this.em ??= new El())
    if (sel === 'button[type="submit"]') return (this.submitBtn ??= new El())
    return null
  }
  insertAdjacentHTML(_where, html) { this._html += html }
  appendChild(child) { this.child = child; return child }
  remove() {}
  select() {}
  closest(sel) {
    if (sel === '.preset' && this._classes.has('preset')) return this
    if (sel === '#theme-menu' && (this.id === 'theme-trigger' || this.id === 'theme-popover')) return get('theme-menu')
    return null
  }
  get previousElementSibling() { return (this.prev ??= new El()) }
}

const ids = new Map()
const get = (id) => { if (!ids.has(id)) ids.set(id, new El(id)); return ids.get(id) }

const tabs = ['generate', 'eval', 'ontology', 'feedback'].map((name) => {
  const el = new El(`tab-${name}`)
  el.dataset.tab = name
  return el
})
const views = ['generate', 'eval', 'ontology', 'feedback'].map((name) => {
  const el = new El(`view-${name}`)
  el.hidden = name !== 'generate'
  return el
})
const pipeSteps = ['intent', 'recall', 'generate', 'validate', 'execute'].map(() => new El())
const subTabs = ['tables', 'metrics', 'rules', 'evidence'].map((name) => {
  const el = new El(`sub-${name}`)
  el.dataset.ont = name
  return el
})

const meta = new El('theme-color')
const document = {
  documentElement: new El('html'),
  activeElement: null,
  listeners: {},
  querySelector(sel) {
    if (sel.startsWith('#')) return get(sel.slice(1))
    if (sel === '.tab') return tabs[0]
    if (sel === 'meta[name="theme-color"]') return meta
    return null
  },
  querySelectorAll(sel) {
    if (sel === '.tab') return tabs
    if (sel === '.view') return views
    if (sel === '.pipe-step') return pipeSteps
    if (sel === '.sub-tab') return subTabs
    return []
  },
  createElement() { return new El() },
  body: new El('body'),
  execCommand() { return true },
  addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn) },
}

const storage = new Map()
globalThis.localStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: (key) => storage.delete(key),
}

const server = http.createServer(createHandler({ prefix: '/ontsql' }))
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const { port } = server.address()
const origin = `http://127.0.0.1:${port}/ontsql/`
const nativeFetch = globalThis.fetch

globalThis.document = document
globalThis.window = {
  location: { href: `${origin}?q=${encodeURIComponent('上月各品类成交额及同比')}`, search: `?q=${encodeURIComponent('上月各品类成交额及同比')}` },
  scrollTo() {},
}
globalThis.history = { replaceState() {} }
Object.defineProperty(globalThis, 'navigator', { value: { clipboard: { writeText: async () => {} } }, configurable: true })
globalThis.fetch = (input, init) => nativeFetch(new URL(input, origin), init)

const errors = []
process.on('unhandledRejection', (error) => errors.push(error))
const waitFor = async (label, predicate, timeout = 5000) => {
  const end = Date.now() + timeout
  while (Date.now() < end) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 40))
  }
  throw new Error(`等待超时：${label}`)
}

let passed = 0
function ok(name, fn) {
  fn()
  passed += 1
  console.log(`  ✓ ${name}`)
}

try {
  await import('../public/app.js')
  await waitFor('初始生成结果', () => get('sql-code').innerHTML.includes('dws_brand_trade_m'))

  console.log('OntopoloySQL UI smoke')
  ok('主题默认 Palantir 深色并渲染 6 个选项', () => {
    assert.equal(document.documentElement.dataset.theme, 'palantir-dark')
    assert.equal(get('theme-label').textContent, 'Palantir · 深色')
    assert.equal((get('theme-grid').innerHTML.match(/class="theme-option"/g) || []).length, 6)
    assert.match(get('theme-grid').innerHTML, /macos-dark/)
    assert.match(get('theme-grid').innerHTML, /console-light/)
    assert.match(get('theme-grid').innerHTML, /data-theme="palantir-dark" role="radio"\s+aria-checked="true"/)
  })
  ok('主题菜单可展开并用 Esc 关闭', () => {
    get('theme-trigger').listeners.click[0]()
    assert.equal(get('theme-popover').hidden, false)
    assert.equal(get('theme-trigger').getAttribute('aria-expanded'), 'true')
    document.listeners.keydown[0]({ key: 'Escape', preventDefault() {} })
    assert.equal(get('theme-popover').hidden, true)
    assert.equal(get('theme-trigger').getAttribute('aria-expanded'), 'false')
  })
  ok('快捷键轮换主题、更新 aria-checked 并持久化', () => {
    document.listeners.keydown[0]({ key: 'l', ctrlKey: true, shiftKey: true, preventDefault() {} })
    assert.equal(document.documentElement.dataset.theme, 'palantir-light')
    assert.equal(localStorage.getItem('ontsql.theme.v1'), 'palantir-light')
    assert.equal(get('theme-label').textContent, 'Palantir · 浅色')
    assert.match(get('theme-grid').innerHTML, /data-theme="palantir-light" role="radio"\s+aria-checked="true"/)
  })
  ok('六套主题均可从菜单选择、更新 aria 状态并持久化', () => {
    const labels = {
      'palantir-dark': 'Palantir · 深色',
      'palantir-light': 'Palantir · 浅色',
      'macos-dark': 'macOS · 深色',
      'macos-light': 'macOS · 浅色',
      'console-dark': 'Console · 深色',
      'console-light': 'Console · 浅色',
    }
    const click = get('theme-grid').listeners.click[0]
    for (const [id, label] of Object.entries(labels)) {
      click({ target: { closest: () => ({ dataset: { theme: id } }) } })
      assert.equal(document.documentElement.dataset.theme, id)
      assert.equal(get('theme-label').textContent, label)
      assert.equal(localStorage.getItem('ontsql.theme.v1'), id)
      assert.match(get('theme-grid').innerHTML, new RegExp(`data-theme="${id}" role="radio"\\s+aria-checked="true"`))
    }
    click({ target: { closest: () => ({ dataset: { theme: 'palantir-dark' } }) } })
    assert.equal(document.documentElement.dataset.theme, 'palantir-dark')
  })
  ok('初始化自动生成 SQL 与结果表', () => {
    assert.match(get('sql-code').innerHTML, /SELECT/)
    assert.match(get('sql-code').innerHTML, /is_refund/)
    assert.match(get('result-table').innerHTML, /<table>/)
    assert.match(get('result-table').innerHTML, /食品/)
    assert.match(get('result-table').innerHTML, /53\.30%/)
    assert.match(get('run-status').textContent, /校验通过/)
  })
  ok('健康状态与真实行数', () => {
    assert.match(get('health-text').textContent, /3,803 行/)
  })
  ok('12 项校验全部渲染为通过', () => {
    const matches = get('check-grid').innerHTML.match(/class="check-item/g) || []
    assert.equal(matches.length, 12)
    assert.doesNotMatch(get('check-grid').innerHTML, /class="check-item fail/)
  })
  ok('引用、召回与 pack 都渲染', () => {
    assert.match(get('citations').innerHTML, /citation/)
    assert.match(get('routes').innerHTML, /route-code/)
    assert.match(get('pack-list').innerHTML, /pack-note/)
    assert.match(get('token-used').textContent, /tokens/)
  })

  tabs.find((t) => t.dataset.tab === 'eval').listeners.click[0]()
  await waitFor('评测台渲染', () => get('eval-body').innerHTML.includes('8/8'))
  ok('评测台显示本体 100 / baseline 68', () => {
    assert.match(get('eval-body').innerHTML, /100/)
    assert.match(get('eval-body').innerHTML, /68/)
    assert.match(get('eval-body').innerHTML, /\+4/)
  })

  tabs.find((t) => t.dataset.tab === 'ontology').listeners.click[0]()
  await waitFor('本体页渲染', () => get('ontology-body').innerHTML.includes('dws_brand_trade_m'))
  ok('本体页显示 6 表与 49 字段', () => {
    assert.match(get('ontology-stats').innerHTML, /49/)
    assert.match(get('ontology-body').innerHTML, /asset-grid/)
    assert.match(get('ontology-body').innerHTML, /3,371 rows/)
  })

  subTabs.find((t) => t.dataset.ont === 'rules').listeners.click[0]()
  ok('规则页渲染 12 条三元组', () => {
    const branches = get('ontology-body').innerHTML.match(/class="rule-card"/g) || []
    assert.equal(branches.length, 12)
    assert.match(get('ontology-body').innerHTML, /IF/)
  })

  tabs.find((t) => t.dataset.tab === 'feedback').listeners.click[0]()
  await waitFor('反馈队列为空态', () => get('fb-queue').innerHTML.includes('还没有反馈'))
  get('fb-question').value = '退款率分子是否含运费'
  get('fb-ai').value = 'SELECT COUNT(*) FROM dws_brand_trade_m WHERE dt = \'2026-10-01\''
  get('fb-final').value = 'SELECT COUNT(*) FROM dws_brand_trade_m WHERE dt = \'2026-10-01\' AND is_refund = 0'
  get('fb-note').value = '补充退款过滤'
  const form = get('feedback-form')
  await form.listeners.submit[0]({ preventDefault() {}, currentTarget: form })
  await waitFor('反馈分诊结果', () => get('fb-result').innerHTML.includes('caliber'))
  ok('提交反馈后展示分诊与队列', () => {
    assert.match(get('fb-result').innerHTML, /P2/)
    assert.match(get('fb-queue').innerHTML, /pending review/)
  })
  ok('运行时没有未处理异常', () => {
    assert.deepEqual(errors, [])
  })

  console.log(`\n${passed} UI checks passed`)
} finally {
  await new Promise((resolve) => server.close(resolve))
}
