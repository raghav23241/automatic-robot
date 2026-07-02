/* Representative sample market data.
 * This is the single seam where a real pricing API would plug in:
 * replace `fetchPrices()` with a call to your data source and keep the
 * same return shape. Everything downstream stays identical.
 */
window.GV = (function () {
  const gradeColor = (g) =>
    g >= 10 ? "#e8c840" : g >= 9 ? "#c9a227" : g >= 8 ? "#8080a8" : "#7070a0";

  // Catalog of cards shown across the app. Prices are per-PSA-grade.
  const CARDS = {
    charizard: {
      id: "charizard",
      name: "Charizard",
      set: "Base Set Shadowless",
      meta: "1999 · Holo Rare",
      number: "#4/102",
      setShort: "Base Set '99",
      grades: { 7: 900, 8: 1800, 9: 4450, 10: 28000 },
      sales30d: 12,
      lowestAsk: 3900,
      delta: 12.3,
    },
    pikachu: {
      id: "pikachu",
      name: "Pikachu Illustrator",
      set: "1998 Promo",
      meta: "1998 · Promo",
      number: "#—",
      setShort: "1998 Promo",
      grades: { 6: 9000, 7: 18500, 8: 42000, 9: 95000 },
      sales30d: 3,
      lowestAsk: 17800,
      delta: 0.0,
    },
    mewtwo: {
      id: "mewtwo",
      name: "Mewtwo",
      set: "Base Set",
      meta: "1999 · Holo Rare",
      number: "#10/102",
      setShort: "Base Set '99",
      grades: { 7: 320, 8: 900, 9: 2400, 10: 8900 },
      sales30d: 2,
      lowestAsk: 8200,
      delta: 31.2,
    },
    lugia: {
      id: "lugia",
      name: "Lugia",
      set: "Neo Genesis",
      meta: "2000 · Holo Rare",
      number: "#9/111",
      setShort: "Neo Genesis '00",
      grades: { 7: 600, 8: 3400, 9: 9500, 10: 34000 },
      sales30d: 6,
      lowestAsk: 3200,
      delta: -1.5,
    },
    blastoise: {
      id: "blastoise",
      name: "Blastoise",
      set: "Base Set 1st Edition",
      meta: "1999 · Holo Rare",
      number: "#2/102",
      setShort: "1st Ed. '99",
      grades: { 7: 500, 8: 1200, 9: 5200, 10: 22000 },
      sales30d: 4,
      lowestAsk: 4900,
      delta: 5.8,
    },
    venusaur: {
      id: "venusaur",
      name: "Venusaur",
      set: "Base Set 1st Edition",
      meta: "1999 · Holo Rare",
      number: "#15/102",
      setShort: "1st Ed. '99",
      grades: { 7: 350, 8: 900, 9: 2100, 10: 9800 },
      sales30d: 5,
      lowestAsk: 1950,
      delta: 8.4,
    },
  };

  const PLATFORMS = ["eBay", "PWCC", "Goldin", "eBay", "Heritage"];

  // Recently-valued strip on the landing page.
  const RECENT = [
    { id: "charizard", grade: 9 },
    { id: "pikachu", grade: 7 },
    { id: "mewtwo", grade: 10 },
    { id: "lugia", grade: 8 },
  ];

  // Collection / portfolio holdings.
  const HOLDINGS = [
    { id: "charizard", grade: 9, delta: 12.3 },
    { id: "pikachu", grade: 7, delta: 0.0 },
    { id: "mewtwo", grade: 10, delta: 31.2 },
    { id: "blastoise", grade: 8, delta: 5.8 },
    { id: "venusaur", grade: 9, delta: 8.4 },
    { id: "lugia", grade: 8, delta: -1.5 },
  ];

  const fmt = (n) => {
    if (n >= 1000) {
      const k = n / 1000;
      return "$" + (k >= 100 ? Math.round(k) : k.toFixed(1).replace(/\.0$/, "")) + "K";
    }
    return "$" + n.toLocaleString();
  };
  const fmtFull = (n) => "$" + Math.round(n).toLocaleString();

  // Nearest priced grade to an arbitrary numeric grade.
  function nearestGrade(card, grade) {
    const keys = Object.keys(card.grades).map(Number);
    return keys.reduce((a, b) => (Math.abs(b - grade) < Math.abs(a - grade) ? b : a));
  }

  // --- The pluggable pricing seam --------------------------------------
  // Returns everything the report needs for a card at a given grade.
  function fetchPrices(cardId, grade) {
    const card = CARDS[cardId];
    if (!card) return null;
    const g = nearestGrade(card, grade);
    const avg = card.grades[g];

    // Deterministic pseudo-random history so the chart is stable per card.
    let seed = cardId.split("").reduce((s, c) => s + c.charCodeAt(0), g * 7);
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const points = [];
    let v = avg * 0.62;
    for (let i = 0; i < 12; i++) {
      v += (avg - v) * 0.22 + (rnd() - 0.45) * avg * 0.06;
      points.push(Math.max(avg * 0.4, v));
    }
    points[points.length - 1] = avg;

    const dates = ["Jun 28", "Jun 25", "Jun 22", "Jun 18", "Jun 14", "Jun 9"];
    const sales = dates.slice(0, Math.min(4, card.sales30d)).map((d, i) => ({
      date: d,
      card: `${card.name} ${card.set.split(" ")[0]} ${card.set.split(" ")[1] || ""}`.trim(),
      grade: g,
      price: Math.round(avg * (0.94 + rnd() * 0.12)),
      platform: PLATFORMS[i % PLATFORMS.length],
    }));

    const comparison = Object.keys(card.grades)
      .map(Number)
      .sort((a, b) => a - b)
      .map((gr) => ({
        grade: gr,
        price: card.grades[gr],
        sales: Math.max(1, Math.round(card.sales30d * (gr === g ? 1 : 0.5 + Math.random() * 0.4))),
        active: gr === g,
      }));

    return {
      card,
      grade: g,
      avg,
      delta: card.delta,
      sales30d: card.sales30d,
      lowestAsk: card.lowestAsk,
      history: points,
      recentSales: sales,
      comparison,
      estRange: [Math.round(avg * 0.94), Math.round(avg * 1.08)],
    };
  }

  return { CARDS, RECENT, HOLDINGS, fetchPrices, fmt, fmtFull, gradeColor, nearestGrade };
})();
