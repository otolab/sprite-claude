# Agentic Process 内部処理フロー

## 概要

このドキュメントは、`@modular-prompt/process@0.4.15` の `agenticProcess` の内部処理フローを記録します。今後の修正・リファクタリングの参照資料として使用します。

**バージョン**: `@modular-prompt/process@0.4.15`（2026-04-13時点）

**変更履歴**:
- 0.3.4 → 0.4.14: `ToolSpec[]` → `ToolDefinition[]`（`@modular-prompt/driver`）への変更
- 0.4.14 → 0.4.15: マイナーバグフィックス

sprite-claudeのagenticモードでは、anthropic-serverがClaude Codeからのリクエストを受け取り、PromptModuleを構築してagenticProcessに渡します。agenticProcessはタスクベースのワークフローで、各タスクごとにプロンプトを再構成してLLMに問い合わせます。

## リクエストからPromptModuleへの変換フロー

### 1. HTTPリクエストの受信（anthropic-server）

Claude CodeからのAnthropic Messages API形式のリクエストを受信:

```json
{
  "model": "claude-3-5-sonnet-20241022",
  "system": "You are Claude Code...",
  "messages": [
    {
      "role": "user",
      "content": [
        {
          "type": "text",
          "text": "<system-reminder>...</system-reminder>\n\nユーザーメッセージ"
        }
      ]
    }
  ],
  "tools": [...]
}
```

### 2. handleMessages での変換（`messages/index.ts`）

#### 2.1 systemフィールドの抽出

`request.system` → `extractSystemText()` → `systemPromptText`

#### 2.2 system-reminderの抽出

`request.messages` → `extractSystemReminders()`:
- `<system-reminder>` タグで囲まれたセクション → `systemReminders[]`
- メッセージ本体（system-reminder除去後） → `convertToElements()` へ

#### 2.3 PromptModule構築

anthropic-serverの`messages/index.ts`で構築されるPromptModule:

```typescript
const module: PromptModule = {
  objective: [
    '- Messagesの対話履歴をよく読み、最新のメッセージの続きとなる新しいassistantメッセージを作ります',
    '- 応答メッセージはPersona and Charactorの設定を踏まえて作成してください',
  ],
  persona: [
    'あなたはナースロボ・Type-Tとして振る舞います。...',
    // キャラクター設定
  ],
  instructions: systemPromptText ? [systemPromptText] : [],
  materials: systemReminders.length > 0 ? systemReminders : undefined,
  messages: elements,
};
```

各フィールドの内容:

| フィールド | 内容 |
|-----------|------|
| `objective` | 固定テキスト（対話応答の指示） |
| `persona` | キャラクター設定 |
| `instructions` | `request.system`から抽出したsystemPromptText（Claude CodeのSystemプロンプト） |
| `materials` | userメッセージから抽出した`<system-reminder>`の内容 |
| `messages` | system-reminderを除去した会話履歴（tool_use/tool_result含む） |

## agenticProcess内部の処理フロー

### 1. 初期化（L154-173）

1. **ユーザーモジュールの解決**:
   - `resolve(module, context)` でDynamicContent関数を実行
   - 静的な値に変換された `userModule` を生成

2. **内部コンテキストの構築**:
   ```typescript
   const internalContext = {
     userModule,
     taskList: bootstrap(userModule, enablePlanning),
     executionLog: [],
     currentTaskIndex: 0,
     availableTools: [...builtinTools, ...externalTools],
   };
   ```

3. **初期タスクリストの生成**（`bootstrap`関数）:
   - `enablePlanning=true`: `planning` タスクから開始（taskListは空、plannerが登録する）
   - `enablePlanning=false`: `output` タスクのみ
   - sprite-claudeでは `enablePlanning: true`

### 2. タスクループ（L174-207）

`taskList`を順次実行。各タスクは`executeTask`で処理されます。

**中断条件**:

| 条件 | 動作 |
|-----|------|
| `__replan`ツール呼び出し | 残りタスクをクリア、planningタスク追加（L186-196） |
| 外部ツール呼び出し（pendingToolCalls） | ワークフロー中断（L199-202） |
| outputタスク完了 | ワークフロー終了（L204-206） |

**自動outputタスク追加**（L212-222）:
最後のタスクがoutputでなく、外部ツール呼び出しもない場合、自動でoutputタスクを追加して実行します。

### 3. タスク実行の詳細（executeTask関数、L93-150）

#### 3.1 workflowBaseの構築（L99-104）

**重要な分岐**:

```typescript
const workflowBase = task.taskType === 'output'
  ? { ...userModule }  // output: userModule全体を使用
  : {                   // その他: objective/termsのみ
      objective: userModule.objective,
      terms: userModule.terms,
    };
```

この分岐により、outputタスクでは元のinstructions、materials、messagesが**直接**プロンプトに含まれますが、他のタスクでは含まれません。

#### 3.2 タスクタイプごとのプロンプト再構成

**planningタスク**:
```typescript
const planningMerged = hasExistingDeliverables
  ? merge(workflowBase, taskConfig.module, replanningModule)
  : merge(workflowBase, taskConfig.module);
resolved = resolve(planningMerged, context);
```

- workflowBase = `{ terms: userModule.terms }` のみ
- `taskConfig.module`（planningModule）をmerge
- planningModuleの`materials`セクション（planning.js）で、userModule全体を`distribute()` → `formatCompletionPrompt()`でテキスト化
- "Original Request" というmaterialとして提供
- つまり、元のinstructions、materials、messagesは**資料として**planningドライバーに渡される

**plannerが見るプロンプト構造**:
```
# Instructions（planner自身の指示）
  - You are the planner. Workflow design is your responsibility.
  - Task Type Guide, Planning Theory, Common Patterns 等

# Data
  ## Original Request（分析対象）
    # Instructions        ← ★ 外側と同じヘッダレベル
      request.systemの内容（Claude Codeのシステムプロンプト等）
    # Data
      ## Messages
        ユーザーメッセージ
    # Output

# Output（cue）
  Analyze the prompt and register tasks by calling `__register_task`.
```

**既知の問題**: Original Request内の `# Instructions` と外側のplanner指示 `# Instructions` が同じMarkdownヘッダレベルで衝突する。小規模モデルが混乱する場合がある。

**plannerのタスク登録**:
- `__register_task` builtin ツールを呼び出してタスクを登録
- タスク登録の履歴は `task_registration` ログエントリとして記録される（`extract-log.ts` が抽出）

**outputタスク**:
- workflowBase = userModule全体
- `taskConfig.module`（outputModule）の`instructions`が**追加**される:
  ```
  - Compose the final response using the deliverables from previous Tasks (shown in "Current State").
  - Focus on presenting the results clearly...
  ```
- 元のinstructions、materials、messagesが**直接**プロンプトに含まれる
- taskCommonの`state`セクションから、前タスクのdeliverables（executionLog）が追加される

**実行タスク（act、think、verify等）**:
```typescript
resolved = resolve(merge(workflowBase, taskCommon, taskConfig.module), context);
```

- workflowBase = `{ objective, terms }` のみ
- `taskCommon`が追加される（terms、methodology、state、instructionsセクション）
- `taskConfig.module`が追加される（各タスクタイプ固有のobjective、instructions、Focusサブセクション）
- Focusサブセクション（execution-tasks.js L108-113）に`task.instruction`が動的挿入
- 元のmessages、materials、instructionsは**含まれない**（`withXxx`フラグによる制御）

#### 3.3 withXxxフラグによるデータ制御（execution-tasks.js L115-141）

実行タスクでは、DynamicContent関数で`withXxx`フラグをチェックし、データの可視性を制御します:

```typescript
materials: [
  (ctx) => {
    const task = ctx.taskList?.[ctx.currentTaskIndex ?? 0];
    const withMaterials = task?.withMaterials ?? def.defaults.withMaterials;
    if (!withMaterials || !ctx.userModule?.materials?.length) return null;
    return ctx.userModule.materials;
  },
],
```

同様に`inputs`、`messages`も制御されます。

### 4. タスクタイプとプロンプト構成の一覧

| TaskType | DriverRole | workflowBase | userModuleの利用 | withXxxデフォルト |
|----------|-----------|--------------|------------------|-------------------|
| planning | plan | objective+terms | 全体をmaterial化（"Prompt to analyze"） | inputs:true, messages:false, materials:true |
| think | instruct | objective+terms | なし（withXxxで制御可） | すべてfalse |
| act | instruct | objective+terms | なし（withXxxで制御可） | すべてfalse |
| extractContext | thinking | objective+terms | withXxxで制御（デフォルト全て有効） | すべてtrue |
| recall | instruct | objective+terms | なし（withXxxで制御可） | すべてfalse |
| verify | instruct | objective+terms | なし（withXxxで制御可） | すべてfalse |
| determine | instruct | objective+terms | withXxxで制御（デフォルト全て有効） | inputs:true, messages:true, materials:true |
| output | chat | **userModule全体** | 全体を直接利用 | すべてfalse（不要、全体を直接持つため） |

**各タスクの用途**（execution-tasks.js、planning.js L76-85）:

| TaskType | 用途 |
|----------|------|
| planning | タスク設計：プロンプトを分析し、タスクシーケンスを計画する |
| think | 推論・分析：分析、推論、処理結果を生成 |
| act | ツール実行：外部ツールを使用してアクションを実行し、結果を報告 |
| extractContext | 情報抽出：inputs/messages/materialsから構造化された情報を抽出 |
| recall | 情報検索：検索ツールまたは学習データから関連情報を取得 |
| verify | 検証：前タスクの成果物を検証し、検証レポートを生成 |
| determine | 意思決定：利用可能な情報に基づいて決定的な判断を下す |
| output | 最終出力：前タスクの成果物から最終的なユーザー向け応答を生成 |

### 5. DriverSetとモデルの使い分け（sprite-claude側）

sprite-claudeの`agentic.ts`（L59-65）でのDriverSet設定:

```typescript
const driverSet: DriverSet = {
  default: defaultResolved.driver,
  chat: fastResolved?.driver || defaultResolved.driver,
  plan: reasoningResolved?.driver || defaultResolved.driver,
  instruct: structuredResolved?.driver || defaultResolved.driver,
  thinking: reasoningResolved?.driver || defaultResolved.driver,
};
```

ドライバー解決の設定（L39-44）:

| DriverRole | 解決設定 | 用途 |
|-----------|---------|------|
| default | `[]` + preferLocal | フォールバック |
| chat（→output） | `['chat']` + preferLocal + **preferFast** | 高速応答 |
| plan（→planning） | `['reasoning']` + preferLocal | タスク計画 |
| instruct（→act/think/verify等） | `['structured']` + preferLocal | 構造化実行 |
| thinking（→extractContext） | `['reasoning']` + preferLocal | 推論・抽出 |

## system-reminderの流れ（全体像）

1. **Claude Code** → HTTPリクエスト送信（userメッセージに`<system-reminder>`タグ含む）
2. **anthropic-server** → `extractSystemReminders()`で抽出・除去
3. **PromptModule構築** → `materials`フィールドに配置
4. **agenticProcess投入**
5. **planningタスク** → userModule全体がmaterial化される中に含まれる（"Prompt to analyze"内）
6. **outputタスク** → materialsとして直接LLMに渡される
7. **実行タスク** → withMaterialsフラグ次第（デフォルトはfalse、extractContext/determineはtrue）

## 現状の課題・注意点

### トークン消費
- planningフェーズでuserModule全体をテキスト化するため、大きなsystem-reminderはトークン消費が増大する
- outputタスクではinstructionsが直接含まれるため、Claude CodeのsystemプロンプトがそのままローカルLLMに渡される

### ルーティングリクエスト
- ルーティングリクエスト（system-reminderなし）は別パス（structuredドライバで直接処理）
- `messages/index.ts` L305-344参照

### 再計画（replanning）
- `__replan`ツール呼び出しまたはtrailing tool result（会話履歴の最後がtool roleメッセージ）がある場合、replanningModuleがmergeされる
- replanningModuleは、完了済みタスクとその結果を"Previous Execution"セクションで提供（planning.js L144-160）

## 関連ファイル

### sprite-claude側

| ファイル | 説明 |
|---------|------|
| `packages/anthropic-server/src/messages/index.ts` | PromptModule構築、system-reminder抽出 |
| `packages/engine/src/workflows/agentic.ts` | agenticWorkflow関数、DriverSet設定 |
| `packages/engine/package.json` | `@modular-prompt/process@0.4.15` 依存定義 |

### @modular-prompt/process側

| ファイル | 説明 |
|---------|------|
| `dist/workflows/agentic-workflow/agentic-workflow.js` | メインワークフロー：bootstrap、タスクループ、executeTask |
| `dist/workflows/agentic-workflow/task-types/index.js` | タスクレジストリ、taskCommon、deliverables構築 |
| `dist/workflows/agentic-workflow/task-types/planning.js` | planningModule、replanningModule |
| `dist/workflows/agentic-workflow/task-types/output.js` | outputModule |
| `dist/workflows/agentic-workflow/task-types/execution-tasks.js` | 実行タスクのファクトリとEXECUTION_TASK_DEFS |
| `dist/workflows/agentic-workflow/types.js` | DEFAULT_DRIVER_ROLE、DEFAULT_DATA_OPTIONS |

**重要な変更（@modular-prompt/process 0.4.14）**:
- `AgenticWorkflowOptions.tools` の型が `ToolSpec[]` から `ToolDefinition[]`（`@modular-prompt/driver`）に変更
- sprite-claude側の `agentic.ts` では `toToolSpecs` → `toToolDefinitions` に対応済み

## 関連ドキュメント

- [agentic-workflow.md](agentic-workflow.md) - Agenticワークフローモードの外部インターフェース
- [logging.md](logging.md) - ログシステム（各タスクの実行はログに記録される）
- [layers.md](layers.md) - 層の責任分担（プロセス管理層とサーバーロジック層）
