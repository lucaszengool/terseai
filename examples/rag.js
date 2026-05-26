/**
 * examples/rag.js — RAG pipeline with context pruning
 *
 * Demonstrates how to use SemanticMemory for retrieval-augmented generation
 * with token-budget-aware context injection.
 *
 * Run: ANTHROPIC_API_KEY=sk-... node examples/rag.js
 */

import { TerseContext, SemanticMemory, countTokens, selectiveCompress } from '../src/index.js';

// Simulated knowledge base chunks (would normally come from documents/DB)
const KNOWLEDGE_BASE = [
  {
    id: 'kb-1',
    text: 'Terse is a token optimization framework for LLM applications. It reduces API costs by 38-72% through compression, memory management, and model routing.',
    metadata: { source: 'docs/overview.md', section: 'intro' },
  },
  {
    id: 'kb-2',
    text: 'The LinguisticCompressor supports three modes: light (safe contractions, phrase shortening), balanced (+ filler/hedging removal, question→imperative), and aggressive (+ abbreviations, article stripping, telegraph style).',
    metadata: { source: 'docs/compression.md', section: 'modes' },
  },
  {
    id: 'kb-3',
    text: 'WorkingMemory implements a sliding window context manager. Three eviction strategies: truncate (drop oldest), smart (keep system+first+last N), and summarize (LLM-based, placeholder).',
    metadata: { source: 'docs/memory.md', section: 'working' },
  },
  {
    id: 'kb-4',
    text: 'SemanticMemory uses TF-IDF bag-of-words vectors for similarity search. No neural embeddings — fast and offline. Suitable for keyword-dense technical content. Replace with OpenAI embeddings for production semantic search.',
    metadata: { source: 'docs/memory.md', section: 'semantic' },
  },
  {
    id: 'kb-5',
    text: 'ModelRouter classifies tasks as simple/moderate/complex using heuristics (no LLM needed). Routes: simple→haiku, moderate→sonnet, complex→opus. Achieves 40-50% cost reduction vs always using the most capable model.',
    metadata: { source: 'docs/routing.md', section: 'overview' },
  },
  {
    id: 'kb-6',
    text: 'TokenBudget tracks token consumption across components. Emits pressure events at 50%, 75%, 90% thresholds and overflow events when exceeded. Use budget.pressure() to dynamically adjust context window size.',
    metadata: { source: 'docs/core.md', section: 'budget' },
  },
  {
    id: 'kb-7',
    text: 'The Pipeline class implements Express-style middleware composition for LLM requests. Built-in middleware: loggingMiddleware, rateLimitMiddleware, retryMiddleware. Chain with pipeline.use(fn) or Pipeline.compose(...pipelines).',
    metadata: { source: 'docs/middleware.md', section: 'pipeline' },
  },
  {
    id: 'kb-8',
    text: 'optimizeTools() compresses tool schemas using the SkillReducer approach. Removes filler phrases from descriptions, shortens parameter descriptions, optionally removes optional parameters. Achieves ~43% reduction.',
    metadata: { source: 'docs/tools.md', section: 'optimizer' },
  },
  {
    id: 'kb-9',
    text: 'EpisodicMemory maintains a rolling summary plus verbatim recent messages. When verbatim storage exceeds maxVerbatimTokens, the oldest chunk is summarized (LLM if provider available, else extractive). Access via episodic.getContextMessages().',
    metadata: { source: 'docs/memory.md', section: 'episodic' },
  },
  {
    id: 'kb-10',
    text: 'verbatimCompact() strips comments and normalizes whitespace in code WITHOUT modifying logic. Protects string literals. Removes duplicate import statements. Safe for any code that should reach the LLM unchanged.',
    metadata: { source: 'docs/compression.md', section: 'verbatim' },
  },
];

async function main() {
  console.log('TERSE FRAMEWORK — RAG Pipeline Example\n');

  // Build a semantic memory index from the knowledge base
  const semanticMemory = new SemanticMemory({ maxChunks: 100 });

  for (const chunk of KNOWLEDGE_BASE) {
    semanticMemory.store(chunk.text, chunk.metadata);
  }

  console.log(`Indexed ${semanticMemory.size()} knowledge base chunks`);
  console.log(`Embedding type: ${semanticMemory.embeddingInfo().type}\n`);

  // Simulate user queries
  const queries = [
    "How does compression work in terse?",
    "What memory strategies are available?",
    "How do I reduce API costs with model routing?",
  ];

  for (const query of queries) {
    console.log(`Query: "${query}"`);
    console.log('─'.repeat(60));

    // Retrieve relevant chunks
    const relevant = semanticMemory.retrieve(query, 3);

    console.log(`Top 3 relevant chunks:`);
    let contextTokens = 0;
    for (const chunk of relevant) {
      const tokens = countTokens(chunk.text);
      contextTokens += tokens;
      console.log(`  [score: ${chunk.score.toFixed(3)}] ${chunk.text.slice(0, 80)}...`);
      console.log(`    source: ${chunk.metadata.source}`);
    }

    // Build context with token budget awareness
    const budget = 500;
    let context = relevant.map(c => c.text).join('\n\n');
    const contextTok = countTokens(context);

    if (contextTok > budget) {
      // Selectively compress context if too large
      context = selectiveCompress(context, 0.3);
      const compressedTok = countTokens(context);
      console.log(`\n  Context compressed: ${contextTok} → ${compressedTok} tokens`);
    } else {
      console.log(`\n  Context: ${contextTok} tokens (within ${budget}-token budget)`);
    }

    console.log();
  }

  // Full RAG pipeline with TerseContext (dry-run)
  const ctx = new TerseContext({
    model: 'claude-sonnet-4-6',
    budget: 8000,
    compression: 'balanced',
    memory: 'semantic',
    // apiKey: process.env.ANTHROPIC_API_KEY,
  });

  // Store knowledge base in context's semantic memory
  await ctx.addToMemory(KNOWLEDGE_BASE.map(k => ({
    role: 'user',
    content: k.text,
  })));

  console.log('RAG query via TerseContext:');
  const query = "Explain how to reduce token costs in my LLM application.";
  const result = await ctx.chat(
    [{ role: 'user', content: query }],
    { query } // pass query for semantic retrieval
  );

  console.log(`Query: "${query}"`);
  console.log(`Result: ${result.content}`);
  console.log('\nStats:', ctx.stats());
}

main().catch(console.error);
