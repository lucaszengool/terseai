/**
 * tools/optimizer.js — Tool/schema description compressor
 *
 * Implements the "SkillReducer" approach: compress tool descriptions and
 * parameter descriptions to reduce the ~2000+ tokens that typical tool
 * schemas consume in LLM context. Target: ~48% reduction.
 *
 * Preserves: parameter names, types, required/optional flags, enum values.
 * Compresses: verbose descriptions, hedging, politeness, redundant phrasing.
 */

import { LinguisticCompressor } from '../compression/linguistic.js';
import { countTokens } from '../core/tokenizer.js';

const _compressor = new LinguisticCompressor({ mode: 'aggressive' });

// ── Tool-specific compression rules ──────────────────────────────────────

// Phrases commonly found in tool descriptions that add no information
const TOOL_FILLER_PATTERNS = [
  /\bThis (tool|function|method|action|command) (allows?|enables?|lets?|helps?|can be used to|is used to|will)\s*/gi,
  /\bUse this (to|when|for)\s*/gi,
  /\bThis parameter (specifies?|indicates?|represents?|contains?|holds?|stores?|defines?|controls?|sets?)\s*/gi,
  /\bThe (name|value|id|identifier|path|url|key) of (the |a |an )\s*/gi,
  /\bSpecify (the |a |an )\s*/gi,
  /\bProvide (the |a |an )\s*/gi,
  /\bAn? (optional|required) (parameter|field|argument|value) (that |which )?\s*/gi,
  /\bIf (not specified|not provided|omitted|not set|left empty|absent)[,.]?\s*/gi,
  /\bDefaults? to\b/gi,
  /\bMust be (one of|a valid|an? )\s*/gi,
  /\bCan be (one of|any of|either)\s*/gi,
  /\bIndicates? whether\s*/gi,
  /\bA boolean (that |which |indicating |flag that )\s*/gi,
  /\bA string (that |which |containing |representing |used (for|to) )\s*/gi,
  /\bAn? (integer|number) (that |which |representing |for )\s*/gi,
  /\bThe (maximum|minimum|total|current|target)\s+/gi,
  /\(optional\)/gi,
  /\(required\)/gi,
  /\(default: [^)]+\)/gi, // keep defaults elsewhere
];

// Parameter name → short description hint (common patterns)
const PARAM_HINTS = {
  id:          'ID',
  name:        'name',
  path:        'path',
  url:         'URL',
  query:       'query',
  limit:       'max results',
  offset:      'start offset',
  page:        'page num',
  size:        'page size',
  filter:      'filter expr',
  sort:        'sort field',
  order:       'asc/desc',
  format:      'output format',
  type:        'type',
  status:      'status',
  message:     'message text',
  content:     'content',
  data:        'payload',
  body:        'body',
  headers:     'HTTP headers',
  timeout:     'timeout ms',
  retry:       'retry count',
  verbose:     'verbose mode',
  debug:       'debug mode',
  force:       'force overwrite',
  dry_run:     'dry run',
  dryRun:      'dry run',
};

/**
 * Compress an array of tool schemas.
 * Supports both OpenAI and Anthropic tool schema formats.
 *
 * @param {Array} tools              — array of tool schema objects
 * @param {Object} [options]
 * @param {boolean} [options.aggressiveMode=false]  — also remove optional params
 * @param {boolean} [options.shortenNames=false]    — shorten parameter names (risky)
 * @param {number}  [options.maxDescLength=80]      — max chars for descriptions
 * @returns {{ tools:Array, stats:Object }}
 */
export function optimizeTools(tools, options = {}) {
  const {
    aggressiveMode = false,
    shortenNames = false,
    maxDescLength = 80,
  } = options;

  if (!Array.isArray(tools)) throw new Error('tools must be an array');

  const originalTokens = countTokens(JSON.stringify(tools));
  const optimized = tools.map(tool => optimizeTool(tool, { aggressiveMode, maxDescLength }));
  const compressedTokens = countTokens(JSON.stringify(optimized));

  const saved = originalTokens - compressedTokens;
  const ratio = originalTokens > 0 ? saved / originalTokens : 0;

  return {
    tools: optimized,
    stats: {
      originalTokens,
      compressedTokens,
      tokensSaved: saved,
      reductionPercent: Math.round(ratio * 100),
      toolCount: tools.length,
    },
  };
}

/**
 * Compress a single tool schema.
 * @param {Object} tool
 * @param {Object} options
 * @returns {Object}
 */
export function optimizeTool(tool, options = {}) {
  const { aggressiveMode = false, maxDescLength = 80 } = options;

  // Deep clone to avoid mutating the original
  const result = deepClone(tool);

  // Handle both Anthropic and OpenAI formats
  // Anthropic: { name, description, input_schema: { type, properties, required } }
  // OpenAI:    { type: 'function', function: { name, description, parameters: {...} } }

  if (result.function) {
    // OpenAI format
    if (result.function.description) {
      result.function.description = compressDescription(result.function.description, maxDescLength);
    }
    if (result.function.parameters?.properties) {
      result.function.parameters.properties = compressProperties(
        result.function.parameters.properties,
        result.function.parameters.required || [],
        aggressiveMode,
        maxDescLength,
      );
    }
  } else {
    // Anthropic format
    if (result.description) {
      result.description = compressDescription(result.description, maxDescLength);
    }
    const schema = result.input_schema || result.parameters;
    if (schema?.properties) {
      schema.properties = compressProperties(
        schema.properties,
        schema.required || [],
        aggressiveMode,
        maxDescLength,
      );
    }
  }

  return result;
}

// ── Internal ──────────────────────────────────────────────────────────────

function compressDescription(desc, maxLength) {
  if (!desc || typeof desc !== 'string') return desc;

  let result = desc;

  // Apply tool-specific filler removal
  for (const pattern of TOOL_FILLER_PATTERNS) {
    result = result.replace(pattern, '');
  }

  // Apply linguistic compression (aggressive for tool descriptions)
  result = _compressor.compress(result);

  // Truncate if still too long (preserve first sentence)
  if (result.length > maxLength) {
    const firstSentence = result.match(/^[^.!?]+[.!?]/);
    if (firstSentence && firstSentence[0].length <= maxLength) {
      result = firstSentence[0];
    } else {
      result = result.slice(0, maxLength - 1) + '…';
    }
  }

  return result.trim() || desc.slice(0, maxLength); // fallback if over-compressed
}

function compressProperties(properties, required, aggressiveMode, maxDescLength) {
  const result = {};
  for (const [key, schema] of Object.entries(properties)) {
    // In aggressive mode, skip optional parameters
    if (aggressiveMode && !required.includes(key)) continue;

    result[key] = compressPropertySchema(key, schema, maxDescLength);
  }
  return result;
}

function compressPropertySchema(name, schema, maxDescLength) {
  const result = { ...schema };

  if (result.description) {
    // Try param-specific hint first
    const hint = PARAM_HINTS[name];
    if (hint && result.description.length > hint.length + 10) {
      result.description = hint;
    } else {
      result.description = compressDescription(result.description, maxDescLength);
    }
  }

  // Recursively handle nested objects
  if (result.properties) {
    result.properties = compressProperties(
      result.properties,
      result.required || [],
      false,  // don't strip optional in nested objects
      maxDescLength,
    );
  }

  // Recursively handle array items
  if (result.items?.properties) {
    result.items = {
      ...result.items,
      properties: compressProperties(result.items.properties, [], false, maxDescLength),
    };
  }

  return result;
}

function deepClone(obj) {
  // Simple deep clone without JSON.parse/stringify to handle edge cases
  if (obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(deepClone);
  const result = {};
  for (const [k, v] of Object.entries(obj)) result[k] = deepClone(v);
  return result;
}
