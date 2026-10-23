'use strict';
// The two views of a page that the lexer gives (source-literals.js: blankLiterals and blankNonCodePreservingTemplateExpressions), built from TypeScript's own parse of
// the page — so that a reading the lexer had to guess at can be checked against the parser's (pageref-resolver.js, lexNavigation).
//
// WHY. The lexer has no parser, so some of what it decides is a guess (a `/` after a `}`, a `<` that opens an element or type parameters, …), and it says where
// (`onAmbiguity`). Where a guess was wrong, its view of the page — which characters are code, which are a string's, a comment's, a regex's or JSX text — is wrong
// from there on, so the navigation oracle trusts nothing at or after the first guess. A parser settles every one of those guesses, and the plugin ships one: the
// TypeScript compiler the pages are compiled with (typescript-compiler.js, 5.8, the version the maker portal compiles with). It is loaded lazily, and only for a
// page on which the lexer guessed — pages that do are rare, so the cost (~200 ms and ~20 MB once per process, a few milliseconds a page) is paid by those alone.
//
// WHAT IT BUILDS. The same two views the lexer builds, character for character, from the tokens of TypeScript's parse (every token of the tree, read with the
// compiler's `getChildren`, and the comments in the trivia before each one):
//   - a string's body is blanked between its quotes (a JSX attribute's too); a template's text and its `${` and `}` are blanked, and its substitutions are code in
//     the executable view (`keep`), where the `}` that closes one becomes `;`, and blank in the literal view; a regex's body is blanked between its slashes, its
//     flags kept; JSX text is blanked; a comment, and a hashbang at offset 0, are blanked;
//   - blanking writes a space for every character but a line terminator, which stays.
// Where TypeScript reports any parse diagnostic, or its parse cannot be read (an exception), there is no view: the page is not one the parser vouches for.
const { loadVendoredTypeScript } = require('./typescript-compiler.js');
const { isLineTerminator } = require('./source-literals.js');

// The views of the last sources asked about: the oracle lexes one source several times per call (resolve, stray, residual), and each would parse it again.
const CACHE_LIMIT = 8;
const cache = new Map();

// The tests that hold the LEXER to its own rules — what it reads for certain, what it reports as a guess, and what a guess costs a page when nothing else can
// settle it — read pages with the lexer alone: they turn the parser off for their process (`setParserCheck(false)`), or for a script they run, with
// MODEL_APPS_LEXER_ALONE=1 in its environment. Everything else runs with it on. Off, the gates only refuse more: the lexer's guesses stand, as they did.
let parserCheck = process.env.MODEL_APPS_LEXER_ALONE !== '1';
function setParserCheck(enabled) {
  parserCheck = Boolean(enabled);
}

/**
 * The lexer's two views of `src`, built from TypeScript's parse of it as a `.tsx` file, or null where TypeScript reports a parse diagnostic or cannot be loaded.
 * @param {string} src
 * @param {{ ts?: object }} [options] `ts`: a TypeScript namespace to parse with (a test seam; the vendored compiler otherwise)
 * @returns {null | { literal: string, keep: string, comments: Array<{ start: number, end: number, text: string }>, regexEnds: Set<number>, jsxTagEnds: Set<number> }}
 */
function typescriptViews(src, { ts = null } = {}) {
  if (!ts && !parserCheck) return null;
  const text = String(src == null ? '' : src);
  if (!ts && cache.has(text)) return cache.get(text);
  let views = null;
  try {
    views = buildViews(ts || loadVendoredTypeScript(), text);
  } catch {
    // Fail closed: a compiler that cannot be loaded (its provenance check failed) or a parse that cannot be walked vouches for nothing, and the lexer's guesses stand.
    views = null;
  }
  if (!ts) {
    if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value);
    cache.set(text, views);
  }
  return views;
}

function buildViews(ts, src) {
  const sf = ts.createSourceFile('page.tsx', src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  if (sf.parseDiagnostics.length > 0) return null;
  const literal = src.split('');
  const keep = src.split('');
  // What the lexer reports besides its views, for the structure gate (page-structure.js): every comment (commentRanges), the closing `/` of every regex and the `>` of
  // every JSX tag (endsMidStatement: a file may end on one of those, and on no other `/` or `>`).
  const comments = [];
  const regexEnds = new Set();
  const jsxTagEnds = new Set();
  const blank = (from, to, views) => {
    for (let k = from; k < to; k += 1) {
      if (isLineTerminator(src[k])) continue;
      for (const view of views) view[k] = ' ';
    }
  };
  const both = [literal, keep];
  // A comment can stand in the trivia of more than one leaf of the tree (an empty list of type arguments starts where the next token's trivia does), so each is
  // taken once.
  const seen = new Set();
  const comment = (from, to) => {
    if (seen.has(from)) return;
    seen.add(from);
    blank(from, to, both);
    comments.push({ start: from, end: to, text: src.slice(from, to) });
  };
  // A hashbang is trivia to TypeScript's scanner to the end of its line, and the comment ranges below begin after it.
  if (src.startsWith('#!')) {
    let end = 2;
    while (end < src.length && !isLineTerminator(src[end])) end += 1;
    comment(0, end);
  }
  const JSX_TAGS = new Set([ts.SyntaxKind.JsxOpeningElement, ts.SyntaxKind.JsxClosingElement, ts.SyntaxKind.JsxSelfClosingElement, ts.SyntaxKind.JsxOpeningFragment,
    ts.SyntaxKind.JsxClosingFragment]);
  const visit = (node) => {
    // JSDoc is held as a child of the node it documents and is also the leading trivia of its first token, where it is blanked as the comment it is.
    if (ts.isJSDoc(node)) return;
    const children = node.getChildren(sf);
    if (children.length > 0 && !ts.isToken(node)) {
      for (const child of children) visit(child);
      return;
    }
    token(node);
  };
  const token = (node) => {
    const start = node.getStart(sf);
    // The comments in the trivia before the token: those on the line of the token before it (TypeScript's "trailing" ranges) and those after a line break (its
    // "leading" ones) — getLeadingCommentRanges alone starts collecting only at a line break. A JSX text token has no trivia: its own text, a `//` in it included,
    // is text.
    if (node.pos < start && node.kind !== ts.SyntaxKind.JsxText && node.kind !== ts.SyntaxKind.JsxTextAllWhiteSpaces) {
      for (const range of [...(ts.getTrailingCommentRanges(src, node.pos) || []), ...(ts.getLeadingCommentRanges(src, node.pos) || [])]) {
        if (range.end <= start) comment(range.pos, range.end);
      }
    }
    const end = node.end;
    if (node.kind === ts.SyntaxKind.GreaterThanToken && node.parent && JSX_TAGS.has(node.parent.kind)) jsxTagEnds.add(start);
    switch (node.kind) {
      case ts.SyntaxKind.StringLiteral:
      case ts.SyntaxKind.NoSubstitutionTemplateLiteral:
        blank(start + 1, end - 1, both);
        break;
      case ts.SyntaxKind.TemplateHead:
        // `text${`: the text and the `${` are blank in both views; the substitution after it is code in `keep`.
        blank(start + 1, end, both);
        break;
      case ts.SyntaxKind.TemplateMiddle:
      case ts.SyntaxKind.TemplateTail: {
        // `}text${` or `}text\``: the `}` that closes a substitution is `;` in `keep` (so two substitutions with only text between them cannot read as one call).
        literal[start] = ' ';
        keep[start] = ';';
        blank(start + 1, node.kind === ts.SyntaxKind.TemplateTail ? end - 1 : end, both);
        break;
      }
      case ts.SyntaxKind.RegularExpressionLiteral: {
        const close = src.lastIndexOf('/', end - 1);
        blank(start + 1, close, both);
        regexEnds.add(close);
        break;
      }
      case ts.SyntaxKind.JsxText:
      case ts.SyntaxKind.JsxTextAllWhiteSpaces:
        blank(start, end, both);
        break;
      default:
        break;
    }
  };
  visit(sf);
  // A template's substitutions are code only in `keep`: in the literal view the whole of a template between its back-ticks is blank.
  const templates = (node) => {
    if (node.kind === ts.SyntaxKind.TemplateExpression || node.kind === ts.SyntaxKind.TemplateLiteralType) {
      blank(node.getStart(sf) + 1, node.end - 1, [literal]);
      return;
    }
    ts.forEachChild(node, templates);
  };
  templates(sf);
  comments.sort((a, b) => a.start - b.start);
  return { literal: literal.join(''), keep: keep.join(''), comments, regexEnds, jsxTagEnds };
}

module.exports = { typescriptViews, setParserCheck };
