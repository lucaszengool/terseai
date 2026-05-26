# terse

**Drop-in token optimization for LLM applications. Cut API costs 38–72% with zero configuration changes to your prompts.**

## Install

```bash
npm install terse
# Optional provider SDKs:
npm install @anthropic-ai/sdk   # for Anthropic
npm install openai              # for OpenAI
```

## 10-line quickstart

```javascript
import { TerseContext } from 'terse'

const ctx = new TerseContext({
  model: 'claude-sonnet-4-6',
  budget: 8000,
  compression: 'balanced',   // 'none' | 'light' | 'balanced' | 'aggressive'
  memory: 'working',         // 'none' | 'working' | 'episodic' | 'semantic'
  apiKey: process.env.ANTHROPIC_API_KEY,
})

const result = await ctx.chat([
  { role: 'user', content: 'Explain recursion with a JavaScript example.' }
])
console.log(result.content)
console.log(ctx.stats())   // → { savingsPercent: 24, inputTokensSaved: 31, ... }
```

## What it does

| Module | What it optimizes | Typical savings |
|--------|-------------------|-----------------|
| **LinguisticCompressor** | Filler words, hedging, politeness, verbose phrases | 22–50% |
| **WorkingMemory** | Sliding window — drops old turns intelligently | 75–85% |
| **EpisodicMemory** | Summarizes old conversation segments | 40–60% |
| **SemanticMemory** | TF-IDF retrieval — injects only relevant context | 50–80% |
| **ModelRouter** | Routes simple tasks to cheaper models | 40–80% cost |
| **optimizeTools** | Compresses tool/function schema descriptions | 42–69% |
| **verbatimCompact** | Strips comments from code, zero semantic loss | 25–35% |

Run `node benchmark/run.js` for live numbers on your machine.

## Compression modes

### `'light'` — Safe, meaning-preserving
Contractions (`do not` → `don't`), phrase shortening (`in order to` → `to`), whitespace normalization. Never changes meaning.

### `'balanced'` — Recommended for most LLM use cases
Everything in light, plus: filler word removal (`basically`, `actually`, `I think`, `perhaps`), politeness removal, question→imperative conversion, hedging removal. Saves 22–30% on typical developer prompts.

### `'aggressive'` — Maximum compression
Everything in balanced, plus: abbreviation injection (`information` → `info`), article stripping in instruction context, markdown noise removal, telegraph style. Saves 25–50%.

## Modules

### TerseContext (main entry point)

```javascript
const ctx = new TerseContext({
  model: 'claude-sonnet-4-6',      // target model
  budget: 8000,                     // total token budget
  compression: 'balanced',          // see above
  memory: 'working',                // memory strategy
  provider: 'anthropic',            // 'anthropic' | 'openai'
  apiKey: process.env.ANTHROPIC_API_KEY,
  routing: false,                   // enable multi-model routing
})

await ctx.chat(messages, options)    // optimized chat completion
ctx.compress(text, options)          // compress arbitrary text
await ctx.addToMemory(messages)      // add to memory
await ctx.getMemory()                // get current memory state
ctx.stats()                          // token savings report
ctx.pipe(...middleware)              // add middleware
```

### LinguisticCompressor (standalone)

```javascript
import { LinguisticCompressor } from 'terse'

const comp = new LinguisticCompressor({ mode: 'balanced' })
const compressed = comp.compress(longPrompt)
// Protected: code blocks, URLs, JSON structures, double-quoted strings
```

### WorkingMemory

```javascript
import { WorkingMemory } from 'terse'

const memory = new WorkingMemory({ maxTokens: 4000, strategy: 'smart' })
memory.add({ role: 'user', content: '...' })
memory.add({ role: 'assistant', content: '...' })
console.log(memory.size())         // current token count
console.log(memory.evictionCount)  // how many messages evicted
const window = memory.get()        // current message window
```

### SemanticMemory

```javascript
import { SemanticMemory } from 'terse'

const store = new SemanticMemory()
store.store('React hooks documentation...', { source: 'docs' })
store.store('TypeScript generics guide...', { source: 'docs' })

const relevant = store.retrieve('how do React hooks work?', 3)
// → [{ text, metadata, score }, ...]

// Note: uses bag-of-words TF-IDF, not neural embeddings
// Replace with OpenAI embeddings for production semantic search
console.log(store.embeddingInfo())
```

### ModelRouter

```javascript
import { ModelRouter } from 'terse'

const router = new ModelRouter()
const { model, tier, reason, estimatedCost } = router.route(messages)
// tier: 'simple' | 'moderate' | 'complex'
// model: 'claude-haiku-4-5' | 'claude-sonnet-4-6' | 'claude-opus-4-7'

console.log(router.savings())
// → { savedPercent: 80, actualCost: 0.13, complexCost: 0.65 }
```

### optimizeTools

```javascript
import { optimizeTools } from 'terse'

const { tools: compressed, stats } = optimizeTools(myTools)
// stats.reductionPercent: 42
// stats.tokensSaved: 1543

// Aggressive: also removes optional parameters
const { tools: minimal } = optimizeTools(myTools, { aggressiveMode: true })
```

### Pipeline (middleware)

```javascript
import { Pipeline, loggingMiddleware } from 'terse'

const pipeline = new Pipeline()
pipeline.use(loggingMiddleware())
pipeline.use(async (ctx, next) => {
  ctx.messages = compressMessages(ctx.messages)  // before
  await next()
  ctx.result = postProcess(ctx.result)           // after
})
await pipeline.run({ messages, model: 'claude-sonnet-4-6' })
```

## Benchmark

```bash
node benchmark/run.js
```

No npm install needed — runs completely offline with zero dependencies.

## Design principles

1. **Zero required dependencies** — core framework has no npm deps
2. **Protect structured content** — all compressors skip code blocks, URLs, JSON
3. **Honest about limitations** — SemanticMemory documents its bag-of-words limitations
4. **Composable** — use any module standalone or compose them via TerseContext
5. **Measurable** — every module reports token counts so you can verify savings

## License

MIT
