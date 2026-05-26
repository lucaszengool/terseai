/**
 * providers/openai.js — OpenAI SDK wrapper
 *
 * Same interface as AnthropicProvider. Intercepts requests/responses
 * to track token usage and integrate with TokenBudget.
 */

import { estimateCost } from '../core/tokenizer.js';

export class OpenAIProvider {
  /**
   * @param {Object} opts
   * @param {string} opts.apiKey
   * @param {Object} [opts.budget]  — TokenBudget instance
   * @param {string} [opts.defaultModel='gpt-4o']
   */
  constructor({ apiKey, budget, defaultModel = 'gpt-4o' } = {}) {
    this.apiKey = apiKey;
    this.budget = budget;
    this.defaultModel = defaultModel;
    this._client = null;
  }

  /**
   * Send a chat request via the OpenAI SDK.
   *
   * @param {Array<{role:string,content:string}>} messages
   * @param {Object} [options]
   * @returns {Promise<{content:string, usage:{input,output,cached,cost}, model:string}>}
   */
  async chat(messages, options = {}) {
    const client = this._getClient();
    const model = options.model || this.defaultModel;
    const maxTokens = options.maxTokens || options.max_tokens || 1024;

    const requestParams = {
      model,
      max_tokens: maxTokens,
      messages: messages.map(m => ({
        role: m.role,
        content: m.content,
      })),
    };

    if (options.tools)       requestParams.tools = options.tools;
    if (options.tool_choice) requestParams.tool_choice = options.tool_choice;
    if (options.temperature !== undefined) requestParams.temperature = options.temperature;
    if (options.response_format) requestParams.response_format = options.response_format;

    try {
      const response = await client.chat.completions.create(requestParams);

      const usage = response.usage || {};
      const inputTokens  = usage.prompt_tokens    || 0;
      const outputTokens = usage.completion_tokens || 0;
      // OpenAI cached tokens available in some plans
      const cachedTokens = usage.prompt_tokens_details?.cached_tokens || 0;

      const costInfo = estimateCost(inputTokens, outputTokens, cachedTokens, model);

      // Update budget if configured
      if (this.budget) {
        this.budget.consume('input', inputTokens - cachedTokens);
        this.budget.consume('cached', cachedTokens);
        this.budget.consume('output', outputTokens);
      }

      const choice  = response.choices?.[0];
      const content = choice?.message?.content || '';

      return {
        content,
        usage: {
          input: inputTokens,
          output: outputTokens,
          cached: cachedTokens,
          cost: costInfo.total,
        },
        model: response.model || model,
        stopReason: choice?.finish_reason,
        // Include tool calls if present
        toolCalls: choice?.message?.tool_calls,
      };

    } catch (err) {
      if (err.status === 401) {
        throw new Error(`OpenAI API key invalid. Check your OPENAI_API_KEY. (${err.message})`);
      }
      if (err.status === 429) {
        throw new Error(`OpenAI rate limit exceeded. (${err.message})`);
      }
      throw err;
    }
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  _getClient() {
    if (this._client) return this._client;

    let OpenAI;
    try {
      const mod = sync_require('openai');
      OpenAI = mod.default || mod.OpenAI || mod;
    } catch (err) {
      throw new Error(
        'Install openai to use the OpenAI provider:\n  npm install openai'
      );
    }

    this._client = new OpenAI({ apiKey: this.apiKey });
    return this._client;
  }
}

function sync_require(pkg) {
  try {
    return require(pkg);
  } catch {
    throw new Error(`Cannot import ${pkg}`);
  }
}
