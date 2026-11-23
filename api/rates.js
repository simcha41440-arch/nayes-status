// GET /api/rates → השערים היציגים של בנק ישראל (מתעדכנים בכל יום עסקים)
const NAMES = {
  USD: ["דולר אמריקאי", "🇺🇸"], EUR: ["אירו", "🇪🇺"], GBP: ["לירה שטרלינג", "🇬🇧"], CHF: ["פרנק שוויצרי", "🇨🇭"],
  JPY: ["ין יפני", "🇯🇵"], CAD: ["דולר קנדי", "🇨🇦"], AUD: ["דולר אוסטרלי", "🇦🇺"], DKK: ["כתר דני", "🇩🇰"],
  NOK: ["כתר נורבגי", "🇳🇴"], SEK: ["כתר שוודי", "🇸🇪"], ZAR: ["ראנד דרום אפריקאי", "🇿🇦"], JOD: ["דינר ירדני", "🇯🇴"],
  EGP: ["לירה מצרית", "🇪🇬"], LBP: ["לירה לבנונית", "🇱🇧"],
};
const ORDER = ["USD", "EUR", "GBP", "CHF", "JPY", "CAD", "AUD"];

export default async function handler(req, res) {
  try {
    const r = await fetch("https://boi.org.il/PublicApi/GetExchangeRates?asJson=true", { headers: { Accept: "application/json" } });
    if (!r.ok) throw new Error(`BOI ${r.status}`);
    const { exchangeRates = [] } = await r.json();
    const rates = exchangeRates
      .filter((x) => NAMES[x.key])
      .map((x) => ({ code: x.key, name: NAMES[x.key][0], flag: NAMES[x.key][1], rate: x.currentExchangeRate, change: x.currentChange, unit: x.unit, updated: x.lastUpdate }))
      .sort((a, b) => (ORDER.indexOf(a.code) + 1 || 99) - (ORDER.indexOf(b.code) + 1 || 99));
    res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=600");
    res.status(200).json({ rates, source: "בנק ישראל" });
  } catch (err) {
    res.status(502).json({ error: "לא הצלחנו לקבל את השערים כרגע", rates: [] });
  }
}
