/**
 * budget.js — Reactive token budget tracker
 *
 * Tracks token consumption across named components, emits pressure/overflow
 * events as the budget fills up, and provides per-component breakdowns.
 */

import { EventEmitter } from 'events';

const PRESSURE_THRESHOLDS = [0.5, 0.75, 0.9];

export class TokenBudget extends EventEmitter {
  /**
   * @param {Object} opts
   * @param {number} opts.total           — total token budget
   * @param {number} [opts.inputFraction=0.75]  — fraction reserved for input
   * @param {number} [opts.outputFraction=0.25] — fraction reserved for output
   */
  constructor({ total = 8000, inputFraction = 0.75, outputFraction = 0.25 } = {}) {
    super();

    this.total = total;
    this.inputBudget  = Math.floor(total * inputFraction);
    this.outputBudget = Math.floor(total * outputFraction);

    // Per-component allocations and consumption
    this._allocations = new Map(); // component → allocated tokens
    this._consumed    = new Map(); // component → consumed tokens
    this._totalConsumed = 0;

    // Track which pressure thresholds have been emitted
    this._emittedThresholds = new Set();
  }

  /**
   * Attempt to allocate tokens for a component.
   * Returns true if the allocation fits within the remaining budget.
   *
   * @param {string} component
   * @param {number} tokens
   * @returns {boolean}
   */
  allocate(component, tokens) {
    const current = this._allocations.get(component) || 0;
    const totalAllocated = this._totalAllocated();
    const wouldBe = totalAllocated - current + tokens;

    if (wouldBe > this.total) {
      this.emit('overflow', { component, requested: tokens, available: this.total - totalAllocated });
      return false;
    }

    this._allocations.set(component, tokens);
    return true;
  }

  /**
   * Mark tokens as consumed by a component.
   * Emits pressure events at thresholds and overflow if exceeded.
   *
   * @param {string} component
   * @param {number} tokens
   */
  consume(component, tokens) {
    const prev = this._consumed.get(component) || 0;
    this._consumed.set(component, prev + tokens);
    this._totalConsumed += tokens;

    const p = this.pressure();

    // Emit pressure events at thresholds (each once per budget lifecycle)
    for (const threshold of PRESSURE_THRESHOLDS) {
      if (p >= threshold && !this._emittedThresholds.has(threshold)) {
        this._emittedThresholds.add(threshold);
        this.emit('pressure', { level: threshold, consumed: this._totalConsumed, total: this.total });
      }
    }

    if (this._totalConsumed > this.total) {
      this.emit('overflow', {
        component,
        consumed: this._totalConsumed,
        total: this.total,
        excess: this._totalConsumed - this.total,
      });
    }
  }

  /**
   * Tokens remaining in budget.
   * @returns {number}
   */
  remaining() {
    return Math.max(0, this.total - this._totalConsumed);
  }

  /**
   * Budget pressure as 0.0–1.0.
   * @returns {number}
   */
  pressure() {
    return Math.min(1.0, this._totalConsumed / this.total);
  }

  /**
   * Full breakdown report.
   * @returns {Object}
   */
  report() {
    const components = {};
    for (const [name, consumed] of this._consumed) {
      components[name] = {
        consumed,
        allocated: this._allocations.get(name) || 0,
        fraction: this.total > 0 ? consumed / this.total : 0,
      };
    }

    return {
      total: this.total,
      consumed: this._totalConsumed,
      remaining: this.remaining(),
      pressure: this.pressure(),
      inputBudget: this.inputBudget,
      outputBudget: this.outputBudget,
      components,
    };
  }

  /**
   * Reset all consumption tracking (keeps allocations).
   */
  reset() {
    this._consumed.clear();
    this._totalConsumed = 0;
    this._emittedThresholds.clear();
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  _totalAllocated() {
    let total = 0;
    for (const v of this._allocations.values()) total += v;
    return total;
  }
}
