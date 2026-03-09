import { z } from 'zod';

// Role types
export const RoleSchema = z.enum(['user', 'assistant']);

// Cache control (optional field for prompt caching)
export const CacheControlSchema = z.object({
  type: z.literal('ephemeral'),
  ttl: z.string().optional(),
});

// Content blocks
export const TextBlockSchema = z.object({
  type: z.literal('text'),
  text: z.string(),
  cache_control: CacheControlSchema.optional(),
});

export const ToolUseBlockSchema = z.object({
  type: z.literal('tool_use'),
  id: z.string(),
  name: z.string(),
  input: z.record(z.unknown()),
  cache_control: CacheControlSchema.optional(),
});

export const ToolResultBlockSchema = z.object({
  type: z.literal('tool_result'),
  tool_use_id: z.string(),
  content: z.union([z.string(), z.array(TextBlockSchema)]),
  is_error: z.boolean().optional(),
  cache_control: CacheControlSchema.optional(),
});

export const ContentBlockSchema = z.union([
  TextBlockSchema,
  ToolUseBlockSchema,
  ToolResultBlockSchema,
]);

// Message
export const MessageSchema = z.object({
  role: RoleSchema,
  content: z.union([z.string(), z.array(ContentBlockSchema)]),
});

// Tool definition
export const ToolSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  input_schema: z.object({
    type: z.literal('object'),
    properties: z.record(z.unknown()).optional(),
    required: z.array(z.string()).optional(),
  }),
});

// Request
export const MessagesRequestSchema = z.object({
  model: z.string(),
  messages: z.array(MessageSchema),
  max_tokens: z.number().int().positive(),
  system: z.union([z.string(), z.array(z.object({ type: z.literal('text'), text: z.string(), cache_control: CacheControlSchema.optional() }))]).optional(),
  temperature: z.number().min(0).max(1).optional(),
  top_p: z.number().min(0).max(1).optional(),
  top_k: z.number().int().positive().optional(),
  stop_sequences: z.array(z.string()).optional(),
  stream: z.boolean().optional(),
  tools: z.array(ToolSchema).optional(),
});

// Response
export const StopReasonSchema = z.enum(['end_turn', 'max_tokens', 'stop_sequence', 'tool_use']);

export const UsageSchema = z.object({
  input_tokens: z.number().int(),
  output_tokens: z.number().int(),
  cache_read_input_tokens: z.number().int().optional(),
  cache_creation_input_tokens: z.number().int().optional(),
});

export const MessagesResponseSchema = z.object({
  id: z.string(),
  type: z.literal('message'),
  role: z.literal('assistant'),
  content: z.array(ContentBlockSchema),
  model: z.string(),
  stop_reason: StopReasonSchema,
  usage: UsageSchema,
});

// Export types
export type Role = z.infer<typeof RoleSchema>;
export type TextBlock = z.infer<typeof TextBlockSchema>;
export type ToolUseBlock = z.infer<typeof ToolUseBlockSchema>;
export type ToolResultBlock = z.infer<typeof ToolResultBlockSchema>;
export type ContentBlock = z.infer<typeof ContentBlockSchema>;
export type Message = z.infer<typeof MessageSchema>;
export type Tool = z.infer<typeof ToolSchema>;
export type MessagesRequest = z.infer<typeof MessagesRequestSchema>;
export type StopReason = z.infer<typeof StopReasonSchema>;
export type Usage = z.infer<typeof UsageSchema>;
export type MessagesResponse = z.infer<typeof MessagesResponseSchema>;
