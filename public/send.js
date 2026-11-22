// "שלחו לנו": תמונה או סרטון לפרסום. כל קובץ נבדק (AI) לפני שהוא נשמר.
(function () {
  const $ = (id) => document.getElementById(id);
  $("back").innerHTML = icon("back", 24);
  const session = () => { try { return localStorage.getItem("nayes_user") || ""; } catch { return ""; } };
  const MAX_VIDEO_MB = 30, MAX_VIDEO_SEC = 180;

  async function post(action, payload) {
    const r = await fetch("/api/me", { method: "POST", headers: { "Content-Type": "application/json", "X-User": session() }, body: JSON.stringify({ action, ...payload }) });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || `שגיאה ${r.status}`);
    return data;
  }

  async function init() {
    let cfg = {};
    try { cfg = await (await fetch("/api/me?config=1")).json(); } catch {}
    if (!session()) {
      const back = location.origin + "/send";
      $("send-login").hidden = false;
      $("send-login").innerHTML = `<div class="empty">כדי לשלוח צריך להתחבר פעם אחת.<br><br>
        <a class="btn" href="${cfg.supabaseUrl}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(back)}">התחברות עם Google</a></div>`;
      return;
    }
    $("send-form").hidden = false;
  }
  setTimeout(init, 300); // אחרי ש-user.js סיים לטפל בחזרה מ-Google

  const say = (t, cls = "") => { $("msg").className = `form-msg ${cls}`; $("msg").textContent = t; };

  $("file").onchange = () => {
    const f = $("file").files[0];
    $("preview").innerHTML = "";
    if (!f) return;
    $("file-label").textContent = f.name;
    const url = URL.createObjectURL(f);
    $("preview").innerHTML = f.type.startsWith("video/")
      ? `<video src="${url}" controls playsinline muted></video>` : `<img src="${url}" alt="">`;
  };

  // תמונה: מוקטנת בדפדפן (עד 1600 פיקסלים) לפני שליחה
  function shrinkImage(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const s = Math.min(1, 1600 / Math.max(img.width, img.height));
        const c = document.createElement("canvas");
        c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL("image/jpeg", 0.85));
      };
      img.onerror = () => reject(new Error("לא הצלחתי לקרוא את התמונה"));
      img.src = URL.createObjectURL(file);
    });
  }

  // סרטון: 16 פריימים לבדיקה
  function videoFrames(file) {
    return new Promise((resolve, reject) => {
      const v = document.createElement("video");
      v.muted = true; v.playsInline = true; v.preload = "auto"; v.src = URL.createObjectURL(file);
      v.onerror = () => reject(new Error("לא הצלחתי לקרוא את הסרטון"));
      v.onloadedmetadata = async () => {
        const dur = v.duration;
        if (!isFinite(dur) || dur <= 0) return reject(new Error("לא הצלחתי לקרוא את אורך הסרטון"));
        if (dur > MAX_VIDEO_SEC) return reject(new Error("הסרטון ארוך מדי (עד 3 דקות)"));
        const n = 16, s = Math.min(1, 512 / Math.max(v.videoWidth, v.videoHeight));
        const c = document.createElement("canvas");
        c.width = Math.round(v.videoWidth * s); c.height = Math.round(v.videoHeight * s);
        const g = c.getContext("2d"), frames = [];
        for (let i = 0; i < n; i++) {
          await new Promise((res) => { v.onseeked = res; v.currentTime = Math.min(dur - 0.05, (dur * (i + 0.5)) / n); });
          g.drawImage(v, 0, 0, c.width, c.height);
          frames.push(c.toDataURL("image/jpeg", 0.7));
        }
        resolve(frames);
      };
    });
  }

  $("send-form").onsubmit = async (e) => {
    e.preventDefault();
    const f = $("file").files[0];
    if (!f) return say("בחרו קובץ", "bad");
    const base = { text: $("text").value, credit: $("credit").value, phone: $("phone").value, consent: $("consent").checked };
    $("submit").disabled = true;
    try {
      let r;
      if (f.type.startsWith("video/")) {
        if (f.size > MAX_VIDEO_MB * 1024 * 1024) throw new Error("הסרטון גדול מדי (עד 30MB)");
        say("בודק את הסרטון... (כחצי דקה)");
        const chk = await post("submitVideoCheck", { frames: await videoFrames(f), type: f.type || "video/mp4" });
        if (!chk.approved) throw new Error("הסרטון לא מתאים לפרסום אצלנו: " + chk.reason);
        say("מעלה את הסרטון...");
        const up = await fetch(chk.uploadUrl, { method: "PUT", headers: { "Content-Type": f.type || "video/mp4", "x-upsert": "false" }, body: f });
        if (!up.ok) throw new Error(`ההעלאה נכשלה (${up.status})`);
        r = await post("submitMedia", { ...base, kind: "video", name: chk.name, poster: chk.poster, approval: chk.approval });
      } else {
        say("בודק את התמונה...");
        r = await post("submitMedia", { ...base, kind: "image", dataUrl: await shrinkImage(f) });
      }
      if (!r.approved) throw new Error("הקובץ לא מתאים לפרסום אצלנו: " + r.reason);
      say("נשלח, תודה רבה! אם זה מתאים, זה יעלה בקרוב עם הקרדיט שלכם.", "good");
      $("send-form").reset(); $("preview").innerHTML = ""; $("file-label").textContent = "שליחת קובץ נוסף";
    } catch (err) {
      say(err.message, "bad");
    } finally {
      $("submit").disabled = false;
    }
  };
})();
