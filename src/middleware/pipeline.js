/**
 * middleware/pipeline.js — Express-style middleware composition
 *
 * Allows developers to build processing pipelines for LLM requests,
 * with before/after hooks around each stage.
 *
 * Usage:
 *   const pipeline = new Pipeline()
 *   pipeline.use(async (ctx, next) => {
 *     ctx.messages = compress(ctx.messages)  // before
 *     await next()
 *     ctx.result.content = format(ctx.result.content)  // after
 *   })
 *   await pipeline.run({ messages, model, options })
 */

export class Pipeline {
  constructor() {
    this._middleware = [];
  }

  /**
   * Add a middleware function to the pipeline.
   *
   * @param {Function} fn  — async (ctx, next) => void
   * @returns {Pipeline} this (chainable)
   */
  use(fn) {
    if (typeof fn !== 'function') {
      throw new TypeError(`Pipeline.use() expects a function, got ${typeof fn}`);
    }
    this._middleware.push(fn);
    return this;
  }

  /**
   * Run the pipeline with a context object.
   * Each middleware receives (ctx, next) — call next() to continue.
   *
   * @param {Object} ctx  — shared context object (mutated in-place)
   * @returns {Promise<Object>} the final ctx
   */
  async run(ctx = {}) {
    const middleware = this._middleware;
    let index = -1;

    const dispatch = async (i) => {
      if (i <= index) throw new Error('next() called multiple times');
      index = i;

      const fn = middleware[i];
      if (!fn) return; // end of chain

      await fn(ctx, () => dispatch(i + 1));
    };

    await dispatch(0);
    return ctx;
  }

  /**
   * Compose multiple pipelines or middleware arrays.
   *
   * @param {...(Pipeline|Function[])} sources
   * @returns {Pipeline}
   */
  static compose(...sources) {
    const pipeline = new Pipeline();
    for (const source of sources) {
      if (source instanceof Pipeline) {
        for (const fn of source._middleware) pipeline.use(fn);
      } else if (Array.isArray(source)) {
        for (const fn of source) pipeline.use(fn);
      } else if (typeof source === 'function') {
        pipeline.use(source);
      }
    }
    return pipeline;
  }

  /**
   * Number of registered middleware functions.
   */
  get length() {
    return this._middleware.length;
  }
}

// ── Built-in middleware factories ─────────────────────────────────────────

/**
 * Logging middleware — logs request/response stats.
 * @param {Object} [opts]
 * @param {Function} [opts.logger=console.log]
 */
export function loggingMiddleware({ logger = console.log } = {}) {
  return async (ctx, next) => {
    const start = Date.now();
    logger(`[terse] → ${ctx.model || 'unknown'} | ${ctx.messages?.length || 0} messages`);
    await next();
    const elapsed = Date.now() - start;
    const tokens = ctx.result?.usage;
    logger(`[terse] ← ${elapsed}ms | in:${tokens?.input || '?'} out:${tokens?.output || '?'} tok`);
  };
}

/**
 * Rate limiting middleware — prevents exceeding requests/minute.
 * @param {Object} opts
 * @param {number} opts.requestsPerMinute
 */
export function rateLimitMiddleware({ requestsPerMinute = 60 } = {}) {
  const queue = [];
  const windowMs = 60_000;
  let windowStart = Date.now();
  let count = 0;

  return async (ctx, next) => {
    const now = Date.now();
    if (now - windowStart > windowMs) {
      windowStart = now;
      count = 0;
    }

    if (count >= requestsPerMinute) {
      const waitMs = windowMs - (now - windowStart);
      await new Promise(resolve => setTimeout(resolve, waitMs));
      windowStart = Date.now();
      count = 0;
    }

    count++;
    await next();
  };
}

/**
 * Retry middleware — retries on rate limit errors.
 * @param {Object} opts
 * @param {number} [opts.maxRetries=3]
 * @param {number} [opts.initialDelay=1000]
 */
export function retryMiddleware({ maxRetries = 3, initialDelay = 1000 } = {}) {
  return async (ctx, next) => {
    let lastError;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        await next();
        return;
      } catch (err) {
        lastError = err;
        if (attempt < maxRetries && (err.status === 429 || err.message?.includes('rate limit'))) {
          const delay = initialDelay * Math.pow(2, attempt);
          await new Promise(resolve => setTimeout(resolve, delay));
        } else {
          throw err;
        }
      }
    }
    throw lastError;
  };
}
