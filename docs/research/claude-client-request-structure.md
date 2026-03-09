# Claude Code クライアントのリクエスト構造

## 調査日
2026-02-17

## 概要
Claude Code クライアントから sprite-claude サーバーに送られるリクエストの構造を調査した。
特にシステムプロンプトの扱いについて。

## リクエスト構造

### system フィールド
Claude Code はリクエストの `system` フィールドに配列形式でシステムプロンプトを送信する。

```json
{
  "system": [
    { "type": "text", "text": "You are Claude Code, Anthropic's official CLI for Claude." },
    { "type": "text", "text": "You are an expert at analyzing git history..." }
  ],
  "messages": [
    { "role": "user", "content": [...] }
  ],
  "tools": [...],
  "max_tokens": 21333
}
```

- `system` はオプショナル
- 文字列または `{ type: 'text', text: string }[]` の配列形式
- `messages` 配列内に `role: 'system'` のメッセージは含まれない

### スキーマ定義（schema.ts）

```typescript
system: z.union([
  z.string(),
  z.array(z.object({
    type: z.literal('text'),
    text: z.string(),
    cache_control: CacheControlSchema.optional()
  }))
]).optional(),
```

### system-reminder タグ
- `<system-reminder>` タグは `user` ロールのメッセージ内に含まれる
- `message-converter.ts` の `convertMessages()` で抽出される
- タグの内容は `systemReminders` 配列に格納され、元メッセージからは除去される

## 現在のサーバーの処理

### request.system は無視されている
- `handleMessages()` は `request.system` を一切参照していない
- 代わりに `loadSystemPromptModule()` でローカルファイルからシステムプロンプトを読み込む
- 読み込み優先順位:
  1. `~/.sprite-claude/prompts/system.yaml`
  2. `~/.sprite-claude/prompts/system.md`
  3. `default-system.yaml`（プロジェクトルート）
  4. `src/prompts/default-system.md`

### systemReminders も未使用
- `convertMessages()` の返り値から `systemReminders` を受け取っていない
- デストラクチャリングで無視されている

## 関連ファイル
- `packages/anthropic-server/src/schema.ts` — Zodスキーマ定義
- `packages/anthropic-server/src/messages/index.ts` — リクエスト処理（request.system を無視）
- `packages/anthropic-server/src/messages/system-prompt.ts` — ファイルからシステムプロンプト読み込み
- `packages/anthropic-server/src/messages/message-converter.ts` — system-reminder タグ抽出
