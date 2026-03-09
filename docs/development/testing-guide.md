# テストガイド

## 概要

このドキュメントは**テスト（検証）**のためのガイドです。

**重要な区別**:
- **プロンプトエンジニアリング（開発）**: プロンプトの改善・調整作業 → [prompt-engineering.md](./prompt-engineering.md)
- **テスト（検証）**: コードやシステムの品質を確認する作業 → このドキュメント

プロンプトの改善を行いたい場合は、[prompt-engineering.md](./prompt-engineering.md)を参照してください。

## テストの分類

1. **ユニットテスト**: 個別関数・モジュールのテスト（LLM不要、高速）
2. **統合テスト**: ファイルI/OやLLMを含むテスト
3. **E2Eテスト**: 実際のサーバー起動が必要なテスト

### クイックリファレンス

```bash
# 1. セッションサマリーで全体を確認
./scripts/extract-log.sh --session latest

# 2. 問題のあるリクエストの詳細を確認
./scripts/extract-log.sh "検索文字列"

# 3. プロンプトを抽出してファイル保存
./scripts/extract-log.sh "検索文字列" --prompt > /tmp/prompt.txt

# 4. プロンプトを編集
subl /tmp/prompt.txt

# 5. 直接MLXモデルでテスト
tsx packages/tuning/completion/test-completion.ts \
  mlx-community/Llama-3.2-3B-Instruct-4bit \
  /tmp/prompt.txt
```

## tuningツール群

`packages/tuning/`は**プロンプトエンジニアリング（開発）を支援するためのツール群**です。

- ログ解析
- プロンプトの検証
- 複数モデルでの比較テスト

これらのツールは、プロンプト改善のための高速な検証サイクルを提供します。詳細は[prompt-engineering.md](./prompt-engineering.md)を参照してください。

### analysis/ - ログ解析

#### extract-log.ts

サーバーログからセッション全体または個別リクエストの情報を抽出・表示。

**使い方**:
```bash
# セッション全体のサマリー
./scripts/extract-log.sh --session latest
./scripts/extract-log.sh --session <PID>

# 特定リクエストの詳細
./scripts/extract-log.sh "検索文字列"

# プロンプトのみ表示
./scripts/extract-log.sh "検索文字列" --prompt

# 応答のみ表示
./scripts/extract-log.sh "検索文字列" --output

# メタデータ表示（model, finishReason, usage, toolCalls等）
./scripts/extract-log.sh show --meta
./scripts/extract-log.sh show --meta --output-only

# 構造概要（1リクエスト内の全エントリを概要表示）
./scripts/extract-log.sh inspect                              # 最新リクエスト
./scripts/extract-log.sh inspect "検索文字列"                  # 検索で探す
./scripts/extract-log.sh inspect --session 81403 --seq 0003   # セッション+シーケンス指定

# ファイルに保存
./scripts/extract-log.sh "検索文字列" --save
```

詳細: [logging.md](../architecture/logging.md)

### completion/ - MLX Completionテスト

#### test-completion.ts

任意のMLXモデルと任意のプロンプトファイルでcompletion実行をテスト。

**使い方**:
```bash
tsx packages/tuning/completion/test-completion.ts <model> <prompt-file> [maxTokens] [temperature]

# 例: 3B モデルでプロンプトをテスト
tsx packages/tuning/completion/test-completion.ts \
  mlx-community/Llama-3.2-3B-Instruct-4bit \
  /tmp/phase1-prompt.txt

# 例: カスタムパラメータ
tsx packages/tuning/completion/test-completion.ts \
  mlx-community/Meta-Llama-3.1-8B-Instruct-4bit \
  /tmp/custom-prompt.md 1000 0.1
```

**機能**:
- 任意のモデルとプロンプトファイルを指定可能
- maxTokens（デフォルト: 1000）、temperature（デフォルト: 0.1）のカスタマイズ
- JSON抽出・検証を自動実行
- 実行時間を計測

#### test-phase1-multimodel.ts

複数のモデルで同じPhase1プロンプトをテストし、挙動を比較。

**使い方**:
```bash
tsx packages/tuning/completion/test-phase1-multimodel.ts /tmp/phase1-prompt.txt
```

### verify/ - プロンプト検証

#### verify-prompt.ts

プロンプトモジュールの構造を検証。

```bash
tsx packages/tuning/verify/verify-prompt.ts
```

#### verify-2phase-prompt.ts

2フェーズプロンプトの構造を検証。

```bash
tsx packages/tuning/verify/verify-2phase-prompt.ts
```

## E2Eテスト

実際のサーバーを起動して動作を確認するテスト。

### 基本的なテスト手順

```bash
# 1. サーバー起動
sprite-claude server start

# 2. 簡単なプロンプト実行
sprite-claude --print "Hello"

# 3. ログファイルの確認
ls -lt ~/.sprite-claude/logs/requests/ | head -10

# 4. ログの詳細確認
./scripts/extract-log.sh --session latest
```

### test-tools.ts

ツール呼び出しの基本的な動作をテスト。

```bash
tsx tests/e2e/test-tools.ts
```

**注意**: 単一ターンのみをテストします。実際のツール実行や複数ターンの会話はテストしません。

### test-e2e.ts

一般的なE2Eテスト。

```bash
tsx tests/e2e/test-e2e.ts
```

## ユニットテスト・統合テスト

コード品質を保証するためのテスト。

詳細: [anthropic-server-testing.md](./anthropic-server-testing.md)

### 実行方法

```bash
# すべてのユニットテストを実行
pnpm test -- --run

# ユニットテストのみ
pnpm test:unit -- --run

# 統合テストのみ
pnpm test:integration -- --run

# ウォッチモード
pnpm test
```

## 開発ワークフロー

### プロンプト改善時

```
1. セッションログで問題を特定
   └→ ./scripts/extract-log.sh --session latest

2. 詳細を確認してプロンプトを抽出
   └→ ./scripts/extract-log.sh "メッセージ" --prompt > /tmp/prompt.txt

3. 編集→テストの高速サイクル
   └→ subl /tmp/prompt.txt
   └→ tsx packages/tuning/completion/test-completion.ts <model> /tmp/prompt.txt

4. 効果を確認できたらコードに反映
   └→ 該当プロンプトモジュールを修正
   └→ pnpm build && sprite-claude server restart
```

### コード改善時

```
1. コード修正

2. ユニットテスト
   └→ pnpm test:unit -- --run

3. ビルド
   └→ pnpm build

4. サーバー再起動
   └→ sprite-claude server restart

5. E2Eテスト
   └→ tsx tests/e2e/test-tools.ts

6. ログで確認
   └→ ./scripts/extract-log.sh --session latest
```

## 関連ドキュメント

- [prompt-engineering.md](./prompt-engineering.md) - プロンプト改善の詳細ガイド
- [logging.md](../architecture/logging.md) - ログシステムとextract-log.ts
- [anthropic-server-testing.md](./anthropic-server-testing.md) - ユニット/統合テスト
- [2-phase-tool-approach.md](./2-phase-tool-approach.md) - 2フェーズアプローチの設計思想
