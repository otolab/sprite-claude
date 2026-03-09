#!/usr/bin/env tsx

/**
 * E2E Test for nympish-claude with anthropic-server
 * Usage: tsx tests/e2e/test-e2e.ts [prompt]
 */

import Anthropic from '@anthropic-ai/sdk';

const PORT = process.env.PORT || 4000;
const BASE_URL = `http://localhost:${PORT}`;
const MODEL = 'claude-3-5-sonnet-20241022';
const MAX_TOKENS = 1024;

const DEFAULT_PROMPT = "Hello! Please respond with 'Test successful' if you can read this message.";

async function testE2E(prompt: string) {
  console.log('=== nympish-claude E2E Test ===\n');
  console.log('Configuration:');
  console.log(`  Base URL: ${BASE_URL}`);
  console.log(`  Model: ${MODEL}`);
  console.log(`  Prompt: ${prompt}`);
  console.log('');

  // Check health
  console.log('Checking server health...');
  try {
    const healthResponse = await fetch(`${BASE_URL}/health`);
    if (!healthResponse.ok) {
      throw new Error(`Health check failed: ${healthResponse.status}`);
    }
    console.log('✓ Server is healthy\n');
  } catch (error) {
    console.error('✗ Server is not running');
    console.error('Please start the server first:');
    console.error('  nympish-claude server start');
    process.exit(1);
  }

  // Initialize Anthropic client
  const anthropic = new Anthropic({
    apiKey: 'dummy', // Not required for local server
    baseURL: BASE_URL,
  });

  console.log('Sending request to anthropic-server...');
  const startTime = Date.now();

  try {
    const message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
    });

    const elapsed = Date.now() - startTime;

    console.log('✓ Received response\n');
    console.log('Response:');
    console.log('-'.repeat(50));

    // Extract text content
    const textContent = message.content.find(block => block.type === 'text');
    if (textContent && 'text' in textContent) {
      console.log(textContent.text);
    }

    console.log('-'.repeat(50));
    console.log('');

    console.log('Metadata:');
    console.log(`  ID: ${message.id}`);
    console.log(`  Model: ${message.model}`);
    console.log(`  Stop reason: ${message.stop_reason}`);
    console.log(`  Input tokens: ${message.usage.input_tokens}`);
    console.log(`  Output tokens: ${message.usage.output_tokens}`);
    console.log(`  Time: ${elapsed}ms`);
    console.log('');

    console.log('=== E2E Test Passed ===');
    process.exit(0);
  } catch (error) {
    console.error('✗ Request failed');
    if (error instanceof Error) {
      console.error(`Error: ${error.message}`);
    } else {
      console.error(error);
    }
    process.exit(1);
  }
}

// Get prompt from command line or use default
const prompt = process.argv[2] || DEFAULT_PROMPT;

testE2E(prompt);
