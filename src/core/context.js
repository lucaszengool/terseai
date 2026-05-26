/**
 * context.js — TerseContext: the main developer entry point
 *
 * Wraps all framework modules into a single configurable object that
 * developers drop into their LLM applications for automatic optimization.
 */

import { TokenBudget } from './budget.js';
import { countTokens, estimateCost } from './tokenizer.js';
import { LinguisticCompressor } from '../compression/linguistic.js';
import { selectiveCompress } from '../compression/selective.js';
import { WorkingMemory } from '../memory/working.js';
import { EpisodicMemory } from '../memory/episodic.js';
import { SemanticMemory } from '../memory/semantic.js';
import { ModelRouter } from '../routing/router.js';
import { Pipeline } from '../middleware/pipeline.js';

export class TerseContext {
  /**
   * @param {Object} opts
   * @param {string}  [opts.model='claude-sonnet-4-6']
   * @param {number}  [opts.budget=8000]
   * @param {string}  [opts.compression='balanced']  'none'|'light'|'balanced'|'aggressive'
   * @param {string}  [opts.memory='working']         'none'|'working'|'episodic'|'semantic'
   * @param {string}  [opts.provider='anthropic']     'anthropic'|'openai'
   * @param {string}  [opts.apiKey]
   * @param {boolean} [opts.routing=false]
   */
  constructor({
    model = 'claude-sonnet-4-6',
    budget = 8000,
    compression = 'balanced',
    memory = 'working',
    provider = 'anthropic',
    apiKey,
    routing = false,
  } = {}) {
    this.model = model;
    this.compressionMode = compression;
    this.memoryType = memory;
    this.providerName = provider;
    this.apiKey = apiKey || process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY;
    this.routingEnabled = routing;

    // Sub-modules
    this.budget = new TokenBudget({ total: budget });
    this.compressor = new LinguisticCompressor({ mode: compression });
    this.pipeline = new Pipeline();
    this.router = routing ? new ModelRouter() : null;

    // Memory system
    this._memory = this._initMemory(memory, budget);

    // Stats tracking
    this._stats = {
      calls: 0,
      inputTokensTotal: 0,
      outputTokensTotal: 0,
      inputTokensSaved: 0,
      costTotal: 0,
      costSaved: 0,
    };

    // Lazy-loaded provider
    this._provider = null;
  }

  // ── Core API ──────────────────────────────────────────────────────────────

  /**
   * Optimized chat completion.
   * Compresses messages, manages memory, routes to optimal model.
   *
   * @param {Array<{role:string,content:string}>} messages
   * @param {Object} [options]
   * @returns {Promise<{content:string, usage:Object, model:string}>}
   */
  async chat(messages, options = {}) {
    this._stats.calls++;

    // 1. Compress messages
    const compressed = await this._compressMessages(messages);

    // 2. Add to memory and get enriched context
    if (this._memory) {
      for (const msg of messages) {
        if (typeof this._memory.add === 'function') {
          await this._memory.add(msg);
        } else if (typeof this._memory.store === 'function') {
          this._memory.store(msg.content || '', { role: msg.role });
        }
      }
      // Prepend memory context to system message if semantic memory
      if (this.memoryType === 'semantic' && options.query) {
        const relevant = this._memory.retrieve(options.query, 3);
        if (relevant.length > 0) {
          const memCtx = relevant.map(r => r.text).join('\n\n');
          compressed.unshift({ role: 'user', content: `[Context]\n${memCtx}` });
        }
      }
    }

    // 3. Route to optimal model
    let targetModel = this.model;
    if (this.router) {
      const { model: routedModel } = this.router.route(compressed);
      targetModel = routedModel;
    }

    // 4. Count input tokens before call
    const inputTokensBefore = compressed.reduce((s, m) => s + countTokens(m.content), 0);
    const inputTokensOrig   = messages.reduce((s, m) => s + countTokens(m.content), 0);
    this._stats.inputTokensSaved += (inputTokensOrig - inputTokensBefore);
    this._stats.inputTokensTotal += inputTokensBefore;
    this.budget.consume('input', inputTokensBefore);

    // 5. Run through pipeline
    const requestCtx = {
      messages: compressed,
      model: targetModel,
      options,
      provider: this.providerName,
      apiKey: this.apiKey,
    };

    // 6. Make the actual LLM call (if provider configured)
    let result;
    if (this.apiKey) {
      const provider = await this._getProvider();
      result = await provider.chat(compressed, { ...options, model: targetModel });
    } else {
      // Dry-run mode: return stats without making API call
      result = {
        content: '[dry-run: no apiKey configured]',
        usage: { input: inputTokensBefore, output: 0, cached: 0, cost: 0 },
        model: targetModel,
      };
    }

    // 7. Track output stats
    if (result.usage) {
      this._stats.outputTokensTotal += result.usage.output || 0;
      this._stats.costTotal += result.usage.cost || 0;
      this.budget.consume('output', result.usage.output || 0);
    }

    return { ...result, model: targetModel };
  }

  /**
   * Compress arbitrary text using the configured compressor.
   *
   * @param {string} text
   * @param {Object} [options]
   * @param {string} [options.mode]  — override compression mode
   * @param {number} [options.ratio] — selective compression ratio (0–1)
   * @returns {{ text:string, originalTokens:number, compressedTokens:number, ratio:number }}
   */
  compress(text, options = {}) {
    const mode = options.mode || this.compressionMode;
    if (mode === 'none') {
      const tokens = countTokens(text);
      return { text, originalTokens: tokens, compressedTokens: tokens, ratio: 0 };
    }

    const originalTokens = countTokens(text);
    let result = text;

    if (options.selective && options.ratio) {
      result = selectiveCompress(result, options.ratio);
    }

    const comp = mode !== this.compressionMode
      ? new LinguisticCompressor({ mode })
      : this.compressor;

    result = comp.compress(result);
    const compressedTokens = countTokens(result);

    return {
      text: result,
      originalTokens,
      compressedTokens,
      ratio: originalTokens > 0 ? (originalTokens - compressedTokens) / originalTokens : 0,
    };
  }

  /**
   * Add messages to the memory system.
   * @param {Array<{role:string,content:string}>|{role:string,content:string}} messages
   */
  async addToMemory(messages) {
    if (!this._memory) return;
    const msgs = Array.isArray(messages) ? messages : [messages];
    for (const msg of msgs) {
      if (typeof this._memory.add === 'function') {
        await this._memory.add(msg);
      } else if (typeof this._memory.store === 'function') {
        // SemanticMemory uses .store(text, metadata)
        this._memory.store(msg.content || '', { role: msg.role });
      }
    }
  }

  /**
   * Get current memory state.
   * @returns {Array|Object}
   */
  async getMemory() {
    if (!this._memory) return [];
    if (typeof this._memory.get === 'function') return this._memory.get();
    if (typeof this._memory.size === 'function') {
      // SemanticMemory — return metadata about stored chunks
      return { type: 'semantic', chunks: this._memory.size() };
    }
    return [];
  }

  /**
   * Token savings report.
   * @returns {Object}
   */
  stats() {
    const savedFraction = this._stats.inputTokensTotal + this._stats.inputTokensSaved > 0
      ? this._stats.inputTokensSaved / (this._stats.inputTokensTotal + this._stats.inputTokensSaved)
      : 0;

    return {
      calls: this._stats.calls,
      inputTokensTotal: this._stats.inputTokensTotal,
      inputTokensSaved: this._stats.inputTokensSaved,
      outputTokensTotal: this._stats.outputTokensTotal,
      savingsPercent: Math.round(savedFraction * 100),
      costTotal: this._stats.costTotal,
      budget: this.budget.report(),
      routing: this.router ? this.router.savings() : null,
    };
  }

  /**
   * Add middleware to the processing pipeline.
   * @param {...Function} fns
   * @returns {TerseContext} this (chainable)
   */
  pipe(...middleware) {
    for (const fn of middleware) this.pipeline.use(fn);
    return this;
  }

  // ── Internal helpers ──────────────────────────────────────────────────────

  _initMemory(type, budget) {
    switch (type) {
      case 'working':
        return new WorkingMemory({ maxTokens: Math.floor(budget * 0.6) });
      case 'episodic':
        return new EpisodicMemory({ maxVerbatimTokens: Math.floor(budget * 0.4) });
      case 'semantic':
        return new SemanticMemory();
      default:
        return null;
    }
  }

  async _compressMessages(messages) {
    if (this.compressionMode === 'none') return [...messages];

    return messages.map(msg => {
      if (!msg.content || typeof msg.content !== 'string') return msg;
      // Don't aggressively compress system prompts (they're usually precise)
      const mode = msg.role === 'system' ? 'light' : this.compressionMode;
      const comp = mode !== this.compressionMode
        ? new LinguisticCompressor({ mode })
        : this.compressor;
      return { ...msg, content: comp.compress(msg.content) };
    });
  }

  async _getProvider() {
    if (this._provider) return this._provider;
    if (this.providerName === 'anthropic') {
      const { AnthropicProvider } = await import('../providers/anthropic.js');
      this._provider = new AnthropicProvider({ apiKey: this.apiKey, budget: this.budget });
    } else if (this.providerName === 'openai') {
      const { OpenAIProvider } = await import('../providers/openai.js');
      this._provider = new OpenAIProvider({ apiKey: this.apiKey, budget: this.budget });
    } else {
      throw new Error(`Unknown provider: ${this.providerName}`);
    }
    return this._provider;
  }
}
