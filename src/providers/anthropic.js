/**
 * providers/anthropic.js — Anthropic SDK wrapper
 *
 * Thin wrapper that intercepts requests/responses to track token usage,
 * integrate with TokenBudget, and detect prompt caching opportunities.
 */

import { estimateCost } from '../core/tokenizer.js';

export class AnthropicProvider {
  /**
   * @param {Object} opts
   * @param {string} opts.apiKey
   * @param {Object} [opts.budget]  — TokenBudget instance
   * @param {string} [opts.defaultModel='claude-sonnet-4-6']
   */
  constructor({ apiKey, budget, defaultModel = 'claude-sonnet-4-6' } = {}) {
    this.apiKey = apiKey;
    this.budget = budget;
    this.defaultModel = defaultModel;
    this._client = null;
  }

  /**
   * Send a chat request via the Anthropic SDK.
   *
   * @param {Array<{role:string,content:string}>} messages
   * @param {Object} [options]
   * @returns {Promise<{content:string, usage:{input,output,cached,cost}, model:string}>}
   */
  async chat(messages, options = {}) {
    const client = this._getClient();
    const model = options.model || this.defaultModel;
    const maxTokens = options.maxTokens || options.max_tokens || 1024;

    // Separate system messages from conversation
    const systemMessages = messages.filter(m => m.role === 'system');
    const conversationMessages = messages.filter(m => m.role !== 'system');

    // Build system prompt string
    const systemPrompt = systemMessages.map(m => m.content).join('\n\n') || undefined;

    // Detect cacheable system prompts (long, static content)
    let systemParam = systemPrompt;
    if (systemPrompt && systemPrompt.length > 500) {
      // Mark as cacheable via Anthropic's prompt caching API
      systemParam = [
        {
          type: 'text',
          text: systemPrompt,
          cache_control: { type: 'ephemeral' },
        },
      ];
    }

    const requestParams = {
      model,
      max_tokens: maxTokens,
      messages: conversationMessages.map(m => ({
        role: m.role,
        content: m.content,
      })),
      ...(systemParam ? { system: systemParam } : {}),
    };

    if (options.tools) requestParams.tools = options.tools;
    if (options.temperature !== undefined) requestParams.temperature = options.temperature;

    try {
      const response = await client.messages.create(requestParams);

      const usage = response.usage || {};
      const inputTokens  = usage.input_tokens  || 0;
      const outputTokens = usage.output_tokens || 0;
      const cachedTokens = usage.cache_read_input_tokens || 0;

      const costInfo = estimateCost(inputTokens, outputTokens, cachedTokens, model);

      // Update budget if configured
      if (this.budget) {
        this.budget.consume('input', inputTokens - cachedTokens);
        this.budget.consume('cached', cachedTokens);
        this.budget.consume('output', outputTokens);
      }

      const content = response.content?.[0]?.text || '';

      return {
        content,
        usage: {
          input: inputTokens,
          output: outputTokens,
          cached: cachedTokens,
          cost: costInfo.total,
        },
        model: response.model || model,
        stopReason: response.stop_reason,
      };

    } catch (err) {
      // Provide helpful error messages
      if (err.status === 401) {
        throw new Error(`Anthropic API key invalid. Check your ANTHROPIC_API_KEY. (${err.message})`);
      }
      if (err.status === 429) {
        throw new Error(`Anthropic rate limit exceeded. (${err.message})`);
      }
      throw err;
    }
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  _getClient() {
    if (this._client) return this._client;

    let Anthropic;
    try {
      // Dynamic import — peer dependency
      const mod = await_sync_require('@anthropic-ai/sdk');
      Anthropic = mod.default || mod.Anthropic || mod;
    } catch (err) {
      throw new Error(
        'Install @anthropic-ai/sdk to use the Anthropic provider:\n  npm install @anthropic-ai/sdk'
      );
    }

    this._client = new Anthropic({ apiKey: this.apiKey });
    return this._client;
  }
}

// Synchronous require wrapper for ESM compatibility check
function await_sync_require(pkg) {
  try {
    return require(pkg);
  } catch {
    // ESM environment — try dynamic import (will throw if not installed)
    throw new Error(`Cannot import ${pkg}`);
  }
}
