import { describe, it, expect } from 'vitest';
import { chatModule } from '@sprite-claude/engine';
import { compile, createContext } from '@modular-prompt/core';

describe('chatModule', () => {
  it('should format messages correctly', () => {
    const context = createContext(chatModule);
    context.messages = [
      { type: 'message', role: 'user', content: 'Hello' },
      { type: 'message', role: 'assistant', content: 'Hi there' }
    ];
    context.systemReminders = [];

    const compiled = compile(chatModule, context);

    // chatModule should produce compiled prompt with messages in data section
    expect(compiled.output).toHaveLength(0);
    // Verify messages are present in compiled data
    const messages = compiled.data.filter((d: any) =>
      d.type === 'message' && (d.role === 'user' || d.role === 'assistant')
    );
    expect(messages.length).toBe(2);
    expect(messages[0]).toMatchObject({
      type: 'message',
      role: 'user',
      content: 'Hello'
    });
    expect(messages[1]).toMatchObject({
      type: 'message',
      role: 'assistant',
      content: 'Hi there'
    });
  });

  it('should add materials section when system reminders exist', () => {
    const context = createContext(chatModule);
    context.messages = [
      { type: 'message', role: 'user', content: 'Hello' }
    ];
    context.systemReminders = [
      'Reminder 1',
      'Reminder 2'
    ];

    const compiled = compile(chatModule, context);

    // Materials should be in data section
    const allDataItems = compiled.data.flatMap((s: any) => s.items || []);
    const hasIntro = allDataItems.some((item: any) =>
      typeof item === 'string' && item.includes('materials are automatically extracted')
    );
    const hasReminder1 = allDataItems.some((item: any) =>
      typeof item === 'string' && item.includes('Reminder 1')
    );
    const hasReminder2 = allDataItems.some((item: any) =>
      typeof item === 'string' && item.includes('Reminder 2')
    );

    expect(hasIntro).toBe(true);
    expect(hasReminder1).toBe(true);
    expect(hasReminder2).toBe(true);
  });

  it('should not add materials section when no system reminders', () => {
    const context = createContext(chatModule);
    context.messages = [
      { type: 'message', role: 'user', content: 'Hello' }
    ];
    context.systemReminders = [];

    const compiled = compile(chatModule, context);

    const materialsSection = compiled.data.find((s: any) => s.title === 'Materials');
    expect(materialsSection).toBeUndefined();
  });

  it('should not include cue', () => {
    const context = createContext(chatModule);
    context.messages = [
      { type: 'message', role: 'user', content: 'Hello' }
    ];
    context.systemReminders = [];

    const compiled = compile(chatModule, context);

    // cue should not be present
    expect(compiled.output).toHaveLength(0);
  });

  it('should handle empty messages', () => {
    const context = createContext(chatModule);
    context.messages = [];
    context.systemReminders = [];

    const compiled = compile(chatModule, context);

    expect(compiled.data).toHaveLength(0);
    expect(compiled.output).toHaveLength(0);
  });
});
