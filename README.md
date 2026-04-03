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

### 基本設定（単一MLXモデル）

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

より詳細な設定については、[設定ファイル詳細](docs/configuration/index.md)を参照してください。

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

### 通常のClaude Codeの使用

ローカルLLMではなく、通常のClaude APIを使いたい場合は：

```bash
claude
```

`sprite-claude`と`claude`を使い分けることで、クラウド版とローカル版を簡単に切り替えられます。

より詳細なコマンドについては、[コマンドリファレンス](docs/user-guide/commands.md)を参照してください。

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

より詳細なアーキテクチャについては、[アーキテクチャドキュメント](docs/architecture/)を参照してください。

## ドキュメント

このプロジェクトのドキュメントは以下のカテゴリに整理されています。

*   **ユーザー向け**: `README.md` (概要、基本的な使い方)
*   **開発者向け**: [開発者向けドキュメント](docs/development/) (ビルド、テスト、プロンプト・エンジニアリングなど)
*   **アーキテクチャ**: [アーキテクチャドキュメント](docs/architecture/) (層の責任分担、ログシステム、Agenticワークフローなど)
*   **設定詳細**: [設定ファイル詳細](docs/configuration/index.md) (複数モデル設定、モデル選択の仕組みなど)
*   **コマンドリファレンス**: [コマンドリファレンス](docs/user-guide/commands.md) (サーバー管理、設定管理コマンドなど)

## ライセンス

MIT License

## 貢献

Issue・PRを歓迎します。
