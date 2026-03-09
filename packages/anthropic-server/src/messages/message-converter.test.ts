import { describe, it, expect } from 'vitest';
import { convertMessages } from './message-converter.js';
import type { MessagesRequest } from '../schema.js';

describe('convertMessages', () => {
  it('should convert simple text messages', () => {
    const request: MessagesRequest = {
      model: 'test',
      max_tokens: 100,
      messages: [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there' },
      ]
    };

    const result = convertMessages(request);

    expect(result.messages).toHaveLength(2);
    expect(result.messages[0]).toEqual({ type: 'message', role: 'user', content: 'Hello' });
    expect(result.messages[1]).toEqual({ type: 'message', role: 'assistant', content: 'Hi there' });
    expect(result.systemReminders).toHaveLength(0);
  });

  it('should extract system-reminder tags', () => {
    const request: MessagesRequest = {
      model: 'test',
      max_tokens: 100,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Hello' },
            { type: 'text', text: '<system-reminder>Important note</system-reminder>' },
            { type: 'text', text: 'More text' }
          ]
        }
      ]
    };

    const result = convertMessages(request);

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].content).toBe('Hello\nMore text');
    expect(result.systemReminders).toHaveLength(1);
    expect(result.systemReminders[0]).toBe('Important note');
  });

  it('should handle multiple system-reminder tags', () => {
    const request: MessagesRequest = {
      model: 'test',
      max_tokens: 100,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: '<system-reminder>Reminder 1</system-reminder>Text<system-reminder>Reminder 2</system-reminder>' }
          ]
        }
      ]
    };

    const result = convertMessages(request);

    expect(result.systemReminders).toHaveLength(2);
    expect(result.systemReminders[0]).toBe('Reminder 1');
    expect(result.systemReminders[1]).toBe('Reminder 2');
    expect(result.messages[0].content).toBe('Text');
  });

  it('should handle tool_result blocks', () => {
    const request: MessagesRequest = {
      model: 'test',
      max_tokens: 100,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Query' },
            { type: 'tool_result', tool_use_id: 'tool_123', content: 'Result data' }
          ]
        }
      ]
    };

    const result = convertMessages(request);

    // Now tool_result is a separate MessageElement with role
    expect(result.messages).toHaveLength(2);
    expect(result.messages[0]).toEqual({ type: 'message', role: 'user', content: 'Query' });
    expect(result.messages[1]).toEqual({ type: 'message', role: 'user', content: '[Tool result from tool_123: Result data]' });
  });

  it('should handle tool_use blocks', () => {
    const request: MessagesRequest = {
      model: 'test',
      max_tokens: 100,
      messages: [
        {
          role: 'assistant',
          content: [
            { type: 'text', text: 'Let me check' },
            { type: 'tool_use', id: 'tool_123', name: 'get_weather', input: { location: 'Tokyo' } }
          ]
        }
      ]
    };

    const result = convertMessages(request);

    // Now tool_use is a separate MessageElement with role
    expect(result.messages).toHaveLength(2);
    expect(result.messages[0]).toEqual({ type: 'message', role: 'assistant', content: 'Let me check' });
    expect(result.messages[1]).toEqual({ type: 'message', role: 'assistant', content: '[Assistant called the get_weather tool (location: "Tokyo")]' });
  });

  it('should skip empty messages', () => {
    const request: MessagesRequest = {
      model: 'test',
      max_tokens: 100,
      messages: [
        { role: 'user', content: '' },
        { role: 'user', content: 'Hello' },
        { role: 'user', content: '   ' }
      ]
    };

    const result = convertMessages(request);

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].content).toBe('Hello');
  });

  it('should preserve consecutive same-role messages', () => {
    const request: MessagesRequest = {
      model: 'test',
      max_tokens: 100,
      messages: [
        { role: 'user', content: 'Message 1' },
        { role: 'user', content: 'Message 2' },
        { role: 'assistant', content: 'Response' }
      ]
    };

    const result = convertMessages(request);

    expect(result.messages).toHaveLength(3);
    expect(result.messages[0]).toEqual({ type: 'message', role: 'user', content: 'Message 1' });
    expect(result.messages[1]).toEqual({ type: 'message', role: 'user', content: 'Message 2' });
    expect(result.messages[2]).toEqual({ type: 'message', role: 'assistant', content: 'Response' });
  });
});
