import nodemailer from "nodemailer";

// שליחת מייל לבעל האתר בלבד, דרך חשבון ה-Gmail שלו (סיסמת אפליקציה).
// הכתובת נמצאת רק בהגדרות השרת (CONTACT_EMAIL) ולא מופיעה באתר.

export function mailConfigured() {
  return Boolean(process.env.CONTACT_EMAIL && process.env.GMAIL_APP_PASSWORD);
}

export async function mailOwner({ subject, text, replyTo }) {
  const to = process.env.CONTACT_EMAIL;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!to || !pass) return false;
  const transport = nodemailer.createTransport({ service: "gmail", auth: { user: to, pass } });
  await transport.sendMail({ from: `"נייעס סטטוס" <${to}>`, to, replyTo, subject, text });
  return true;
}
