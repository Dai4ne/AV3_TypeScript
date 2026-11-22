ALTER TABLE "JobRelatorio" ADD COLUMN "formato" TEXT NOT NULL DEFAULT 'JSON';
ALTER TABLE "JobRelatorio" ADD COLUMN "parceiro" TEXT;
CREATE INDEX "JobRelatorio_parceiro_criadoEm_idx" ON "JobRelatorio"("parceiro", "criadoEm");
