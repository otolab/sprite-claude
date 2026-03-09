#!/usr/bin/env tsx

import { chatModule, toolDecisionModule, toolCallModule } from '../../src/index.js';
import { merge, compile, createContext } from '@modular-prompt/core';
import { formatCompletionPrompt } from '@modular-prompt/driver';
import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

console.log('=== System Prompt Module + Chat Module Merge Test ===\n');

// Create a simple system prompt module for testing
console.log('1. Creating system prompt module...');
const systemPromptModule = {
  createContext: () => ({}),
  instructions: ['You are a helpful AI assistant running locally on the user\'s Mac using MLX.'],
};
console.log('   ✓ System prompt module created');
console.log('');

// Merge with chat module
console.log('2. Merging with chat module...');
const mergedModule = merge(systemPromptModule, chatModule);
console.log('   ✓ Modules merged');
console.log('');

// Create context with sample data
console.log('3. Creating context with sample data...');
const sampleMessages = [
  { role: 'user', content: 'Hello, how are you?' },
  { role: 'assistant', content: 'I am doing well, thank you for asking!' },
  { role: 'user', content: 'Can you help me with a task?' }  // Current request
];

const context = createContext(mergedModule);
context.messages = sampleMessages;
context.systemReminders = [
  'This is a test reminder from the system',
  'Another important note'
];
console.log('   ✓ Context created');
console.log('   - Messages:', context.messages.length);
console.log('   - System reminders:', context.systemReminders.length);
console.log('');

// Compile prompt
console.log('4. Compiling prompt...');
const compiled = compile(mergedModule, context);
console.log('   ✓ Prompt compiled');
console.log('');

// Display structure summary
console.log('5. Compiled Prompt Structure:');
console.log('   Instructions:', compiled.instructions?.length || 0, 'sections');
console.log('   Data:', compiled.data?.length || 0, 'sections');
console.log('   Output:', compiled.output?.length || 0, 'sections');
console.log('');

// Format and save main prompt
console.log('6. Formatting and saving main prompt...');
const formattedText = formatCompletionPrompt(compiled);
const outputPath = join(__dirname, '..', 'test-prompt-output.yaml');
writeFileSync(outputPath, formattedText, 'utf-8');
console.log(`   ✓ Saved to: ${outputPath}`);
console.log(`   ✓ Length: ${formattedText.length} characters`);
console.log('');

// Phase 1: Tool Decision
console.log('7. Compiling Phase 1 (Tool Decision)...');
const phase1Messages = [
  { role: 'user', content: 'Hello' },
  { role: 'assistant', content: 'Hi! How can I help you today?' }
];

const phase1Context = createContext(toolDecisionModule);
phase1Context.userMessage = 'What is the weather in Tokyo?';
phase1Context.availableTools = '- get_weather: Get current weather for a city';
phase1Context.messages = phase1Messages;

const phase1Compiled = compile(toolDecisionModule, phase1Context);
const phase1Text = formatCompletionPrompt(phase1Compiled);
const phase1Path = join(__dirname, '..', 'test-prompt-phase1.yaml');
writeFileSync(phase1Path, phase1Text, 'utf-8');
console.log(`   ✓ Saved to: ${phase1Path}`);
console.log(`   ✓ Length: ${phase1Text.length} characters`);
console.log('');

// Phase 2: Tool Call Generation
console.log('8. Compiling Phase 2 (Tool Call Generation)...');
const phase2Context = createContext(toolCallModule);
phase2Context.toolDecision = 'The user wants weather information for Tokyo. I should use the get_weather tool.';
phase2Context.toolDefinitions = `Tool: get_weather
Description: Get current weather for a city
Parameters:
  - city (REQUIRED): The city name to get weather for
  - units (optional): Temperature units (celsius or fahrenheit)`;

const phase2Compiled = compile(toolCallModule, phase2Context);
const phase2Text = formatCompletionPrompt(phase2Compiled);
const phase2Path = join(__dirname, '..', 'test-prompt-phase2.yaml');
writeFileSync(phase2Path, phase2Text, 'utf-8');
console.log(`   ✓ Saved to: ${phase2Path}`);
console.log(`   ✓ Length: ${phase2Text.length} characters`);
console.log('');

console.log('✓ Verification complete!');
