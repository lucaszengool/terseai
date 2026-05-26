/**
 * linguistic.js — NLP text compression
 *
 * Ports and extends key techniques from the Terse prompt optimizer.
 * Three modes: light → balanced → aggressive.
 *
 * ALWAYS protects: code blocks, inline code, URLs, JSON, quoted strings.
 */

// ── Content protection ────────────────────────────────────────────────────

function protectContent(text) {
  const blocks = [];

  const protect = (str, pattern) =>
    str.replace(pattern, m => {
      blocks.push(m);
      return `\x00TERSE_${blocks.length - 1}\x00`;
    });

  let result = text;
  // 1. Triple-backtick code blocks (highest priority)
  result = protect(result, /```[\s\S]*?```/g);
  // 2. Indented code blocks (4-space / tab, 3+ consecutive lines)
  result = protect(result, /(?:(?:^|\n)(?:    |\t)[^\n]*){3,}/g);
  // 3. Inline code
  result = protect(result, /`[^`\n]+`/g);
  // 4. URLs
  result = protect(result, /(?:https?:\/\/|ftp:\/\/|www\.)[^\s<>"')\]]+/gi);
  // 5. JSON / XML structures (objects and arrays spanning multiple lines)
  result = protect(result, /^\s*[{\[[\]{}][\s\S]*?[}\]]\s*$/gm);
  // 6. Double-quoted strings (protect only multi-word — avoids catching contractions/apostrophes)
  result = protect(result, /"[^"]{2,}"/g);
  // NOTE: single-quoted strings are intentionally NOT protected to avoid capturing
  // English contractions and possessives (it's, don't, "God Component", etc.)

  return { text: result, blocks };
}

function restoreContent(text, blocks) {
  return text.replace(/\x00TERSE_(\d+)\x00/g, (_, i) => blocks[+i] ?? '');
}

// ── Phrase shortening table ───────────────────────────────────────────────

const PHRASE_SHORTENINGS = [
  [/\bin order to\b/gi, 'to'],
  [/\bdue to the fact that\b/gi, 'because'],
  [/\bat this point in time\b/gi, 'now'],
  [/\bat this moment in time\b/gi, 'now'],
  [/\bin the event that\b/gi, 'if'],
  [/\bfor the purpose of\b/gi, 'for'],
  [/\bin spite of the fact that\b/gi, 'although'],
  [/\bwith regard to\b/gi, 'about'],
  [/\bwith respect to\b/gi, 'about'],
  [/\bin relation to\b/gi, 'about'],
  [/\btake into (account|consideration)\b/gi, 'consider'],
  [/\bmake a decision\b/gi, 'decide'],
  [/\bprovide assistance\b/gi, 'help'],
  [/\bis able to\b/gi, 'can'],
  [/\bhas the ability to\b/gi, 'can'],
  [/\bin the near future\b/gi, 'soon'],
  [/\bon a regular basis\b/gi, 'regularly'],
  [/\ba large number of\b/gi, 'many'],
  [/\ba significant amount of\b/gi, 'much'],
  [/\ba significant number of\b/gi, 'many'],
  [/\bthe majority of\b/gi, 'most'],
  [/\bin spite of\b/gi, 'despite'],
  [/\bas well as\b/gi, 'and'],
  [/\bin addition to\b/gi, 'and'],
  [/\bon the other hand\b/gi, 'but'],
  [/\bprior to\b/gi, 'before'],
  [/\bsubsequent to\b/gi, 'after'],
  [/\bas soon as possible\b/gi, 'ASAP'],
  [/\bin terms of\b/gi, 'for'],
  [/\ba wide range of\b/gi, 'various'],
  [/\ba variety of\b/gi, 'various'],
  [/\bin the context of\b/gi, 'in'],
  [/\bwith the exception of\b/gi, 'except'],
  [/\bin conjunction with\b/gi, 'with'],
  [/\bin close proximity to\b/gi, 'near'],
  [/\bin the absence of\b/gi, 'without'],
  [/\bby means of\b/gi, 'using'],
  [/\bon the basis of\b/gi, 'based on'],
  [/\bin an effort to\b/gi, 'to'],
  [/\bwith the goal of\b/gi, 'to'],
  [/\beach and every\b/gi, 'every'],
  [/\bfirst and foremost\b/gi, 'first'],
  [/\bany and all\b/gi, 'all'],
  [/\bfor the most part\b/gi, 'mostly'],
  [/\bat the same time\b/gi, 'while'],
  [/\bup to this point\b/gi, 'so far'],
  [/\bon a (daily|weekly|monthly) basis\b/gi, '$1'],
  [/\bin a timely manner\b/gi, 'quickly'],
  [/\bmake an attempt\b/gi, 'try'],
  [/\bprovide a description\b/gi, 'describe'],
  [/\bgive an explanation\b/gi, 'explain'],
  [/\bfor the reason that\b/gi, 'because'],
  [/\bin light of the fact that\b/gi, 'since'],
  [/\bit is important to note that\b/gi, ''],
  [/\bit should be noted that\b/gi, ''],
  [/\bit is worth (mentioning|noting) that\b/gi, ''],
  [/\bneedless to say[,]?\b/gi, ''],
  [/\bit goes without saying[,]?\b/gi, ''],
  [/\bfor all intents and purposes\b/gi, ''],
];

// ── Filler words ──────────────────────────────────────────────────────────

const FILLERS_INLINE = [
  /\b(basically|actually|literally|obviously|clearly|indeed|certainly|of course|you know|I mean|kind of|sort of|you see|as you can see|needless to say|for all intents and purposes)\b[,]?\s*/gi,
  /\b(simply|just|very|quite|rather|somewhat|really|totally|completely|entirely|perfectly|honestly|frankly|genuinely|truly|surely|undoubtedly|undeniably)\b\s*/gi,
];

// ── Hedging phrases ───────────────────────────────────────────────────────

const HEDGES = [
  /\bI think (that )?\b/gi,
  /\bI believe (that )?\b/gi,
  /\bI feel (that )?\b/gi,
  /\bI suppose (that )?\b/gi,
  /\bI guess (that )?\b/gi,
  /\bperhaps\b\s*/gi,
  /\bmaybe\b\s*/gi,
  /\bmight want to\b/gi,
  /\bcould potentially\b/gi,
  /\bseems like\b\s*/gi,
  /\bit appears that\b\s*/gi,
  /\bit seems that\b\s*/gi,
  /\bit looks like\b\s*/gi,
  /\bpossibly\b\s*/gi,
  /\bprobably\b\s*/gi,
];

// ── Politeness phrases ────────────────────────────────────────────────────

const POLITENESS = [
  /^(hi|hello|hey|dear)\s*(there|assistant|AI|claude|chatgpt)?[,!.]?\s*/im,
  /\bplease\b\s*/gi,
  /\bkindly\b\s*/gi,
  /\bif you could\b[,]?\s*/gi,
  /\bif you don't mind\b[,]?\s*/gi,
  /\bif it's not too much trouble\b[,]?\s*/gi,
  /\bcould you please\b\s*/gi,
  /\bwould you be so kind\b[,]?\s*/gi,
  /\bthank you for\b[^.!?\n]*[.!?]?\s*/gi,
  /\bI appreciate\b[^.!?\n]*[.!?]?\s*/gi,
  /\bI would appreciate it if\b\s*/gi,
  /\bthanks in advance\b[^.!?\n]*[.!?]?\s*$/gim,
  /\bthank you\b\s*[.!]?\s*$/gim,
  /\bthanks[!.]?\s*$/gim,
];

// ── Question → imperative ─────────────────────────────────────────────────

const QUESTION_TO_IMPERATIVE = [
  [/(^|[.!?]\s+)(Can|Could|Would|Will) you (please )?(help me )?(to )?/gi, '$1'],
  [/(^|[.!?]\s+)(Can|Could|Would|Will) you (please )?(explain|describe|show|tell me|list|provide|create|write|generate|analyze|review|summarize|compare)\b/gi, '$1$4'],
  [/(^|[.!?]\s+)How (do|can|should|would) I\b/gi, '$1How to'],
  [/\bI was wondering if you could\s*/gi, ''],
  [/\bI would like (you to|to ask you to)\s*/gi, ''],
  [/\bI need you to\s*/gi, ''],
  [/\bI want you to\s*/gi, ''],
];

// ── Abbreviations (aggressive only) ──────────────────────────────────────

const ABBREVIATIONS = [
  [/\bwithout\b/gi, 'w/o'],
  [/\bwith\b/gi, 'w/'],
  [/\binformation\b/gi, 'info'],
  [/\bdocumentation\b/gi, 'docs'],
  [/\bdocument\b/gi, 'doc'],
  [/\bexample\b/gi, 'ex.'],
  [/\bapplication\b/gi, 'app'],
  [/\bconfiguration\b/gi, 'config'],
  [/\benvironment\b/gi, 'env'],
  [/\bdependency\b/gi, 'dep'],
  [/\bdependencies\b/gi, 'deps'],
  [/\brepository\b/gi, 'repo'],
  [/\bpackage manager\b/gi, 'pkg mgr'],
  [/\bmaximum\b/gi, 'max'],
  [/\bminimum\b/gi, 'min'],
  [/\bnumber\b/gi, 'num'],
  [/\bapproximately\b/gi, '~'],
  [/\bgreater than\b/gi, '>'],
  [/\bless than\b/gi, '<'],
  [/\btherefore\b/gi, '∴'],
  [/\band so on\b/gi, 'etc.'],
  [/\bet cetera\b/gi, 'etc.'],
];

// ── Article stripping (aggressive only) ──────────────────────────────────

// Remove articles only in instruction/imperative contexts (before noun phrases)
const ARTICLE_PATTERNS = [
  /\b(Create|Add|Remove|Delete|Update|Fix|Build|Write|Generate|Show|List|Get|Set|Use|Make|Run|Check|Test|Deploy|Install|Configure|Initialize)\s+(?:a|an|the)\s+/gi,
];

// ── Main compressor class ─────────────────────────────────────────────────

export class LinguisticCompressor {
  /**
   * @param {Object} opts
   * @param {string} [opts.mode='balanced']  'light'|'balanced'|'aggressive'
   */
  constructor({ mode = 'balanced' } = {}) {
    this.mode = mode;
  }

  /**
   * Compress text using the configured mode.
   * @param {string} text
   * @returns {string}
   */
  compress(text) {
    if (!text || typeof text !== 'string') return text;
    if (this.mode === 'none') return text;

    const { text: safe, blocks } = protectContent(text);
    let result = safe;

    // ── All modes ────────────────────────────────────────────────────────
    // Whitespace normalization
    result = result
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/^\s+$/gm, '');

    // Common phrase shortenings (safe in all modes)
    for (const [pattern, replacement] of PHRASE_SHORTENINGS) {
      result = result.replace(pattern, replacement);
    }

    // ── Light+ ───────────────────────────────────────────────────────────
    // Safe contraction of formal phrases
    result = result
      .replace(/\bdo not\b/gi, "don't")
      .replace(/\bcannot\b/gi, "can't")
      .replace(/\bwill not\b/gi, "won't")
      .replace(/\bI am\b/g, "I'm")
      .replace(/\bI have\b/g, "I've")
      .replace(/\bI would\b/g, "I'd")
      .replace(/\byou are\b/gi, "you're")
      .replace(/\bthey are\b/gi, "they're")
      .replace(/\bit is\b/gi, "it's")
      .replace(/\bthat is\b/gi, "that's")
      .replace(/\bwhat is\b/gi, "what's");

    if (this.mode === 'light') {
      result = restoreContent(result, blocks);
      return this._finalClean(result);
    }

    // ── Balanced+ ────────────────────────────────────────────────────────

    // Remove apologetic/social openers FIRST (before politeness eats sub-phrases)
    result = result.replace(/^I('m| am) sorry to bother you[^.!?\n]*[.!?]\s*/im, '');
    result = result.replace(/^I hope you('re| are) (doing well|having a great day)[^.!?\n]*[.!?]\s*/im, '');
    result = result.replace(/\bI('m| am) sorry to bother you[^.!?\n]*[.!?]\s*/gi, '');

    // Remove "I was wondering if you could ..." BEFORE politeness removes "if you could"
    result = result.replace(/\bI was wondering if you could[\s\n]*(please[\s\n]*)?(help me (out with|understand|learn|know|figure out)|assist me|explain|describe|show me)\b\s*/gi, '');
    result = result.replace(/\bI was wondering if you could[\s\n]*(please[\s\n]*)?(\w+)\b/gi, '$2');
    result = result.replace(/\bI was wondering if you could[\s\n]*/gi, '');
    // "I was just wondering ..." → ""
    result = result.replace(/\bI was (just )?wondering (about|if|whether|how|what|why|when|where)\b\s*/gi, '');

    // Filler word removal
    for (const pattern of FILLERS_INLINE) {
      result = result.replace(pattern, ' ');
    }

    // Hedging removal
    for (const pattern of HEDGES) {
      result = result.replace(pattern, '');
    }

    // Politeness removal
    for (const pattern of POLITENESS) {
      result = result.replace(pattern, '');
    }

    // Question → imperative
    for (const [pattern, replacement] of QUESTION_TO_IMPERATIVE) {
      result = result.replace(pattern, replacement);
    }

    // Remove redundant "that" after common verbs
    result = result.replace(
      /\b(think|believe|know|feel|found|noticed|realized|understand|assume|hope|guess|suppose|thought|heard|read|saw) that\b/gi,
      '$1'
    );

    // Remove "I think" / "I believe" at sentence starts
    result = result.replace(
      /(^|[.!?]\s+)(I think|I believe|I feel like|I feel that|it seems like|it seems that)\s*/gim,
      '$1'
    );

    // Remove meta-language
    result = result.replace(/\b(I want you to|I need you to|I'd like you to)\b\s*/gi, '');
    result = result.replace(/\b(the following is|below is|here is|here are)\b\s*/gi, '');
    result = result.replace(/\b(keep in mind that|note that|bear in mind that)\b\s*/gi, '');
    result = result.replace(/\b(make sure to|be sure to|don't forget to|remember to)\b\s*/gi, '');

    // (apologetic openers and "I was wondering" patterns already handled above)

    // Remove "I would really appreciate it if you could" → ""
    result = result.replace(/\bI('d| would) (really |)appreciate it if you could\b\s*/gi, '');
    result = result.replace(/\bI('d| would) (really |)appreciate (any |your |)\b/gi, '');

    // Remove "as you can probably guess" / "as you can guess"
    result = result.replace(/\bas you can (probably |)guess[,]?\s*/gi, '');
    result = result.replace(/\bas you('re| are) (probably |)aware[,]?\s*/gi, '');

    // Remove "I also think" / "I also believe" / "I also feel"
    result = result.replace(/\bI (also |)(think|believe|feel|suppose|guess)\b\s*/gi, '');

    // Compress repetitive emphasis ("really, really", "very, very")
    result = result.replace(/\b(really|very|quite|extremely),\s+(really|very|quite|extremely)\b/gi, '$1');

    // Remove "I should also mention that" / "I should mention"
    result = result.replace(/\bI should (also |)mention (that |)\b/gi, '');
    result = result.replace(/\bI should (also |)note (that |)\b/gi, '');

    // "I would really like to" → ""
    result = result.replace(/\bI('d| would) (really |)like to (make sure|ensure|be sure) (that |)\b/gi, '');
    result = result.replace(/\bI('d| would) (really |)like to\b\s*/gi, '');

    // "I'm specifically hoping you can help me with" → ""
    result = result.replace(/\bI('m| am) specifically hoping you can help me with\b\s*/gi, '');
    result = result.replace(/\bI('m| am) specifically (hoping|looking) (for|to)\b\s*/gi, '');

    // "I'm thinking we probably" → "We"
    result = result.replace(/\bI('m| am) thinking we (probably |might |could |should |)\b/gi, 'We ');

    // "I'm also curious about whether" → ""
    result = result.replace(/\bI('m| am) (also |)(curious|wondering) (about |whether |if )\b/gi, '');

    // Remove "I know this is a lot to ask" type closing phrases
    result = result.replace(/\bI know this is a lot to ask[^.!?\n]*[.!?]\s*/gi, '');

    // "could you perhaps walk me through" → "Walk me through"
    result = result.replace(/\bcould you (perhaps |)(walk me through|explain|show me|help me understand)\b/gi, '$2');

    // "if it's not too much trouble" → ""
    result = result.replace(/\bif it'?s not too much trouble[,.]?\s*/gi, '');

    // Remove "which, as you can probably guess, is" → "which is"
    result = result.replace(/\bwhich,? as you can (probably |)guess,?\s+/gi, 'which ');

    if (this.mode === 'balanced') {
      result = restoreContent(result, blocks);
      return this._finalClean(result);
    }

    // ── Aggressive only ──────────────────────────────────────────────────

    // Abbreviation injection
    for (const [pattern, abbrev] of ABBREVIATIONS) {
      result = result.replace(pattern, abbrev);
    }

    // Article stripping in instruction context
    for (const pattern of ARTICLE_PATTERNS) {
      result = result.replace(pattern, m => {
        // Remove article but keep verb and noun
        return m.replace(/\b(a|an|the)\s+/i, '');
      });
    }

    // Strip markdown noise (##, **, __, ~~)
    result = result
      .replace(/^#{1,6}\s*/gm, '')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/__([^_]+)__/g, '$1')
      .replace(/~~([^~]+)~~/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1')
      .replace(/_([^_]+)_/g, '$1');

    // Telegraph style: drop low-info sentence starters
    result = result.replace(
      /^(This |The |A |An )(following |above |below )?(section|text|content|document|code|snippet|example|response|answer|output|result) (shows?|contains?|explains?|describes?|provides?|gives?)\s*/gim,
      ''
    );

    // Collapse "X and Y" modifier pairs to just the stronger modifier
    const MODIFIER_PAIRS = [
      [/\bclear and concise\b/gi, 'concise'],
      [/\bcomplete and comprehensive\b/gi, 'comprehensive'],
      [/\bquick and easy\b/gi, 'easy'],
      [/\bsimple and straightforward\b/gi, 'simple'],
      [/\bfull and complete\b/gi, 'complete'],
      [/\baccurate and correct\b/gi, 'accurate'],
      [/\bbrief and concise\b/gi, 'brief'],
    ];
    for (const [p, r] of MODIFIER_PAIRS) result = result.replace(p, r);

    result = restoreContent(result, blocks);
    return this._finalClean(result);
  }

  /**
   * Compress an array of chat messages.
   * @param {Array<{role:string,content:string}>} messages
   * @returns {Array<{role:string,content:string}>}
   */
  compressMessages(messages) {
    return messages.map(msg => ({
      ...msg,
      content: this.compress(msg.content || ''),
    }));
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  _finalClean(text) {
    return text
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/\.\s*\./g, '.')
      .replace(/^\s*[,.:]\s*/gm, '')
      .replace(/\s+([,.])/g, '$1')
      .replace(/\b(and|also|but|or|additionally|furthermore|moreover)\s*[,.]?\s*$/i, '')
      .trim();
  }
}

// Convenience function export
export function linguisticCompress(text, mode = 'balanced') {
  return new LinguisticCompressor({ mode }).compress(text);
}
