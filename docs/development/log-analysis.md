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

ログの `phase` フィールドにはワークフロー定義名（`config.yaml` の `workflows.xxx` のキー名）が入ります。
ワークフローモードは `driver_info` エントリで確認できます。

**注**: 以前の実装では `phase` は固定値（`agentic`, `passthrough` など）でしたが、現在はワークフロー定義名（例: `default`, `routing`）が入ります。

### ワークフローモードの種類

| mode 値 | 特徴 |
|---------|------|
| `agentic` | planning + task 実行。DriverSetを使用 |
| `passthrough` | プロンプト加工なしの直接転送 |
| `rag` | 2 フェーズ。分析 → 生成 |
| `decision` | 2 フェーズ。判定 → ツール呼び出し |
| `chat` | ツールなしの会話 |

## リクエストの JSONL 構造

1 ファイルに通常 5 行（driver_info エントリを含む）:

| 行 | phase/type | 内容 |
|----|-----------|------|
| L1 | `request/in` | クライアントからのリクエスト。`.data.messages` に会話履歴 |
| L2 | `{workflow_name}/driver_info` | ワークフロー実行前のドライバー情報。`.data.model`, `.data.models`（agenticの場合） |
| L3 | `{workflow_name}/prompt` | エンジンが構築したプロンプト文字列。`.data.content` |
| L4 | `{workflow_name}/llm_response` | LLM の応答。`.data.content`, `.data.toolCalls`, `.data.finishReason` |
| L5 | `response/out` | クライアントへのレスポンス。`.data.stop_reason`, `.data.content[]` |

**注**: `{workflow_name}` はワークフロー定義名（例: `default`, `routing`）。以前は固定値（`agentic`, `passthrough` など）でした。

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
