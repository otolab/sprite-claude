# sprite-claude アーキテクチャ決定記録 (ADR)

## 概要

このファイルは sprite-claude プロジェクトにおける主要なアーキテクチャ決定を時系列でまとめた記録（Architecture Decision Records）です。各決定の背景、検討内容、最終的な選択とその理由を簡潔に記載しています。

---

## ADR-001: プロジェクト基本方針の確立
**日付**: 2024年初期
**関連**: task001.project-plan.v1.md

### 決定事項
- macOS (Apple Silicon) 上でローカルLLM (MLX) を使用するClaude Codeラッパーコマンドを作成
- 当初は3層構造（Claude Client → LiteLLM Proxy → MLX Server）を採用
- 設定ファイルは `~/.sprite-claude/config.yaml` で管理
- システムプロンプトは外部ファイル参照とインライン記述の両対応

### 背景
ローカル環境でMLXベースのLLMを使いつつ、Claude Codeのインターフェースを活用したいという要求。

### 影響
プロジェクトの基本構造が定まり、LiteLLMをプロトコル翻訳層として採用する方向性が確立された。

---

## ADR-002: 実装計画の詳細化
**日付**: 2024年初期
**関連**: task002.implementation-plan.v1.md

### 決定事項
- モジュール構成を5つに分割（config.py, mlx_server.py, litellm_server.py, server_manager.py, cli.py）
- テスト駆動開発（TDD）を採用、pytestを使用
- PIDファイルとログファイルで状態管理
- 起動順序は MLX → ヘルスチェック → LiteLLM設定生成 → LiteLLM起動

### 背景
複雑なプロセス管理と設定管理を整理し、保守性を確保する必要があった。

### 影響
モジュール分割により責任範囲が明確化され、テスト可能な設計となった。

---

## ADR-003: アーキテクチャの根本的見直し - DRY原則の適用
**日付**: 2024年初期
**関連**: task003.architecture-reconsideration.v1.md

### 決定事項
- **重大な方針転換**: LiteLLMの機能を最大限活用し、sprite-claudeの責務を最小化
- プロトコル変換、ルーティング、リトライ/フォールバックはLiteLLMに任せる
- sprite-claudeは「設定ファイル変換」と「プロセス管理」のみに専念
- システムプロンプトはLiteLLMのconfig.yamlで設定可能と判明

### 背景
LiteLLM調査の結果、当初計画していた多くの機能がLiteLLMネイティブで実現可能と判明。重複実装を避けるべきと判断。

### 影響
- モジュール数を5つから3つ（config.py, server.py, cli.py）へ大幅削減
- 実装の複雑さが大きく低減
- コード量が当初予定の1000行から300-400行へ削減見込み

---

## ADR-004: LiteLLMネイティブ機能の最大活用
**日付**: 2024年初期
**関連**: task004.final-architecture.v1.md

### 決定事項
- LiteLLMの `.prompt` ファイル機能を活用
- ユーザーはMarkdown (`.md`) でプロンプトを記述
- sprite-claudeがMarkdownを `.prompt` ファイルに変換
- LiteLLMの `global_prompt_directory` 機能で自動読み込み

### 背景
LiteLLMにネイティブなプロンプト管理機能（`.prompt`ファイル）が存在することを発見。

### 影響
- システムプロンプト管理がLiteLLMネイティブに
- プロンプトの動的切り替えがLiteLLM側で実現可能
- sprite-claudeの責務がさらに明確化

---

## ADR-005: コマンドフローの簡素化
**日付**: 2024年初期
**関連**: task005.simplified-command-flow.v1.md, task005.simplified-command-flow.v2.md

### 決定事項
- デフォルト動作: 引数なし実行で自動的にサーバー起動 + Claude Code起動
- 設定ファイルパスを `~/.sprite-claude/config.yaml` に変更（ディレクトリベース）
- サブコマンド形式に変更（`server start`, `server stop`, `config edit` など）
- サーバーはバックグラウンドで常駐（Claude Code終了後も継続）

### 背景
ユーザーエクスペリエンスの改善。毎回手動でサーバー起動・環境変数設定を行うのは煩雑。

### 影響
- `sprite-claude` 一発でClaude Codeが起動可能に
- 初回実行時に自動で設定ファイルを生成
- ユーザビリティが大幅に向上

---

## ADR-006: ドキュメント構造の整理
**日付**: 2024年後期
**関連**: task006.documentation-cleanup.md

### 決定事項
- `docs/archive/` を完全削除（調査ログは不要）
- `docs/user/` の内容をREADME.mdに統合
- `docs/architecture/` の不要ファイル削除
- E2Eテストを `tests/e2e/` へ移動
- プロンプトエンジニアリングガイドを全面書き換え

### 背景
開発が進むにつれドキュメントが散逸し、古い情報と新しい情報が混在していた。

### 影響
- ドキュメント構造が明確化
- 最新情報へのアクセスが容易に

---

## ADR-007: テスト改善計画
**日付**: 2024年後期
**関連**: task007.testing-improvements.md, task008.test-status.md

### 決定事項
- 統合テストのHOMEディレクトリモック問題を修正予定
- MLX Driverを使った実際の統合テスト追加を計画
- CI/CD環境でのテスト自動実行を将来実装

### 背景
テストカバレッジは32テストパス、5テスト失敗の状況。統合テストの環境問題が残存。

### 影響
テスト品質向上の道筋が明確化。

---

## ADR-008: handlersディレクトリのリファクタリング計画
**日付**: 2024年後期
**関連**: task009.handlers-refactoring.md

### 決定事項
- `decision-based.ts` (427行) を個別モジュールに分割予定
- `tool-processing/` ディレクトリ配下に機能別モジュールを配置
- 単一責任の原則に基づく設計に移行

### 背景
単一ファイルが427行と大きくなり、保守性が低下。

### 影響
保守性・再利用性・テスタビリティの向上が期待される。

---

## ADR-009: アーキテクチャの根本的転換 - LiteLLM削除とAnthropic互換サーバー実装
**日付**: 2024年中期（推定）
**関連**: AGENTS.md の現在のアーキテクチャ記述

### 決定事項
- **LiteLLM Proxyを完全に削除**し、2層構造に移行
- TypeScript製の `@modular-prompt/anthropic-server` を新規開発
- Anthropic Messages API (`/v1/messages`) 互換のサーバーを実装
- `modular-prompt` の `MLXDriver` を直接使用
- Fastifyをサーバーフレームワークとして採用
- ポート4000で直接リクエストを受付

### 背景
LiteLLMを経由する3層構造では以下の問題があった：
- プロトコル変換の複雑さ
- デバッグの困難さ
- LiteLLMの設定管理の複雑さ
- 不要な中間層によるオーバーヘッド

### 影響
- **最も重大な変更**: プロジェクト全体のアーキテクチャが根本から変更
- ADR-003, ADR-004 で決定したLiteLLM活用方針を撤回
- TypeScript実装により型安全性が向上
- modular-prompt エコシステムとの統合が強化
- デバッグとログ管理が大幅に簡素化
- システムプロンプト管理は独自実装に（YAML設定 + 外部ファイル参照）

---

## ADR-010: Vertex AI Gemini対応
**日付**: 2024年12月
**関連**: task010.vertexai-support.v1.md

### 決定事項
- 複数モデル（MLX、Vertex AI Gemini）をサポート
- `AIService` を使用して、リクエストに応じて最適なモデルを動的に選択
- 設定ファイルで複数モデルを定義（`models` 配列）
- プロバイダー認証情報を `drivers` セクションで管理
- 選択オプション（`preferLocal`, `requiredCapabilities` など）をサポート

### 背景
MLXのみでは機能制約があり、ツール呼び出しなど一部機能でクラウドLLMが必要。

### 影響
- 設定ファイル構造が拡張
- TypeScript型定義に `AnthropicServerOptions` 拡張
- Python側も複数モデル設定に対応
- 柔軟なモデル選択が可能に

---

## ADR-011: AIServiceによるモデル選択と動作確認
**日付**: 2024年12月
**関連**: task011.aiservice-model-selection.v1.md

### 決定事項
- `AIService` によるモデル選択機能を実装完了
- `requiredCapabilities` に基づく適切なドライバー選択を実装
- MLXに依存しない Vertex AI 単独動作を確認
- 統合テストで動作確認完了

### 背景
task010で計画した機能の実装と動作確認。

### 影響
- 複数モデル間の自動選択が実現
- ツール機能が必要な場合はVertex AIを自動選択
- ローカル優先設定も機能

---

## ADR-012: サーバーログとバリデーションエラー調査
**日付**: 2025年11月
**関連**: investigation-20251125-133010.md

### 決定事項
- リクエスト/レスポンスログを個別JSONファイルとして保存
- `messages[N].content` のバリデーションエラーを記録・分析
- PIDを含むファイル名でプロセスごとに区別

### 背景
Claude Codeからのリクエストでバリデーションエラーが発生。原因調査のためログ構造を調査。

### 影響
エラーパターンの可視化により、スキーマ定義と実リクエストの不一致を特定可能に。

---

## ADR-013: Capability設計の見直し検討
**日付**: 2025年後期（推定）
**関連**: capability-design-issue.md

### 決定事項
- 2つの異なる `MlxCapabilities` 型が存在することを確認
  - `process/types.ts`: MLX Pythonからの生情報
  - `model-spec/types.ts`: Driver内部用の簡略版
- 型名の整理は後回し、まず「使う側として必要な情報」を明確にする方針

### 背景
capability公開機能の実装検討中に設計の疑問点を発見。情報の出所と目的が異なるのに同じ名前で扱おうとしていた。

### 影響
設計の問題点を文書化。将来的なリファクタリングの指針となる。

---

## ADR-014: passthrough モードでrequest.systemを使用
**日付**: 2025年2月（推定）
**関連**: passthrough-system-prompt.md

### 決定事項
- passthrough モード時に `request.system` フィールドをシステムプロンプトとして使用
- `extractSystemText()` 関数で `request.system` からテキストを抽出
- `AnthropicServerOptions` に `workflow.mode` 設定を追加
- config.yaml で `workflow: { mode: passthrough }` を指定可能に

### 背景
passthrough モードで Claude Code クライアントから送信される `request.system` が無視されていた。

### 影響
- ワークフローモード設定が config.yaml で管理可能に
- Claude Codeのシステムプロンプトをそのまま使用可能
- engine 側の変更は不要

---

## 参考情報

- プロジェクトリポジトリ: https://github.com/otolab/sprite-claude
- modular-prompt: https://github.com/otolab/moduler-prompt
- MLX: https://github.com/ml-explore/mlx
