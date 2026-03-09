#!/usr/bin/env tsx
/**
 * Phase1プロンプト マルチモデルテストスクリプト
 *
 * 失敗したPhase1プロンプトを複数のMLXモデルでテストし、
 * パターン模倣問題がモデル依存か確認する
 *
 * 使い方:
 *   tsx scripts/test-phase1-multimodel.ts
 */

import { MlxProcess } from '@modular-prompt/driver';
import { extractJSON } from '@modular-prompt/utils';
import fs from 'fs/promises';

const PROMPT_FILE = '/tmp/failed-phase1-prompt.txt';

// テスト対象のMLXモデル（サイズ順: 小→大）
const MODELS_TO_TEST = [
  { name: 'mlx-community/gemma-3-4b-it-qat-4bit', size: '4B', note: '小型・高速' },
  // { name: 'mlx-community/gemma-3-12b-it-qat-4bit', size: '12B', note: '中型' },
  // { name: 'mlx-community/gemma-3-27b-it-qat-4bit', size: '27B', note: '現在使用中・大型' },
  // { name: 'mlx-community/qwq-bakeneko-32b-4bit', size: '32B', note: '最大・低速' },
];

interface TestResult {
  model: string;
  size: string;
  note: string;
  success: boolean;
  isValidJSON: boolean;
  response?: string;
  parsed?: any;
  error?: string;
  duration: number;
}

async function testModel(modelName: string, size: string, note: string, promptContent: string): Promise<TestResult> {
  const startTime = Date.now();
  let process: MlxProcess | null = null;

  try {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`Testing: ${modelName} (${size}) - ${note}`);
    console.log(`${'='.repeat(80)}`);

    // Initialize MLX Process with the model
    process = new MlxProcess(modelName);

    console.log('  Process initialized, querying...');

    // Query the model using raw completion API
    const stream = await process.completion(promptContent, {
      maxTokens: 1024,
      temperature: 0.7,
    });

    // Collect all chunks from the stream
    let response = '';
    for await (const chunk of stream) {
      response += chunk;
    }

    const duration = Date.now() - startTime;

    console.log(`  Response (${duration}ms):`);
    console.log('  ' + '-'.repeat(78));
    // Show full response for debugging
    console.log('  ' + response.split('\n').join('\n  '));
    console.log('  ' + '-'.repeat(78));

    // Extract JSON from response (handles markdown code blocks)
    let isValidJSON = false;
    let parsed: any = undefined;

    const jsonResult = extractJSON(response);
    if (jsonResult.source !== 'none' && jsonResult.data) {
      parsed = jsonResult.data;
      isValidJSON = true;
      console.log(`  ✓ Valid JSON detected (source: ${jsonResult.source}${jsonResult.repaired ? ', repaired' : ''})`);
      console.log(`  - Has 'analysis': ${!!parsed.analysis}`);
      console.log(`  - Has 'action': ${!!parsed.action}`);
      if (parsed.action) {
        console.log(`  - action.type: ${parsed.action.type}`);
        console.log(`  - action.toolName: ${parsed.action.toolName || 'N/A'}`);
      }

      // Show detailed analysis content
      console.log('\n  📋 Detailed Analysis:');
      console.log('  ' + JSON.stringify(parsed, null, 2).split('\n').join('\n  '));
    } else {
      console.log('  ✗ No valid JSON found');
      if (jsonResult.error) {
        console.log(`  - Error: ${jsonResult.error}`);
      }
    }

    return {
      model: modelName,
      size,
      note,
      success: true,
      isValidJSON,
      response,
      parsed,
      duration,
    };

  } catch (error) {
    const duration = Date.now() - startTime;
    console.log(`  ✗ Error: ${error instanceof Error ? error.message : String(error)}`);

    return {
      model: modelName,
      size,
      note,
      success: false,
      isValidJSON: false,
      error: error instanceof Error ? error.message : String(error),
      duration,
    };
  } finally {
    // Close the process to free resources
    if (process) {
      try {
        console.log('  Closing process...');
        await process.exit();
        // Wait a few seconds for the process to fully terminate
        await new Promise(resolve => setTimeout(resolve, 3000));
        console.log('  ✓ Process closed');
      } catch (error) {
        console.log(`  ⚠ Warning: Failed to close process: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
}

async function main() {
  console.log('Phase1 Prompt Multi-Model Test');
  console.log('==============================\n');

  // プロンプトファイルの読み込み
  let promptContent: string;
  try {
    promptContent = await fs.readFile(PROMPT_FILE, 'utf-8');
    const stats = await fs.stat(PROMPT_FILE);
    console.log(`Prompt file: ${PROMPT_FILE}`);
    console.log(`Size: ${stats.size} bytes\n`);
  } catch (error) {
    console.error(`Error: Prompt file not found at ${PROMPT_FILE}`);
    console.log('\nPlease extract the prompt first with:');
    console.log('  cd ~/.sprite-claude/logs/requests');
    console.log('  cat 2025-11-27T07-03-15-6162-0020.jsonl | jq -r \'select(.phase == "phase1-analysis" and .type == "prompt") | .data.content\' > /tmp/failed-phase1-prompt.txt');
    process.exit(1);
  }

  // テスト実行
  const results: TestResult[] = [];

  for (const model of MODELS_TO_TEST) {
    const result = await testModel(model.name, model.size, model.note, promptContent);
    results.push(result);
  }

  // サマリー表示
  console.log('\n\n');
  console.log('='.repeat(80));
  console.log('TEST SUMMARY');
  console.log('='.repeat(80));
  console.log();

  console.log('Model                                          Size  Valid JSON  Time    Note');
  console.log('-'.repeat(80));

  for (const result of results) {
    const modelShort = result.model.replace('mlx-community/', '');
    const status = result.success
      ? (result.isValidJSON ? '✓ YES' : '✗ NO ')
      : '✗ ERR';
    const time = `${result.duration}ms`;

    console.log(
      `${modelShort.padEnd(44)} ` +
      `${result.size.padEnd(5)} ` +
      `${status.padEnd(10)} ` +
      `${time.padEnd(7)} ` +
      `${result.note}`
    );
  }

  console.log();

  // 結論
  const validJSONCount = results.filter(r => r.isValidJSON).length;
  const totalCount = results.filter(r => r.success).length;

  console.log('='.repeat(80));
  console.log('CONCLUSION');
  console.log('='.repeat(80));
  console.log(`Valid JSON: ${validJSONCount}/${totalCount} models`);
  console.log();

  if (validJSONCount === 0) {
    console.log('→ プロンプト構造の問題');
    console.log('  すべてのモデルでJSON出力失敗 = 会話履歴が支配的');
    console.log('  対策: Phase1に渡す会話履歴を制限する');
  } else if (validJSONCount === totalCount) {
    console.log('→ 再現性の問題');
    console.log('  すべてのモデルでJSON出力成功 = 温度パラメータなどの問題');
    console.log('  対策: temperature を下げる、または問題を再調査');
  } else {
    console.log('→ モデル依存の問題');
    console.log(`  ${validJSONCount}個のモデルは成功、他は失敗 = モデル性能差`);
    console.log('  対策: より大きなモデルを使用、またはプロンプト改善');

    console.log('\nSuccessful models:');
    results.filter(r => r.isValidJSON).forEach(r => {
      console.log(`  - ${r.model} (${r.size})`);
    });

    console.log('\nFailed models:');
    results.filter(r => r.success && !r.isValidJSON).forEach(r => {
      console.log(`  - ${r.model} (${r.size})`);
    });
  }

  console.log('\n' + '='.repeat(80));
}

main().catch(console.error);
