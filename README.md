# Pokémon Card Grader

A lightweight, browser-based tool that estimates the condition grade (1–10) of a
Pokémon card from a photo or scan. No backend, no build step, no dependencies —
just open `index.html`.

![grade scale: 1 to 10](https://img.shields.io/badge/grade-1--10-ffcb05)

## What it does

- **Automatic centering** — analyzes the uploaded image to locate the card and
  its inner artwork frame, measures the four border widths, and converts the
  left/right and top/bottom ratios into a centering sub-grade. An overlay shows
  the detected card box (blue) and inner frame (yellow).
- **Guided condition rating** — you rate **corners**, **edges**, and **surface**
  on a 1–10 scale with on-screen guidance for what to look for.
- **Overall grade** — combines the sub-grades with PSA-style weighting. A single
  weak sub-grade caps the overall result, mirroring how real graders work.

## Usage

```bash
# Just open the file — it's fully static.
open index.html        # macOS
xdg-open index.html    # Linux

# Or serve it locally:
python3 -m http.server 8000   # then visit http://localhost:8000
```

1. Drag in (or click to upload) a flat, straight-on photo or scan of the card.
2. Read the auto-measured centering sub-grade and the detection overlay.
3. Adjust the corners / edges / surface sliders based on what you see.
4. Read the overall estimated grade.

## How centering is measured

1. **Skew correction** — the card's tilt is estimated from the slope of its left
   edge (a straight-line fit through the first foreground pixel of each row). A
   mild tilt is corrected by rotating the image so the card's edges are
   axis-aligned before anything is measured.
2. **Card detection** — the four corners are sampled to learn the background
   color, then each row/column is classified as card-or-background by how much
   it differs from that color. This reliably finds the card edge even across a
   plain colored border (where pure edge-energy detection fails). When the
   background is too busy to segment, it falls back to edge-energy trimming.
3. **Inner frame detection** — within the card, the strongest edge between the
   colored border and the artwork is located on each side.
4. **Scoring** — border widths give left/right and top/bottom ratios. A 50/50
   split scores 10; the grade falls off as the split worsens (≈60/40 → ~8.5,
   ≈70/30 → ~6). The worse of the two axes drives the score.

Best results come from a flat, evenly lit, straight-on image on a plain surface.
Heavy skew, glare, or a busy background can still throw off detection — when the
card or its borders can't be found confidently, centering is dropped from the
grade and the rest still apply.

## Tech

Plain HTML, CSS, and JavaScript using the Canvas API for image analysis. Runs
entirely client-side; images never leave the browser.

## Disclaimer

This is an estimation aid for self-assessment. It is **not** affiliated with or
endorsed by PSA, CGC, Beckett, or The Pokémon Company, and does not produce an
official grade.
