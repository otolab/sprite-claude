# ログ分析スキル

## ログとは何か

sprite-claude のリクエストログは、Claude Code クライアントとサーバー間の1リクエスト-レスポンスを記録した JSONL ファイル。
サーバー内部で何が起きたか（どのドライバでどんなプロンプトを送り、何が返ってきたか）を事後的に追える。

ログの場所: `~/.sprite-claude/logs/requests/`

## 分析の考え方

ログ分析は「地図を読む」作業。答えを探すのではなく、生ログのどこを見ればいいかを特定する。

### ドリルダウンの流れ

1. **セッション** — どのファイル群か（PID で識別）
2. **リクエスト** — どのファイルか（seqId で識別）
3. **エントリ** — そのファイルの何行目か（行番号 L1〜Ln）
4. **フィールド** — その行のどの値か（JSONPath）

各段階で「次にどこを見るか」の判断材料を得る。

### 判断材料

| 段階 | 見るべきもの | 判断 |
|------|-------------|------|
| セッション一覧 | workflow 種別、tools 数、結果 | 調べたいリクエストの seqId 特定 |
| エントリ一覧 | phase/type、サイズ、finish reason | どのエントリ（行）に問題がありそうか |
| メッセージ構造 | role、block type、ID の対応 | 入出力の構造が正しいか、何が渡されているか |
| 生データ | 実際の値 | 具体的な内容の確認 |

## ワークフロー種別の識別

ログの phase フィールドからワークフローを判別する。

| phase 値 | ワークフロー | 特徴 |
|----------|-------------|------|
| `agentic` | agentic | planning + task 実行。tools > 0 のメインリクエスト |
| `agentic`（tools=0） | routing | Claude Code の isNewTopic 判定。tools=0 |
| `passthrough` | passthrough | プロンプト加工なしの直接転送 |
| `phase1-analysis` | rag | 2 フェーズ。分析 → 生成 |
| `phase1-decision` | decision | 2 フェーズ。判定 → ツール呼び出し |
| `chat` | chat | ツールなしの会話 |

## リクエストの JSONL 構造

1 ファイルに通常 4 行:

| 行 | phase/type | 内容 |
|----|-----------|------|
| L1 | `request/in` | クライアントからのリクエスト。`.data.messages` に会話履歴 |
| L2 | `{workflow}/prompt` | エンジンが構築したプロンプト文字列。`.data.content` |
| L3 | `{workflow}/llm_response` | LLM の応答。`.data.content`, `.data.toolCalls`, `.data.finishReason` |
| L4 | `response/out` | クライアントへのレスポンス。`.data.stop_reason`, `.data.content[]` |

## メッセージ配列の読み方

L1 の `.data.messages` は Anthropic Messages API 形式の配列。

### content block の種類

| type | 説明 | 重要なフィールド |
|------|------|-----------------|
| `text` | テキスト。`<system-reminder>` や `<think>` を含むことがある | `.text` |
| `tool_use` | ツール呼び出し。assistant メッセージに含まれる | `.id`, `.name`, `.input` |
| `tool_result` | ツール実行結果。user メッセージに含まれる | `.tool_use_id`, `.content` |

### tool_use と tool_result の対応

`tool_use.id` と `tool_result.tool_use_id` が一致する。
サーバー内部では Anthropic 形式の ID（`toolu_xxx`）とドライバ ID の変換が行われる。

### `<think>` タグ

agentic ワークフローで `includeThinking: true` の場合、assistant の text に `<think>` タグが含まれる。
中身は planning や中間タスクの結果。最終出力は `</think>` の後。

## ツール

`extract-log` コマンドで上記のドリルダウンを行える。`extract-log --help` を参照。
