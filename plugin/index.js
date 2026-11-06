/**
 * OntopoloySQL Console —— DSH Web 插件（host 侧）。
 *
 * 只做一件事：把 src/http.mjs 的 createHandler 挂到 dsh web 的 /ontsql/。
 * 页面、API、静态文件都在同一个 handler 里，平台网关剥掉外部前缀后仍按
 * /ontsql/... 到达，所以浏览器相对路径与直接访问都成立。
 *
 * SRC_REV 是整张 src 模块图的缓存版本号，必须与 src/*.mjs 里相对导入的
 * ?v= 保持一致；DSH 热重载只替换插件入口，不会自动清掉 src 的 ESM 缓存。
 */
const SRC_REV = 'ontsql-20261106-3'
const { createHandler } = await import(new URL(`../src/http.mjs?v=${SRC_REV}`, import.meta.url).href)

const PREFIX = '/ontsql'

export function apply(ctx) {
  ctx.inject(['webServer'], (webCtx) => {
    const handler = createHandler({ prefix: PREFIX })
    const offPrefix = webCtx.webServer.register({
      kind: 'prefix',
      path: PREFIX,
      handler,
    })
    webCtx.effect(() => () => offPrefix(), 'ontsql: /ontsql page + api')
  })
}
