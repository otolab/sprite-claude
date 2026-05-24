## `config.yaml` 設定仕様ドキュメント

### 1. `workflows` セクション

**構造**: `Record<string, WorkflowDefinition>`

`workflows`セクションは、利用可能なワークフローを定義します。
キーはワークフローの名前（`workflowName`として参照される）であり、値は`WorkflowDefinition`オブジェクトです。

**例**:
```yaml
workflows:
  passthrough-default: # workflowName: "passthrough-default"
    mode: "passthrough"
    models:
      default: "mlx-community/gemma-2-2b-it-4bit"
  agentic-full: # workflowName: "agentic-full"
    mode: "agentic"
    models:
      default: "mlx-community/gemma-2-2b-it-4bit"
      chat: "vertexai:gemini-2.0-flash-001"
      plan: "vertexai:gemini-2.0-flash-001"
      thinking: "vertexai:gemini-2.0-flash-001"
      instruct: "vertexai:gemini-2.0-flash-001"
```

**注意**: `runWorkflow`関数は現在、`passthrough`と`agentic`モードのみをサポートしています。`rag`や`chat`モードの定義は可能ですが、`runWorkflow`からは直接実行されず、`Unsupported workflow mode`エラーが発生します。

### 2. `modelMapping` セクション

**構造**: `Record<string, string>`

`modelMapping`セクションは、リクエストされたモデル名（`request.model`）から、実際に使用すべきワークフロー名にマッピングするために使用されます。これにより、モデル選択の柔軟性が向上します。

**動作**: `modelMapping`は、`request.model`の値に基づいて実行すべきワークフロー名を決定します。

1.  **`modelMapping`がない場合**: `modelMapping`が設定されていない場合は、デフォルトで`'default'`というワークフロー名を返します。
2.  **厳密な一致**: まず、`request.model`と`modelMapping`のキーとの厳密な一致を試みます。一致するキーが見つかった場合、そのキーに対応するワークフロー名を返します。
3.  **グロブパターンによる一致**: 厳密な一致が見つからなかった場合、`modelMapping`内のキーをイテレートし、グロブパターン（`*`を含むパターン）による一致を試みます。
    *   `prefix*`: 指定されたプレフィックスで始まるモデル名に一致します。
    *   `*suffix`: 指定されたサフィックスで終わるモデル名に一致します。
    *   `*contains*`: 指定された文字列がモデル名に含まれている場合に一致します。
    最初に一致したパターンのワークフロー名を返します。
4.  **デフォルトへのフォールバック**: 上記のいずれにも一致しなかった場合、最終的に`'default'`というワークフロー名を返します。

**例**:
```yaml
modelMapping:
  claude-3-5-sonnet-*: "default"
  claude-opus-*: "pro"
  # fast_local: "default" # 例としてfast_localのようなキーも可能だが、
  # best_reasoning: "agentic" # 値はワークフロー名でなければならない
```
この例では、`claude-3-5-sonnet-*`で始まるモデルは`default`ワークフローに、`claude-opus-*`で始まるモデルは`pro`ワークフローにマッピングされます。

### 3. `WorkflowDefinition` インターフェース

`WorkflowDefinition`は、個々のワークフローの設定を定義します。

**プロパティ**:

*   **`mode`**: `WorkflowMode`
    *   ワークフローの実行モードを指定します。
    *   有効な値は`'rag'`, `'decision'`, `'chat'`, `'passthrough'`, `'agentic'`ですが、`runWorkflow`関数が現在サポートしているのは`'passthrough'`と`'agentic'`モードのみです。他のモードを指定した場合、`runWorkflow`からは`Unsupported workflow mode`エラーが発生します。
    *   これは、`@sprite-claude/engine`の`WorkflowMode`型に基づきます。
*   **`models`**: `Record<string, string | string[]>` (Optional)
    *   ワークフロー内で使用されるモデルの定義です。
    *   キーは役割名（例: `default`, `chat`, `plan`, `instruct`, `thinking` など）です。
    *   値は、使用するモデル名（文字列）またはモデルのcapability（文字列配列）です。
    *   指定がない場合、グローバルな`models`設定（`AIService`に登録されたモデル一覧）からcapabilityベースで選択されます。

**`models`プロパティの構造と意味**:

*   **キー (役割名)**:
    *   ワークフローの特定のタスクやフェーズ（例: `default`, `chat`, `plan`, `instruct`, `thinking` など）を表します。
    *   `default`を指定した場合、そのワークフロー内で明示的に指定されていない役割に対してデフォルトで使用されるモデルとなります。
*   **値 (モデル名またはcapabilities)**:
    *   **文字列**: 直接的なモデル名（例: `"mlx-community/Llama-3.2-3B-Instruct-4bit"`, `"vertexai:gemini-2.0-flash-001"`）。
    *   **文字列配列**: モデルのcapability（能力）を指定します。`@sprite-claude/engine`または`@modular-prompt/driver`が、これらのcapabilityを持つモデルの中から最適なものを選択します（例: `["fast", "japanese"]`）。

### 4. `routingWorkflow` セクション

`routingWorkflow`は、`system-reminder`がないリクエストに対して使用するワークフローを指定します。

**例**:
```yaml
routingWorkflow: "chat"
```

### 5. `workflowTimeout` セクション

`workflowTimeout`は、ワークフロー実行のタイムアウトをミリ秒単位で指定します。デフォルトは`300000` (5分) です。

**例**:
```yaml
workflowTimeout: 600000 # 10分
```