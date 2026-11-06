#!/usr/bin/env bash
# 把 OntopoloySQL Console 挂到 DSH Web 的 /ontsql/（幂等，可反复执行）。
#
#   bash scripts/link.sh            # 注册
#   bash scripts/link.sh --dry-run  # 只看改动
#
# 做两件事：
#   1. <profile>/node_modules/dsh-ontsql-demo -> 本目录 plugin/ 的软链；
#   2. 在 <profile>/cordis.patch.yml 末尾追加一条 insert（已存在则跳过）。
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLUGIN_DIR="$HERE/plugin"
PROFILE="${DSH_ONTSQL_PROFILE:-$HOME/.dsh/profiles/web}"
LINK="$PROFILE/node_modules/dsh-ontsql-demo"
PATCH="$PROFILE/cordis.patch.yml"
DRY_RUN=0
[ "${1:-}" = "--dry-run" ] && DRY_RUN=1

say() { printf '%s\n' "$*"; }
run() { if [ "$DRY_RUN" = 1 ]; then say "  [dry-run] $*"; else "$@"; fi; }

[ -f "$PLUGIN_DIR/package.json" ] || { say "缺少 $PLUGIN_DIR/package.json"; exit 1; }
[ -d "$PROFILE" ] || { say "找不到 profile 目录：$PROFILE（DSH 是否已启动过？）"; exit 1; }
[ -f "$PATCH" ] || { say "找不到 patch 文件：$PATCH"; exit 1; }

say "插件目录：$PLUGIN_DIR"
say "profile ：$PROFILE"

if [ -L "$LINK" ]; then
  current="$(readlink "$LINK")"
  if [ "$current" = "$PLUGIN_DIR" ]; then
    say "软链已就绪：node_modules/dsh-ontsql-demo"
  else
    say "修正软链：$current -> $PLUGIN_DIR"
    run ln -sfn "$PLUGIN_DIR" "$LINK"
  fi
elif [ -e "$LINK" ]; then
  say "node_modules/dsh-ontsql-demo 已存在且不是软链，拒绝覆盖：$LINK"
  exit 1
else
  say "创建软链：node_modules/dsh-ontsql-demo -> $PLUGIN_DIR"
  run ln -s "$PLUGIN_DIR" "$LINK"
fi

if grep -q "dsh-ontsql-demo" "$PATCH" 2>/dev/null; then
  say "patch 已包含 dsh-ontsql-demo，跳过"
else
  say "追加 patch 记录到 $PATCH"
  if [ "$DRY_RUN" = 1 ]; then
    say "  [dry-run] 追加 insert 记录（id: ontsql）"
  else
    cat >>"$PATCH" <<'YAML'

# ---- ontsql：把 OntopoloySQL Console 挂到 /ontsql/，经平台网关在浏览器里打开 ----
- insert:
    - id: ontsql
      name: 'dsh-ontsql-demo'
YAML
  fi
fi

say ""
if [ "$DRY_RUN" = 1 ]; then
  say "dry-run 结束，未做任何改动。"
else
  say "注册完成。profile 是 live 模式，保存后热加载，无需重启 dsh web。"
  say "浏览器入口：<平台地址>/api/v1/instances/<实例ID>/proxy/ontsql/"
fi
