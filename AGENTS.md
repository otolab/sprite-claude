# AGENTS.md - sprite-claude プロジェクト（エージェント向け情報）

## 重要: このプロジェクトについて

**あなた（AI アシスタント）は、このプロジェクトのユーザーではありません。**

- **あなた**: Anthropic のクラウド上で動作する Claude（開発支援を行っている）
- **このプロジェクト**: ローカル LLM を使う**別の Claude Code プロセス**のためのサーバー
- **調査対象**: あなたとは**完全に別個のシステム**の動作

このプロジェクトで開発しているサーバーは、あなた自身には使われていません。
あなたが調査しているのは、**別のプロセスで動作する Claude Code** の問題です。

## プロジェクト概要

`sprite-claude`は、macOS（Apple Silicon）上でローカルのMLXを用いたLLMを簡単に利用するためのClaude Codeのラッパーコマンドです。

## アーキテクチャ

### シンプルな2層構造

```
[Claudeクライアント]
    ↓ ANTHROPIC_BASE_URL=http://localhost:4000
[@modular-prompt/anthropic-server] (ポート4000)
    - Anthropic Messages API互換
    - 内部でMLXDriverを直接使用
```

### 各コンポーネントの役割

#### 1. プロセス管理層: sprite-claudeコマンド（Python）

**責任**: プロセスのライフサイクル管理

- **Claude Codeプロセスの管理** - 環境変数を設定して起動
- **anthropic-serverプロセスの起動・停止** - 必要に応じて起動
- **状態確認** - プロセスの起動状態を監視
- 設定ファイルからプロセス起動に必要な最小限の情報のみ読む（ポート番号等）

**重要**: サーバーロジック（モデル定義、認証情報等）には関与しない

#### 2. サーバーロジック層: @modular-prompt/anthropic-server（TypeScript）

**責任**: APIサーバーとしての全ての機能

- **Anthropic Messages API互換のサーバー** - `/v1/messages` エンドポイント提供
- **設定管理** - `config.yaml`を読み込み、全ての設定を処理
  - モデル定義（models）
  - ドライバー設定（drivers）
  - 認証情報（credentialsPath等）
  - モデル選択ロジック（selection）
- **LLM実行** - modular-promptのDriverを使用してLLMを実行
- **Apple Silicon最適化** - MLXを使用したローカルLLM実行

**重要**: プロセス管理には関与しない、サーバーロジックに専念

## ディレクトリ構造

```
sprite-claude/
├── README.md                  # 人間向け基本的な使い方
├── CLAUDE.md                 # AGENTS.md への参照のみ
├── AGENTS.md                 # このファイル（エージェント向けインデックス）
├── docs/                     # ドキュメント（整理済み）
│   ├── development/          # 開発者向けドキュメント
│   │   ├── build-guide.md    # ビルド手順とキャッシュ管理
│   │   ├── testing-guide.md  # テストツールの使い方
│   │   ├── prompt-engineering.md # プロンプト・エンジニアリング
│   │   ├── 2-phase-tool-approach.md # 2フェーズアプローチ設計
│   │   └── anthropic-server-testing.md # ユニットテスト・統合テスト
│   └── architecture/         # アーキテクチャドキュメント
│       └── logging.md        # ログシステムとextract-log.ts
├── tasks/                    # 作業メモ・計画
├── src/                      # Pythonソースコード
│   └── sprite_claude/
│       ├── cli.py           # CLIエントリーポイント
│       ├── config.py        # 設定ファイル管理
│       └── server.py        # サーバープロセス管理
├── scripts/                  # スクリプト
│   ├── sprite-claude.sh    # メインラッパースクリプト
│   └── extract-log.sh       # ログ解析ツール
├── packages/                 # Node.jsパッケージ
│   ├── anthropic-server/    # @modular-prompt/anthropic-server
│   │   ├── src/
│   │   │   ├── server/      # Fastifyサーバー実装
│   │   │   ├── messages/    # メッセージ処理
│   │   │   ├── prompts/     # プロンプトモジュール
│   │   │   ├── handlers/    # リクエストハンドラ
│   │   │   ├── types/       # 型定義
│   │   │   ├── cli.ts       # CLIエントリーポイント
│   │   │   └── schema.ts    # Zodスキーマ定義
│   │   └── dist/            # ビルド済みファイル
│   └── tuning/              # MLXモデルのチューニング/評価ツール
│       ├── analysis/        # ログ解析
│       │   └── extract-log.ts
│       ├── completion/      # Completionテスト
│       │   ├── test-completion.ts         # 汎用completionテスト
│       │   └── test-phase1-multimodel.ts  # 複数モデル比較テスト
│       └── verify/          # プロンプト検証
│           ├── verify-prompt.ts           # プロンプト構造検証
│           └── verify-2phase-prompt.ts    # 2フェーズプロンプト検証
├── tests/                    # E2Eテスト
│   └── e2e/
│       ├── test-tools.ts     # ツール呼び出しテスト
│       └── test-e2e.ts       # 一般的なE2Eテスト
└── pyproject.toml           # Python依存関係
```

## ドキュメント体系

ドキュメントは`docs/`以下に目的別に整理されています:

### ユーザー向け
- **[README.md](README.md)** - 基本的な使い方、コマンド仕様、設定ファイル

### 開発者向け (`docs/development/`)
- **[build-guide.md](docs/development/build-guide.md)** - ビルド手順とキャッシュ管理
- **[testing-guide.md](docs/development/testing-guide.md)** - テストツールの使い方
- **[prompt-engineering.md](docs/development/prompt-engineering.md)** - プロンプト・エンジニアリング（軽量・高速な検証サイクル）
- **[2-phase-tool-approach.md](docs/development/2-phase-tool-approach.md)** - 2フェーズアプローチ設計
- **[anthropic-server-testing.md](docs/development/anthropic-server-testing.md)** - ユニットテスト・統合テスト

### アーキテクチャ (`docs/architecture/`)
- **[layers.md](docs/architecture/layers.md)** - 層の責任分担（プロセス管理層とサーバーロジック層）
- **[logging.md](docs/architecture/logging.md)** - ログシステムとextract-log.ts
- **[agentic-workflow.md](docs/architecture/agentic-workflow.md)** - Agenticワークフローモードの概要と外部インターフェース
- **[agentic-process-flow.md](docs/architecture/agentic-process-flow.md)** - agenticProcessの内部処理フロー（@modular-prompt/process 0.3.4）

## クイックリファレンス

### ビルド

```bash
pnpm build              # 全パッケージのビルド
pnpm build:force        # 強制ビルド（キャッシュ無視）
```

詳細: [docs/development/build-guide.md](docs/development/build-guide.md)

### コマンド

```bash
sprite-claude         # サーバー起動 + Claude Code起動
sprite-claude server start    # サーバーのみ起動
sprite-claude --print "..."   # 非対話モード
```

詳細: [README.md](README.md)

### テスト

```bash
# MLX Completionテスト
tsx packages/tuning/completion/test-completion.ts <model> <prompt-file>

# E2Eテスト
tsx tests/e2e/test-tools.ts

# ログ解析
./scripts/extract-log.sh --session latest
```

詳細: [docs/development/testing-guide.md](docs/development/testing-guide.md)

## 参考リンク

- [modular-prompt](https://github.com/otolab/moduler-prompt)
- [MLX](https://github.com/ml-explore/mlx)
