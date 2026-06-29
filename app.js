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

function analyzeCentering() {
  const ctx = els.cardCanvas.getContext("2d");
  const { width: W, height: H } = els.cardCanvas;
  const data = ctx.getImageData(0, 0, W, H).data;

  // Grayscale + simple gradient magnitude to find strong edges.
  const gray = new Float32Array(W * H);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    gray[p] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  }

  // 1) Find the card boundary by trimming near-uniform background margins.
  const card = findCardBounds(gray, W, H);

  // 2) Within the card, find the inner frame using per-row/col edge energy.
  const inner = findInnerFrame(gray, W, H, card);

  // 3) Border widths.
  const left = inner.x0 - card.x0;
  const right = card.x1 - inner.x1;
  const top = inner.y0 - card.y0;
  const bottom = card.y1 - inner.y1;

  drawOverlay(card, inner);

  // Guard against degenerate detection.
  if (left < 1 || right < 1 || top < 1 || bottom < 1) {
    state.centering = null;
    els.centeringValue.textContent = "n/a";
    els.centeringMeter.style.width = "0%";
    els.centeringNote.textContent =
      "Couldn't confidently detect the borders. Centering left out of the grade — try a flatter, straight-on image.";
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

// Trim uniform margins (background) from each side to find the card box.
function findCardBounds(gray, W, H) {
  const colVar = new Float32Array(W);
  const rowVar = new Float32Array(H);
  for (let y = 0; y < H; y++) {
    for (let x = 1; x < W; x++) {
      const d = Math.abs(gray[y * W + x] - gray[y * W + x - 1]);
      colVar[x] += d;
      rowVar[y] += d;
    }
  }
  const x0 = firstActive(colVar, 1, W, 1);
  const x1 = firstActive(colVar, W - 2, -1, 1);
  const y0 = firstActive(rowVar, 1, H, 1);
  const y1 = firstActive(rowVar, H - 2, -1, 1);
  return {
    x0: Math.min(x0, x1),
    x1: Math.max(x0, x1),
    y0: Math.min(y0, y1),
    y1: Math.max(y0, y1),
  };
}

// Walk inward from an end until edge energy exceeds a fraction of the peak.
function firstActive(arr, start, end, step) {
  const peak = Math.max(...arr);
  const thresh = peak * 0.18;
  const dir = end > start ? 1 : -1;
  for (let i = start; dir > 0 ? i < end : i > end; i += dir) {
    if (arr[i] > thresh) return i;
  }
  return start;
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
