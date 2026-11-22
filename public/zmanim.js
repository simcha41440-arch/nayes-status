// זמני היום, שבתות וימים טובים. אותו קובץ משמש גם את האתר (סקריפט רגיל) וגם את הצינור האוטומטי (ייבוא ב-Node).
// החישוב אסטרונומי לפי מיקום העיר (בגובה פני הים). הזמנים לצורך מידע בלבד.

(function (root) {
  "use strict";

  const TZ = "Asia/Jerusalem";
  const RAD = Math.PI / 180;

  // קואורדינטות הערים (קו רוחב, קו אורך)
  const CITY_COORDS = {
    "ירושלים": [31.778, 35.235], "בני ברק": [32.084, 34.834], "בית שמש": [31.747, 34.988],
    "מודיעין עילית": [31.932, 35.042], "ביתר עילית": [31.697, 35.115], "אלעד": [32.052, 34.951],
    "אשדוד": [31.804, 34.655], "חריש": [32.461, 35.043], "רכסים": [32.749, 35.099],
    "צפת": [32.966, 35.496], "טבריה": [32.795, 35.531], "נתיבות": [31.421, 34.588],
    "ערד": [31.259, 35.213], "פתח תקווה": [32.087, 34.887], "חיפה": [32.794, 34.99],
  };
  // הדלקת נרות: דקות לפני השקיעה לפי המנהג הנפוץ בעיר
  const CANDLES = { "ירושלים": 40, "חיפה": 30, "רכסים": 30 };

  // ---------- חישוב השמש (אלגוריתם NOAA) ----------
  // מחזיר את רגע ה-UTC שבו מרכז השמש נמצא `depression` מעלות מתחת לאופק, בבוקר או בערב.
  function sunTime(y, m, d, lat, lon, depression, morning) {
    const zenith = 90 + depression;
    const N1 = Math.floor((275 * m) / 9), N2 = Math.floor((m + 9) / 12), N3 = 1 + Math.floor((y - 4 * Math.floor(y / 4) + 2) / 3);
    const N = N1 - N2 * N3 + d - 30;
    const lngHour = lon / 15;
    const t = N + ((morning ? 6 : 18) - lngHour) / 24;
    const M = 0.9856 * t - 3.289;
    let L = M + 1.916 * Math.sin(M * RAD) + 0.02 * Math.sin(2 * M * RAD) + 282.634;
    L = (L + 360) % 360;
    let RA = Math.atan(0.91764 * Math.tan(L * RAD)) / RAD;
    RA = (RA + 360) % 360;
    RA += Math.floor(L / 90) * 90 - Math.floor(RA / 90) * 90;
    RA /= 15;
    const sinDec = 0.39782 * Math.sin(L * RAD);
    const cosDec = Math.cos(Math.asin(sinDec));
    const cosH = (Math.cos(zenith * RAD) - sinDec * Math.sin(lat * RAD)) / (cosDec * Math.cos(lat * RAD));
    if (cosH > 1 || cosH < -1) return null;
    let H = morning ? 360 - Math.acos(cosH) / RAD : Math.acos(cosH) / RAD;
    H /= 15;
    const T = H + RA - 0.06571 * t - 6.622;
    let UT = (T - lngHour + 48) % 24;
    return new Date(Date.UTC(y, m - 1, d) + UT * 3600 * 1000);
  }

  // התאריך האזרחי בישראל של רגע נתון
  function israelYMD(date) {
    const p = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
    const [y, m, d] = p.split("-").map(Number);
    return { y, m, d };
  }

  const add = (date, min) => date && new Date(date.getTime() + min * 60000);
  const between = (a, b, f) => a && b && new Date(a.getTime() + (b.getTime() - a.getTime()) * f);

  /** כל זמני היום לעיר ותאריך (ymd = {y,m,d} לפי לוח אזרחי) */
  function dayTimes(city, ymd) {
    const [lat, lon] = CITY_COORDS[city] || CITY_COORDS["ירושלים"];
    const { y, m, d } = ymd;
    const s = (deg, morning) => sunTime(y, m, d, lat, lon, deg, morning);
    const sunrise = s(0.833, true), sunset = s(0.833, false);
    const alos = s(16.1, true), tzeisMga = s(16.1, false);
    const gra = (h) => between(sunrise, sunset, h / 12);
    const mga = (h) => between(alos, tzeisMga, h / 12);
    return {
      alos,
      misheyakir: s(11.5, true),
      sunrise,
      shmaMga: mga(3), shmaGra: gra(3),
      tfilaMga: mga(4), tfilaGra: gra(4),
      chatzos: gra(6),
      minchaGedola: gra(6.5),
      minchaKetana: gra(9.5),
      plag: gra(10.75),
      sunset,
      tzeis: s(8.5, false),
      tzeisRt: add(sunset, 72),
      candles: add(sunset, -(CANDLES[city] || 20)),
      candlesMin: CANDLES[city] || 20,
    };
  }

  // ---------- שבתות וימים טובים (בארץ ישראל) ----------
  const YOM_TOV = {
    Tishri: { 1: "ראש השנה", 2: "ראש השנה", 10: "יום הכיפורים", 15: "סוכות", 22: "שמיני עצרת" },
    Nisan: { 15: "פסח", 21: "שביעי של פסח" },
    Sivan: { 6: "שבועות" },
  };

  function hebrewParts(ymd) {
    const date = new Date(Date.UTC(ymd.y, ymd.m - 1, ymd.d, 10));
    const parts = new Intl.DateTimeFormat("en-u-ca-hebrew", { day: "numeric", month: "long", timeZone: "UTC" }).formatToParts(date);
    return { day: Number(parts.find((p) => p.type === "day").value), month: parts.find((p) => p.type === "month").value };
  }

  /** שם היום הקדוש (שבת / חג) בתאריך אזרחי, או "" ביום חול */
  function holyName(ymd) {
    const { day, month } = hebrewParts(ymd);
    const yt = (YOM_TOV[month] || {})[day];
    if (yt) return yt;
    const dow = new Date(Date.UTC(ymd.y, ymd.m - 1, ymd.d)).getUTCDay();
    return dow === 6 ? "שבת" : "";
  }

  function nextYMD(ymd, n = 1) {
    const t = new Date(Date.UTC(ymd.y, ymd.m - 1, ymd.d + n));
    return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
  }

  /**
   * האם עכשיו שבת או יום טוב (עם מרווח ביטחון: מ-40 דקות לפני השקיעה בערב החג ועד 75 דקות אחרי השקיעה במוצאי החג).
   * מחזיר את שם היום, או "" כשלא.
   */
  function holyNow(now = new Date()) {
    const today = israelYMD(now);
    const t = dayTimes("ירושלים", today);
    const start = add(t.sunset, -40), end = add(t.sunset, 75);
    const tomorrow = nextYMD(today);
    if (now < start) return holyName(today);
    if (now < end) return holyName(today) || holyName(tomorrow);
    return holyName(tomorrow);
  }

  /** ימי ספירת העומר ובין המצרים: בלי שירים חדשים (מחמירים: מט"ז ניסן עד ערב שבועות, ומי"ז תמוז עד י' אב) */
  function noMusic(ymd) {
    const { day, month } = hebrewParts(ymd);
    if (month === "Nisan" && day >= 15) return true;
    if (month === "Iyar") return true;
    if (month === "Sivan" && day <= 5) return true;
    if (month === "Tamuz" && day >= 17) return true;
    if (month === "Av" && day <= 10) return true;
    return false;
  }

  root.Zmanim = { CITY_COORDS, dayTimes, holyName, holyNow, israelYMD, nextYMD, noMusic, TZ };
})(typeof window !== "undefined" ? window : globalThis);
