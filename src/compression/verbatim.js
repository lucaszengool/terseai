/**
 * verbatim.js — Zero-hallucination compaction for code and structured data
 *
 * Strips comments and normalizes whitespace WITHOUT modifying:
 *   - string literals
 *   - variable/function names
 *   - logic or structure
 *   - JSDoc / type annotations
 */

/**
 * Compact code or structured text while preserving all semantics.
 *
 * @param {string} text
 * @param {Object} [options]
 * @param {boolean} [options.stripComments=true]     — remove // and # comments
 * @param {boolean} [options.stripJSDoc=false]       — also remove /** ... * / blocks
 * @param {boolean} [options.removeDuplicateImports=true]
 * @param {boolean} [options.collapseBlankLines=true]
 * @param {boolean} [options.minifyJSON=false]       — if pure JSON, minify it
 * @returns {string}
 */
export function verbatimCompact(text, options = {}) {
  const {
    stripComments = true,
    stripJSDoc = false,
    removeDuplicateImports = true,
    collapseBlankLines = true,
    minifyJSON = false,
  } = options;

  if (!text || typeof text !== 'string') return text;

  // Try JSON minification if requested
  if (minifyJSON) {
    const jsonResult = tryMinifyJSON(text);
    if (jsonResult !== null) return jsonResult;
  }

  // Protect string literals from modification
  const { text: safe, strings: stringMap } = protectStrings(text);
  let result = safe;

  if (stripComments) {
    // Remove block comments /* ... */ (but NOT JSDoc /** ... */ unless stripJSDoc)
    if (stripJSDoc) {
      result = result.replace(/\/\*[\s\S]*?\*\//g, '');
    } else {
      // Keep JSDoc (/** ... */), strip regular block comments (/* ... */)
      result = result.replace(/\/\*(?!\*[\s\S])[\s\S]*?\*\//g, '');
    }

    // Remove single-line comments // ... (but not URLs like https://)
    // Preserve shebang lines (#!)
    result = result.replace(/(?<!:)\/\/(?!\/)(?!#)[^\n]*/g, '');

    // Remove Python/Shell # comments (only when line starts with optional whitespace then #)
    // Don't strip shebangs
    result = result.replace(/^(\s*)#(?!!)([^\n]*)/gm, '$1');
  }

  if (removeDuplicateImports) {
    result = deduplicateImports(result);
  }

  if (collapseBlankLines) {
    // Collapse 3+ consecutive blank lines to max 1
    result = result.replace(/\n{3,}/g, '\n\n');
    // Strip trailing whitespace from each line
    result = result.replace(/[ \t]+$/gm, '');
  }

  // Restore string literals
  result = restoreStrings(result, stringMap);

  return result.trim();
}

/**
 * Minify JSON: remove all whitespace formatting.
 * Returns the minified string, or null if the input is not valid JSON.
 *
 * @param {string} text
 * @returns {string|null}
 */
export function minifyJSON(text) {
  return tryMinifyJSON(text.trim());
}

// ── Internal helpers ──────────────────────────────────────────────────────

function tryMinifyJSON(text) {
  const trimmed = text.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null;
  try {
    return JSON.stringify(JSON.parse(trimmed));
  } catch {
    return null;
  }
}

/**
 * Temporarily replace string literals with placeholders to protect them.
 */
function protectStrings(text) {
  const strings = new Map();
  let counter = 0;

  // Protect template literals first (backtick strings)
  let result = text.replace(/`(?:[^`\\]|\\.|\n)*`/g, m => {
    const key = `\x00STR_${counter++}\x00`;
    strings.set(key, m);
    return key;
  });

  // Protect double-quoted strings (handle escaped quotes)
  result = result.replace(/"(?:[^"\\]|\\.)*"/g, m => {
    const key = `\x00STR_${counter++}\x00`;
    strings.set(key, m);
    return key;
  });

  // Protect single-quoted strings
  result = result.replace(/'(?:[^'\\]|\\.)*'/g, m => {
    const key = `\x00STR_${counter++}\x00`;
    strings.set(key, m);
    return key;
  });

  return { text: result, strings };
}

function restoreStrings(text, strings) {
  let result = text;
  for (const [key, value] of strings) {
    result = result.replace(key, value);
  }
  return result;
}

/**
 * Remove duplicate import lines (same import path appearing twice).
 * Handles ES module imports and CommonJS require() calls.
 */
function deduplicateImports(text) {
  const lines = text.split('\n');
  const seenImports = new Set();
  const result = [];

  for (const line of lines) {
    const trimmed = line.trim();

    // Match: import ... from '...' / import '...'
    const esImport = trimmed.match(/^import\s+.*\s+from\s+(['"`])(.*?)\1/);
    const esBarImport = trimmed.match(/^import\s+(['"`])(.*?)\1/);
    // Match: const/let/var ... = require('...')
    const cjsImport = trimmed.match(/(?:const|let|var)\s+.*=\s+require\s*\(\s*(['"`])(.*?)\1\s*\)/);

    const importKey = (esImport && `import:${esImport[2]}`) ||
                      (esBarImport && `import:${esBarImport[2]}`) ||
                      (cjsImport && `require:${cjsImport[2]}`);

    if (importKey) {
      if (seenImports.has(importKey)) {
        // Skip duplicate — but keep the first occurrence
        continue;
      }
      seenImports.add(importKey);
    }

    result.push(line);
  }

  return result.join('\n');
}
