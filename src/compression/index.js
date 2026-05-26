/**
 * compression/index.js — CompressorPipeline
 *
 * Combines linguistic, selective, and verbatim compressors into a
 * configurable pipeline with a single compress() entry point.
 */

import { LinguisticCompressor } from './linguistic.js';
import { selectiveCompress } from './selective.js';
import { verbatimCompact } from './verbatim.js';
import { countTokens } from '../core/tokenizer.js';

export { LinguisticCompressor } from './linguistic.js';
export { selectiveCompress, analyzeCompression } from './selective.js';
export { verbatimCompact, minifyJSON } from './verbatim.js';

/**
 * CompressorPipeline — runs multiple compressors in sequence
 * and tracks aggregate statistics.
 */
export class CompressorPipeline {
  /**
   * @param {Object} opts
   * @param {string}  [opts.linguistic='balanced']  — LinguisticCompressor mode
   * @param {number}  [opts.selective=0]            — selective compression ratio 0–1
   * @param {boolean} [opts.verbatim=false]         — apply verbatim compaction
   * @param {boolean} [opts.verbatimOptions]        — options for verbatimCompact
   */
  constructor({
    linguistic = 'balanced',
    selective = 0,
    verbatim = false,
    verbatimOptions = {},
  } = {}) {
    this.linguisticMode = linguistic;
    this.selectiveRatio = selective;
    this.useVerbatim = verbatim;
    this.verbatimOptions = verbatimOptions;

    this._linguisticComp = new LinguisticCompressor({ mode: linguistic });
    this._stats = { calls: 0, tokensIn: 0, tokensOut: 0 };
  }

  /**
   * Compress text through the full pipeline.
   *
   * @param {string} text
   * @returns {{ text:string, originalTokens:number, compressedTokens:number, ratio:number, stages:Array }}
   */
  compress(text) {
    if (!text) return { text: '', originalTokens: 0, compressedTokens: 0, ratio: 0, stages: [] };

    const stages = [];
    const originalTokens = countTokens(text);
    let current = text;

    // Stage 1: selective (sentence-level filtering)
    if (this.selectiveRatio > 0) {
      const before = countTokens(current);
      current = selectiveCompress(current, this.selectiveRatio);
      const after = countTokens(current);
      stages.push({ name: 'selective', tokensIn: before, tokensOut: after });
    }

    // Stage 2: verbatim code compaction
    if (this.useVerbatim) {
      const before = countTokens(current);
      current = verbatimCompact(current, this.verbatimOptions);
      const after = countTokens(current);
      stages.push({ name: 'verbatim', tokensIn: before, tokensOut: after });
    }

    // Stage 3: linguistic compression
    if (this.linguisticMode !== 'none') {
      const before = countTokens(current);
      current = this._linguisticComp.compress(current);
      const after = countTokens(current);
      stages.push({ name: 'linguistic', tokensIn: before, tokensOut: after });
    }

    const compressedTokens = countTokens(current);
    this._stats.calls++;
    this._stats.tokensIn += originalTokens;
    this._stats.tokensOut += compressedTokens;

    return {
      text: current,
      originalTokens,
      compressedTokens,
      ratio: originalTokens > 0 ? (originalTokens - compressedTokens) / originalTokens : 0,
      stages,
    };
  }

  /**
   * Cumulative stats across all compress() calls.
   */
  stats() {
    return {
      ...this._stats,
      avgRatio: this._stats.tokensIn > 0
        ? (this._stats.tokensIn - this._stats.tokensOut) / this._stats.tokensIn
        : 0,
    };
  }
}
