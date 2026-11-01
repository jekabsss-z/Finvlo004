const readStore = (key, fallback) => {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
};
const writeStore = (key, value) => localStorage.setItem(key, JSON.stringify(value));
const faviconLink = document.createElement("link");
faviconLink.rel = "icon";
faviconLink.type = "image/png";
faviconLink.href = "finvlo_brand_kit/avatar/finvlo_favicon_64.png";
document.head.append(faviconLink);
const getAccount = () => ({ plan: "Free", tokens: 10, activity: [], ...readStore("finvlo-account", {}) });
const saveAccount = (account) => writeStore("finvlo-account", account);
const getProfile = () => readStore("finvlo-profile", {});
const getWatchlist = () => readStore("finvlo-watchlist", []);
const getExportDefaults = () => ({ summary: true, metrics: true, notes: true, methodology: false, ...readStore("finvlo-export-defaults", {}) });
const appendActivity = (description) => {
  const account = getAccount();
  account.activity = [{ description, date: new Date().toISOString() }, ...account.activity].slice(0, 8);
  saveAccount(account);
};
const escapeHTML = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[character]);
const downloadFile = (filename, content, type) => {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
const parseCsv = (source) => {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  const text = source.replace(/^\uFEFF/, "");
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"' && quoted && text[index + 1] === '"') { cell += '"'; index += 1; }
    else if (character === '"') quoted = !quoted;
    else if (character === "," && !quoted) { row.push(cell.trim()); cell = ""; }
    else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(cell.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cell = "";
    } else cell += character;
  }
  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  if (rows.length < 2) throw new Error("CSV needs a header row and at least one asset row.");
  const headers = rows.shift().map((header) => header.toLowerCase());
  return rows.map((cells) => Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ""])));
};
const bindCsvImport = (inputId, kind) => {
  const input = document.querySelector(`#${inputId}`);
  if (!input) return;
  const status = document.querySelector(kind === "stock" ? "#stock-data-status" : "#fund-data-status");
  const mode = document.querySelector(kind === "stock" ? "#stock-data-mode" : "#fund-data-mode");
  const templateButton = document.querySelector(kind === "stock" ? "#download-stock-template" : "#download-fund-template");
  const headers = kind === "stock" ? "symbol,price,currency,marketcap,roic,revenue,fcf,source,asof" : "symbol,nav,currency,assets,count,yield,fee,return,source,asof";
  templateButton.addEventListener("click", () => {
    const sample = kind === "stock" ? "MSFT,421.72,USD,$3.13T,31.4,13.2,108,Your licensed data source,2026-10-28" : "VOO,532.18,USD,$590B,503,1.3,0.03,12.4,Your licensed data source,2026-10-28";
    downloadFile(`${kind}-daily-import-template.csv`, `${headers}\r\n${sample}\r\n`, "text/csv;charset=utf-8");
  });
  input.addEventListener("change", async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      const imported = parseCsv(await file.text());
      let updated = 0;
      imported.forEach((row) => {
        const symbol = String(row.symbol || "").trim().toUpperCase();
        if (kind === "stock") {
          const asset = stocks.find((item) => item.ticker === symbol);
          if (!asset) return;
          const facts = { ...stockFacts[symbol], ...readStore(`finvlo-stock-facts:${symbol}`, {}) };
          if (row.price) facts.price = Number(row.price);
          if (row.currency) facts.currency = row.currency.toUpperCase();
          if (row.marketcap) facts.marketCap = row.marketcap;
          if (row.source) facts.source = row.source;
          if (row.asof) facts.asOf = row.asof;
          writeStore(`finvlo-stock-facts:${symbol}`, facts);
          const edits = readStore(`finvlo-stock-edits:${symbol}`, {});
          ["roic", "revenue", "fcf"].forEach((key) => { if (row[key] !== "" && row[key] !== undefined) edits[key] = Number(row[key]); });
          if (Object.keys(edits).length) writeStore(`finvlo-stock-edits:${symbol}`, edits);
        } else {
          const asset = funds.find((item) => item.ticker === symbol);
          if (!asset) return;
          const facts = { ...fundFacts[symbol], ...readStore(`finvlo-fund-facts:${symbol}`, {}) };
          if (row.nav) facts.nav = Number(row.nav);
          if (row.currency) facts.currency = row.currency.toUpperCase();
          if (row.assets) facts.assets = row.assets;
          if (row.count) facts.count = row.count;
          if (row.yield) facts.yield = Number(row.yield);
          if (row.source) facts.source = row.source;
          if (row.asof) facts.asOf = row.asof;
          writeStore(`finvlo-fund-facts:${symbol}`, facts);
          const edits = readStore(`finvlo-fund-edits:${symbol}`, {});
          if (row.fee) edits.fee = Number(row.fee);
          if (row.return) edits.return = Number(row.return);
          if (Object.keys(edits).length) writeStore(`finvlo-fund-edits:${symbol}`, edits);
        }
        updated += 1;
      });
      if (!updated) throw new Error("No imported symbols matched this sample catalog.");
      writeStore("finvlo-data-source", { kind: "manual-csv", type: kind, source: imported[0].source, asOf: imported[0].asof, importedAt: new Date().toISOString(), count: updated });
      mode.textContent = "Manual CSV imported";
      status.textContent = `${updated} matching ${kind === "stock" ? "stock" : "fund"} rows imported from ${file.name}${imported[0].source ? ` · source: ${imported[0].source}` : ""}${imported[0].asof ? ` · as of ${imported[0].asof}` : ""}.`;
      window.dispatchEvent(new CustomEvent("finvlo-data-imported"));
    } catch (error) {
      status.textContent = error.message || "Could not read that CSV.";
    } finally {
      input.value = "";
    }
  });
};
bindCsvImport("stock-csv-import", "stock");
bindCsvImport("fund-csv-import", "fund");
const dataSource = readStore("finvlo-data-source", {});
if (dataSource.kind === "manual-csv" || dataSource.kind === "live-api") {
  const statusId = dataSource.type === "fund" ? "#fund-data-status" : "#stock-data-status";
  const modeId = dataSource.type === "fund" ? "#fund-data-mode" : "#stock-data-mode";
  const status = document.querySelector(statusId);
  if (status) status.textContent = dataSource.kind === "live-api" ? `${dataSource.provider} · daily history · last refresh ${new Date(dataSource.updatedAt).toLocaleString()}` : `Manual file import · ${dataSource.count} rows${dataSource.source ? ` · ${dataSource.source}` : ""}${dataSource.asOf ? ` · as of ${dataSource.asOf}` : ""} · ${new Date(dataSource.importedAt).toLocaleString()}`;
  const mode = document.querySelector(modeId);
  if (mode) mode.textContent = dataSource.kind === "live-api" ? `${dataSource.provider} · daily` : "Manual CSV";
}
const refreshMarketData = async (symbol, kind) => {
  const button = document.querySelector("#refresh-asset-data");
  const status = document.querySelector("#asset-data-status");
  if (!button || !status) return null;
  if (location.protocol === "file:") {
    status.textContent = "Automatic daily refresh needs the site hosted with the /api/market-data server function.";
    return null;
  }
  button.disabled = true;
  button.textContent = "Refreshing…";
  status.textContent = "Fetching the latest provider quote and daily history…";
  try {
    const response = await fetch(`/api/market-data?symbol=${encodeURIComponent(symbol)}&kind=${kind}`);
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Market data could not be refreshed.");
    writeStore(`finvlo-live-data:${symbol}`, payload);
    writeStore("finvlo-data-source", { kind: "live-api", type: kind, provider: payload.provider, interval: payload.interval, updatedAt: payload.fetchedAt });
    appendActivity(`${symbol} daily market data refreshed`);
    const coverage = payload.coverage?.dailyHistory ? "daily history + quote" : "quote only · daily history not included in this API plan";
    status.textContent = `${payload.provider} · ${coverage} · refreshed ${new Date(payload.fetchedAt).toLocaleString()}. Quality fundamentals remain manual.`;
    document.querySelector(kind === "fund" ? "#fund-data-badge" : "#company-data-badge").textContent = `${payload.provider.toUpperCase()} / ${payload.coverage?.dailyHistory ? "DAILY PRICE" : "QUOTE"}`;
    return payload;
  } catch (error) {
    status.textContent = error.message || "Daily market data is not connected.";
    return null;
  } finally {
    button.disabled = false;
    button.textContent = "Refresh daily data";
  }
};
const bindReportExport = (buildReport) => {
  const dialog = document.querySelector("#export-dialog");
  const form = document.querySelector("#export-form");
  if (!dialog || !form) return;
  const defaults = getExportDefaults();
  ["summary", "metrics", "notes", "methodology"].forEach((name) => { form.elements.namedItem(name).checked = Boolean(defaults[name]); });
  form.elements.namedItem("reportStyle").value = readStore("finvlo-export-style", "clear");
  form.querySelectorAll('[name="reportStyle"]').forEach((input) => input.addEventListener("change", () => writeStore("finvlo-export-style", input.value)));
  const priceOption = form.elements.namedItem("priceContext");
  if (priceOption) priceOption.checked = Boolean(readStore("finvlo-settings", {}).priceContext);
  document.querySelector("#open-export").addEventListener("click", () => dialog.showModal());
  document.querySelector("#close-export").addEventListener("click", () => dialog.close());
  document.querySelector("#cancel-export").addEventListener("click", () => dialog.close());
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const options = Object.fromEntries(["summary", "metrics", "notes", "methodology", "priceContext"].map((name) => [name, Boolean(form.elements.namedItem(name)?.checked)]));
    const reportStyle = form.elements.namedItem("reportStyle").value;
    const report = buildReport(options, reportStyle);
    const format = form.elements.namedItem("format").value;
    const filename = report.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const reportRows = [["Section", "Item", "Value"], ...report.rows.map((row) => [row.section, row.label, row.value])];
    if (format === "csv") {
      const csv = `\uFEFF${reportRows.map((row) => row.map((cell) => `"${String(cell ?? "").replace(/"/g, "\"\"")}"`).join(",")).join("\r\n")}`;
      downloadFile(`${filename}.csv`, csv, "text/csv;charset=utf-8");
    } else {
      const tableRows = reportRows.map((row, index) => `<tr>${row.map((cell) => index === 0 ? `<th>${escapeHTML(cell)}</th>` : `<td>${escapeHTML(cell)}</td>`).join("")}</tr>`).join("");
      const professional = reportStyle === "professional";
      const cover = professional ? `<header><span>FINVLO / RESEARCH NOTE</span><strong>QUALITY ANALYTICS</strong></header><section class="report-summary"><p>PREPARED ${escapeHTML(new Date().toLocaleDateString())}</p><h1>${escapeHTML(report.title)}</h1><p>${escapeHTML(report.subtitle)}</p></section><div class="report-callout"><strong>Interpretation boundary</strong><span>${escapeHTML(report.disclaimer)}</span></div><h2>Detailed research record</h2>` : `<p class="brand">FINVLO / RESEARCH NOTE</p><h1>${escapeHTML(report.title)}</h1><p>${escapeHTML(report.subtitle)}</p>`;
      const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHTML(report.title)}</title><style>@page{margin:20mm}body{font-family:Arial,sans-serif;color:#263d59;line-height:1.55;font-size:${professional ? "10" : "12"}pt;max-width:900px;margin:32px auto;padding:0 24px}.brand{color:#004aad;font-size:9pt;font-weight:bold;letter-spacing:1px}h1{font-family:Georgia,serif;color:#153e75;font-size:${professional ? "28" : "24"}pt;font-weight:normal;margin:8px 0}h2{font-family:Georgia,serif;color:#153e75;font-size:16pt;font-weight:normal;margin-top:24px}header{display:flex;justify-content:space-between;border-bottom:3px solid #004aad;padding-bottom:12px;color:#004aad;font-size:8pt;letter-spacing:1px}.report-summary{padding:23px 0 15px}.report-summary>p:first-child{color:#71839a;font-size:8pt;letter-spacing:1px}.report-callout{display:grid;gap:4px;padding:12px 14px;margin:14px 0 20px;background:#f1f5fb;border-left:3px solid #2e74b5;font-size:9pt}.report-callout strong{color:#153e75}.report-callout span{color:#536783}table{border-collapse:collapse;width:100%;margin-top:12px}td,th{border:1px solid #d9e1f2;padding:${professional ? "7px" : "9px"};text-align:left;vertical-align:top}th{background:#d9e1f2;color:#153e75;font-size:8pt}tr:nth-child(even) td{background:#fafbfd}.report-footer{margin-top:26px;padding-top:10px;border-top:1px solid #d9e1f2;color:#7689a1;font-size:8pt}</style></head><body>${cover}<table>${tableRows}</table><p class="report-footer">${escapeHTML(report.disclaimer)}<br/>All demo market data is fictional. Not financial advice.</p></body></html>`;
      downloadFile(`${filename}.doc`, html, "application/msword;charset=utf-8");
    }
    document.querySelector("#export-status").textContent = `Downloaded ${format === "csv" ? "Excel-compatible CSV" : "Word-compatible document"}.`;
    dialog.close();
  });
};

document.querySelectorAll(".mobile-menu").forEach((menu) => {
  menu.querySelectorAll("nav a").forEach((link) => link.addEventListener("click", () => { menu.open = false; }));
});

const researchRoutes = new Set(["stocks.html", "etfs.html", "company.html", "fund.html", "checklist.html", "methodology.html", "profile.html"]);
if (researchRoutes.has(location.pathname.split("/").pop())) {
  document.body.classList.add("product-room");
  document.querySelectorAll(".site-header .wordmark").forEach((wordmark) => {
    const image = document.createElement("img");
    image.src = "finvlo_brand_kit/logo/finvlo_wordmark_cream_1500w.png";
    image.alt = "Finvlo";
    wordmark.replaceChildren(image);
  });
  const roomLinks = [
    ["Stocks", "stocks.html"],
    ["Funds", "etfs.html"],
    ["Quality checklist", "checklist.html"],
    ["Methodology", "methodology.html"],
    ["Profile", "profile.html"],
    ["Plans & tokens", "pricing.html"],
  ];
  document.querySelectorAll(".main-nav, .mobile-menu nav").forEach((navigation) => {
    const links = roomLinks.map(([label, href]) => {
      const anchor = document.createElement("a");
      anchor.href = href;
      anchor.textContent = label;
      if (location.pathname.endsWith(href)) anchor.setAttribute("aria-current", "page");
      if (href === "pricing.html") anchor.className = "nav-cta";
      return anchor;
    });
    navigation.replaceChildren(...links);
    const mobileMenu = navigation.closest(".mobile-menu");
    if (mobileMenu) links.forEach((link) => link.addEventListener("click", () => { mobileMenu.open = false; }));
  });
}

if (!researchRoutes.has(location.pathname.split("/").pop())) {
  document.querySelectorAll(".site-header .wordmark").forEach((wordmark) => {
    const image = document.createElement("img");
    image.src = "finvlo_brand_kit/logo/finvlo_wordmark_ink_1500w.png";
    image.alt = "Finvlo";
    wordmark.replaceChildren(image);
  });
}

const footer = document.querySelector(".site-footer, .research-footer");
if (footer) {
  footer.className = "product-footer";
  footer.innerHTML = `
    <div class="product-footer-main">
      <div class="footer-brand-block"><a class="footer-brand" href="index.html" aria-label="Finvlo home"><img src="finvlo_brand_kit/logo/finvlo_wordmark_cream_1500w.png" alt="Finvlo" /></a><p>Business quality, made clearer.</p><span>Quality analytics for your own research. Not financial advice.</span></div>
      <nav class="footer-link-group" aria-label="Product links"><strong>RESEARCH ROOM</strong><a href="stocks.html">Stocks</a><a href="etfs.html">Funds</a><a href="checklist.html">Quality checklist</a><a href="methodology.html">Scoring methodology</a></nav>
      <nav class="footer-link-group" aria-label="Finvlo links"><strong>FINVLO</strong><a href="pricing.html">Plans &amp; tokens</a><a href="profile.html">Profile</a><a href="learn.html">Learn</a><a href="mailto:hello@finvlo.com">Contact</a></nav>
      <nav class="footer-social-group" aria-label="Social platforms"><strong>FOLLOW FINVLO</strong><a href="https://x.com/" target="_blank" rel="noreferrer" aria-label="X platform home; replace with Finvlo's profile"><span class="social-mark social-x" aria-hidden="true">X</span><span>X</span></a><a href="https://www.tiktok.com/" target="_blank" rel="noreferrer" aria-label="TikTok platform home; replace with Finvlo's profile"><span class="social-mark social-tiktok" aria-hidden="true">♪</span><span>TikTok</span></a><a href="https://www.linkedin.com/" target="_blank" rel="noreferrer" aria-label="LinkedIn platform home; replace with Finvlo's profile"><span class="social-mark social-linkedin" aria-hidden="true">in</span><span>LinkedIn</span></a><a href="https://www.instagram.com/" target="_blank" rel="noreferrer" aria-label="Instagram platform home; replace with Finvlo's profile"><span class="social-mark social-instagram" aria-hidden="true"><i></i></span><span>Instagram</span></a></nav>
    </div>
    <div class="product-footer-bottom"><span>© ${new Date().getFullYear()} Finvlo</span><span>Social links currently point to platform homepages. Replace with official Finvlo profiles.</span><span>Sample market data is fictional.</span></div>`;
}

const stocks = [
  { ticker: "MSFT", name: "Microsoft", market: "NASDAQ · US", sector: "Technology", pillars: [94, 92, 90, 91, 84, 89, 88], roic: 31.4, roe: 37.2, margin: 68.5, marginVol: 1.8, revenue: 13.2, fcfGrowth: 11.8, growthVol: 3.1, debt: -0.4, interest: 38.2, altman: 8.4, piotroski: 8, fcf: 108, accruals: -1.4, capex: 13.1, yield: 1.1, retained: 18.6, share: 2.4, concentration: 18, rd: 12.8, beneish: -2.7, insider: 7.4, short: 0.8 },
  { ticker: "AAPL", name: "Apple", market: "NASDAQ · US", sector: "Technology", pillars: [91, 83, 87, 89, 92, 91, 85], roic: 46.8, roe: 157, margin: 46.2, marginVol: 1.2, revenue: 8.1, fcfGrowth: 9.4, growthVol: 5.2, debt: 0.2, interest: 29.6, altman: 7.8, piotroski: 7, fcf: 104, accruals: -0.9, capex: 3.2, yield: 2.4, retained: 21.2, share: 1.2, concentration: 21, rd: 8.1, beneish: -2.4, insider: 5.1, short: 0.7 },
  { ticker: "ASML", name: "ASML Holding", market: "Euronext · NL", sector: "Technology", pillars: [93, 89, 84, 86, 88, 96, 91], roic: 27.5, roe: 51, margin: 51.3, marginVol: 3.8, revenue: 17.4, fcfGrowth: 19.2, growthVol: 12.1, debt: 0.1, interest: 26.5, altman: 9.1, piotroski: 8, fcf: 96, accruals: 1.1, capex: 2.8, yield: 1.6, retained: 16.8, share: 8.2, concentration: 35, rd: 14.2, beneish: -2.2, insider: 0.1, short: 1.2 },
  { ticker: "NVO", name: "Novo Nordisk", market: "Copenhagen · DK", sector: "Healthcare", pillars: [94, 87, 82, 86, 83, 92, 86], roic: 67, roe: 78, margin: 83.1, marginVol: 2.3, revenue: 18.8, fcfGrowth: 20.4, growthVol: 8.4, debt: 0.2, interest: 41, altman: 12.1, piotroski: 8, fcf: 102, accruals: -0.5, capex: 4.5, yield: 1.4, retained: 24.3, share: 2.3, concentration: 29, rd: 14.1, beneish: -2.1, insider: 28, short: 0.6 },
  { ticker: "SAP", name: "SAP SE", market: "Xetra · DE", sector: "Technology", pillars: [86, 80, 82, 84, 88, 84, 87], roic: 14.8, roe: 13.1, margin: 72.4, marginVol: 2.4, revenue: 6.6, fcfGrowth: 9.5, growthVol: 2.8, debt: 0.8, interest: 11.5, altman: 5.3, piotroski: 7, fcf: 112, accruals: -0.8, capex: 4.1, yield: 1.8, retained: 11.5, share: 1.8, concentration: 17, rd: 16.2, beneish: -2.0, insider: 0.3, short: 0.9 },
  { ticker: "TSM", name: "Taiwan Semiconductor", market: "TWSE · TW", sector: "Technology", pillars: [92, 87, 88, 85, 80, 91, 88], roic: 25.7, roe: 29.5, margin: 56.1, marginVol: 4.2, revenue: 14.6, fcfGrowth: 13.7, growthVol: 7.8, debt: -0.2, interest: 81, altman: 13.4, piotroski: 8, fcf: 92, accruals: 1.7, capex: 37.2, yield: 1.9, retained: 14.7, share: 4.1, concentration: 39, rd: 8.5, beneish: -2.3, insider: 6.3, short: 0.2 },
  { ticker: "MC", name: "LVMH", market: "Euronext · FR", sector: "Consumer", pillars: [84, 81, 82, 83, 86, 87, 85], roic: 13.9, roe: 22.1, margin: 68.7, marginVol: 2.6, revenue: 9.2, fcfGrowth: 7.6, growthVol: 6.4, debt: 1.1, interest: 12.8, altman: 5.1, piotroski: 7, fcf: 91, accruals: 0.8, capex: 5.3, yield: 1.7, retained: 13.3, share: 1.1, concentration: 12, rd: 1.7, beneish: -2.0, insider: 49, short: 0.3 },
  { ticker: "RY", name: "Royal Bank of Canada", market: "TSX · CA", sector: "Financials", pillars: [81, 78, 74, 77, 80, 79, 83], roic: 12.4, roe: 15.8, margin: 0, marginVol: 0, revenue: 7.1, fcfGrowth: 8.3, growthVol: 4.5, debt: 0, interest: 0, altman: 0, piotroski: 6, fcf: 88, accruals: 0, capex: 0, yield: 4.1, retained: 12.1, share: 0.4, concentration: 0, rd: 0, beneish: -2.1, insider: 0.1, short: 0.5 },
  { ticker: "7203", name: "Toyota Motor", market: "Tokyo · JP", sector: "Consumer", pillars: [82, 77, 84, 78, 82, 81, 79], roic: 9.8, roe: 10.2, margin: 18.3, marginVol: 3.5, revenue: 7.8, fcfGrowth: 10.4, growthVol: 8.2, debt: 0.3, interest: 18.7, altman: 4.8, piotroski: 7, fcf: 95, accruals: 1.2, capex: 7.4, yield: 3.2, retained: 9.3, share: 1.6, concentration: 15, rd: 3.6, beneish: -2.0, insider: 12.4, short: 0.3 },
  { ticker: "SHEL", name: "Shell plc", market: "LSE · UK", sector: "Energy", pillars: [83, 69, 78, 74, 85, 75, 80], roic: 12.1, roe: 11.5, margin: 24.2, marginVol: 14.8, revenue: 3.5, fcfGrowth: 5.1, growthVol: 22.3, debt: 0.6, interest: 15.4, altman: 3.4, piotroski: 6, fcf: 123, accruals: -1.8, capex: 8.7, yield: 8.3, retained: 7.4, share: -0.8, concentration: 21, rd: 0.6, beneish: -2.0, insider: 0.2, short: 0.7 },
  { ticker: "RELIANCE", name: "Reliance Industries", market: "NSE · IN", sector: "Consumer", pillars: [78, 83, 72, 70, 81, 76, 74], roic: 9.1, roe: 9.8, margin: 17.5, marginVol: 4.9, revenue: 10.7, fcfGrowth: 12.8, growthVol: 9.6, debt: 1.7, interest: 6.8, altman: 3.9, piotroski: 6, fcf: 72, accruals: 3.1, capex: 11.3, yield: 0.6, retained: 8.5, share: 0.9, concentration: 26, rd: 0.8, beneish: -1.9, insider: 49, short: 0.1 },
  { ticker: "BHP", name: "BHP Group", market: "ASX · AU", sector: "Materials", pillars: [81, 70, 85, 78, 83, 77, 82], roic: 22.1, roe: 27.3, margin: 49.2, marginVol: 16.5, revenue: 5.8, fcfGrowth: 1.2, growthVol: 26.4, debt: 0.3, interest: 22.5, altman: 6.7, piotroski: 7, fcf: 118, accruals: -1.2, capex: 23.4, yield: 9.6, retained: 5.8, share: -1.1, concentration: 22, rd: 0.4, beneish: -2.3, insider: 0.1, short: 0.4 },
];
const stockFacts = {
  MSFT: { price: 421.72, currency: "USD", marketCap: "$3.13T", exchange: "NASDAQ", country: "United States", employees: "228,000" },
  AAPL: { price: 196.44, currency: "USD", marketCap: "$3.00T", exchange: "NASDAQ", country: "United States", employees: "164,000" },
  ASML: { price: 912.50, currency: "EUR", marketCap: "€359B", exchange: "Euronext Amsterdam", country: "Netherlands", employees: "44,000" },
  NVO: { price: 785.20, currency: "DKK", marketCap: "DKK 3.5T", exchange: "Nasdaq Copenhagen", country: "Denmark", employees: "77,000" },
  SAP: { price: 242.10, currency: "EUR", marketCap: "€298B", exchange: "Xetra", country: "Germany", employees: "108,000" },
  TSM: { price: 182.30, currency: "USD", marketCap: "$941B", exchange: "NYSE ADR", country: "Taiwan", employees: "76,000" },
  MC: { price: 683.00, currency: "EUR", marketCap: "€340B", exchange: "Euronext Paris", country: "France", employees: "211,000" },
  RY: { price: 142.80, currency: "CAD", marketCap: "C$200B", exchange: "Toronto Stock Exchange", country: "Canada", employees: "97,000" },
  "7203": { price: 2820, currency: "JPY", marketCap: "¥45T", exchange: "Tokyo Stock Exchange", country: "Japan", employees: "380,000" },
  SHEL: { price: 31.50, currency: "GBP", marketCap: "£204B", exchange: "London Stock Exchange", country: "United Kingdom", employees: "103,000" },
  RELIANCE: { price: 1320, currency: "INR", marketCap: "$178B", exchange: "NSE India", country: "India", employees: "347,000" },
  BHP: { price: 42.80, currency: "AUD", marketCap: "A$216B", exchange: "Australian Securities Exchange", country: "Australia", employees: "90,000" },
};
const stockDescriptions = {
  MSFT: "Develops operating systems, productivity software, cloud infrastructure, and enterprise services.", AAPL: "Designs consumer devices and provides software, services, and a connected device ecosystem.", ASML: "Supplies lithography systems and related services used in advanced semiconductor manufacturing.", NVO: "Develops and manufactures medicines focused on diabetes, obesity, and related conditions.", SAP: "Provides enterprise software for finance, operations, human resources, and supply-chain workflows.", TSM: "Manufactures semiconductor chips for customers across computing, mobile, and industrial markets.", MC: "Operates a portfolio of luxury brands across fashion, wines, cosmetics, and retail.", RY: "Provides personal, commercial, and capital-markets financial services in Canada and internationally.", "7203": "Designs, manufactures, and sells vehicles and mobility services across global markets.", SHEL: "Produces and markets energy products, including integrated gas, oil, chemicals, and renewables.", RELIANCE: "Operates across energy, retail, digital services, and consumer businesses in India.", BHP: "Produces iron ore, copper, and other commodities for global industrial customers.",
};
const funds = [
  { ticker: "VOO", name: "Vanguard S&P 500 ETF", category: "US Equity", region: "United States", fee: 0.03, return: 12.4, holdings: 83, positions: [["MSFT", 7.2], ["AAPL", 6.1], ["NVDA", 5.5], ["AMZN", 3.8]] },
  { ticker: "VT", name: "Vanguard Total World Stock ETF", category: "International", region: "Global", fee: 0.07, return: 10.1, holdings: 79, positions: [["MSFT", 4.1], ["AAPL", 3.5], ["NVDA", 3.2], ["TSM", 1.8]] },
  { ticker: "QQQ", name: "Invesco QQQ Trust", category: "US Equity", region: "United States", fee: 0.20, return: 14.8, holdings: 82, positions: [["MSFT", 8.7], ["AAPL", 7.4], ["NVDA", 7.1], ["AVGO", 5.0]] },
  { ticker: "VXUS", name: "Vanguard Total International Stock ETF", category: "International", region: "Global ex-US", fee: 0.08, return: 7.3, holdings: 75, positions: [["TSM", 2.4], ["NVO", 1.2], ["ASML", 1.1], ["SAP", 0.9]] },
  { ticker: "IWM", name: "iShares Russell 2000 ETF", category: "US Equity", region: "United States", fee: 0.19, return: 8.8, holdings: 73, positions: [["Sample small-cap A", 0.4], ["Sample small-cap B", 0.3], ["Sample small-cap C", 0.3]] },
  { ticker: "EUNL", name: "iShares Core MSCI World UCITS ETF", category: "International", region: "Developed markets", fee: 0.20, return: 9.7, holdings: 80, positions: [["MSFT", 4.8], ["AAPL", 4.1], ["NVDA", 3.5], ["ASML", 1.0]] },
  { ticker: "EWJ", name: "iShares MSCI Japan ETF", category: "International", region: "Japan", fee: 0.50, return: 7.6, holdings: 77, positions: [["Toyota Motor", 5.1], ["Sony Group", 2.4], ["Mitsubishi UFJ", 2.1], ["Hitachi", 1.8]] },
  { ticker: "VUSA", name: "Vanguard S&P 500 UCITS ETF", category: "US Equity", region: "United States", fee: 0.07, return: 12.2, holdings: 83, positions: [["MSFT", 7.1], ["AAPL", 6.0], ["NVDA", 5.4], ["AMZN", 3.7]] },
  { ticker: "IEMG", name: "iShares Core MSCI Emerging Markets ETF", category: "International", region: "Emerging markets", fee: 0.09, return: 6.4, holdings: 72, positions: [["TSM", 8.3], ["Tencent", 3.8], ["Alibaba", 2.1], ["Reliance", 1.5]] },
  { ticker: "VEA", name: "Vanguard FTSE Developed Markets ETF", category: "International", region: "Developed markets", fee: 0.03, return: 8.2, holdings: 78, positions: [["Toyota Motor", 1.4], ["ASML", 1.3], ["Samsung Electronics", 1.1], ["Nestlé", 0.9]] },
];
const fundFacts = {
  VOO: { nav: 532.18, currency: "USD", assets: "$590B", count: "503", yield: 1.3 }, VT: { nav: 112.46, currency: "USD", assets: "$48B", count: "9,800+", yield: 1.8 }, QQQ: { nav: 458.70, currency: "USD", assets: "$320B", count: "101", yield: 0.6 },
  VXUS: { nav: 64.12, currency: "USD", assets: "$70B", count: "8,500+", yield: 3.0 }, IWM: { nav: 202.45, currency: "USD", assets: "$68B", count: "1,970", yield: 1.3 }, EUNL: { nav: 97.82, currency: "EUR", assets: "€90B", count: "1,400+", yield: 1.5 },
  EWJ: { nav: 69.35, currency: "USD", assets: "$15B", count: "180", yield: 2.1 }, VUSA: { nav: 98.40, currency: "EUR", assets: "€35B", count: "503", yield: 1.3 }, IEMG: { nav: 54.76, currency: "USD", assets: "$78B", count: "3,000+", yield: 2.4 }, VEA: { nav: 51.20, currency: "USD", assets: "$160B", count: "3,900+", yield: 2.8 },
};
const fundDescriptions = {
  VOO: { description: "Broad U.S. large-cap equity exposure tracking a 500-company index.", benchmark: "S&P 500 Index", replication: "Physical · full replication", domicile: "United States", inception: "2010 · sample" },
  VT: { description: "Global equity exposure across developed and emerging markets.", benchmark: "FTSE Global All Cap Index", replication: "Physical · sampling", domicile: "United States", inception: "2008 · sample" },
  QQQ: { description: "Large non-financial companies listed on the Nasdaq exchange.", benchmark: "Nasdaq-100 Index", replication: "Physical · full replication", domicile: "United States", inception: "1999 · sample" },
  VXUS: { description: "Broad international equities outside the United States.", benchmark: "FTSE Global All Cap ex US", replication: "Physical · sampling", domicile: "United States", inception: "2011 · sample" },
  IWM: { description: "Small-cap U.S. companies represented in the Russell 2000.", benchmark: "Russell 2000 Index", replication: "Physical · representative sampling", domicile: "United States", inception: "2000 · sample" },
  EUNL: { description: "Developed-market equities across large and mid-sized companies.", benchmark: "MSCI World Index", replication: "Physical · optimized sampling", domicile: "Ireland", inception: "2009 · sample" },
  EWJ: { description: "Japanese equities across large and mid-sized listed companies.", benchmark: "MSCI Japan Index", replication: "Physical · sampling", domicile: "United States", inception: "1996 · sample" },
  VUSA: { description: "A UCITS share class providing broad U.S. large-cap exposure.", benchmark: "S&P 500 Index", replication: "Physical · full replication", domicile: "Ireland", inception: "2012 · sample" },
  IEMG: { description: "Emerging-market equities across large, mid, and small companies.", benchmark: "MSCI Emerging Markets IMI", replication: "Physical · sampling", domicile: "United States", inception: "2012 · sample" },
  VEA: { description: "Developed-market equities outside the United States.", benchmark: "FTSE Developed All Cap ex US", replication: "Physical · sampling", domicile: "United States", inception: "2007 · sample" },
};
const rankSampleMetric = (field, lowerIsBetter) => {
  const sorted = [...funds].sort((a, b) => lowerIsBetter ? a[field] - b[field] : b[field] - a[field]);
  const scores = new Map();
  sorted.forEach((fund, index) => {
    const ties = sorted.map((item, tieIndex) => item[field] === fund[field] ? tieIndex : -1).filter((tieIndex) => tieIndex >= 0);
    const averageRank = ties.reduce((sum, rank) => sum + rank, 0) / ties.length;
    scores.set(fund.ticker, Math.round(100 - (averageRank / (sorted.length - 1)) * 100));
  });
  return scores;
};
const feeRanks = rankSampleMetric("fee", true);
const returnRanks = rankSampleMetric("return", false);
funds.forEach((fund) => {
  fund.score = Math.round(feeRanks.get(fund.ticker) * 0.3 + returnRanks.get(fund.ticker) * 0.3 + fund.holdings * 0.4);
});

const percent = (value) => `${Number(value).toFixed(1)}%`;
const compactCurrency = (value, currency) => {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency, notation: "compact", maximumFractionDigits: 2 }).format(Number(value));
  } catch {
    return `${currency} ${Number(value).toLocaleString()}`;
  }
};
const companyScore = (company) => Math.round(company.pillars.reduce((total, value) => total + value, 0) / company.pillars.length);
const scoreBadge = (score) => `<span class="score-cell ${score < 75 ? "score-mid" : ""}">${score}</span>`;
const getAccountTokens = () => Number(getAccount().tokens || 0);
const spendToken = (description = "Analysis run") => {
  const account = getAccount();
  if (account.tokens < 1) return false;
  account.tokens -= 1;
  account.activity = [{ description, date: new Date().toISOString() }, ...account.activity].slice(0, 8);
  saveAccount(account);
  return true;
};
const setWatchlistButton = (button, item) => {
  if (!button) return;
  const update = () => {
    const saved = getWatchlist().some((entry) => entry.ticker === item.ticker);
    button.setAttribute("aria-pressed", String(saved));
    button.innerHTML = `<span aria-hidden="true">${saved ? "★" : "☆"}</span> ${saved ? "Saved to watchlist" : "Add to watchlist"}`;
  };
  update();
  button.addEventListener("click", () => {
    const list = getWatchlist();
    const exists = list.some((entry) => entry.ticker === item.ticker);
    const next = exists ? list.filter((entry) => entry.ticker !== item.ticker) : [...list, { ticker: item.ticker, name: item.name, url: item.url }];
    writeStore("finvlo-watchlist", next);
    update();
  });
};

const stockList = document.querySelector("#stock-list");
if (stockList) {
  let sector = "All";
  let sortBy = "score";
  const search = document.querySelector("#stock-search");
  const sort = document.querySelector("#stock-sort");
  const render = () => {
    const query = search.value.trim().toLowerCase();
    const rows = stocks.filter((stock) => (sector === "All" || stock.sector === sector) && `${stock.name} ${stock.ticker} ${stock.market}`.toLowerCase().includes(query));
    rows.sort((a, b) => sortBy === "name" ? a.name.localeCompare(b.name) : sortBy === "ticker" ? a.ticker.localeCompare(b.ticker) : companyScore(b) - companyScore(a));
    stockList.innerHTML = rows.map((stock) => {
      const current = { ...stock, ...readStore(`finvlo-stock-edits:${stock.ticker}`, {}) };
      const facts = { ...stockFacts[stock.ticker], ...readStore(`finvlo-stock-facts:${stock.ticker}`, {}) };
      const live = readStore(`finvlo-live-data:${stock.ticker}`, null);
      const currency = live?.profile?.currency || live?.quote?.currency || facts.currency;
      const displayedPrice = Number(live?.quote?.price) || Number(facts.price);
      const score = companyScore(current);
      const checks = Math.round((score / 100) * 22);
      return `<tr><td><div class="table-company"><span class="company-monogram">${stock.ticker.slice(0, 2)}</span><span class="company-name-cell"><strong>${stock.name}</strong><small>${stock.ticker}</small></span></div></td><td>${stock.market}</td><td>${stock.sector}</td><td>${currency} ${displayedPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td><td>${scoreBadge(score)}</td><td>${percent(current.roic)}</td><td>${percent(current.revenue)}</td><td><span class="check-count">${checks} / 22</span><div class="quality-meter"><i style="width:${checks / 22 * 100}%"></i></div></td><td><a class="row-open" aria-label="Open ${stock.name}" href="company.html?ticker=${encodeURIComponent(stock.ticker)}">→</a></td></tr>`;
    }).join("");
    document.querySelector("#stock-count").textContent = `${rows.length} ${rows.length === 1 ? "company" : "companies"}`;
  };
  search.addEventListener("input", render);
  sort.addEventListener("change", () => { sortBy = sort.value; render(); });
  document.querySelectorAll("[data-sector]").forEach((button) => button.addEventListener("click", () => {
    document.querySelector("[data-sector].is-active")?.classList.remove("is-active");
    button.classList.add("is-active");
    sector = button.dataset.sector;
    render();
  }));
  document.querySelector("#sample-company-count").textContent = stocks.length;
  document.querySelector("#quality-leader-count").textContent = stocks.filter((stock) => companyScore(stock) > 80).length;
  window.addEventListener("finvlo-data-imported", render);
  render();
}

const etfList = document.querySelector("#etf-list");
if (etfList) {
  let category = "All";
  const search = document.querySelector("#etf-search");
  const sort = document.querySelector("#etf-sort");
  const render = () => {
    const query = search.value.trim().toLowerCase();
    const allFunds = funds.map((fund) => ({ ...fund, ...readStore(`finvlo-fund-edits:${fund.ticker}`, {}) }));
    const rankBy = (field, lowerIsBetter) => {
      const ranked = [...allFunds].sort((a, b) => lowerIsBetter ? a[field] - b[field] : b[field] - a[field]);
      return new Map(ranked.map((fund, index) => {
        const tiedRanks = ranked.map((item, tiedIndex) => item[field] === fund[field] ? tiedIndex : -1).filter((value) => value >= 0);
        const averageRank = tiedRanks.reduce((sum, value) => sum + value, 0) / tiedRanks.length;
        return [fund.ticker, Math.round(100 - averageRank / (ranked.length - 1) * 100)];
      }));
    };
    const currentFeeRanks = rankBy("fee", true);
    const currentReturnRanks = rankBy("return", false);
    const currentHoldingsQuality = (fund) => {
      if (!fund.positions?.length || Array.isArray(fund.positions[0])) return fund.holdings;
      const totalWeight = fund.positions.reduce((sum, item) => sum + Number(item.weight), 0);
      return totalWeight ? Math.round(fund.positions.reduce((sum, item) => sum + Number(item.weight) * Number(item.quality), 0) / totalWeight) : fund.holdings;
    };
    const currentScores = new Map(allFunds.map((fund) => [fund.ticker, Math.round(currentFeeRanks.get(fund.ticker) * 0.3 + currentReturnRanks.get(fund.ticker) * 0.3 + currentHoldingsQuality(fund) * 0.4)]));
    const rows = allFunds.filter((fund) => (category === "All" || fund.category === category) && `${fund.name} ${fund.ticker} ${fund.region}`.toLowerCase().includes(query));
    rows.sort((a, b) => sort.value === "fee" ? a.fee - b.fee : sort.value === "return" ? b.return - a.return : currentScores.get(b.ticker) - currentScores.get(a.ticker));
    etfList.innerHTML = rows.map((fund) => {
      const facts = { ...fundFacts[fund.ticker], ...readStore(`finvlo-fund-facts:${fund.ticker}`, {}) };
      const live = readStore(`finvlo-live-data:${fund.ticker}`, null);
      const currency = live?.quote?.currency || facts.currency;
      const nav = Number(live?.quote?.price) || Number(facts.nav);
      const holdingsQuality = currentHoldingsQuality(fund);
      const score = currentScores.get(fund.ticker);
      return `<tr><td><div class="table-company"><span class="fund-monogram">${fund.ticker.slice(0, 2)}</span><span class="company-name-cell"><strong>${fund.name}</strong><small>${fund.ticker}</small></span></div></td><td>${fund.category}</td><td>${fund.region}</td><td>${currency} ${nav.toFixed(2)}</td><td>${scoreBadge(score)}</td><td>${fund.fee.toFixed(2)}%</td><td>${percent(fund.return)}</td><td>${scoreBadge(holdingsQuality)}</td><td><a class="row-open" aria-label="Open ${fund.name}" href="fund.html?ticker=${encodeURIComponent(fund.ticker)}">→</a></td></tr>`;
    }).join("");
    document.querySelector("#etf-count").textContent = `${rows.length} ${rows.length === 1 ? "fund" : "funds"}`;
  };
  search.addEventListener("input", render);
  sort.addEventListener("change", render);
  document.querySelectorAll("[data-fund-category]").forEach((button) => button.addEventListener("click", () => {
    document.querySelector("[data-fund-category].is-active")?.classList.remove("is-active");
    button.classList.add("is-active");
    category = button.dataset.fundCategory;
    render();
  }));
  window.addEventListener("finvlo-data-imported", render);
  render();
}

const bindDetailChartPeriods = (kind, entity) => {
  const svg = document.querySelector(".detail-chart svg");
  if (!svg) return;
  const isFund = kind === "fund";
  const chartPanel = svg.closest(".chart-panel");
  chartPanel.querySelector("h2").textContent = isFund ? "Fund analytics" : "Company fundamentals";
  chartPanel.querySelector(".market-panel-head p").textContent = isFund ? "Fictional sample series · hover a point for detail" : "Fictional business metrics · not price performance";
  const controls = document.createElement("div");
  controls.className = "chart-series-control";
  controls.setAttribute("role", "group");
  controls.setAttribute("aria-label", isFund ? "Fund chart measure" : "Company chart measure");
  const modes = isFund ? [["nav", "NAV price"], ["quality", "Holdings quality"], ["return", "Past return"], ["yield", "Distribution yield"]] : [["price", "Share price"], ["revenue", "Revenue index"], ["margin", "Gross margin"], ["fcf", "FCF index"]];
  const legend = chartPanel.querySelector(".chart-legend > span");
  const legendIcon = legend.querySelector("i");
  const seriesLabel = document.createElement("span");
  seriesLabel.id = "chart-series-label";
  legend.replaceChildren(legendIcon, seriesLabel);
  modes.forEach(([key, label], index) => {
    const button = document.createElement("button");
    button.className = `series-button ${index === 0 ? "is-active" : ""}`;
    button.dataset.chartMode = key;
    button.type = "button";
    button.textContent = label;
    controls.append(button);
  });
  chartPanel.querySelector(".market-panel-head").insertAdjacentElement("afterend", controls);
  const pointsGroup = svg.querySelector(".chart-hover-points") || svg.appendChild(document.createElementNS("http://www.w3.org/2000/svg", "g"));
  pointsGroup.classList.add("chart-hover-points");
  let tooltip = chartPanel.querySelector(".chart-hover-tooltip");
  if (!tooltip) {
    tooltip = document.createElement("div");
    tooltip.className = "chart-hover-tooltip";
    tooltip.setAttribute("role", "status");
    tooltip.hidden = true;
    svg.closest(".detail-chart").append(tooltip);
  }
  let activeMode = modes[0][0];
  let activePeriod = "1Y";
  const periodConfig = {
    "1Y": { years: 1, labels: ["Jan", "Mar", "May", "Jul", "Sep", "Nov"] },
    "3Y": { years: 3, labels: ["2023", "H2", "2024", "H2", "2025", "2026"] },
    "5Y": { years: 5, labels: ["2021", "2022", "2023", "2024", "2025", "2026"] },
  };
  const getValues = () => {
    const years = periodConfig[activePeriod].years;
    const priceMode = isFund ? activeMode === "nav" : activeMode === "price";
    if (priceMode) {
      const liveHistory = readStore(`finvlo-live-data:${entity.ticker}`, null)?.history || [];
      if (liveHistory.length > 1) {
        const cutoff = new Date();
        cutoff.setUTCDate(cutoff.getUTCDate() - years * 365);
        const range = liveHistory.filter((item) => new Date(item.date) >= cutoff);
        const selected = range.length > 1 ? range : liveHistory;
        const points = [0, 1, 2, 3, 4, 5].map((index) => selected[Math.round(index * (selected.length - 1) / 5)]);
        activeLabels = points.map((point) => point.date.slice(0, 7));
        return points.map((point) => Number(point.close));
      }
    }
    activeLabels = periodConfig[activePeriod].labels;
    if (isFund) {
      const base = activeMode === "nav" ? entity.nav : activeMode === "quality" ? entity.holdings : activeMode === "yield" ? entity.distributionYield : entity.return;
      const slope = activeMode === "nav" ? Math.max(entity.return / 12, 0.1) : activeMode === "quality" ? 0.8 : activeMode === "yield" ? 0.08 : Math.max(Math.abs(entity.return) / 8, 0.2);
      return [0, 1, 2, 3, 4, 5].map((step) => Number((base + (step - 2.5) * slope * years + Math.sin(step * 1.7 + entity.fee) * slope).toFixed(2)));
    }
    if (activeMode === "price") return [0, 1, 2, 3, 4, 5].map((step) => Number((entity.price * Math.pow(Math.max(0.1, 1 + entity.revenue / 100), ((step - 5) * years) / 5) * (1 + Math.sin(step * 1.3) * 0.025)).toFixed(2)));
    if (activeMode === "margin") return [0, 1, 2, 3, 4, 5].map((step) => Math.max(0, Number((entity.margin + Math.sin(step * 1.3) * entity.marginVol * years / 3).toFixed(2))));
    if (activeMode === "fcf") return [0, 1, 2, 3, 4, 5].map((step) => Number((entity.fcf * Math.pow(Math.max(0.1, 1 + entity.fcfGrowth / 100), ((step - 5) * years) / 5) + Math.sin(step * 1.2) * entity.accruals).toFixed(2)));
    return [0, 1, 2, 3, 4, 5].map((step) => Number((100 * Math.pow(Math.max(0.1, 1 + entity.revenue / 100), ((step - 5) * years) / 5)).toFixed(2)));
  };
  const render = () => {
    const values = getValues();
    const minimum = Math.min(...values);
    const maximum = Math.max(...values);
    const range = maximum - minimum || 1;
    const points = values.map((value, index) => ({ x: index * 140, y: 170 - ((value - minimum) / range) * 145, value }));
    const path = points.map((point, index) => `${index ? "L" : "M"}${point.x} ${point.y}`).join(" ");
    svg.querySelector(".detail-line").setAttribute("d", path);
    svg.querySelector(".detail-area").setAttribute("d", `${path} L700 184 L0 184Z`);
    pointsGroup.replaceChildren(...points.map((point, index) => {
      const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      circle.setAttribute("cx", point.x);
      circle.setAttribute("cy", point.y);
      circle.setAttribute("r", "5");
      circle.setAttribute("class", "chart-point");
      circle.dataset.value = String(point.value);
      circle.dataset.label = activeLabels[index];
      circle.dataset.mode = activeMode;
      circle.dataset.period = activePeriod;
      circle.setAttribute("tabindex", "0");
      const isPercent = ["margin", "return", "yield"].includes(activeMode);
      const isPrice = activeMode === "price" || activeMode === "nav";
      const unit = isPercent ? "%" : activeMode === "quality" ? " / 100" : " index";
      circle.setAttribute("aria-label", `${activeLabels[index]}: ${isPrice ? `${entity.currency} ` : ""}${point.value}${isPrice ? "" : unit}`);
      const show = () => {
        const label = activeLabels[index];
        tooltip.textContent = `${label} · ${isPrice ? `${entity.currency} ` : ""}${point.value}${isPrice ? "" : unit} · fictional sample`;
        tooltip.hidden = false;
        tooltip.style.left = `${Math.max(4, Math.min(72, (point.x / 700) * 100))}%`;
        tooltip.style.top = `${Math.max(0, (point.y / 190) * 100 - 22)}%`;
      };
      circle.addEventListener("pointerenter", show);
      circle.addEventListener("focus", show);
      circle.addEventListener("pointerleave", () => { tooltip.hidden = true; });
      circle.addEventListener("blur", () => { tooltip.hidden = true; });
      return circle;
    }));
    document.querySelectorAll(".chart-axis-labels span").forEach((label, index) => { label.textContent = activeLabels[index]; });
    const axisLabels = chartPanel.querySelectorAll(".chart-y-axis span");
    axisLabels.forEach((label, index) => {
      const tick = maximum - ((maximum - minimum) * index / (axisLabels.length - 1));
      const isPrice = activeMode === "price" || activeMode === "nav";
      label.textContent = `${isPrice ? `${entity.currency} ` : ""}${tick.toFixed(1)}${["margin", "return", "yield"].includes(activeMode) ? "%" : activeMode === "quality" ? " pts" : ""}`;
    });
    const modeLabel = modes.find(([key]) => key === activeMode)?.[1] || "Sample series";
    seriesLabel.textContent = `${modeLabel} · illustrative`;
  };
  controls.addEventListener("click", (event) => {
    const button = event.target.closest("[data-chart-mode]");
    if (!button) return;
    controls.querySelector(".is-active")?.classList.remove("is-active");
    button.classList.add("is-active");
    activeMode = button.dataset.chartMode;
    render();
  });
  document.querySelectorAll("[data-chart-period]").forEach((button) => button.addEventListener("click", () => {
    document.querySelector("[data-chart-period].is-active")?.classList.remove("is-active");
    button.classList.add("is-active");
    activePeriod = button.dataset.chartPeriod;
    render();
  }));
  render();
  return render;
};

const companyName = document.querySelector("#company-name");
if (companyName) {
  const params = new URLSearchParams(location.search);
  const stockBase = stocks.find((item) => item.ticker === params.get("ticker")) || stocks[0];
  const companyStorageKey = `finvlo-stock-edits:${stockBase.ticker}`;
  const companyFactsKey = `finvlo-stock-facts:${stockBase.ticker}`;
  const cachedCompanyData = readStore(`finvlo-live-data:${stockBase.ticker}`, null);
  const cachedCompanyQuote = cachedCompanyData?.quote || {};
  const cachedCompanyProfile = cachedCompanyData?.profile || {};
  const companyFacts = { ...stockFacts[stockBase.ticker], ...readStore(companyFactsKey, {}), ...(Number(cachedCompanyQuote.price) ? { price: Number(cachedCompanyQuote.price) } : {}), ...(cachedCompanyProfile.currency ? { currency: cachedCompanyProfile.currency } : {}), ...(Number(cachedCompanyProfile.marketCap) ? { marketCap: compactCurrency(cachedCompanyProfile.marketCap, cachedCompanyProfile.currency || "USD") } : {}), ...(cachedCompanyProfile.exchangeShortName ? { exchange: cachedCompanyProfile.exchangeShortName } : {}), ...(cachedCompanyProfile.country ? { country: cachedCompanyProfile.country } : {}), ...(cachedCompanyProfile.fullTimeEmployees ? { employees: Number(cachedCompanyProfile.fullTimeEmployees).toLocaleString() } : {}) };
  const company = { ...stockBase, ...readStore(companyStorageKey, {}), ...companyFacts };
  let renderCompanyChart;
  const pillars = ["Profitability", "Growth", "Balance sheet", "Cash flow", "Capital allocation", "Moat", "Earnings integrity"];
  const score = companyScore(company);
  companyName.textContent = company.name;
  document.title = `${company.name} (${company.ticker}) | Finvlo demo`;
  document.querySelector("#company-meta").textContent = `${company.ticker} · ${company.market} · ${company.sector}`;
  document.querySelector("#company-business").textContent = stockDescriptions[company.ticker];
  document.querySelector("#company-price").textContent = `${companyFacts.currency} ${Number(companyFacts.price).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  document.querySelector("#company-market-cap").textContent = companyFacts.marketCap;
  document.querySelector("#company-exchange").textContent = companyFacts.exchange;
  document.querySelector("#company-country").textContent = companyFacts.country;
  document.querySelector("#company-employees").textContent = companyFacts.employees;
  const companyDataStatus = document.querySelector("#asset-data-status");
  const companyDataBadge = document.querySelector("#company-data-badge");
  if (cachedCompanyData) {
    companyDataBadge.textContent = `${cachedCompanyData.provider.toUpperCase()} / DAILY DATA`;
    companyDataStatus.textContent = `Cached ${new Date(cachedCompanyData.fetchedAt).toLocaleString()} · refresh checks for a newer daily close`;
  } else {
    const source = readStore("finvlo-data-source", {});
    if (companyFacts.source || source.kind === "manual-csv" && source.type === "stock") companyDataStatus.textContent = `Manual data · ${companyFacts.source || source.source || "CSV import"}${companyFacts.asOf || source.asOf ? ` · as of ${companyFacts.asOf || source.asOf}` : ""}`;
  }
  document.querySelector("#open-checklist").href = `checklist.html?ticker=${encodeURIComponent(company.ticker)}`;
  document.querySelector("#company-score").textContent = score;
  document.querySelector("#company-gauge").style.background = `conic-gradient(var(--blue) ${score}%, #dfe8f4 ${score}% 100%)`;
  document.querySelector("#company-roic").textContent = percent(company.roic);
  document.querySelector("#company-growth").textContent = percent(company.revenue);
  document.querySelector("#company-cash").textContent = percent(company.fcf);
  document.querySelector("#pillar-list").innerHTML = pillars.map((name, index) => `<div class="pillar-row"><span>${name}</span><div class="pillar-bar"><i style="width:${company.pillars[index]}%"></i></div><strong>${company.pillars[index]}</strong></div>`).join("");
  const metrics = [
    ["ROIC", company.roic, ">12% guide", company.roic >= 12], ["ROE · 5y average", company.roe, "12–15% guide", company.roe >= 12], ["Gross margin", company.margin, "Compare in sector", company.margin >= 30], ["Gross margin volatility", company.marginVol, "Lower is steadier", company.marginVol <= 5],
    ["Revenue CAGR · 5y", company.revenue, "Positive growth", company.revenue > 0], ["FCF CAGR · 5y", company.fcfGrowth, "Positive growth", company.fcfGrowth > 0], ["Revenue growth volatility", company.growthVol, "Lower is steadier", company.growthVol <= 10],
    ["Net debt / EBITDA", company.debt, "<2x conservative", company.debt < 2], ["Interest coverage", company.interest, ">5x guide", company.interest > 5], ["Altman Z-score", company.altman, ">3 guide · sector limits", company.altman > 3], ["Piotroski F-score", company.piotroski, "8–9 strong", company.piotroski >= 8],
    ["FCF conversion", company.fcf, "~100% guide", company.fcf >= 90], ["Accruals ratio", company.accruals, "Lower is better", company.accruals < 3], ["CapEx intensity", company.capex, "Sector dependent", company.capex <= 15],
    ["Shareholder yield", company.yield, "Net dilution if <0", company.yield >= 0], ["Return on retained earnings", company.retained, ">10% guide", company.retained >= 10],
    ["Market share trend · 5y", company.share, "Positive is gaining", company.share > 0], ["Top-10 customer concentration", company.concentration, "Lower is less concentrated", company.concentration < 50], ["R&D / revenue", company.rd, "Sector dependent", company.rd > 0],
    ["Beneish M-score", company.beneish, "Above −1.78 flag", company.beneish <= -1.78], ["Insider ownership", company.insider, "Context dependent", company.insider > 0], ["Short interest", company.short, "Context dependent", company.short < 10],
  ];
  const metricBody = document.querySelector("#metric-list");
  const metricKeys = ["roic", "roe", "margin", "marginVol", "revenue", "fcfGrowth", "growthVol", "debt", "interest", "altman", "piotroski", "fcf", "accruals", "capex", "yield", "retained", "share", "concentration", "rd", "beneish", "insider", "short"];
  const metricGuides = ["ROIC", "ROE · 5y average", "Gross margin", "Gross margin volatility", "Revenue CAGR · 5y", "FCF CAGR · 5y", "Revenue growth volatility", "Net debt / EBITDA", "Interest coverage", "Altman Z-score", "Piotroski F-score", "FCF conversion", "Accruals ratio", "CapEx intensity", "Shareholder yield", "Return on retained earnings", "Market share trend · 5y", "Top-10 customer concentration", "R&D / revenue", "Beneish M-score", "Insider ownership", "Short interest"];
  const thresholds = { roic: (value) => value >= 12, roe: (value) => value >= 12, marginVol: (value) => value <= 5, revenue: (value) => value > 0, fcfGrowth: (value) => value > 0, growthVol: (value) => value <= 10, debt: (value) => value < 2, interest: (value) => value > 5, altman: (value) => value > 3, piotroski: (value) => value >= 8, fcf: (value) => value >= 90, accruals: (value) => value < 3, yield: (value) => value >= 0, retained: (value) => value >= 10, share: (value) => value > 0, concentration: (value) => value < 50, beneish: (value) => value <= -1.78 };
  const contextMetrics = new Set(["margin", "capex", "rd", "insider", "short"]);
  const renderCompanyMetrics = () => {
    metricKeys.forEach((key, index) => { metrics[index][1] = company[key]; metrics[index][3] = thresholds[key] ? thresholds[key](company[key]) : null; });
    metricBody.innerHTML = metrics.map(([name, value, guide, passed], index) => {
      const key = metricKeys[index];
      const status = value === 0 ? "N/A" : contextMetrics.has(key) ? "REFERENCE" : passed ? "PASS" : "REVIEW";
      const resultClass = status === "N/A" ? "na" : status === "REVIEW" ? "review" : status === "REFERENCE" ? "reference" : "";
      const unit = ["debt", "interest", "altman", "piotroski", "beneish"].includes(key) ? "" : "%";
      return `<tr><td>${name}</td><td>${Number(value).toFixed(1)}${unit}</td><td>${guide}</td><td><span class="metric-result ${resultClass}">${status}</span></td></tr>`;
    }).join("");
  };
  renderCompanyMetrics();
  const companyEditForm = document.querySelector("#company-edit-form");
  document.querySelector("#company-edit-fields").innerHTML = `${metricKeys.map((key, index) => `<label class="edit-field"><span>${metricGuides[index]}</span><input type="number" step="any" name="${key}" value="${company[key]}" /></label>`).join("")}<label class="edit-field"><span>Sample share price (${companyFacts.currency}) · not live</span><input type="number" step="any" name="assetPrice" value="${companyFacts.price}" /></label>`;
  companyEditForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const edits = Object.fromEntries(new FormData(companyEditForm).entries());
    metricKeys.forEach((key) => { company[key] = Number(edits[key]); });
    companyFacts.price = Number(edits.assetPrice);
    writeStore(companyStorageKey, company);
    writeStore(companyFactsKey, companyFacts);
    document.querySelector("#company-price").textContent = `${companyFacts.currency} ${companyFacts.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    company.price = companyFacts.price;
    renderCompanyChart?.();
    document.querySelector("#company-roic").textContent = percent(company.roic);
    document.querySelector("#company-growth").textContent = percent(company.revenue);
    document.querySelector("#company-cash").textContent = percent(company.fcf);
    document.querySelector("#company-score-note").textContent = "Inputs saved locally. The illustrative score is unchanged because peer ranks and production weights are not configured.";
    renderCompanyMetrics();
  });
  document.querySelector("#reset-company-edits").addEventListener("click", () => { localStorage.removeItem(companyStorageKey); localStorage.removeItem(companyFactsKey); location.reload(); });
  const companyNotesKey = `finvlo-notes:stock:${company.ticker}`;
  const companyNotes = document.querySelector("#company-notes");
  companyNotes.value = readStore(companyNotesKey, "");
  document.querySelector("#company-notes-status").textContent = companyNotes.value ? "Loaded from this browser" : "Not saved yet";
  document.querySelector("#save-company-notes").addEventListener("click", () => {
    writeStore(companyNotesKey, companyNotes.value);
    document.querySelector("#company-notes-status").textContent = "Notes saved in this browser";
  });
  const watch = { ...company, url: `company.html?ticker=${encodeURIComponent(company.ticker)}` };
  setWatchlistButton(document.querySelector("#watchlist-button"), watch);
  const runButton = document.querySelector("#run-analysis");
  runButton.addEventListener("click", () => {
    if (!spendToken()) { runButton.innerHTML = `No tokens <span><a href="pricing.html">See plans</a></span>`; return; }
    document.querySelector("#company-score-note").textContent = `Fictional preview score uses equal pillar weights; production weights are not set. ${getAccountTokens()} demo tokens remain.`;
  });
  const priceToggle = document.querySelector("#price-context-toggle");
  const pricePanel = document.querySelector("#price-context-panel");
  const preference = readStore("finvlo-settings", { priceContext: false });
  const renderPriceContext = (visible) => {
    priceToggle.checked = visible;
    document.querySelector("#price-context-state")?.replaceChildren(document.createTextNode(visible ? "On" : "Off"));
    pricePanel.hidden = !visible;
    if (visible) {
      const values = [["P/E", "28.4x"], ["Forward P/E", "24.1x"], ["EV / EBITDA", "18.6x"], ["P / FCF", "31.2x"], ["PEG", "2.1x"], ["EV / Invested capital", "14.8x"]];
      pricePanel.innerHTML = values.map(([label, value]) => `<div><span>${label} · FICTIONAL</span><strong>${value}</strong></div>`).join("");
    }
  };
  renderPriceContext(Boolean(preference.priceContext));
  priceToggle.addEventListener("change", () => {
    const settings = readStore("finvlo-settings", {});
    settings.priceContext = priceToggle.checked;
    writeStore("finvlo-settings", settings);
    renderPriceContext(priceToggle.checked);
  });
  renderCompanyChart = bindDetailChartPeriods("company", company);
  const applyCompanyProviderData = (payload) => {
    const quote = payload.quote || {};
    const profile = payload.profile || {};
    if (Number(quote.price)) companyFacts.price = Number(quote.price);
    if (profile.currency || quote.currency) companyFacts.currency = profile.currency || quote.currency;
    if (Number(profile.marketCap)) companyFacts.marketCap = compactCurrency(profile.marketCap, companyFacts.currency || "USD");
    if (profile.exchangeShortName) companyFacts.exchange = profile.exchangeShortName;
    if (profile.country) companyFacts.country = profile.country;
    if (profile.fullTimeEmployees) companyFacts.employees = Number(profile.fullTimeEmployees).toLocaleString();
    company.price = companyFacts.price;
    writeStore(companyFactsKey, companyFacts);
    document.querySelector("#company-price").textContent = `${companyFacts.currency} ${companyFacts.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    document.querySelector("#company-market-cap").textContent = companyFacts.marketCap;
    document.querySelector("#company-exchange").textContent = companyFacts.exchange;
    document.querySelector("#company-country").textContent = companyFacts.country;
    document.querySelector("#company-employees").textContent = companyFacts.employees;
    renderCompanyChart();
  };
  const refreshCompanyData = document.querySelector("#refresh-asset-data");
  refreshCompanyData.addEventListener("click", async () => {
    const payload = await refreshMarketData(company.ticker, "stock");
    if (payload) applyCompanyProviderData(payload);
  });
  const companyCacheAge = cachedCompanyData ? Date.now() - new Date(cachedCompanyData.fetchedAt).getTime() : Infinity;
  const existingSource = readStore("finvlo-data-source", {});
  const companyAutoRefresh = location.protocol !== "file:" && companyCacheAge > 60 * 60 * 1000 && !(existingSource.kind === "manual-csv" && existingSource.type === "stock");
  if (companyAutoRefresh) refreshCompanyData.click();
  bindReportExport((options, reportStyle) => {
    const rows = [];
    if (options.summary) rows.push({ section: "Company", label: "Company", value: `${company.name} (${company.ticker})` }, { section: "Company", label: "Market / sector", value: `${company.market} / ${company.sector}` }, { section: "Asset price · fictional", label: "Share price", value: `${companyFacts.currency} ${companyFacts.price}` }, { section: "Asset facts · fictional", label: "Market value", value: companyFacts.marketCap }, { section: "Score note", label: "Quality score", value: `${score} / 100 · fictional equal-pillar preview; not peer ranked` }, { section: "Key figure", label: "ROIC", value: percent(company.roic) }, { section: "Key figure", label: "Revenue CAGR · 5y", value: percent(company.revenue) }, { section: "Key figure", label: "FCF conversion", value: percent(company.fcf) });
    if (options.metrics) {
      if (reportStyle === "professional") {
        const formulas = { roic: "NOPAT / (Debt + Equity - Cash)", roe: "Net income / Average equity", margin: "Gross profit / Revenue", marginVol: "Std dev of annual gross margin", revenue: "(Revenue now / Revenue 5y ago)^(1/5) - 1", fcfGrowth: "(FCF now / FCF 5y ago)^(1/5) - 1", growthVol: "Std dev of annual revenue growth", debt: "(Total debt - Cash) / EBITDA", interest: "EBIT / Interest expense", altman: "Weighted sum of five financial ratios", piotroski: "Count of nine pass/fail tests", fcf: "Free cash flow / Net income", accruals: "(Net income - Operating cash flow) / Average assets", capex: "Capital expenditure / Revenue", yield: "(Dividends + Buybacks - Issuance) / Market cap", retained: "EPS change over 5y / Cumulative retained EPS", share: "Share now - Share 5y ago", concentration: "Top-10 customer revenue / Total revenue", rd: "R&D expense / Revenue", beneish: "Eight-variable Beneish model", insider: "Insider shares / Shares outstanding", short: "Shares sold short / Float" };
        pillars.forEach((pillar, index) => rows.push({ section: "Quality pillar · fictional preview", label: pillar, value: `${company.pillars[index]} / 100 · equal weighting in this demo` }));
        metrics.forEach(([name, value, guide, passed], index) => {
          const key = metricKeys[index];
          rows.push({ section: "Detailed metric", label: name, value: `${value}${["debt", "interest", "altman", "piotroski", "beneish"].includes(key) ? "" : "%"}` }, { section: "Formula", label: name, value: formulas[key] }, { section: "Guide / interpretation", label: name, value: `${guide} · ${contextMetrics.has(key) ? "reference only; no universal pass/fail" : value === 0 ? "not applicable / missing in this sample" : passed ? "passes illustrative threshold" : "does not pass illustrative threshold"}` });
        });
        document.querySelectorAll(".chart-hover-points .chart-point").forEach((point) => rows.push({ section: `Chart data · ${point.dataset.mode} · ${point.dataset.period}`, label: point.dataset.label, value: point.dataset.value }));
      } else {
        [["ROIC", company.roic, ">12% guide"], ["Revenue CAGR · 5y", company.revenue, "positive growth"], ["FCF conversion", company.fcf, "near 100% guide"]].forEach(([label, value, guide]) => rows.push({ section: "Key quality check", label, value: `${value}% · ${guide}` }));
        rows.push({ section: "Checklist", label: "Reminder", value: "Threshold checks are not a peer-ranked Quality Score." });
      }
    }
    if (options.priceContext && preference.priceContext) [["P/E", "28.4x"], ["Forward P/E", "24.1x"], ["EV / EBITDA", "18.6x"], ["P / FCF", "31.2x"], ["PEG", "2.1x"], ["EV / Invested capital", "14.8x"]].forEach(([label, value]) => rows.push({ section: "Optional price context · fictional", label, value }));
    if (options.notes) rows.push({ section: "Research notes", label: "Notes", value: companyNotes.value || "No notes saved." });
    if (options.methodology || reportStyle === "professional") rows.push({ section: "Company profile · fictional", label: "Business", value: stockDescriptions[company.ticker] }, { section: "Company profile · fictional", label: "Listing / country", value: `${companyFacts.exchange} / ${companyFacts.country}` }, { section: "Company profile · fictional", label: "Employees", value: companyFacts.employees }, { section: "Methodology", label: "Ranking method", value: "Production metric scores require validated peer universes and direction-adjusted percentile ranks; production weights are not configured in this demo." }, { section: "Limits", label: "Interpretation", value: "Financial thresholds are context guides, not universal rules. Sector fit and data quality matter. Price does not enter the company Quality Score." });
    return { title: `${company.name} (${company.ticker}) · Finvlo research`, subtitle: reportStyle === "professional" ? "Detailed company quality record · all figures fictional" : "A concise quality snapshot for your own research.", rows, disclaimer: "Fictional demo data. Share prices and fundamentals are illustrative only. Quality analytics for your own research, not investment advice." };
  });
}

const fundName = document.querySelector("#fund-name");
if (fundName) {
  const params = new URLSearchParams(location.search);
  const fundBase = funds.find((item) => item.ticker === params.get("ticker")) || funds[0];
  const fundStorageKey = `finvlo-fund-edits:${fundBase.ticker}`;
  const fundFactsKey = `finvlo-fund-facts:${fundBase.ticker}`;
  const fundEdits = readStore(fundStorageKey, {});
  const cachedFundData = readStore(`finvlo-live-data:${fundBase.ticker}`, null);
  const cachedFundQuote = cachedFundData?.quote || {};
  const facts = { ...fundFacts[fundBase.ticker], ...readStore(fundFactsKey, {}), ...(Number(cachedFundQuote.price) ? { nav: Number(cachedFundQuote.price) } : {}), ...(cachedFundQuote.currency ? { currency: cachedFundQuote.currency } : {}) };
  const structure = fundDescriptions[fundBase.ticker];
  const fund = { ...fundBase, ...fundEdits, ...facts, distributionYield: facts.yield, positions: fundEdits.positions || fundBase.positions.map(([name, weight]) => {
    const stock = stocks.find((entry) => entry.ticker === name || entry.name === name);
    return { name, weight, quality: stock ? companyScore(stock) : 70 };
  }) };
  let renderFundChart;
  const holdingQuality = () => {
    const totalWeight = fund.positions.reduce((total, holding) => total + Number(holding.weight), 0);
    return totalWeight ? Math.round(fund.positions.reduce((total, holding) => total + Number(holding.weight) * Number(holding.quality), 0) / totalWeight) : 0;
  };
  const updateFundScore = () => {
    fund.holdings = holdingQuality();
    fund.score = Math.round(feeRanks.get(fund.ticker) * 0.3 + returnRanks.get(fund.ticker) * 0.3 + fund.holdings * 0.4);
    document.querySelector("#fund-score").textContent = fund.score;
    document.querySelector("#fund-gauge").style.background = `conic-gradient(var(--blue) ${fund.score}%, #dfe8f4 ${fund.score}% 100%)`;
    document.querySelector("#fund-holdings").textContent = `${fund.holdings} / 100`;
  };
  const renderFundHoldings = () => {
    document.querySelector("#fund-holding-list").innerHTML = fund.positions.map((holding) => `<div class="holding-row"><strong>${escapeHTML(holding.name)}</strong><span>${Number(holding.weight).toFixed(1)}% position · quality ${Number(holding.quality)}</span><i><b style="width:${Math.min(Number(holding.weight) * 5, 100)}%"></b></i></div>`).join("");
  };
  fundName.textContent = fund.name;
  document.title = `${fund.name} (${fund.ticker}) | Finvlo demo`;
  document.querySelector("#fund-meta").textContent = `${fund.ticker} · ${fund.region} · ${fund.category}`;
  const fundDataStatus = document.querySelector("#asset-data-status");
  const fundDataBadge = document.querySelector("#fund-data-badge");
  if (cachedFundData) {
    fundDataBadge.textContent = `${cachedFundData.provider.toUpperCase()} / DAILY DATA`;
    fundDataStatus.textContent = `Cached ${new Date(cachedFundData.fetchedAt).toLocaleString()} · refresh checks for a newer daily close`;
  } else {
    const source = readStore("finvlo-data-source", {});
    if (source.kind === "manual-csv" && source.type === "fund") fundDataStatus.textContent = `Manual CSV values on this browser · imported ${new Date(source.importedAt).toLocaleString()}`;
  }
  document.querySelector("#fund-description").textContent = structure.description;
  document.querySelector("#fund-nav").textContent = `${fund.currency} ${fund.nav.toFixed(2)}`;
  document.querySelector("#fund-aum").textContent = fund.assets;
  document.querySelector("#fund-holding-count").textContent = fund.count;
  document.querySelector("#fund-yield").textContent = percent(fund.yield);
  document.querySelector("#fund-benchmark").textContent = structure.benchmark;
  document.querySelector("#fund-replication").textContent = structure.replication;
  document.querySelector("#fund-domicile").textContent = structure.domicile;
  document.querySelector("#fund-inception").textContent = structure.inception;
  document.querySelector("#fund-score").textContent = fund.score;
  document.querySelector("#fund-gauge").style.background = `conic-gradient(var(--blue) ${fund.score}%, #dfe8f4 ${fund.score}% 100%)`;
  document.querySelector("#fund-fee").textContent = `${fund.fee.toFixed(2)}%`;
  document.querySelector("#fund-return").textContent = percent(fund.return);
  document.querySelector("#fund-holdings").textContent = `${fund.holdings} / 100`;
  renderFundHoldings();
  const fundEditForm = document.querySelector("#fund-edit-form");
  const renderFundEditor = () => {
    document.querySelector("#fund-edit-fields").innerHTML = `<label class="edit-field"><span>Sample NAV price (${fund.currency}) · not live</span><input type="number" min="0" step="0.01" name="nav" value="${fund.nav}" required /></label>${fund.positions.map((holding, index) => `<div class="fund-edit-row"><strong>${escapeHTML(holding.name)}</strong><label>Weight (%)<input type="number" min="0" step="0.1" name="weight-${index}" value="${Number(holding.weight)}" required /></label><label>Quality (0–100)<input type="number" min="0" max="100" step="1" name="quality-${index}" value="${Number(holding.quality)}" required /></label></div>`).join("")}`;
  };
  renderFundEditor();
  updateFundScore();
  fundEditForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(fundEditForm);
    fund.nav = Number(data.get("nav"));
    fund.positions = fund.positions.map((holding, index) => ({ name: holding.name, weight: Number(data.get(`weight-${index}`)), quality: Number(data.get(`quality-${index}`)) }));
    writeStore(fundStorageKey, { positions: fund.positions });
    writeStore(fundFactsKey, { nav: fund.nav });
    document.querySelector("#fund-nav").textContent = `${fund.currency} ${fund.nav.toFixed(2)}`;
    renderFundChart?.();
    updateFundScore();
    renderFundHoldings();
    document.querySelector("#fund-edit-status").textContent = "Holdings saved in this browser. Sample fund score updated.";
  });
  document.querySelector("#reset-fund-edits").addEventListener("click", () => { localStorage.removeItem(fundStorageKey); localStorage.removeItem(fundFactsKey); location.reload(); });
  const fundNotesKey = `finvlo-notes:fund:${fund.ticker}`;
  const fundNotes = document.querySelector("#fund-notes");
  fundNotes.value = readStore(fundNotesKey, "");
  document.querySelector("#fund-notes-status").textContent = fundNotes.value ? "Loaded from this browser" : "Not saved yet";
  document.querySelector("#save-fund-notes").addEventListener("click", () => {
    writeStore(fundNotesKey, fundNotes.value);
    document.querySelector("#fund-notes-status").textContent = "Notes saved in this browser";
  });
  setWatchlistButton(document.querySelector("#fund-watchlist-button"), { ...fund, url: `fund.html?ticker=${encodeURIComponent(fund.ticker)}` });
  document.querySelector("#run-fund-analysis").addEventListener("click", (event) => {
    const button = event.currentTarget;
    button.innerHTML = spendToken() ? `Score refreshed <span>${getAccountTokens()} left</span>` : `No tokens <span><a href="pricing.html">See plans</a></span>`;
  });
  renderFundChart = bindDetailChartPeriods("fund", fund);
  const refreshFundData = document.querySelector("#refresh-asset-data");
  refreshFundData.addEventListener("click", async () => {
    const payload = await refreshMarketData(fund.ticker, "fund");
    if (!payload) return;
    if (Number(payload.quote?.price)) fund.nav = Number(payload.quote.price);
    if (payload.quote?.currency) fund.currency = payload.quote.currency;
    writeStore(fundFactsKey, { nav: fund.nav, currency: fund.currency });
    document.querySelector("#fund-nav").textContent = `${fund.currency} ${Number(fund.nav).toFixed(2)}`;
    renderFundChart();
  });
  const fundCacheAge = cachedFundData ? Date.now() - new Date(cachedFundData.fetchedAt).getTime() : Infinity;
  const currentDataSource = readStore("finvlo-data-source", {});
  if (!cachedFundData && (facts.source || currentDataSource.kind === "manual-csv" && currentDataSource.type === "fund")) fundDataStatus.textContent = `Manual data · ${facts.source || currentDataSource.source || "CSV import"}${facts.asOf || currentDataSource.asOf ? ` · as of ${facts.asOf || currentDataSource.asOf}` : ""}`;
  if (location.protocol !== "file:" && fundCacheAge > 60 * 60 * 1000 && !(currentDataSource.kind === "manual-csv" && currentDataSource.type === "fund")) refreshFundData.click();
  bindReportExport((options, reportStyle) => {
    const rows = [];
    if (options.summary || reportStyle === "clear") rows.push({ section: "Fund", label: "Fund", value: `${fund.name} (${fund.ticker}) · ${fund.category} · ${fund.region}` }, { section: "Asset price · fictional", label: "NAV per share", value: `${fund.currency} ${Number(fund.nav).toFixed(2)}` }, { section: "Fund assets · fictional", label: "Assets under management", value: fund.assets }, { section: "Fund score", label: "Score", value: `${fund.score} / 100 · fictional sample` }, { section: "Key figures", label: "Annual fee / past 1Y return", value: `${fund.fee}% / ${fund.return}% · past return is not a forecast` }, { section: "Key figure", label: "Weighted holdings quality", value: `${fund.holdings} / 100` });
    if (options.metrics) {
      if (reportStyle === "professional") fund.positions.forEach((holding) => rows.push({ section: "Holding detail", label: holding.name, value: `${Number(holding.weight).toFixed(2)}% portfolio weight · ${holding.quality}/100 sample quality` }));
      else fund.positions.slice(0, 3).forEach((holding) => rows.push({ section: "Top holding", label: holding.name, value: `${Number(holding.weight).toFixed(2)}% position` }));
      if (reportStyle === "professional") document.querySelectorAll(".chart-hover-points .chart-point").forEach((point) => rows.push({ section: `Chart data · ${point.dataset.mode} · ${point.dataset.period}`, label: point.dataset.label, value: point.dataset.value }));
    }
    if (options.notes) rows.push({ section: "Research notes", label: "Notes", value: fundNotes.value || "No notes saved." });
    if (options.methodology || reportStyle === "professional") rows.push({ section: "Fund profile · fictional", label: "Benchmark", value: structure.benchmark }, { section: "Fund profile · fictional", label: "Replication", value: structure.replication }, { section: "Fund profile · fictional", label: "Domicile / inception", value: `${structure.domicile} / ${structure.inception}` }, { section: "Fund score method", label: "Fee", value: `30% · sample rank ${feeRanks.get(fund.ticker)} / 100; lower fee ranks higher` }, { section: "Fund score method", label: "One-year return", value: `30% · sample rank ${returnRanks.get(fund.ticker)} / 100; historical return is not a forecast` }, { section: "Fund score method", label: "Holdings quality", value: `40% · weighted average by position size = ${fund.holdings} / 100` }, { section: "Fund score method", label: "Distribution yield", value: `${percent(fund.yield)} · fictional estimate` }, { section: "Limitations", label: "Data", value: "Figures and ranks are fictional, drawn from this small demo universe, and not investment research." });
    return { title: `${fund.name} (${fund.ticker}) · Finvlo research`, subtitle: reportStyle === "professional" ? "Detailed fund composition report · all figures fictional" : "A short fund quality snapshot for your own research.", rows, disclaimer: "Fictional fund data. Past return is not a forecast. Quality analytics for your own research, not investment advice." };
  });
}

document.querySelectorAll("[data-plan]").forEach((button) => button.addEventListener("click", () => {
  const account = getAccount();
  account.plan = button.dataset.plan;
  account.tokens = Number(button.dataset.tokens);
  account.activity = [{ description: `${account.plan} demo plan selected`, date: new Date().toISOString() }, ...account.activity].slice(0, 8);
  saveAccount(account);
  button.textContent = `${account.plan} selected · ${account.tokens} demo tokens`;
}));
document.querySelectorAll("[data-token-pack]").forEach((button) => button.addEventListener("click", () => {
  const account = getAccount();
  account.tokens += Number(button.dataset.tokenPack);
  account.activity = [{ description: `${button.dataset.tokenPack} demo tokens added`, date: new Date().toISOString() }, ...account.activity].slice(0, 8);
  saveAccount(account);
  button.textContent = `Added · ${account.tokens} demo tokens`;
}));

const profileForm = document.querySelector("#profile-form");
if (profileForm) {
  const profileStatus = document.querySelector("#profile-status");
  const profile = getProfile();
  for (const [key, value] of Object.entries(profile)) {
    const field = profileForm.elements.namedItem(key);
    if (field) field.value = value;
  }
  const displayName = profile.displayName?.trim();
  document.querySelector("#profile-heading-name").textContent = displayName ? `Hello, ${displayName}.` : "Your profile";
  document.querySelector("#profile-avatar").textContent = displayName ? displayName[0].toUpperCase() : "F";
  if (Object.keys(profile).length) profileStatus.textContent = "Profile loaded from this browser";
  profileForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const updated = Object.fromEntries(new FormData(profileForm));
    writeStore("finvlo-profile", updated);
    document.querySelector("#profile-heading-name").textContent = updated.displayName?.trim() ? `Hello, ${updated.displayName.trim()}.` : "Your profile";
    document.querySelector("#profile-avatar").textContent = updated.displayName?.trim() ? updated.displayName.trim()[0].toUpperCase() : "F";
    profileStatus.textContent = "Profile saved on this device";
  });
  const account = getAccount();
  document.querySelector("#profile-plan-name").textContent = account.plan;
  document.querySelector("#profile-token-balance").textContent = account.tokens;
  document.querySelector("#side-token-balance").textContent = account.tokens;
  const planAllowance = { Free: 10, Plus: 150, Pro: 500 }[account.plan] || 10;
  document.querySelector("#usage-remaining").textContent = account.tokens;
  document.querySelector("#usage-allowance").textContent = planAllowance;
  document.querySelector("#usage-saved").textContent = getWatchlist().length;
  document.querySelector("#usage-progress").style.width = `${Math.max(0, Math.min(100, ((planAllowance - account.tokens) / planAllowance) * 100))}%`;
  if (account.activity?.length) document.querySelector("#profile-activity").innerHTML = account.activity.map((item) => `<div class="activity-item"><span class="activity-dot"></span><span>${escapeHTML(item.description)}</span><time>${new Date(item.date).toLocaleDateString()}</time></div>`).join("");
  const watchlist = getWatchlist();
  document.querySelector("#watchlist-count").textContent = `${watchlist.length} saved`;
  if (watchlist.length) document.querySelector("#profile-watchlist").innerHTML = watchlist.map((entry) => `<div class="watchlist-item"><span>${entry.name} <small>${entry.ticker}</small></span><a href="${entry.url}">Open →</a></div>`).join("");
  const settingsForm = document.querySelector("#research-settings");
  const priceContextToggle = settingsForm.elements.namedItem("priceContext");
  const settings = readStore("finvlo-settings", { priceContext: false });
  priceContextToggle.checked = Boolean(settings.priceContext);
  document.querySelector("#settings-status").textContent = settings.priceContext ? "Price context is on. It remains separate from quality." : "Price context is off.";
  const exportDefaults = getExportDefaults();
  ["summary", "metrics", "notes", "methodology"].forEach((name) => { settingsForm.elements.namedItem(`export${name[0].toUpperCase()}${name.slice(1)}`).checked = Boolean(exportDefaults[name]); });
  settingsForm.elements.namedItem("reportStyle").value = readStore("finvlo-export-style", "clear");
  settingsForm.querySelectorAll("[name='reportStyle']").forEach((input) => input.addEventListener("change", () => {
    writeStore("finvlo-export-style", input.value);
    document.querySelector("#settings-status").textContent = `${input.value === "clear" ? "Clear" : "Professional"} is your default report style.`;
  }));
  priceContextToggle.addEventListener("change", () => {
    const updatedSettings = { ...readStore("finvlo-settings", {}), priceContext: priceContextToggle.checked };
    writeStore("finvlo-settings", updatedSettings);
    document.querySelector("#settings-status").textContent = priceContextToggle.checked ? "Price context is on. It remains separate from quality." : "Price context is off.";
  });
  settingsForm.querySelectorAll("[name^='export']").forEach((input) => input.addEventListener("change", () => {
    const updatedDefaults = Object.fromEntries(["summary", "metrics", "notes", "methodology"].map((name) => [name, settingsForm.elements.namedItem(`export${name[0].toUpperCase()}${name.slice(1)}`).checked]));
    writeStore("finvlo-export-defaults", updatedDefaults);
    document.querySelector("#settings-status").textContent = "Research and export preferences saved in this browser.";
  }));
  document.querySelector("#download-profile-data").addEventListener("click", () => {
    const data = Object.fromEntries(Object.keys(localStorage).filter((key) => key.startsWith("finvlo-")).map((key) => [key, readStore(key, null)]));
    downloadFile("finvlo-profile-data.json", JSON.stringify(data, null, 2), "application/json;charset=utf-8");
    document.querySelector("#profile-data-status").textContent = "Profile data downloaded as JSON.";
  });
  document.querySelector("#clear-profile-data").addEventListener("click", () => {
    if (!confirm("Clear Finvlo demo profile, edits, notes, watchlist, and tokens from this browser?")) return;
    Object.keys(localStorage).filter((key) => key.startsWith("finvlo-")).forEach((key) => localStorage.removeItem(key));
    location.reload();
  });
}

const metricSearch = document.querySelector("#metric-search");
if (metricSearch) metricSearch.addEventListener("input", () => {
  const query = metricSearch.value.trim().toLowerCase();
  document.querySelectorAll(".metric-card").forEach((card) => { card.hidden = !card.textContent.toLowerCase().includes(query); });
  document.querySelectorAll(".pillar-section").forEach((section) => { section.hidden = !section.querySelector(".metric-card:not([hidden])"); });
});

const qualityCheckForm = document.querySelector("#quality-check-form");
if (qualityCheckForm) {
  document.documentElement.style.scrollBehavior = "auto";
  const checklistMetrics = [
    { pillar: "Profitability", key: "roic", label: "ROIC", unit: "%", guide: "Guide: above 12%", op: ">=", threshold: 12 },
    { pillar: "Profitability", key: "roe", label: "ROE · five-year average", unit: "%", guide: "Guide: 12–15%+", op: ">=", threshold: 12 },
    { pillar: "Profitability", key: "margin", label: "Gross margin", unit: "%", guide: "Compare within sector", context: true },
    { pillar: "Profitability", key: "marginVol", label: "Gross margin standard deviation · five-year", unit: "pp", guide: "Lower is more stable", op: "<=", threshold: 5 },
    { pillar: "Growth", key: "revenue", label: "Revenue CAGR · five-year", unit: "%", guide: "Positive growth", op: ">", threshold: 0 },
    { pillar: "Growth", key: "fcfGrowth", label: "FCF CAGR · five-year", unit: "%", guide: "Positive growth", op: ">", threshold: 0 },
    { pillar: "Growth", key: "growthVol", label: "Revenue growth volatility", unit: "pp", guide: "Lower is steadier", op: "<=", threshold: 10 },
    { pillar: "Balance sheet", key: "debt", label: "Net debt / EBITDA", unit: "x", guide: "Below 2x is often conservative", op: "<=", threshold: 2 },
    { pillar: "Balance sheet", key: "interest", label: "Interest coverage", unit: "x", guide: "Above 5x is often comfortable", op: ">=", threshold: 5 },
    { pillar: "Balance sheet", key: "altman", label: "Altman Z-score", unit: "", guide: "Above 3; designed for manufacturers", op: ">", threshold: 3 },
    { pillar: "Balance sheet", key: "piotroski", label: "Piotroski F-score", unit: "/ 9", guide: "8–9 is strong", op: ">=", threshold: 8 },
    { pillar: "Cash flow quality", key: "fcf", label: "FCF conversion", unit: "%", guide: "Near or above 100%", op: ">=", threshold: 90 },
    { pillar: "Cash flow quality", key: "accruals", label: "Accruals ratio", unit: "% assets", guide: "Lower is generally better", op: "<=", threshold: 3 },
    { pillar: "Cash flow quality", key: "capex", label: "CapEx intensity", unit: "% revenue", guide: "Sector dependent", context: true },
    { pillar: "Capital allocation", key: "yield", label: "Shareholder yield", unit: "%", guide: "Negative can indicate dilution", op: ">=", threshold: 0 },
    { pillar: "Capital allocation", key: "retained", label: "Return on retained earnings", unit: "%", guide: "Above 10% can indicate productive reinvestment", op: ">=", threshold: 10 },
    { pillar: "Moat", key: "share", label: "Market share trend · five-year", unit: "pp", guide: "Positive means share gained", op: ">", threshold: 0 },
    { pillar: "Moat", key: "concentration", label: "Top-10 customer concentration", unit: "% revenue", guide: "Lower means less concentration", op: "<", threshold: 50 },
    { pillar: "Moat", key: "rd", label: "R&D / revenue", unit: "%", guide: "Sector dependent", context: true },
    { pillar: "Earnings integrity", key: "beneish", label: "Beneish M-score", unit: "", guide: "Above −1.78 flags possible manipulation", op: "<=", threshold: -1.78 },
    { pillar: "Earnings integrity", key: "insider", label: "Insider ownership", unit: "%", guide: "Context dependent", context: true },
    { pillar: "Earnings integrity", key: "short", label: "Short interest", unit: "% float", guide: "Context dependent", context: true },
  ];
  const pillarNames = [...new Set(checklistMetrics.map((metric) => metric.pillar))];
  const fields = document.querySelector("#checklist-fields");
  const sampleSelect = document.querySelector("#sample-company");
  const inputFor = (metric) => `<label class="metric-input"><span>${metric.label}<small>${metric.guide}</small></span><input type="number" step="any" data-check-value="${metric.key}" placeholder="Enter value" /><span class="na-field"><input type="checkbox" data-check-na="${metric.key}" /> N/A</span></label>`;
  fields.innerHTML = pillarNames.map((pillar, index) => `<section class="checklist-pillar"><div class="checklist-pillar-heading"><span>${String(index + 1).padStart(2, "0")}</span><h2>${pillar}</h2><p>${checklistMetrics.filter((metric) => metric.pillar === pillar).length} metrics</p></div><div class="checklist-metric-grid">${checklistMetrics.filter((metric) => metric.pillar === pillar).map(inputFor).join("")}</div></section>`).join("");
  stocks.forEach((stock) => {
    const option = document.createElement("option");
    option.value = stock.ticker;
    option.textContent = `${stock.name} (${stock.ticker}) · fictional`;
    sampleSelect.append(option);
  });
  sampleSelect.addEventListener("change", () => {
    const stockBase = stocks.find((entry) => entry.ticker === sampleSelect.value);
    const stock = stockBase ? { ...stockBase, ...readStore(`finvlo-stock-edits:${stockBase.ticker}`, {}) } : null;
    document.querySelector("#checklist-company").value = stock ? `${stock.name} (${stock.ticker})` : "";
    checklistMetrics.forEach((metric) => {
      const input = fields.querySelector(`[data-check-value="${metric.key}"]`);
      const na = fields.querySelector(`[data-check-na="${metric.key}"]`);
      input.value = stock ? stock[metric.key] ?? "" : "";
      na.checked = stock && stock[metric.key] === 0;
      input.disabled = na.checked;
    });
  });
  const requestedTicker = new URLSearchParams(location.search).get("ticker");
  if (stocks.some((stock) => stock.ticker === requestedTicker)) {
    sampleSelect.value = requestedTicker;
    sampleSelect.dispatchEvent(new Event("change"));
  }
  fields.addEventListener("change", (event) => {
    const checkbox = event.target.closest("[data-check-na]");
    if (checkbox) fields.querySelector(`[data-check-value="${checkbox.dataset.checkNa}"]`).disabled = checkbox.checked;
  });
  document.querySelector("#checklist-token-count").textContent = getAccountTokens();
  qualityCheckForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const inputs = checklistMetrics.map((metric) => {
      const value = fields.querySelector(`[data-check-value="${metric.key}"]`);
      const notApplicable = fields.querySelector(`[data-check-na="${metric.key}"]`).checked;
      return { metric, value: value.value === "" ? null : Number(value.value), notApplicable };
    });
    const supplied = inputs.filter((entry) => entry.value !== null || entry.notApplicable);
    if (!supplied.length) {
      document.querySelector("#result-title").textContent = "Add a few figures first";
      document.querySelector("#result-description").textContent = "Enter company values or mark metrics not applicable before running the checklist.";
      return;
    }
    const scored = supplied.filter((entry) => !entry.notApplicable && !entry.metric.context && entry.value !== null);
    const contextCount = supplied.filter((entry) => !entry.notApplicable && entry.metric.context && entry.value !== null).length;
    if (!scored.length) {
      document.querySelector("#result-title").textContent = "No threshold checks to assess";
      document.querySelector("#result-description").textContent = "Add threshold-based values or mark additional metrics not applicable. Context-only values are not pass/fail checks.";
      return;
    }
    if (!spendToken()) {
      document.querySelector("#result-title").textContent = "No demo tokens left";
      document.querySelector("#result-description").textContent = "Visit Plans & tokens to add demo usage. No payment is connected.";
      return;
    }
    const passed = scored.filter(({ metric, value }) => metric.op === ">=" ? value >= metric.threshold : metric.op === ">" ? value > metric.threshold : metric.op === "<=" ? value <= metric.threshold : value < metric.threshold);
    const label = document.querySelector("#checklist-company").value.trim() || "This company";
    document.querySelector("#pass-count").textContent = `${passed.length}/${scored.length}`;
    document.querySelector("#result-title").textContent = `${label}: ${passed.length} checks passed`;
    document.querySelector("#result-description").textContent = `${scored.length} threshold checks assessed; ${contextCount} context-only metrics need human review. ${getAccountTokens()} demo tokens remain. This is not the peer-ranked Quality Score.`;
    document.querySelector("#checklist-token-count").textContent = getAccountTokens();
  });
}