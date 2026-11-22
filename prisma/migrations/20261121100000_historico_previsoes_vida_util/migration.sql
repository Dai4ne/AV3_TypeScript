CREATE TABLE "PrevisaoVidaUtil" (
  "id" TEXT NOT NULL,
  "execucaoId" TEXT NOT NULL,
  "equipamentoId" TEXT NOT NULL,
  "calculadoEm" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "estadoNoCalculo" "EstadoFisico" NOT NULL,
  "dataPrevista" TIMESTAMPTZ(3),
  "dataReal" TIMESTAMPTZ(3),
  "erroDias" INTEGER,
  CONSTRAINT "PrevisaoVidaUtil_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PrevisaoVidaUtil_execucaoId_fkey" FOREIGN KEY ("execucaoId") REFERENCES "ExecucaoAnalitica"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "PrevisaoVidaUtil_equipamentoId_fkey" FOREIGN KEY ("equipamentoId") REFERENCES "Equipamento"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "PrevisaoVidaUtil_execucaoId_equipamentoId_key" ON "PrevisaoVidaUtil"("execucaoId", "equipamentoId");
CREATE INDEX "PrevisaoVidaUtil_equipamentoId_calculadoEm_idx" ON "PrevisaoVidaUtil"("equipamentoId", "calculadoEm");
CREATE INDEX "PrevisaoVidaUtil_dataReal_idx" ON "PrevisaoVidaUtil"("dataReal");
