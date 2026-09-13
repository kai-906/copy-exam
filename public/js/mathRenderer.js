/**
 * mathRenderer.js
 * ─────────────────────────────────────────────────────────────────────
 * Renders mathematical expressions inside any HTML element using KaTeX.
 *
 * Supports two modes:
 *   1. Delimited LaTeX:  $...$ or \(...\)  — renders inline
 *   2. Auto-detect:      plain-text expressions like gamma_w, 1+w/G
 *                        are converted to LaTeX automatically
 *
 * Usage (after including KaTeX CDN):
 *   MathRenderer.render(element)       — renders all math in element
 *   MathRenderer.renderText(str)       — returns HTML string with math
 *   MathRenderer.plainToLatex(str)     — converts plain → LaTeX string
 * ─────────────────────────────────────────────────────────────────────
 */

const MathRenderer = (() => {

  // ── Plain-text → LaTeX conversion map ──────────────────────────────
  // Handles output from Gemini like: gamma_w, V_v/V_s, wL^3/pi^3*EI
  const PLAIN_TO_LATEX_RULES = [
    // Greek letters (word boundaries)
    [/\bgamma_w\b/g,   '\\gamma_w'],
    [/\bgamma_d\b/g,   '\\gamma_d'],
    [/\bgamma_t\b/g,   '\\gamma_t'],
    [/\bgamma_m\b/g,   '\\gamma_m'],
    [/\bgamma\b/g,     '\\gamma'],
    [/\balpha\b/g,     '\\alpha'],
    [/\bbeta\b/g,      '\\beta'],
    [/\bdelta\b/g,     '\\delta'],
    [/\bDelta\b/g,     '\\Delta'],
    [/\btheta\b/g,     '\\theta'],
    [/\bphi\b/g,       '\\phi'],
    [/\bPhi\b/g,       '\\Phi'],
    [/\bmu\b/g,        '\\mu'],
    [/\bsigma\b/g,     '\\sigma'],
    [/\bSigma\b/g,     '\\Sigma'],
    [/\blambda\b/g,    '\\lambda'],
    [/\bpi\b/g,        '\\pi'],
    [/\bomega\b/g,     '\\omega'],
    [/\bepsilon\b/g,   '\\epsilon'],
    [/\btau\b/g,       '\\tau'],
    [/\brho\b/g,       '\\rho'],
    [/\bnu\b/g,        '\\nu'],
    [/\bxi\b/g,        '\\xi'],
    [/\bpsi\b/g,       '\\psi'],
    [/\bzeta\b/g,      '\\zeta'],
    [/\beta_a\b/g,     '\\beta_a'],  // common in geotechnical

    // Subscripts: V_v, W_s, G_s, n_a, e_max etc
    [/([A-Za-z])_([A-Za-z0-9]+)/g, '$1_{$2}'],

    // Superscripts: cm^3, kN/m^3, m^2, x^2
    [/([A-Za-z0-9\}])(\^)([-+]?\d+)/g, '$1^{$3}'],

    // Fractions: numerator/denominator (handles multi-char like wL^3)
    // Only convert when both sides look like math expressions
    [/\(([^()]+)\)\/\(([^()]+)\)/g, '\\frac{$1}{$2}'],  // (a)/(b)
    [/([A-Za-z0-9_.^{}\\]+)\/([A-Za-z0-9_.^{}\\]+)/g,
      (_, n, d) => `\\frac{${n}}{${d}}`],

    // Common symbols
    [/\+-/g,  '\\pm'],
    [/>=|≥/g, '\\geq'],
    [/<=|≤/g, '\\leq'],
    [/!=|≠/g, '\\neq'],
    [/\*/g,   '\\times'],
    [/\bdeg\b/g, '^{\\circ}'],
    [/°/g,    '^{\\circ}'],
    [/√/g,    '\\sqrt'],
    [/∞/g,    '\\infty'],
    [/∑/g,    '\\sum'],
    [/∫/g,    '\\int'],
    [/×/g,    '\\times'],
    [/÷/g,    '\\div'],
  ];

  /**
   * Convert plain-text math expression to LaTeX string.
   * Input:  "S = (1 + w) / ((gamma_w / gamma)*(1 + w) - 1/G)"
   * Output: "S = \frac{(1 + w)}{(\frac{\gamma_w}{\gamma}*(1 + w) - \frac{1}{G})}"
   */
  function plainToLatex(text) {
    if (!text) return text;
    let t = text;
    for (const [pattern, replacement] of PLAIN_TO_LATEX_RULES) {
      t = t.replace(pattern, replacement);
    }
    return t;
  }

  /**
   * Detect if a string likely contains math that needs rendering.
   * Checks for: $...$ delimiters, subscripts, fractions, Greek words,
   * superscripts, common engineering symbols.
   */
  function hasMath(text) {
    if (!text) return false;
    return /\$[^$]+\$/.test(text) ||           // $...$ delimiters
      /\\\(/.test(text) ||                       // \( ... \)
      /[A-Za-z]_[A-Za-z0-9]/.test(text) ||      // subscripts: V_v
      /[A-Za-z0-9]\^[\d{]/.test(text) ||        // superscripts: m^3
      /\bgamma\b|\balpha\b|\bbeta\b|\bdelta\b|\btheta\b|\bpi\b|\bsigma\b|\bmu\b/i.test(text) ||
      /\\frac|\\sqrt|\\sum|\\int/.test(text) || // LaTeX commands
      /\d+\/\d+/.test(text) ||                  // fractions: 1/G
      /[°√∑∫×÷±≥≤≠∞]/.test(text);              // special symbols
  }

  /**
   * Render a plain-text or LaTeX string into an HTML string.
   * Wraps detected math in $...$ for KaTeX auto-render.
   */
  function renderText(text) {
    if (!text) return '';
    if (!hasMath(text)) return escapeHtml(text);

    // If already has $...$ delimiters, pass directly to KaTeX
    if (/\$[^$]+\$/.test(text) || /\\\(/.test(text)) {
      return text; // KaTeX auto-render will handle it
    }

    // Split text into math segments and plain segments
    // Strategy: detect runs of math-like tokens and wrap in $$
    const segments = splitMathSegments(text);
    return segments.map(seg => {
      if (seg.isMath) {
        const latex = plainToLatex(seg.text);
        return `$${latex}$`;
      }
      return escapeHtml(seg.text);
    }).join('');
  }

  /**
   * Split text into math and non-math segments.
   * Math segments are detected by presence of: subscripts, superscripts,
   * fractions, Greek letters, operators.
   */
  function splitMathSegments(text) {
    // Simple heuristic: if the whole text looks like a formula, wrap all
    const MATH_HEAVY = /^[A-Za-z0-9\s\+\-\*\/\(\)\[\]_\^\.=,<>\\{}]+$/;
    const HAS_MATH_TOKEN = /[A-Za-z]_[A-Za-z0-9]|[A-Za-z0-9]\^\d|\d\/\d|\bgamma\b|\bpi\b|\bfrac\b|\bsqrt\b/i;

    if (HAS_MATH_TOKEN.test(text) && MATH_HEAVY.test(text.replace(/[°√∑∫×÷±≥≤≠∞]/g, 'x'))) {
      return [{ isMath: true, text }];
    }

    // Split on sentence boundaries and check each part
    const parts = text.split(/(\s*[.!?]\s+|\n)/);
    return parts.map(part => ({
      isMath: HAS_MATH_TOKEN.test(part),
      text: part
    }));
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /**
   * Render all math in a DOM element using KaTeX renderMathInElement.
   * Call this after inserting content into the DOM.
   */
  function render(element) {
    if (!element) return;
    if (typeof renderMathInElement === 'undefined') {
      console.warn('KaTeX renderMathInElement not loaded');
      return;
    }
    try {
      renderMathInElement(element, {
        delimiters: [
          { left: '$$', right: '$$', display: true  },
          { left: '$',  right: '$',  display: false },
          { left: '\\(', right: '\\)', display: false },
          { left: '\\[', right: '\\]', display: true  }
        ],
        throwOnError: false,
        errorColor: '#cc0000',
        strict: false
      });
    } catch(e) {
      console.warn('KaTeX render error:', e.message);
    }
  }

  /**
   * Process question text/option before inserting into DOM:
   * 1. If it already has $...$ → use as-is (Gemini gave LaTeX)
   * 2. If it has plain-text math → convert then wrap in $...$
   * 3. If no math → return plain escaped HTML
   */
  function processForDisplay(text) {
    if (!text) return '';

    // Already has LaTeX delimiters from Gemini output
    if (/\$[^$]+\$/.test(text) || /\\\(/.test(text) || /\\frac|\\sqrt|\\sum/.test(text)) {
      // Ensure inline math is wrapped properly — just return as-is for KaTeX auto-render
      return text;
    }

    // Has plain-text math tokens → convert
    if (hasMath(text)) {
      // Find all math-like substrings and wrap in $...$
      return text.replace(
        /([A-Za-z]_{[A-Za-z0-9]+}|[A-Za-z0-9]\^{?\d+}?|\\[a-z]+(?:_{[^}]+})?(?:\^{[^}]+})?|\d+(?:\.\d+)?\/\d+(?:\.\d+)?[A-Za-z]*)/g,
        (match) => {
          const latex = plainToLatex(match);
          return `$${latex}$`;
        }
      );
    }

    return text;
  }

  // Public API
  return { render, renderText, plainToLatex, hasMath, processForDisplay };

})();

// Make available globally
if (typeof window !== 'undefined') window.MathRenderer = MathRenderer;
if (typeof module !== 'undefined') module.exports = MathRenderer;
