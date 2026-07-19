/* Self-contained QR Code generator — byte mode, EC level L, auto version + mask.
 * Faithful to ISO/IEC 18004; the app verifies it by decoding its own output with
 * the browser's BarcodeDetector. Loaded before app.js.
 *   window.QR.svg(text) -> SVG string (or null if the text is too large)
 *   window.QR.generate(text) -> { size, modules: boolean[][] } (or null)
 */
(function (root) {
  'use strict';

  // GF(256) log/antilog tables (primitive polynomial 0x11d).
  const EXP = new Array(256), LOG = new Array(256);
  for (let i = 0, x = 1; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; }
  const gmul = (a, b) => (a === 0 || b === 0) ? 0 : EXP[(LOG[a] + LOG[b]) % 255];

  // EC level L, versions 1..40: error codewords per block, and number of blocks.
  const ECC = [7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30];
  const BLK = [1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25];

  function rawModules(v) {
    let r = (16 * v + 128) * v + 64;
    if (v >= 2) { const n = ((v / 7) | 0) + 2; r -= (25 * n - 10) * n - 55; if (v >= 7) r -= 36; }
    return r;
  }
  const dataCwCount = (v) => ((rawModules(v) / 8) | 0) - ECC[v - 1] * BLK[v - 1];

  // Reed-Solomon error-correction codewords for `data` (Nayuki's algorithm).
  function rs(data, ec) {
    const gen = new Array(ec).fill(0); gen[ec - 1] = 1;
    for (let i = 0, root = 1; i < ec; i++) {
      for (let j = 0; j < ec; j++) { gen[j] = gmul(gen[j], root); if (j + 1 < ec) gen[j] ^= gen[j + 1]; }
      root = gmul(root, 2);
    }
    const res = new Array(ec).fill(0);
    for (const b of data) {
      const f = b ^ res[0]; res.shift(); res.push(0);
      for (let i = 0; i < ec; i++) res[i] ^= gmul(gen[i], f);
    }
    return res;
  }

  // Byte-mode data → interleaved data+EC codewords for the smallest fitting version.
  function encode(text) {
    const bytes = Array.from(new TextEncoder().encode(text));
    let v = 1;
    for (; v <= 40; v++) if (4 + (v < 10 ? 8 : 16) + bytes.length * 8 <= dataCwCount(v) * 8) break;
    if (v > 40) return null; // beyond QR capacity
    const bits = [];
    const push = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >> i) & 1); };
    push(0b0100, 4);                        // byte mode
    push(bytes.length, v < 10 ? 8 : 16);    // character count
    for (const b of bytes) push(b, 8);
    const cap = dataCwCount(v) * 8;
    for (let i = 0; i < 4 && bits.length < cap; i++) bits.push(0); // terminator
    while (bits.length % 8) bits.push(0);
    for (let i = 0; bits.length < cap; i++) push(i % 2 ? 0x11 : 0xEC, 8); // pad codewords
    const cw = [];
    for (let i = 0; i < bits.length; i += 8) { let x = 0; for (let j = 0; j < 8; j++) x = (x << 1) | bits[i + j]; cw.push(x); }

    // split into blocks, add EC, interleave
    const nb = BLK[v - 1], ecl = ECC[v - 1], total = cw.length;
    const short = (total / nb) | 0, nLong = total % nb;
    const blocks = []; let idx = 0;
    for (let b = 0; b < nb; b++) {
      const len = short + (b >= nb - nLong ? 1 : 0);
      const d = cw.slice(idx, idx + len); idx += len;
      blocks.push({ d, e: rs(d, ecl) });
    }
    const out = [];
    for (let i = 0; i <= short; i++) for (const bl of blocks) if (i < bl.d.length) out.push(bl.d[i]);
    for (let i = 0; i < ecl; i++) for (const bl of blocks) out.push(bl.e[i]);
    return { v, codewords: out };
  }

  function alignPositions(v, size) {
    if (v === 1) return [];
    const n = ((v / 7) | 0) + 2;
    const step = v === 32 ? 26 : Math.ceil((size - 13) / (n * 2 - 2)) * 2;
    const res = [6];
    for (let p = size - 7; res.length < n; p -= step) res.splice(1, 0, p);
    return res;
  }
  function maskFn(m, x, y) {
    switch (m) {
      case 0: return (x + y) % 2 === 0;
      case 1: return y % 2 === 0;
      case 2: return x % 3 === 0;
      case 3: return (x + y) % 3 === 0;
      case 4: return (((y / 2) | 0) + ((x / 3) | 0)) % 2 === 0;
      case 5: return (x * y) % 2 + (x * y) % 3 === 0;
      case 6: return ((x * y) % 2 + (x * y) % 3) % 2 === 0;
      default: return ((x + y) % 2 + (x * y) % 3) % 2 === 0;
    }
  }

  function generate(text) {
    const enc = encode(text);
    if (!enc) return null;
    const v = enc.v, size = 4 * v + 17;
    const mod = Array.from({ length: size }, () => new Array(size).fill(false));
    const fn = Array.from({ length: size }, () => new Array(size).fill(false));
    const setF = (x, y, dark) => { mod[y][x] = dark; fn[y][x] = true; };
    const mark = (x, y) => { fn[y][x] = true; mod[y][x] = false; };

    // timing
    for (let i = 0; i < size; i++) { setF(6, i, i % 2 === 0); setF(i, 6, i % 2 === 0); }
    // finders + separators
    const finder = (cx, cy) => {
      for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx, y = cy + dy;
        if (x < 0 || x >= size || y < 0 || y >= size) continue;
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        setF(x, y, d !== 2 && d !== 4);
      }
    };
    finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
    // alignment
    const pos = alignPositions(v, size);
    for (const ay of pos) for (const ax of pos) {
      if ((ax === 6 && ay === 6) || (ax === 6 && ay === size - 7) || (ax === size - 7 && ay === 6)) continue;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++)
        setF(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
    // reserve format + version + dark module (so data placement skips them)
    for (let i = 0; i <= 5; i++) mark(8, i);
    mark(8, 7); mark(8, 8); mark(7, 8);
    for (let i = 9; i < 15; i++) mark(14 - i, 8);
    for (let i = 0; i < 8; i++) mark(size - 1 - i, 8);
    for (let i = 8; i < 15; i++) mark(8, size - 15 + i);
    mark(8, size - 8);
    if (v >= 7) for (let i = 0; i < 18; i++) { const a = size - 11 + (i % 3), b = (i / 3) | 0; mark(a, b); mark(b, a); }

    // place data bits in the up/down zigzag
    const data = enc.codewords;
    let bi = 0;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5; // skip the timing column (mutate `right`, not a copy)
      for (let vert = 0; vert < size; vert++) {
        for (let j = 0; j < 2; j++) {
          const x = right - j;
          const upward = ((right + 1) & 2) === 0;
          const y = upward ? size - 1 - vert : vert;
          if (!fn[y][x] && bi < data.length * 8) { mod[y][x] = ((data[bi >> 3] >> (7 - (bi & 7))) & 1) === 1; bi++; }
        }
      }
    }

    const drawFormat = (m2, mask) => {
      const d = (1 << 3) | mask;             // EC level L = 1
      let rem = d;
      for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >> 9) * 0x537);
      const bits = ((d << 10) | rem) ^ 0x5412;
      const bit = (i) => ((bits >> i) & 1) === 1;
      for (let i = 0; i <= 5; i++) m2[i][8] = bit(i);
      m2[7][8] = bit(6); m2[8][8] = bit(7); m2[8][7] = bit(8);
      for (let i = 9; i < 15; i++) m2[8][14 - i] = bit(i);
      for (let i = 0; i < 8; i++) m2[8][size - 1 - i] = bit(i);
      for (let i = 8; i < 15; i++) m2[size - 15 + i][8] = bit(i);
      m2[size - 8][8] = true;
    };
    const drawVersion = (m2) => {
      if (v < 7) return;
      let rem = v;
      for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >> 11) * 0x1F25);
      const bits = (v << 12) | rem;
      for (let i = 0; i < 18; i++) { const bit = ((bits >> i) & 1) === 1, a = size - 11 + (i % 3), b = (i / 3) | 0; m2[b][a] = bit; m2[a][b] = bit; }
    };
    const penalty = (m) => {
      let p = 0;
      const run = (get) => { for (let a = 0; a < size; a++) { let c = 1; for (let b = 1; b < size; b++) { if (get(a, b) === get(a, b - 1)) { c++; if (c === 5) p += 3; else if (c > 5) p++; } else c = 1; } } };
      run((y, x) => m[y][x]); run((x, y) => m[y][x]);
      for (let y = 0; y < size - 1; y++) for (let x = 0; x < size - 1; x++)
        if (m[y][x] === m[y][x + 1] && m[y][x] === m[y + 1][x] && m[y][x] === m[y + 1][x + 1]) p += 3;
      const p1 = [true, false, true, true, true, false, true, false, false, false, false];
      const p2 = [false, false, false, false, true, false, true, true, true, false, true];
      for (let y = 0; y < size; y++) for (let x = 0; x <= size - 11; x++) {
        let a = true, b = true; for (let k = 0; k < 11; k++) { if (m[y][x + k] !== p1[k]) a = false; if (m[y][x + k] !== p2[k]) b = false; } if (a || b) p += 40;
      }
      for (let x = 0; x < size; x++) for (let y = 0; y <= size - 11; y++) {
        let a = true, b = true; for (let k = 0; k < 11; k++) { if (m[y + k][x] !== p1[k]) a = false; if (m[y + k][x] !== p2[k]) b = false; } if (a || b) p += 40;
      }
      let dark = 0; for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (m[y][x]) dark++;
      p += Math.floor(Math.abs((dark / (size * size)) * 100 - 50) / 5) * 10;
      return p;
    };

    // pick the lowest-penalty mask
    let bestPen = Infinity, bestMod = null;
    for (let mask = 0; mask < 8; mask++) {
      const t = mod.map((r) => r.slice());
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!fn[y][x] && maskFn(mask, x, y)) t[y][x] = !t[y][x];
      drawFormat(t, mask);
      const p = penalty(t);
      if (p < bestPen) { bestPen = p; bestMod = t; }
    }
    drawVersion(bestMod);
    return { size, modules: bestMod };
  }

  function svg(text, opts) {
    const q = generate(text);
    if (!q) return null;
    const quiet = (opts && opts.quiet != null) ? opts.quiet : 4;
    const n = q.size + quiet * 2;
    let path = '';
    for (let y = 0; y < q.size; y++) for (let x = 0; x < q.size; x++)
      if (q.modules[y][x]) path += `M${x + quiet},${y + quiet}h1v1h-1z`;
    return `<svg viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges" xmlns="http://www.w3.org/2000/svg">` +
      `<rect width="${n}" height="${n}" fill="#fff"/><path d="${path}" fill="#000"/></svg>`;
  }

  root.QR = { generate, svg };
})(typeof window !== 'undefined' ? window : globalThis);
