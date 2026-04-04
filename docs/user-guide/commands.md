# コマンドリファレンス

`sprite-claude`コマンドは、基本的な実行に加えて、サーバーの管理や設定ファイルの操作を行うためのサブコマンドを提供します。

## 基本的な使い方

`sprite-claude`コマンドを引数なしで実行すると、以下の動作を一括で行います。これは、最も手軽に`sprite-claude`を開始する方法です。

1.  設定ファイルがなければ自動生成
2.  サーバーが起動していなければ自動起動
3.  環境変数を自動設定してClaude Codeを起動（対話モード）

```bash
sprite-claude
```

サーバーはバックグラウンドで常駐するため、Claude Code終了後も起動したままです。

## 引数の引き渡し

`sprite-claude`に渡された引数は、`sprite-claude`自身のサブコマンド（`server`, `init`, `config`）でない限り、そのままClaude Codeコマンドに渡されます。これにより、`sprite-claude`を経由してClaude Codeの様々な機能を利用できます。

```bash
# 非対話モード（--print）でプロンプトを実行
sprite-claude --print "Hello, how are you?"

# ファイル検索のテスト
sprite-claude --print "List all TypeScript files in src/"

# 会話を継続
sprite-claude --continue

# その他のclaudeコマンドのオプションもそのまま使用可能
sprite-claude --system-prompt "You は helpful assistant" --print "Explain MLX"
```

**注意**: `server`, `init`, `config`で始まる引数のみ、`sprite-claude`のコマンドとして解釈されます。それ以外の引数はすべてClaude Codeコマンドに渡されます。

## サーバー管理

通常は`sprite-claude`コマンドを引数なしで実行するだけでサーバーが自動的に管理されますが、サーバーを個別に操作することも可能です。

```bash
# サーバーの起動（Claude Codeは起動しない）
sprite-claude server start

# サーバーの停止
sprite-claude server stop

# 状態確認
sprite-claude server status

# サーバーの再起動
sprite-claude server restart
```

## 設定管理

設定ファイルの初期化や編集を行うためのコマンドです。

```bash
# 設定ファイルの初期化（再生成）
sprite-claude init

# 設定ファイルの編集
sprite-claude config edit
```
