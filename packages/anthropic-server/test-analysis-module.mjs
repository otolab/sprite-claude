import { compile } from '@moduler-prompt/core';
import { formatCompletionPrompt } from '@moduler-prompt/driver';
import { analysisModule } from './dist/prompts/analysis-module.js';

const ctx = {
  tools: [{
    name: 'test_tool',
    description: 'Test tool description'
  }],
  messages: []
};

const compiled = compile(analysisModule, ctx);

console.log('=== Compiled Structure (inputs section) ===');
console.log(JSON.stringify(compiled.data, null, 2));

console.log('\n=== Section Headers ===');
const formatted = formatCompletionPrompt(compiled);
const headers = formatted.split('\n').filter(line => line.match(/^##?\s+/));
headers.forEach(h => console.log(h));
