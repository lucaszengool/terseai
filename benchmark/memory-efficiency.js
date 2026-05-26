/**
 * benchmark/memory-efficiency.js
 * Benchmark working and episodic memory strategies on agent-history.json
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { WorkingMemory } from '../src/memory/working.js';
import { EpisodicMemory } from '../src/memory/episodic.js';
import { countTokens } from '../src/core/tokenizer.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(__dirname, 'fixtures');

export async function runMemoryEfficiency() {
  const history = JSON.parse(readFileSync(join(FIXTURES, 'agent-history.json'), 'utf-8'));

  // Total tokens in full history
  const totalTokens = history.reduce((s, m) => s + countTokens(m.content) + 4, 0);

  // ── Strategy 1: Full history (baseline) ──────────────────────────────────
  const fullHistory = { tokens: totalTokens, messages: history.length };

  // ── Strategy 2: Working memory (last 6 messages window) ─────────────────
  const working = new WorkingMemory({ maxTokens: 600, strategy: 'smart' });
  for (const msg of history) working.add(msg);

  const workingWindow = working.get();
  const workingTokens = working.size();

  // ── Strategy 3: Working memory truncate ─────────────────────────────────
  const workingTruncate = new WorkingMemory({ maxTokens: 600, strategy: 'truncate' });
  for (const msg of history) workingTruncate.add(msg);
  const workingTruncateTokens = workingTruncate.size();

  // ── Strategy 4: Episodic memory ──────────────────────────────────────────
  const episodic = new EpisodicMemory({ maxVerbatimTokens: 400 });
  for (const msg of history) await episodic.add(msg);

  const { summary, recent, summaryTokens, recentTokens } = episodic.get();
  const episodicTotalTokens = summaryTokens + recentTokens;

  return {
    total: history.length,
    totalTokens,
    strategies: {
      full: {
        label: 'Full history',
        tokens: totalTokens,
        messages: history.length,
        evictions: 0,
      },
      workingSmart: {
        label: `Working memory (smart, ${workingWindow.length} msgs)`,
        tokens: workingTokens,
        messages: workingWindow.length,
        evictions: working.evictionCount,
        reduction: ((totalTokens - workingTokens) / totalTokens * 100).toFixed(1),
      },
      workingTruncate: {
        label: `Working memory (truncate, ${workingTruncate.get().length} msgs)`,
        tokens: workingTruncateTokens,
        messages: workingTruncate.get().length,
        evictions: workingTruncate.evictionCount,
        reduction: ((totalTokens - workingTruncateTokens) / totalTokens * 100).toFixed(1),
      },
      episodic: {
        label: 'Episodic (extractive summary + recent)',
        tokens: episodicTotalTokens,
        summaryTokens,
        recentTokens,
        recentMessages: recent.length,
        reduction: ((totalTokens - episodicTotalTokens) / totalTokens * 100).toFixed(1),
        note: 'LLM-based summarization would further reduce summary size',
      },
    },
  };
}

// Allow running standalone
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runMemoryEfficiency().then(r => {
    console.log(`\nMemory Efficiency (${r.total} messages, ${r.totalTokens} tokens total)`);
    for (const [key, s] of Object.entries(r.strategies)) {
      const pct = s.reduction ? `(${s.reduction}% reduction)` : '(baseline)';
      console.log(`  ${s.label}: ${s.tokens} tokens ${pct}`);
    }
  });
}
