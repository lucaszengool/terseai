/**
 * examples/agent.js — Agent with working memory
 *
 * Demonstrates a multi-turn agent that automatically manages context
 * within a token budget using WorkingMemory.
 *
 * Run: ANTHROPIC_API_KEY=sk-... node examples/agent.js
 */

import { TerseContext, WorkingMemory, countTokens } from '../src/index.js';

// Simulate a multi-turn conversation
const CONVERSATION = [
  { role: 'user', content: "I need to build a REST API with Node.js and Express. Can you help me?" },
  { role: 'assistant', content: "Sure! I'll help you build a REST API. We'll need Express for routing, middleware setup, and probably a database connection. What kind of data will your API manage?" },
  { role: 'user', content: "It's for a task management app. Users can create, update, and delete tasks. Each task has a title, description, due date, and status." },
  { role: 'assistant', content: "Great! For a task management API, here's the basic structure you'll need: a Task model, CRUD endpoints at /api/tasks, input validation, and error handling. Should we use MongoDB or PostgreSQL?" },
  { role: 'user', content: "Let's use PostgreSQL. I already have it set up locally." },
  { role: 'assistant', content: "Perfect. We'll use pg or Prisma as the database client. I'd recommend Prisma for its type safety and great DX. We'll need a tasks table with: id (uuid), title (text), description (text), due_date (timestamp), status (enum), created_at, updated_at." },
  { role: 'user', content: "Sounds good. Can you show me the Express route setup?" },
  { role: 'assistant', content: "Here's the route structure:\n```javascript\n// routes/tasks.js\nrouter.get('/', getTasks);\nrouter.post('/', validateTask, createTask);\nrouter.get('/:id', getTask);\nrouter.put('/:id', validateTask, updateTask);\nrouter.delete('/:id', deleteTask);\n```\nEach handler will interact with Prisma to perform the database operation." },
  { role: 'user', content: "What about authentication? Should I add JWT?" },
];

async function main() {
  console.log('TERSE FRAMEWORK — Agent with Working Memory\n');

  // Track total tokens across the full conversation
  const fullConvTokens = CONVERSATION.reduce((s, m) => s + countTokens(m.content), 0);
  console.log(`Full conversation: ${CONVERSATION.length} messages, ${fullConvTokens} tokens\n`);

  // Create a working memory with a 600-token budget
  const memory = new WorkingMemory({ maxTokens: 600, strategy: 'smart' });

  // Add all messages
  for (const msg of CONVERSATION) {
    memory.add(msg);
  }

  const window = memory.get();
  const windowTokens = memory.size();

  console.log(`Working memory window: ${window.length} messages, ${windowTokens} tokens`);
  console.log(`Eviction count: ${memory.evictionCount}`);
  console.log(`Token reduction: ${((fullConvTokens - windowTokens) / fullConvTokens * 100).toFixed(1)}%\n`);

  console.log('Messages in working memory window:');
  console.log('─'.repeat(60));
  for (const msg of window) {
    const tokens = countTokens(msg.content);
    console.log(`[${msg.role.toUpperCase().padEnd(9)}] (${tokens} tok) ${msg.content.slice(0, 80)}${msg.content.length > 80 ? '...' : ''}`);
  }
  console.log();

  // Now use TerseContext for the full agent setup
  const ctx = new TerseContext({
    model: 'claude-sonnet-4-6',
    budget: 8000,
    compression: 'balanced',
    memory: 'working',
    // apiKey: process.env.ANTHROPIC_API_KEY,
  });

  // Add conversation to context memory
  await ctx.addToMemory(CONVERSATION);

  // Make the next request (dry-run)
  const nextMessage = { role: 'user', content: "Can you show me a complete example of the createTask handler with Prisma and proper error handling?" };

  console.log(`Next message: "${nextMessage.content}"`);
  const result = await ctx.chat([...CONVERSATION, nextMessage]);

  console.log('\nResult:', result.content);
  console.log('\nContext stats:', ctx.stats());
}

main().catch(console.error);
