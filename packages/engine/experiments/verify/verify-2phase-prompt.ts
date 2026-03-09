#!/usr/bin/env tsx

/**
 * Verify 2-phase prompt structure
 *
 * This script tests the new 2-phase approach:
 * - Phase 1: Analysis (RAG-style retrieval)
 * - Phase 2: Generation (Tool or Response)
 */

import { compile, createContext, merge } from '@modular-prompt/core';
import { formatCompletionPrompt } from '@modular-prompt/driver';
import { writeFileSync } from 'fs';
import { analysisModule, type AnalysisResult } from '../../src/prompts/analysis-module.js';
import { toolGenerationModule, responseGenerationModule } from '../../src/prompts/generation-module.js';

console.log('=== 2-Phase Prompt Verification ===\n');

// Sample conversation
const sampleMessages = [
  { role: 'user', content: 'Hello, how are you?' },
  { role: 'assistant', content: 'I am doing well, thank you for asking!' },
  { role: 'user', content: 'What is the weather in Tokyo?' }
];

// Sample tools
const availableTools = `- get_weather: Get current weather for a city
- calculate: Perform mathematical calculations`;

// Phase 1: Analysis
console.log('=== Phase 1: Analysis ===\n');
const analysisContext = createContext(analysisModule);
analysisContext.messages = sampleMessages;
analysisContext.availableTools = availableTools;

const analysisCompiled = compile(analysisModule, analysisContext);
const analysisPrompt = formatCompletionPrompt(analysisCompiled);

console.log('Saving analysis prompt to test-prompt-analysis.yaml...');
writeFileSync('test-prompt-analysis.yaml', analysisPrompt);

// Simulate analysis result
const mockAnalysisResult: AnalysisResult = {
  analysis: {
    userIntent: 'Get current weather information for Tokyo',
    relevantMessages: [2],  // Last message
    keyFacts: [
      'User wants to know weather in Tokyo',
      'This is the user\'s third message in the conversation'
    ],
    missingInfo: []
  },
  action: {
    type: 'tool',
    toolName: 'get_weather',
    reasoning: 'Weather data requires real-time information which can only be obtained through the get_weather tool'
  }
};

// Phase 2a: Tool Generation
console.log('\n=== Phase 2a: Tool Generation ===\n');
const toolGenContext = createContext(toolGenerationModule);
toolGenContext.analysisResult = mockAnalysisResult;
toolGenContext.relevantContext = [
  { label: 'user', text: 'What is the weather in Tokyo?' }
];
toolGenContext.toolDefinition = {
  name: 'get_weather',
  description: 'Get current weather for a city',
  input_schema: {
    type: 'object',
    properties: {
      city: {
        type: 'string',
        description: 'The city name to get weather for'
      },
      units: {
        type: 'string',
        enum: ['celsius', 'fahrenheit'],
        description: 'Temperature units'
      }
    },
    required: ['city']
  }
};

const toolGenCompiled = compile(toolGenerationModule, toolGenContext);
const toolGenPrompt = formatCompletionPrompt(toolGenCompiled);

console.log('Saving tool generation prompt to test-prompt-tool-gen.yaml...');
writeFileSync('test-prompt-tool-gen.yaml', toolGenPrompt);

// Phase 2b: Response Generation
console.log('\n=== Phase 2b: Response Generation ===\n');

// Mock response scenario
const mockResponseAnalysis: AnalysisResult = {
  analysis: {
    userIntent: 'Casual greeting and check on assistant\'s status',
    relevantMessages: [0, 1],
    keyFacts: [
      'User greeted with "Hello"',
      'User asked "how are you"'
    ],
    missingInfo: []
  },
  action: {
    type: 'response',
    reasoning: 'This is a casual conversation that doesn\'t require external tools'
  }
};

const responseGenContext = createContext(responseGenerationModule);
responseGenContext.analysisResult = mockResponseAnalysis;
responseGenContext.relevantContext = [
  { label: 'user', text: 'Hello, how are you?' },
  { label: 'assistant', text: 'I am doing well, thank you for asking!' }
];
responseGenContext.systemPrompt = 'You are a helpful AI assistant running locally on the user\'s Mac using MLX.';

const responseGenCompiled = compile(responseGenerationModule, responseGenContext);
const responseGenPrompt = formatCompletionPrompt(responseGenCompiled);

console.log('Saving response generation prompt to test-prompt-response-gen.yaml...');
writeFileSync('test-prompt-response-gen.yaml', responseGenPrompt);

console.log('\n=== Verification Complete ===\n');
console.log('Generated files:');
console.log('  - test-prompt-analysis.yaml (Phase 1: Analysis)');
console.log('  - test-prompt-tool-gen.yaml (Phase 2a: Tool Generation)');
console.log('  - test-prompt-response-gen.yaml (Phase 2b: Response Generation)');
console.log('\nYou can review these files to verify the prompt structure.');
