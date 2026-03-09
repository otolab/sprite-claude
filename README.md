# sprite-claude

macOS（Apple Silicon）上でローカルのMLXを用いたLLMを簡単に利用するためのClaude Codeラッパーコマンドです。

## 概要

`sprite-claude`は、Claude APIのリクエストをローカルで動作するMLXベースのLLMにルーティングするためのツールです。`@modular-prompt/anthropic-server`を使用してAnthropic Messages API互換のエンドポイントを提供し、Apple Siliconの性能を最大限に引き出します。

## 必要な環境

- macOS 15.0以上
- Apple Silicon (M1/M2/M3/M4)
- Python 3.11+
- Node.js / pnpm
- uv (Python パッケージマネージャ)

## インストール

### 1. リポジトリのクローン

```bash
git clone https://github.com/otolab/sprite-claude.git
cd sprite-claude
```

### 2. ビルド

```bash
pnpm install
pnpm build
```

### 3. Python環境のセットアップ

```bash
uv sync
```

## 設定ファイル

`~/.sprite-claude/config.yaml`に設定を記述します。初回実行時に自動生成されます。

### 設定例

#### 基本設定（単一MLXモデル）

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

#### 複数モデル設定（MLX + Vertex AI Gemini）

複数のモデルを登録し、リクエストに応じて最適なモデルを動的に選択できます：

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

# プロバイダーごとの認証情報
drivers:
  mlx: {}
  vertexai:
    project: "your-gcp-project-id"
    location: "us-central1"

# モデル選択オプション
selection:
  preferLocal: true  # ローカルモデルを優先
  preferFast: true   # 高速なモデルを優先
  lenient: true      # 条件を満たすモデルがない場合は緩和
  requiredCapabilities: []  # 常に必要な能力

# Anthropic Server設定
server:
  port: 4000
  host: "0.0.0.0"

# ログ設定
logging:
  level: "info"
  request_response_level: "full"

# ランタイム設定
runtime:
  pid_dir: "~/.sprite-claude/run"
  log_dir: "~/.sprite-claude/logs"
```

**Vertex AI認証設定**

Vertex AIを使用する場合は、GCPの認証設定が必要です：

```bash
# gcloud CLIで認証（推奨）
gcloud auth application-default login

# または、サービスアカウントキーを使用
export GOOGLE_APPLICATION_CREDENTIALS="/path/to/service-account-key.json"
```

### 設定項目

#### 基本設定項目

- `mlx.model`: MLXモデルの指定（レガシー形式、単一モデルのみ）
- `server.port`: サーバーポート番号（デフォルト: 4000）
- `server.host`: サーバーホスト（デフォルト: 0.0.0.0）
- `logging.level`: メインログレベル（debug/info/warn/error）
- `logging.request_response_level`: リクエスト/レスポンスログレベル（none/minimal/full）
- `runtime.pid_dir`: PIDファイルディレクトリ
- `runtime.log_dir`: ログファイルディレクトリ

#### 複数モデル設定項目

- `models`: モデル定義の配列
  - `model`: モデル名
  - `provider`: プロバイダー（mlx/vertexai/openai/anthropic/ollama）
  - `capabilities`: モデルの能力タグ（local/fast/japanese/reasoning/tools等）
  - `priority`: 優先度（数値が小さいほど優先）
  - `enabled`: 有効/無効フラグ
- `drivers`: プロバイダーごとの認証情報
  - `mlx`: MLX固有設定
  - `vertexai`: GCPプロジェクトID、リージョン
  - `openai`: APIキー、ベースURL
  - `anthropic`: APIキー、ベースURL
  - `ollama`: ベースURL
- `selection`: モデル選択オプション
  - `preferLocal`: ローカルモデルを優先
  - `preferFast`: 高速なモデルを優先
  - `lenient`: 条件を満たすモデルがない場合は緩和
  - `requiredCapabilities`: 常に必要な能力のリスト

### モデル選択の仕組み

Claude Codeはリクエストに`claude-sonnet-4-20250514`等のモデル名を指定しますが、このサーバーでは**リクエストのモデル名は選択に使用されません**。レスポンスでそのまま返されるだけです。

実際のモデル選択は以下の流れで行われます：

1. **リクエスト内容からcapabilityを判定** — ツール呼び出しがあれば`tools`を要求capabilityに追加
2. **`models`からcapabilityでフィルタリング** — 要求を満たすモデルだけに絞り込み
3. **`selection`の優先順位でソート** — `preferLocal`、`preferFast`、`priority`の順で評価
4. **最上位のモデルを使用**

`lenient: true`の場合、条件を満たすモデルがなければ要求capabilityを段階的に緩和して再選択します。

#### 例：ツールありリクエスト

Claude Codeが`tools`付きリクエストを送信した場合：

- `capabilities`に`tools`を持つモデルのみが候補になる
- MLXモデルが`tools`を持たない場合、Vertex AI等のモデルが自動選択される
- レスポンスの`model`フィールドにはリクエスト時のモデル名（`claude-sonnet-4-20250514`等）がそのまま返る

## 使い方

### 基本的な使い方

最もシンプルな使い方は、引数なしで実行するだけです：

```bash
sprite-claude
```

このコマンド一発で：
1. 設定ファイルがなければ自動生成
2. サーバーが起動していなければ自動起動
3. 環境変数を自動設定してClaude Codeを起動（対話モード）

サーバーはバックグラウンドで常駐するため、Claude Code終了後も起動したままです。

### 引数の引き渡し

`sprite-claude`に渡された引数は、そのまま`claude`コマンドに渡されます：

```bash
# 非対話モード（--print）でプロンプトを実行
sprite-claude --print "Hello, how are you?"

# ファイル検索のテスト
sprite-claude --print "List all TypeScript files in src/"

# 会話を継続
sprite-claude --continue

# その他のclaudeコマンドのオプションもそのまま使用可能
sprite-claude --system-prompt "You are a helpful assistant" --print "Explain MLX"
```

**注意**: `server`, `init`, `config`で始まる引数のみ、sprite-claudeのコマンドとして解釈されます。それ以外の引数はすべて`claude`コマンドに渡されます。

### サーバー管理

通常は必要ありませんが、サーバーを個別に操作することも可能です：

```bash
# サーバーの起動（Claude Codeは起動しない）
sprite-claude server start

# サーバーの停止
sprite-claude server stop

# 状態確認
sprite-claude server status

# サーバーの再起動
sprite-claude server restart
```

### 設定管理

```bash
# 設定ファイルの初期化（再生成）
sprite-claude init

# 設定ファイルの編集
sprite-claude config edit
```

### 通常のClaude Codeの使用

ローカルLLMではなく、通常のClaude APIを使いたい場合は：

```bash
claude
```

`sprite-claude`と`claude`を使い分けることで、クラウド版とローカル版を簡単に切り替えられます。

## アーキテクチャ

```
[Claude Code クライアント]
    ↓ ANTHROPIC_BASE_URL=http://localhost:4000
[@modular-prompt/anthropic-server] (ポート4000)
    - Anthropic Messages API互換
    - 内部でMLXDriverを直接使用
    - Fastifyベース、TypeScript実装
    ↓
[MLX ローカルLLM] (Apple Silicon最適化)
```

### コンポーネント

**@modular-prompt/anthropic-server**
- Anthropic Messages API互換のサーバー実装
- MLXDriverを直接使用
- FastifyベースのTypeScript実装
- Zodによるスキーマバリデーション
- modular-promptのPromptModule構造を使用

## ログファイル

リクエスト/レスポンスログは以下の場所に保存されます：

```
~/.sprite-claude/logs/requests/{timestamp}-{pid}-{seqId}.jsonl
```

- PIDを含むため、プロセスごとにログを区別可能
- 各リクエストはJSONL形式で記録
- プロンプトとレスポンスの詳細を確認可能

ログの詳細については `docs/architecture/logging.md` を参照してください。

## 開発

### ビルド

```bash
# 全パッケージのビルド
pnpm build

# 強制ビルド（キャッシュ無視）
pnpm build:force
```

詳細: [docs/development/build-guide.md](docs/development/build-guide.md)

### テスト

```bash
# E2Eテスト
tsx tests/e2e/test-tools.ts

# MLX Completionテスト
tsx packages/tuning/completion/test-completion.ts <model> <prompt-file>

# ログ解析
./scripts/extract-log.sh --session latest
```

詳細: [docs/development/testing-guide.md](docs/development/testing-guide.md)

### プロンプト・エンジニアリング

プロンプトの改善は、コード改善とは異なる独立したフェーズです。

**特徴:**
- コードのビルドやサーバー再起動を経由しない軽量・高速な検証サイクル
- プロンプトファイルを直接MLXモデルで実行してテスト
- 編集→テストの反復を高速化し、効果的な指示を探索

詳細: [docs/development/prompt-engineering.md](docs/development/prompt-engineering.md)

## ドキュメント

- [AGENTS.md](AGENTS.md) - エージェント向け詳細情報（開発者向けインデックス）
- [docs/development/](docs/development/) - 開発者向けドキュメント
- [docs/architecture/](docs/architecture/) - アーキテクチャドキュメント

## ライセンス

MIT License

## 貢献

Issue・PRを歓迎します。
