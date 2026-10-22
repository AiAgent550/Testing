-- Each user's language for the dashboard and AI answers: English or Polish.
ALTER TABLE users ADD COLUMN lang TEXT NOT NULL DEFAULT 'en' CHECK (lang IN ('en','pl'));
