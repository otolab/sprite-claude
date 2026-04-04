import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadPromptModules } from '../../messages/system-prompt.js';
import { writeFileSync, mkdirSync, existsSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('loadPromptModules', () => {
  const testDir = join(tmpdir(), 'sprite-claude-test');
  const promptsDir = join(testDir, 'prompts');

  beforeEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true });
    }
    mkdirSync(promptsDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true });
    }
  });

  it('should load default module when no specs provided', () => {
    const module = loadPromptModules(undefined, testDir);

    // default-system.yaml からロードされる
    expect(module).toBeDefined();
  });

  it('should load YAML file by string spec', () => {
    const yamlContent = `instructions:
  - Test instruction 1
  - Test instruction 2
`;
    writeFileSync(join(promptsDir, 'custom.yaml'), yamlContent);

    const module = loadPromptModules(['prompts/custom.yaml'], testDir);

    expect(module.instructions).toBeDefined();
    const instructions = module.instructions as any[];
    expect(instructions.some((item: any) => item === 'Test instruction 1')).toBe(true);
    expect(instructions.some((item: any) => item === 'Test instruction 2')).toBe(true);
  });

  it('should accept inline PromptModuleDefinition', () => {
    const module = loadPromptModules([
      { instructions: ['Inline instruction'] },
    ], testDir);

    expect(module.instructions).toBeDefined();
    const instructions = module.instructions as any[];
    expect(instructions.some((item: any) => item === 'Inline instruction')).toBe(true);
  });

  it('should merge multiple specs in order', () => {
    const yamlContent = `objective:
  - From file
`;
    writeFileSync(join(promptsDir, 'base.yaml'), yamlContent);

    const module = loadPromptModules([
      'prompts/base.yaml',
      { instructions: ['From inline'] },
    ], testDir);

    // Both objective and instructions should be present
    expect(module.objective).toBeDefined();
    expect(module.instructions).toBeDefined();
    const objective = module.objective as any[];
    const instructions = module.instructions as any[];
    expect(objective.some((item: any) => item === 'From file')).toBe(true);
    expect(instructions.some((item: any) => item === 'From inline')).toBe(true);
  });

  it('should handle YAML with nested subsections', () => {
    // 子要素が全てstringの場合はフラット展開される
    const yamlContent = `instructions:
  - Simple instruction
  - Complex instruction:
    - Sub instruction 1
    - Sub instruction 2
`;
    writeFileSync(join(promptsDir, 'nested.yaml'), yamlContent);

    const module = loadPromptModules(['prompts/nested.yaml'], testDir);

    const instructions = module.instructions as any[];
    expect(instructions.some((item: any) => item === 'Simple instruction')).toBe(true);
    // 子要素が全てstringなのでフラット展開される
    expect(instructions.some((item: any) => item === 'Complex instruction:')).toBe(true);
    expect(instructions.some((item: any) => item === '- Sub instruction 1')).toBe(true);
    expect(instructions.some((item: any) => item === '- Sub instruction 2')).toBe(true);
  });

  it('should handle YAML with all sections', () => {
    const yamlContent = `objective:
  - Test objective
persona:
  - Test persona
instructions:
  - Test instruction
materials:
  - Test material
`;
    writeFileSync(join(promptsDir, 'full.yaml'), yamlContent);

    const module = loadPromptModules(['prompts/full.yaml'], testDir);

    expect(module.objective).toBeDefined();
    expect(module.persona).toBeDefined();
    expect(module.instructions).toBeDefined();
    expect(module.materials).toBeDefined();
  });

  it('should throw when file not found', () => {
    expect(() => {
      loadPromptModules(['prompts/nonexistent.yaml'], testDir);
    }).toThrow('Prompt module file not found');
  });
});
