# OntopoloySQL Console — 本体驱动的 NL→SQL Demo

> **在线 Demo：** <https://ruijh.github.io/ontopoloy-sql-console/>  
> **源码：** <https://github.com/ruijh/ontopoloy-sql-console>  
> Pages 版把 SQLite 编译成 WebAssembly 在浏览器里执行，打开即用，无需登录。

把《从LLM到Ontology：本体驱动的AI数据研发原理与最佳实践》里的核心闭环做成一个可点击、可执行、可验证的 Web Demo。方法论如何拆成工单、接口与验收项，见 [IMPLEMENTATION.md](IMPLEMENTATION.md)（约 2,000 行完整方案）。

**它不是“让大模型写 SQL”的演示。** 生成器是确定性模板（`llm_used:false`），重点验证方案里真正难的部分：

- 五类本体资产：表本体 / 字段语义 / 指标口径 / 业务规则 / 生产证据
- R1–R7 七路确定性召回 + 加权 RRF 融合 + token 预算
- 生成后 12 道闸门（V01–V12）校验，失败即 `fail_closed`，不执行 SQL
- 每条结论可回trace到生产 SQL、规则分支与本体版本
- 8 条评测集、五层评分、本体增强 vs 无本体 baseline、防泄漏说明
- 反馈 → 分诊 → 变更算子 → 待审草稿，不自动发布本体
- 3 种风格 × 明暗双色共 6 套主题，纯 CSS 令牌切换，无外部字体/CDN

在线版用 `node:sqlite` 内存库执行；GitHub Pages 版用 `sql.js`（SQLite WASM）在浏览器内打开同一份数据库。两种入口跑的是同一套生成、校验与评测代码，页面上的每个数字都来自真实 SQL 结果，不是预录快照。

---

## 1. 打开入口

**GitHub Pages（公开分享，推荐）：**

```
https://ruijh.github.io/ontopoloy-sql-console/
```

纯静态托管，`sql.js` 在浏览器内执行全量 SQLite；不需要 Node 服务、数据库或 API Key。首次打开会加载约 670 KB 的 WASM 与 528 KB 数据库，之后由浏览器缓存。

**平台内入口（需要登录态，普通标签页，末尾斜杠必须有）：**

```
https://10.130.15.40:30443/api/v1/instances/3431/proxy/ontsql/
```

不要用 DSH GUI 右侧栏的内置浏览器面板：它是跨站 iframe，平台登录 Cookie 不一定带得上，网关会先回 `401 Access token expired or invalid`。用普通浏览器标签页打开。

**容器内 / DSH 本地入口：**

```
http://127.0.0.1:43955/ontsql/
```

这是同一个 DSH Web 插件挂载的路径，不额外起服务。

**完全独立跑（可选，验证用）：**

```bash
cd ontsql-demo
node server.mjs          # 127.0.0.1:43960
# http://127.0.0.1:43960/ontsql/
```

---

## 2. 界面主题

入口右上角的 **Theme** 按钮可在 6 套主题间切换；也可按 `Ctrl/Cmd + Shift + L` 快速轮换。选择写入 `localStorage['ontsql.theme.v1']`，刷新后保持；`<head>` 里的首屏脚本会在样式表加载前设好 `data-theme`，避免深浅色闪烁。

| 主题 ID | 名称 | 视觉气质 | 结构差异 |
| --- | --- | --- | --- |
| `palantir-dark` | Palantir · 深色（默认） | 指挥中心黑/海军蓝，琥珀 + 青，信息密度高 | 直角数据边框、12px 圆角、细网格环境光 |
| `palantir-light` | Palantir · 浅色 | 暖纸/图纸底，赭石 + 墨蓝，像印出来的作战图 | 同上的密度，阴影更轻、边框更清晰 |
| `macos-dark` | macOS · 深色 | 石墨玻璃、SF 蓝、柔和投影 | 14px 圆角、半透明卡片、胶囊标签、隐藏下划线 |
| `macos-light` | macOS · 浅色 | `#f5f5f7` 雾白、白色玻璃卡片、SF 蓝 | 13px 圆角、毛玻璃顶栏、轻分隔线 |
| `console-dark` | Console · 深色 | 近黑磷光终端、荧光绿、等宽标题 | 5px 小圆角、扫描线/点阵、全大写按钮 |
| `console-light` | Console · 浅色 | 绿调纸、墨绿正文、扁平终端 | 4px 圆角、实线分隔、终端式表头 |

实现方式：

- 所有颜色/圆角/阴影/环境光都收敛为 CSS 自定义属性，主题只覆盖令牌；组件 CSS 不写死主题色。
- `<html data-theme="...">` 是唯一开关，同时同步 `color-scheme` 与 `<meta name="theme-color">`，让滚动条、表单控件和移动端地址栏跟随。
- 三套风格另有少量结构覆盖（`html[data-theme^="palantir|macos|console"]`），但语义令牌完全共享。
- 不加载远程字体或图片；浅色主题的代码高亮、状态色、按钮渐变也单独校验过对比度。

新增主题时同步四处：`public/style.css` 令牌块、`public/index.html` 首屏白名单、`public/app.js` 的 `THEMES`、`test/theme.mjs` 的期望列表。`node test/theme.mjs` 会检查令牌完整性、未定义 `var(--x)`、六套主题的 WCAG AA 对比度和菜单可访问性接线。

---

## 3. 五分钟演示路线

1. **默认问题已自动生成**：`上月各品类成交额及同比`。左侧五步管线依次亮起：意图 → 召回 → 生成 → 校验 → 执行。
2. **看召回**：R1–R7 每路的命中项、排名、权重、贡献分都能展开；融合后形成带 `pack_id` 的上下文包，显示 token 用量 / 9000 预算。R7 可能 miss，这是正常的路由覆盖差异。
3. **看 SQL 与引用**：右侧是实际执行的 SQL；下方 6 条引用分别对应表、字段、指标、规则、证据。每一条都能对上本体资产。
4. **看 12 道闸**：V01–V12 全绿才执行；每道都有 `pass/detail`。可切到 baseline 语义（接口参数 `baseline:true`）观察 V06 等失败，页面会标 `baseline`，不冒充本体结果。
5. **切五个预设**，覆盖不同能力：
   - 上月各品类成交额及同比 → 品类维度 + 同比 + 品类回退
   - 上月各店铺类型成交额 → 规则 CASE 分支 + 店铺类型
   - 上月各渠道退款率 → 渠道组映射 + NULLIF 零分母保护
   - 上月各渠道新客数 → 固定口径 `new_buyer_cnt`
   - 上月各品牌成交额 top 3 → 品牌维表关联 + TopN
6. **评测台**：本体 8/8、均分 100、严格通过 8；baseline 4/8、均分 68。展开每条 case 可看五层分数与 baseline 的归因差异。页面明确标注“GT 只在评分进程内生成，不回灌候选上下文”。
7. **本体资产**：6 张表（3,371 / 120 / 294 / 6 / 8 / 4 行，总计 3,803）、49 个字段、6 个指标、12 条规则（8 组）、7 条血缘、4 条 SQL 证据、3 个值分布画像。支持搜索过滤。
8. **反馈飞轮**：提交一条修正 SQL。系统做 diff → 变更算子（`add_filter` / `swap_field` / `add_case_branch` / `add_guard` / `add_mapping`）→ 分类与优先级 → 生成 fingerprint。点击“接受草稿”只产生 `draft_*`，仍标注三道门，不会自动发布本体版本。

---

## 4. API

所有路径相对于挂载点：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `api/health` | 服务、本体版本、真实行数、`llm_used:false` |
| GET | `api/ontology` | 表/字段/指标/规则/血缘/证据/画像，行数从 DB 实时覆盖 |
| POST | `api/generate` | `{question, baseline?}` → 意图、召回、pack、SQL、12 校验、执行结果、引用、trace |
| GET/POST | `api/eval` | 8 case × 五层评分；POST `{refresh:true}` 重跑 |
| GET | `api/feedback` | 反馈队列 |
| POST | `api/feedback` | `{question, aiSql, finalSql, note?}` → 分诊条目 |
| POST | `api/feedback/:id/resolve` | `{decision:"accepted"\|"rejected"}` |

示例：

```bash
curl -sS -X POST http://127.0.0.1:43955/ontsql/api/generate \
  -H 'content-type: application/json' \
  -d '{"question":"上月各渠道退款率"}' | jq '{status, sql, rows:.execution.rows, checks:.validation.checks|length}'
```

### GitHub Pages 静态版

Pages 只能托管静态文件，不能运行 `src/http.mjs`，也不能用 `node:sqlite`。所以静态版不是录制 API 响应，而是把同一套引擎搬进浏览器：

- `npm run build:pages` 用 `node:sqlite` 的 `VACUUM INTO` 导出全量 `docs/runtime/ontsql.sqlite`；
- 浏览器用 vendored `sql.js@1.15.2` 打开该文件，`web/browser-db.mjs` 提供与 `src/db.mjs` 对齐的 `query / explain / dbSummary`；
- 构建时把 `src/*.mjs` 的 `node:crypto` 替换为 `web/crypto-shim.mjs`（同步 SHA-256），并去掉 DSH 的 `?v=` 缓存参数；
- `docs/runtime/static-boot.mjs` 在 `fetch` 层接管 `api/health|ontology|generate|eval|feedback`，随后启动原来的 `public/app.js`；
- 页面顶部会显示 `GitHub Pages · SQLite WASM` 横幅，健康状态显示 `SQLite WASM · 3,803 行`。

因此 Pages 上仍然是真实 SQL 执行、真实 12 闸校验和真实评测。限制只有两处：反馈队列存在**当前页面内存**，刷新即清空；没有服务端日志、鉴权与持久化。

---

## 5. 代码地图

```
src/ontology.mjs   五类本体资产（唯一事实源，版本 ont-b2c-trade@2026.11.1）
src/db.mjs         node:sqlite 内存库、确定性种子、6 表 3,803 行、query/explain
src/intent.mjs     确定性词典意图解析（指标/维度/过滤/时间/同比环比/topN）
src/recall.mjs     R1–R7 + 加权 RRF + token 预算 → context pack
src/generate.mjs   本体增强 SQL / baseline SQL、引用、假设、告警
src/validate.mjs   V01–V12、3 个指纹、fail-closed
src/engine.mjs     编排 + 真实执行 + 反馈分诊/评审（内存队列）
src/eval.mjs       E01–E08、五层评分、baseline、防泄漏说明
src/http.mjs       零依赖 HTTP handler、静态资源、安全头、路径穿越防护
src/payload.mjs    health/ontology 的共享载荷（Node 与 Pages 共用）
public/            单页 Console（无 CDN、无运行时构建步骤）
web/               浏览器 DB 适配、同步 SHA-256 替身、Pages 启动器
scripts/build-pages.mjs  导出 SQLite、重写导入、生成 docs/
vendor/sql.js/     sql.js 1.15.2 + WASM（MIT，随仓库分发）
docs/              GitHub Pages 构建产物（提交到 main:/docs）
plugin/            DSH Web 插件：register({kind:'prefix', path:'/ontsql'})
scripts/link.sh    幂等注册插件到 ~/.dsh/profiles/web
test/              主题契约 + API 冒烟 + DOM UI 冒烟 + Pages/WASM 冒烟
```

设计约束：

- 召回排序不用 LLM；生成器也不调 LLM。后续接模型时，模型只能消费 pack，不能绕过校验。
- SQL 只读、单语句、表白名单、必须带 `dt` 分区、必须 LIMIT、PII 字段拒绝。
- 指纹 = 规范化资产 + SHA-256 前 16 位；页面上的 fp 可对回资产。
- 本体版本固定；执行结果带 `version`、`run_id`、`trace`。
- 评测 GT 不进入候选上下文；baseline 与本体用同一套评分器。

---

## 6. 测试

```bash
cd ontsql-demo
node scripts/build-pages.mjs   # 重新生成 docs/
node test/theme.mjs
node test/smoke.mjs
node test/ui-smoke.mjs
node test/pages.mjs            # 用 sql.js 验证 Pages 产物
# 本容器 HOME 下 .npm 不可写，给 npm 一个可写缓存；等价于依次跑上面四条
npm_config_cache=/tmp/ontsql-npm-cache npm test
```

- `test/theme.mjs`：8 项，静态契约。覆盖六套主题令牌完整性、主题元数据/白名单/存储键一致、无未定义 `var(--x)`、23 组关键配色在六套主题下均 ≥ 4.5:1、三套家族结构、菜单 ARIA/键盘接线、无外部 CDN/字体。
- `test/smoke.mjs`：20 项，真 HTTP。覆盖首页、静态资源、308、ontology、generate（单指标/双指标）、fail-closed/baseline、评测数字、反馈提交/评审/非法决定、空问题、坏 JSON、路径穿越、405、未知 API。
- `test/ui-smoke.mjs`：13 项，用最小 DOM 桩执行真实 `public/app.js`，覆盖主题默认值/6 个选项/菜单开关/快捷键持久化/六套主题逐一切换，以及初始化自动生成、12 校验渲染、引用/召回/pack、评测页、本体页、12 条规则、反馈提交。它不能替代浏览器像素测试，但能抓初始化、主题交互与四页渲染的运行时错误。
- `test/pages.mjs`：9 项，直接加载 `docs/runtime`。用 sql.js 打开产物数据库，校验 3,803 行、五个预设、评测 8/8 vs baseline 4/8、反馈草稿，并用最小浏览器桩验证 `static-boot` 接管 health/generate 与结构化错误；同时检查产物不含 `node:` 内置导入。

当前结果：

```
8 theme checks passed
20 checks passed
13 UI checks passed
9 Pages checks passed
```

---

## 7. 插件注册与自愈

已注册到 `~/.dsh/profiles/web`，DSH 热加载后生效：

```bash
bash scripts/link.sh --dry-run   # 只看改动
bash scripts/link.sh             # 幂等：软链 + patch insert
```

profile patch 中对应：

```yaml
- insert:
    - id: ontsql
      name: 'dsh-ontsql-demo'
      config:
        rev: '2026-11-06T07:47Z'
```

实例重启后 profile 仍在；若软链被 `pnpm install` 剪掉，重跑 `link.sh`。插件入口通过 `SRC_REV` 给整张 `src` 模块图加 `?v=` 版本号，绕开 DSH 进程内的 ESM 缓存：改 `src/*.mjs` 后要同步 bump `src/*.mjs` 的相对导入版本和 `plugin/index.js` 的 `SRC_REV`，再改 profile patch 里的 `config.rev` 触发热加载。只改 `public/` 刷新浏览器即可。

---

## 8. 边界（别把它当成生产系统）

- 只有 6 张表 / 3,803 行演示数据，本体是手工策展的一个 domain。
- 生成是确定性模板，不是通用 NL2SQL；支持同一粒度最多两个指标及其同比/环比，复杂嵌套、窗口函数、跨主题域尚未覆盖。
- 反馈队列在内存里，进程重启即清空；没有登录、权限、审计落库。Pages 版更短：反馈只活在当前标签页，刷新即清空。
- 评测集只有 8 条，分数用于证明“闭环可跑”，不能当统计显著性结论。
- 平台入口需要登录态；容器内 `43960` 不是平台暴露端口，浏览器应走 `/ontsql/` 插件入口。

---

## 9. 发布到 GitHub Pages

仓库的 Pages 来源设为 **Deploy from a branch → `main` → `/docs`**，不需要 Actions 部署。`docs/` 是构建产物，和源码一起提交，保证线上可复现。

改动 `src/`、`public/` 或 `web/` 后：

```bash
npm run build:pages
git add docs
git commit -m "build: refresh Pages bundle"
git push
```

`.github/workflows/ci.yml` 只跑测试，不碰 Pages 部署。首次上线后若页面仍是 404，先在仓库 **Settings → Pages** 确认分支与目录，再等 1–2 分钟 CDN 生效。

---

## 10. 许可

本项目代码以 MIT License 发布，见 [LICENSE](LICENSE)。浏览器 SQLite 运行时为 [sql.js](https://github.com/sql-js/sql.js) 1.15.2，同样以 MIT 分发；其许可证随产物保留在 `docs/runtime/LICENSE`。
