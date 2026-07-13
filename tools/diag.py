#!/usr/bin/env python3
"""Diagnose chord capture loss: compare chords in raw OCR chord-lines vs chords
that landed in the generated .cho."""
import sys, os, re, glob
import pdf2cho as p

def ocr_chord_tokens(pdf):
    """All chord tokens sitting in lines the OCR sees as chord-lines, in the body."""
    lines = p.raw_lines(pdf)
    start = next((i for i, ln in enumerate(lines) if p.SECTION_RE.match(ln.strip())), 0)
    toks = []
    for ln in lines[start:]:
        s = ln.strip()
        if not s or p.SECTION_RE.match(s):
            continue
        # count chord tokens whether or not the whole line qualifies as a chord line
        line_toks = [t for t in s.split() if p.is_chord(t)]
        # only treat as chord-bearing if it's chord-dominant OR a sparse chord row
        if line_toks and (p.is_chord_line(s) or (len(line_toks) >= 1 and len(s.split()) <= 8 and
                                                 len(line_toks) / max(1, len(s.split())) >= 0.4)):
            toks += [p.normalize_chord(t) for t in line_toks]
    return toks

def cho_chord_tokens(cho_path):
    with open(cho_path) as f:
        txt = f.read()
    return re.findall(r'\[([^\]]+)\]', txt)

def root(c):
    m = re.match(r'([A-G][#b]?)', c)
    return m.group(1) if m else c

if __name__ == '__main__':
    if len(sys.argv) < 3:
        sys.exit("usage: diag.py <source-pdf-folder> <cho-output-folder>")
    src, out = sys.argv[1], sys.argv[2]
    rows = []
    for pdf in sorted(glob.glob(os.path.join(src, "*.pdf"))):
        stem = os.path.splitext(os.path.basename(pdf))[0]
        cho = os.path.join(out, stem + ".cho")
        if not os.path.exists(cho):
            continue
        ocr = ocr_chord_tokens(pdf)
        got = cho_chord_tokens(cho)
        if not ocr and not got:
            continue  # tab-style / empty
        # compare as multisets of roots (chord quality often OCR-noisy)
        from collections import Counter
        oc, gc = Counter(map(root, ocr)), Counter(map(root, got))
        lost = 0
        for r, n in oc.items():
            lost += max(0, n - gc.get(r, 0))
        rows.append((stem, len(ocr), len(got), lost))
    rows.sort(key=lambda r: -r[3])
    print(f"{'song':40} {'ocr':>4} {'cho':>4} {'lost':>4}")
    print('-' * 56)
    for stem, no, ng, lost in rows:
        flag = '  <<<' if lost >= 3 else ''
        print(f"{stem[:40]:40} {no:>4} {ng:>4} {lost:>4}{flag}")
