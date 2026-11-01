const API_ROOT = "https://financialmodelingprep.com/stable";

const getFirst = (payload) => Array.isArray(payload) ? payload[0] ?? null : payload;

async function getProviderData(path, symbol, apiKey, range) {
  const url = new URL(`${API_ROOT}/${path}`);
  url.searchParams.set("symbol", symbol);
  if (range?.from) url.searchParams.set("from", range.from);
  if (range?.to) url.searchParams.set("to", range.to);
  const response = await fetch(url, { headers: { apikey: apiKey } });
  if (!response.ok) throw new Error(`Market data provider returned ${response.status}`);
  return response.json();
}

module.exports = async function marketData(req, res) {
  res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=86400");
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const symbol = String(req.query.symbol || "").trim().toUpperCase();
  const kind = req.query.kind === "fund" ? "fund" : "stock";
  if (!/^[A-Z0-9.^-]{1,16}$/.test(symbol)) {
    return res.status(400).json({ error: "Provide a valid ticker symbol." });
  }

  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey) {
    return res.status(503).json({ error: "Daily market data is not connected. Add FMP_API_KEY to the server environment." });
  }

  const today = new Date();
  const from = new Date(today);
  from.setUTCDate(from.getUTCDate() - 1825);
  const range = { from: from.toISOString().slice(0, 10), to: today.toISOString().slice(0, 10) };

  try {
    const [quoteResult, historyResult, profileResult] = await Promise.allSettled([
      getProviderData("quote", symbol, apiKey),
      getProviderData("historical-price-eod/full", symbol, apiKey, range),
      kind === "stock" ? getProviderData("profile", symbol, apiKey) : Promise.resolve(null),
    ]);
    if (quoteResult.status === "rejected") throw quoteResult.reason;
    const quotePayload = quoteResult.value;
    const historyPayload = historyResult.status === "fulfilled" ? historyResult.value : [];
    const profilePayload = profileResult.status === "fulfilled" ? profileResult.value : null;
    const quote = getFirst(quotePayload);
    if (!quote) return res.status(404).json({ error: "No quote returned for this ticker." });

    const history = (Array.isArray(historyPayload) ? historyPayload : historyPayload?.historical || [])
      .filter((point) => point?.date && Number.isFinite(Number(point.close)))
      .map((point) => ({ date: point.date, close: Number(point.close), volume: Number(point.volume) || 0 }))
      .sort((a, b) => a.date.localeCompare(b.date));

    return res.status(200).json({
      symbol,
      kind,
      provider: "Financial Modeling Prep",
      interval: "daily",
      fetchedAt: new Date().toISOString(),
      quote,
      profile: getFirst(profilePayload),
      history,
      coverage: { quote: true, dailyHistory: history.length > 0, assetProfile: Boolean(getFirst(profilePayload)) },
    });
  } catch (error) {
    console.error("Market data fetch failed", { symbol, message: error.message });
    return res.status(502).json({ error: "The market data provider could not return this asset. Check API access and ticker coverage." });
  }
};
