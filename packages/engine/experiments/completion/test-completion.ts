#!/usr/bin/env tsx
import { MlxProcess } from '@modular-prompt/driver';
import { extractJSON } from '@modular-prompt/utils';
import fs from 'fs/promises';

interface TestConfig {
  model: string;
  promptFile: string;
  maxTokens: number;
  temperature: number;
}

async function parseArgs(): Promise<TestConfig> {
  const args = process.argv.slice(2);

  if (args.length < 2) {
    console.error('Usage: tsx scripts/test-completion.ts <model> <prompt-file> [maxTokens] [temperature]');
    console.error('');
    console.error('Examples:');
    console.error('  tsx scripts/test-completion.ts mlx-community/gemma-3-4b-it-qat-4bit /tmp/phase1-prompt.txt');
    console.error('  tsx scripts/test-completion.ts mlx-community/gemma-3-1b-it-bf16 /tmp/phase2-prompt.txt 500');
    console.error('  tsx scripts/test-completion.ts mlx-community/gemma-3-4b-it-qat-4bit /tmp/test.md 1000 0.1');
    process.exit(1);
  }

  const model = args[0];
  const promptFile = args[1];
  const maxTokens = args[2] ? parseInt(args[2], 10) : 1000;
  const temperature = args[3] ? parseFloat(args[3]) : 0.1;

  // Validate prompt file exists
  try {
    await fs.access(promptFile);
  } catch (error) {
    console.error(`Error: Prompt file not found: ${promptFile}`);
    process.exit(1);
  }

  return { model, promptFile, maxTokens, temperature };
}

async function testCompletion() {
  const config = await parseArgs();

  console.log('=== Test Configuration ===');
  console.log(`Model: ${config.model}`);
  console.log(`Prompt File: ${config.promptFile}`);
  console.log(`Max Tokens: ${config.maxTokens}`);
  console.log(`Temperature: ${config.temperature}`);
  console.log();

  const prompt = await fs.readFile(config.promptFile, 'utf-8');

  // Initialize and warm up the model
  console.log('=== Initializing Model ===');
  const mlx = new MlxProcess(config.model);

  console.log('=== Warming Up Model ===');
  const warmupStart = Date.now();
  const warmupStream = await mlx.completion('test', {
    maxTokens: 10,
    temperature: 0.1,
  });

  for await (const chunk of warmupStream) {
    // Consume warmup output
  }
  const warmupTime = Date.now() - warmupStart;
  console.log(`Model loaded and warmed up in ${warmupTime}ms`);
  console.log();

  console.log('=== Starting Completion ===');
  const startTime = Date.now();

  const stream = await mlx.completion(prompt, {
    maxTokens: config.maxTokens,
    temperature: config.temperature,
  });

  let result = '';
  for await (const chunk of stream) {
    result += chunk;
  }

  const elapsedTime = Date.now() - startTime;

  console.log('=== Generated Output ===');
  console.log(result);
  console.log();

  console.log(`=== Completion Time: ${elapsedTime}ms ===`);
  console.log();

  const jsonResult = extractJSON(result);
  console.log('=== JSON Validation ===');
  if (jsonResult.source === 'none' || !jsonResult.data) {
    console.log('✗ No JSON found');
    return;
  }

  console.log('✓ Valid JSON extracted');
  console.log('  Source:', jsonResult.source);
  console.log('\n=== Parsed Structure ===');
  console.log(JSON.stringify(jsonResult.data, null, 2));
}

testCompletion().catch(console.error).finally(() => process.exit(0));
