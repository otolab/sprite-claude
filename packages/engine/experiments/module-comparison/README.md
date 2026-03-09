# Module Comparison Experiment (sprite-claude)

This experiment uses `@modular-prompt/experiment` to compare different prompt module variations for sprite-claude's tool generation system.

## Setup

Install dependencies:

```bash
cd packages/anthropic-server
pnpm install
```

This will install `@modular-prompt/experiment` as a devDependency.

## Structure

```
experiments/module-comparison/
├── configs/
│   ├── experiment.config.ts  # Module and evaluator definitions
│   └── experiment.yaml        # Model and driver configuration
├── modules/
│   ├── original-module.ts     # Original toolGenerationModule
│   └── merged-module.ts       # Merged module variant
├── test-cases/
│   └── say-tool-case.ts       # Test cases for say tool
├── evaluators/
│   ├── functional-correctness.ts  # AI-based evaluator
│   └── json-validator.ts          # Code-based evaluator
└── run-experiment.sh          # Wrapper script
```

## Configuration

All paths in `configs/experiment.config.ts` are resolved **relative to the config file directory** (`configs/`).

### Module Paths

```typescript
export const modules: ModuleReference[] = [
  {
    name: 'original',
    path: './modules/original-module.ts',  // Resolves to configs/modules/...
    description: 'Original toolGenerationModule',
  },
];
```

### Evaluator Paths

```typescript
export const evaluators: EvaluatorReference[] = [
  {
    name: 'json-validator',
    path: './evaluators/json-validator.ts',  // Resolves to configs/evaluators/...
  },
];
```

### YAML Configuration

The `configs/experiment.yaml` file supports relative paths:

```yaml
# Path to experiment.config.ts (relative to this YAML file)
experimentConfig: ./experiment.config.ts

drivers:
  vertexai:
    # Paths are resolved relative to the YAML file
    # Can use ~/ for home directory or absolute paths
    credentialsPath: ~/.sprite-claude/otolab-vertexai-key.json
```

## Running Experiments

### Basic Usage

```bash
# Run all modules with all test models
./run-experiment.sh

# Run specific module
./run-experiment.sh --modules original

# Run specific test case
./run-experiment.sh --test-case "Simple completion notification"

# Run with specific model
./run-experiment.sh --model mlx

# Run multiple times for statistics
./run-experiment.sh --repeat 10
```

### With Evaluation

```bash
# Run with AI evaluation
./run-experiment.sh --evaluate

# Run with specific evaluators
./run-experiment.sh --evaluate --evaluators functional-correctness
```

### Advanced Options

```bash
# Combine options
./run-experiment.sh \
  --model mlx \
  --modules merged \
  --test-case "Simple completion notification" \
  --repeat 5 \
  --evaluate
```

## Direct npx Usage

You can also run experiments directly using npx:

```bash
npx tsx node_modules/@modular-prompt/experiment/dist/run-comparison.js \
  --config experiments/module-comparison/configs/experiment.yaml \
  --evaluate
```

## Adding Custom Modules

1. Create a new module file in `modules/`:

```typescript
// modules/my-custom-module.ts
import { compile, merge } from '@modular-prompt/core';
import { myPromptModule } from '../../../src/prompts/my-module.js';

export default {
  name: 'My Custom Module',
  description: 'Description of my module',
  compile: (context: any) => compile(myPromptModule, context),
};
```

2. Add it to `configs/experiment.config.ts`:

```typescript
export const modules: ModuleReference[] = [
  // ... existing modules
  {
    name: 'my-custom',
    path: './modules/my-custom-module.ts',
    description: 'My custom module',
  },
];
```

3. Run the experiment:

```bash
./run-experiment.sh --modules my-custom
```

## Adding Custom Evaluators

### Code Evaluator

Create a TypeScript file in `evaluators/`:

```typescript
// evaluators/my-validator.ts
import type { CodeEvaluator, EvaluationContext, EvaluationResult } from '@modular-prompt/experiment';

export default {
  name: 'My Validator',
  description: 'Validates custom criteria',

  async evaluate(context: EvaluationContext): Promise<EvaluationResult> {
    // Your validation logic
    return {
      evaluator: 'my-validator',
      moduleName: context.moduleName,
      score: 10,
      reasoning: 'Validation passed',
    };
  },
} satisfies CodeEvaluator;
```

### Prompt Evaluator

```typescript
// evaluators/my-quality-check.ts
import type { PromptEvaluator, EvaluationContext } from '@modular-prompt/experiment';
import type { PromptModule } from '@modular-prompt/core';

const evaluationModule: PromptModule<EvaluationContext> = {
  createContext: (): EvaluationContext => ({
    moduleName: '',
    prompt: '',
    runs: [],
  }),

  objective: [
    '- Assess custom quality criteria',
  ],

  instructions: [
    '- Evaluate based on specific requirements',
  ],
};

export default {
  name: 'Quality Check',
  description: 'Checks custom quality criteria',
  module: evaluationModule,
} satisfies PromptEvaluator;
```

Add to `configs/experiment.config.ts`:

```typescript
export const evaluators: EvaluatorReference[] = [
  // ... existing evaluators
  {
    name: 'my-quality-check',
    path: './evaluators/my-quality-check.ts',
  },
];
```

## Adding Test Cases

Edit `test-cases/say-tool-case.ts` or create a new file:

```typescript
export const myTestCase = {
  name: 'My Test Case',
  description: 'Description of the test',
  analysisResult: {
    // Analysis result from phase 1
  },
  relevantContext: {
    // Relevant context
  },
  toolDefinition: {
    // Tool definition
  },
};

export const allTestCases = [
  myTestCase,
  // ... other test cases
];
```

## Troubleshooting

### Module not found errors

Make sure all paths in `experiment.config.ts` are relative to the `configs/` directory:

- ✅ `./modules/my-module.ts` (resolves to `configs/modules/my-module.ts`)
- ❌ `../modules/my-module.ts` (incorrect)

### Credential errors

Check that the credentials path in `experiment.yaml` is correct:

```yaml
drivers:
  vertexai:
    credentialsPath: ~/.sprite-claude/otolab-vertexai-key.json
```

The path is resolved relative to the YAML file location.

## See Also

- [@modular-prompt/experiment](https://github.com/otolab/modular-prompt/tree/main/packages/experiment) - Documentation for the experiment framework
- [sprite-claude](../../README.md) - Main sprite-claude documentation
