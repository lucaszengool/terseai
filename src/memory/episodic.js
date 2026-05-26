/**
 * episodic.js — Session-level summarization memory
 *
 * Maintains a rolling summary of older conversation turns alongside
 * verbatim recent messages. When verbatim storage exceeds the budget,
 * triggers summarization of the oldest chunk.
 *
 * Note: summarization requires a configured LLM provider.
 * Without one, falls back to extractive summarization using selective.js.
 */

import { countTokens } from '../core/tokenizer.js';
import { selectiveCompress } from '../compression/selective.js';

const SUMMARIZATION_PROMPT = `Summarize this conversation segment concisely. Preserve:
- Decisions made and conclusions reached
- Open questions and unresolved issues
- Key facts, numbers, and technical details
Discard: verbose tool outputs, redundant explanations, filler messages.
Format: bullet points. Be brief.

Conversation:`;

export class EpisodicMemory {
  /**
   * @param {Object} opts
   * @param {number} [opts.maxVerbatimTokens=2000]  — when exceeded, triggers summarization
   * @param {string} [opts.summaryModel]            — model to use for summarization
   * @param {Object} [opts.provider]               — provider instance (optional)
   */
  constructor({ maxVerbatimTokens = 2000, summaryModel, provider } = {}) {
    this.maxVerbatimTokens = maxVerbatimTokens;
    this.summaryModel = summaryModel || 'claude-haiku-4-5';
    this._provider = provider || null;

    this._summary = '';         // rolling summary of old turns
    this._summaryTokens = 0;
    this._recent = [];          // verbatim recent messages
    this._recentTokens = 0;
    this._summarizationCount = 0;
  }

  /**
   * Add a message to episodic memory.
   * Triggers summarization if verbatim storage exceeds budget.
   *
   * @param {{ role:string, content:string }} message
   */
  async add(message) {
    const tokens = countTokens(message.content || '') + 4;
    this._recent.push({ ...message });
    this._recentTokens += tokens;

    if (this._recentTokens > this.maxVerbatimTokens) {
      await this._summarizeOldest();
    }
  }

  /**
   * Get the current memory state.
   * @returns {{ summary:string, recent:Array, summaryTokens:number, recentTokens:number }}
   */
  get() {
    return {
      summary: this._summary,
      recent: [...this._recent],
      summaryTokens: this._summaryTokens,
      recentTokens: this._recentTokens,
    };
  }

  /**
   * Get messages ready for LLM context injection.
   * Returns: [summary message (if any), ...recent messages]
   *
   * @returns {Array<{role:string,content:string}>}
   */
  getContextMessages() {
    const messages = [];
    if (this._summary) {
      messages.push({
        role: 'user',
        content: `[Earlier conversation summary]\n${this._summary}`,
      });
      messages.push({
        role: 'assistant',
        content: 'Understood. I have the context from our earlier conversation.',
      });
    }
    messages.push(...this._recent);
    return messages;
  }

  /**
   * Force immediate summarization of all verbatim messages.
   */
  async flush() {
    if (this._recent.length > 0) {
      await this._summarizeChunk(this._recent);
      this._recent = [];
      this._recentTokens = 0;
    }
  }

  /**
   * Total tokens in memory (summary + recent).
   */
  totalTokens() {
    return this._summaryTokens + this._recentTokens;
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  async _summarizeOldest() {
    // Take the oldest half of recent messages for summarization
    const chunkSize = Math.ceil(this._recent.length / 2);
    const chunk = this._recent.splice(0, chunkSize);
    this._recentTokens = this._recent.reduce(
      (sum, m) => sum + countTokens(m.content || '') + 4, 0
    );
    await this._summarizeChunk(chunk);
    this._summarizationCount++;
  }

  async _summarizeChunk(messages) {
    let newSummaryText;

    if (this._provider) {
      // Use LLM for high-quality summarization
      try {
        const prompt = messages
          .map(m => `${m.role}: ${m.content}`)
          .join('\n\n');

        const result = await this._provider.chat([
          { role: 'user', content: `${SUMMARIZATION_PROMPT}\n\n${prompt}` },
        ], { model: this.summaryModel, maxTokens: 300 });

        newSummaryText = result.content;
      } catch (err) {
        // Fall back to extractive
        newSummaryText = this._extractiveSummary(messages);
      }
    } else {
      // No LLM provider — use extractive summarization
      newSummaryText = this._extractiveSummary(messages);
    }

    // Merge with existing summary
    if (this._summary) {
      this._summary = `${this._summary}\n\n${newSummaryText}`;
    } else {
      this._summary = newSummaryText;
    }

    this._summaryTokens = countTokens(this._summary);
  }

  _extractiveSummary(messages) {
    // Without LLM, extract key sentences using selective compression
    const text = messages
      .filter(m => m.role !== 'system')
      .map(m => `[${m.role}] ${m.content}`)
      .join('\n\n');

    return selectiveCompress(text, 0.6); // keep 40% of sentences
  }
}
