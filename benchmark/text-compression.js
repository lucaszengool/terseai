/**
 * benchmark/text-compression.js
 * Benchmark linguistic + verbatim compression on the fixture files.
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { LinguisticCompressor } from '../src/compression/linguistic.js';
import { verbatimCompact } from '../src/compression/verbatim.js';
import { countTokens } from '../src/core/tokenizer.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(__dirname, 'fixtures');

function loadFixture(name) {
  return readFileSync(join(FIXTURES, name), 'utf-8');
}

export function runTextCompression() {
  const results = [];

  // ── Long prompt ──────────────────────────────────────────────────────────
  const longPrompt = loadFixture('long-prompt.txt');
  const lpOriginal = countTokens(longPrompt);

  const lpModes = ['light', 'balanced', 'aggressive'];
  const lpResults = {};

  for (const mode of lpModes) {
    const comp = new LinguisticCompressor({ mode });
    const compressed = comp.compress(longPrompt);
    const tokens = countTokens(compressed);
    lpResults[mode] = { original: lpOriginal, compressed: tokens, text: compressed };
  }

  results.push({ fixture: 'long-prompt.txt', original: lpOriginal, modes: lpResults });

  // ── Code context ─────────────────────────────────────────────────────────
  const codeCtx = loadFixture('code-context.txt');
  const ccOriginal = countTokens(codeCtx);

  const ccModes = ['light', 'balanced'];
  const ccResults = {};

  for (const mode of ccModes) {
    const comp = new LinguisticCompressor({ mode });
    const compressed = comp.compress(codeCtx);
    const tokens = countTokens(compressed);
    ccResults[mode] = { original: ccOriginal, compressed: tokens };
  }

  // Verbatim compaction (code-safe)
  const verbatim = verbatimCompact(codeCtx, { stripComments: true, removeDuplicateImports: true });
  const verbatimTokens = countTokens(verbatim);
  ccResults['verbatim'] = { original: ccOriginal, compressed: verbatimTokens };

  results.push({ fixture: 'code-context.txt', original: ccOriginal, modes: ccResults });

  return results;
}

// Allow running standalone
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const results = runTextCompression();
  for (const r of results) {
    console.log(`\n${r.fixture} (${r.original} tokens)`);
    for (const [mode, data] of Object.entries(r.modes)) {
      const pct = ((data.original - data.compressed) / data.original * 100).toFixed(1);
      console.log(`  ${mode.padEnd(12)}: ${data.original} → ${data.compressed} tokens  (${pct}% reduction)`);
    }
  }
}
