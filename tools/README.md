# PDF → ChordPro (.cho) conversion tools

Batch-convert image-based Ultimate Guitar PDF charts (the kind exported as
full-page JPEGs, with no embedded text) into `.cho` chords-over-lyrics files the
app can open in folder mode.

## Requirements

- `python3` (standard library only)
- [poppler](https://poppler.freedesktop.org/) — provides `pdftoppm`
- [tesseract](https://github.com/tesseract-ocr/tesseract) OCR

On macOS: `brew install poppler tesseract`

## Usage

```sh
# Convert every PDF in a folder, writing .cho files to an output folder:
tools/pdf2cho-batch.sh "path/to/pdfs" "path/to/output"

# Convert one PDF to stdout:
python3 tools/pdf2cho.py "path/to/song.pdf" > song.cho

# Strip OCR garbage-echo lines from already-converted .cho files (idempotent):
python3 tools/cleanup.py "path/to/output"

# Diagnose chord-capture loss (chords in OCR vs chords landed in .cho):
python3 tools/diag.py "path/to/pdfs" "path/to/output"
```

## How it works

`pdf2cho.py`:
1. `pdftoppm` renders each page to PNG (200 dpi).
2. `tesseract --psm 4` returns word boxes (TSV with x/y positions).
3. Words are grouped into visual lines and rendered as monospace text using
   their x-positions, so a chord sitting above a syllable lands in the right
   column.
4. Chord lines are detected and merged into the following lyric line as inline
   `[chord]` tokens; section labels become `{Section}`; title comes from the
   filename; artist/key/capo are scraped from the header.

The chord parser splits OCR-merged blobs (`EmD` → `[Em] [D]`, `CG` → `[C] [G]`),
brackets uppercase instrumental rows (`GBC` → `[G] [B] [C]`), and applies narrow
OCR fixups (`DS` → `D5`, `Dn` → `Dm`) while protecting lyric words (`bad`, `ace`).

## Known limitations

- **Fingerpicking / lead tablature** (ASCII tab, not chords-over-lyrics) can't be
  meaningfully converted — those come out as metadata stubs for manual handling.
- **Unusual voicings** (`C/G`, `D9/11`) and tab-measure notation (`‖: … :‖ %`)
  in intros may not fully parse.
- Chord-dense sections can bunch or slightly offset chords.

Treat the output as **review-ready drafts**: open in the app, skim, fix the odd
chord. Far faster than typing from scratch, not push-button-perfect (the ceiling
for OCR of image PDFs).
