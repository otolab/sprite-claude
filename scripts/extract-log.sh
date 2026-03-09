#!/bin/bash
# ログからプロンプトと応答を抽出するツール

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$PROJECT_ROOT"
tsx packages/anthropic-server/src/analysis/extract-log.ts "$@"
