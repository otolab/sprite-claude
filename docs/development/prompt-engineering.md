# プロンプト・エンジニアリング

## 概要

プロンプト・エンジニアリングは、コード改善とは異なる独立したフェーズです。

| フェーズ | 改善対象 | 検証サイクル | 特徴 |
|---------|---------|------------|------|
| **コード改善** | TypeScriptソースコード | ソース編集 → ビルド → サーバー再起動 → 動作確認 | 重い経路、時間がかかる |
| **プロンプト改善** | プロンプトの指示内容 | ログ抽出 → 編集 → 直接実行 → 結果確認 | 軽量、高速な反復が可能 |

**重要な違い**: プロンプト改善では、コードのビルドやサーバーの再起動といった重い経路を通さずに、実際のログから抽出したプロンプトを直接MLXモデルで検証できます。

## 基本ワークフロー

### 1. セッションの特定と確認

まず、改善したい動作が記録されているセッションを特定します。

```bash
# 最新セッションのサマリーを確認
./scripts/extract-log.sh --session latest
```

**出力例**:
```
📊 Session Mode

🔍 Session ID (PID): 1783
📁 Found 40 log files

P1/P2 Format: [Status][Type]  Status: ✓=success ✗=failed -=missing  Type: T=tool_call R=message

==========================================================================
SeqID | Timestamp | P1      | P2      | Tool                          | User Message
==========================================================================
0001 | 06:46:11 | ✓T      | ✓       | mcp__coeiro-operator__say     | こんばんは
0002 | 06:46:30 | ✓R      | ✓       | -                             | ありがとう
0003 | 06:47:05 | ✗       | -       | -                             | 検索してください
```

### 2. 問題のあるリクエストの詳細確認

問題のあるリクエスト（例: SeqID 0003がPhase 1で失敗）を詳しく調べます。

```bash
# 特定メッセージのリクエスト詳細を表示
./scripts/extract-log.sh "検索してください"
```

**出力例**:
```
📝 Request Details

Found in: 2025-11-27T06-47-05-1783-0003.jsonl
User Message: "検索してください"

=== Phase1: Analysis ===
❌ JSON Parse Error
Raw output: "ユーザーが検索を求めています..." (JSONではない)

=== Phase2 ===
(Phase1失敗のため未実行)
```

### 3. プロンプトの抽出

問題のあるフェーズのプロンプトを抽出します。

```bash
# Phase1のプロンプトのみ抽出
./scripts/extract-log.sh "検索してください" --prompt > /tmp/phase1-prompt.txt

# または、特定フェーズのプロンプトを手動抽出
cat ~/.sprite-claude/logs/requests/2025-11-27T06-47-05-1783-0003.jsonl | \
  jq -r 'select(.phase == "phase1-analysis" and .type == "prompt") | .data.content' \
  > /tmp/phase1-prompt.txt
```

### 4. プロンプトの編集と検証

抽出したプロンプトファイルを編集し、即座にMLXモデルで検証します。

```bash
# プロンプトファイルを編集
subl /tmp/phase1-prompt.txt

# 編集したプロンプトをテスト
tsx packages/tuning/completion/test-completion.ts \
  mlx-community/Llama-3.2-3B-Instruct-4bit \
  /tmp/phase1-prompt.txt
```

**反復サイクル:**
```
編集 → 保存 → テスト実行 → 結果確認 → 編集 → ...
```

このサイクルを高速で回すことで、効果的な指示を探索できます。

### 5. 複数モデルでの比較

異なるサイズのモデルで同じプロンプトをテストし、挙動を比較します。

```bash
# 小型モデル（3B）でテスト
tsx packages/tuning/completion/test-completion.ts \
  mlx-community/Llama-3.2-3B-Instruct-4bit \
  /tmp/phase1-prompt.txt

# 中型モデル（7B）でテスト
tsx packages/tuning/completion/test-completion.ts \
  mlx-community/Meta-Llama-3.1-8B-Instruct-4bit \
  /tmp/phase1-prompt.txt
```

## 具体的な改善例

### 例1: Phase1がJSONを出力しない問題

**問題**: Phase1が構造化出力ではなく、自然文を返してしまう

**調査手順**:
```bash
# セッションサマリーで失敗を確認
./scripts/extract-log.sh --session latest
# → SeqID 0003が ✗ になっている

# 詳細を確認
./scripts/extract-log.sh "ユーザーメッセージ"
# → "JSON Parse Error" を確認

# プロンプトを抽出
./scripts/extract-log.sh "ユーザーメッセージ" --prompt > /tmp/phase1-fix.txt
```

**改善案**:
- プロンプト内の指示を強化（例: "You MUST respond with ONLY valid JSON"）
- 出力例を追加
- システムプロンプトの調整

**検証**:
```bash
# 編集したプロンプトをテスト
tsx packages/tuning/completion/test-completion.ts \
  mlx-community/Llama-3.2-3B-Instruct-4bit \
  /tmp/phase1-fix.txt
```

### 例2: ツール判断の精度向上

**問題**: Phase1がツールを使うべき場面で`message`を選択してしまう

**調査手順**:
```bash
# 該当リクエストの分析結果を確認
./scripts/extract-log.sh "ツールを使ってほしいメッセージ"
# → action.type が "message" になっている
# → action.reasoning で判断理由を確認
```

**改善案**:
- Phase1の思考フローを調整
- ツール使用の判断基準を明確化
- 具体例を追加

## 利点

### サーバー再起動不要
- コードをビルドしたり、サーバーを再起動する必要がない
- 実際のログから抽出したプロンプトを直接MLXモデルに渡して検証

### 実際の動作を再現
- `extract-log.ts`で実際に使用されたプロンプトを取得
- 実環境と同じ条件でテスト可能

### 素早いイテレーション
- 編集→テストのサイクルが数秒で完了
- 多くの仮説を短時間で試せる

### デバッグ情報の活用
- Phase1の分析結果（action.reasoning）で判断根拠を確認
- どこで失敗したかがログで明確

## コード改善への反映

プロンプト・エンジニアリングで効果を確認できたら、コードに反映します。

### Phase1 プロンプトの修正

**修正先**: `packages/anthropic-server/src/handlers/messages/decision-based/phase1-analysis.ts`

プロンプトモジュールの`instructions`セクションを更新します。

### Phase2 プロンプトの修正

**修正先**:
- ツール生成: `packages/anthropic-server/src/handlers/messages/decision-based/phase2-tool-generation.ts`
- 応答生成: `packages/anthropic-server/src/handlers/messages/decision-based/phase2-response-generation.ts`

### 反映手順

```bash
# 1. プロンプトモジュールを修正

# 2. ビルド
pnpm build

# 3. サーバー再起動
sprite-claude server restart

# 4. 動作確認
sprite-claude --print "テストメッセージ"

# 5. ログで確認
./scripts/extract-log.sh --session latest
```

## 関連ツール

### extract-log.ts
セッション全体やリクエスト詳細の確認に使用

```bash
# セッションサマリー
./scripts/extract-log.sh --session latest

# リクエスト詳細
./scripts/extract-log.sh "検索文字列"

# プロンプトのみ抽出
./scripts/extract-log.sh "検索文字列" --prompt

# 応答のみ抽出
./scripts/extract-log.sh "検索文字列" --output
```

詳細: [logging.md](../architecture/logging.md)

### test-completion.ts
プロンプトファイルを直接MLXモデルで実行

```bash
tsx packages/tuning/completion/test-completion.ts <model> <prompt-file>
```

詳細: [testing-guide.md](./testing-guide.md)

### verify-2phase-prompt.ts
2フェーズプロンプトの構造検証

```bash
tsx packages/tuning/verify/verify-2phase-prompt.ts
```

## 関連ドキュメント

- [2-phase-tool-approach.md](./2-phase-tool-approach.md) - 2フェーズアプローチの設計思想
- [logging.md](../architecture/logging.md) - ログシステムとextract-log.ts
- [testing-guide.md](./testing-guide.md) - テストツール全般
