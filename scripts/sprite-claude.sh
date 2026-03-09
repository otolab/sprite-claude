#!/bin/bash

# スクリプトの場所を取得（シンボリックリンク対応）
SCRIPT_PATH="$(readlink -f "$0")"
SCRIPT_DIR="$(dirname "$SCRIPT_PATH")"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# Run sprite-claude module with uv, specifying the project directory
uv run --project "$PROJECT_DIR" python -m sprite_claude.cli "$@"
