// בדיקה: מה ויקישיתוף מחזיר לכמה חיפושים (בלי לשמור כלום)
const UA = { "User-Agent": "NayesStatusBot/1.0 (https://www.nayesstatus.com)" };
const strip = (h = "") => String(h).replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
for (const q of ['"Shaul Alter"', '"שאול אלתר"', '"Dov Lando"', '"Moshe Hillel Hirsch"', 'Jerusalem Old City panorama', 'Talmud books bookshelf', 'Bnei Brak street']) {
  const api = `https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search&gsrnamespace=6&gsrlimit=6&gsrsearch=${encodeURIComponent(q + " filetype:bitmap")}&prop=imageinfo&iiprop=url|extmetadata|mime&iiurlwidth=1080`;
  try {
    const r = await fetch(api, { headers: UA });
    const pages = Object.values((await r.json()).query?.pages || {});
    console.log(`\n== ${q}: ${r.status}, ${pages.length} תוצאות`);
    for (const p of pages.slice(0, 4)) {
      const m = p.imageinfo?.[0]?.extmetadata || {};
      console.log(`  ${p.title} | ${strip(m.LicenseShortName?.value)} | ${strip(m.Artist?.value).slice(0, 40)}`);
    }
  } catch (e) { console.log(`== ${q}: FAIL ${e.message}`); }
}
