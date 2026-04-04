import { readFileSync, existsSync } from 'fs';
import { homedir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { parse } from 'yaml';
import { merge, type PromptModule } from '@modular-prompt/core';
import type { PromptModuleDefinition } from '../server/config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Convert YAML array to PromptModule instructions format
 * Note: Function parameter uses any to accept arbitrary YAML structures (see PromptModuleDefinition)
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
          if (value.every((v: unknown) => typeof v === 'string')) {
            // 子要素が全てstringの場合はフラットなリストとして展開
            result.push(`${key}:`);
            for (const v of value) {
              result.push(`- ${v}`);
            }
          } else {
            // ネストされた構造がある場合はSubSectionとして変換
            result.push({
              type: 'subsection',
              title: key,
              items: convertInstructionsArray(value)
            });
          }
        } else {
          result.push(`${key}: ${value}`);
        }
      }
    }
  }

  return result;
}

/**
 * YAML/インラインのPromptModuleDefinitionをPromptModuleに変換
 */
function toPromptModule(def: PromptModuleDefinition): PromptModule<Record<string, never>> {
  return {
    createContext: () => ({}),
    objective: def.objective ? convertInstructionsArray(def.objective) : undefined,
    persona: def.persona ? convertInstructionsArray(def.persona) : undefined,
    instructions: def.instructions ? convertInstructionsArray(def.instructions) : undefined,
    materials: def.materials ? convertInstructionsArray(def.materials) : undefined,
    terms: def.terms ? convertInstructionsArray(def.terms) : undefined,
  };
}

/**
 * YAMLファイルからPromptModuleを読み込む
 */
function loadModuleFromFile(filePath: string, configDir: string): PromptModule<Record<string, never>> {
  const resolvedPath = filePath.startsWith('/')
    ? filePath
    : join(configDir, filePath);

  if (!existsSync(resolvedPath)) {
    throw new Error(`Prompt module file not found: ${resolvedPath}`);
  }

  const data = parse(readFileSync(resolvedPath, 'utf-8')) as PromptModuleDefinition;
  return toPromptModule(data);
}

/**
 * デフォルトのシステムプロンプトを読み込む
 */
function loadDefaultModule(configDir: string): PromptModule<Record<string, never>> | null {
  const customYamlPath = join(configDir, 'prompts', 'system.yaml');
  const defaultYamlPath = join(__dirname, '..', '..', '..', '..', '..', 'default-system.yaml');

  if (existsSync(customYamlPath)) {
    const data = parse(readFileSync(customYamlPath, 'utf-8')) as PromptModuleDefinition;
    return toPromptModule(data);
  }
  if (existsSync(defaultYamlPath)) {
    const data = parse(readFileSync(defaultYamlPath, 'utf-8')) as PromptModuleDefinition;
    return toPromptModule(data);
  }
  return null;
}

/**
 * プロンプトモジュールを読み込んでマージする
 *
 * @param specs - PromptModuleの配列（文字列=YAMLファイルパス、オブジェクト=インライン定義）
 * @param configDir - 設定ディレクトリ（デフォルト: ~/.sprite-claude）
 */
export function loadPromptModules(
  specs?: Array<string | PromptModuleDefinition>,
  configDir?: string
): PromptModule<Record<string, never>> {
  const baseDir = configDir || join(homedir(), '.sprite-claude');

  if (!specs || specs.length === 0) {
    // specsが未指定の場合のみデフォルトモジュールを使用
    const defaultModule = loadDefaultModule(baseDir);
    return defaultModule || { createContext: () => ({}) };
  }

  // specsが指定されている場合はデフォルトモジュールを読み込まない
  const modules: PromptModule<Record<string, never>>[] = [];

  for (const spec of specs) {
    if (typeof spec === 'string') {
      modules.push(loadModuleFromFile(spec, baseDir));
    } else {
      modules.push(toPromptModule(spec));
    }
  }

  if (modules.length === 0) {
    return { createContext: () => ({}) };
  }

  return modules.reduce((acc, mod) => merge(acc, mod));
}
