# Agentic ワークフローモード

## 概要

`sprite-claude` の新しいワークフローモード `agentic` は、`@modular-prompt/process@0.4.15` の `agenticProcess` を使用した会話応答機能です。

- **処理層**: `passthrough` モードと同様に `handleMessages` から直接呼び出される
- **有効化**: `config.yaml` で `workflow: { mode: agentic }` を設定
- **特徴**: タスク管理機能を持つプロセス実行エンジンを利用し、より構造化された応答生成が可能
- **Planning**: `enablePlanning: true` でタスク設計を自動化

## アーキテクチャと処理フロー

agentic モードは以下の6つのステップで処理を行います:

### 1. リクエストからpromptModuleへの変換

HTTPリクエスト（Anthropic Messages API形式）がagenticProcessに渡るまでの詳細な変換フロー:

#### 1.1 handleMessages（`packages/anthropic-server/src/messages/index.ts`）

1. **system フィールドの抽出**
   - `request.system`（Claude Codeのsystemフィールド） → `extractSystemText()` → `module.instructions`

2. **system-reminder の抽出**
   - `request.messages` → `extractSystemReminders()`
   - `<system-reminder>` タグで囲まれたセクション → `module.materials`
   - メッセージ本体（system-reminder除去後） → 次の変換へ

3. **agenticPrompts の読み込み**（config.yaml指定がある場合）
   - `loadPromptModules()` で baseModule を構築
   - materials/messages を追加

#### 1.2 agenticWorkflow（`packages/engine/src/workflows/agentic.ts`）

1. **PromptModule のコンパイル**
   - `compile(module, context)` で PromptModule を CompiledPrompt に変換
   - DynamicContent関数を実行し静的な値に変換

2. **agenticProcess への投入**
   - `agenticProcess(driverInput, module, context, agenticOptions)` に渡す
   - `enablePlanning: true` が設定される

### 2. Anthropic メッセージ変換

`convertToElements()` ヘルパー関数を使用して、Anthropic 形式のメッセージを `MessageElement[]` に変換します。この関数は passthrough モードと共通で使用されています。

**変換内容**:
- `tool_use` ブロック → `StandardMessageElement.toolCalls` に含まれる `ToolCall[]`
- `tool_result` ブロック → `ToolResultMessageElement`
- テキストメッセージ → `MessageElement` (role: user/assistant)

### 3. PromptModule 構築

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

### 4. AgenticWorkflowContext 構築

実行コンテキストを構築します:

```typescript
const context: AgenticWorkflowContext = {
  objective: '対話履歴に基づいてユーザーに応答する',
  taskList,      // [{ taskType: 'output', instruction: '会話に応答して' }]
};
```

**objective**: 全タスクに instruction として渡される主要な目的。簡潔な指示文を設定する（ユーザーメッセージは module.messages に含まれるため重複不要）。

**taskList**:
- `enablePlanning: true` のため、初期タスクリストは空（bootstrap時にplanningタスクが生成される）

### 5. agenticWorkflow() 呼び出し

engine 層の `agenticWorkflow` 関数を呼び出します:

```typescript
const result = await agenticWorkflow(
  driverInput,  // AIDriver | DriverSet
  module,
  context,
  request.tools || [],
  engineLogger,
  { mode: 'agentic', maxTokens: maxTokensConfig },
);
```

**引数の変更**（@modular-prompt/process 0.3.x 対応）:
- 第1引数が `aiService: AIService` から `driverInput: DriverInput` に変更
- `DriverInput` = `AIDriver | DriverSet`（@modular-prompt/processの型）
- DriverSetを渡すことで、役割ごとに異なるモデルを使用可能

内部では以下を実行:
1. `EngineTool[]` → `ToolDefinition[]` への変換 (`toToolDefinitions`)
   - `@modular-prompt/process@0.4.14` 以降、`ToolSpec[]` から `ToolDefinition[]`（`@modular-prompt/driver`）に変更
2. `agenticProcess` の実行（`enablePlanning: true`）
3. `result.context.executionLog` から `pendingToolCalls` をチェック

### 6. 結果変換

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
- `toToolDefinitions()` で `ToolDefinition[]`（`@modular-prompt/driver`）に変換して `agenticProcess` に渡す
- handler は no-op（`async () => ({})`）- 実行はせず、定義のみを渡す

**agenticProcess の動作**:
- `queryWithTools` は外部ツール定義（`externalToolDefs`）のみを LLM に渡す
- LLM が外部ツールを呼び出した場合:
  - `queryWithTools` はループを即座に停止
  - `pendingToolCalls` として返す（実行はしない）
- builtin ツール（`__` prefix、例: `__register_task`, `__time`）のみ内部で実行

### Outgoing: agenticProcess → Anthropic

`agenticWorkflow` の結果処理:

1. `result.context.executionLog` の最後のエントリをチェック
2. `pendingToolCalls` があれば:
   - `WorkflowResult { type: 'tool_calls', calls: [...] }` に変換
3. `toContentBlocks` で Anthropic 形式に変換:
   - driver ID → Anthropic ID に変換（`toAnthropicToolId`）
   - `toolIdMap` に ID マッピングを保存（次回の tool_result 用）

## agenticProcess のタスク実行モデル

現在の実装では `enablePlanning: true` を使用しています:

### Bootstrap 段階
- `planning` タスクが最初に生成される
- `context.taskList` は空（plannerがタスクを登録する）

### Planning タスクの実行

#### plannerへのプロンプト変換フロー

1. **agenticProcess内部**（`@modular-prompt/process` の `agentic-workflow.js`）
   - `bootstrap()` で `enablePlanning: true` の場合、最初に `planning` タスクを生成
   - `executeTask()` でplanningタスクを実行する際:
     - `workflowBase = { terms: userModule.terms }` （元のinstructions/materials/messagesは含まない）
     - `merge(workflowBase, planningModule)` でplanning専用のPromptModuleとマージ

2. **planningModule**（`@modular-prompt/process` の `task-types/planning.js`）
   - `materials` フィールドはDynamicContent関数
   - `ctx.userModule`（元のPromptModule全体）を `distribute()` → `formatCompletionPrompt()` でテキスト化
   - 結果を `{ type: 'material', title: 'Original Request', content: text }` としてplannerに提供
   - つまり**元のリクエスト全体をplannerに「分析対象資料」として渡す**設計

#### plannerが見るプロンプトの構造

```
# Instructions（planner自身の指示）
  - You are the planner. Workflow design is your responsibility.
  - Task Type Guide, Planning Theory, Common Patterns 等

# Data
  ## Original Request（分析対象 = formatCompletionPromptでテキスト化されたuserModule）
    # Instructions        ← ★ 外側と同じヘッダレベル
      request.systemの内容（Claude Codeのシステムプロンプト等）
    # Data
      ## Messages
        ユーザーメッセージ
    # Output

# Output（cue）
  Analyze the prompt and register tasks by calling `__register_task`.
```

**既知の問題**: Original Request内の `# Instructions` と外側のplanner指示 `# Instructions` が同じMarkdownヘッダレベルで衝突し、小規模モデル（Gemma 4等）がどちらに従うか混乱する場合がある。対策としてOriginal Requestの内容をblockquote（`>`）で囲む方法を検討中。

#### plannerのツール呼び出し

- `__register_task` builtin ツールを呼び出してタスクを登録
- タスク登録の履歴は `task_registration` ログエントリとして記録される（後述）

### Output タスクの実行
- **userModule 全体**（objective, instructions, messages すべて）が使用される
- これにより、会話履歴とシステムプロンプトを含む完全なコンテキストで応答生成が可能

### 他のタスクタイプ
- think, act, verify 等のタスクでは objective/terms のみが使用される
- `withXxx` フラグ（`withMessages`, `withMaterials` 等）で追加データの可視性を制御可能

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

## 新しいエントリーポイント: runWorkflow()

@modular-prompt/process 0.3.x 以降、`runWorkflow()` が統合エントリーポイントとして導入されました:

**実装**: `packages/engine/src/workflows/runner.ts`

```typescript
export async function runWorkflow<T>(
  def: WorkflowDefinition,
  aiService: AIService,
  module: PromptModule<T>,
  context: T,
  tools: EngineTool[],
  logger: EngineLogger,
  options: WorkflowOptions,
): Promise<WorkflowResult>
```

**機能**:
1. **WorkflowDefinitionからモデル解決**
   - `def.models`の各役割（`default`、`chat`、`plan`等）を`ModelSpec`に解決
   - 文字列（モデル名）または配列（capabilities）をサポート
2. **ドライバー構築**
   - agenticモード: DriverSetを構築（役割ごとのドライバー）
   - passthroughモード: 単一のAIDriverを構築
3. **ワークフロー実行**
   - `def.mode`に応じて`agenticWorkflow`または`passthroughWorkflow`を呼び出し

## 設定例

`config.yaml`:

```yaml
workflows:
  default:
    mode: agentic
    models:
      default: "gemini-2.5-flash"
      chat: [fast, japanese]
  routing:
    mode: passthrough
    models:
      default: [structured]

modelMapping:
  claude-3-5-sonnet-20241022: default

routingWorkflow: routing
```

これにより、`request.model`に応じて適切なワークフローが選択され、役割ごとに最適なモデルが使用されます。

## ログとデバッグ

### task_registration ログ

planningフェーズで `__register_task` 呼び出しを抽出し、専用の `task_registration` ログエントリとして記録します。

**実装**（`packages/tuning/analysis/extract-log.ts`）:
- `executionLog` からplanningフェーズのエントリを抽出
- `toolCalls` から `__register_task` 呼び出しを検出
- `taskType`, `instruction`, オプション（`withMessages`, `driverRole` 等）を抽出
- 専用のログエントリとして記録

**用途**:
- plannerがどのようなタスクシーケンスを設計したかを確認
- タスク設計の問題を診断
- plannerプロンプトの改善

### executionLog の構造

agenticProcessは各タスクの実行を `context.executionLog` に記録します。詳細は [logging.md](logging.md) を参照してください。

## 今後の拡張可能性

- plannerプロンプトの改善（Original Requestのフォーマット等）
- カスタムタスクタイプの追加
- builtin ツールの活用（`__time`, `__update_task` 等）
- 再計画（`__replan`）の活用
