/**
 * router.js — Multi-model cost router
 *
 * Classifies tasks and routes them to the cheapest model capable of
 * handling that complexity tier. No LLM calls needed — classification
 * uses heuristics on the message content.
 */

import { countTokens } from '../core/tokenizer.js';
import { estimateCost } from '../core/tokenizer.js';

// Default routing table: complexity → model
const DEFAULT_ROUTE_MAP = {
  simple:   'claude-haiku-4-5',
  moderate: 'claude-sonnet-4-6',
  complex:  'claude-opus-4-7',
};

// Words/patterns that signal high complexity
const COMPLEXITY_SIGNALS = {
  high: [
    /\banalyze\b/i, /\bcompare\b/i, /\bevaluate\b/i, /\bdesign\b/i,
    /\barchitecture\b/i, /\brefactor\b/i, /\boptimize\b/i, /\bdebug\b/i,
    /\bexplain.*why\b/i, /\bhow does\b/i, /\bimplications\b/i,
    /\btrade.?offs?\b/i, /\bpros and cons\b/i, /\breview\b/i,
    /\bstrategy\b/i, /\bplan\b/i, /\bresearch\b/i, /\bimplement\b/i,
    /```[\s\S]+```/,  // contains code blocks
    /\bstep.by.step\b/i, /\bwalk me through\b/i,
    /\bmathemati/i, /\bequation\b/i, /\bformula\b/i, /\bproof\b/i,
    /\bthoroughly\b/i, /\bcomprehensive\b/i, /\bcomplete\b.*\bsolution\b/i,
  ],
  low: [
    /^(hi|hello|hey)\b/i,
    /^(what|who|when|where)\b.{0,30}\?$/i,
    /^(yes|no|ok|sure|thanks)/i,
    /^translate\b/i,
    /^summarize\b.{0,60}$/i,
    /^list\b.{0,60}$/i,
    /^what is\b.{0,50}\?$/i,
    /^define\b/i,
  ],
};

// Pricing reference for "if we used complex for everything" comparison
const COMPLEX_MODEL_PRICING = { input: 15.00, output: 75.00 }; // per 1M tokens
const DEFAULT_OUTPUT_RATIO  = 0.25; // assume output ≈ 25% of input length

export class ModelRouter {
  /**
   * @param {Object} [opts]
   * @param {Object} [opts.routeMap]   — override: { simple, moderate, complex } → model name
   * @param {number} [opts.avgOutputTokens=200]  — assumed output per request for cost calc
   */
  constructor({ routeMap, avgOutputTokens = 200 } = {}) {
    this.routeMap = { ...DEFAULT_ROUTE_MAP, ...(routeMap || {}) };
    this.avgOutputTokens = avgOutputTokens;

    // Cumulative stats
    this._routes = [];
    this._totalInputTokens = 0;
    this._totalCostActual = 0;
    this._totalCostIfComplex = 0;
  }

  /**
   * Classify a set of messages and return the recommended model.
   *
   * @param {Array<{role:string,content:string}>} messages
   * @returns {{ model:string, tier:'simple'|'moderate'|'complex', reason:string, estimatedCost:number }}
   */
  route(messages) {
    const text = messages.map(m => m.content || '').join('\n');
    const inputTokens = messages.reduce((s, m) => s + countTokens(m.content || ''), 0);

    const { tier, reason } = this._classify(text, inputTokens);
    const model = this.routeMap[tier];

    // Estimate cost for this request
    const costResult = estimateCost(inputTokens, this.avgOutputTokens, 0, model);
    const complexCost = estimateCost(inputTokens, this.avgOutputTokens, 0, this.routeMap.complex);

    // Track stats
    this._routes.push({ tier, model, inputTokens, cost: costResult.total });
    this._totalInputTokens += inputTokens;
    this._totalCostActual += costResult.total;
    this._totalCostIfComplex += complexCost.total;

    return {
      model,
      tier,
      reason,
      estimatedCost: costResult.total,
      inputTokens,
    };
  }

  /**
   * Cost savings from routing vs. always using the complex model.
   * @returns {{ actualCost:number, complexCost:number, saved:number, savedPercent:number, breakdown:Object }}
   */
  savings() {
    const saved = this._totalCostIfComplex - this._totalCostActual;
    const pct = this._totalCostIfComplex > 0
      ? Math.round((saved / this._totalCostIfComplex) * 100)
      : 0;

    // Count by tier
    const breakdown = { simple: 0, moderate: 0, complex: 0 };
    for (const r of this._routes) breakdown[r.tier]++;

    return {
      requests: this._routes.length,
      actualCost: this._totalCostActual,
      complexCost: this._totalCostIfComplex,
      saved,
      savedPercent: pct,
      breakdown,
    };
  }

  /**
   * Reset accumulated stats.
   */
  reset() {
    this._routes = [];
    this._totalInputTokens = 0;
    this._totalCostActual = 0;
    this._totalCostIfComplex = 0;
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  _classify(text, tokenCount) {
    // Token count heuristics
    if (tokenCount > 500) {
      return { tier: 'complex', reason: `large input (${tokenCount} tokens)` };
    }
    if (tokenCount < 50) {
      // Short inputs are usually simple — but check for complex keywords
      const hasComplexSignal = COMPLEXITY_SIGNALS.high.some(p => p.test(text));
      if (!hasComplexSignal) {
        return { tier: 'simple', reason: `short input (${tokenCount} tokens)` };
      }
    }

    // Check for explicit low-complexity patterns first
    const simpleMatch = COMPLEXITY_SIGNALS.low.find(p => p.test(text.trim()));
    if (simpleMatch) {
      return { tier: 'simple', reason: 'simple query pattern' };
    }

    // Check for high-complexity signals
    const complexMatches = COMPLEXITY_SIGNALS.high.filter(p => p.test(text));
    if (complexMatches.length >= 2) {
      return { tier: 'complex', reason: `${complexMatches.length} complexity signals` };
    }
    if (complexMatches.length === 1) {
      // One complex signal + moderate token count → moderate
      return tokenCount > 200
        ? { tier: 'complex', reason: 'complexity signal + large input' }
        : { tier: 'moderate', reason: 'single complexity signal' };
    }

    // Code detection
    if (/```/.test(text) || /\bfunction\b|\bconst\b|\bclass\b/.test(text)) {
      return { tier: 'complex', reason: 'contains code' };
    }

    // Default: moderate
    return { tier: 'moderate', reason: 'default classification' };
  }
}
