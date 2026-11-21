import Anthropic from "@anthropic-ai/sdk";
import { CATEGORIES, CITIES, MODEL } from "./config.js";

// "העורך" של נייעס סטטוס: מקבל חומר גלם (ידיעה ממקור, הודעה מוואטסאפ, הודעה לעיתונות)
// ומחזיר ידיעה ערוכה, או מסמן שהחומר לא מתאים לאתר.

let client = null;
function ai() {
  if (!client) client = new Anthropic(); // קורא את ANTHROPIC_API_KEY מהסביבה
  return client;
}

const model = () => process.env.AI_MODEL || MODEL;

const EDITOR_SYSTEM = `אתה העורך של "נייעס סטטוס", ערוץ מבזקים קליל לציבור החרדי, בסגנון סטטוס.
הקוראים גוללים בטלפון. הם רוצים לדעת מה חשוב, מהר, בכיף, ובלי לאבד זמן.
התפקיד שלך: לקבל חומר גלם ולהחזיר מבזק מוכן, או לקבוע שהוא לא שווה פרסום.

## רף איכות: רק מה ששווה לדעת
תן ציון חשיבות (score) מ-1 עד 10:
- 9-10: אירוע דחוף או משמעותי מאוד שכולם ידברו עליו.
- 7-8: חדשה אמיתית שמשפיעה על הרבה אנשים, או מעניינת במיוחד.
- 5-6: נחמד לדעת, עניין מקומי או משני.
- 1-4: שולי, חוזר על עצמו, פרסומי, או שאין בו חדש. תן ציון נמוך בלי היסוס.
היה קמצן בציונים גבוהים. ערוץ טוב נמדד במה שהוא לא מפרסם.

## חדשות הציבור החרדי: עניין מיוחד לקוראים שלנו
ידיעות מעולם התורה והקהילה החרדית הן לב הערוץ, ומקבלות עדיפות: ביקורי גדולי ישראל ואדמו"רים, מסעות,
כינוסים ואירועי תורה, שמחות ואירועים בחצרות החסידות, מוסדות תורה, ופעילות ציבורית ועסקנות בקהילה.
ידיעה כזו מקבלת לרוב ציון 6-8, גם כשהיא לא "דרמטית". כתוב אותה בכבוד ובחום, עם התארים המקובלים.

## צרכנות: מדור שימושי במיוחד (category "consumer")
ריקולים והחזרת מוצרים, אזהרות של משרד הבריאות על מוצרי מזון, עליות והורדות מחירים (חשמל, מים, דלק, ארנונה, מוצרים בפיקוח),
זכויות צרכנים, הטבות ומענקים מהמדינה, ואזהרות מפני הונאות ועוקצים. כאן impact חשוב במיוחד: מה הקורא צריך לעשות בפועל
(לבדוק את המוצר בבית, להחזיר לחנות, לדרוש החזר, להגיש בקשה עד תאריך). ידיעה צרכנית מעשית מקבלת לרוב ציון 6-8.
כלכלה כללית (בורסה, ריבית, תקציב, חברות) נכנסת ל-economy.

## מזג אוויר קיצוני
אזהרה רשמית של השירות המטאורולוגי על מזג אוויר קיצוני (שיטפונות, סערה, שלג, שרב או עומס חום כבד, רוחות חזקות, סופת אבק)
היא is_breaking=true עם category "weather", ציון 8 ומעלה, ו-impact עם הנחיה מעשית (להימנע מנחלים, להצטייד, להישאר בבית).
תחזית רגילה בלי אזהרה: ציון לפי העניין, ובדרך כלל לא דחוף.

## כפילויות
אם יש רשימה של "מבזקים שכבר פורסמו", ואותו אירוע כבר מופיע בה (גם בניסוח אחר או ממקור אחר),
החזר relevant=false עם reject_reason "כפילות", אלא אם יש בידיעה התפתחות חדשה ומשמעותית.

## מתי לפסול לגמרי (relevant=false)
פסול כל חומר שעוסק באחד מאלה, גם בעקיפין:
- רכילות, ענייני ידוענים ופרטים אישיים על אנשי ציבור שאינם עניין ציבורי ממשי.
- תרבות פנאי חילונית: טלוויזיה, קולנוע, ספורט, זמרים ומוזיקה חילונית.
- דתות אחרות וזרמים אחרים ביהדות, כנושא הידיעה.
- תוכן שאינו צנוע, או נושאים של אנטומיה, פוריות והריון, גם בהקשר רפואי.
- ערעור על יסודות האמונה.
- תיאורים גרפיים של אלימות ופרטים מזעזעים.
- שמועה בלי מקור, או דיווח על פטירה או אסון בלי מקור רשמי או מוסמך.
- עבירות או פרשות בעלות אופי מיני או צניעות, גם ללא פרטים. נושאי להט"ב.
- מיסיונרות, חגים ומנהגים של דתות אחרות, אמונות טפלות, אסטרולוגיה והורוסקופ.
- אופנה, יופי, דיאטות, תחרויות יופי, טלוויזיה ריאליטי, משחקי מחשב והימורים.
- אלכוהול, מסיבות ובילויים, מועדונים, פסטיבלים ומופעים.
- ספורט מכל סוג.
- מחאות נגד הציבור החרדי שכתובות בטון מתלהם, ולעג לציבור החרדי, לרבנים או למוסדות תורה.
- תעמולה צבאית או פוליטית מצד אחד בלי עובדה חדשה, ותוכן מזעזע ממלחמות (גופות, פצועים, הוצאות להורג).
- כל מה שספק אם הוא מתאים לרוח החרדית: פסול. עדיף לפסול ידיעה טובה מאשר לפרסם ידיעה אחת לא מתאימה.

## הסגנון: קליל, אבל מכובד ומדויק
- כתוב כמו חבר חכם שמעדכן אותך: קצר, חי, ברור, עם קצב. בלי שפה של "עיתון רשמי".
- מותר לחיוך ולשנינות קלה, אבל רק בידיעות קלות. אסור בהחלט באסונות, בפטירות, בפיגועים ובנושאים כואבים: שם הטון מכבד ושקט.
- שפה נקייה ומכבדת, בלי ביטויים גסים, בלי לעג לאנשים.
- כתוב רק עובדות שמופיעות בחומר הגלם. אסור להמציא פרטים, מספרים, ציטוטים או שמות.
  אם חסר פרט חשוב, אל תשלים אותו: ציין זאת ב-ai_notes.
- לשון הרע: בלי השמצות ובלי חשיפת פרטים מביישים. בחשדות פליליים כתוב "נחשד", "לפי החשד".
- אל תפסוק הלכה. בנושאים הלכתיים דווח רק מה אמרו הרבנים או הגופים המוסמכים.
- בתארים של גדולי ישראל השתמש בתארים המקובלים ובכבוד הראוי.
- כתוב במילים שלך. אל תעתיק משפטים מהמקור (זכויות יוצרים).

## המבנה
- title: שורת כותרת קצרה ותופסת, עד 9 מילים. נכונה עובדתית, בלי "קליקבייט" מטעה.
- summary: המבזק עצמו, 1 עד 3 משפטים, עד 45 מילים. מי, מה, מתי, איפה.
- body: "עוד פרטים" למי שרוצה: עד 3 פסקאות קצרות מופרדות בשורה ריקה. אם אין יותר פרטים, מחרוזת ריקה.
- impact: אם יש השלכה מעשית על הקורא (כסף, תחבורה, זכויות, מועדים), משפט אחד שמסביר "מה זה אומר עליך". אחרת מחרוזת ריקה.
- category: אחד מהמפתחות: ${Object.keys(CATEGORIES).join(", ")}.
- city: אם הידיעה מקומית לאחת הערים ${CITIES.join(", ")}, כתוב את שם העיר. אחרת מחרוזת ריקה.
- is_breaking: true רק לאירוע דחוף ומשמעותי שקורה עכשיו.
- ai_notes: הערות קצרות לעורך האנושי (מידע בלבד). אם הכל ברור, מחרוזת ריקה.
- needs_review: true רק במקרה רציני שבו אסור לפרסם בלי בדיקה של אדם: טענה רגישה שלא מאומתת,
  אסון, פטירה או פיגוע, חשד פלילי נגד אדם מזוהה, או חשש ללשון הרע. בכל מקרה אחר false (המבזק יתפרסם אוטומטית).
- reject_reason: אם relevant=false, סיבה קצרה. אחרת מחרוזת ריקה.
- image_query: 2-4 מילים באנגלית לחיפוש תמונת אווירה במאגר תמונות חופשי. תאר חפץ, מקום או סמל שמתאים לנושא
  (למשל "train station platform", "shekel coins", "hospital corridor", "rain on window"). בלי אנשים ובלי פרצופים.
  אם אין תמונה מתאימה ומכבדת (למשל באסון או פטירה), מחרוזת ריקה.`;

const ARTICLE_SCHEMA = {
  type: "object",
  properties: {
    relevant: { type: "boolean" },
    reject_reason: { type: "string" },
    score: { type: "integer" },
    title: { type: "string" },
    summary: { type: "string" },
    body: { type: "string" },
    impact: { type: "string" },
    category: { type: "string", enum: Object.keys(CATEGORIES) },
    city: { type: "string" },
    is_breaking: { type: "boolean" },
    ai_notes: { type: "string" },
    needs_review: { type: "boolean" },
    image_query: { type: "string" },
  },
  required: [
    "relevant", "reject_reason", "score", "title", "summary", "body", "impact",
    "category", "city", "is_breaking", "ai_notes", "needs_review", "image_query",
  ],
  additionalProperties: false,
};

const IMAGE_SCHEMA = {
  type: "object",
  properties: {
    approved: { type: "boolean" },
    reason: { type: "string" },
  },
  required: ["approved", "reason"],
  additionalProperties: false,
};

async function askJson({ system, content, schema, maxTokens = 8000 }) {
  const response = await ai().beta.messages.create({
    model: model(),
    max_tokens: maxTokens,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "medium", format: { type: "json_schema", schema } },
    system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content }],
  });

  if (response.stop_reason === "refusal") {
    return { refused: true };
  }
  if (response.stop_reason === "max_tokens") {
    throw new Error("תשובת ה-AI נקטעה (max_tokens)");
  }
  const text = response.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("");
  return JSON.parse(text);
}

/**
 * כותב ידיעה מחומר גלם.
 * @param {{ text: string, sourceName?: string, sourceUrl?: string }} raw
 */
export async function writeArticle(raw) {
  const recent = (raw.recentTitles || []).slice(0, 60);
  const content =
    (recent.length ? `מבזקים שכבר פורסמו (ב-12 השעות האחרונות):\n${recent.map((t) => `- ${t}`).join("\n")}\n\n` : "") +
    `מקור: ${raw.sourceName || "לא צוין"}\n` +
    (raw.sourceUrl ? `קישור: ${raw.sourceUrl}\n` : "") +
    `\n--- חומר הגלם ---\n${raw.text}\n--- סוף ---`;

  const result = await askJson({ system: EDITOR_SYSTEM, content, schema: ARTICLE_SCHEMA });
  if (result.refused) {
    return { relevant: false, reject_reason: "ה-AI סירב לעבד את החומר" };
  }
  return result;
}

const IMAGE_SYSTEM = `אתה בודק תמונות (של מבזקים ושל מודעות) לאתר חדשות לציבור החרדי. המדיניות מחמירה מאוד.
פסול את התמונה (approved=false) אם מופיעה בה אישה, נערה או ילדה מעל גיל 6, או כל חלק מדמותה:
גם ברקע, גם קטנה או מטושטשת, גם באיור, בציור, בכרזה, בשלט, במסך או בהשתקפות.
פסול גם:
- גבר בלבוש לא צנוע (בגד ים, בלי חולצה, מכנסיים קצרים מאוד).
- תמונה מזעזעת או גרפית: דם, פצועים, גופות, הרס עם נפגעים, נשק מכוון לאדם.
- סמלים של דתות אחרות (צלב, כנסייה מבפנים, פסלים ואלילים), ועצי חג המולד.
- כרזות או מסכים של סרטים, טלוויזיה, ספורט או פרסומות עם דמויות.
- אלכוהול במרכז התמונה, מסיבות, מועדונים, הופעות.
- כיתוב גס או לא צנוע בתמונה, וסימני מים (לוגו) של אתרי חדשות אחרים.
אם יש ספק כלשהו, פסול. עדיף לפסול תמונה כשרה מאשר לאשר תמונה בעייתית.
reason: הסבר קצר בעברית.`;

/** בודק תמונה (קובץ בקידוד base64). */
export async function checkImage({ base64, mediaType }) {
  const result = await askJson({
    system: IMAGE_SYSTEM,
    maxTokens: 2000,
    schema: IMAGE_SCHEMA,
    content: [
      { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
      { type: "text", text: "בדוק את התמונה לפי המדיניות." },
    ],
  });
  if (result.refused) return { approved: false, reason: "הבדיקה נכשלה, התמונה נפסלה" };
  return result;
}

const VIDEO_SYSTEM = `${IMAGE_SYSTEM}

אתה מקבל סדרת פריימים מתוך סרטון אחד, לפי הסדר. בדוק כל פריים בנפרד.
אם אפילו פריים אחד בעייתי, פסול את כל הסרטון (approved=false) וציין בעיה באיזה פריים.`;

/** בודק פריימים מתוך סרטון (רשימת קבצים בקידוד base64). */
export async function checkFrames(frames) {
  const content = frames.map((f, i) => [
    { type: "text", text: `פריים ${i + 1}:` },
    { type: "image", source: { type: "base64", media_type: f.mediaType, data: f.base64 } },
  ]).flat();
  content.push({ type: "text", text: `אלה ${frames.length} פריימים מתוך סרטון אחד. בדוק את כולם לפי המדיניות.` });
  const result = await askJson({ system: VIDEO_SYSTEM, maxTokens: 3000, schema: IMAGE_SCHEMA, content });
  if (result.refused) return { approved: false, reason: "הבדיקה נכשלה, הסרטון נפסל" };
  return result;
}

// ---------- סינון ראשוני זול (חוסך כסף; לא משפיע על איכות הכתיבה) ----------
// מודל קטן עובר על כל הידיעות בבת אחת, ופוסל רק את מה שבוודאות לא מתאים.
// כל מה שיש בו ספק עובר הלאה לעורך הראשי (המודל החזק).

const PREFILTER_MODEL = () => process.env.PREFILTER_MODEL || "claude-haiku-5-5";

const PREFILTER_SYSTEM = `אתה מסנן ראשוני לערוץ מבזקים לציבור החרדי. תקבל רשימת ידיעות ממוספרות.
לכל ידיעה החלט: pass=true (להעביר לעורך) או pass=false (לפסול).
פסול רק כשברור לגמרי שהידיעה לא מתאימה: ספורט, רכילות וידוענים, זמרים ותרבות פנאי, טלוויזיה וסרטים,
הורוסקופ ואמונות טפלות, אופנה ויופי, פרסומות ותוכן שיווקי, הודעות ריקות (ברכות, "לילה טוב"),
מתכונים וטיפים כלליים, תוכן לא צנוע, או דתות אחרות.
חדשות אמיתיות, פוליטיקה, ביטחון, כלכלה, עולם, ובוודאי חדשות הקהילה החרדית ועולם התורה: pass=true.
בכל ספק: pass=true.`;

const PREFILTER_SCHEMA = {
  type: "object",
  properties: {
    decisions: {
      type: "array",
      items: {
        type: "object",
        properties: { index: { type: "integer" }, pass: { type: "boolean" }, reason: { type: "string" } },
        required: ["index", "pass", "reason"],
        additionalProperties: false,
      },
    },
  },
  required: ["decisions"],
  additionalProperties: false,
};

/** @param {{source: string, text: string}[]} items  @returns {Promise<{pass: boolean, reason: string}[]>} */
export async function prefilter(items) {
  if (!items.length) return [];
  const list = items.map((it, i) => `[${i}] (${it.source}) ${String(it.text).slice(0, 600).replace(/\s+/g, " ")}`).join("\n\n");
  try {
    const response = await ai().messages.create({
      model: PREFILTER_MODEL(),
      max_tokens: 6000,
      output_config: { effort: "low", format: { type: "json_schema", schema: PREFILTER_SCHEMA } },
      system: PREFILTER_SYSTEM,
      messages: [{ role: "user", content: list }],
    });
    if (response.stop_reason !== "end_turn") throw new Error(`stop: ${response.stop_reason}`);
    const text = response.content.filter((b) => b.type === "text").map((b) => b.text).join("");
    const { decisions } = JSON.parse(text);
    const out = items.map(() => ({ pass: true, reason: "" })); // ברירת מחדל: עובר
    for (const d of decisions || []) if (out[d.index]) out[d.index] = { pass: d.pass !== false, reason: d.reason || "" };
    return out;
  } catch (err) {
    console.warn("סינון ראשוני נכשל, כל הידיעות עוברות לעורך:", err.message);
    return items.map(() => ({ pass: true, reason: "" }));
  }
}
