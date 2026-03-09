#!/bin/bash
# Integration test for nympish-claude with Claude Code

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "============================================================"
echo "nympish-claude Integration Test"
echo "============================================================"
echo ""

# Check if servers are running
echo "Checking server status..."
cd "$PROJECT_DIR"
uv run nympish-claude server status
echo ""

# Test prompt
TEST_PROMPT="こんにちは。簡単に自己紹介してください。"

echo "Test prompt: $TEST_PROMPT"
echo ""
echo "Launching Claude Code via nympish-claude..."
echo "============================================================"
echo ""

# Set up environment variables manually for testing
export ANTHROPIC_BASE_URL="http://localhost:58080/anthropic"
export ANTHROPIC_AUTH_TOKEN="dummy"
export ANTHROPIC_MODEL="mlx-community/Qwen3-8B-3bit"

# Disable Vertex AI to ensure local LLM is used
unset CLAUDE_CODE_USE_VERTEX
unset ANTHROPIC_VERTEX_PROJECT_ID

echo "Environment variables:"
echo "  ANTHROPIC_BASE_URL=$ANTHROPIC_BASE_URL"
echo "  ANTHROPIC_MODEL=$ANTHROPIC_MODEL"
echo ""

# Launch Claude Code with the test prompt and verbose logging
claude --verbose "$TEST_PROMPT"

echo ""
echo "============================================================"
echo "Integration test completed"
echo "============================================================"
