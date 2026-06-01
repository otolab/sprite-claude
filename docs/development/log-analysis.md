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

## KV キャッシュの観察

### cache_stats ログエントリ

ワークフロー完了時に `cache_stats` タイプのログエントリが記録される。

**出力コード**:
- passthrough: `packages/engine/src/workflows/runner.ts` L129-130  
  `getCacheStats(resolved.driver)` で単一ドライバの統計
- agentic: 同 L156-157  
  `getAllCacheStats(driverSet)` で DriverSet 全体の統計

**注**: `cacheController` を持たないドライバでは出力されない（`getCacheStats` が `undefined` を返す）。

### CacheStats のフィールド

| フィールド | 意味 |
|-----------|------|
| `totalQueries` | クエリ総数 |
| `incremental` | incremental プリフィル回数（キャッシュ再利用） |
| `fresh` | フルプリフィル回数（キャッシュなし） |
| `totalPromptTokens` | 処理したプロンプトトークン総数 |
| `prefillReusedTokens` | キャッシュから再利用したトークン数 |
| `cacheGrowthTokens` | 新たにキャッシュに追加したトークン数 |

### 観察方法

cache_stats は `extract-log.sh` の標準出力には表示されない（show サブコマンドのエントリ一覧には `cache_stats` タイプとして見える）。

**ログファイルを直接検索**:

```bash
# 全ログから cache_stats エントリを抽出
python3 -c "
import json
from pathlib import Path
log_dir = Path.home() / '.sprite-claude' / 'logs' / 'requests'
for f in sorted(log_dir.glob('*.jsonl')):
    for line in f.read_text().splitlines():
        entry = json.loads(line)
        if entry.get('type') == 'cache_stats':
            print(f'{f.name}: {json.dumps(entry.get(\"data\",{}))}')
"
```

**特定セッションの cache_stats**:

```bash
# PID 69949 のセッション
grep -h '"type":"cache_stats"' ~/.sprite-claude/logs/requests/*69949*.jsonl | \
  python3 -c "import sys, json; [print(f'seq={json.loads(l)[\"seqId\"]}: {json.dumps(json.loads(l)[\"data\"])}') for l in sys.stdin]"
```

### 読み方の例

あるセッションでのキャッシュ推移:

| seq | totalQueries | incremental | fresh | prefillReusedTokens | 解釈 |
|-----|--------------|-------------|-------|---------------------|------|
| 0001 | 1 | 0 | 1 | 0 | 初回、フルプリフィル |
| 0002 | 3 | 0 | 1 | 0 | まだキャッシュ再利用なし |
| 0003 | 3 | 1 | 1 | 19,024 | キャッシュ再利用開始 |
| 0006 | 6 | 4 | 1 | 76,326 | fresh=1 のまま、incremental が積み上がる |
| 0007 | 7 | 5 | 1 | 95,516 | 正常にキャッシュ機能中 |

**指標**:
- `fresh` が増えない = キャッシュが有効に機能
- `incremental` が増える = 差分プリフィルで効率的
- `prefillReusedTokens / totalPromptTokens` = キャッシュ再利用率

### cache_stats が出力されない場合

- ドライバに `cacheController` がない（例: LFM2.5-8B モデルでは出力されなかった実績あり）
- ワークフローが正常完了しなかった（エラーやタイムアウトで中断）
- cache_stats が出力されないこと自体が、そのモデルでキャッシュが機能していない重要な手がかり

### KV キャッシュファイルの直接確認

```bash
# cache-index.json の確認
cat ~/.sprite-claude/cache/cache-index.json | python3 -m json.tool

# ファイルとインデックスの整合性確認
ls ~/.sprite-claude/cache/*.safetensors | wc -l  # 実ファイル数
# index の entries 数と一致すべき

# ディスク使用量
du -sh ~/.sprite-claude/cache/
```

### LLM 応答ログからの間接的な観察

cache_stats が出ない場合でも、L4 の `logEntries` から MLX ドライバのパフォーマンスログで間接的に推測できる:

- `setup 1ms` → キャッシュヒット（プリフィル不要）
- `setup 数秒〜十数秒` → キャッシュミスまたは部分ヒット（プリフィル実行）
- `TTFT` → 最初のトークンまでの時間。キャッシュヒット時は短い

```bash
# extract-log で L4 のログエントリを確認
./scripts/extract-log.sh show --seq N --raw 'L4.data.logEntries'
```
