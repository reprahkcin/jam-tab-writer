#!/usr/bin/env python3
"""OCR an image-based Ultimate Guitar PDF into a .cho chords-over-lyrics file.

Pipeline: pdftoppm -> tesseract TSV (word boxes) -> reconstruct monospace layout
from x-positions -> merge chord lines into lyric lines as inline [chord].
"""
import subprocess, sys, re, os, tempfile, statistics

CHORD_RE = re.compile(r'^[A-G][#b]?(?:maj|min|sus|add|aug|dim|m|M|Δ|°|\+|-|[0-9]|#|b|\(|\))*(?:/[A-G][#b]?)?$')

# One chord anywhere in a string (not anchored) — root + optional accidental +
# optional quality/extensions + optional slash bass. Lowercase roots allowed
# because OCR frequently lowercases them.
_QUAL = (r'(?:maj7|maj9|maj|min7|min|sus2|sus4|sus|add9|add11|add2|add|aug|'
         r'dim7|dim|m7b5|m7|m9|m6|m11|m|°|Δ|6|7|9|11|13|2|4|5|#11|#9|b9|#5|b5)')
_ONE = re.compile(r'[A-Ga-g][#b]?' + _QUAL + r'*(?:/[A-Ga-g][#b]?)?')

def clean_chord_tok(t):
    # OCR often lowercases the root (C->c) or doubles it (C->Cc); fix both.
    if len(t) >= 2 and t[0].lower() == t[1].lower() and t[0].lower() in 'abcdefg':
        t = t[0] + t[2:]
    return t[0].upper() + t[1:] if t else t

def _norm_one(c):
    c = c[0].upper() + c[1:]
    return re.sub(r'/([a-g])', lambda m: '/' + m.group(1).upper(), c)

def _ocr_fix(tok):
    """Narrow, safe OCR corrections inside chord tokens. Both target an uppercase
    root so common lowercase words ('an', 'as', 'son') are untouched."""
    tok = re.sub(r'(?<=[A-G])S\b', '5', tok)       # power chord: DS -> D5
    tok = re.sub(r'(?<=[A-G])n([79]?)$', r'm\1', tok)  # minor: Dn -> Dm
    return tok

def parse_chords(tok, allow_bare=False):
    """If the whole token is a run of concatenated chords, return them as a list
    (splitting OCR-merged blobs like 'EmD' -> ['Em','D']); else None.
    allow_bare keeps runs of 3+ bare single-letter roots (real for instrumental
    rows like 'GBC', but a lyric word like 'bad' when reading lyric context)."""
    tok = _ocr_fix(tok.replace('|', ''))
    if not tok:
        return None
    out, i, n = [], 0, len(tok)
    while i < n:
        m = _ONE.match(tok, i)
        if not m or m.end() == i:
            return None
        out.append(_norm_one(m.group()))
        i = m.end()
    # collapse a chord doubled within one blob (OCR echo: 'Cc' -> C)
    dd = []
    for c in out:
        if not dd or dd[-1] != c:
            dd.append(c)
    # 3+ bare single-letter roots is ambiguous: a lyric word ("bad"->B,A,D) or an
    # instrumental chord row ("FCGF"). Case decides — words are lowercase, chord
    # rows uppercase — but only trust that in chord context (allow_bare).
    if len(dd) >= 3 and all(re.fullmatch(r'[A-G]', c) for c in dd):
        if not (allow_bare and not any(ch.islower() for ch in tok)):
            return None
    return dd or None

# An uppercase chord blob = an instrumental row (intro/solo/outro) whose spaces
# OCR dropped: "GBC", "EAEA", "DGDAG", "D5G5". All-uppercase distinguishes it from
# a lyric word ("bad", "Dad"), so bare 3+ root runs are safe to bracket here.
INSTR_BLOB = re.compile(r'^[A-G][A-G0-9#b/]*$')

def is_chord(tok):
    return parse_chords(tok) is not None

def render_pages(pdf, dpi=200):
    d = tempfile.mkdtemp()
    subprocess.run(['pdftoppm', '-png', '-r', str(dpi), pdf, os.path.join(d, 'p')],
                   check=True, stderr=subprocess.DEVNULL)
    return sorted(os.path.join(d, f) for f in os.listdir(d) if f.endswith('.png'))

def ocr_words(png):
    """Return list of words: {text,left,top,width,height,conf,line_key}."""
    out = subprocess.run(['tesseract', png, '-', '--psm', '4', 'tsv'],
                         capture_output=True, text=True).stdout
    words = []
    for row in out.splitlines()[1:]:
        c = row.split('\t')
        if len(c) < 12 or c[0] != '5':
            continue
        text = c[11].strip()
        if not text:
            continue
        words.append(dict(text=text, left=int(c[6]), top=int(c[7]), width=int(c[8]),
                          height=int(c[9]), conf=float(c[10]),
                          line_key=(int(c[2]), int(c[3]), int(c[4]))))
    return words

def group_lines(words):
    """Group words into visual lines by vertical overlap; sort each by x."""
    words = sorted(words, key=lambda w: (w['top'], w['left']))
    lines, cur, cur_top, h = [], [], None, statistics.median([w['height'] for w in words]) if words else 12
    for w in words:
        if cur_top is None or abs(w['top'] - cur_top) <= h * 0.6:
            cur.append(w); cur_top = w['top'] if cur_top is None else (cur_top + w['top']) / 2
        else:
            lines.append(sorted(cur, key=lambda x: x['left'])); cur = [w]; cur_top = w['top']
    if cur:
        lines.append(sorted(cur, key=lambda x: x['left']))
    return lines

def char_px(words):
    """Estimate monospace char width from word width / length."""
    ratios = [w['width'] / len(w['text']) for w in words if len(w['text']) >= 3]
    return statistics.median(ratios) if ratios else 10.0

def layout_line(line, cpx, x0):
    """Render one visual line as monospace text using x-positions."""
    s = ''
    for w in line:
        col = max(0, round((w['left'] - x0) / cpx))
        if col < len(s):
            col = len(s) + 1
        s += ' ' * (col - len(s)) + w['text']
    return s

def is_chord_line(text):
    toks = text.replace('|', ' ').split()
    if not toks:
        return False
    good = sum(1 for t in toks if parse_chords(t))
    return good >= 1 and good / len(toks) >= 0.6

def collapse(s):
    return re.sub(r' {2,}', ' ', s).strip()

def merge(chord_text, lyric):
    """Insert [chord] into lyric at each chord's column.
    OCR-merged blobs (e.g. 'EmD') expand to several chords placed adjacently,
    since their true separate columns are unrecoverable."""
    inserts, seq = [], 0
    for m in re.finditer(r'\S+', chord_text.replace('|', ' ')):
        chords = parse_chords(m.group(), allow_bare=True)
        if not chords:
            continue
        # A chord whose column falls in the gap between two words belongs to the
        # next word -- slide past the spaces to its start. Inserting on the gap
        # instead would consume it and smash the words together ("one[G]word").
        col = m.start()
        while col < len(lyric) and lyric[col] == ' ':
            col += 1
        # Clamp overhanging chords to the lyric end NOW, not at apply time: the
        # string grows as brackets go in, so a late clamp lands each chord at a
        # different spot -- reversing a trailing turnaround and splitting
        # brackets. Clamped to one column, they share it and seq keeps order.
        col = min(col, len(lyric))
        for ch in chords:  # merged blob -> chords share the column, stay grouped
            inserts.append((col, seq, '[' + ch + ']')); seq += 1
    s = lyric
    for col, _, tag in sorted(inserts, key=lambda x: (x[0], x[1]), reverse=True):
        s = s[:min(col, len(s))] + tag + s[min(col, len(s)):]
    return collapse(s)  # chords now sit at word starts; no space-eating needed

SECTION_RE = re.compile(r'^\[([A-Za-z][\w /\'-]{0,24})\]$')

def normalize_chord(tok):
    return clean_chord_tok(tok)

def bracket_chord_line(text):
    out = []
    for t in text.replace('|', ' ').split():
        chords = parse_chords(t, allow_bare=True)
        if chords:
            out += ['[' + c + ']' for c in chords]
        else:
            out.append(t)
    return ' '.join(out)

def raw_lines(pdf):
    out = []
    for png in render_pages(pdf):
        words = ocr_words(png)
        if not words:
            continue
        cpx = char_px(words)
        x0 = min(w['left'] for w in words)
        for ln in group_lines(words):
            out.append(layout_line(ln, cpx, x0))
    return out

def parse_meta(lines):
    meta = {}
    for ln in lines[:20]:
        t = ln.strip()
        m = re.match(r'^(.*?)\s+Chords\s+by\s+(.+?)(?:\s+[a-z]{1,3})?$', t, re.I)
        if m and 'title' not in meta:
            meta['title'] = collapse(m.group(1))
            meta['artist'] = collapse(re.sub(r'\s+[a-z]{1,3}$', '', m.group(2)))
        mc = re.match(r'^Capo:?\s*(\d+)', t, re.I)
        if mc:
            meta['capo'] = int(mc.group(1))
        mk = re.match(r'^Key:?\s*([A-G][#b]?m?)\b', t, re.I)
        if mk:
            meta['key'] = mk.group(1)
    return meta

HEADER_RE = re.compile(r'https?://|chordify|^\s*(capo|tuning|difficulty|tabbed by|'
                       r'artist|song|key)\b', re.I)

def find_body_start(lines):
    """Where the song body begins. Normally the first {Section}; but charts
    without section labels (e.g. chordify exports) need the header skipped and
    the body started at the first chord line."""
    sec = next((i for i, ln in enumerate(lines) if SECTION_RE.match(ln.strip())), None)
    if sec is not None:
        return sec
    for i, ln in enumerate(lines):
        s = ln.strip()
        if i == 0 or not s or HEADER_RE.search(s):  # skip title, blanks, header notes
            continue
        if is_chord_line(s):
            return i
    for i, ln in enumerate(lines):                    # fallback: first real content line
        s = ln.strip()
        if i == 0 or not s or HEADER_RE.search(s):
            continue
        return i
    return len(lines)

def to_cho(pdf):
    lines = raw_lines(pdf)
    meta = parse_meta(lines)
    # The filename is the clean song title; OCR of the header is noisy
    # ("I Won't Back Down" -> "| Wont Back Down"), so always prefer the filename.
    meta['title'] = os.path.splitext(os.path.basename(pdf))[0]
    start = find_body_start(lines)
    body_src = [ln.rstrip() for ln in lines[start:] if not re.match(r'^\s*Page\s*\d', ln)]

    out = []
    i = 0
    while i < len(body_src):
        ln = body_src[i]
        s = ln.strip()
        sec = SECTION_RE.match(s)
        if sec:
            out.append('{' + collapse(sec.group(1)) + '}'); i += 1; continue
        if not s:
            out.append(''); i += 1; continue
        if is_chord_line(s):
            nxt = body_src[i + 1] if i + 1 < len(body_src) else ''
            ns = nxt.strip()
            # Merge into the next line only if it looks like real lyrics (has
            # several words) — avoids corrupting chord-only rows whose OCR-mangled
            # neighbour is a single gibberish token.
            if ns and ' ' in ns and not is_chord_line(ns) and not SECTION_RE.match(ns):
                out.append(merge(ln, nxt)); i += 2; continue
            out.append(bracket_chord_line(collapse(s))); i += 1; continue
        # A lone uppercase chord blob (spaces dropped by OCR) = instrumental row.
        if ' ' not in s and INSTR_BLOB.match(s):
            chords = parse_chords(s, allow_bare=True)
            if chords and len(chords) >= 2:
                out.append(' '.join('[' + c + ']' for c in chords)); i += 1; continue
        out.append(collapse(s)); i += 1

    hdr = ''
    if meta.get('title'): hdr += '{title: %s}\n' % meta['title']
    if meta.get('artist'): hdr += '{artist: %s}\n' % meta['artist']
    if meta.get('key'): hdr += '{key: %s}\n' % meta['key']
    if meta.get('capo'): hdr += '{capo: %s}\n' % meta['capo']
    body = '\n'.join(out).strip('\n')
    # collapse 3+ blank lines
    body = re.sub(r'\n{3,}', '\n\n', body)
    return (hdr + '\n' + body if hdr else body) + '\n'

if __name__ == '__main__':
    sys.stdout.write(to_cho(sys.argv[1]))
