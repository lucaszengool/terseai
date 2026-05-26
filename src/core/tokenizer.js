/**
 * tokenizer.js — Fast cl100k-style token estimation
 * No external dependencies. Uses character-ratio heuristics calibrated
 * against the cl100k_base BPE tokenizer (GPT-4 / Claude family).
 */

// Model pricing: [input $/1M, output $/1M, cached $/1M]
const MODEL_PRICING = {
  // Anthropic
  'claude-opus-4-7':          [15.00,  75.00,  1.50],
  'claude-opus-4-5':          [15.00,  75.00,  1.50],
  'claude-sonnet-4-6':        [ 3.00,  15.00,  0.30],
  'claude-sonnet-4-5':        [ 3.00,  15.00,  0.30],
  'claude-haiku-4-5':         [ 0.80,   4.00,  0.08],
  'claude-haiku-3-5':         [ 0.80,   4.00,  0.08],
  // OpenAI
  'gpt-4o':                   [ 2.50,  10.00,  1.25],
  'gpt-4o-mini':              [ 0.15,   0.60,  0.075],
  'gpt-4-turbo':              [10.00,  30.00,  5.00],
  'gpt-3.5-turbo':            [ 0.50,   1.50,  0.25],
  // Fallback
  'default':                  [ 3.00,  15.00,  0.30],
};

/**
 * Count tokens in a text string using cl100k heuristics.
 *
 * Rules:
 *  - CJK characters: ~0.7 tokens each (high information density)
 *  - Code-heavy text: ~1 token per 3 chars (more subword splits)
 *  - English prose: ~1 token per 4 chars
 *  - Punctuation and numbers are counted separately
 *
 * @param {string} text
 * @returns {number} estimated token count
 */
export function countTokens(text) {
  if (!text || typeof text !== 'string') return 0;

  // CJK characters (Chinese/Japanese/Korean) tokenize very differently
  const cjkCount = (text.match(/[぀-鿿가-힯一-鿯]/g) || []).length;
  const nonCjkLen = text.length - cjkCount;

  // Detect if this is primarily code (>15% special chars like {}/;=><)
  const codeChars = (text.match(/[{}()\[\];=><|&!+\-*/%^~]/g) || []).length;
  const isCode = text.length > 0 && codeChars / text.length > 0.05;

  // Base token estimate from character count
  const charsPerToken = isCode ? 3.0 : 4.0;
  const baseTokens = Math.ceil(nonCjkLen / charsPerToken);

  // CJK: roughly 1.4 chars per token (each kanji/hanzi often its own token)
  const cjkTokens = Math.ceil(cjkCount / 1.4);

  // Bonus tokens for structural complexity
  const camelSplits = (text.match(/[a-z][A-Z]/g) || []).length;
  const numbers = (text.match(/\b\d+\b/g) || []).length;
  const structureBonus = Math.ceil(camelSplits * 0.3 + numbers * 0.2);

  return Math.max(1, baseTokens + cjkTokens + structureBonus);
}

/**
 * Count tokens for an array of chat messages.
 * Adds ~4 tokens overhead per message for role/formatting.
 *
 * @param {Array<{role: string, content: string}>} messages
 * @returns {number}
 */
export function countMessageTokens(messages) {
  if (!Array.isArray(messages)) return 0;
  // ~4 tokens per message for role/delimiters, +2 for reply priming
  const overhead = messages.length * 4 + 2;
  const content = messages.reduce((sum, m) => sum + countTokens(m.content || ''), 0);
  return overhead + content;
}

/**
 * Estimate cost for a request.
 *
 * Uses the "Effective Token" (ET) formula from GitHub Copilot research:
 *   ET = modelCostFactor × (1.0 × input + 0.1 × cached + 4.0 × output)
 *
 * The 4× output multiplier reflects that output tokens cost ~4× more than
 * input tokens on most providers.
 *
 * @param {number} inputTokens
 * @param {number} outputTokens
 * @param {number} cachedTokens  — tokens served from prompt cache (cheaper)
 * @param {string} model         — model name key
 * @returns {{ inputCost: number, outputCost: number, cachedCost: number, total: number, effectiveTokens: number }}
 */
export function estimateCost(inputTokens, outputTokens, cachedTokens = 0, model = 'default') {
  const pricing = MODEL_PRICING[model] || MODEL_PRICING['default'];
  const [inputPrice, outputPrice, cachedPrice] = pricing;

  const inputCost  = (inputTokens  / 1_000_000) * inputPrice;
  const outputCost = (outputTokens / 1_000_000) * outputPrice;
  const cachedCost = (cachedTokens / 1_000_000) * cachedPrice;

  // ET formula: normalized to input-token equivalents
  // Uses output ratio of input/output pricing as the multiplier
  const outputMultiplier = outputPrice / inputPrice; // ~4-5× for most models
  const effectiveTokens = Math.round(
    1.0 * (inputTokens - cachedTokens) +
    0.1 * cachedTokens +
    outputMultiplier * outputTokens
  );

  return {
    inputCost,
    outputCost,
    cachedCost,
    total: inputCost + outputCost + cachedCost,
    effectiveTokens,
  };
}

/**
 * List all supported models and their pricing.
 * @returns {Object}
 */
export function getModelPricing() {
  return { ...MODEL_PRICING };
}
