-- Calendar: jobs booked onto days, quick status flags on jobs, and days off / day notes.

ALTER TABLE jobs ADD COLUMN scheduled_date TEXT;                 -- YYYY-MM-DD the job is booked in for (NULL = not scheduled)
ALTER TABLE jobs ADD COLUMN scheduled_time TEXT;                 -- HH:MM, optional
ALTER TABLE jobs ADD COLUMN duration_days INTEGER NOT NULL DEFAULT 1 CHECK (duration_days BETWEEN 1 AND 30);
ALTER TABLE jobs ADD COLUMN flags TEXT NOT NULL DEFAULT '[]';    -- JSON: ["parts_ordered","customer_informed",...]
CREATE INDEX idx_jobs_scheduled ON jobs(scheduled_date);

-- Jobs opened from a confirmed booking take the booking's day.
UPDATE jobs SET scheduled_date = (SELECT substr(b.scheduled_start, 1, 10) FROM bookings b WHERE b.id = jobs.booking_id)
 WHERE scheduled_date IS NULL AND booking_id IS NOT NULL;

-- Days off (whole business or one person) and notes pinned to days.
CREATE TABLE calendar_entries (
  id          TEXT PRIMARY KEY,
  kind        TEXT NOT NULL CHECK (kind IN ('off','note')),
  start_date  TEXT NOT NULL,                                     -- YYYY-MM-DD
  end_date    TEXT NOT NULL,                                     -- YYYY-MM-DD, inclusive
  title       TEXT NOT NULL,
  user_id     TEXT REFERENCES users(id) ON DELETE CASCADE,       -- who is off; NULL = everyone / the workshop
  created_by  TEXT REFERENCES users(id),
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  CHECK (end_date >= start_date)
);
CREATE INDEX idx_calendar_entries_dates ON calendar_entries(start_date, end_date);
