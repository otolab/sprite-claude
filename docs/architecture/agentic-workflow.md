# Agentic ワークフローモード

## 概要

`sprite-claude` の新しいワークフローモード `agentic` は、`@modular-prompt/process@0.2.0` の `agenticProcess` を使用した会話応答機能です。

- **処理層**: `passthrough` モードと同様に `handleMessages` から直接呼び出される
- **有効化**: `config.yaml` で `workflow: { mode: agentic }` を設定
- **特徴**: タスク管理機能を持つプロセス実行エンジンを利用し、より構造化された応答生成が可能

## アーキテクチャと処理フロー

agentic モードは以下の5つのステップで処理を行います:

### 1. Anthropic メッセージ変換

`convertToElements()` ヘルパー関数を使用して、Anthropic 形式のメッセージを `MessageElement[]` に変換します。この関数は passthrough モードと共通で使用されています。

**変換内容**:
- `tool_use` ブロック → `StandardMessageElement.toolCalls` に含まれる `ToolCall[]`
- `tool_result` ブロック → `ToolResultMessageElement`
- テキストメッセージ → `MessageElement` (role: user/assistant)

### 2. PromptModule 構築

agenticProcess に渡す `PromptModule<AgenticWorkflowContext>` を構築します:

```typescript
const module: PromptModule<AgenticWorkflowContext> = {
  objective: ['作業指示に従ってメッセージ応答を作成する'],
  instructions: systemPromptText ? [systemPromptText] : [],
  messages: elements,  // 変換された MessageElement[]
};
```

**フィールド**:
- `objective`: 固定値（モジュール全体の目的）
- `instructions`: Anthropic リクエストの `system` フィールドから抽出したテキスト
- `messages`: 変換された会話履歴（tool_use/tool_result を含む）

### 3. AgenticWorkflowContext 構築

実行コンテキストを構築します:

```typescript
const context: AgenticWorkflowContext = {
  objective,     // 最後のユーザーメッセージのテキスト
  taskList,      // [{ taskType: 'output', instruction: '会話に応答して' }]
};
```

**objective の抽出**:
- 最後のユーザーメッセージのテキスト部分を結合したもの
- 複数の text ブロックがある場合は改行で結合

**taskList**:
- `output` タスク1つのみを設定（`enablePlanning: false` のため）

### 4. agenticWorkflow() 呼び出し

engine 層の `agenticWorkflow` 関数を呼び出します:

```typescript
const result = await agenticWorkflow(
  aiService,
  module,
  context,
  request.tools || [],
  engineLogger,
  { mode: 'agentic', maxTokens: maxTokensConfig },
);
```

内部では以下を実行:
1. AIDriver の解決 (`resolveDriver`)
2. `EngineTool[]` → `ToolSpec[]` への変換 (`toToolSpecs`)
3. `agenticProcess` の実行（`enablePlanning: false`）
4. `result.context.executionLog` から `pendingToolCalls` をチェック

### 5. 結果変換

`toContentBlocks()` で Anthropic 形式の `ContentBlock[]` に変換します:

- `pendingToolCalls` があれば → `WorkflowResult { type: 'tool_calls', ... }`
- なければ → `WorkflowResult { type: 'response', text: result.output }`

## ツールコールの扱い

agentic モードでは、3方向のツール ID 変換を行います。

### Incoming: Anthropic → agenticProcess

Anthropic 形式のメッセージを `convertToElements` で変換する際:

- **tool_use ブロック**:
  - `StandardMessageElement.toolCalls` に `ToolCall[]` として追加
  - Anthropic ID (`toolu_...`) → driver ID への解決は `toolIdMap` を使用

- **tool_result ブロック**:
  - `ToolResultMessageElement` に変換
  - `toolCallId` に driver ID を設定（`toolIdMap.get(block.tool_use_id)`）
  - `name` は `toolUseNameMap` から取得（先に tool_use を収集して構築）

### agenticProcess 内部

**外部ツール（EngineTool[]）の扱い**:
- `toToolSpecs()` で `ToolSpec[]` に変換して `agenticProcess` に渡す
- handler は no-op（`async () => ({})`）- 実行はせず、定義のみを渡す

**agenticProcess の動作**:
- `queryWithTools` は外部ツール定義（`externalToolDefs`）のみを LLM に渡す
- LLM が外部ツールを呼び出した場合:
  - `queryWithTools` はループを即座に停止
  - `pendingToolCalls` として返す（実行はしない）
- builtin ツール（`__` prefix、例: `__insert_tasks`, `__time`）のみ内部で実行

### Outgoing: agenticProcess → Anthropic

`agenticWorkflow` の結果処理:

1. `result.context.executionLog` の最後のエントリをチェック
2. `pendingToolCalls` があれば:
   - `WorkflowResult { type: 'tool_calls', calls: [...] }` に変換
3. `toContentBlocks` で Anthropic 形式に変換:
   - driver ID → Anthropic ID に変換（`toAnthropicToolId`）
   - `toolIdMap` に ID マッピングを保存（次回の tool_result 用）

## agenticProcess のタスク実行モデル

現在の実装では `enablePlanning: false` を使用しています:

### Bootstrap 段階
- `output` タスク1つのみ生成される（planning タスクは生成されない）
- `context.taskList` には `[{ taskType: 'output', instruction: '会話に応答して' }]` を設定済み

### Output タスクの実行
- **userModule 全体**（objective, instructions, messages すべて）が使用される
- これにより、会話履歴とシステムプロンプトを含む完全なコンテキストで応答生成が可能

### 他のタスクタイプ
- planning, toolCall, think 等のタスクでは objective/terms のみが使用される
- 現在は `output` タスクのみのため、これらは実行されない

## 型の対応関係

| agenticProcess 側 | engine WorkflowResult 側 |
|---|---|
| `pendingToolCalls: ToolCall[]` (driver) | `{ type: 'tool_calls', calls: ToolCallResult[] }` |
| `result.output` (テキスト) | `{ type: 'response', text }` |

### ToolCall と ToolCallResult

両者は同じ構造を持ちます:

```typescript
// core/driver の ToolCall
{ id: string, name: string, arguments: Record<string, unknown> | string }

// engine の ToolCallResult
{ id: string, name: string, arguments: Record<string, unknown> }
```

`agenticWorkflow` 内で `arguments` が文字列の場合は JSON.parse して Record に変換します。

## 変更されたファイル

### 依存関係追加

| ファイル | 変更 |
|---|---|
| `packages/engine/package.json` | `@modular-prompt/process: "0.2.0"` 追加 |

### 型定義

| ファイル | 変更 |
|---|---|
| `packages/engine/src/types.ts` | `WorkflowMode` に `'agentic'` 追加 |
| `packages/anthropic-server/src/server/types.ts` | `workflow.mode` に `'agentic'` 追加 |

### 実装

| ファイル | 変更 |
|---|---|
| `packages/engine/src/workflows/agentic.ts` | 新規: `agenticWorkflow` 関数 |
| `packages/engine/src/index.ts` | `agenticWorkflow`, `AgenticWorkflowContext`, `AgenticTask` エクスポート |
| `packages/anthropic-server/src/messages/index.ts` | `convertToElements` ヘルパー抽出、agentic 分岐追加（L232-272） |

## 設定例

`config.yaml`:

```yaml
workflow:
  mode: agentic
```

これにより、全てのツール付きリクエストが agentic モードで処理されます。

## 今後の拡張可能性

- `enablePlanning: true` にすることで、planning タスクを使った複雑なタスク分解が可能
- カスタムタスクタイプの追加
- builtin ツールの活用（`__insert_tasks`, `__time` 等）
