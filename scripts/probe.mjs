// בדיקת דפים: לכל כתובת מדפיסים סטטוס, כותרת, og:image ותמונות שנמצאו בדף.
const urls = process.argv.slice(2);
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36";
for (const u of urls) {
  try {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 20000);
    const r = await fetch(u, { signal: ctl.signal, headers: { "User-Agent": UA, "Accept-Language": "he,en;q=0.8" }, redirect: "follow" });
    const html = await r.text(); clearTimeout(t);
    const title = (/<title[^>]*>([^<]*)/i.exec(html) || [])[1] || "";
    const og = (/property=["']og:image["'][^>]*content=["']([^"']+)/i.exec(html) || /content=["']([^"']+)["'][^>]*property=["']og:image/i.exec(html) || [])[1] || "";
    const imgs = [...new Set([...html.matchAll(/(https?:)?\/\/[^"'\s)]+?\.(?:jpe?g|png|webp)(?:\?[^"'\s)]*)?/gi)].map((m) => m[0]))].slice(0, 25);
    console.log(`\n=== ${r.status} ${u}\n  title: ${title.trim().slice(0, 100)}\n  og: ${og}\n  ${imgs.join("\n  ")}`);
  } catch (e) { console.log(`\n=== FAIL ${u} ${e.message}`); }
}
