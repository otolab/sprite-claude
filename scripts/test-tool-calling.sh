#!/bin/bash
# Test tool calling functionality

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "nympish-claude Tool Calling Test"
echo "================================="
echo ""

# Check if servers are running
echo "Checking server status..."
cd "$PROJECT_DIR"
uv run nympish-claude server status

echo ""
echo "Running tests..."
echo ""

# Run the test script
uv run --project "$PROJECT_DIR" python tests/test_tool_calling.py
