#!/usr/bin/env bash
# Batch-convert a folder of image-based Ultimate Guitar PDFs to .cho files.
#
#   ./pdf2cho-batch.sh <source-pdf-folder> <output-cho-folder>
#
# Requires: python3, poppler (pdftoppm), tesseract.  Runs pdf2cho.py on every
# *.pdf, then cleanup.py to strip OCR garbage-echo lines.
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="${1:?source pdf folder required}"
OUT="${2:?output cho folder required}"
mkdir -p "$OUT"

n=0; ok=0; fail=0
shopt -s nullglob
for pdf in "$SRC"/*.pdf; do
  n=$((n+1))
  stem="$(basename "${pdf%.pdf}")"
  if python3 "$DIR/pdf2cho.py" "$pdf" > "$OUT/$stem.cho" 2>/dev/null && [ -s "$OUT/$stem.cho" ]; then
    ok=$((ok+1)); echo "[$n] OK   $stem"
  else
    fail=$((fail+1)); echo "[$n] FAIL $stem"
  fi
done
echo "Converted $ok, failed $fail, total $n"
python3 "$DIR/cleanup.py" "$OUT"
