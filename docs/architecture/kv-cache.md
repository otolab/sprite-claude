# KVキャッシュ

MLX KVキャッシュは、プロンプトのプリフィル結果を `.safetensors` ファイルとして保存し、次回のクエリで再利用することで推論を高速化する仕組みです。

## 概要

- **キャッシュファイル形式**: `.safetensors`
- **ファイルサイズ**: 1エントリあたり約600MB
- **管理クラス**: `MlxCacheController` (`@modular-prompt/driver`)
- **効果**: incremental prefill によるトークン再利用で、プリフィル時間を短縮

## 有効化条件

### config.yaml での設定

sprite-claudeでは、`config.yaml` の `models[].driverOptions.cacheDir` でキャッシュディレクトリを指定します:

```yaml
models:
  - name: "model-name"
    driver: "mlx"
    driverOptions:
      cacheDir: "~/.sprite-claude/cache"  # キャッシュ有効化
```

**注**: sprite-claude側の `config.ts` で `~` のパス展開が行われます。

### MlxCacheController の作成条件

`@modular-prompt/driver` の `config-based-factory.js` L32-34:

```javascript
const cacheController = driverOpts?.cacheDir
    ? new MlxCacheController({ cacheDir: driverOpts.cacheDir })
    : undefined;
```

- `driverOptions.cacheDir` が指定されている場合のみ `MlxCacheController` が作成される
- 未指定なら `cacheController` は `undefined` → キャッシュ機能なし

## managedDir の区別

`MlxCacheController` のコンストラクタでは、`cacheDir` の指定有無により動作が変わります:

| cacheDir 指定 | managedDir | 動作 |
|--------------|------------|------|
| **あり** | `false` | 永続ディレクトリ。`cache-index.json` をロード/保存。プロセス終了後もデータ保持 |
| **なし（空文字列）** | `true` | `bind()` で tmpdir に自動作成。プロセス終了時に `rmSync(recursive)` で全削除 |

**実用上の推奨**: sprite-claudeでは永続キャッシュ（`managedDir = false`）を使用します。

## キャッシュキー

キャッシュキーは以下の要素から SHA256 ハッシュで生成されます:

- model名
- instructions配列
- data配列
- formatterOptions
- tools（名前順でソート）
- reasoningEffort

**同じキャッシュキー = 同じプロンプト内容 = ファイル再利用**

## elementHashes

`elementHashes` は、プロンプトの各要素のハッシュ配列です:

- **instructions** → `i:` プレフィックス
- **data** → `d:` プレフィックス

### incremental prefill での役割

キャッシュ検索時に、`elementHashes` の前方一致でベースキャッシュを特定します:

1. 新しいクエリの `elementHashes` で既存キャッシュの prefix match を検索
2. **最も長くマッチするキャッシュをベースとして選択**
3. ベースのトークンを再利用しつつ、差分のみプリフィル → 高速化

前方が一致するほど、incremental prefill で再利用できるトークンが多くなります。

## incremental prefill と supersedes

incremental prefill の流れ:

1. 新しいクエリの `elementHashes` で既存キャッシュの prefix match を検索
2. 最も長くマッチするキャッシュを **base** として選択
3. base のトークンを再利用しつつ、差分のみプリフィル → 高速化
4. 新しいキャッシュファイル作成後、base を `supersedes` として記録
5. base の `cache-index.json` エントリに `hint: 'release'` を設定
6. `close()` 時に released エントリの実ファイルを削除

### supersedes の役割

- 新しいキャッシュがどのキャッシュから派生したかを記録
- `release()` 時に旧キャッシュを削除予定としてマーク

## release() ヒント

```javascript
release(ref) {
    // cache-index.json のエントリに hint: 'release' を設定
    entry.hint = 'release';
    // メモリ上の cacheByHash から削除
    // lastHandle をクリア
    // index を保存
}
```

- `release()` は「削除予定」マーク
- 実際のファイル削除は `close()` で行われる
- `findBestBase()` では `hint === 'release'` のエントリはスキップされる

## cache-index.json

### 構造

```json
{
  "version": 1,
  "entries": [
    {
      "key": "sha256hash...",
      "model": "model-name",
      "formatterOptionsHash": "sha256...",
      "elementHashes": ["i:hash1", "i:hash2", "d:hash3"],
      "toolsHash": "sha256...",
      "reasoningEffort": "",
      "createdAt": "2026-01-01T00:00:00.000Z",
      "hint": "release"  // optional
    }
  ]
}
```

### ロック機構

- **ロック方式**: `proper-lockfile` (mkdir-based advisory lock) を使用
- **managedDir の場合**: `managedDir=true` の場合は `saveIndex()` がスキップされる

## routing ワークフローとの関係

routing リクエストでは KV キャッシュが無効化されます。

### sprite-claude 側の設定

routing リクエストに `disableCache: true` を設定し、`QueryOptions.cache: false` としてドライバに伝搬:

```typescript
// messages/index.ts
const result = await runWorkflow(wfDef, aiService, module, {}, [], engineLogger,
  { ..., disableCache: true });
// → passthrough.ts で driver.query(compiled, { ..., cache: false }) に変換
```

### MlxDriver での実装 (@modular-prompt/driver 0.13.3+)

MlxDriver の `executeQuery()` で `QueryOptions.cache` が尊重される:

```javascript
// mlx-driver.js L232
if (this.cacheController && options?.cache !== false && trustRemoteCode === undefined) {
```

`cache: false` が渡された場合、`cacheController` を完全にスキップする。

## cache_stats ログ

ワークフロー完了後に `runner.ts` で記録されます。

**詳細は [log-analysis.md](../development/log-analysis.md) の「KVキャッシュの観察」セクションを参照してください。**

### 出力コード

- **passthrough**: `packages/engine/src/workflows/runner.ts` L129-130  
  `getCacheStats(resolved.driver)` で単一ドライバの統計
- **agentic**: 同 L156-157  
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

### 指標の読み方

- `fresh` が増えない = キャッシュが有効に機能
- `incremental` が増える = 差分プリフィルで効率的
- `prefillReusedTokens / totalPromptTokens` = キャッシュ再利用率

## 関連ドキュメント

- [log-analysis.md](../development/log-analysis.md) - KVキャッシュの観察方法
- [logging.md](logging.md) - ログシステムの全体構造
