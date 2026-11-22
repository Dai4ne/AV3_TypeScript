ALTER TABLE "JobRelatorio"
  ADD COLUMN "proximaExecucao" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "lockedAt" TIMESTAMPTZ(3),
  ADD COLUMN "workerId" TEXT;
CREATE INDEX "JobRelatorio_status_proximaExecucao_criadoEm_idx" ON "JobRelatorio"("status", "proximaExecucao", "criadoEm");
CREATE INDEX "JobRelatorio_lockedAt_idx" ON "JobRelatorio"("lockedAt");
