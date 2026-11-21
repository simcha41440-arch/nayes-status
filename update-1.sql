-- עדכון 1: סרטונים, ותמונות שמוגשות מהאתר עצמו.
-- הרצה: Supabase > SQL Editor > New query > להדביק > Run. אפשר להריץ שוב בלי בעיה.

alter table articles add column if not exists video_url text;
alter table articles add column if not exists video_sound boolean not null default false; -- קול רק אחרי שהמנהל שמע ואישר

-- תיקיית התמונות והסרטונים: קבצים שנבדקו ואושרו בלבד. מוגשים לגולשים דרך הדומיין של האתר.
update storage.buckets
   set public = true,
       file_size_limit = 52428800,
       allowed_mime_types = array['image/jpeg','image/png','image/webp','image/gif','video/mp4','video/webm','video/quicktime']
 where id = 'media';

-- קוד חד-פעמי לאישור מכשיר חדש ללוח הבקרה
create table if not exists admin_codes (
  id          int primary key default 1,
  code_hash   text not null,
  expires_at  timestamptz not null,
  attempts    int not null default 0,
  created_at  timestamptz not null default now()
);
alter table admin_codes enable row level security;

