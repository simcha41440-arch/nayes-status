import { getState } from "./_lib/state.js";
import { readTelegram } from "./_lib/telegram.js";

// GET /api/state → מצב חירום (אם הופעל בלוח הבקרה) והודעות פיקוד העורף האחרונות מהערוץ הרשמי.
export default async function handler(req, res) {
  const [state, oref] = await Promise.all([
    getState(),
    readTelegram("PikudHaOref_all", { timeoutMs: 8000 }).then((r) => r.posts || []).catch(() => []),
  ]);
  const day = Date.now() - 24 * 3600 * 1000;
  const posts = (oref || [])
    .filter((p) => p.text && Date.parse(p.date) > day)
    .sort((a, b) => Date.parse(b.date) - Date.parse(a.date))
    .slice(0, 12)
    .map((p) => ({ text: p.text.slice(0, 1200), date: p.date }));
  const em = state.emergency && state.emergency.on ? state.emergency : null;
  res.setHeader("Cache-Control", "public, s-maxage=20, stale-while-revalidate=40");
  res.status(200).json({ emergency: em, oref: posts });
}
