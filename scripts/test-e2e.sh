#!/bin/bash

# E2E Test for nympish-claude with anthropic-server
# Tests sending a prompt and receiving a response

set -e

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
PORT=${PORT:-4000}
MODEL=${MODEL:-"mlx-community/gemma-2-2b-it-4bit"}
TEST_PROMPT=${TEST_PROMPT:-"Hello! Please respond with 'Test successful' if you can read this message."}
MAX_TOKENS=${MAX_TOKENS:-100}

echo -e "${YELLOW}=== nympish-claude E2E Test ===${NC}"
echo ""
echo "Configuration:"
echo "  Port: $PORT"
echo "  Model: $MODEL"
echo "  Prompt: $TEST_PROMPT"
echo ""

# Check if server is running
echo -e "${YELLOW}Checking if anthropic-server is running...${NC}"
if ! curl -s http://localhost:$PORT/health > /dev/null 2>&1; then
    echo -e "${RED}Error: Anthropic server is not running on port $PORT${NC}"
    echo "Please start the server first:"
    echo "  nympish-claude server start"
    exit 1
fi
echo -e "${GREEN}✓ Server is running${NC}"
echo ""

# Send test request
echo -e "${YELLOW}Sending test request...${NC}"

RESPONSE=$(curl -s -X POST http://localhost:$PORT/v1/messages \
  -H "Content-Type: application/json" \
  -H "x-api-key: dummy" \
  -d '{
    "model": "claude-3-5-sonnet-20241022",
    "max_tokens": '"$MAX_TOKENS"',
    "messages": [
      {
        "role": "user",
        "content": "'"$TEST_PROMPT"'"
      }
    ]
  }')

# Check if response is valid
if [ -z "$RESPONSE" ]; then
    echo -e "${RED}Error: Empty response from server${NC}"
    exit 1
fi

# Parse response
if echo "$RESPONSE" | jq -e '.error' > /dev/null 2>&1; then
    echo -e "${RED}Error response from server:${NC}"
    echo "$RESPONSE" | jq '.'
    exit 1
fi

# Extract and display response text
if echo "$RESPONSE" | jq -e '.content[0].text' > /dev/null 2>&1; then
    RESPONSE_TEXT=$(echo "$RESPONSE" | jq -r '.content[0].text')
    echo -e "${GREEN}✓ Received response:${NC}"
    echo ""
    echo "$RESPONSE_TEXT"
    echo ""

    # Display usage stats
    INPUT_TOKENS=$(echo "$RESPONSE" | jq -r '.usage.input_tokens')
    OUTPUT_TOKENS=$(echo "$RESPONSE" | jq -r '.usage.output_tokens')
    echo -e "${YELLOW}Usage:${NC}"
    echo "  Input tokens: $INPUT_TOKENS"
    echo "  Output tokens: $OUTPUT_TOKENS"
    echo ""

    echo -e "${GREEN}=== E2E Test Passed ===${NC}"
    exit 0
else
    echo -e "${RED}Error: Invalid response format${NC}"
    echo "$RESPONSE" | jq '.'
    exit 1
fi
