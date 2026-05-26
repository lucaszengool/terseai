/**
 * selective.js — Sentence-level importance filtering
 *
 * Scores each sentence using TF-IDF-inspired heuristics (no ML deps).
 * Keeps the top-K% sentences while preserving original order.
 */

// Common transition/filler sentence starters that add no semantic value
const TRANSITION_STARTERS = new Set([
  'furthermore', 'in addition', 'additionally', 'moreover', 'also',
  'however', 'nevertheless', 'nonetheless', 'on the other hand',
  'as mentioned', 'as stated', 'as noted', 'as discussed',
  'in conclusion', 'to summarize', 'in summary', 'to recap',
  'it is worth noting', 'it should be noted', 'needless to say',
  'as you can see', 'as we can see', 'as shown above',
  'this means that', 'this shows that', 'this demonstrates that',
  'interestingly', 'importantly', 'notably',
]);

// Words that signal high-value content
const HIGH_VALUE_WORDS = new Set([
  'error', 'bug', 'fail', 'crash', 'exception', 'warning', 'critical',
  'important', 'required', 'must', 'need', 'should', 'cannot', 'problem',
  'issue', 'fix', 'solution', 'answer', 'result', 'output', 'return',
  'define', 'because', 'therefore', 'thus', 'hence', 'cause', 'effect',
  'when', 'where', 'how', 'what', 'why', 'which',
]);

/**
 * Score a single sentence for informativeness.
 *
 * @param {string} sentence
 * @param {Map<string,number>} termFrequencies  — global word→count
 * @param {number} totalDocs  — total sentence count (for IDF)
 * @param {Map<string,number>} docFrequencies   — word→sentences_containing_word
 * @returns {number} score (higher = more important)
 */
function scoreSentence(sentence, termFrequencies, totalDocs, docFrequencies) {
  const words = sentence.toLowerCase().match(/\b[a-z][a-z0-9]*\b/g) || [];
  if (words.length < 3) return -1; // penalize very short sentences

  let score = 0;
  const uniqueWords = new Set(words);

  for (const word of uniqueWords) {
    const tf = (termFrequencies.get(word) || 0) / (words.length || 1);
    const df = docFrequencies.get(word) || 1;
    const idf = Math.log((totalDocs + 1) / (df + 1));
    score += tf * idf;
  }

  // Normalize by sentence length (prefer medium-length sentences)
  score = score / Math.sqrt(words.length);

  // Boost for high-value signal words
  for (const word of words) {
    if (HIGH_VALUE_WORDS.has(word)) score += 0.3;
  }

  // Boost for numbers (often carry specific information)
  const numbers = sentence.match(/\d+/g) || [];
  score += numbers.length * 0.15;

  // Boost for named entities (capitalized words not at sentence start)
  const entities = sentence.slice(2).match(/\b[A-Z][a-zA-Z0-9]+\b/g) || [];
  score += entities.length * 0.2;

  // Penalty for transition-only sentences
  const lower = sentence.toLowerCase().trim();
  for (const starter of TRANSITION_STARTERS) {
    if (lower.startsWith(starter)) {
      score -= 0.5;
      break;
    }
  }

  // Penalty for very short sentences (< 5 words)
  if (words.length < 5) score -= 0.3;

  return score;
}

/**
 * Compress text by keeping only the most important sentences.
 *
 * @param {string} text
 * @param {number} ratio  — fraction to REMOVE (0.0 = keep all, 0.5 = keep 50%)
 * @returns {string}
 */
export function selectiveCompress(text, ratio = 0.3) {
  if (!text || ratio <= 0) return text;
  if (ratio >= 1.0) return '';

  // Split into sentences (handle multiple punctuation patterns)
  const sentencePattern = /[^.!?\n]+(?:[.!?]+(?:\s|$)|\n|$)/g;
  const rawSentences = text.match(sentencePattern) || [text];

  if (rawSentences.length <= 2) {
    // Too few sentences to selectively compress; fall back to truncation
    const keepCount = Math.max(1, Math.ceil(rawSentences.length * (1 - ratio)));
    return rawSentences.slice(0, keepCount).join('').trim();
  }

  // Build term frequency map across all sentences
  const termFrequencies = new Map();
  const docFrequencies = new Map();

  for (const sentence of rawSentences) {
    const words = sentence.toLowerCase().match(/\b[a-z][a-z0-9]*\b/g) || [];
    const seenInDoc = new Set();

    for (const word of words) {
      termFrequencies.set(word, (termFrequencies.get(word) || 0) + 1);
      if (!seenInDoc.has(word)) {
        docFrequencies.set(word, (docFrequencies.get(word) || 0) + 1);
        seenInDoc.add(word);
      }
    }
  }

  // Score each sentence
  const scored = rawSentences.map((sentence, idx) => ({
    sentence,
    idx,
    score: scoreSentence(sentence, termFrequencies, rawSentences.length, docFrequencies),
  }));

  // Determine how many to keep
  const keepCount = Math.max(1, Math.ceil(rawSentences.length * (1 - ratio)));

  // Always keep the first sentence (topic/context) and last sentence if available
  const firstIdx = 0;
  const lastIdx = rawSentences.length - 1;

  // Sort by score descending, pick top-K
  const sorted = [...scored].sort((a, b) => b.score - a.score);
  const keepIndices = new Set([firstIdx, lastIdx]);

  for (const { idx } of sorted) {
    if (keepIndices.size >= keepCount) break;
    keepIndices.add(idx);
  }

  // Reassemble in original order
  const result = scored
    .filter(({ idx }) => keepIndices.has(idx))
    .map(({ sentence }) => sentence)
    .join('')
    .trim();

  return result;
}

/**
 * Calculate the expected compression ratio for a text.
 * Useful for previewing before applying.
 *
 * @param {string} text
 * @param {number} ratio  — fraction to remove
 * @returns {{ originalSentences:number, keptSentences:number, estimatedRatio:number }}
 */
export function analyzeCompression(text, ratio = 0.3) {
  const sentences = text.match(/[^.!?\n]+(?:[.!?]+(?:\s|$)|\n|$)/g) || [];
  const kept = Math.max(1, Math.ceil(sentences.length * (1 - ratio)));
  return {
    originalSentences: sentences.length,
    keptSentences: kept,
    estimatedRatio: sentences.length > 0 ? 1 - kept / sentences.length : 0,
  };
}
