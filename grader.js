/* Grading engine.
 *
 * gradeCard(canvas) returns { overall, tier, centering, corners, edges,
 * surface, box, inner }. Centering is measured for real via background
 * segmentation + skew correction; corners/edges/surface use lightweight
 * image heuristics so they vary per photo. These are estimates.
 *
 * When a real grading API (e.g. PokéGrade) is configured, app.js routes
 * through /api/grade instead and this local path becomes the offline
 * fallback — the return shape is identical either way.
 */
window.Grader = (function () {
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function round2(v) { return Math.round(v * 2) / 2; }

  function grade(canvas) {
    const W = canvas.width, H = canvas.height;
    const ctx = canvas.getContext("2d");
    const data = ctx.getImageData(0, 0, W, H).data;

    const bg = sampleBackground(data, W, H);

    // Skew correction (once) before measuring.
    if (bg) {
      const angle = estimateSkew(data, W, H, bg);
      if (Math.abs(angle) > 0.012 && Math.abs(angle) < 0.22) {
        deskew(canvas, angle, bg);
        return grade(canvas);
      }
    }

    const gray = grayscale(data, W, H);
    const box = bg ? findCardBounds(data, W, H, bg) : findCardByEnergy(gray, W, H);

    let centering = null, inner = null;
    if (box) {
      inner = findInnerFrame(gray, W, H, box);
      const left = inner.x0 - box.x0, right = box.x1 - inner.x1;
      const top = inner.y0 - box.y0, bottom = box.y1 - inner.y1;
      if (left > 0 && right > 0 && top > 0 && bottom > 0) {
        const h = Math.min(left, right) / (left + right);
        const v = Math.min(top, bottom) / (top + bottom);
        const offset = 0.5 - Math.min(h, v);
        centering = clamp(round2(10 - offset * 22), 1, 10);
      }
    }

    const region = box || { x0: 0, y0: 0, x1: W - 1, y1: H - 1 };
    const corners = round2(cornerScore(data, W, H, region));
    const edges = round2(edgeScore(data, W, H, region));
    const surface = round2(surfaceScore(gray, W, region));

    // Overall: weighted, with the weakest sub-grade capping the result.
    const parts = centering != null
      ? [[centering, 0.35], [corners, 0.25], [edges, 0.2], [surface, 0.2]]
      : [[corners, 0.4], [edges, 0.3], [surface, 0.3]];
    const weighted = parts.reduce((s, [v, w]) => s + v * w, 0);
    const lowest = Math.min(...parts.map((p) => p[0]));
    const overall = clamp(round2(Math.min(weighted, lowest + 1.5)), 1, 10);

    return {
      overall, tier: tierFor(overall),
      centering, corners, edges, surface,
      box: region, inner,
    };
  }

  function tierFor(g) {
    if (g >= 10) return "GEM MINT";
    if (g >= 9) return "MINT";
    if (g >= 8) return "NM-MINT";
    if (g >= 7) return "NEAR MINT";
    if (g >= 6) return "EX-MINT";
    if (g >= 5) return "EXCELLENT";
    if (g >= 4) return "VG-EX";
    if (g >= 3) return "VERY GOOD";
    if (g >= 2) return "GOOD";
    return "POOR";
  }

  /* ---- shared helpers (see prior grader for derivation) ------------- */
  function grayscale(data, W, H) {
    const g = new Float32Array(W * H);
    for (let i = 0, p = 0; i < data.length; i += 4, p++)
      g[p] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    return g;
  }

  function avgPatch(data, W, px, py, s) {
    let r = 0, g = 0, b = 0, n = 0;
    for (let y = py; y < py + s; y++)
      for (let x = px; x < px + s; x++) {
        const i = (y * W + x) * 4;
        r += data[i]; g += data[i + 1]; b += data[i + 2]; n++;
      }
    return { r: r / n, g: g / n, b: b / n };
  }

  function sampleBackground(data, W, H) {
    const s = Math.max(4, Math.round(Math.min(W, H) * 0.05));
    const c = [[0, 0], [W - s, 0], [0, H - s], [W - s, H - s]].map(([x, y]) => avgPatch(data, W, x, y, s));
    const mean = {
      r: (c[0].r + c[1].r + c[2].r + c[3].r) / 4,
      g: (c[0].g + c[1].g + c[2].g + c[3].g) / 4,
      b: (c[0].b + c[1].b + c[2].b + c[3].b) / 4,
    };
    const dev = Math.max(...c.map((p) => Math.abs(p.r - mean.r) + Math.abs(p.g - mean.g) + Math.abs(p.b - mean.b)));
    return dev > 95 ? null : mean;
  }

  const BG_TOL = 60;
  function isFg(data, idx, bg) {
    return Math.abs(data[idx] - bg.r) + Math.abs(data[idx + 1] - bg.g) + Math.abs(data[idx + 2] - bg.b) > BG_TOL;
  }

  function findCardBounds(data, W, H, bg) {
    const col = new Int32Array(W), row = new Int32Array(H);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++)
        if (isFg(data, (y * W + x) * 4, bg)) { col[x]++; row[y]++; }
    const x0 = edgeSide(col, H * 0.35, 1), x1 = edgeSide(col, H * 0.35, -1);
    const y0 = edgeSide(row, W * 0.35, 1), y1 = edgeSide(row, W * 0.35, -1);
    if (x1 - x0 < W * 0.2 || y1 - y0 < H * 0.2) return null;
    return { x0, x1, y0, y1 };
  }
  function edgeSide(c, t, dir) {
    const n = c.length;
    if (dir > 0) { for (let i = 0; i < n; i++) if (c[i] > t) return i; return 0; }
    for (let i = n - 1; i >= 0; i--) if (c[i] > t) return i; return n - 1;
  }

  function findCardByEnergy(gray, W, H) {
    const col = new Float32Array(W), row = new Float32Array(H);
    for (let y = 0; y < H; y++)
      for (let x = 1; x < W; x++) {
        const d = Math.abs(gray[y * W + x] - gray[y * W + x - 1]);
        col[x] += d; row[y] += d;
      }
    const f = (a, s, e) => {
      const peak = Math.max(...a), th = peak * 0.18, dir = e > s ? 1 : -1;
      for (let i = s; dir > 0 ? i < e : i > e; i += dir) if (a[i] > th) return i;
      return s;
    };
    const x0 = f(col, 1, W), x1 = f(col, W - 2, -1), y0 = f(row, 1, H), y1 = f(row, H - 2, -1);
    const box = { x0: Math.min(x0, x1), x1: Math.max(x0, x1), y0: Math.min(y0, y1), y1: Math.max(y0, y1) };
    if (box.x1 - box.x0 < W * 0.2 || box.y1 - box.y0 < H * 0.2) return null;
    return box;
  }

  function findInnerFrame(gray, W, H, card) {
    const colE = new Float32Array(W), rowE = new Float32Array(H);
    for (let y = card.y0; y <= card.y1; y++)
      for (let x = card.x0 + 1; x <= card.x1; x++)
        colE[x] += Math.abs(gray[y * W + x] - gray[y * W + x - 1]);
    for (let y = card.y0 + 1; y <= card.y1; y++)
      for (let x = card.x0; x <= card.x1; x++)
        rowE[y] += Math.abs(gray[y * W + x] - gray[(y - 1) * W + x]);
    const cw = card.x1 - card.x0, ch = card.y1 - card.y0, m = 0.04;
    const scan = (a, from, to, dir) => {
      let bi = from, best = -1;
      for (let i = from; dir > 0 ? i <= to : i >= to; i += dir) if (a[i] > best) { best = a[i]; bi = i; }
      return bi;
    };
    return {
      x0: scan(colE, card.x0 + Math.round(cw * m), card.x0 + Math.round(cw * 0.45), 1),
      x1: scan(colE, card.x1 - Math.round(cw * m), card.x1 - Math.round(cw * 0.45), -1),
      y0: scan(rowE, card.y0 + Math.round(ch * m), card.y0 + Math.round(ch * 0.45), 1),
      y1: scan(rowE, card.y1 - Math.round(ch * m), card.y1 - Math.round(ch * 0.45), -1),
    };
  }

  /* ---- skew ---- */
  function estimateSkew(data, W, H, bg) {
    let n = 0, sx = 0, sy = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++)
      if (isFg(data, (y * W + x) * 4, bg)) { n++; sx += x; sy += y; }
    if (n < W * H * 0.05) return 0;
    const cx = sx / n, cy = sy / n;
    let Sxx = 0, Syy = 0, Sxy = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++)
      if (isFg(data, (y * W + x) * 4, bg)) {
        const dx = x - cx, dy = y - cy; Sxx += dx * dx; Syy += dy * dy; Sxy += dx * dy;
      }
    let tilt = 0.5 * Math.atan2(2 * Sxy, Sxx - Syy) - Math.PI / 2;
    if (tilt < -Math.PI / 2) tilt += Math.PI;
    if (tilt > Math.PI / 2) tilt -= Math.PI;
    return tilt;
  }
  function deskew(canvas, angle, bg) {
    const W = canvas.width, H = canvas.height;
    const tmp = document.createElement("canvas"); tmp.width = W; tmp.height = H;
    tmp.getContext("2d").drawImage(canvas, 0, 0);
    const ctx = canvas.getContext("2d");
    ctx.save();
    ctx.fillStyle = `rgb(${bg.r | 0},${bg.g | 0},${bg.b | 0})`;
    ctx.fillRect(0, 0, W, H);
    ctx.translate(W / 2, H / 2); ctx.rotate(-angle); ctx.translate(-W / 2, -H / 2);
    ctx.drawImage(tmp, 0, 0);
    ctx.restore();
  }

  /* ---- condition heuristics (estimates) ---- */
  // Whitening near a corner: fraction of bright, low-saturation pixels.
  function whiteness(data, W, x, y) {
    const i = (y * W + x) * 4, r = data[i], g = data[i + 1], b = data[i + 2];
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    const sat = mx === 0 ? 0 : (mx - mn) / mx;
    return mx > 150 && sat < 0.22 ? 1 : 0;
  }

  function cornerScore(data, W, H, box) {
    const s = Math.max(6, Math.round((box.x1 - box.x0) * 0.09));
    const corners = [
      [box.x0, box.y0], [box.x1 - s, box.y0], [box.x0, box.y1 - s], [box.x1 - s, box.y1 - s],
    ];
    let white = 0, n = 0;
    for (const [px, py] of corners)
      for (let y = py; y < py + s; y++)
        for (let x = px; x < px + s; x++) { white += whiteness(data, W, x, y); n++; }
    const frac = white / Math.max(1, n);
    return clamp(10 - frac * 34, 3, 10); // more corner whitening -> lower
  }

  function edgeScore(data, W, H, box) {
    const t = 2; // sample a thin band along each edge
    let white = 0, n = 0;
    const add = (x, y) => { white += whiteness(data, W, x, y); n++; };
    for (let x = box.x0; x <= box.x1; x++) for (let k = 0; k < t; k++) { add(x, box.y0 + k); add(x, box.y1 - k); }
    for (let y = box.y0; y <= box.y1; y++) for (let k = 0; k < t; k++) { add(box.x0 + k, y); add(box.x1 - k, y); }
    const frac = white / Math.max(1, n);
    return clamp(10 - frac * 24, 3, 10);
  }

  // Surface: high-frequency streak energy in the interior (scratches/print lines).
  function surfaceScore(gray, W, box) {
    const ix0 = box.x0 + Math.round((box.x1 - box.x0) * 0.18);
    const ix1 = box.x1 - Math.round((box.x1 - box.x0) * 0.18);
    const iy0 = box.y0 + Math.round((box.y1 - box.y0) * 0.18);
    const iy1 = box.y1 - Math.round((box.y1 - box.y0) * 0.18);
    let sum = 0, sq = 0, n = 0;
    for (let y = iy0 + 1; y < iy1; y++)
      for (let x = ix0 + 1; x < ix1; x++) {
        // Laplacian-ish local contrast
        const c = gray[y * W + x];
        const lap = 4 * c - gray[y * W + x - 1] - gray[y * W + x + 1] - gray[(y - 1) * W + x] - gray[(y + 1) * W + x];
        const a = Math.abs(lap);
        sum += a; sq += a * a; n++;
      }
    if (!n) return 8;
    const mean = sum / n;
    const varr = sq / n - mean * mean;
    // Higher variance of local contrast => more scratches/noise => lower.
    const rough = Math.sqrt(Math.max(0, varr));
    return clamp(10 - (rough - 6) * 0.12, 4, 10);
  }

  return { grade };
})();
