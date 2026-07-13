#!/usr/bin/env python3
"""Strip OCR-garbage echo lines from converted .cho files.

Pattern: a widely-spaced chord-only intro row gets OCR'd twice — once cleanly
(e.g. "[G] [D] [Em] [C]") and once as a smashed-together gibberish token on the
next line (e.g. "GopeC"). Delete that single-token gibberish line when it sits
directly under a bracket-chord-only line and isn't itself a real chord.
"""
import sys, os, re

CHORD_ONLY = re.compile(r'^(?:\[[^\]]+\]\s*)+$')  # a line of only [chord] tokens
ROOT_RE = re.compile(r'\[([A-G])')                # first letter inside each [chord]
INTERJECTIONS = {'oh', 'ah', 'ooh', 'oooh', 'whoa', 'woah', 'hey', 'la', 'na',
                 'yeah', 'mmm', 'hmm', 'ooo', 'ohh', 'ahh', 'yo', 'uh'}

def is_garbage_echo(tok, prev_chord_line):
    # A smashed OCR echo of the chord row above (e.g. "GopeC", "CG", "Goce").
    # Guard hard against real content: section labels, punctuated interjections,
    # and common backing-vocal words must survive.
    if tok[:1] in '{[':                          # section label / real chord
        return False
    if re.search(r"[!?.,;:'\"()\-]", tok):       # punctuation => real lyric ("Oh!")
        return False
    if not tok.isalpha():                        # digits/symbols => leave alone
        return False
    if tok.lower() in INTERJECTIONS:             # "Ah", "Oh", "Yeah" ...
        return False
    if re.search(r'[A-Z]', tok[1:]):             # interior uppercase (GopeC)
        return True
    if tok.isupper() and len(tok) <= 4:          # all caps, short (CG, GBC)
        return True
    if not re.search(r'[aeiouAEIOU]', tok):      # no vowels (Gbpc)
        return True
    # short Title-case blob (Goce) — only if it mirrors a chord root above,
    # so real one-word lyrics ("Come", "Down") aren't nuked unless the row echoes.
    roots = set(ROOT_RE.findall(prev_chord_line))
    if len(tok) <= 5 and tok[:1] in roots:
        return True
    return False

def clean(path):
    with open(path) as f:
        lines = f.read().split('\n')
    out, removed = [], []
    prev_nonblank = None
    for ln in lines:
        s = ln.strip()
        # Only delete a garbled echo that DUPLICATES a clean chord row right above
        # it (safe: the real chords are already captured). Never delete a lone blob
        # under a section label — that's the only chord info for an instrumental row.
        if s and ' ' not in s and prev_nonblank and CHORD_ONLY.match(prev_nonblank) \
                and is_garbage_echo(s, prev_nonblank):
            removed.append((prev_nonblank, s))
            continue  # drop the echo line; don't update prev_nonblank
        out.append(ln)
        if s:
            prev_nonblank = s
    if removed:
        with open(path, 'w') as f:
            f.write('\n'.join(out))
    return removed

if __name__ == '__main__':
    folder = sys.argv[1]
    total = 0
    for name in sorted(os.listdir(folder)):
        if not name.endswith('.cho'):
            continue
        rem = clean(os.path.join(folder, name))
        if rem:
            total += len(rem)
            print(f'{name}: removed {len(rem)}')
            for chords, junk in rem:
                print(f'    "{junk}"  (under  {chords})')
    print(f'\nTotal echo lines removed: {total}')
