// קריאת ערוץ טלגרם ציבורי דרך דף התצוגה המקדימה הציבורי (t.me/s/<ערוץ>), בלי מפתח ובלי חשבון.

const ENT = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&nbsp;": " " };
const decode = (s = "") => s.replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (m) => ENT[m]).replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
const text = (html = "") => decode(html.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "")).replace(/[ \t]+/g, " ").trim();

export async function readTelegram(channel, { timeoutMs = 20000 } = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  const r = await fetch(`https://t.me/s/${encodeURIComponent(channel)}`, {
    signal: ctl.signal,
    headers: { "User-Agent": "Mozilla/5.0 (compatible; NayesStatusBot/1.0)", "Accept-Language": "he,en;q=0.8" },
  });
  const html = await r.text();
  clearTimeout(timer);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);

  const title = text((/<meta property="og:title" content="([^"]*)"/.exec(html) || [])[1] || channel);
  const blocks = html.split('class="tgme_widget_message_wrap').slice(1);
  const posts = [];
  for (const b of blocks) {
    const post = (/data-post="([^"]+)"/.exec(b) || [])[1];
    if (!post) continue;
    const body = text((/class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/.exec(b) || [])[1] || "");
    const date = (/<time[^>]+datetime="([^"]+)"/.exec(b) || [])[1] || null;
    const photos = [...b.matchAll(/tgme_widget_message_photo_wrap[^>]*background-image:url\('([^']+)'\)/g)].map((m) => m[1]);
    const videos = [...b.matchAll(/<video[^>]+src="([^"]+)"/g)].map((m) => decode(m[1]));
    posts.push({ id: post, link: `https://t.me/${post}`, text: body, date, photos, videos });
  }
  return { title, posts: posts.reverse() }; // החדשים קודם
}
