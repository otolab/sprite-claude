# テスト構成

## テストの分類

### ユニットテスト (LLMを使用しない)
高速に実行でき、外部依存がないテスト。

**実行方法:**
```bash
pnpm test:unit -- --run
```

### 統合テスト (LLMを使用する、またはファイルI/Oを含む)
MLX Driverを使用してローカルLLMで実際に推論を行うテスト、またはファイルシステムI/Oを含むテスト。

**実行方法:**
```bash
pnpm test:integration -- --run
```

## テスト実行コマンド

```bash
# すべてのテストを実行 (ユニットテストのみ)
pnpm test -- --run

# ユニットテストのみ実行
pnpm test:unit -- --run

# 統合テストのみ実行 (将来)
pnpm test:integration -- --run

# ウォッチモード
pnpm test

# 特定のテストファイルのみ
pnpm test src/utils/__tests__/prompt.test.ts
```

## テスト作成ガイドライン

### ユニットテストを作成すべき場合
- 純粋関数のテスト
- データ変換・フォーマット処理
- バリデーション・フィルタリングロジック
- PromptModuleの構造確認（compileまで）

### 統合テストを作成すべき場合
- LLMの推論結果が必要なテスト
- ファイルシステムI/O依存のテスト
- サーバー起動が必要なテスト
- エンドツーエンドのフロー確認

## テスト状況

現在のテストカバレッジや具体的な課題については、`tasks/task008.test-status.md` を参照してください。

## 今後の改善

今後のテスト改善項目については `tasks/task007.testing-improvements.md` を参照してください。
