-- TASK-441: a session can name the cameras every take records (JSON array; null = head only).
ALTER TABLE "TeleoperationSession" ADD COLUMN     "cameras" TEXT;
