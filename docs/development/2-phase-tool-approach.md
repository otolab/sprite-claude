# 2フェーズアプローチの設計思想

## 概要

sprite-claudeでは、LLMを使った処理を**2つのフェーズに分割**するアプローチを採用しています。このドキュメントでは、なぜ分割するのか、どのように分割するのかという設計思想を説明します。

## なぜ2フェーズに分割するのか

### 1. トークン効率の向上

**問題**: 会話履歴が長くなると、全ての処理で全履歴を渡すとトークン消費が膨大になる

**解決**:
- Phase 1で会話履歴全体を分析し、必要な情報を抽出
- Phase 2では抽出された情報のみを使用

### 2. 責任の明確化

**問題**: 「理解」と「生成」を同時に行うと、プロンプトが複雑になり品質が不安定になる

**解決**:
- Phase 1: 理解・分析・判断に特化
- Phase 2: 生成に特化

### 3. デバッグ性の向上

**問題**: 単一フェーズだと、何が原因で失敗したのか分かりにくい

**解決**:
- Phase 1の出力（構造化データ）を確認できる
- どのフェーズで問題が起きたか特定しやすい

### 4. 柔軟性の確保

**問題**: 異なる種類のタスクを単一のプロンプトで処理すると非効率

**解決**:
- Phase 1の判断結果に基づいてPhase 2の処理を切り替え
- 各処理に最適化されたプロンプトを使用

## 分割の方法: コンセプトとパターン

### 基本パターン: RAG的アプローチ

2フェーズアプローチは**RAG (Retrieval-Augmented Generation)** パターンと類似しています:

- **Phase 1 = Retrieval**: 情報の取得・抽出・構造化
- **Phase 2 = Generation**: 抽出された情報を使って生成

従来のRAGが外部ドキュメントから情報を取得するのに対し、このアプローチは**会話履歴や利用可能なツールリストから関連情報を抽出**します。

### モード1: Decision-based (判断ベース)

**コンセプト**: 「ツールを使うべきか、通常応答すべきか」を先に判断

**Phase 1: 分析・判断**
- 入力: 全会話履歴 + 利用可能ツールリスト
- 処理:
  - ユーザー意図の理解
  - 関連情報の抽出
  - アクションタイプの判断 (`tool_call` or `message`)
- 出力: 構造化された分析結果
  ```typescript
  {
    analysis: {
      userIntent: string,
      relevantMessages: number[],
      keyFacts: string[]
    },
    action: {
      type: 'tool_call' | 'message',
      toolName?: string,
      reasoning: string
    }
  }
  ```

**Phase 2: 生成**
- 入力: Phase 1の分析結果 + 関連コンテキストのみ
- 処理パターン:
  - **ツール呼び出しパス** (`action.type === 'tool_call'`)
    - 指定されたツールの定義のみを渡す
    - パラメータを生成
  - **通常応答パス** (`action.type === 'message'`)
    - 抽出された関連情報を使って応答生成

**利点**:
- 早期判断により無駄な処理を削減
- ツール使用時は不要なシステムプロンプトを省略可能
- デバッグ時にPhase 1のログで判断根拠を確認できる

**実装**:
- `src/handlers/messages/decision-based/`
- プロンプトモジュール: Phase 1、Phase 2-tool、Phase 2-response

### モード2: その他のモード（今後拡張予定）

**将来の可能性**:
- **RAG-based**: 外部ドキュメントも検索して情報を補強
- **Multi-step**: Phase 1で複数ステップの計画を立て、Phase 2で順次実行
- **Reflection-based**: Phase 2の結果をPhase 1で評価・改善

## 実装上の共通原則

### 1. Phase 1は必ず構造化出力

Phase 1の出力は常にJSONなどの構造化フォーマットにする。これにより:
- Phase 2への入力が明確
- ログで分析結果を確認可能
- プログラムで判定ロジックを組める

### 2. Phase 2への入力は最小限に

Phase 1で抽出した情報のみをPhase 2に渡す。全会話履歴を渡さない。

### 3. フェーズごとにプロンプトモジュールを分離

各フェーズは独立したプロンプトモジュール(`@modular-prompt/core`)として実装し:
- 個別にテスト可能
- 個別にチューニング可能
- 再利用可能

### 4. ログでフェーズを識別

ログには必ずフェーズ情報を含める:
```typescript
{
  phase: 'phase1-analysis' | 'phase2-tool-generation' | 'phase2-response-generation',
  type: 'prompt' | 'llm_response',
  data: ...
}
```

## 検証とデバッグ

### プロンプト検証

各フェーズのプロンプトは個別に検証できる:

```bash
# Phase 1のプロンプト検証
tsx packages/tuning/verify/verify-2phase-prompt.ts

# 実際のモデルでテスト
tsx packages/tuning/completion/test-completion.ts <model> <prompt-file>
```

### ログ解析

`extract-log.ts`を使ってフェーズごとの動作を確認:

```bash
# セッション全体のサマリー（Phase 1/Phase 2の状態を表示）
./scripts/extract-log.sh --session latest

# 特定リクエストの詳細
./scripts/extract-log.sh "検索メッセージ"
```

詳細: [logging.md](../architecture/logging.md)

## 参考資料

- [prompt-engineering.md](./prompt-engineering.md) - プロンプトのチューニング方法
- [logging.md](../architecture/logging.md) - ログシステムとextract-log.ts
- [testing-guide.md](./testing-guide.md) - テストツールの使い方
