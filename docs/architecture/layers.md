# アーキテクチャ: 層の責任分担

## 概要

sprite-claudeは2つの明確に分離された層で構成されています：

1. **プロセス管理層**（Python）- プロセスのライフサイクル管理
2. **サーバーロジック層**（TypeScript）- APIサーバーとしての機能

この分離により、各層は自身の責任に専念し、保守性と拡張性を確保しています。

## 1. プロセス管理層（Python）

### 実装

- **言語**: Python
- **コマンド**: `sprite-claude`
- **ファイル**: `src/sprite_claude/`

### 責任

#### メインの責任: Claude Codeプロセスの管理

- 環境変数の設定（`ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN`）
- `claude`コマンドの起動
- 引数の透過的な受け渡し

#### サブの責任: anthropic-serverプロセスの起動

- バックグラウンドでのサーバープロセス起動
- プロセスの停止・再起動
- 状態確認（PIDファイル管理）

#### 必要悪: 最小限の設定読み込み

プロセス起動に必要な情報のみ：
- サーバーのポート番号（`server.port`）
- サーバーのホスト（`server.host`）
- PID/ログディレクトリパス

**重要**: サーバーロジックに関する設定（models、drivers、credentials等）は読み込まない

### やってはいけないこと

❌ モデル定義の管理
❌ 認証情報の管理
❌ LLMロジックへの関与
❌ 設定のJSON化とCLI引数での受け渡し

### 設定ファイルとの関係

```python
# ✅ 良い例: プロセス起動に必要な情報のみ
port = config.get('server.port', 4000)
cmd = ['pnpm', 'start', '--port', str(port), '--config', config_path]

# ❌ 悪い例: サーバーロジックの設定を読み込んで渡す
models = config.get('models')
cmd.extend(['--models', json.dumps(models)])  # これはNG
```

## 2. サーバーロジック層（TypeScript）

### 実装

- **言語**: TypeScript
- **パッケージ**: `@modular-prompt/anthropic-server`
- **ファイル**: `packages/anthropic-server/`

### 責任

#### APIサーバー機能

- Anthropic Messages API (`/v1/messages`) 互換のエンドポイント提供
- リクエスト/レスポンスの処理
- ストリーミング対応
- エラーハンドリング

#### 設定管理（最重要）

**この層が設定ファイルを直接読み込み、全ての設定を管理する**

```typescript
// config.yamlを直接読み込む
const config = loadConfig(configPath);

// 全ての設定を処理
const models = config.models;
const drivers = config.drivers;
const selection = config.selection;

// 認証情報も処理
const vertexaiConfig = drivers.vertexai;
if (vertexaiConfig.credentialsPath) {
  process.env.GOOGLE_APPLICATION_CREDENTIALS =
    expandPath(vertexaiConfig.credentialsPath);
}
```

処理すべき設定：
- `models` - モデル定義
- `drivers` - ドライバー設定（認証情報含む）
- `selection` - モデル選択ロジック
- `logging` - ログ設定
- `prompt` - プロンプト設定

#### LLM実行

- modular-promptのDriverを使用
- MLX、Vertex AI、OpenAI等の統合
- モデル選択ロジック（AIService）

### やってはいけないこと

❌ プロセス管理（他のプロセスの起動・停止）
❌ PIDファイルの管理
❌ プロセス監視

### 設定ファイルとの関係

```typescript
// ✅ 良い例: 設定を直接読み込んで使用
const config = loadConfig(configPath);
const aiService = new AIService({
  models: config.models,
  drivers: config.drivers,
  selection: config.selection,
});

// ✅ 良い例: 認証情報の処理
if (config.drivers.vertexai?.credentialsPath) {
  process.env.GOOGLE_APPLICATION_CREDENTIALS =
    expandPath(config.drivers.vertexai.credentialsPath);
}
```

## 層間のインターフェース

### Python → TypeScript

Pythonは**設定ファイルパスのみ**をTypeScriptに渡す：

```bash
# Pythonが実行するコマンド
pnpm --dir packages/anthropic-server start \
  --port 4000 \
  --host 0.0.0.0 \
  --config ~/.sprite-claude/config.yaml
```

**重要**: モデル定義や認証情報は渡さない

### TypeScript → Python

TypeScriptはPythonに何も返さない。各層は独立して動作。

## 設定ファイル（config.yaml）の扱い

### 読み込みの責任

| 設定項目 | 読み込む層 | 理由 |
|---------|----------|------|
| `server.port` | Python（必要悪） | プロセス起動に必要 |
| `server.host` | Python（必要悪） | プロセス起動に必要 |
| `runtime.pid_dir` | Python | プロセス管理に必要 |
| `runtime.log_dir` | Python | プロセス管理に必要 |
| `models` | **TypeScript** | サーバーロジック |
| `drivers` | **TypeScript** | サーバーロジック |
| `drivers.*.credentialsPath` | **TypeScript** | サーバーロジック |
| `selection` | **TypeScript** | サーバーロジック |
| `logging` | **TypeScript** | サーバーロジック |
| `prompt` | **TypeScript** | サーバーロジック |

### 実装ガイドライン

```python
# Python側（server.py）
# ✅ 良い例
port = config.get('server.port', 4000)
config_path = str(config.config_path)
cmd = ['pnpm', 'start', '--port', str(port), '--config', config_path]

# ❌ 悪い例
models = config.get('models')
cmd.extend(['--models', json.dumps(models)])
```

```typescript
// TypeScript側（cli.ts or server setup）
// ✅ 良い例
const configPath = program.getOptionValue('config') || '~/.sprite-claude/config.yaml';
const config = loadConfig(configPath);

// 全ての設定を自分で処理
const aiService = new AIService({
  models: config.models,
  drivers: config.drivers,
  selection: config.selection,
});

// 認証情報も自分で処理
if (config.drivers.vertexai?.credentialsPath) {
  process.env.GOOGLE_APPLICATION_CREDENTIALS = expandPath(config.drivers.vertexai.credentialsPath);
}
```

## テストの責任

### プロセス管理層のテスト（Python）

- プロセス起動・停止が正しく動作するか
- PIDファイルが正しく管理されるか
- 環境変数が正しく設定されるか

### サーバーロジック層のテスト（TypeScript）

- **ユニットテスト**: 個別機能のテスト（LLM不要）
- **統合テスト**: LLMを使った実際の推論テスト
- **設定読み込みテスト**: config.yamlが正しく読み込まれるか
- **E2Eテスト**: サーバー全体が動作するか

## 現在の問題と修正が必要な箇所

### 問題

現在のコード（`src/sprite_claude/server.py`）では、Pythonが設定を読み込んでTypeScriptに渡している：

```python
# ❌ 現在の実装（間違い）
models = self.config.get('models')
drivers = self.config.get('drivers')
if models:
    cmd.extend(['--models', json.dumps(models)])
if drivers:
    cmd.extend(['--drivers', json.dumps(drivers)])
```

これは層の責任を違反している。

### 修正方針

1. **TypeScript側に設定読み込み機能を実装**
   - `config.yaml`を読み込むロジック
   - YAML パーサー追加
   - パス展開（`~`等）

2. **Python側から設定渡しを削除**
   - `--models`, `--drivers` オプションを削除
   - `--config` オプションのみ渡す

3. **credentialsPath処理をTypeScript側に移動**
   - 環境変数設定をTypeScript側で実行

## まとめ

- **プロセス管理 = Python の責任**
- **サーバーロジック = TypeScript の責任**
- **設定管理 = TypeScript の責任**（プロセス起動に必要な最小限のみPythonが読む）

この原則を守ることで、各層が独立し、保守性と拡張性が向上します。
