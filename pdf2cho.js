/* PDF -> ChordPro (.cho) conversion, in the browser.
 *
 * A port of tools/pdf2cho.py: reconstruct a monospace layout from word x/y
 * boxes, then merge each chord line into the lyric line below it as inline
 * [chord] tokens.
 *
 * Text comes from the PDF's own text layer when it has one (exact and instant).
 * Image-only PDFs -- the Ultimate Guitar exports this was built for -- fall back
 * to OCR. pdf.js and Tesseract are fetched from a CDN on first use only, so the
 * app itself stays dependency-free and costs nothing to load for everyone who
 * never drops a PDF.
 */
(function (root) {
  'use strict';

  const PDFJS = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.6.82/build/pdf.min.mjs';
  const PDFJS_WORKER = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.6.82/build/pdf.worker.min.mjs';
  const TESS = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
  const TESS_WORKER = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/worker.min.js';
  const TESS_CORE = 'https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.0';
  const TESS_LANG = 'https://cdn.jsdelivr.net/gh/naptha/tessdata@gh-pages/4.0.0_fast';

  const OCR_DPI = 200;          // what the Python pipeline renders at
  const TEXT_CHARS_PER_PAGE = 40; // below this, treat the PDF as image-only

  // ---- chord grammar (mirrors pdf2cho.py) ----------------------------------

  const QUAL =
    '(?:maj7|maj9|maj|min7|min|sus2|sus4|sus|add9|add11|add2|add|aug|' +
    'dim7|dim|m7b5|m7|m9|m6|m11|m|°|Δ|6|7|9|11|13|2|4|5|#11|#9|b9|#5|b5)';
  // Sticky, so exec() at lastIndex anchors there -- Python's _ONE.match(tok, i).
  const ONE = new RegExp('[A-Ga-g][#b]?' + QUAL + '*(?:/[A-Ga-g][#b]?)?', 'y');

  // An uppercase chord blob = an instrumental row whose spaces OCR dropped:
  // "GBC", "EAEA", "DGDAG", "D5G5".
  const INSTR_BLOB = /^[A-G][A-G0-9#b/]*$/;
  const SECTION_RE = /^\[([A-Za-z][\w /'-]{0,24})\]$/;
  const HEADER_RE = /https?:\/\/|chordify|^\s*(capo|tuning|difficulty|tabbed by|artist|song|key)\b/i;

  function ocrFix(tok) {
    // Narrow, safe OCR corrections. Both require an uppercase root, so common
    // lowercase words ('an', 'as', 'son') are untouched.
    tok = tok.replace(/(?<=[A-G])S\b/g, '5');        // power chord: DS -> D5
    tok = tok.replace(/(?<=[A-G])n([79]?)$/, 'm$1'); // minor: Dn -> Dm
    return tok;
  }

  function normOne(c) {
    c = c[0].toUpperCase() + c.slice(1);
    return c.replace(/\/([a-g])/, (_, g) => '/' + g.toUpperCase());
  }

  // If the whole token is a run of concatenated chords, return them as a list
  // (splitting OCR-merged blobs like 'EmD' -> ['Em','D']); else null.
  function parseChords(tok, allowBare) {
    tok = ocrFix(String(tok).replace(/\|/g, ''));
    if (!tok) return null;
    const out = [];
    let i = 0;
    while (i < tok.length) {
      ONE.lastIndex = i;
      const m = ONE.exec(tok);
      if (!m || !m[0]) return null;
      out.push(normOne(m[0]));
      i = ONE.lastIndex;
    }
    const dd = []; // collapse a chord doubled within one blob (OCR echo: 'Cc')
    for (const c of out) if (!dd.length || dd[dd.length - 1] !== c) dd.push(c);
    // 3+ bare roots is ambiguous: a lyric word ("bad") or a chord row ("FCGF").
    // Case decides -- words are lowercase -- but only trust that in chord context.
    if (dd.length >= 3 && dd.every((c) => /^[A-G]$/.test(c))) {
      if (!(allowBare && !/[a-z]/.test(tok))) return null;
    }
    return dd.length ? dd : null;
  }

  function isChordLine(text) {
    const toks = text.replace(/\|/g, ' ').split(/\s+/).filter(Boolean);
    if (!toks.length) return false;
    const good = toks.filter((t) => parseChords(t)).length;
    return good >= 1 && good / toks.length >= 0.6;
  }

  const collapse = (s) => s.replace(/ {2,}/g, ' ').trim();

  // Insert [chord] into the lyric at each chord's column, then tidy spacing.
  // An OCR-merged blob expands to several chords sharing one column, since their
  // true separate columns are unrecoverable.
  function merge(chordText, lyric) {
    const inserts = [];
    let seq = 0;
    const re = /\S+/g;
    let m;
    while ((m = re.exec(chordText.replace(/\|/g, ' ')))) {
      const chords = parseChords(m[0], true);
      if (!chords) continue;
      for (const ch of chords) inserts.push([m.index, seq++, '[' + ch + ']']);
    }
    inserts.sort((a, b) => b[0] - a[0] || b[1] - a[1]);
    let s = lyric;
    for (const ins of inserts) {
      const c = Math.min(ins[0], s.length);
      s = s.slice(0, c) + ins[2] + s.slice(c);
    }
    return collapse(s.replace(/(\]) +/g, '$1')); // keep [chord] glued to its word
  }

  function bracketChordLine(text) {
    const out = [];
    for (const t of text.replace(/\|/g, ' ').split(/\s+/).filter(Boolean)) {
      const chords = parseChords(t, true);
      if (chords) out.push(...chords.map((c) => '[' + c + ']'));
      else out.push(t);
    }
    return out.join(' ');
  }

  // ---- layout reconstruction ------------------------------------------------

  function median(xs) {
    if (!xs.length) return 0;
    const a = [...xs].sort((p, q) => p - q);
    const m = a.length >> 1;
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  }

  // Group words into visual lines by vertical overlap; sort each by x.
  function groupLines(words) {
    const ws = [...words].sort((a, b) => a.top - b.top || a.left - b.left);
    const h = ws.length ? median(ws.map((w) => w.height)) : 12;
    const lines = [];
    let cur = [], curTop = null;
    for (const w of ws) {
      if (curTop === null || Math.abs(w.top - curTop) <= h * 0.6) {
        cur.push(w);
        curTop = curTop === null ? w.top : (curTop + w.top) / 2;
      } else {
        lines.push(cur.sort((a, b) => a.left - b.left));
        cur = [w];
        curTop = w.top;
      }
    }
    if (cur.length) lines.push(cur.sort((a, b) => a.left - b.left));
    return lines;
  }

  // Estimate monospace char width from word width / length.
  function charPx(words) {
    const r = words.filter((w) => w.text.length >= 3).map((w) => w.width / w.text.length);
    return r.length ? median(r) : 10;
  }

  function layoutLine(line, cpx, x0) {
    let s = '';
    for (const w of line) {
      let col = Math.max(0, Math.round((w.left - x0) / cpx));
      if (col < s.length) col = s.length + 1;
      s += ' '.repeat(col - s.length) + w.text;
    }
    return s;
  }

  function linesFromWords(words) {
    if (!words.length) return [];
    const cpx = charPx(words);
    let x0 = Infinity;
    for (const w of words) if (w.left < x0) x0 = w.left; // reduce, not Math.min(...)
    return groupLines(words).map((ln) => layoutLine(ln, cpx, x0));
  }

  // ---- .cho assembly --------------------------------------------------------

  function parseMeta(lines) {
    const meta = {};
    for (const ln of lines.slice(0, 20)) {
      const t = ln.trim();
      const m = t.match(/^(.*?)\s+Chords\s+by\s+(.+?)(?:\s+[a-z]{1,3})?$/i);
      if (m && !meta.title) {
        meta.title = collapse(m[1]);
        meta.artist = collapse(m[2].replace(/\s+[a-z]{1,3}$/, ''));
      }
      const mc = t.match(/^Capo:?\s*(\d+)/i);
      if (mc) meta.capo = mc[1];
      const mk = t.match(/^Key:?\s*([A-G][#b]?m?)\b/i);
      if (mk) meta.key = mk[1];
    }
    return meta;
  }

  // Where the song body begins. Normally the first {Section}; charts without
  // section labels (e.g. chordify exports) need the header skipped and the body
  // started at the first chord line.
  function findBodyStart(lines) {
    const sec = lines.findIndex((ln) => SECTION_RE.test(ln.trim()));
    if (sec !== -1) return sec;
    for (let i = 0; i < lines.length; i++) {
      const s = lines[i].trim();
      if (i === 0 || !s || HEADER_RE.test(s)) continue; // skip title, blanks, notes
      if (isChordLine(s)) return i;
    }
    for (let i = 0; i < lines.length; i++) { // fallback: first real content line
      const s = lines[i].trim();
      if (i === 0 || !s || HEADER_RE.test(s)) continue;
      return i;
    }
    return lines.length;
  }

  function toCho(lines, title) {
    const meta = parseMeta(lines);
    // The filename is the clean song title; OCR of the header is noisy
    // ("I Won't Back Down" -> "| Wont Back Down"), so always prefer it.
    meta.title = title;
    const bodySrc = lines
      .slice(findBodyStart(lines))
      .map((l) => l.replace(/\s+$/, ''))
      .filter((l) => !/^\s*Page\s*\d/.test(l));

    const out = [];
    let i = 0;
    while (i < bodySrc.length) {
      const ln = bodySrc[i];
      const s = ln.trim();
      const sec = s.match(SECTION_RE);
      if (sec) { out.push('{' + collapse(sec[1]) + '}'); i++; continue; }
      if (!s) { out.push(''); i++; continue; }
      if (isChordLine(s)) {
        const nxt = i + 1 < bodySrc.length ? bodySrc[i + 1] : '';
        const ns = nxt.trim();
        // Merge into the next line only if it looks like real lyrics (several
        // words) -- avoids corrupting a chord row whose OCR-mangled neighbour is
        // a single gibberish token.
        if (ns && ns.includes(' ') && !isChordLine(ns) && !SECTION_RE.test(ns)) {
          out.push(merge(ln, nxt)); i += 2; continue;
        }
        out.push(bracketChordLine(collapse(s))); i++; continue;
      }
      // A lone uppercase chord blob (spaces dropped by OCR) = instrumental row.
      if (!s.includes(' ') && INSTR_BLOB.test(s)) {
        const chords = parseChords(s, true);
        if (chords && chords.length >= 2) {
          out.push(chords.map((c) => '[' + c + ']').join(' ')); i++; continue;
        }
      }
      out.push(collapse(s)); i++;
    }

    let hdr = '';
    if (meta.title) hdr += '{title: ' + meta.title + '}\n';
    if (meta.artist) hdr += '{artist: ' + meta.artist + '}\n';
    if (meta.key) hdr += '{key: ' + meta.key + '}\n';
    if (meta.capo) hdr += '{capo: ' + meta.capo + '}\n';
    let body = out.join('\n').replace(/^\n+|\n+$/g, '');
    body = body.replace(/\n{3,}/g, '\n\n');
    return (hdr ? hdr + '\n' + body : body) + '\n';
  }

  // ---- cleanup (mirrors tools/cleanup.py) -----------------------------------

  const CHORD_ONLY = /^(?:\[[^\]]+\]\s*)+$/;
  const INTERJECTIONS = new Set(['oh', 'ah', 'ooh', 'oooh', 'whoa', 'woah', 'hey',
    'la', 'na', 'yeah', 'mmm', 'hmm', 'ooo', 'ohh', 'ahh', 'yo', 'uh']);

  // A smashed OCR echo of the chord row above ("GopeC", "CG", "Goce"). Guards
  // hard against real content: section labels, punctuated interjections and
  // common backing-vocal words must survive.
  function isGarbageEcho(tok, prevChordLine) {
    if (tok[0] === '{' || tok[0] === '[') return false;   // section label / chord
    if (/[!?.,;:'"()\-]/.test(tok)) return false;         // punctuation => lyric
    if (!/^[A-Za-z]+$/.test(tok)) return false;           // digits/symbols
    if (INTERJECTIONS.has(tok.toLowerCase())) return false;
    if (/[A-Z]/.test(tok.slice(1))) return true;          // interior caps (GopeC)
    if (tok === tok.toUpperCase() && tok.length <= 4) return true; // short all-caps
    if (!/[aeiou]/i.test(tok)) return true;               // no vowels (Gbpc)
    // Short title-case blob (Goce) -- only if it mirrors a chord root above, so
    // real one-word lyrics ("Come", "Down") aren't nuked unless the row echoes.
    const roots = new Set([...prevChordLine.matchAll(/\[([A-G])/g)].map((m) => m[1]));
    return tok.length <= 5 && roots.has(tok[0]);
  }

  function cleanCho(text) {
    const out = [];
    let prev = '';
    for (const line of text.split('\n')) {
      const s = line.trim();
      // Only drop a garbled echo that DUPLICATES a clean chord row right above
      // it (safe: the real chords are already captured). Never drop a lone blob
      // under a section label -- that's an instrumental row's only chord info.
      if (s && !s.includes(' ') && prev && CHORD_ONLY.test(prev) && isGarbageEcho(s, prev)) continue;
      out.push(line);
      if (s) prev = s;
    }
    return out.join('\n');
  }

  // ---- lazy CDN loaders -----------------------------------------------------

  let pdfjsP = null;
  function loadPdfjs() {
    if (!pdfjsP) {
      pdfjsP = import(/* webpackIgnore: true */ PDFJS).then((m) => {
        m.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
        return m;
      }).catch((e) => { pdfjsP = null; throw new Error('Could not load the PDF reader. ' + (navigator.onLine ? '' : 'You appear to be offline.')); });
    }
    return pdfjsP;
  }

  let tessP = null;
  function loadTesseract() {
    if (!tessP) {
      tessP = new Promise((res, rej) => {
        const sc = document.createElement('script');
        sc.src = TESS;
        sc.onload = () => res(root.Tesseract);
        sc.onerror = () => { tessP = null; rej(new Error('Could not load the OCR engine. ' + (navigator.onLine ? '' : 'You appear to be offline.'))); };
        document.head.appendChild(sc);
      });
    }
    return tessP;
  }

  // ---- page -> words --------------------------------------------------------

  async function wordsFromTextLayer(page, pdfjs) {
    const vp = page.getViewport({ scale: 1 });
    const tc = await page.getTextContent();
    const words = [];
    for (const it of tc.items) {
      const text = (it.str || '').trim();
      if (!text) continue;
      const t = pdfjs.Util.transform(vp.transform, it.transform);
      const h = Math.hypot(t[2], t[3]) || 10;
      words.push({
        text,
        left: t[4],
        top: t[5] - h, // transform lands on the baseline; lift to the box top
        width: it.width || text.length * h * 0.5,
        height: h,
      });
    }
    return words;
  }

  async function wordsFromOcr(page, worker) {
    const vp = page.getViewport({ scale: OCR_DPI / 72 });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(vp.width);
    canvas.height = Math.ceil(vp.height);
    await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
    const { data } = await worker.recognize(canvas, {}, { blocks: true, text: false });
    const words = [];
    // Walk blocks rather than data.words: the flattened getter is version-shaky.
    for (const b of data.blocks || [])
      for (const p of b.paragraphs || [])
        for (const l of p.lines || [])
          for (const w of l.words || []) {
            const text = (w.text || '').trim();
            if (!text || !w.bbox) continue;
            words.push({
              text,
              left: w.bbox.x0,
              top: w.bbox.y0,
              width: w.bbox.x1 - w.bbox.x0,
              height: w.bbox.y1 - w.bbox.y0,
            });
          }
    return words;
  }

  // ---- entry point ----------------------------------------------------------

  /* Convert a PDF File/Blob to .cho text.
   * onProgress(message) is called with human-readable status along the way.
   * Resolves { cho, usedOcr, pages }. */
  async function pdfToCho(file, onProgress) {
    const say = onProgress || (() => {});
    say('Reading PDF…');
    const pdfjs = await loadPdfjs();
    const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;

    // Try the PDF's own text layer first -- exact, instant, and it skips the
    // multi-MB OCR download entirely for charts that carry real text.
    const pages = [];
    let chars = 0;
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const words = await wordsFromTextLayer(page, pdfjs);
      chars += words.reduce((n, w) => n + w.text.length, 0);
      pages.push({ page, words });
    }

    const usedOcr = chars < TEXT_CHARS_PER_PAGE * doc.numPages;
    if (usedOcr) {
      say('Loading OCR engine… (one-time download)');
      const Tesseract = await loadTesseract();
      const worker = await Tesseract.createWorker('eng', 1, {
        workerPath: TESS_WORKER,
        corePath: TESS_CORE,
        langPath: TESS_LANG,
        logger: (m) => {
          if (m.status && m.status !== 'recognizing text') say(m.status.replace(/^\w/, (c) => c.toUpperCase()) + '…');
        },
      });
      // --psm 4: a single column of text of variable sizes, as the CLI used.
      await worker.setParameters({ tessedit_pageseg_mode: '4' });
      try {
        for (let i = 0; i < pages.length; i++) {
          say('Reading page ' + (i + 1) + ' of ' + pages.length + '…');
          pages[i].words = await wordsFromOcr(pages[i].page, worker);
        }
      } finally {
        await worker.terminate();
      }
    }

    say('Building chart…');
    const lines = [];
    for (const p of pages) lines.push(...linesFromWords(p.words));
    const title = file.name.replace(/\.[^.]+$/, '');
    return { cho: cleanCho(toCho(lines, title)), usedOcr, pages: doc.numPages };
  }

  root.PdfToCho = {
    pdfToCho,
    // exposed for the port-fidelity test against the Python pipeline
    _internals: { toCho, cleanCho, parseChords, isChordLine, merge, linesFromWords },
  };
})(typeof window !== 'undefined' ? window : globalThis);
