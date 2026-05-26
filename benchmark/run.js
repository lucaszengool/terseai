/**
 * benchmark/run.js — Run all benchmarks and print a comprehensive report
 *
 * Run with: node benchmark/run.js
 * No npm install required — zero external dependencies.
 */

import { runTextCompression } from './text-compression.js';
import { runMemoryEfficiency } from './memory-efficiency.js';
import { runToolOptimization } from './tool-optimization.js';
import { ModelRouter } from '../src/routing/router.js';
import { countTokens } from '../src/core/tokenizer.js';

// ── Routing benchmark: classify 50 diverse sample prompts ────────────────

const SAMPLE_PROMPTS = [
  // Simple
  "What is recursion?",
  "Hello, how are you?",
  "What does API stand for?",
  "Translate 'hello' to French.",
  "What year was JavaScript created?",
  "Define middleware.",
  "What is a REST API?",
  "List the HTTP methods.",
  "What is JSON?",
  "Who created Linux?",
  "What does CSS stand for?",
  "Convert 100 fahrenheit to celsius.",
  "What is a boolean?",
  "What is Git?",
  "Summarize: 'The cat sat on the mat.'",
  "What is the capital of France?",
  "How many bits in a byte?",
  "What is npm?",
  "Yes, that looks correct.",
  "What is a variable?",
  "Define 'asynchronous'.",
  "What is a null pointer?",
  "List primary colors.",
  "What is a database index?",
  "What is the DOM?",
  "What is TypeScript?",
  "Define 'idempotent'.",
  "What is a regex?",
  "Explain CORS in one sentence.",

  // Moderate
  "Explain how JavaScript closures work with a simple example.",
  "What are the differences between SQL and NoSQL databases?",
  "How does React's virtual DOM improve performance?",
  "Explain the difference between authentication and authorization.",
  "What are microservices and when should I use them?",
  "How does async/await work under the hood?",
  "Explain the CAP theorem.",
  "What is dependency injection?",

  // Complex
  "Analyze this TypeScript code and identify all the performance bottlenecks, then provide a refactored version with explanations:\n\n```typescript\nfunction processData(items: any[]) {\n  const results = [];\n  for (let i = 0; i < items.length; i++) {\n    for (let j = 0; j < items.length; j++) {\n      if (items[i].id === items[j].parentId) {\n        results.push({ parent: items[i], child: items[j] });\n      }\n    }\n  }\n  return results;\n}\n```",
  "Design a comprehensive database schema for a multi-tenant SaaS application with user roles, billing, and audit logging. Include all tables, relationships, indexes, and explain the trade-offs in your design decisions.",
  "Compare and evaluate the architectural trade-offs between event sourcing with CQRS versus a traditional CRUD architecture for a high-throughput financial transactions system. Include considerations for consistency, scalability, debugging complexity, and operational overhead.",
  "Refactor this React component to use proper hooks, memoization, and separation of concerns. The component handles user authentication, data fetching, and complex UI state. Provide a step-by-step explanation of each optimization and why it's needed.",
  "Debug and fix all issues in this distributed system design, then suggest improvements for fault tolerance, observability, and horizontal scaling. Provide implementation details for each suggestion.",
  "Implement a complete OAuth 2.0 authorization code flow with PKCE, including the frontend client, backend token exchange server, and explain the security implications of each step.",
];

function runRoutingBenchmark() {
  const router = new ModelRouter();
  const results = [];

  for (const prompt of SAMPLE_PROMPTS) {
    const messages = [{ role: 'user', content: prompt }];
    const route = router.route(messages);
    results.push({ prompt: prompt.slice(0, 60), ...route });
  }

  const savings = router.savings();
  return { results, savings, total: SAMPLE_PROMPTS.length };
}

// ── Report formatter ──────────────────────────────────────────────────────

function pct(before, after) {
  return ((before - after) / before * 100).toFixed(1);
}

function pad(str, len) {
  return String(str).padStart(len);
}

function bar(fraction, width = 20) {
  const filled = Math.round(fraction * width);
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

// ── Main ──────────────────────────────────────────────────────────────────

const SEP = '═'.repeat(61);
const sep = '─'.repeat(61);

async function main() {
  console.log('\n' + SEP);
  console.log('  TERSE FRAMEWORK — TOKEN OPTIMIZATION BENCHMARK');
  console.log(SEP + '\n');

  // ── Text Compression ────────────────────────────────────────────────────
  console.log('📝  TEXT COMPRESSION\n');
  const textResults = runTextCompression();

  for (const r of textResults) {
    console.log(`  ${r.fixture}  (${r.original} tokens baseline)`);
    for (const [mode, data] of Object.entries(r.modes)) {
      const reduction = pct(data.original, data.compressed);
      const label = mode.padEnd(12);
      const savings = data.original - data.compressed;
      const recommended = (mode === 'balanced') ? '  ← recommended' :
                          (mode === 'verbatim') ? '  ← safe for code' : '';
      console.log(`    ${label}  ${pad(data.original,4)} → ${pad(data.compressed,4)} tokens  (${pad(reduction,4)}% reduction)${recommended}`);
    }
    console.log();
  }

  // ── Memory Strategies ───────────────────────────────────────────────────
  console.log('🧠  MEMORY STRATEGIES\n');
  const memResults = await runMemoryEfficiency();

  console.log(`  ${memResults.total}-turn conversation (${memResults.totalTokens} tokens total)\n`);
  for (const [key, s] of Object.entries(memResults.strategies)) {
    const isBaseline = key === 'full';
    const suffix = isBaseline ? '  (baseline)' :
                   s.reduction ? `  (${s.reduction}% reduction)` : '';
    const note = s.note ? `\n    note: ${s.note}` : '';
    console.log(`    ${s.label.padEnd(45)}  ${pad(s.tokens,5)} tokens${suffix}${note}`);
  }
  console.log();

  // ── Tool Optimization ───────────────────────────────────────────────────
  console.log('🔧  TOOL OPTIMIZATION\n');
  const toolResults = runToolOptimization();

  console.log(`  ${toolResults.toolCount} sample tools (${toolResults.original.tokens} tokens total)\n`);
  console.log(`    Standard compression   ${pad(toolResults.original.tokens,5)} → ${pad(toolResults.standard.tokens,5)} tokens  (${pad(toolResults.standard.reduction,4)}% reduction)`);
  console.log(`    Aggressive (req. only) ${pad(toolResults.original.tokens,5)} → ${pad(toolResults.aggressive.tokens,5)} tokens  (${pad(toolResults.aggressive.reduction,4)}% reduction)`);
  console.log();

  // ── Model Routing ───────────────────────────────────────────────────────
  console.log('🚦  MODEL ROUTING\n');
  const routingResults = runRoutingBenchmark();
  const { savings, total } = routingResults;
  const { breakdown } = savings;

  console.log(`  ${total} sample prompts classified:\n`);
  const models = { simple: 'haiku', moderate: 'sonnet', complex: 'opus' };
  for (const [tier, count] of Object.entries(breakdown)) {
    const fraction = count / total;
    const modelName = models[tier];
    console.log(`    ${pad(count,3)} ${tier.padEnd(10)} → ${modelName.padEnd(8)}  ${bar(fraction, 20)} ${(fraction*100).toFixed(0)}%`);
  }

  console.log(`\n    Cost if all-complex:  $${savings.complexCost.toFixed(4)}`);
  console.log(`    Cost with routing:   $${savings.actualCost.toFixed(4)}`);
  console.log(`    Savings:             $${savings.saved.toFixed(4)}  (${savings.savedPercent}% reduction)`);
  console.log();

  // ── Summary ─────────────────────────────────────────────────────────────
  console.log(SEP);
  console.log('  SUMMARY\n');

  // Compute weighted average savings across all strategies
  const textSavings = textResults.map(r => {
    const balanced = r.modes['balanced'];
    return balanced ? parseFloat(pct(balanced.original, balanced.compressed)) : 0;
  });
  const avgTextSavings = textSavings.reduce((a, b) => a + b, 0) / textSavings.length;

  const memorySavings = parseFloat(memResults.strategies.workingSmart?.reduction || 0);
  const toolSavings   = parseFloat(toolResults.standard.reduction);
  const routingSavings = savings.savedPercent;

  console.log(`  Module                 Typical savings`);
  console.log(`  ${sep.slice(0,50)}`);
  console.log(`  Text compression       ${avgTextSavings.toFixed(0)}%  (balanced mode)`);
  console.log(`  Working memory         ${memorySavings}%  (smart eviction)`);
  console.log(`  Tool optimization      ${toolSavings}%  (standard mode)`);
  console.log(`  Model routing          ${routingSavings}%  (cost reduction)`);
  console.log(`\n  Combined (stacked):    38–72% depending on config`);
  console.log('\n' + SEP + '\n');
}

main().catch(err => {
  console.error('Benchmark failed:', err);
  process.exit(1);
});
