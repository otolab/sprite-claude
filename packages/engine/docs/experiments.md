# Experiments - プロンプトモジュールの検証と改善

`experiments/` ディレクトリは、プロンプトモジュールの検証、比較、改善を行うためのツール群を提供します。

## 目的

- プロンプトモジュールの品質を向上させる
- 異なるモジュール実装を比較評価する
- MLXモデルでの動作を直接検証する
- プロンプト構造を可視化して確認する

## ディレクトリ構成

```
experiments/
├── module-comparison/    # モジュール比較実験
│   ├── configs/
│   │   ├── experiment.yaml    # モデル・ドライバー設定
│   │   └── experiment.config.ts  # （生成される）モジュール・評価器定義
│   ├── modules/
│   │   ├── original-module.ts    # オリジナルモジュール
│   │   └── merged-module.ts      # マージ版モジュール
│   └── run-experiment.sh      # 実験実行スクリプト
├── completion/           # MLXモデル直接テスト
│   ├── test-completion.ts          # 汎用completionテスト
│   └── test-phase1-multimodel.ts   # 複数モデル比較
└── verify/               # プロンプト構造検証
    ├── verify-prompt.ts            # プロンプト構造検証
    └── verify-2phase-prompt.ts     # 2フェーズプロンプト検証
```

## module-comparison

`@modular-prompt/experiment` フレームワークを使用して、異なるプロンプトモジュールの実装を比較評価します。

### 特徴

- **複数モデル対応**: MLX、VertexAI、GoogleGenAI など
- **自動評価**: 構造化出力の存在確認、LLMベースの要件充足評価
- **カスタマイズ可能**: モジュール、テストケース、評価器を追加可能
- **統計情報**: 複数回実行による統計データの収集

### 設定ファイル

#### experiment.yaml

モデル、ドライバー、テストケース、評価器を定義します。

```yaml
# モデル定義
models:
  gemma-4b-local:
    model: "mlx-community/gemma-3-4b-it-qat-4bit"
    provider: "mlx"
    capabilities: ["local", "fast", "tools"]
    priority: 20
    enabled: true

# ドライバー設定
drivers:
  mlx: {}
  vertexai:
    project: "your-project"
    location: "us-central1"
    credentialsPath: "~/.config/gcloud/application_default_credentials.json"
  googlegenai:
    apiKey: "${GOOGLE_API_KEY}"

# 評価設定
evaluation:
  enabled: true
  model: "gemma-4b-local"

# モジュール定義
modules:
  - name: "original"
    path: "../modules/original-module.ts"
    description: "Original toolGenerationModule"
  - name: "merged"
    path: "../modules/merged-module.ts"
    description: "Merged module variant"

# テストケース
testCases:
  - name: "Simple completion notification"
    description: "User asks to be notified when work is completed"
    analysisResult:
      userIntent: "ユーザーは作業完了時に音声通知を受け取りたい"
      keyFacts:
        - "現在のオペレータ: dia"
        - "作業: ファイルの整理作業"
    relevantContext:
      - role: "user"
        content: "大量のファイルを整理しています。終わったら教えてください。"
    toolDefinition:
      name: "say"
      description: "日本語音声を非同期で出力します"
      input_schema:
        type: "object"
        properties:
          speechText:
            description: "Text to speak (Japanese)"
            type: "string"
        required: ["speechText"]

# 評価器
evaluators:
  - name: "structured-output-presence"  # ビルトイン
  - name: "llm-requirement-fulfillment"  # ビルトイン
```

パスの解決:
- `modules` と `evaluators` のパスは、YAML ファイルからの相対パス
- `credentialsPath` も YAML ファイルからの相対パス（`~/` で home ディレクトリも指定可能）

### 基本的な使い方

```bash
# すべてのモジュール・すべてのモデルで実行
cd packages/engine/experiments/module-comparison
./run-experiment.sh

# 特定のモジュールのみ
./run-experiment.sh --modules original

# 特定のテストケースのみ
./run-experiment.sh --test-case "Simple completion notification"

# 特定のモデルのみ
./run-experiment.sh --model gemma-4b-local

# 複数回実行して統計を取る
./run-experiment.sh --repeat 10
```

### 評価付き実行

```bash
# 評価を有効化
./run-experiment.sh --evaluate

# 特定の評価器のみ
./run-experiment.sh --evaluate --evaluators structured-output-presence

# 組み合わせ
./run-experiment.sh \
  --model gemma-4b-local \
  --modules merged \
  --test-case "Simple completion notification" \
  --repeat 5 \
  --evaluate
```

### カスタムモジュールの追加

1. `modules/` にモジュールファイルを作成:

```typescript
// modules/my-custom-module.ts
import { compile } from '@modular-prompt/core';
import { myPromptModule } from '../../src/prompts/my-module.js';

export default {
  name: 'My Custom Module',
  description: 'Description of my module',
  compile: (context: any) => compile(myPromptModule, context),
};
```

2. `experiment.yaml` に追加:

```yaml
modules:
  - name: "my-custom"
    path: "../modules/my-custom-module.ts"
    description: "My custom module"
```

3. 実行:

```bash
./run-experiment.sh --modules my-custom
```

### カスタム評価器の追加

#### コードベースの評価器

```typescript
// evaluators/my-validator.ts
import type { CodeEvaluator, EvaluationContext, EvaluationResult } from '@modular-prompt/experiment';

export default {
  name: 'My Validator',
  description: 'Validates custom criteria',

  async evaluate(context: EvaluationContext): Promise<EvaluationResult> {
    // 検証ロジック
    return {
      evaluator: 'my-validator',
      moduleName: context.moduleName,
      score: 10,
      reasoning: 'Validation passed',
    };
  },
} satisfies CodeEvaluator;
```

#### プロンプトベースの評価器

```typescript
// evaluators/my-quality-check.ts
import type { PromptEvaluator, EvaluationContext } from '@modular-prompt/experiment';
import type { PromptModule } from '@modular-prompt/core';

const evaluationModule: PromptModule<EvaluationContext> = {
  createContext: (): EvaluationContext => ({
    moduleName: '',
    prompt: '',
    runs: [],
  }),

  objective: [
    '- Assess custom quality criteria',
  ],

  instructions: [
    '- Evaluate based on specific requirements',
  ],
};

export default {
  name: 'Quality Check',
  description: 'Checks custom quality criteria',
  module: evaluationModule,
} satisfies PromptEvaluator;
```

`experiment.yaml` に追加:

```yaml
evaluators:
  - name: "my-quality-check"
    path: "../evaluators/my-quality-check.ts"
```

## completion

MLXモデルで直接プロンプトをテストします。`@modular-prompt/driver` の `MlxProcess` を使用して、生のcompletion APIを呼び出します。

### test-completion.ts

汎用的なcompletionテストツール。任意のモデルとプロンプトファイルでテストできます。

```bash
tsx packages/engine/experiments/completion/test-completion.ts \
  <model> \
  <prompt-file> \
  [maxTokens] \
  [temperature]
```

例:

```bash
# Phase 1プロンプトのテスト
tsx packages/engine/experiments/completion/test-completion.ts \
  mlx-community/gemma-3-4b-it-qat-4bit \
  /tmp/phase1-prompt.txt

# パラメータ指定
tsx packages/engine/experiments/completion/test-completion.ts \
  mlx-community/gemma-3-4b-it-qat-4bit \
  /tmp/phase2-prompt.txt \
  1000 \
  0.1
```

出力:
- モデルのロードと初期化時間
- 生成された出力（完全版）
- 実行時間
- JSON検証結果（JSON が含まれる場合）

### test-phase1-multimodel.ts

Phase 1プロンプトを複数のMLXモデルでテストし、パターン模倣問題がモデル依存かを確認します。

デフォルトでは `/tmp/failed-phase1-prompt.txt` を読み込みます。

```bash
tsx packages/engine/experiments/completion/test-phase1-multimodel.ts
```

テスト対象モデル（スクリプト内で定義）:
- `mlx-community/gemma-3-4b-it-qat-4bit` (4B)
- `mlx-community/gemma-3-12b-it-qat-4bit` (12B)
- その他、コメントアウトで用意

出力:
- 各モデルの実行結果
- JSON検証結果
- サマリーテーブル
- 結論（プロンプト構造の問題 / モデル依存の問題 / 再現性の問題）

## verify

プロンプト構造を検証し、YAMLファイルとして出力します。LLMを呼び出さずにプロンプトの構造だけを確認できます。

### verify-prompt.ts

基本的なプロンプト検証ツール。システムプロンプトとチャットモジュールのマージをテストします。

```bash
tsx packages/engine/experiments/verify/verify-prompt.ts
```

出力ファイル:
- `test-prompt-output.yaml` - メインプロンプト
- `test-prompt-phase1.yaml` - Phase 1（Tool Decision）
- `test-prompt-phase2.yaml` - Phase 2（Tool Call Generation）

### verify-2phase-prompt.ts

2フェーズプロンプトの構造を検証します（RAGワークフロー）。

```bash
tsx packages/engine/experiments/verify/verify-2phase-prompt.ts
```

出力ファイル:
- `test-prompt-analysis.yaml` - Phase 1（分析）
- `test-prompt-tool-gen.yaml` - Phase 2a（ツール生成）
- `test-prompt-response-gen.yaml` - Phase 2b（応答生成）

各YAMLファイルには以下が含まれます:
- `instructions`: システム指示
- `data`: コンテキストデータ
- `output`: 出力フォーマット指定

## トラブルシューティング

### module-comparison

#### モジュールが見つからないエラー

`experiment.yaml` のパスが正しいか確認してください。パスは YAML ファイルからの相対パスです。

- ✅ `../modules/my-module.ts` (正しい)
- ❌ `./modules/my-module.ts` (configs/ 配下を探してしまう)

#### 認証情報エラー

`credentialsPath` が正しいか確認してください:

```yaml
drivers:
  vertexai:
    credentialsPath: ~/.config/gcloud/application_default_credentials.json
```

### completion

#### プロンプトファイルが見つからない

ファイルパスが正しいか確認してください。絶対パスを使用することを推奨します。

#### モデルのロードに失敗

MLXが正しくインストールされているか、モデル名が正しいか確認してください。

## 参考リンク

- [@modular-prompt/experiment](https://github.com/otolab/modular-prompt/tree/main/packages/experiment) - 実験フレームワークのドキュメント
- [@modular-prompt/driver](https://github.com/otolab/modular-prompt) - ドライバーAPI
- [@modular-prompt/core](https://github.com/otolab/modular-prompt) - プロンプトモジュールシステム
