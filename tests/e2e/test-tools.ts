#!/usr/bin/env tsx

/**
 * Tool calling test for anthropic-server
 * Tests the tool use functionality
 */

import Anthropic from '@anthropic-ai/sdk';

const PORT = process.env.PORT || 4000;
const BASE_URL = `http://localhost:${PORT}`;
const MODEL = 'claude-3-5-sonnet-20241022';

// Define test tools
const tools: Anthropic.Tool[] = [
  {
    name: 'get_weather',
    description: 'Get the current weather in a given location',
    input_schema: {
      type: 'object',
      properties: {
        location: {
          type: 'string',
          description: 'The city and state, e.g. San Francisco, CA'
        },
        unit: {
          type: 'string',
          enum: ['celsius', 'fahrenheit'],
          description: 'The unit of temperature'
        }
      },
      required: ['location']
    }
  },
  {
    name: 'calculate',
    description: 'Perform a mathematical calculation',
    input_schema: {
      type: 'object',
      properties: {
        expression: {
          type: 'string',
          description: 'The mathematical expression to evaluate, e.g. "2 + 2"'
        }
      },
      required: ['expression']
    }
  }
];

async function testToolCalling() {
  console.log('=== Tool Calling Test ===\n');

  // Initialize client
  const anthropic = new Anthropic({
    apiKey: 'dummy',
    baseURL: BASE_URL,
  });

  // Test 1: Request that should trigger tool use
  console.log('Test 1: Weather query (should use get_weather tool)');
  console.log('-'.repeat(60));

  const message1 = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1024,
    tools: tools,
    messages: [
      {
        role: 'user',
        content: 'What is the weather like in Tokyo?'
      }
    ]
  });

  console.log(`Response ID: ${message1.id}`);
  console.log(`Stop reason: ${message1.stop_reason}`);
  console.log('\nContent blocks:');

  for (const block of message1.content) {
    if (block.type === 'text') {
      console.log(`  [text] ${block.text}`);
    } else if (block.type === 'tool_use') {
      console.log(`  [tool_use]`);
      console.log(`    ID: ${block.id}`);
      console.log(`    Name: ${block.name}`);
      console.log(`    Input: ${JSON.stringify(block.input, null, 2)}`);
    }
  }

  console.log('\n' + '='.repeat(60) + '\n');

  // Test 2: Request that should trigger calculation
  console.log('Test 2: Math query (should use calculate tool)');
  console.log('-'.repeat(60));

  const message2 = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1024,
    tools: tools,
    messages: [
      {
        role: 'user',
        content: 'What is 123 * 456?'
      }
    ]
  });

  console.log(`Response ID: ${message2.id}`);
  console.log(`Stop reason: ${message2.stop_reason}`);
  console.log('\nContent blocks:');

  for (const block of message2.content) {
    if (block.type === 'text') {
      console.log(`  [text] ${block.text}`);
    } else if (block.type === 'tool_use') {
      console.log(`  [tool_use]`);
      console.log(`    ID: ${block.id}`);
      console.log(`    Name: ${block.name}`);
      console.log(`    Input: ${JSON.stringify(block.input, null, 2)}`);
    }
  }

  console.log('\n' + '='.repeat(60) + '\n');

  // Test 3: Request that should NOT trigger tool use
  console.log('Test 3: Simple question (should NOT use tools)');
  console.log('-'.repeat(60));

  const message3 = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1024,
    tools: tools,
    messages: [
      {
        role: 'user',
        content: 'Tell me a joke'
      }
    ]
  });

  console.log(`Response ID: ${message3.id}`);
  console.log(`Stop reason: ${message3.stop_reason}`);
  console.log('\nContent blocks:');

  for (const block of message3.content) {
    if (block.type === 'text') {
      console.log(`  [text] ${block.text}`);
    } else if (block.type === 'tool_use') {
      console.log(`  [tool_use]`);
      console.log(`    ID: ${block.id}`);
      console.log(`    Name: ${block.name}`);
      console.log(`    Input: ${JSON.stringify(block.input, null, 2)}`);
    }
  }

  console.log('\n=== Test Complete ===');
}

testToolCalling().catch(error => {
  console.error('Test failed:', error);
  process.exit(1);
});
