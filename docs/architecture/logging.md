# ログシステム

sprite-claude は2種類の JSONL ログを記録します。

## 概要

| 種類 | 保存先 | 用途 |
|------|--------|------|
| **リクエストログ** | `~/.sprite-claude/logs/requests/{timestamp}-{pid}-{seqId}.jsonl` | リクエスト処理の全記録 |
| **サーバーログ** | `~/.sprite-claude/logs/server-{pid}.jsonl` | 起動・設定・エラー |

## 用語

- **セッション**: 1つのサーバープロセスのライフサイクル全体（PID単位）
- **リクエスト**: 個別のAPI呼び出し（seqID単位、ログファイル1つ）

## ログレベル設定

`~/.sprite-claude/config.yaml` で設定：

```yaml
logging:
  level: "debug"                    # メインログレベル (debug/info/warn/error)
  request_response_level: "full"    # リクエスト/レスポンスログ (none/minimal/full)
```

- `none`: ログを記録しない
- `minimal`: 最小限の情報のみ（ツール数、メッセージ数など）
- `full`: 完全な情報（デフォルト、推奨）

## リクエストログ

各リクエストは単一の JSONL ファイルに記録されます。

### ファイル命名規則

```
{timestamp}-{pid}-{seqId}.jsonl
```

例: `2025-11-27T02-31-04-31432-0021.jsonl`

### LogEntry 形式

```typescript
interface LogEntry {
  timestamp: string;   // ISO 8601
  pid: number;         // プロセスID
  seqId: string;       // リクエスト連番 (例: "0021")
  phase: string;       // ワークフロー定義名（config.yamlのworkflows.xxxのキー名、例: "default", "routing"）
  type: 'in' | 'out' | 'prompt' | 'llm_response' | 'error' | 'driver_info';  // エントリタイプ
  data: any;           // フェーズ固有のデータ
}
```

**注**: 以前の実装では `phase` は固定のユニオン型でしたが、現在はワークフロー定義名を受け入れる `string` 型です。

### フェーズとタイプ

#### 共通エントリ

| Phase | Type | 説明 |
|-------|------|------|
| `request` | `in` | クライアントからのリクエスト |
| `response` | `out` | クライアントへのレスポンス |
| ワークフロー定義名 | `driver_info` | ワークフロー実行前に記録されるドライバー情報（モデル構成） |

**driver_info エントリ**: ワークフロー実行前に記録され、使用されるモデル構成を含みます。
- **passthrough の場合**: `{ model: "モデル名" }`
- **agentic の場合**: `{ model: "デフォルトモデル名", models: { default: "...", chat: "...", plan: "...", instruct: "...", thinking: "..." } }`
- `phase` フィールドにはワークフロー定義名（例: "default", "routing"）が入ります

#### RAG ワークフロー（mode: 'rag'）

**注**: Phase列にはワークフロー定義名が入ります。以下は旧実装での固定値です。

| Phase（旧） | Type | 説明 |
|-------|------|------|
| `phase1-analysis` | `prompt` | Phase1 入力プロンプト |
| `phase1-analysis` | `llm_response` | Phase1 LLM応答（分析結果） |
| `phase1-analysis` | `error` | Phase1 エラー（パースエラー等） |
| `phase2-tool-generation` | `prompt` | Phase2 ツール生成プロンプト |
| `phase2-tool-generation` | `llm_response` | Phase2 ツール生成 LLM応答 |
| `phase2-tool-generation` | `error` | Phase2 ツール生成エラー |
| `phase2-response-generation` | `prompt` | Phase2 応答生成プロンプト |
| `phase2-response-generation` | `llm_response` | Phase2 応答生成 LLM応答 |

#### Decision ワークフロー（mode: 'decision'）

**注**: Phase列にはワークフロー定義名が入ります。以下は旧実装での固定値です。

| Phase（旧） | Type | 説明 |
|-------|------|------|
| `phase1-decision` | `prompt` / `llm_response` | Phase1 判定 |
| `phase2-tool-call` | `prompt` / `llm_response` / `error` | Phase2 ツール呼び出し |

#### Chat ワークフロー（mode: 'chat'）

**注**: Phase列にはワークフロー定義名が入ります。以下は旧実装での固定値です。

| Phase（旧） | Type | 説明 |
|-------|------|------|
| `chat` | `prompt` | プロンプト |
| `chat` | `llm_response` | LLM応答 |

#### Agentic ワークフロー（mode: 'agentic'）

| Type | 説明 | 記録されるフィールド |
|------|------|---------------------|
| `prompt` | プロンプト（agenticProcess への入力） | `toolCount` |
| `llm_response` | LLM応答（agenticProcess の最終結果） | `model`（実際に使用されたモデル名） |
| `error` | agenticProcess 実行時のエラー | `stack` |

**注**: `phase` フィールドにはワークフロー定義名（例: "default"）が入ります。

#### Passthrough ワークフロー（mode: 'passthrough'）

| Type | 説明 | 記録されるフィールド |
|------|------|---------------------|
| `prompt` | プロンプト（request.system をシステムプロンプトとして使用） | `toolCount` |
| `llm_response` | LLM応答 | `model`（実際に使用されたモデル名） |
| `error` | driver.query 実行時のエラー | `stack` |

**注**: `phase` フィールドにはワークフロー定義名（例: "routing"）が入ります。

## サーバーログ

サーバーのライフサイクルイベントを記録します。

### ServerLogEntry 形式

```typescript
interface ServerLogEntry {
  timestamp: string;
  pid: number;
  level: 'info' | 'warn' | 'error' | 'debug';
  category: 'startup' | 'config' | 'driver' | 'request' | 'shutdown';
  message: string;
  data?: any;
}
```

### カテゴリ

| Category | 説明 |
|----------|------|
| `startup` | サーバー起動・AIService初期化 |
| `config` | 設定読み込み・ログレベル |
| `driver` | ドライバ選択・作成・実行時情報（runtimeInfo） |
| `request` | リクエスト処理の概要 |
| `shutdown` | サーバー停止 |

**注意**: ドライバ初回起動時に `runtimeInfo`（MLXバージョン、システムメモリ等）が `driver` カテゴリに記録されます。

## ログ解析ツール（extract-log）

### 使い方

```bash
# セッションサマリー
./scripts/extract-log.sh summary
./scripts/extract-log.sh summary --session 12345

# メッセージ詳細
./scripts/extract-log.sh show
./scripts/extract-log.sh show "検索テキスト"
./scripts/extract-log.sh show --phase passthrough --prompt-only
./scripts/extract-log.sh show --meta                          # LLMレスポンスのメタデータを表示
./scripts/extract-log.sh show --meta --output-only            # メタデータのみ表示

# 構造概要（inspect）- 1リクエスト内の全エントリを概要表示
./scripts/extract-log.sh inspect                               # 最新リクエストを inspect
./scripts/extract-log.sh inspect "検索テキスト"                # 検索テキストで探す
./scripts/extract-log.sh inspect --session 81403 --seq 0003   # セッション + シーケンスID指定

# サーバーログ
./scripts/extract-log.sh server
./scripts/extract-log.sh server --session 12345
./scripts/extract-log.sh server --level error
./scripts/extract-log.sh server --category startup

# フェーズ一覧
./scripts/extract-log.sh phases
```

### セッションサマリー表示例

```
SeqID | Timestamp | P1      | P2      | Workflow       | Tool                          | User Message
==========================================================================================================
0001 | 06:46:11 | ✓T      | ✓       | default        | mcp__coeiro-operator__say     | こんばんは
0002 | 06:46:30 | ✓R      | -       | routing        | passthrough                   | ありがとう
```

- P1: Phase1 / 単一フェーズのステータス（✓=成功, ✗=失敗, -=なし, T=tool, R=response）
- P2: Phase2 ステータス（✓=成功, ✗=失敗, -=なし）
- Workflow: ワークフロー定義名（driver_infoエントリのphaseフィールドから取得、なければ`-`）
- passthrough/chat ワークフローでは P1 に結果、P2 は `-`

### inspect コマンド表示例

1リクエスト内の全エントリを構造概要として表示します。

```
SeqID: 0001
Timestamp: 2026-02-24T07:18:25.212Z
Model (requested): claude-3-5-sonnet-20241022
Tools: 23
Messages: 1

Entries:
  request/in                          | model=claude-3-5-sonnet-20241022 tools=23 messages=1
  default/driver_info                 | model=LiquidAI/LFM2.5-1.2B-JP-MLX-8bit roles={default=xxx, chat=xxx, ...}
  passthrough/prompt                  | content_length=21163 tool_count=23
  passthrough/llm_response            | model=LiquidAI/LFM2.5-1.2B-JP-MLX-8bit finish=stop content_len=262 toolCalls=0
  response/out                        | stop_reason=end_turn content_blocks=1
```

**driver_info エントリ**: ワークフロー実行前に記録され、使用されるモデル構成を表示します。

### show --meta オプション表示例

LLMレスポンスのメタデータ（model, finishReason, usage, toolCalls, structuredOutput）を表示します。

```bash
./scripts/extract-log.sh show --meta
```

出力:
```
=== Metadata ===
Model: LiquidAI/LFM2.5-1.2B-JP-MLX-8bit
Finish Reason: stop
Usage:
  Prompt Tokens: 1234
  Completion Tokens: 56
  Total Tokens: 1290
Tool Calls: 0
Structured Output: false

=== Content ===
(応答内容...)
```

### jqでの解析例

```bash
# Phase1の分析結果を確認
cat {ログファイル}.jsonl | jq 'select(.phase == "phase1-analysis" and .type == "llm_response") | .data.content'

# エラーを確認
cat {ログファイル}.jsonl | jq 'select(.type == "error")'

# 全フェーズ概要
cat {ログファイル}.jsonl | jq -c '{phase: .phase, type: .type}'
```

## 関連設定

- メイン設定: `~/.sprite-claude/config.yaml`
- ワークフローモード: `config.yaml` の `workflow.mode`

## 関連ドキュメント

- [2-phase-tool-approach.md](../development/2-phase-tool-approach.md) - ツール処理の設計思想
- [prompt-engineering.md](../development/prompt-engineering.md) - プロンプト開発フロー
