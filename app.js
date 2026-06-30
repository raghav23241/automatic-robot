/* Pokémon Card Grader
 * -----------------------------------------------------------
 * Centering is measured automatically from the uploaded image:
 *   1. Locate the card within the photo (card vs. background).
 *   2. Locate the inner artwork frame within the card.
 *   3. Compare the left/right and top/bottom border widths.
 * Corners, edges and surface are rated by the user.
 * An overall grade is derived in a PSA-like weighted fashion.
 */

const els = {
  dropzone: document.getElementById("dropzone"),
  fileInput: document.getElementById("fileInput"),
  cardFigure: document.getElementById("cardFigure"),
  cardCanvas: document.getElementById("cardCanvas"),
  overlayCanvas: document.getElementById("overlayCanvas"),
  resetBtn: document.getElementById("resetBtn"),

  centeringValue: document.getElementById("centeringValue"),
  centeringMeter: document.getElementById("centeringMeter"),
  centeringNote: document.getElementById("centeringNote"),

  corners: document.getElementById("corners"),
  edges: document.getElementById("edges"),
  surface: document.getElementById("surface"),
  cornersValue: document.getElementById("cornersValue"),
  edgesValue: document.getElementById("edgesValue"),
  surfaceValue: document.getElementById("surfaceValue"),

  result: document.getElementById("result"),
  gradeNumber: document.getElementById("gradeNumber"),
  gradeLabel: document.getElementById("gradeLabel"),
  gradeDesc: document.getElementById("gradeDesc"),
};

const state = {
  hasImage: false,
  centering: null, // 1..10 or null
};

/* ------------------------------------------------------------------ */
/* Upload handling                                                     */
/* ------------------------------------------------------------------ */

els.dropzone.addEventListener("click", () => els.fileInput.click());
els.dropzone.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    els.fileInput.click();
  }
});
els.fileInput.addEventListener("change", (e) => {
  if (e.target.files && e.target.files[0]) loadImage(e.target.files[0]);
});

["dragenter", "dragover"].forEach((ev) =>
  els.dropzone.addEventListener(ev, (e) => {
    e.preventDefault();
    els.dropzone.classList.add("dragover");
  })
);
["dragleave", "drop"].forEach((ev) =>
  els.dropzone.addEventListener(ev, (e) => {
    e.preventDefault();
    els.dropzone.classList.remove("dragover");
  })
);
els.dropzone.addEventListener("drop", (e) => {
  const file = e.dataTransfer.files && e.dataTransfer.files[0];
  if (file) loadImage(file);
});

els.resetBtn.addEventListener("click", reset);

function reset() {
  state.hasImage = false;
  state.centering = null;
  els.fileInput.value = "";
  els.cardFigure.hidden = true;
  els.dropzone.hidden = false;
  els.centeringValue.textContent = "—";
  els.centeringMeter.style.width = "0%";
  els.centeringNote.textContent = "Upload a card to measure centering.";
  updateGrade();
}

function loadImage(file) {
  if (!file.type.startsWith("image/")) {
    alert("Please choose an image file.");
    return;
  }
  const img = new Image();
  img.onload = () => {
    drawToCanvas(img);
    state.hasImage = true;
    els.dropzone.hidden = true;
    els.cardFigure.hidden = false;
    analyzeCentering();
    updateGrade();
  };
  img.onerror = () => alert("Could not read that image. Try another file.");
  img.src = URL.createObjectURL(file);
}

function drawToCanvas(img) {
  // Cap the working resolution for fast analysis while keeping aspect.
  const maxDim = 700;
  let { width, height } = img;
  const scale = Math.min(1, maxDim / Math.max(width, height));
  width = Math.round(width * scale);
  height = Math.round(height * scale);

  const c = els.cardCanvas;
  c.width = width;
  c.height = height;
  c.getContext("2d").drawImage(img, 0, 0, width, height);

  const o = els.overlayCanvas;
  o.width = width;
  o.height = height;
  o.getContext("2d").clearRect(0, 0, width, height);
}

/* ------------------------------------------------------------------ */
/* Centering analysis                                                  */
/* ------------------------------------------------------------------ */

function analyzeCentering(deskewed) {
  const ctx = els.cardCanvas.getContext("2d");
  const { width: W, height: H } = els.cardCanvas;
  const data = ctx.getImageData(0, 0, W, H).data;

  // 0) Correct mild skew once, up front, so border widths are measured
  //    against a card whose edges are axis-aligned.
  const bg = sampleBackground(data, W, H);
  if (!deskewed && bg) {
    const angle = estimateSkew(data, W, H, bg);
    if (Math.abs(angle) > 0.012 && Math.abs(angle) < 0.22) {
      deskew(angle, bg);
      return analyzeCentering(true); // re-run on the straightened image
    }
  }

  const gray = grayscale(data, W, H);

  // 1) Find the card within the photo. Background-colour segmentation is the
  //    primary method; fall back to edge-energy when the background is busy.
  const card = bg
    ? findCardBounds(data, W, H, bg)
    : findCardBoundsByEnergy(gray, W, H);

  if (!card) {
    failCentering(
      "Couldn't confidently locate the card against the background — try a " +
      "flatter, straight-on image on a plain surface. Centering was left out " +
      "of the grade."
    );
    return;
  }

  // 2) Within the card, find the inner artwork frame.
  const inner = findInnerFrame(gray, W, H, card);

  // 3) Border widths.
  const left = inner.x0 - card.x0;
  const right = card.x1 - inner.x1;
  const top = inner.y0 - card.y0;
  const bottom = card.y1 - inner.y1;

  drawOverlay(card, inner);

  if (left < 1 || right < 1 || top < 1 || bottom < 1) {
    failCentering(
      "Couldn't confidently detect the inner frame. Centering left out of the " +
      "grade — try a flatter, straight-on image."
    );
    return;
  }

  const hRatio = centeringRatio(left, right);   // 0..1, 0.5 = perfect
  const vRatio = centeringRatio(top, bottom);
  const grade = centeringToGrade(hRatio, vRatio);
  state.centering = grade;

  const hPct = ratioLabel(left, right);
  const vPct = ratioLabel(top, bottom);
  els.centeringValue.textContent = grade.toFixed(1);
  els.centeringMeter.style.width = (grade / 10) * 100 + "%";
  els.centeringNote.textContent = `Left/Right ${hPct}, Top/Bottom ${vPct}.`;
}

function failCentering(message) {
  state.centering = null;
  els.centeringValue.textContent = "n/a";
  els.centeringMeter.style.width = "0%";
  els.centeringNote.textContent = message;
}

function grayscale(data, W, H) {
  const gray = new Float32Array(W * H);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    gray[p] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  }
  return gray;
}

// Sample the four corners; return the mean colour only if the corners agree
// (i.e. there is a consistent plain background to segment against).
function sampleBackground(data, W, H) {
  const s = Math.max(4, Math.round(Math.min(W, H) * 0.05));
  const corners = [
    [0, 0], [W - s, 0], [0, H - s], [W - s, H - s],
  ].map(([px, py]) => avgPatch(data, W, px, py, s));

  const mean = {
    r: (corners[0].r + corners[1].r + corners[2].r + corners[3].r) / 4,
    g: (corners[0].g + corners[1].g + corners[2].g + corners[3].g) / 4,
    b: (corners[0].b + corners[1].b + corners[2].b + corners[3].b) / 4,
  };
  const maxDev = Math.max(
    ...corners.map((c) =>
      Math.abs(c.r - mean.r) + Math.abs(c.g - mean.g) + Math.abs(c.b - mean.b)
    )
  );
  // Corners disagree -> background is not plain/uniform; don't trust it.
  if (maxDev > 95) return null;
  return mean;
}

function avgPatch(data, W, px, py, s) {
  let r = 0, g = 0, b = 0, n = 0;
  for (let y = py; y < py + s; y++) {
    for (let x = px; x < px + s; x++) {
      const i = (y * W + x) * 4;
      r += data[i]; g += data[i + 1]; b += data[i + 2]; n++;
    }
  }
  return { r: r / n, g: g / n, b: b / n };
}

const BG_TOL = 60; // colour distance (sum of abs channel diffs) for "background"

function isForeground(data, idx, bg) {
  return (
    Math.abs(data[idx] - bg.r) +
      Math.abs(data[idx + 1] - bg.g) +
      Math.abs(data[idx + 2] - bg.b) >
    BG_TOL
  );
}

// Primary card detection: a row/column belongs to the card once enough of its
// pixels differ from the sampled background colour.
function findCardBounds(data, W, H, bg) {
  const colCount = new Int32Array(W);
  const rowCount = new Int32Array(H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (isForeground(data, (y * W + x) * 4, bg)) {
        colCount[x]++;
        rowCount[y]++;
      }
    }
  }
  const x0 = edgeFromSide(colCount, H * 0.35, 1);
  const x1 = edgeFromSide(colCount, H * 0.35, -1);
  const y0 = edgeFromSide(rowCount, W * 0.35, 1);
  const y1 = edgeFromSide(rowCount, W * 0.35, -1);

  if (x1 - x0 < W * 0.2 || y1 - y0 < H * 0.2) return null; // degenerate
  return { x0, x1, y0, y1 };
}

// First index (from the given side) whose foreground count clears the threshold.
function edgeFromSide(counts, thresh, dir) {
  const n = counts.length;
  if (dir > 0) {
    for (let i = 0; i < n; i++) if (counts[i] > thresh) return i;
    return 0;
  }
  for (let i = n - 1; i >= 0; i--) if (counts[i] > thresh) return i;
  return n - 1;
}

// Fallback used when the background is too busy to segment by colour: trim
// margins by per-row / per-column edge energy.
function findCardBoundsByEnergy(gray, W, H) {
  const colVar = new Float32Array(W);
  const rowVar = new Float32Array(H);
  for (let y = 0; y < H; y++) {
    for (let x = 1; x < W; x++) {
      const d = Math.abs(gray[y * W + x] - gray[y * W + x - 1]);
      colVar[x] += d;
      rowVar[y] += d;
    }
  }
  const x0 = firstActive(colVar, 1, W);
  const x1 = firstActive(colVar, W - 2, -1);
  const y0 = firstActive(rowVar, 1, H);
  const y1 = firstActive(rowVar, H - 2, -1);
  const box = {
    x0: Math.min(x0, x1), x1: Math.max(x0, x1),
    y0: Math.min(y0, y1), y1: Math.max(y0, y1),
  };
  if (box.x1 - box.x0 < W * 0.2 || box.y1 - box.y0 < H * 0.2) return null;
  return box;
}

// Walk inward from an end until edge energy exceeds a fraction of the peak.
function firstActive(arr, start, end) {
  const peak = Math.max(...arr);
  const thresh = peak * 0.18;
  const dir = end > start ? 1 : -1;
  for (let i = start; dir > 0 ? i < end : i > end; i += dir) {
    if (arr[i] > thresh) return i;
  }
  return start;
}

/* ---- Skew estimation & correction -------------------------------- */

// Estimate the card's tilt from the orientation of the foreground mask. The
// card is the dominant non-background blob; the principal axis of its pixel
// distribution (via second moments) is its long side. How far that axis leans
// from vertical is the skew angle. This is robust where a single-edge fit is
// not — a rotated rectangle's leftmost-pixel trace is a symmetric "V" that
// averages to zero slope.
function estimateSkew(data, W, H, bg) {
  let n = 0, sx = 0, sy = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (isForeground(data, (y * W + x) * 4, bg)) {
        n++; sx += x; sy += y;
      }
    }
  }
  if (n < W * H * 0.05) return 0; // too little foreground to trust

  const cx = sx / n, cy = sy / n;
  let Sxx = 0, Syy = 0, Sxy = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (isForeground(data, (y * W + x) * 4, bg)) {
        const dx = x - cx, dy = y - cy;
        Sxx += dx * dx; Syy += dy * dy; Sxy += dx * dy;
      }
    }
  }
  // Angle of the major axis from the x-axis. For an upright tall card this is
  // ~±90°; the deviation from vertical is the tilt we want to undo.
  const major = 0.5 * Math.atan2(2 * Sxy, Sxx - Syy);
  let tilt = major - Math.PI / 2;
  if (tilt < -Math.PI / 2) tilt += Math.PI;
  if (tilt > Math.PI / 2) tilt -= Math.PI;
  return tilt; // radians; how far the card's long axis leans from vertical
}

// Rotate the source canvas by -angle about its centre, filling exposed corners
// with the background colour so detection isn't tripped by black wedges.
function deskew(angle, bg) {
  const c = els.cardCanvas;
  const { width: W, height: H } = c;
  const tmp = document.createElement("canvas");
  tmp.width = W;
  tmp.height = H;
  tmp.getContext("2d").drawImage(c, 0, 0);

  const ctx = c.getContext("2d");
  ctx.save();
  ctx.fillStyle = `rgb(${bg.r | 0},${bg.g | 0},${bg.b | 0})`;
  ctx.fillRect(0, 0, W, H);
  ctx.translate(W / 2, H / 2);
  ctx.rotate(-angle);
  ctx.translate(-W / 2, -H / 2);
  ctx.drawImage(tmp, 0, 0);
  ctx.restore();
}

// Inside the card box, the inner artwork frame is where edge energy spikes
// after the relatively flat colored border. Scan from each side.
function findInnerFrame(gray, W, H, card) {
  const colE = new Float32Array(W);
  const rowE = new Float32Array(H);
  for (let y = card.y0; y <= card.y1; y++) {
    for (let x = card.x0 + 1; x <= card.x1; x++) {
      colE[x] += Math.abs(gray[y * W + x] - gray[y * W + x - 1]);
    }
  }
  for (let y = card.y0 + 1; y <= card.y1; y++) {
    for (let x = card.x0; x <= card.x1; x++) {
      rowE[y] += Math.abs(gray[y * W + x] - gray[(y - 1) * W + x]);
    }
  }

  const margin = 0.04; // ignore the outermost 4% (the cut edge itself)
  const cw = card.x1 - card.x0;
  const ch = card.y1 - card.y0;

  const x0 = scanEdge(colE, card.x0 + Math.round(cw * margin), card.x0 + Math.round(cw * 0.45), 1);
  const x1 = scanEdge(colE, card.x1 - Math.round(cw * margin), card.x1 - Math.round(cw * 0.45), -1);
  const y0 = scanEdge(rowE, card.y0 + Math.round(ch * margin), card.y0 + Math.round(ch * 0.45), 1);
  const y1 = scanEdge(rowE, card.y1 - Math.round(ch * margin), card.y1 - Math.round(ch * 0.45), -1);

  return { x0, x1, y0, y1 };
}

// Find the strongest edge between `from` and `to` (the inner frame line).
function scanEdge(arr, from, to, dir) {
  let bestIdx = from;
  let best = -1;
  for (let i = from; dir > 0 ? i <= to : i >= to; i += dir) {
    if (arr[i] > best) {
      best = arr[i];
      bestIdx = i;
    }
  }
  return bestIdx;
}

// 0.5 means perfectly centered; returns the smaller-side fraction.
function centeringRatio(a, b) {
  return Math.min(a, b) / (a + b);
}

function ratioLabel(a, b) {
  const total = a + b;
  const pa = Math.round((a / total) * 100);
  return `${pa}/${100 - pa}`;
}

// Map both axes to a 1..10 grade. PSA 10 ≈ 55/45 or better on front.
function centeringToGrade(hRatio, vRatio) {
  const worst = Math.min(hRatio, vRatio); // 0.5 best, 0 worst
  const offset = 0.5 - worst;             // 0 best, 0.5 worst
  // 50/50 -> 10 ; 55/45 (0.05) -> ~9.5 ; 60/40 (0.10) -> ~8.5 ;
  // 70/30 (0.20) -> ~6 ; 80/20 (0.30) -> ~3.5
  const grade = 10 - offset * 22;
  return clamp(Math.round(grade * 2) / 2, 1, 10);
}

/* ------------------------------------------------------------------ */
/* Overlay drawing                                                     */
/* ------------------------------------------------------------------ */

function drawOverlay(card, inner) {
  const ctx = els.overlayCanvas.getContext("2d");
  const { width: W, height: H } = els.overlayCanvas;
  ctx.clearRect(0, 0, W, H);

  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(59,110,240,0.95)"; // card box (blue)
  ctx.strokeRect(card.x0, card.y0, card.x1 - card.x0, card.y1 - card.y0);

  ctx.strokeStyle = "rgba(255,203,5,0.95)"; // inner frame (yellow)
  ctx.strokeRect(inner.x0, inner.y0, inner.x1 - inner.x0, inner.y1 - inner.y0);
}

/* ------------------------------------------------------------------ */
/* Grading                                                             */
/* ------------------------------------------------------------------ */

[els.corners, els.edges, els.surface].forEach((slider) => {
  slider.addEventListener("input", updateGrade);
});

function updateGrade() {
  const corners = parseFloat(els.corners.value);
  const edges = parseFloat(els.edges.value);
  const surface = parseFloat(els.surface.value);

  els.cornersValue.textContent = corners.toFixed(1);
  els.edgesValue.textContent = edges.toFixed(1);
  els.surfaceValue.textContent = surface.toFixed(1);

  if (!state.hasImage) {
    els.result.hidden = true;
    return;
  }

  // Weighted sub-grades. If centering couldn't be measured, redistribute.
  let parts, overall;
  if (state.centering != null) {
    parts = [
      { v: state.centering, w: 0.35 },
      { v: corners, w: 0.25 },
      { v: edges, w: 0.2 },
      { v: surface, w: 0.2 },
    ];
  } else {
    parts = [
      { v: corners, w: 0.38 },
      { v: edges, w: 0.31 },
      { v: surface, w: 0.31 },
    ];
  }
  const weighted = parts.reduce((s, p) => s + p.v * p.w, 0);

  // A single bad sub-grade caps the overall grade (graders are unforgiving).
  const lowest = Math.min(...parts.map((p) => p.v));
  overall = Math.min(weighted, lowest + 1.5);
  overall = clamp(Math.round(overall * 2) / 2, 1, 10);

  const { label, desc } = describeGrade(overall);
  els.gradeNumber.textContent = Number.isInteger(overall)
    ? overall.toString()
    : overall.toFixed(1);
  els.gradeLabel.textContent = label;
  els.gradeDesc.textContent = desc;
  els.result.hidden = false;
}

function describeGrade(g) {
  if (g >= 10) return { label: "Gem Mint", desc: "Virtually flawless." };
  if (g >= 9) return { label: "Mint", desc: "Minor imperfection under scrutiny." };
  if (g >= 8) return { label: "Near Mint–Mint", desc: "Very light wear." };
  if (g >= 7) return { label: "Near Mint", desc: "Minor visible flaws." };
  if (g >= 6) return { label: "Excellent–Mint", desc: "Light handling wear." };
  if (g >= 5) return { label: "Excellent", desc: "Noticeable wear on close look." };
  if (g >= 4) return { label: "Very Good–Excellent", desc: "Moderate wear." };
  if (g >= 3) return { label: "Very Good", desc: "Clear wear and handling." };
  if (g >= 2) return { label: "Good", desc: "Heavy wear, still intact." };
  return { label: "Poor–Fair", desc: "Significant damage." };
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

// Initialize slider outputs on load.
updateGrade();
