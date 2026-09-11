-- TASK-261: dark is the app's default theme.
--
-- The client's theme store now starts dark, but it copies the server's
-- settings.theme over itself on load, so a fresh settings row defaulting to
-- 'system' silently undid the new default the first time Settings was opened.
-- Only the default changes: rows that already exist keep what they hold.
ALTER TABLE "UserSettings" ALTER COLUMN "theme" SET DEFAULT 'dark';
