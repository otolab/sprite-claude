# ビルドガイド

## 開発環境のセットアップ

```bash
# pnpmのインストール（未インストールの場合）
npm install -g pnpm

# 依存関係のインストール
pnpm install

# TypeScriptのビルド
pnpm build
```

## ビルドコマンド

プロジェクトは**pnpm workspaces + TypeScript Project References**を使用しています。

```bash
# 全パッケージのビルド
pnpm build

# 強制ビルド（キャッシュを無視して確実にビルド）
pnpm build:force

# クリーンビルド（キャッシュをクリアして再ビルド）
pnpm clean && pnpm build

# 特定パッケージのみビルド
pnpm --filter @modular-prompt/anthropic-server build

# 開発モード（ホットリロード）
pnpm dev
```

## ビルドキャッシュについて

TypeScriptは**incremental compilation**を使用しており、`.tsbuildinfo`ファイルにビルドキャッシュを保存します。

**推奨**: スキーマ定義（`schema.ts`）や重要な型定義を変更した場合は、`pnpm build:force`を使用してください。

**キャッシュが原因で変更が反映されない場合：**

```bash
# 方法1: 強制ビルド（最も確実）
pnpm build:force

# 方法2: cleanコマンドでキャッシュをクリア
pnpm clean && pnpm build

# 方法3: distディレクトリと.tsbuildinfoを手動削除
rm -rf packages/anthropic-server/dist
rm -rf packages/anthropic-server/*.tsbuildinfo
pnpm build
```
