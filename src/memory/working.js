/**
 * working.js — Sliding window context manager
 *
 * Maintains a token-budgeted window of recent messages.
 * Supports three eviction strategies:
 *   - 'truncate': drop oldest messages (simple, lossless for recent)
 *   - 'summarize': placeholder for LLM-based summarization
 *   - 'smart': always keep system message + first user message + last N turns
 */

import { countTokens } from '../core/tokenizer.js';

export class WorkingMemory {
  /**
   * @param {Object} opts
   * @param {number} [opts.maxTokens=4000]
   * @param {string} [opts.strategy='smart']  'truncate'|'summarize'|'smart'
   */
  constructor({ maxTokens = 4000, strategy = 'smart' } = {}) {
    this.maxTokens = maxTokens;
    this.strategy = strategy;

    this._messages = [];
    this._tokenCounts = []; // parallel array: tokens per message
    this._totalTokens = 0;
    this.evictionCount = 0;
  }

  /**
   * Add a message to working memory.
   * Automatically evicts if over budget.
   *
   * @param {{ role:string, content:string }} message
   */
  add(message) {
    const tokens = countTokens(message.content || '') + 4; // +4 for role overhead
    this._messages.push({ ...message });
    this._tokenCounts.push(tokens);
    this._totalTokens += tokens;

    // Evict if over budget
    while (this._totalTokens > this.maxTokens && this._messages.length > 1) {
      this._evict();
    }
  }

  /**
   * Get the current message window.
   * @returns {Array<{role:string,content:string}>}
   */
  get() {
    return [...this._messages];
  }

  /**
   * Current token count of the window.
   * @returns {number}
   */
  size() {
    return this._totalTokens;
  }

  /**
   * Clear all messages.
   */
  clear() {
    this._messages = [];
    this._tokenCounts = [];
    this._totalTokens = 0;
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  _evict() {
    switch (this.strategy) {
      case 'truncate':
        this._evictOldest();
        break;

      case 'smart':
        this._evictSmart();
        break;

      case 'summarize':
        // Summarization requires an LLM call — fall back to smart eviction
        // In a real implementation, this would batch messages and call the provider
        this._evictSmart();
        break;

      default:
        this._evictOldest();
    }
    this.evictionCount++;
  }

  _evictOldest() {
    if (this._messages.length === 0) return;
    const tokens = this._tokenCounts.shift();
    this._messages.shift();
    this._totalTokens -= tokens;
  }

  _evictSmart() {
    // Smart strategy:
    // 1. Always keep system messages
    // 2. Always keep the first user message (task context)
    // 3. Drop the oldest non-system, non-first message

    const systemIndices = [];
    const firstUserIdx = this._messages.findIndex(m => m.role === 'user');

    for (let i = 0; i < this._messages.length; i++) {
      if (this._messages[i].role === 'system') systemIndices.push(i);
    }

    const protectedIndices = new Set([...systemIndices]);
    if (firstUserIdx >= 0) protectedIndices.add(firstUserIdx);

    // Find the oldest non-protected message
    for (let i = 0; i < this._messages.length; i++) {
      if (!protectedIndices.has(i)) {
        const tokens = this._tokenCounts[i];
        this._messages.splice(i, 1);
        this._tokenCounts.splice(i, 1);
        this._totalTokens -= tokens;
        return;
      }
    }

    // If all messages are protected, fall back to dropping the oldest
    this._evictOldest();
  }
}
