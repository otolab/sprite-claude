# 設定ファイル詳細

`sprite-claude`の設定は `~/.sprite-claude/config.yaml` ファイルで行います。初回実行時に自動生成されますが、必要に応じて編集・カスタマイズできます。

## 基本設定（単一MLXモデル）

最もシンプルな設定例です。

```yaml
# MLXモデル設定
mlx:
  model: "mlx-community/Llama-3.2-3B-Instruct-4bit"

# Anthropic Server設定
server:
  port: 4000
  host: "0.0.0.0"

# ログ設定
logging:
  level: "info"  # debug, info, warn, error
  request_response_level: "full"  # none, minimal, full

# ランタイム設定
runtime:
  pid_dir: "~/.sprite-claude/run"
  log_dir: "~/.sprite-claude/logs"
```

## 複数モデル設定

複数のモデルを登録し、リクエストに応じて最適なモデルを動的に選択できます。

### モデル定義 (`models`)

```yaml
# 複数モデルの定義
models:
  - model: "mlx-community/Llama-3.2-3B-Instruct-4bit"
    provider: "mlx"
    capabilities: ["local", "fast"]
    priority: 10
    enabled: true

  - model: "gemini-2.0-flash-001"
    provider: "vertexai"
    capabilities: ["fast", "japanese", "reasoning"]
    priority: 20
    enabled: true
```

*   `model`: モデル名
*   `provider`: モデルの提供元 (`mlx`, `vertexai`, `openai`, `anthropic`, `ollama`など)
*   `capabilities`: モデルの能力を示すタグ (例: `local`, `fast`, `japanese`, `reasoning`, `tools`)
*   `priority`: モデル選択時の優先度 (数値が小さいほど優先度が高い)
*   `enabled`: モデルを有効にするか無効にするか (`true`/`false`)

### プロバイダーごとの認証情報 (`drivers`)

各モデルプロバイダーに必要な認証情報や設定を指定します。

*   `mlx`: MLX固有の設定 (例: `{}`)
*   `vertexai`: GCPプロジェクトID、リージョンなど
    ```yaml
    vertexai:
      project: "your-gcp-project-id"
      location: "us-central1"
    ```
*   `openai`: APIキー、ベースURLなど
*   `anthropic`: APIキー、ベースURLなど
*   `ollama`: ベースURLなど

**Vertex AI認証設定**:
Vertex AIを使用する場合は、GCPの認証設定が必要です。

```bash
# gcloud CLIで認証（推奨）
gcloud auth application-default login

# または、サービスアカウントキーを使用
export GOOGLE_APPLICATION_CREDENTIALS="/path/to/service-account-key.json"
```

### モデル選択オプション (`selection`)

モデルの選択方法に関するオプションを指定します。

*   `preferLocal`: ローカルモデルを優先して選択します。
*   `preferFast`: 高速なモデルを優先して選択します。
*   `lenient`: 指定した条件を満たすモデルがない場合に、要求を緩和してモデルを選択します。
*   `requiredCapabilities`: 常に必要とされるモデルの能力を指定します。

### プロンプトカスタマイズ設定 (`prompts`)

カスタムプロンプトモジュールを読み込むための設定です。

*   `prompts`: プロンプトモジュールのパスまたはインライン定義の配列。
    *   文字列要素: YAMLファイルパス (例: `"prompts/base.yaml"`)。パスは`~/.sprite-claude/`からの相対パスです。
    *   オブジェクト要素: インラインでのPromptModule定義。

**PromptModuleの構造:**
*   `objective`: 目的・役割の定義
*   `persona`: ペルソナの定義
*   `instructions`: 指示・制約
*   `materials`: 参考資料
*   `terms`: 用語定義

詳細は [otolab/modular-prompt](https://github.com/otolab/modular-prompt) を参照してください。

**設定例:**
```yaml
prompts:
  - "prompts/base.yaml"
  - objective:
      - "You are a helpful AI assistant"
    instructions:
      - "Respond in Japanese"
      - "Be concise and clear"
```

### モデル選択の仕組み

リクエストされたモデル名に基づいて、最適なワークフローとモデルが選択されます。

#### ワークフロー選択の流れ

1.  **リクエスト種別の判定**: `system-reminder`の有無で通常リクエストとルーティングリクエストを判別します。
2.  **ワークフローの決定**:
    *   ルーティングリクエストの場合: `routingWorkflow`で指定されたワークフローを使用します。
    *   通常リクエストの場合: `modelMapping`で`request.model`をワークフロー名にマッピングします（見つからなければ`default`ワークフロー）。
3.  **ワークフロー定義からモデル解決**:
    *   `workflows[name].mode`: 実行モード (`agentic`/`passthrough`) を指定します。
    *   `workflows[name].models`: 役割ごとのモデル指定を行います。
        *   文字列: モデル名を直接指定します (例: `"gemini-2.5-flash"`)。
        *   配列: `capabilities`配列でモデルを選択します (例: `[fast, japanese]`)。

#### 設定例

```yaml
# ワークフロー定義
workflows:
  default:
    mode: agentic
    models:
      default: "gemini-2.5-flash"    # モデル名で指定
      chat: [fast, japanese]          # capabilities配列で指定
  routing:
    mode: passthrough
    models:
      default: [structured]

# request.model → ワークフロー名のマッピング
modelMapping:
  claude-3-5-sonnet-20241022: default

# ルーティングリクエスト用ワークフロー
routingWorkflow: routing
```

#### モデル解決の詳細

各役割に指定されたモデルは、以下の手順で解決されます。

*   **文字列の場合**: `models`配列から同じ名前のモデルを検索します。
*   **配列の場合**: `AIService.selectModels()`で`capabilities`を満たすモデルを選択します。`selection`設定（`preferLocal`, `preferFast`, `priority`）に従ってソートされ、`lenient: true`の場合は要求を段階的に緩和してモデルを探します。

モデルが見つからない場合は、`default`役割のモデルがフォールバックとして使用されます。
レスポンスの`model`フィールドには、リクエスト時のモデル名（`claude-sonnet-4-20250514`等）がそのまま返されます。

## サーバー設定

*   `server.port`: サーバーポート番号（デフォルト: 4000）
*   `server.host`: サーバーホスト（デフォルト: 0.0.0.0）

## ログ設定

*   `logging.level`: メインログレベル (`debug`, `info`, `warn`, `error`)
*   `logging.request_response_level`: リクエスト/レスポンスログレベル (`none`, `minimal`, `full`)

## ランタイム設定

*   `runtime.pid_dir`: PIDファイルディレクトリ
*   `runtime.log_dir`: ログファイルディレクトリ

## その他の設定項目

*   `mlx.model`: MLXモデルの指定（レガシー形式、単一モデルのみ）
*   `models`: モデル定義の配列 (上記「複数モデル設定」参照)
*   `drivers`: プロバイダーごとの認証情報 (上記「Vertex AI認証設定」参照)
*   `selection`: モデル選択オプション (上記「モデル選択オプション」参照)
*   `prompts`: プロンプトモジュールの配列 (上記「プロンプトカスタマイズ設定」参照)
