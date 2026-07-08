#!/usr/bin/env bash
# 部署脚本：news-hot-site 推送到 GitHub
# 严格按「先推送站点代码 → 再创建 Action」两步执行。
#
# 用法（二选一）：
#   方式 A · 用 PAT（全自动，推荐）:
#     bash deploy.sh code   <PAT>     # 第一步：推站点代码
#     bash deploy.sh action <PAT>     # 第二步：推 GitHub Actions 工作流
#     bash deploy.sh all    <PAT>     # 一次性两步做完
#
#   方式 B · 本机已 `gh` 登录:
#     bash deploy.sh code   gh
#     bash deploy.sh action gh
#     bash deploy.sh all    gh
#
# 说明：
#   - 默认推到 liumingmusic/news-hot-site（改下方 OWNER/REPO 可换仓库）
#   - PAT 需勾选 repo + workflow 权限
#   - 推完代码后，仍需在 GitHub 开启 Pages（Settings→Pages→main/(root)）
#     并到 Settings→Secrets 添加 DAILYHOT_API_BASE（默认 https://api-hot.imsyy.top）

set -euo pipefail

OWNER="liumingmusic"
REPO="news-hot-site"
REMOTE="https://github.com/${OWNER}/${REPO}.git"

MODE="${1:-all}"
ARG="${2:-}"
WF=".github/workflows/fetch.yml"

if [ -z "$ARG" ]; then
  echo "用法: bash deploy.sh <code|action|all> <PAT|gh>"
  exit 1
fi

# 配置 remote（带凭证）
setup_remote() {
  git remote remove origin 2>/dev/null || true
  if [ "$ARG" = "gh" ]; then
    if ! command -v gh >/dev/null 2>&1; then
      echo "❌ 未找到 gh，请先安装并运行 gh auth login"; exit 1
    fi
    gh repo set-default "${OWNER}/${REPO}" 2>/dev/null || true
    git remote add origin "$REMOTE"
    # 让 git 走 gh 的凭证
    git config --local "credential.https://github.com.helper" "$(gh auth setup-git 2>/dev/null; echo "")"
  else
    git remote add origin "https://${ARG}@github.com/${OWNER}/${REPO}.git"
  fi
}

push_code() {
  echo "==> [1/2] 推送站点代码（前端 + 抓取脚本 + 文档，不含 Action）"
  # 暂存工作流，先只推代码
  local tmp
  tmp="$(mktemp)"
  if [ -f "$WF" ]; then mv "$WF" "$tmp"; fi
  git add -A
  git commit -q -m "chore: 站点代码（前端 + 抓取脚本 + 文档）" || echo "（无新提交，跳过）"
  git push -u origin main || git push -u origin HEAD:main
  # 恢复工作流
  if [ -f "$tmp" ]; then mkdir -p "$(dirname "$WF")" && mv "$tmp" "$WF"; fi
  echo "✅ 代码已推送。请到 GitHub 开启 Pages（Settings → Pages → main / (root)）。"
}

push_action() {
  echo "==> [2/2] 推送 GitHub Actions 工作流（创建自动抓取）"
  if [ ! -f "$WF" ]; then echo "❌ 未找到 $WF"; exit 1; fi
  git add "$WF"
  git commit -q -m "ci: 添加 GitHub Actions 每两天自动抓取工作流" || echo "（无新提交，跳过）"
  git push origin main
  echo "✅ Action 工作流已推送。可在仓库 Actions 页手动 Run workflow 触发首次抓取。"
}

setup_remote

case "$MODE" in
  code)   push_code ;;
  action) push_action ;;
  all)    push_code; push_action ;;
  *) echo "未知模式: $MODE（应为 code|action|all）"; exit 1 ;;
esac

echo ""
echo "后续步骤："
echo "  1) GitHub → Settings → Pages → Source: Deploy from a branch → main / (root) → Save"
echo "  2) GitHub → Settings → Secrets and variables → Actions → New secret:"
echo "       name=DALLYHOT_API_BASE  value=https://api-hot.imsyy.top"
echo "  3) GitHub → Actions → 选 'Fetch news hot' → Run workflow（首次抓取）"
echo "  4) 访问 https://${OWNER}.github.io/${REPO}/"
