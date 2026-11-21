// קוד משותף: קטגוריות, תאריך עברי, עזרי תצוגה, טעינת נתונים ונתוני דוגמה.

const CATEGORIES = {
  general:   { name: "חדשות",       emoji: "📰" },
  politics:  { name: "פוליטי",      emoji: "🏛️" },
  community: { name: "קהילה",       emoji: "🤝" },
  torah:     { name: "עולם התורה",  emoji: "📜" },
  economy:   { name: "כלכלה",       emoji: "💰" },
  consumer:  { name: "צרכנות",      emoji: "🛒" },
  local:     { name: "בעיר",        emoji: "🏙️" },
  health:    { name: "בריאות",      emoji: "🩺" },
  world:     { name: "עולם",        emoji: "🌍" },
  tech:      { name: "טכנולוגיה",   emoji: "💡" },
  weather:   { name: "מזג אוויר",   emoji: "⛅" },
};

const REACTIONS = ["❤️", "😍", "😂", "😮", "😢", "🙏", "👏", "🎉", "💯"];

const CITIES = ["ירושלים", "בני ברק", "בית שמש", "מודיעין עילית", "ביתר עילית", "אלעד", "אשדוד",
  "חריש", "רכסים", "צפת", "טבריה", "נתיבות", "ערד", "פתח תקווה", "חיפה"];

// לאן פונים מפרסמים: טופס יצירת הקשר באתר (הפניות מגיעות למייל, בלי לחשוף את הכתובת).
const ADVERTISE_LINK = "/about?topic=ads#contact";

// ---------- עזרים ----------

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function timeAgo(iso) {
  if (!iso) return "";
  const diff = (Date.now() - Date.parse(iso)) / 1000;
  if (diff < 60) return "עכשיו";
  const m = Math.floor(diff / 60);
  if (m < 60) return m === 1 ? "לפני דקה" : `לפני ${m} דקות`;
  const h = Math.floor(m / 60);
  if (h < 24) return h === 1 ? "לפני שעה" : h === 2 ? "לפני שעתיים" : `לפני ${h} שעות`;
  return new Date(iso).toLocaleDateString("he-IL", { day: "numeric", month: "long" });
}

function clock(iso) {
  return iso ? new Date(iso).toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" }) : "";
}

function dayLabel(iso) {
  const d = new Date(iso);
  const today = new Date();
  const y = new Date(); y.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "היום";
  if (d.toDateString() === y.toDateString()) return "אתמול";
  return d.toLocaleDateString("he-IL", { weekday: "long", day: "numeric", month: "long" });
}

function articleUrl(a) {
  return `/article/${encodeURIComponent(a.slug)}`;
}

function compact(n) {
  n = Number(n) || 0;
  return n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(".0", "") + "K" : String(n);
}

// ---------- תאריך עברי בגימטריה ----------

function gematria(n) {
  const ones = ["", "א", "ב", "ג", "ד", "ה", "ו", "ז", "ח", "ט"];
  const tens = ["", "י", "כ", "ל", "מ", "נ", "ס", "ע", "פ", "צ"];
  const hundreds = ["", "ק", "ר", "ש", "ת", "תק", "תר", "תש", "תת", "תתק"];
  let s = hundreds[Math.floor(n / 100) % 10] + tens[Math.floor(n / 10) % 10] + ones[n % 10];
  s = s.replace("יה", "טו").replace("יו", "טז");
  return s.length > 1 ? s.slice(0, -1) + "״" + s.slice(-1) : s + "׳";
}

function hebrewDate(d = new Date()) {
  try {
    const parts = new Intl.DateTimeFormat("he-IL-u-ca-hebrew", {
      day: "numeric", month: "long", year: "numeric",
    }).formatToParts(d);
    const day = Number(parts.find((p) => p.type === "day")?.value);
    const month = parts.find((p) => p.type === "month")?.value || "";
    const year = Number(parts.find((p) => p.type === "year")?.value);
    let weekday = d.toLocaleDateString("he-IL", { weekday: "long" });
    if (d.getDay() === 6) weekday = "שבת קודש";
    return `${weekday}, ${gematria(day)} ${month} ${gematria(year % 1000)}`;
  } catch {
    return d.toLocaleDateString("he-IL", { weekday: "long", day: "numeric", month: "long" });
  }
}

// ---------- נתונים ----------

let DEMO_MODE = false;

async function getJson(path) {
  const r = await fetch(path);
  if (!r.ok) throw new Error(r.status);
  return r.json();
}

async function api(params = {}) {
  const qs = new URLSearchParams(params).toString();
  try {
    return await getJson(`/api/articles${qs ? "?" + qs : ""}`);
  } catch {
    // אין שרת מחובר עדיין: מציגים מבזקים לדוגמה כדי לראות את העיצוב.
    DEMO_MODE = true;
    return demoQuery(params);
  }
}

async function loadAds() {
  try {
    return (await getJson("/api/ads")).ads || [];
  } catch {
    DEMO_MODE = true;
    return DEMO_ADS;
  }
}

async function react(slug, emoji) {
  if (DEMO_MODE) return null;
  const r = await fetch("/api/articles", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ slug, emoji }),
  });
  return r.ok ? (await r.json()).reactions : null;
}

function adHref(ad) {
  return DEMO_MODE ? ADVERTISE_LINK : `/api/ads?click=${encodeURIComponent(ad.id)}`;
}

function demoQuery(params) {
  let list = DEMO_ARTICLES.map((a, i) => ({
    ...a,
    published_at: new Date(Date.now() - a.minutesAgo * 60000).toISOString(),
    views: 4200 - i * 410,
  }));
  if (params.slug) return { article: list.find((a) => a.slug === params.slug) || null };
  if (params.after) return { articles: [] };
  if (params.before) return { articles: [] };
  if (params.category) list = list.filter((a) => a.category === params.category);
  if (params.city) list = list.filter((a) => a.city === params.city);
  return { articles: list.slice(0, Number(params.limit) || 30) };
}

// ---------- נתוני דוגמה (מוצגים רק כשאין שרת) ----------

const DEMO_ARTICLES = [
  {
    slug: "demo-1", minutesAgo: 3, category: "general", is_breaking: true, city: "",
    title: "שיבושים ברכבת ביום שישי",
    summary: "בגלל עבודות תשתית, חלק מהקווים לא יפעלו ביום שישי בבוקר. יופעלו אוטובוסים חלופיים בין התחנות הסגורות.",
    impact: "נוסעים ביום שישי? תבדקו את לוח הזמנים מראש ותצאו קצת יותר מוקדם.",
    body: "זה מבזק לדוגמה שמראה איך נראה \"עוד פרטים\".\n\nכאן יופיעו הפרטים המלאים למי שרוצה להעמיק, בלי להעמיס על כל השאר.",
    reactions: { "👍": 42, "😮": 7 }, source_name: "מבזק לדוגמה",
  },
  {
    slug: "demo-2", minutesAgo: 18, category: "economy", city: "",
    title: "מחירי מוצרי היסוד מתעדכנים",
    summary: "מתחילת החודש הבא חלק ממוצרי היסוד המפוקחים יתייקרו בשיעור קטן. המחירים החדשים יפורסמו בקרוב.",
    impact: "קנייה גדולה? עדיף לעשות אותה לפני תחילת החודש.",
    body: "", reactions: { "😮": 31, "🙏": 4 }, source_name: "מבזק לדוגמה",
  },
  {
    slug: "demo-3", minutesAgo: 47, category: "local", city: "בני ברק",
    title: "רחוב מרכזי נסגר לשלושה ימים",
    summary: "העירייה סוגרת את הרחוב לעבודות ניקוז לקראת החורף. פורסמו מסלולים חלופיים.",
    impact: "", body: "", reactions: { "👍": 12 }, source_name: "מבזק לדוגמה",
  },
  {
    slug: "demo-4", minutesAgo: 95, category: "torah", city: "ירושלים",
    title: "אלפים בדרך לכינוס הלימוד הגדול",
    summary: "המארגנים נערכים להסעות מיוחדות מכל רחבי הארץ. נקודות האיסוף פורסמו הבוקר.",
    impact: "", body: "", reactions: { "🙏": 88, "👍": 20 }, source_name: "מבזק לדוגמה",
  },
  {
    slug: "demo-5", minutesAgo: 140, category: "weather", city: "",
    title: "השרב מגיע: שותים, שותים, שותים 💧",
    summary: "צפוי חום כבד מחר ומחרתיים. ההמלצה: להרבות בשתייה ולהימנע מהשמש בשעות הצהריים.",
    impact: "שימו לב במיוחד לילדים ולמבוגרים.", body: "",
    reactions: { "😂": 9, "👍": 15 }, source_name: "מבזק לדוגמה",
  },
  {
    slug: "demo-6", minutesAgo: 210, category: "politics", city: "",
    title: "הוועדה דחתה את ההצבעה על התקציב",
    summary: "דיון סוער על תקציב מוסדות החינוך הסתיים בלי החלטה. ההצבעה נדחתה לשבוע הבא.",
    impact: "", body: "", reactions: { "😮": 6 }, source_name: "מבזק לדוגמה",
  },
  {
    slug: "demo-7", minutesAgo: 290, category: "tech", city: "",
    title: "עדכונים בקול, גם בטלפון כשר",
    summary: "שירות חדש מקריא עדכונים חשובים בטלפון, בכל שעות היממה.",
    impact: "", body: "", reactions: { "👍": 27 }, source_name: "מבזק לדוגמה",
  },
  {
    slug: "demo-8", minutesAgo: 1500, category: "community", city: "בית שמש",
    title: "מבצע התרמה שכונתי שבר שיא",
    summary: "מאות מתנדבים, יממה אחת וסכום שיא למשפחות נזקקות. הכספים יחולקו לפני החג.",
    impact: "", body: "", reactions: { "🙏": 54 }, source_name: "מבזק לדוגמה",
  },
];

const DEMO_ADS = [
  {
    id: "demo-top", placement: "top", advertiser: "עסק לדוגמה",
    title: "כאן תופיע המודעה הראשית שלכם",
    text: "המקום הכי נצפה באתר: נעוץ למעלה, מול כל קורא.", cta: "לפרטים", color: "#0a7d5a",
  },
  {
    id: "demo-feed-1", placement: "feed", advertiser: "חנות לדוגמה",
    title: "מבצע סוף עונה: 1+1 על הכל 🎉",
    text: "מודעה לדוגמה שמשולבת בין המבזקים, בעיצוב מיוחד שבולט אבל לא מפריע.",
    cta: "לפרטים", color: "#6b3fd6",
  },
  {
    id: "demo-side-1", placement: "side", advertiser: "שירות לדוגמה",
    title: "המקום הזה יכול להיות שלכם",
    text: "מודעה בצד המסך, מול כל מי שגולל.", cta: "לפרסום", color: "#d4570f",
  },
];

// ---------- אייקונים בקו דק, בסגנון סטטוס ----------

const CHANNEL_COLORS = {
  hot: "#c0392b", general: "#243640", politics: "#3f4f8f", community: "#2f7566", torah: "#7d5b2e",
  economy: "#c0612b", consumer: "#b5476b", zmanim: "#3d6e9e", oref: "#b23a2f", city: "#6f4396", memory: "#6b5a8e", local: "#6f4396", health: "#23807b", world: "#4a5d75", tech: "#5257b8", weather: "#2f7fb0",
};

const ICON_PATHS = {
  // ערוצים
  general: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M7.5 8.5h9M7.5 12h9M7.5 15.5h5.5"/>',
  hot: '<path d="M13 2.5 4.5 13.5h6.5l-1 8 8.5-11h-6.5z"/>',
  politics: '<path d="M3 20.5h18M5.5 20.5v-9M9.8 20.5v-9M14.2 20.5v-9M18.5 20.5v-9M2.5 9.5 12 4l9.5 5.5z"/>',
  community: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.4 2.7-6 6-6s6 2.6 6 6"/><circle cx="17" cy="9" r="2.6"/><path d="M16.5 14.1c2.6.4 4.5 2.7 4.5 5.9"/>',
  torah: '<path d="M12 6.5C9.8 5 6.8 4.5 3 4.5v13.5c3.8 0 6.8.5 9 2 2.2-1.5 5.2-2 9-2V4.5c-3.8 0-6.8.5-9 2z"/><path d="M12 6.5V20"/>',
  economy: '<rect x="3" y="7" width="18" height="13" rx="2.5"/><path d="M16 13.5h2.5"/><path d="M5.5 7 15 3.8l1.6 3.2"/>',
  consumer: '<path d="M3 4h2.5l2.2 10.5h10.6L20.5 7H7"/><circle cx="9.5" cy="19" r="1.5"/><circle cx="17" cy="19" r="1.5"/>',
  zmanim: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5.2l3.4 2"/>',
  oref: '<path d="M12 3 4.5 6v5.5c0 4.6 3.2 8.2 7.5 9.5 4.3-1.3 7.5-4.9 7.5-9.5V6z"/><path d="M12 8.5v4.5"/><circle cx="12" cy="16" r=".9" fill="currentColor"/>',
  memory: '<path d="M4 12a8 8 0 1 0 2.4-5.7L4 8.5"/><path d="M4 4v4.5h4.5"/><path d="M12 8v4.3l3 1.8"/>',
  whatsapp: '<path d="M4 20l1.2-3.9A8.3 8.3 0 1 1 8 18.9z"/><path d="M9.2 8.6c.2 3 2.9 5.9 6 6.2l1.1-1.5-1.9-1-.9.8c-1-.4-2.1-1.5-2.5-2.5l.8-.9-1-1.9z"/>',
  city: '<path d="M3.5 20.5h17M5.5 20.5V9l5-3v14.5M10.5 20.5V4.5l8 4v12"/><path d="M13.5 11h2M13.5 14h2M13.5 17h2"/>',
  alert: '<path d="M12 3.5 2.5 20h19z"/><path d="M12 10v4.5"/><circle cx="12" cy="17.3" r=".9" fill="currentColor"/>',
  local: '<path d="M12 21s-7-6.1-7-11.8a7 7 0 0 1 14 0C19 14.9 12 21 12 21z"/><circle cx="12" cy="9.2" r="2.6"/>',
  health: '<path d="M20.6 8.8c0 4.9-8.6 11.2-8.6 11.2S3.4 13.7 3.4 8.8A4.5 4.5 0 0 1 12 6.6a4.5 4.5 0 0 1 8.6 2.2z"/><path d="M6.5 12.2h2.8l1.4-2.7 2.6 5.3 1.4-2.6h2.8"/>',
  world: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.4 2.6 3.7 5.6 3.7 9s-1.3 6.4-3.7 9c-2.4-2.6-3.7-5.6-3.7-9S9.6 5.6 12 3z"/>',
  tech: '<path d="M9.2 18h5.6M10.2 21h3.6M12 3a6 6 0 0 0-3.6 10.8c.7.5 1 1.3 1 2.2h5.2c0-.9.3-1.7 1-2.2A6 6 0 0 0 12 3z"/>',
  weather: '<circle cx="8" cy="8.5" r="3"/><path d="M8 2.5V4M3.5 4.2l1 1M2 8.5h1.5"/><path d="M8.5 20h8.5a3.8 3.8 0 0 0 0-7.6 5 5 0 0 0-9.4 1.6 3 3 0 0 0 .9 6z"/>',
  // ממשק
  smile: '<circle cx="12" cy="12" r="9"/><path d="M8.2 14.2a4.6 4.6 0 0 0 7.6 0"/><circle cx="9" cy="10" r=".9" fill="currentColor"/><circle cx="15" cy="10" r=".9" fill="currentColor"/>',
  share: '<path d="M12 15V3.5M7.5 8 12 3.5 16.5 8"/><path d="M5 12.5v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3.5 6.5 8.5 6.5 8.5-6.5"/>',
  sms: '<path d="M4 18.5V6.5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H8z"/><circle cx="8.5" cy="10.5" r=".9" fill="currentColor"/><circle cx="12" cy="10.5" r=".9" fill="currentColor"/><circle cx="15.5" cy="10.5" r=".9" fill="currentColor"/>',
  telegram: '<path d="M21 4 3 11l6 2.2L18 7l-7 7.5V20l3.2-3.6L18 19z"/>',
  link: '<path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1"/><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  install: '<path d="M12 4v11M7.5 10.5 12 15l4.5-4.5"/><path d="M5 19.5h14"/>',
  chevLeft: '<path d="M15 5l-7 7 7 7"/>',
  chevRight: '<path d="M9 5l7 7-7 7"/>',
  megaphone: '<path d="M4 10v4a1 1 0 0 0 1 1h2l8 4.5v-15L7 9H5a1 1 0 0 0-1 1z"/><path d="M18.5 9.5a3.5 3.5 0 0 1 0 5"/><path d="M8 15l1.2 4.5"/>',
  dots: '<circle cx="12" cy="5" r="1.4" fill="currentColor"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/><circle cx="12" cy="19" r="1.4" fill="currentColor"/>',
  back: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  bell: '<path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2H4.5z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
  bellOff: '<path d="M8.5 5.6A6 6 0 0 1 18 11v4M6 11v5.5l-1.5 2H17"/><path d="M10 20.5a2 2 0 0 0 4 0"/><path d="M3 3l18 18"/>',
  badge: '<rect x="3.5" y="5.5" width="13" height="13" rx="3"/><circle cx="17.5" cy="6.5" r="3" fill="currentColor"/>',
  theme: '<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5v17a8.5 8.5 0 0 0 0-17z" fill="currentColor"/>',
  text: '<path d="M4 18 8.5 6 13 18M5.7 14h5.6"/><path d="M14.5 18l2.8-7.5L20 18M15.4 15.6h3.8"/>',
  speed: '<path d="M4.2 17a8.5 8.5 0 1 1 15.6 0"/><path d="M12 13.5l4-4.5"/><circle cx="12" cy="13.5" r="1.3" fill="currentColor"/>',
  checkAll: '<path d="M2.5 12.5l4 4 8-9"/><path d="M11.5 16.5l1 0 8-9"/>',
  trash: '<path d="M4.5 6.5h15M9.5 6.5V4.5h5v2M6.5 6.5l1 13h9l1-13"/>',
  chat: '<path d="M4 18.5V6.5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H8z"/><path d="M8 9h8M8 12h5"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5"/><circle cx="12" cy="7.8" r=".9" fill="currentColor"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7"/>',
  play: '<path d="M8 5.5v13l10.5-6.5z" fill="currentColor" stroke="none"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5 20 20"/>',
  updates: '<circle cx="12" cy="12" r="8.5" stroke-dasharray="5.2 2.5"/><circle cx="12" cy="12" r="4.2"/>',
  soundOn: '<path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>',
  soundOff: '<path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5z"/><path d="M16 9.5l5 5M21 9.5l-5 5"/>',
  phone: '<rect x="6.5" y="2.5" width="11" height="19" rx="2.5"/><path d="M10.5 18.5h3"/>',
};

function icon(name, size = 24, stroke = 1.8) {
  return `<svg class="i" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON_PATHS[name] || ""}</svg>`;
}

// ---------- חלון שיתוף: וואטסאפ, מייל, SMS, טלגרם, העתקת קישור ועוד ----------
function openShare({ title = "נייעס סטטוס", text = "", url = location.origin + "/" } = {}) {
  const full = `${text ? text + "\n" : ""}${url}`;
  const enc = encodeURIComponent;
  const opts = [
    ["whatsapp", "וואטסאפ", `https://wa.me/?text=${enc(full)}`, "#1f9d55"],
    ["mail", "מייל", `mailto:?subject=${enc(title)}&body=${enc(full)}`, "#3d6e9e"],
    ["sms", "הודעת SMS", `sms:?&body=${enc(full)}`, "#6f4396"],
    ["telegram", "טלגרם", `https://t.me/share/url?url=${enc(url)}&text=${enc(text || title)}`, "#2a9fd6"],
    ["link", "העתקת קישור", "", "#4a5d75"],
  ];
  if (navigator.share) opts.push(["share", "עוד אפשרויות", "", "#c0612b"]);
  const back = document.createElement("div");
  back.className = "dlg-back share-back";
  back.innerHTML = `<div class="dlg share-dlg" role="dialog" aria-modal="true" aria-label="שיתוף"><h3>שיתוף</h3>
    <div class="share-grid">${opts.map(([k, label, href, c]) => href
      ? `<a href="${esc(href)}" ${k === "mail" || k === "sms" ? "" : 'target="_blank" rel="noopener"'} data-k="${k}"><span style="background:${c}">${icon(k, 26, 1.7)}</span>${esc(label)}</a>`
      : `<button data-k="${k}"><span style="background:${c}">${icon(k, 26, 1.7)}</span>${esc(label)}</button>`).join("")}</div>
    <div class="btns"><button data-cancel>סגירה</button></div></div>`;
  const close = () => back.remove();
  back.addEventListener("click", (e) => { if (e.target === back) close(); });
  back.querySelector("[data-cancel]").onclick = close;
  back.querySelectorAll("a[data-k]").forEach((a) => a.addEventListener("click", () => setTimeout(close, 300)));
  const copy = back.querySelector('[data-k="link"]');
  copy.onclick = async () => {
    try { await navigator.clipboard.writeText(url); copy.lastChild.textContent = "הועתק ✓"; } catch { copy.lastChild.textContent = url; }
    setTimeout(close, 900);
  };
  const more = back.querySelector('[data-k="share"]');
  if (more) more.onclick = async () => { close(); try { await navigator.share({ title, text, url }); } catch {} };
  document.body.appendChild(back);
}
