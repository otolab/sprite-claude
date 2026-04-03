# @sprite-claude/engine

プロンプトモジュールとワークフロー制御を提供する、sprite-claude のコアエンジンパッケージです。

## 目的

このパッケージは以下を提供します：

1. **ワークフロー実行エンジン** - `process()` 関数による統一インターフェース
2. **プロンプトモジュール** - 分析、ツール生成、応答生成などの再利用可能なモジュール
3. **型定義** - エンジンとの連携に必要な型

## 公開API

### `process()` 関数

メインのエントリーポイント。会話履歴とツール定義を受け取り、ワークフローモードに応じて適切な処理を実行します。

```typescript
import { process } from '@sprite-claude/engine';

const result = await process(
  driver,           // AIDriver
  logger,           // EngineLogger
  messages,         // EngineMessage[]
  tools,            // EngineTool[]
  systemPrompt,     // string
  {
    mode: 'rag',    // WorkflowMode: 'rag' | 'decision' | 'chat'
    maxTokens: {    // オプション: 各フェーズのトークン制限
      phase1: 2000,
      phase2Tool: 1000,
      phase2Response: 2000,
    }
  }
);

// result: ProcessResult
// - { type: 'tool_call', toolName: string, input: Record<string, unknown> }
// - { type: 'response', text: string }
```

## 型定義

### EngineMessage

会話メッセージの構造を定義します。

```typescript
interface EngineMessage {
  type: 'message' | 'text';
  role?: 'system' | 'user' | 'assistant';
  content: string;
}
```

### EngineTool

利用可能なツールの定義です。

```typescript
interface EngineTool {
  name: string;
  description?: string;
  input_schema: {
    type: 'object';
    properties?: Record<string, unknown>;
    required?: string[];
    additionalProperties?: boolean;
  };
}
```

### ProcessResult

ワークフローの実行結果を表します。

```typescript
type ProcessResult =
  | { type: 'tool_call'; toolName: string; input: Record<string, unknown> }
  | { type: 'response'; text: string };
```

### EngineLogger

リクエストログを記録するインターフェースです。

```typescript
interface EngineLogger {
  logPrompt(phase: string, compiled: unknown): void;
  logLlmResponse(phase: string, data: QueryResult): void;
}
```

## ワークフローモード

### rag モード

2フェーズのRAG（Retrieval-Augmented Generation）アプローチを使用します。

- **Phase 1（分析）**: 会話履歴を分析し、関連コンテキストと重要事実を抽出。ツール使用の判断を行う
- **Phase 2（生成）**:
  - ツールパス: 抽出したコンテキストを使ってツール呼び出しパラメータを生成
  - 応答パス: 抽出したコンテキストを使って応答テキストを生成

詳細: [docs/experiments.md](./docs/experiments.md) を参照

### decision モード

シンプルな2フェーズアプローチでツール呼び出しを決定・生成します。

- **Phase 1（判断）**: 簡易的なツールリストからツール使用を判断
- **Phase 2（生成）**: フルスキーマを使って構造化ツール呼び出しを生成

### chat モード

通常のチャット応答を生成します。プロンプトモジュールを使った単一フェーズの処理です。

## プロンプトモジュール一覧

| モジュール | 説明 | 使用箇所 |
|----------|------|---------|
| `analysisModule` | Phase 1の分析（ユーザー意図、関連コンテキスト、重要事実の抽出） | rag ワークフロー |
| `toolGenerationModule` | Phase 2のツール生成 | rag ワークフロー |
| `responseGenerationModule` | Phase 2の応答生成 | rag ワークフロー |
| `toolGenerationLogicModule` | ツール生成ロジック（モジュール分割版） | experiments |
| `textJsonOutputModule` | テキスト+JSON出力フォーマット | experiments |
| `toolDecisionModule` | ツール使用判断 | decision ワークフロー |
| `toolCallModule` | ツール呼び出し生成 | decision ワークフロー |
| `chatModule` | チャット応答 | chat ワークフロー |

## ディレクトリ構造

```
packages/engine/
├── src/
│   ├── index.ts                # 公開API
│   ├── types.ts                # 型定義
│   ├── types/
│   │   └── tools.ts            # ツール関連型
│   ├── workflows/
│   │   ├── index.ts            # process() エントリーポイント
│   │   ├── rag.ts              # RAGワークフロー
│   │   ├── decision.ts         # Decisionワークフロー
│   │   └── chat.ts             # Chatワークフロー
│   └── prompts/
│       ├── analysis-module.ts           # 分析モジュール
│       ├── generation-module.ts         # 生成モジュール
│       ├── generation-logic-module.ts   # 生成ロジックモジュール
│       ├── text-json-output-module.ts   # テキスト+JSON出力モジュール
│       ├── call-module.ts               # ツール呼び出しモジュール
│       ├── decision-module.ts           # ツール判断モジュール
│       └── chat-module.ts               # チャットモジュール
├── experiments/              # 実験用ツール（詳細: docs/experiments.md）
│   ├── module-comparison/    # モジュール比較実験
│   ├── completion/           # MLXモデル直接テスト
│   └── verify/               # プロンプト構造検証
├── docs/
│   └── experiments.md        # experiments の使い方
└── README.md                 # このファイル
```

## experiments

プロンプトモジュールの検証と改善のための実験ツールを提供しています。

詳細は [docs/experiments.md](./docs/experiments.md) を参照してください。

### 主なツール

- **module-comparison**: `@modular-prompt/experiment` を使ったモジュール比較フレームワーク
- **completion**: MLXモデルで直接プロンプトをテストするツール
- **verify**: プロンプト構造を検証し、YAMLファイルとして出力するツール

## 使用例

### RAGワークフローの実行

```typescript
import { process } from '@sprite-claude/engine';
import type { EngineMessage, EngineTool, EngineLogger } from '@sprite-claude/engine';

const messages: EngineMessage[] = [
  { role: 'user', content: 'ファイルを整理しています。終わったら教えてください。' },
  { role: 'assistant', content: 'わかりました。ファイル整理を開始します。' },
  { role: 'user', content: '終わりました。' }
];

const tools: EngineTool[] = [
  {
    name: 'say',
    description: '日本語音声を非同期で出力します',
    input_schema: {
      type: 'object',
      properties: {
        speechText: { type: 'string', description: 'Text to speak (Japanese)' }
      },
      required: ['speechText']
    }
  }
];

const result = await process(
  driver,
  logger,
  messages,
  tools,
  'あなたは親切なAIアシスタントです。',
  { mode: 'rag' }
);

if (result.type === 'tool_call') {
  console.log(`Tool: ${result.toolName}`);
  console.log(`Input:`, result.input);
}
```

## 参考リンク

- [@modular-prompt/core](https://github.com/otolab/modular-prompt) - プロンプトモジュールシステム
- [@modular-prompt/driver](https://github.com/otolab/modular-prompt) - LLMドライバー
- [@modular-prompt/experiment](https://github.com/otolab/modular-prompt) - 実験フレームワーク
