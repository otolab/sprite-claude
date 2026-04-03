# ログ分析

sprite-claude のリクエストログを調査する手順。

## ドリルダウン

1. `./scripts/extract-log.sh summary` でセッション一覧を確認し、対象の seqId を特定する
2. `./scripts/extract-log.sh show --seq <id>` でエントリ構造を確認する（行番号 L1〜Ln）
3. `./scripts/extract-log.sh show --seq <id> --messages` でメッセージ配列の構造を確認する
4. `./scripts/extract-log.sh show --seq <id> --raw '<path>'` で生データを取得する

## フェーズ別表示

- `./scripts/extract-log.sh show --seq <id> --phase agentic` — 特定フェーズのプロンプト/出力内容を表示
- `./scripts/extract-log.sh show --seq <id> --phase agentic --meta` — メタデータ（model, finishReason, usage）を表示

## パス指定

`--raw` のパスは `L{行番号}.data.{フィールド}` 形式。通常5行構成:

- `L1` — request/in（リクエスト）
- `L2` — {workflow_name}/driver_info（モデル構成）
- `L3` — {workflow_name}/prompt（プロンプト）
- `L4` — {workflow_name}/llm_response（LLM応答）
- `L5` — response/out（レスポンス）

例:
- `L1.data.messages[1].content[0].text` — メッセージの中身
- `L2.data.models` — DriverSet のモデル構成（agentic の場合）
- `L4.data.content` — LLM 応答テキスト
- `L4.data.toolCalls` — LLM が返したツール呼び出し
- `L4.data.finishReason` — 停止理由

## その他のコマンド

- `./scripts/extract-log.sh show --seq <id> --save` — リクエストデータをファイルに保存
- `./scripts/extract-log.sh phases` — ログに出現するフェーズ種別を一覧表示
- `./scripts/extract-log.sh server` — サーバーライフサイクルログ（起動、設定、ドライバ情報）

## ワークフロー判別

summary の WF 列でワークフローモード、Workflow 列でワークフロー定義名を確認する。

- WF 列: `routing` / `agentic` / `passthru` / `rag` / `chat` — ワークフローモード
- Workflow 列: `default` / `routing` など — config.yaml の workflows.xxx のキー名（driver_info エントリから取得）

## 背景知識

詳細は `docs/development/log-analysis.md` を参照。
