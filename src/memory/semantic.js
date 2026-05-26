/**
 * semantic.js — In-memory vector store using bag-of-words TF-IDF
 *
 * IMPORTANT: This uses simple word-frequency vectors, NOT neural embeddings.
 * Retrieval quality is suitable for keyword-dense technical content but will
 * miss semantic similarity between different phrasings of the same concept.
 * For production use, replace with a proper embedding model.
 */

export class SemanticMemory {
  /**
   * @param {Object} [opts]
   * @param {number} [opts.maxChunks=1000]  — maximum stored chunks
   */
  constructor({ maxChunks = 1000 } = {}) {
    this.maxChunks = maxChunks;
    this._chunks = [];    // { text, metadata, vector, id }
    this._idfCache = null; // cached IDF weights
    this._nextId = 0;

    // Warn developers about limitations
    this._embeddingType = 'bag-of-words-tfidf';
  }

  /**
   * Store a text chunk with optional metadata.
   *
   * @param {string} text
   * @param {Object} [metadata]
   * @returns {string} chunk ID
   */
  store(text, metadata = {}) {
    if (!text || typeof text !== 'string') throw new Error('text must be a non-empty string');

    const id = `chunk_${this._nextId++}`;
    // Invalidate IDF cache when new document added
    this._idfCache = null;

    const chunk = { id, text, metadata, vector: null }; // vector computed lazily
    this._chunks.push(chunk);

    // Evict oldest if over capacity
    if (this._chunks.length > this.maxChunks) {
      this._chunks.shift();
    }

    return id;
  }

  /**
   * Retrieve the top-k most relevant chunks for a query.
   *
   * @param {string} query
   * @param {number} [k=5]
   * @returns {Array<{ text:string, metadata:Object, score:number, id:string }>}
   */
  retrieve(query, k = 5) {
    if (this._chunks.length === 0) return [];
    if (!query) return this._chunks.slice(0, k).map(c => ({ ...c, score: 0 }));

    // Build IDF weights from corpus if not cached
    const idf = this._getIDF();

    // Build query vector
    const queryVec = this._buildVector(query, idf);

    // Score each chunk
    const scored = this._chunks.map(chunk => {
      if (!chunk.vector) {
        chunk.vector = this._buildVector(chunk.text, idf);
      }
      return {
        id: chunk.id,
        text: chunk.text,
        metadata: chunk.metadata,
        score: cosineSimilarity(queryVec, chunk.vector),
      };
    });

    // Sort by score descending, return top-k
    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, k);
  }

  /**
   * Remove a chunk by ID.
   * @param {string} id
   * @returns {boolean}
   */
  remove(id) {
    const idx = this._chunks.findIndex(c => c.id === id);
    if (idx === -1) return false;
    this._chunks.splice(idx, 1);
    this._idfCache = null;
    return true;
  }

  /**
   * Number of stored chunks.
   * @returns {number}
   */
  size() {
    return this._chunks.length;
  }

  /**
   * Clear all stored chunks.
   */
  clear() {
    this._chunks = [];
    this._idfCache = null;
  }

  /**
   * Returns metadata about the embedding approach.
   * Developers should check this to understand retrieval limitations.
   */
  embeddingInfo() {
    return {
      type: this._embeddingType,
      dimensions: 'variable (vocabulary size)',
      similarity: 'cosine',
      limitations: [
        'No semantic understanding — only keyword overlap',
        'Struggles with synonyms and paraphrasing',
        'No multilingual support beyond ASCII',
        'Suitable for technical/keyword-rich content only',
      ],
      recommendation: 'Replace with OpenAI text-embedding-3-small or similar for production use',
    };
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  _tokenize(text) {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 1); // skip single chars
  }

  _buildVector(text, idf) {
    const tokens = this._tokenize(text);
    const tf = new Map();

    for (const token of tokens) {
      tf.set(token, (tf.get(token) || 0) + 1);
    }

    const vector = new Map();
    for (const [token, count] of tf) {
      const tfScore = count / tokens.length;
      const idfScore = idf.get(token) || Math.log(this._chunks.length + 1); // unknown terms get high IDF
      vector.set(token, tfScore * idfScore);
    }

    return vector;
  }

  _getIDF() {
    if (this._idfCache) return this._idfCache;

    const N = this._chunks.length;
    const df = new Map(); // document frequency per term

    for (const chunk of this._chunks) {
      const tokens = new Set(this._tokenize(chunk.text));
      for (const token of tokens) {
        df.set(token, (df.get(token) || 0) + 1);
      }
    }

    const idf = new Map();
    for (const [token, count] of df) {
      idf.set(token, Math.log((N + 1) / (count + 1)) + 1);
    }

    this._idfCache = idf;
    return idf;
  }
}

// ── Math helpers ──────────────────────────────────────────────────────────

function cosineSimilarity(vecA, vecB) {
  if (vecA.size === 0 || vecB.size === 0) return 0;

  // Dot product (only iterate over smaller map for efficiency)
  let dot = 0;
  const [smaller, larger] = vecA.size <= vecB.size ? [vecA, vecB] : [vecB, vecA];

  for (const [token, valA] of smaller) {
    const valB = larger.get(token);
    if (valB !== undefined) dot += valA * valB;
  }

  if (dot === 0) return 0;

  // Magnitudes
  let magA = 0;
  for (const v of vecA.values()) magA += v * v;

  let magB = 0;
  for (const v of vecB.values()) magB += v * v;

  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}
