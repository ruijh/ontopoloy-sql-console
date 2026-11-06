/**
 * 主题契约测试：六套主题的令牌完整性、可访问性对比度与前后端接线。
 * 不依赖浏览器，直接检查 index.html / style.css / app.js 的静态契约。
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const html = readFileSync(`${root}/public/index.html`, 'utf8')
const css = readFileSync(`${root}/public/style.css`, 'utf8')
const app = readFileSync(`${root}/public/app.js`, 'utf8')

const THEMES = [
  ['palantir-dark', 'Palantir · 深色', 'dark'],
  ['palantir-light', 'Palantir · 浅色', 'light'],
  ['macos-dark', 'macOS · 深色', 'dark'],
  ['macos-light', 'macOS · 浅色', 'light'],
  ['console-dark', 'Console · 深色', 'dark'],
  ['console-light', 'Console · 浅色', 'light'],
]
const THEME_KEY = 'ontsql.theme.v1'
const REQUIRED = [
  '--scheme', '--sans', '--bg', '--bg-2', '--panel', '--panel-2',
  '--line', '--line-soft', '--line-strong', '--text', '--text-2', '--text-3',
  '--muted', '--faint', '--accent', '--accent-2', '--accent-3', '--accent-ink',
  '--accent-line', '--green', '--green-2', '--green-ink', '--red', '--red-2',
  '--red-ink', '--blue', '--blue-2', '--violet', '--violet-2', '--cyan',
  '--radius', '--radius-sm', '--radius-xs', '--shadow', '--shadow-sm',
  '--card-bg', '--panel-grad', '--bar-bg', '--tabs-bg', '--input-bg',
  '--code-bg', '--code-text', '--th-bg', '--track', '--track-2', '--baseline',
  '--lift', '--selection', '--selection-ink', '--scroll', '--btn-border',
  '--btn-a', '--btn-b', '--btn-ink', '--btn-shadow', '--focus',
  '--code-kw', '--code-fn', '--code-str', '--code-num', '--code-com',
  '--ambient', '--ambient-size',
]

const blocks = new Map()
for (const match of css.matchAll(/html\[data-theme="([a-z-]+)"\]\s*\{([^}]*)\}/g)) {
  const tokens = {}
  for (const token of match[2].matchAll(/^\s*(--[\w-]+)\s*:\s*([^;]+);/gm)) tokens[token[1]] = token[2].trim()
  blocks.set(match[1], tokens)
}

const rgb = (value) => {
  const match = String(value).trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)
  if (!match) return null
  let hex = match[1]
  if (hex.length === 3) hex = [...hex].map((ch) => ch + ch).join('')
  return [0, 2, 4].map((at) => Number.parseInt(hex.slice(at, at + 2), 16))
}
const luminance = (color) => {
  const channel = (value) => {
    const v = value / 255
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(color[0]) + 0.7152 * channel(color[1]) + 0.0722 * channel(color[2])
}
const contrast = (fg, bg) => {
  const a = luminance(rgb(fg))
  const b = luminance(rgb(bg))
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

let passed = 0
function ok(name, fn) {
  fn()
  passed += 1
  console.log(`  ✓ ${name}`)
}

console.log('Theme contract:')

ok('六套主题各有一个完整令牌块', () => {
  assert.deepEqual([...blocks.keys()].sort(), THEMES.map(([id]) => id).sort())
  for (const [id] of THEMES) {
    const missing = REQUIRED.filter((token) => !blocks.get(id)[token])
    assert.deepEqual(missing, [], `${id} 缺少令牌：${missing.join(', ')}`)
  }
})

ok('主题 ID、名称、明暗模式与配色元数据一致', () => {
  for (const [id, label, mode] of THEMES) {
    const object = app.match(new RegExp(`\\{\\n    id: '${id}',([\\s\\S]*?)\\n  \\}`))
    assert.ok(object, `app.js 缺少 ${id}`)
    assert.match(object[1], new RegExp(`label: '${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'`))
    assert.match(object[1], new RegExp(`mode: '${mode === 'dark' ? '深色' : '浅色'}'`))
    const colors = [...object[1].matchAll(/#[0-9a-f]{6}/gi)].map((m) => m[0].toLowerCase())
    assert.equal(colors.length, 3, `${id} 应有 3 个色块`)
    assert.equal(colors[0], blocks.get(id)['--bg'].toLowerCase(), `${id} 首屏色与 --bg 不一致`)
  }
  assert.equal((app.match(/^    id: '/gm) ?? []).length, 6)
})

ok('首屏脚本与业务代码使用同一份白名单和存储键', () => {
  const boot = html.match(/var allowed = \[([^\]]+)\]/)
  assert.ok(boot, 'index.html 缺少主题白名单')
  const ids = [...boot[1].matchAll(/'([a-z-]+)'/g)].map((m) => m[1])
  assert.deepEqual(ids, THEMES.map(([id]) => id))
  assert.match(html, new RegExp(`localStorage\\.getItem\\('${THEME_KEY.replace(/\./g, '\\.')}'\\)`))
  assert.match(app, new RegExp(`THEME_KEY = '${THEME_KEY.replace(/\./g, '\\.')}'`))
  assert.match(html, /var theme = 'palantir-dark'/)
})

ok('CSS 中没有未定义的 var(--token)', () => {
  const used = new Set([...css.matchAll(/var\((--[\w-]+)/g)].map((m) => m[1]))
  const defined = new Set([...css.matchAll(/^\s*(--[\w-]+)\s*:/gm)].map((m) => m[1]))
  const undefinedTokens = [...used].filter((token) => !defined.has(token))
  assert.deepEqual(undefinedTokens, [])
})

ok('关键文本/控件配色在六套主题下均达到 WCAG AA 4.5:1', () => {
  const pairs = [
    ['正文', '--text', '--bg'],
    ['次级正文', '--text-2', '--panel'],
    ['三级正文', '--text-3', '--panel'],
    ['弱化文本', '--muted', '--panel'],
    ['最弱文本', '--faint', '--panel'],
    ['主强调文本', '--accent', '--bg'],
    ['主强调面板', '--accent', '--panel'],
    ['强调反色', '--accent-ink', '--accent'],
    ['次强调', '--accent-2', '--panel'],
    ['运行按钮上缘', '--btn-ink', '--btn-a'],
    ['运行按钮下缘', '--btn-ink', '--btn-b'],
    ['代码正文', '--code-text', '--code-bg'],
    ['代码关键字', '--code-kw', '--code-bg'],
    ['代码函数', '--code-fn', '--code-bg'],
    ['代码字符串', '--code-str', '--code-bg'],
    ['代码数字', '--code-num', '--code-bg'],
    ['代码注释', '--code-com', '--code-bg'],
    ['成功色', '--green', '--panel'],
    ['成功浅色', '--green-2', '--panel'],
    ['危险色', '--red', '--panel'],
    ['危险浅色', '--red-2', '--panel'],
    ['信息色', '--blue', '--panel'],
    ['信息浅色', '--blue-2', '--panel'],
  ]
  const failures = []
  for (const [id] of THEMES) {
    const tokens = blocks.get(id)
    for (const [label, fgToken, bgToken] of pairs) {
      const fg = tokens[fgToken]
      const bg = tokens[bgToken]
      if (!rgb(fg) || !rgb(bg)) {
        failures.push(`${id} ${label}: 非十六进制色值 ${fgToken}=${fg} / ${bgToken}=${bg}`)
        continue
      }
      const ratio = contrast(fg, bg)
      if (ratio < 4.5) failures.push(`${id} ${label}: ${ratio.toFixed(2)} (${fgToken}=${fg}, ${bgToken}=${bg})`)
    }
  }
  assert.deepEqual(failures, [])
})

ok('三套风格有独立的结构语言', () => {
  for (const family of ['palantir', 'macos', 'console']) {
    assert.match(css, new RegExp(`html\\[data-theme\\^="${family}"\\]`), `${family} 缺少家族样式`)
  }
})

ok('主题菜单可访问性接线完整', () => {
  assert.match(html, /id="theme-trigger"[\s\S]*?aria-haspopup="true"[\s\S]*?aria-expanded="false"[\s\S]*?aria-controls="theme-popover"/)
  assert.match(html, /id="theme-popover"[^>]*role="dialog"[^>]*hidden/)
  assert.match(html, /id="theme-grid"[^>]*role="radiogroup"/)
  assert.match(app, /role="radio"/)
  assert.match(app, /aria-checked="\$\{theme\.id === currentTheme\}"/)
  assert.match(app, /aria-expanded', String\(open\)/)
  assert.match(app, /event\.key === 'Escape'/)
  assert.match(app, /ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'/)
  assert.match(app, /ctrlKey \|\| event\.metaKey/)
})

ok('页面不依赖外部字体、CDN 或远程图片', () => {
  assert.doesNotMatch(html, /<(?:script|img|link|iframe|source)\b[^>]*(?:src|href)=["']https?:/i)
  assert.doesNotMatch(css, /@import|url\(\s*["']?https?:/i)
  assert.match(css, /--sans:/)
})

console.log(`\n${passed} theme checks passed`)
