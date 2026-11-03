-- Job notes can be corrected or removed by the person who wrote them; edited_at shows "edited".
ALTER TABLE job_notes ADD COLUMN edited_at TEXT;
