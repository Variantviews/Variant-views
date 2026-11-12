"use strict";

// Data is read straight from the repository, so the page shows the latest daily run.
const REPO = "Variantviews/Variant-views";
const RAW = `https://raw.githubusercontent.com/${REPO}/main/`;
const START_TEXT = "November 2, 2026";
const START_VALUE = 1000000;
const THESIS_COLORS = ["#6E9BF2", "#E3B65A", "#B48CF0", "#E38FC0", "#5FC7D6", "#CDB98A", "#A9BAD4", "#F2A97E"];

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const slug = (s) => "t-" + s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
const isNum = (x) => typeof x === "number" && !isNaN(x);
const round = (x, dp) => Math.round(x * 10 ** dp) / 10 ** dp;
const sign = (x) => (x > 0 ? "+" : x < 0 ? "\u2212" : "");
const pct = (x, dp = 1) => { if (!isNum(x)) return "–"; const r = round(x, dp); return `${sign(r)}${Math.abs(r).toFixed(dp)}%`; };
const dir = (x, dp = 1) => { if (!isNum(x)) return ""; const r = round(x, dp); return r > 0 ? "up" : r < 0 ? "down" : ""; };
const wpct = (x, dp) => `${(+x).toFixed(dp)}%`;
const weight0 = (x) => { const r = Math.round(+x * 10) / 10; return `${r.toFixed(r % 1 ? 1 : 0)}%`; };
const usd = (x) => "$" + Math.round(Math.abs(x)).toLocaleString("en-US");
const usdSigned = (x) => (isNum(x) ? `${sign(Math.round(x))}${usd(x)}` : "–");
const longDate = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
const shortDate = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const shortName = (n) => n.replace(/\s*\(.*\)/, "");
const canHover = () => window.matchMedia("(hover: hover) and (pointer: fine)").matches;

async function load(path) {
  for (const base of [RAW, ""]) {
    try {
      const res = await fetch(`${base}${path}?t=${Date.now()}`, { cache: "no-store" });
      if (res.ok) return await res.text();
    } catch (e) { /* try the next source */ }
  }
  return null;
}

function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  const head = lines.shift().split(",").map((h) => h.trim());
  return lines.filter(Boolean).map((line) => {
    const cells = line.split(",");
    const row = {};
    head.forEach((h, i) => (row[h] = (cells[i] ?? "").trim()));
    return row;
  });
}

// ---- Model --------------------------------------------------------------------
function buildTheses(holdings, latest, perf) {
  const groups = new Map();
  holdings.forEach((h) => {
    const w = parseFloat(h.weight);
    if (!groups.has(h.thesis)) groups.set(h.thesis, { name: h.thesis, weight: 0, holdings: [] });
    const g = groups.get(h.thesis);
    g.weight += w;
    g.holdings.push({ ...h, weight: w });
  });
  const lt = latest ? Object.fromEntries(latest.theses.map((t) => [t.thesis, t])) : {};
  const lp = latest ? Object.fromEntries(latest.positions.map((p) => [p.symbol, p])) : {};
  const last = perf && perf.length > 1 ? perf[perf.length - 1] : null;
  const prev = perf && perf.length > 1 ? perf[perf.length - 2] : null;

  const theses = [...groups.values()].map((g) => {
    const d = lt[g.name];
    const ret = d ? d.return_pct : null;
    g.holdings.forEach((h) => {
      const p = lp[h.symbol] || null;
      h.live = p;
      h.cost = (h.weight / 100) * START_VALUE;
      h.value = p && isNum(p.return_pct) ? h.cost * (1 + p.return_pct / 100) : null;
      h.current = p ? p.current_weight : null;
    });
    const col = `Thesis: ${g.name}`;
    const day = last && prev && isNum(last[col]) && isNum(prev[col]) ? (last[col] / prev[col] - 1) * 100 : null;
    const cost = (g.weight / 100) * START_VALUE;
    return {
      ...g, id: slug(g.name), ret, day, cost,
      value: isNum(ret) ? cost * (1 + ret / 100) : null,
      current: d ? d.current_weight : null,
    };
  });
  // Rank by current weight (starting weight until data exists)
  theses.sort((a, b) => (b.current ?? b.weight) - (a.current ?? a.weight));
  return theses.map((t, i) => ({ ...t, color: THESIS_COLORS[i % THESIS_COLORS.length] }));
}

// ---- Quote header ---------------------------------------------------------------
function renderQuote(perf, latest) {
  const priceEl = $("#q-price"), dayEl = $("#q-day"), changeEl = $("#q-change");
  if (!perf || !perf.length || !latest) {
    priceEl.textContent = usd(START_VALUE);
    dayEl.textContent = "";
    changeEl.innerHTML = `<span class="asof">Tracking starts on ${START_TEXT}.</span>`;
    return;
  }
  const lastIdx = perf[perf.length - 1].Portfolio;
  const value = (START_VALUE * lastIdx) / 100;
  const change = value - START_VALUE;
  const changePct = (change / START_VALUE) * 100;
  priceEl.textContent = usd(value);
  if (perf.length > 1) {
    const day = (lastIdx / perf[perf.length - 2].Portfolio - 1) * 100;
    dayEl.className = `quote-day num ${dir(day, 2)}`;
    dayEl.textContent = pct(day, 2);
  } else {
    dayEl.textContent = "";
  }
  changeEl.className = `quote-change num ${dir(changePct, 2)}`;
  changeEl.innerHTML = `${sign(round(change, 0))}${usd(change)} (${pct(changePct, 2)}) <span class="asof">since inception, updated ${esc(longDate(latest.as_of))}</span>`;
}

// ---- Chart --------------------------------------------------------------------
const show = { SPY: true, QQQ: true };

function niceTicks(mn, mx, count) {
  const raw = (mx - mn) / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const f = raw / mag;
  const step = (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * mag;
  const out = [];
  for (let v = Math.ceil(mn / step) * step; v <= mx + 1e-9; v += step) out.push(+v.toFixed(10));
  return { ticks: out, step };
}

function drawChart(perf) {
  const el = $("#chart");
  const rows = perf || [];
  if (!rows.length) {
    el.innerHTML = `<div class="chart-empty">The record starts on ${START_TEXT}. The chart fills in after each trading day, with no history added before that date.</div>`;
    return;
  }
  const css = getComputedStyle(document.documentElement);
  const v = (n) => css.getPropertyValue(n).trim();
  const rebase = (k) => rows.map((r) => (r[k] / rows[0][k] - 1) * 100);
  const port = rebase("Portfolio");
  const lineColor = port[port.length - 1] >= 0 ? v("--up") : v("--down");
  const series = [{ name: "Portfolio", color: lineColor, width: 2.4, values: port }];
  if (show.SPY) series.push({ name: "SPY", color: v("--spy"), width: 1.5, dash: "6 4", values: rebase("SPY") });
  if (show.QQQ) series.push({ name: "QQQ", color: v("--qqq"), width: 1.5, dash: "2 3", values: rebase("QQQ") });

  const dates = rows.map((r) => r.date);
  const W = el.clientWidth, H = el.clientHeight;
  const legendOnTop = window.matchMedia("(max-width: 640px)").matches;
  const m = { l: 6, r: 52, t: legendOnTop ? 10 : 46, b: 28 };
  const iw = W - m.l - m.r, ih = H - m.t - m.b;
  const all = series.flatMap((s) => s.values).filter(isNum);
  let mn = Math.min(0, ...all), mx = Math.max(0, ...all);
  if (mx - mn < 1) { mx += 0.5; mn -= 0.5; }
  const pad = (mx - mn) * 0.1; mn -= pad; mx += pad;
  const n = dates.length;
  const X = (i) => m.l + (n === 1 ? iw / 2 : (i / (n - 1)) * iw);
  const Y = (val) => m.t + ((mx - val) / (mx - mn)) * ih;
  const { ticks, step } = niceTicks(mn, mx, 6);
  const dp = step < 1 ? 1 : 0;

  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Portfolio return compared with benchmarks">
    <defs><linearGradient id="fill" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0" stop-color="${lineColor}" stop-opacity="0.28"></stop>
      <stop offset="1" stop-color="${lineColor}" stop-opacity="0"></stop></linearGradient></defs>`;
  ticks.forEach((t) => {
    svg += `<line class="grid" x1="${m.l}" x2="${m.l + iw}" y1="${Y(t)}" y2="${Y(t)}"${Math.abs(t) < 1e-9 ? ' stroke-dasharray="3 3"' : ""}></line>`;
    svg += `<text class="ax" x="${W - 4}" y="${Y(t) + 4}" text-anchor="end">${sign(round(t, dp))}${Math.abs(t).toFixed(dp)}%</text>`;
  });
  const xi = n > 2 ? [0, Math.floor((n - 1) / 2), n - 1] : [...Array(n).keys()];
  xi.forEach((i, k) => {
    const a = n === 1 ? "middle" : k === 0 ? "start" : k === xi.length - 1 ? "end" : "middle";
    svg += `<text class="ax" x="${X(i)}" y="${H - 6}" text-anchor="${a}">${shortDate(dates[i])}</text>`;
  });
  if (n > 1) {
    const line = port.map((val, i) => `${X(i).toFixed(1)},${Y(val).toFixed(1)}`).join(" ");
    svg += `<polygon points="${X(0)},${Y(mn)} ${line} ${X(n - 1)},${Y(mn)}" fill="url(#fill)"></polygon>`;
  }
  [...series].reverse().forEach((s) => {
    if (n === 1) {
      svg += `<circle cx="${X(0)}" cy="${Y(s.values[0])}" r="4" fill="${s.color}"></circle>`;
      return;
    }
    const p = s.values.map((val, i) => `${X(i).toFixed(1)},${Y(val).toFixed(1)}`).join(" ");
    svg += `<polyline points="${p}" fill="none" stroke="${s.color}" stroke-width="${s.width}" ${s.dash ? `stroke-dasharray="${s.dash}"` : ""} stroke-linejoin="round"></polyline>`;
  });
  svg += `<line class="cursor" id="cursor" x1="0" x2="0" y1="${m.t}" y2="${m.t + ih}" visibility="hidden"></line>`;
  svg += `<rect id="hit" x="${m.l}" y="${m.t}" width="${iw}" height="${ih}" fill="transparent"></rect></svg>`;
  el.innerHTML = svg + `<div class="tooltip" id="tip"></div>`;

  const hit = $("#hit"), cursor = $("#cursor"), tip = $("#tip");
  const showTip = (e) => {
    const box = el.getBoundingClientRect();
    const i = n === 1 ? 0 : Math.max(0, Math.min(n - 1, Math.round(((e.clientX - box.left - m.l) / iw) * (n - 1))));
    cursor.setAttribute("x1", X(i)); cursor.setAttribute("x2", X(i)); cursor.setAttribute("visibility", "visible");
    tip.innerHTML = `<strong>${esc(longDate(dates[i]))}</strong><br>Value <span class="num">${usd(START_VALUE * rows[i].Portfolio / 100)}</span><br>` +
      series.map((s) => `${s.name} <span class="num">${pct(s.values[i], 2)}</span>`).join("<br>");
    tip.style.display = "block";
    tip.style.top = `${m.t}px`;
    const tw = tip.offsetWidth;
    tip.style.left = `${X(i) + 12 + tw > W ? Math.max(0, X(i) - tw - 12) : X(i) + 12}px`;
  };
  const hide = () => { tip.style.display = "none"; cursor.setAttribute("visibility", "hidden"); };
  hit.addEventListener("pointermove", showTip);
  hit.addEventListener("pointerdown", showTip);
  hit.addEventListener("pointerleave", hide);
}

// ---- Heat map -------------------------------------------------------------------
function squarify(items, x, y, w, h) {
  const out = [];
  const total = items.reduce((s, i) => s + i.value, 0);
  const nodes = items.map((i) => ({ ...i, area: (i.value * w * h) / total }));
  const worst = (row, side) => {
    const s = row.reduce((a, n) => a + n.area, 0);
    const big = Math.max(...row.map((n) => n.area)), small = Math.min(...row.map((n) => n.area));
    return Math.max((side * side * big) / (s * s), (s * s) / (side * side * small));
  };
  const place = (row) => {
    const s = row.reduce((a, n) => a + n.area, 0);
    if (w >= h) {
      const cw = s / h; let cy = y;
      row.forEach((n) => { const ch = n.area / cw; out.push({ ...n, x, y: cy, w: cw, h: ch }); cy += ch; });
      x += cw; w -= cw;
    } else {
      const rh = s / w; let cx = x;
      row.forEach((n) => { const c = n.area / rh; out.push({ ...n, x: cx, y, w: c, h: rh }); cx += c; });
      y += rh; h -= rh;
    }
  };
  let row = [];
  while (nodes.length) {
    const side = Math.min(w, h);
    if (!row.length || worst(row.concat(nodes[0]), side) <= worst(row, side)) row.push(nodes.shift());
    else { place(row); row = []; }
  }
  if (row.length) place(row);
  return out;
}

function mix(a, b, t) {
  const pa = a.match(/\w\w/g).map((s) => parseInt(s, 16)), pb = b.match(/\w\w/g).map((s) => parseInt(s, 16));
  return "#" + pa.map((c, i) => Math.round(c + (pb[i] - c) * t).toString(16).padStart(2, "0")).join("");
}
function heat(dayReturn) {
  const FLAT = "#454B55", UP = "#17845B", DOWN = "#B9333F";
  if (!isNum(dayReturn)) return FLAT;
  const t = Math.max(-1, Math.min(1, dayReturn / 3)); // full colour at ±3% in a day
  return t >= 0 ? mix(FLAT, UP, t) : mix(FLAT, DOWN, -t);
}

function renderHeat(theses) {
  const el = $("#treemap");
  const W = el.clientWidth, H = el.clientHeight;
  if (!W || !H) return;
  const rects = squarify(theses.map((t) => ({ ...t, value: t.current ?? t.weight })), 0, 0, W, H);
  el.innerHTML = rects.map((r) => {
    const small = r.w < 130 || r.h < 90, tiny = r.w < 84 || r.h < 60;
    // Text grows and shrinks with the block: limited by its width (name length) and its height
    const nameSize = Math.max(10, 0.85 * Math.min(52, (r.w - 16) / (Math.max(r.name.length, 4) * 0.5), r.h * 0.24));
    const daySize = Math.max(9.5, Math.min(26, nameSize * 0.62));
    const label = `${r.name}, ${isNum(r.day) ? `${pct(r.day)} today` : "no daily change yet"}`;
    return `<a class="tile${small ? " small" : ""}${tiny ? " tiny" : ""}" href="#row-${r.id}" data-row="row-${r.id}" data-id="${r.id}" aria-label="${esc(label)}"
      style="left:${(r.x / W) * 100}%;top:${(r.y / H) * 100}%;width:${(r.w / W) * 100}%;height:${(r.h / H) * 100}%">
      <span class="tile-in" style="background:${heat(r.day)}">
        <span class="tile-name" style="font-size:${nameSize.toFixed(1)}px">${esc(r.name)}</span>
        <span class="tile-day num" style="font-size:${daySize.toFixed(1)}px">${pct(r.day)}</span>
      </span></a>`;
  }).join("");
}

function setupHeatTip(theses) {
  const tip = $("#heat-tip"), map = $("#treemap"), block = map.parentElement;
  const byId = Object.fromEntries(theses.map((t) => [t.id, t]));
  map.addEventListener("pointermove", (e) => {
    if (!canHover() || e.pointerType !== "mouse") return;
    const tile = e.target.closest(".tile");
    if (!tile) { tip.style.display = "none"; return; }
    const t = byId[tile.dataset.id];
    const weightNow = isNum(t.current) ? wpct(t.current, 1) : wpct(t.weight, 1);
    const names = t.holdings.length > 1 ? `<br><b>Holdings:</b> ${t.holdings.map((h) => esc(shortName(h.name))).join(", ")}` : "";
    tip.innerHTML = `<b>Total return:</b> <span class="num">${pct(t.ret)}</span><br><b>Weight:</b> <span class="num">${weightNow}</span>${names}`;
    tip.style.display = "block";
    const box = block.getBoundingClientRect();
    let x = e.clientX - box.left + 14, y = e.clientY - box.top + 14;
    if (x + tip.offsetWidth > box.width) x = e.clientX - box.left - tip.offsetWidth - 14;
    tip.style.left = `${x}px`;
    tip.style.top = `${y}px`;
  });
  map.addEventListener("pointerleave", () => (tip.style.display = "none"));
}

// ---- Theses table ----------------------------------------------------------------
function writeup(t, content) {
  const c = (content && content[t.name]) || {};
  const paras = String(c.summary || "").split(/\n\s*\n/).map((x) => x.trim()).filter(Boolean);
  const text = paras.length ? paras.map((x) => `<p>${esc(x)}</p>`).join("") : `<p class="placeholder">Write-up to come.</p>`;
  const ms = (c.milestones || []).filter((m) => m && m.label);
  const milestones = ms.length
    ? `<ul class="milestones">${ms.map((m) => `<li><span>${esc(m.label)}</span><span class="status">${esc(m.status || "Watching")}</span></li>`).join("")}</ul>` : "";
  return `<details class="writeup"><summary>Write-up<span class="chev" aria-hidden="true"></span></summary>
    <div class="writeup-text">${text}${milestones}</div></details>`;
}

function holdingRow(h) {
  const ret = h.live?.return_pct;
  const gain = isNum(h.value) ? h.value - h.cost : null;
  return `<tr>
    <td><span class="co" title="${esc(h.symbol)}" tabindex="0">${esc(shortName(h.name))}</span><span class="co-tick">${esc(h.symbol)}</span></td>
    <td class="r num"><span class="v">${usd(h.cost)}</span><small>${wpct(h.weight, 1)}</small></td>
    <td class="r num"><span class="v ${dir(ret)}">${usdSigned(gain)}</span><small class="${dir(ret)}">${pct(ret)}</small></td>
    <td class="r num"><span class="v">${isNum(h.value) ? usd(h.value) : "–"}</span><small>${isNum(h.current) ? wpct(h.current, 1) : "–"}</small></td>
  </tr>`;
}

function renderBook(theses, content) {
  $("#book").innerHTML = theses.map((t) => {
    const multi = t.holdings.length > 1;
    const sub = multi ? `<span class="b-sub">${t.holdings.length} holdings</span>` : "";
    const gain = isNum(t.value) ? t.value - t.cost : null;
    const weightNow = isNum(t.current) ? wpct(t.current, 1) : wpct(t.weight, 1);
    const total = multi ? `<tr class="total">
        <td>Total</td>
        <td class="r num"><span class="v">${usd(t.cost)}</span><small>${wpct(t.weight, 1)}</small></td>
        <td class="r num"><span class="v ${dir(t.ret)}">${usdSigned(gain)}</span><small class="${dir(t.ret)}">${pct(t.ret)}</small></td>
        <td class="r num"><span class="v">${isNum(t.value) ? usd(t.value) : "–"}</span><small>${isNum(t.current) ? wpct(t.current, 1) : "–"}</small></td>
      </tr>` : "";
    const table = `<div class="table-wrap"><table>
        <thead><tr><th>Company</th><th class="r">Purchase value<small>Weight</small></th><th class="r">Total gain<small>Return</small></th><th class="r">Current value<small>Current weight</small></th></tr></thead>
        <tbody>${t.holdings.map(holdingRow).join("")}${total}</tbody>
      </table></div>`;
    return `<details id="row-${t.id}" style="--tc:${t.color}">
      <summary class="row-sum">
        <span><span class="b-name">${esc(t.name)}</span>${sub}</span>
        <span class="b-weight num r">${weightNow}</span>
        <span class="chip num ${dir(t.ret)}"><span class="chip-usd">${usdSigned(gain)}</span><span class="chip-pct">${pct(t.ret)}</span></span>
        <span class="chev" aria-hidden="true"></span>
      </summary>
      <div class="row-body">
        <p class="row-figs num"><span>Starting weight:<b>${weight0(t.weight)}</b></span></p>
        ${table}
        ${writeup(t, content)}
      </div>
    </details>`;
  }).join("");

  // Tickers: hover shows them on laptops; a tap on the name shows them on touch screens
  $$("#book .co").forEach((co) => co.addEventListener("click", () => {
    if (!canHover()) co.classList.toggle("show-tick");
  }));
}

// ---- Start ------------------------------------------------------------------------
async function init() {
  const [hText, lText, pText, cText] = await Promise.all([
    load("portfolio/holdings.csv"), load("data/latest.json"), load("data/performance.csv"), load("content/theses.json"),
  ]);
  if (!hText) {
    $("#q-change").textContent = "The portfolio data couldn’t be loaded. Refresh the page to try again.";
    return;
  }
  const holdings = parseCSV(hText);
  let latest = null, content = null, perf = null;
  try { latest = lText ? JSON.parse(lText) : null; } catch (e) { latest = null; }
  try { content = cText ? JSON.parse(cText) : null; } catch (e) { content = null; }
  if (pText) {
    perf = parseCSV(pText).map((r) => {
      const o = { date: r.date };
      Object.keys(r).forEach((k) => { if (k !== "date") o[k] = parseFloat(r[k]); });
      return o;
    });
  }
  const theses = buildTheses(holdings, latest, perf);

  renderQuote(perf, latest);
  drawChart(perf);
  renderHeat(theses);
  setupHeatTip(theses);
  renderBook(theses, content);

  $$(".legend-btn").forEach((b) => b.addEventListener("click", () => {
    const k = b.dataset.bench;
    show[k] = !show[k];
    b.setAttribute("aria-pressed", String(show[k]));
    drawChart(perf);
  }));

  // Clicking or tapping a heat-map block opens that thesis's row and scrolls to it
  const openRow = (id, smooth) => {
    const row = document.getElementById(id);
    if (!row) return;
    row.open = true;
    row.scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: "start" });
    row.querySelector("summary").focus({ preventScroll: true });
  };
  $("#treemap").addEventListener("click", (e) => {
    const tile = e.target.closest(".tile");
    if (!tile) return;
    e.preventDefault();
    $("#heat-tip").style.display = "none";
    history.replaceState(null, "", `#${tile.dataset.row}`);
    openRow(tile.dataset.row, !matchMedia("(prefers-reduced-motion: reduce)").matches);
  });
  if (location.hash.startsWith("#row-")) openRow(location.hash.slice(1), false);

  // Light/dark toggle: remembers the visitor's choice; otherwise follows their device setting
  const themeBtn = $("#theme-btn");
  const currentTheme = () => document.documentElement.dataset.theme ||
    (window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
  const labelTheme = () => themeBtn.setAttribute("aria-label", currentTheme() === "dark" ? "Switch to light mode" : "Switch to dark mode");
  labelTheme();
  themeBtn.addEventListener("click", () => {
    const next = currentTheme() === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("vv-theme", next); } catch (e) { /* storage unavailable: choice lasts for this visit */ }
    labelTheme();
    drawChart(perf);
  });
  window.matchMedia("(prefers-color-scheme: light)").addEventListener("change", () => { labelTheme(); drawChart(perf); });

  let timer;
  window.addEventListener("resize", () => {
    clearTimeout(timer);
    timer = setTimeout(() => { renderHeat(theses); drawChart(perf); }, 150);
  });
}

init();
