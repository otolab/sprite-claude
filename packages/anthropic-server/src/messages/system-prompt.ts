import { readFileSync, existsSync } from 'fs';
import { homedir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { parse } from 'yaml';
import type { PromptModule } from '@modular-prompt/core';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * YAML structure for system prompt
 * Note: Record<string, any> is necessary here to accept arbitrary YAML structures
 * that users can define in their custom system.yaml files
 */
interface SystemPromptYAML {
  objective?: string[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  instructions?: Array<string | Record<string, any>>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  materials?: Array<string | Record<string, any>>;
}

/**
 * Convert YAML array to PromptModule instructions format
 * Note: Function parameter uses any to accept arbitrary YAML structures (see SystemPromptYAML)
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function convertInstructionsArray(items: Array<string | Record<string, any>>): Array<string | { type: 'subsection'; title: string; items: any[] }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result: Array<string | { type: 'subsection'; title: string; items: any[] }> = [];

  for (const item of items) {
    if (typeof item === 'string') {
      result.push(item);
    } else {
      // Object with nested structure - convert to SubSection
      for (const [key, value] of Object.entries(item)) {
        if (Array.isArray(value)) {
          result.push({
            type: 'subsection',
            title: key,
            items: convertInstructionsArray(value)
          });
        } else {
          result.push(`${key}: ${value}`);
        }
      }
    }
  }

  return result;
}

/**
 * Load system prompt as PromptModule
 *
 * Priority:
 * 1. Custom YAML from ~/.sprite-claude/prompts/system.yaml
 * 2. Custom Markdown from ~/.sprite-claude/prompts/system.md
 * 3. Default YAML from project root default-system.yaml
 * 4. Default Markdown from src/prompts/default-system.md
 *
 * Additional instructions:
 * - If additionalInstructions starts with '@', treat as file path (e.g., "@prompts/custom.md")
 * - Otherwise, treat as inline text
 * - If not provided, fallback to ~/.sprite-claude/prompts/additional.md (if exists)
 *
 * @param additionalInstructions - Additional instructions (inline text or @file reference)
 * @param configDir - Custom config directory (for testing, defaults to ~/.sprite-claude)
 */
export function loadSystemPromptModule(
  additionalInstructions?: string,
  configDir?: string
): PromptModule<Record<string, never>> {
  // 1. Try to load YAML format first
  const baseDir = configDir || join(homedir(), '.sprite-claude');
  const customYamlPath = join(baseDir, 'prompts', 'system.yaml');
  const defaultYamlPath = join(__dirname, '..', '..', '..', '..', '..', 'default-system.yaml');

  let yamlData: SystemPromptYAML | null = null;

  if (existsSync(customYamlPath)) {
    yamlData = parse(readFileSync(customYamlPath, 'utf-8'));
  } else if (existsSync(defaultYamlPath)) {
    yamlData = parse(readFileSync(defaultYamlPath, 'utf-8'));
  }

  // If YAML is loaded, convert to PromptModule
  if (yamlData) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const instructions: Array<string | { type: 'subsection'; title: string; items: any[] }> = [];

    // Add instructions
    if (yamlData.instructions && yamlData.instructions.length > 0) {
      instructions.push(...convertInstructionsArray(yamlData.instructions));
    }

    // Add additional instructions
    if (additionalInstructions && additionalInstructions.trim()) {
      const trimmed = additionalInstructions.trim();

      // Check if it's a file reference (starts with @)
      if (trimmed.startsWith('@')) {
        const filePath = trimmed.substring(1); // Remove @ prefix
        const resolvedPath = filePath.startsWith('/')
          ? filePath
          : join(baseDir, filePath);

        if (existsSync(resolvedPath)) {
          let additional = readFileSync(resolvedPath, 'utf-8').trim();
          // Remove markdown headings (lines starting with #)
          additional = additional.split('\n')
            .filter(line => !line.trim().startsWith('#'))
            .join('\n')
            .trim();
          if (additional) {
            instructions.push(additional);
          }
        }
      } else {
        // Inline text
        instructions.push(trimmed);
      }
    } else {
      // Fallback to default file
      const additionalPath = join(baseDir, 'prompts', 'additional.md');
      if (existsSync(additionalPath)) {
        let additional = readFileSync(additionalPath, 'utf-8').trim();
        // Remove markdown headings (lines starting with #)
        additional = additional.split('\n')
          .filter(line => !line.trim().startsWith('#'))
          .join('\n')
          .trim();
        if (additional) {
          instructions.push(additional);
        }
      }
    }

    return {
      createContext: () => ({}),
      objective: yamlData.objective ? convertInstructionsArray(yamlData.objective) : undefined,
      instructions: instructions.length > 0 ? instructions : undefined,
      materials: yamlData.materials ? convertInstructionsArray(yamlData.materials) : undefined
    };
  }

  // 2. Fallback to Markdown format (legacy)
  const customMdPath = join(baseDir, 'prompts', 'system.md');
  const defaultMdPath = join(__dirname, '..', '..', 'prompts', 'default-system.md');

  let basePrompt: string;
  if (existsSync(customMdPath)) {
    basePrompt = readFileSync(customMdPath, 'utf-8').trim();
  } else {
    basePrompt = readFileSync(defaultMdPath, 'utf-8').trim();
  }

  // Add additional instructions
  let additional: string | undefined;
  if (additionalInstructions && additionalInstructions.trim()) {
    const trimmed = additionalInstructions.trim();

    // Check if it's a file reference (starts with @)
    if (trimmed.startsWith('@')) {
      const filePath = trimmed.substring(1); // Remove @ prefix
      const resolvedPath = filePath.startsWith('/')
        ? filePath
        : join(baseDir, filePath);

      if (existsSync(resolvedPath)) {
        additional = readFileSync(resolvedPath, 'utf-8').trim();
      }
    } else {
      // Inline text
      additional = trimmed;
    }
  } else {
    // Fallback to default file
    const additionalPath = join(baseDir, 'prompts', 'additional.md');
    if (existsSync(additionalPath)) {
      additional = readFileSync(additionalPath, 'utf-8').trim();
    }
  }

  const fullPrompt = additional && additional.trim()
    ? `${basePrompt}\n\n---\n\n${additional.trim()}`
    : basePrompt;

  // Convert Markdown to PromptModule
  return {
    createContext: () => ({}),
    instructions: [fullPrompt]
  };
}
