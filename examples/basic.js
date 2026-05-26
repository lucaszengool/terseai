/**
 * examples/basic.js — Simple optimized chat call
 *
 * Run: ANTHROPIC_API_KEY=sk-... node examples/basic.js
 */

import { TerseContext, countTokens } from '../src/index.js';

// A verbose, unoptimized user message (as a developer might write it)
const verboseMessage = `Hello! I hope you're doing well today. I was wondering if you could
please help me understand something that I'm kind of confused about. Basically, I'm trying
to understand how recursion works in programming, and I think I might need a simple example
to really grasp the concept. I would really appreciate it if you could provide a clear and
concise explanation with maybe a simple code example in JavaScript. Thank you so much in advance!`;

async function main() {
  console.log('TERSE FRAMEWORK — Basic Example\n');

  // Show what compression does before making the call
  const ctx = new TerseContext({
    model: 'claude-sonnet-4-6',
    budget: 4000,
    compression: 'balanced',
    memory: 'working',
    // apiKey: process.env.ANTHROPIC_API_KEY,  // uncomment to make real call
  });

  const original = countTokens(verboseMessage);
  const { text: compressed, ratio } = ctx.compress(verboseMessage);
  const after = countTokens(compressed);

  console.log(`Original message (${original} tokens):`);
  console.log('─'.repeat(60));
  console.log(verboseMessage.trim());
  console.log();

  console.log(`Compressed message (${after} tokens, ${(ratio * 100).toFixed(1)}% reduction):`);
  console.log('─'.repeat(60));
  console.log(compressed);
  console.log();

  // Make the actual chat call (dry-run without API key)
  const messages = [{ role: 'user', content: verboseMessage }];

  console.log('Making chat call (dry-run — set apiKey for real call)...');
  const result = await ctx.chat(messages);

  console.log('\nResult:', result.content);
  console.log('\nStats:', ctx.stats());
}

main().catch(console.error);
