-- TASK-480: a direct dataset upload session (file by file through the API server).
CREATE TABLE "DatasetUpload" (
    "datasetId" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'uploading',
    "sink" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "chunkSize" INTEGER NOT NULL,
    "filesJson" TEXT NOT NULL,
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DatasetUpload_pkey" PRIMARY KEY ("datasetId")
);

CREATE INDEX "DatasetUpload_state_lastActivityAt_idx" ON "DatasetUpload"("state", "lastActivityAt");

ALTER TABLE "DatasetUpload" ADD CONSTRAINT "DatasetUpload_datasetId_fkey" FOREIGN KEY ("datasetId") REFERENCES "Dataset"("id") ON DELETE CASCADE ON UPDATE CASCADE;
