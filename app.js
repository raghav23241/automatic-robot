/* App orchestration: views, upload → grade → report, chart, collection. */
(function () {
  const GV = window.GV, Grader = window.Grader;
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));

  const views = {
    landing: $("#view-landing"),
    report: $("#view-report"),
    collection: $("#view-collection"),
  };

  function show(view) {
    Object.entries(views).forEach(([k, el]) => (el.hidden = k !== view));
    $$(".nav-links a").forEach((a) =>
      a.classList.toggle("active", a.dataset.nav === view)
    );
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // ---- Nav ----
  $$("[data-nav]").forEach((el) =>
    el.addEventListener("click", (e) => {
      e.preventDefault();
      show(el.dataset.nav);
    })
  );

  // ---- Upload ----
  const dz = $("#dropzone"), fileInput = $("#fileInput");
  dz.addEventListener("click", () => fileInput.click());
  dz.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileInput.click(); }
  });
  fileInput.addEventListener("change", (e) => e.target.files[0] && loadImage(e.target.files[0]));
  ["dragenter", "dragover"].forEach((ev) =>
    dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add("drag"); })
  );
  ["dragleave", "drop"].forEach((ev) =>
    dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove("drag"); })
  );
  dz.addEventListener("drop", (e) => {
    const f = e.dataTransfer.files[0];
    if (f) loadImage(f);
  });

  function loadImage(file) {
    if (!file.type.startsWith("image/")) { alert("Please choose an image file."); return; }
    const img = new Image();
    img.onload = () => {
      drawCard(img);
      const result = Grader.grade($("#cardCanvas"));
      // Match the uploaded card to the closest known catalog card for pricing.
      const cardId = "charizard"; // demo: default catalog entry for pricing
      renderReport(cardId, result, true);
      show("report");
    };
    img.onerror = () => alert("Could not read that image.");
    img.src = URL.createObjectURL(file);
  }

  function drawCard(img) {
    const c = $("#cardCanvas"), o = $("#overlayCanvas");
    const maxW = 280, ratio = img.height / img.width;
    c.width = maxW; c.height = Math.round(maxW * ratio);
    o.width = c.width; o.height = c.height;
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    o.getContext("2d").clearRect(0, 0, o.width, o.height);
  }

  function drawOverlay(box, inner) {
    const o = $("#overlayCanvas"), ctx = o.getContext("2d");
    ctx.clearRect(0, 0, o.width, o.height);
    if (!box) return;
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = "rgba(201,162,39,.9)";
    ctx.strokeRect(box.x0, box.y0, box.x1 - box.x0, box.y1 - box.y0);
    if (inner) {
      ctx.strokeStyle = "rgba(232,200,64,.6)";
      ctx.strokeRect(inner.x0, inner.y0, inner.x1 - inner.x0, inner.y1 - inner.y0);
    }
  }

  // ---- Report ----
  function renderReport(cardId, result, fromUpload) {
    const g = result ? result.overall : GV.RECENT.find((r) => r.id === cardId)?.grade || 9;
    const priced = GV.fetchPrices(cardId, g);
    const card = priced.card;
    const pg = priced.grade; // nearest priced grade

    // Card art / grade
    if (fromUpload && result) {
      drawOverlay(result.box, result.inner);
      setGrade(result);
      $("#dataNote").textContent =
        "Grade is computed for real from your photo (centering measured; corners/edges/surface are heuristic estimates). Price data is representative sample data.";
    } else {
      drawPlaceholderCard();
      setGrade(fakeResult(g));
      $("#dataNote").textContent =
        "This is a sample catalog entry. Upload a photo to grade your own card. Price data is representative sample data.";
    }

    $("#bcSet").textContent = card.set.split(" ").slice(0, 2).join(" ");
    $("#bcName").textContent = card.name;
    $("#rName").textContent = card.name;
    $("#rSet").textContent = card.set;
    $("#rMeta").textContent = card.meta;
    $("#rNum").textContent = card.number;

    $("#sbAvg").textContent = GV.fmtFull(priced.avg);
    const deltaEl = $("#sbDelta");
    const d = priced.delta;
    deltaEl.textContent = (d > 0 ? "↑ +" : d < 0 ? "↓ " : "→ ") + (d === 0 ? "flat" : Math.abs(d) + "%");
    deltaEl.className = "sb-delta " + (d > 0 ? "up" : d < 0 ? "down" : "");
    $("#sbSales").textContent = priced.sales30d;
    $("#sbAsk").textContent = GV.fmtFull(priced.lowestAsk);

    $("#chartTitle").textContent = `Price History · PSA ${pg}`;
    drawChart(priced.history);

    $("#gcTitle").textContent = "Grade Comparison · 30-day avg";
    $("#gradeComp").innerHTML = priced.comparison.map((c) =>
      `<div class="gc${c.active ? " active" : ""}">
        <div class="gc-grade">PSA ${c.grade}${c.active ? " ←" : ""}</div>
        <div class="gc-price">${GV.fmt(c.price)}</div>
        <div class="gc-sales">${c.sales} sales</div>
      </div>`
    ).join("");

    $("#salesBody").innerHTML = priced.recentSales.map((s) =>
      `<div class="sales-row srow">
        <div class="s-date">${s.date}</div>
        <div class="s-card">${s.card}</div>
        <div class="s-grade">PSA ${s.grade}</div>
        <div class="s-price r">${GV.fmtFull(s.price)}</div>
        <div class="s-plat r">${s.platform}</div>
      </div>`
    ).join("");
  }

  function setGrade(r) {
    $("#gradeNum").textContent = Number.isInteger(r.overall) ? r.overall : r.overall.toFixed(1);
    $("#gradeTier").textContent = r.tier;
    $("#sgCentering").textContent = r.centering == null ? "n/a" : r.centering.toFixed(1);
    $("#sgCorners").textContent = r.corners.toFixed(1);
    $("#sgEdges").textContent = r.edges.toFixed(1);
    $("#sgSurface").textContent = r.surface.toFixed(1);
  }

  function fakeResult(g) {
    return {
      overall: g, tier: g >= 10 ? "GEM MINT" : g >= 9 ? "MINT" : g >= 8 ? "NM-MINT" : "NEAR MINT",
      centering: Math.min(10, g + 0.5), corners: Math.max(1, g - 0.5),
      edges: g, surface: g,
    };
  }

  function drawPlaceholderCard() {
    const c = $("#cardCanvas");
    c.width = 280; c.height = 392;
    const ctx = c.getContext("2d");
    for (let y = 0; y < c.height; y += 6)
      for (let x = 0; x < c.width; x += 6) {
        ctx.fillStyle = (x + y) % 12 === 0 ? "#111120" : "#0d0d18";
        ctx.fillRect(x, y, 6, 6);
      }
    ctx.fillStyle = "#222232";
    ctx.font = "10px 'Space Mono', monospace";
    ctx.textAlign = "center";
    ctx.fillText("card image", c.width / 2, c.height / 2);
    $("#overlayCanvas").getContext("2d").clearRect(0, 0, 280, 392);
  }

  // ---- Price chart (area + line) ----
  function drawChart(points) {
    const svg = $("#priceChart");
    const W = 580, H = 95, padX = 10, padTop = 10, padBot = 20;
    const min = Math.min(...points), max = Math.max(...points);
    const span = max - min || 1;
    const stepX = (W - padX * 2) / (points.length - 1);
    const xy = points.map((p, i) => [
      padX + i * stepX,
      padTop + (1 - (p - min) / span) * (H - padTop - padBot),
    ]);
    const line = xy.map(([x, y], i) => `${i ? "L" : "M"} ${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
    const area = `${line} L ${xy[xy.length - 1][0].toFixed(1)},${H} L ${xy[0][0].toFixed(1)},${H} Z`;
    const grid = [24, 48, 72].map((y) => `<line x1="10" y1="${y}" x2="570" y2="${y}" stroke="#131325" stroke-width="1"/>`).join("");
    const last = xy[xy.length - 1];
    const months = ["Jul", "", "Oct", "", "Jan", "", "Apr", "", "", "", "", "Jun"];
    const labels = xy.map(([x], i) =>
      months[i] ? `<text x="${x}" y="92" fill="${i === xy.length - 1 ? "#c9a227" : "#272740"}" font-size="8" font-family="Space Mono,monospace" text-anchor="middle">${months[i]}</text>` : ""
    ).join("");
    svg.innerHTML = `
      <defs><linearGradient id="cg" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#c9a227" stop-opacity="0.22"/>
        <stop offset="100%" stop-color="#c9a227" stop-opacity="0.02"/>
      </linearGradient></defs>
      ${grid}
      <path d="${area}" fill="url(#cg)"/>
      <path d="${line}" fill="none" stroke="#c9a227" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/>
      <circle cx="${last[0].toFixed(1)}" cy="${last[1].toFixed(1)}" r="3.5" fill="#c9a227"/>
      ${labels}`;
  }

  // ---- Recently valued strip ----
  function renderRecent() {
    $("#recentStrip").innerHTML = GV.RECENT.map((r) => {
      const c = GV.CARDS[r.id];
      const price = GV.fmt(c.grades[r.grade] || Object.values(c.grades).pop());
      return `<div class="rcard" data-card="${r.id}" data-grade="${r.grade}">
        <div class="rcard-img"><span>card img</span></div>
        <div class="rcard-name">${c.name}</div>
        <div class="rcard-set">${c.setShort}</div>
        <div class="rcard-foot">
          <span class="pgrade" style="background:${GV.gradeColor(r.grade)}">PSA ${r.grade}</span>
          <span class="rcard-price">${price}</span>
        </div>
      </div>`;
    }).join("");
    $$("#recentStrip .rcard").forEach((el) =>
      el.addEventListener("click", () => {
        renderReport(el.dataset.card, null, false);
        show("report");
      })
    );
  }

  // ---- Collection ----
  function renderCollection() {
    let total = 0;
    const html = GV.HOLDINGS.map((h) => {
      const c = GV.CARDS[h.id];
      const price = c.grades[h.grade] || Object.values(c.grades).pop();
      total += price;
      const d = h.delta;
      const deltaTxt = d > 0 ? `↑ +${d}%` : d < 0 ? `↓ ${d}%` : "→ flat";
      const deltaCls = d > 0 ? "up" : d < 0 ? "down" : "";
      return `<div class="hcard" data-card="${h.id}" data-grade="${h.grade}">
        <div class="hcard-row">
          <div class="hcard-thumb" style="${h.grade >= 9 ? "border:1px solid rgba(201,162,39,.28)" : ""}"></div>
          <div class="hcard-body">
            <div class="hcard-name">${c.name}</div>
            <div class="hcard-set">${c.setShort}</div>
            <div class="hcard-foot">
              <span class="pgrade" style="background:${GV.gradeColor(h.grade)}">PSA ${h.grade}</span>
              <span class="rcard-price">${GV.fmt(price)}</span>
            </div>
            <div class="hcard-delta ${deltaCls}">${deltaTxt}</div>
          </div>
        </div>
      </div>`;
    }).join("");
    $("#holdingsGrid").innerHTML = html;
    $("#pfValue").textContent = GV.fmtFull(total);
    $("#pfCards").textContent = GV.HOLDINGS.length;
    $$("#holdingsGrid .hcard").forEach((el) =>
      el.addEventListener("click", () => {
        renderReport(el.dataset.card, null, false);
        show("report");
      })
    );
  }

  $("#submitPsa").addEventListener("click", () =>
    alert("Demo: this would start a PSA grading submission. (Not a real submission.)")
  );

  // Init
  renderRecent();
  renderCollection();
  show("landing");
})();
