// GET /api/rates → שערי מטבע חיים (שוק, מתעדכנים כל דקה), השער היציג של בנק ישראל, ומטבעות דיגיטליים
const FIAT = [
  ["USD", "דולר אמריקאי", "🇺🇸", "ILS=X", 1], ["EUR", "אירו", "🇪🇺", "EURILS=X", 1], ["GBP", "לירה שטרלינג", "🇬🇧", "GBPILS=X", 1],
  ["CHF", "פרנק שוויצרי", "🇨🇭", "CHFILS=X", 1], ["JPY", "ין יפני", "🇯🇵", "JPYILS=X", 100], ["CAD", "דולר קנדי", "🇨🇦", "CADILS=X", 1],
  ["AUD", "דולר אוסטרלי", "🇦🇺", "AUDILS=X", 1], ["CNY", "יואן סיני", "🇨🇳", "CNYILS=X", 1], ["RUB", "רובל רוסי", "🇷🇺", "RUBILS=X", 1],
  ["TRY", "לירה טורקית", "🇹🇷", "TRYILS=X", 1], ["DKK", "כתר דני", "🇩🇰", "DKKILS=X", 1], ["NOK", "כתר נורבגי", "🇳🇴", "NOKILS=X", 1],
  ["SEK", "כתר שוודי", "🇸🇪", "SEKILS=X", 1], ["ZAR", "ראנד דרום אפריקאי", "🇿🇦", "ZARILS=X", 1], ["JOD", "דינר ירדני", "🇯🇴", "JODILS=X", 1],
  ["EGP", "לירה מצרית", "🇪🇬", "EGPILS=X", 1],
];
const COMMODITIES = [["GOLD", "זהב (אונקיה)", "🥇", "GC=F"], ["SILVER", "כסף (אונקיה)", "🥈", "SI=F"], ["OIL", "נפט ברנט (חבית)", "🛢️", "BZ=F"]];
const CRYPTO = [
  ["bitcoin", "ביטקוין", "BTC"], ["ethereum", "את'ריום", "ETH"], ["tether", "טת'ר", "USDT"], ["binancecoin", "BNB", "BNB"],
  ["solana", "סולנה", "SOL"], ["ripple", "XRP", "XRP"], ["usd-coin", "USDC", "USDC"], ["dogecoin", "דוג'קוין", "DOGE"],
  ["cardano", "קרדנו", "ADA"], ["tron", "טרון", "TRX"], ["litecoin", "לייטקוין", "LTC"], ["avalanche-2", "אבלאנץ'", "AVAX"],
];
const UA = { "User-Agent": "Mozilla/5.0 (compatible; NayesStatus/1.0)" };

async function yahoo(sym) {
  const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=5d`, { headers: UA });
  if (!r.ok) return null;
  const m = (await r.json()).chart?.result?.[0]?.meta;
  if (!m || !m.regularMarketPrice) return null;
  const prev = m.chartPreviousClose || m.previousClose;
  return {
    price: m.regularMarketPrice,
    change: prev ? ((m.regularMarketPrice - prev) / prev) * 100 : 0,
    time: m.regularMarketTime ? new Date(m.regularMarketTime * 1000).toISOString() : null,
  };
}

export default async function handler(req, res) {
  const [live, comm, boi, cg] = await Promise.all([
    Promise.all(FIAT.map((f) => yahoo(f[3]).catch(() => null))),
    Promise.all(COMMODITIES.map((c) => yahoo(c[3]).catch(() => null))),
    fetch("https://boi.org.il/PublicApi/GetExchangeRates?asJson=true").then((r) => r.json()).catch(() => ({})),
    fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${CRYPTO.map((c) => c[0]).join(",")}&vs_currencies=ils,usd&include_24hr_change=true&include_last_updated_at=true`, { headers: UA })
      .then((r) => r.json()).catch(() => ({})),
  ]);
  const official = Object.fromEntries((boi.exchangeRates || []).map((x) => [x.key, x]));
  const usdIls = (live[0] && live[0].price) || (official.USD && official.USD.currentExchangeRate) || 0;

  const rates = FIAT.map(([code, name, flag, , unit], i) => {
    const l = live[i], o = official[code];
    if (!l && !o) return null;
    const off = o ? o.currentExchangeRate * (unit / (o.unit || 1)) : null;
    return {
      code, name, flag, unit,
      rate: l ? l.price * unit : off, change: l ? l.change : o.currentChange, updated: (l && l.time) || (o && o.lastUpdate),
      official: off, officialUpdated: o ? o.lastUpdate : null,
    };
  }).filter(Boolean);

  const commodities = COMMODITIES.map(([code, name, flag], i) => comm[i] && {
    code, name, flag, usd: comm[i].price, rate: comm[i].price * usdIls, change: comm[i].change, updated: comm[i].time,
  }).filter(Boolean);

  const crypto = CRYPTO.map(([id, name, code]) => cg[id] && {
    code, name, rate: cg[id].ils, usd: cg[id].usd, change: cg[id].ils_24h_change || 0,
    updated: cg[id].last_updated_at ? new Date(cg[id].last_updated_at * 1000).toISOString() : null,
  }).filter(Boolean);

  res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=120");
  res.status(rates.length ? 200 : 502).json({ rates, commodities, crypto, fetched: new Date().toISOString() });
}
