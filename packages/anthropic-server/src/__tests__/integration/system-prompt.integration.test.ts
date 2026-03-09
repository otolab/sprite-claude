import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadSystemPromptModule } from '../../messages/system-prompt.js';
import { writeFileSync, mkdirSync, existsSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('loadSystemPromptModule', () => {
  const testDir = join(tmpdir(), 'sprite-claude-test');
  const promptsDir = join(testDir, 'prompts');

  beforeEach(() => {
    // Create test directory
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true });
    }
    mkdirSync(promptsDir, { recursive: true });
  });

  afterEach(() => {
    // Cleanup
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true });
    }
  });

  it('should load YAML format and convert to PromptModule', () => {
    const yamlContent = `instructions:
  - Test instruction 1
  - Test instruction 2
  - Simple instruction
  - Complex instruction:
    - Sub instruction 1
    - Sub instruction 2
`;

    writeFileSync(join(promptsDir, 'system.yaml'), yamlContent);

    const module = loadSystemPromptModule(undefined, testDir);

    expect(module.instructions).toBeDefined();
    expect(Array.isArray(module.instructions)).toBe(true);

    const instructions = module.instructions as any[];
    // Check instructions array
    const hasInstruction1 = instructions.some(item =>
      typeof item === 'string' && item.includes('Test instruction 1')
    );
    const hasInstruction2 = instructions.some(item =>
      typeof item === 'string' && item.includes('Test instruction 2')
    );
    const hasSimpleInstruction = instructions.some(item =>
      typeof item === 'string' && item.includes('Simple instruction')
    );

    expect(hasInstruction1).toBe(true);
    expect(hasInstruction2).toBe(true);
    expect(hasSimpleInstruction).toBe(true);

    // Check for subsection
    const subsection = instructions.find(item =>
      typeof item === 'object' && item.type === 'subsection'
    );
    expect(subsection).toBeDefined();
    expect(subsection.title).toBe('Complex instruction');
    expect(subsection.items).toContain('Sub instruction 1');
    expect(subsection.items).toContain('Sub instruction 2');
  });

  it('should fallback to default YAML if custom files not found', () => {
    // Don't create any custom files - should load default YAML
    const module = loadSystemPromptModule(undefined, testDir);

    expect(module.instructions).toBeDefined();
    expect(Array.isArray(module.instructions)).toBe(true);
    // Should have loaded default YAML which contains "AI assistant"
    const hasDefaultContent = (module.instructions as any[]).some(item =>
      typeof item === 'string' && (item.includes('AI assistant') || item.includes('helpful'))
    );
    expect(hasDefaultContent).toBe(true);
  });

  it('should append additional instructions', () => {
    const yamlContent = `instructions:
  - Base instruction
`;

    writeFileSync(join(promptsDir, 'system.yaml'), yamlContent);

    const module = loadSystemPromptModule('Additional instruction here', testDir);

    const instructions = module.instructions as any[];
    const hasBase = instructions.some((item: any) =>
      typeof item === 'string' && item.includes('Base instruction')
    );
    const hasAdditional = instructions.some((item: any) =>
      typeof item === 'string' && item.includes('Additional instruction here')
    );

    expect(hasBase).toBe(true);
    expect(hasAdditional).toBe(true);
  });

  it('should load additional instructions from default file', () => {
    const yamlContent = `instructions:
  - Base instruction
`;
    const additionalContent = 'File-based additional instruction';

    writeFileSync(join(promptsDir, 'system.yaml'), yamlContent);
    writeFileSync(join(promptsDir, 'additional.md'), additionalContent);

    const module = loadSystemPromptModule(undefined, testDir);

    const instructions = module.instructions as any[];
    const hasBase = instructions.some((item: any) =>
      typeof item === 'string' && item.includes('Base instruction')
    );
    const hasAdditional = instructions.some((item: any) =>
      typeof item === 'string' && item.includes(additionalContent)
    );

    expect(hasBase).toBe(true);
    expect(hasAdditional).toBe(true);
  });

  it('should load additional instructions from file with @ prefix (relative path)', () => {
    const yamlContent = `instructions:
  - Base instruction
`;
    const customContent = 'Custom file content from relative path';

    writeFileSync(join(promptsDir, 'system.yaml'), yamlContent);
    writeFileSync(join(promptsDir, 'custom-instructions.md'), customContent);

    const module = loadSystemPromptModule('@prompts/custom-instructions.md', testDir);

    const instructions = module.instructions as any[];
    const hasBase = instructions.some((item: any) =>
      typeof item === 'string' && item.includes('Base instruction')
    );
    const hasCustom = instructions.some((item: any) =>
      typeof item === 'string' && item.includes(customContent)
    );

    expect(hasBase).toBe(true);
    expect(hasCustom).toBe(true);
  });

  it('should load additional instructions from file with @ prefix (absolute path)', () => {
    const yamlContent = `instructions:
  - Base instruction
`;
    const customContent = 'Custom file content from absolute path';
    const customFilePath = join(testDir, 'custom.md');

    writeFileSync(join(promptsDir, 'system.yaml'), yamlContent);
    writeFileSync(customFilePath, customContent);

    const module = loadSystemPromptModule(`@${customFilePath}`, testDir);

    const instructions = module.instructions as any[];
    const hasBase = instructions.some((item: any) =>
      typeof item === 'string' && item.includes('Base instruction')
    );
    const hasCustom = instructions.some((item: any) =>
      typeof item === 'string' && item.includes(customContent)
    );

    expect(hasBase).toBe(true);
    expect(hasCustom).toBe(true);
  });

  it('should use inline text when @ prefix is not present', () => {
    const yamlContent = `instructions:
  - Base instruction
`;

    writeFileSync(join(promptsDir, 'system.yaml'), yamlContent);

    // Inline text (no @ prefix)
    const module = loadSystemPromptModule('Inline instruction', testDir);

    const instructions = module.instructions as any[];
    const hasInline = instructions.some((item: any) =>
      typeof item === 'string' && item.includes('Inline instruction')
    );

    expect(hasInline).toBe(true);
  });

  it('should handle YAML with materials section', () => {
    const yamlContent = `objective:
  - Test objective

materials:
  - Material item 1
  - Material item 2
`;

    writeFileSync(join(promptsDir, 'system.yaml'), yamlContent);

    const module = loadSystemPromptModule(undefined, testDir);

    expect(module.materials).toBeDefined();
    expect(Array.isArray(module.materials)).toBe(true);
    const hasMaterial1 = (module.materials as any[]).some((item: any) =>
      typeof item === 'string' && item.includes('Material item 1')
    );
    const hasMaterial2 = (module.materials as any[]).some((item: any) =>
      typeof item === 'string' && item.includes('Material item 2')
    );
    expect(hasMaterial1).toBe(true);
    expect(hasMaterial2).toBe(true);
  });

  it('should handle YAML with only objective section', () => {
    const yamlContent = `objective:
  - Test objective
`;

    writeFileSync(join(promptsDir, 'system.yaml'), yamlContent);

    const module = loadSystemPromptModule(undefined, testDir);

    // When only objective is defined, instructions will be undefined
    expect(module.objective).toBeDefined();
    expect(module.instructions).toBeUndefined();
    expect(module.materials).toBeUndefined();
  });
});
