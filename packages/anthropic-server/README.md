# @modular-prompt/anthropic-server

Anthropic Messages API互換サーバー。modular-promptを使用してローカルMLXモデルをAnthropic APIとして公開します。

## 特徴

- Anthropic Messages API (`/v1/messages`) 互換
- modular-promptのMLXドライバーを使用
- Apple Silicon最適化のローカルLLM実行
- シンプルな設定とデプロイ

## インストール

```bash
pnpm install @modular-prompt/anthropic-server
```

## 使い方

### CLIから起動

```bash
# デフォルト設定で起動
anthropic-server

# カスタム設定で起動
anthropic-server --port 3000 --host 0.0.0.0 --model mlx-community/gemma-2-2b-it-4bit
```

### プログラムから使用

```typescript
import { startServer } from '@modular-prompt/anthropic-server';

const server = await startServer({
  port: 3000,
  host: '0.0.0.0',
  model: 'mlx-community/gemma-2-2b-it-4bit',
});
```

### 利用可能なオプション

- `--port, -p`: サーバーポート (デフォルト: 3000)
- `--host, -h`: サーバーホスト (デフォルト: 0.0.0.0)
- `--model, -m`: MLXモデル名 (デフォルト: mlx-community/gemma-2-2b-it-4bit)

## API

### POST /v1/messages

Anthropic Messages APIと互換のエンドポイント。

**リクエスト例:**

```json
{
  "model": "claude-3-5-sonnet-20241022",
  "max_tokens": 1024,
  "messages": [
    {
      "role": "user",
      "content": "Hello, how are you?"
    }
  ]
}
```

**レスポンス例:**

```json
{
  "id": "msg_01XYZ...",
  "type": "message",
  "role": "assistant",
  "content": [
    {
      "type": "text",
      "text": "I'm doing well, thank you for asking!"
    }
  ],
  "model": "claude-3-5-sonnet-20241022",
  "stop_reason": "end_turn",
  "usage": {
    "input_tokens": 10,
    "output_tokens": 15
  }
}
```

## 使用例

### Anthropic SDK (TypeScript)

```typescript
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({
  apiKey: 'dummy-key', // ローカルサーバーではAPIキー不要
  baseURL: 'http://localhost:3000',
});

const message = await anthropic.messages.create({
  model: 'claude-3-5-sonnet-20241022', // 任意のモデル名
  max_tokens: 1024,
  messages: [
    { role: 'user', content: 'こんにちは!' }
  ],
});

console.log(message.content);
```

### curl

```bash
curl http://localhost:3000/v1/messages \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-3-5-sonnet-20241022",
    "max_tokens": 1024,
    "messages": [
      {"role": "user", "content": "こんにちは!"}
    ]
  }'
```

## テスト

```bash
pnpm test
```

## ライセンス

MIT
