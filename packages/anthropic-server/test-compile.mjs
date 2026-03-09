import { compile } from '@moduler-prompt/core';
import { formatCompletionPrompt } from '@moduler-prompt/driver';

// Simple test module with inputs returning MaterialElement
const testModule = {
  objective: ['Test objective'],
  inputs: [
    () => ({
      type: 'material',
      id: 'test-material',
      title: 'Test Material',
      content: 'Material content'
    })
  ]
};

const compiled = compile(testModule);

console.log('=== Compiled Structure ===');
console.log(JSON.stringify(compiled, null, 2));

console.log('\n=== Formatted Prompt ===');
const formatted = formatCompletionPrompt(compiled);
console.log(formatted);
