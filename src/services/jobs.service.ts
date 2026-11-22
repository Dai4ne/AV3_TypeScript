import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { FastifyReply } from "fastify";
import { prisma } from "../database/prisma.js";
import { executarAnalise } from "./analytics.service.js";
import type { NomeAnalise } from "./analytics.service.js";

export type FormatoRelatorio = "JSON" | "CSV";
type JobDisponivel = { id: string; tipo: string; formato: string; parametros: unknown; tentativas: number };
const diretorioSaida = path.resolve(process.env.REPORTS_DIR || path.join(process.cwd(), "data", "reports"));
const maxTentativas = Math.max(1, Number(process.env.REPORT_JOB_MAX_ATTEMPTS ?? 5));
const intervaloMs = Math.max(250, Number(process.env.REPORT_WORKER_POLL_MS ?? 1000));
const leaseMs = Math.max(30_000, Number(process.env.REPORT_JOB_LOCK_TIMEOUT_MS ?? 600_000));

function normalizarAnalise(value: unknown): NomeAnalise {
    if (value === "eficiencia" || value === "rentabilidade" || value === "vidaUtil") return value;
    throw new Error("Tipo de análise inválido no job.");
}
function normalizarFormato(value: unknown): FormatoRelatorio {
    if (value === "JSON" || value === "CSV") return value;
    throw new Error("Formato do relatório deve ser JSON ou CSV.");
}

function escaparCsv(value: string): string { return `"${value.replaceAll('"', '""')}"`; }
function converterCsv(value: unknown): string {
    const rows: Array<[string, string]> = [];
    const percorrer = (item: unknown, chave: string) => {
        if (Array.isArray(item)) item.forEach((parte, indice) => percorrer(parte, `${chave}[${indice}]`));
        else if (item && typeof item === "object") Object.entries(item).forEach(([nome, parte]) => percorrer(parte, chave ? `${chave}.${nome}` : nome));
        else rows.push([chave || "resultado", item === null || item === undefined ? "" : String(item)]);
    };
    percorrer(value, "");
    return `\uFEFFcampo;valor\r\n${rows.map(([campo, dado]) => `${escaparCsv(campo)};${escaparCsv(dado)}`).join("\r\n")}`;
}

async function gerarArquivo(jobId: string, formato: FormatoRelatorio, resultado: unknown): Promise<string> {
    await mkdir(diretorioSaida, { recursive: true });
    const destino = path.join(diretorioSaida, `${jobId}.${formato.toLowerCase()}`);
    const conteudo = formato === "JSON" ? JSON.stringify(resultado, null, 2) : converterCsv(resultado);
    await writeFile(destino, conteudo, "utf8");
    return destino;
}

async function reivindicarJob(workerId: string): Promise<JobDisponivel | null> {
    return prisma.$transaction(async tx => {
        const agoraMenosLease = new Date(Date.now() - leaseMs);
        const leaseExpirada = { OR: [{ lockedAt: { lt: agoraMenosLease } }, { lockedAt: null }] };
        await tx.jobRelatorio.updateMany({
            where: { status: "EM_PROCESSAMENTO", ...leaseExpirada, tentativas: { gte: maxTentativas } },
            data: { status: "FALHOU", lockedAt: null, workerId: null, erro: "Worker perdeu a lease após esgotar as tentativas." },
        });
        await tx.jobRelatorio.updateMany({
            where: { status: "EM_PROCESSAMENTO", ...leaseExpirada, tentativas: { lt: maxTentativas } },
            data: { status: "PENDENTE", lockedAt: null, workerId: null, proximaExecucao: new Date(), erro: "Lease do worker expirou; job devolvido à fila." },
        });
        const claimed = await tx.$queryRaw<JobDisponivel[]>`
            UPDATE "JobRelatorio"
            SET "status" = 'EM_PROCESSAMENTO',
                "workerId" = ${workerId},
                "lockedAt" = CURRENT_TIMESTAMP,
                "tentativas" = "tentativas" + 1,
                "atualizadoEm" = CURRENT_TIMESTAMP
            WHERE "id" = (
                SELECT "id" FROM "JobRelatorio"
                WHERE "status" = 'PENDENTE' AND "proximaExecucao" <= CURRENT_TIMESTAMP
                ORDER BY "criadoEm" ASC
                FOR UPDATE SKIP LOCKED
                LIMIT 1
            )
            RETURNING "id", "tipo", "formato", "parametros", "tentativas"
        `;
        return claimed[0] ?? null;
    });
}

async function processar(job: JobDisponivel, workerId: string) {
    const parametros = job.parametros as { analise?: unknown; formato?: unknown };
    const analise = normalizarAnalise(parametros.analise ?? job.tipo);
    const formato = normalizarFormato(parametros.formato ?? job.formato);
    const heartbeat = setInterval(() => {
        void prisma.jobRelatorio.updateMany({ where: { id: job.id, status: "EM_PROCESSAMENTO", workerId }, data: { lockedAt: new Date() } });
    }, Math.max(5000, Math.floor(leaseMs / 3)));
    try {
        const resultado = await executarAnalise(analise);
        const arquivo = await gerarArquivo(job.id, formato, resultado);
        await prisma.jobRelatorio.updateMany({
            where: { id: job.id, status: "EM_PROCESSAMENTO", workerId },
            data: { status: "CONCLUIDO", resultado: JSON.parse(JSON.stringify(resultado)), arquivo, erro: null, lockedAt: null, workerId: null },
        });
    } catch (erro) {
        const mensagem = String(erro).slice(0, 4000);
        const final = job.tentativas >= maxTentativas;
        const atrasoMs = 1000 * 2 ** Math.max(0, job.tentativas - 1);
        await prisma.jobRelatorio.updateMany({
            where: { id: job.id, status: "EM_PROCESSAMENTO", workerId },
            data: {
                status: final ? "FALHOU" : "PENDENTE",
                erro: mensagem,
                proximaExecucao: final ? new Date() : new Date(Date.now() + atrasoMs),
                lockedAt: null,
                workerId: null,
            },
        });
    } finally { clearInterval(heartbeat); }
}

export function iniciarWorkerRelatorios() {
    const concorrencia = Math.max(1, Number(process.env.REPORT_WORKER_CONCURRENCY ?? 2));
    let parando = false;
    const loops = Array.from({ length: concorrencia }, async () => {
        const workerId = randomUUID();
        while (!parando) {
            try {
                const job = await reivindicarJob(workerId);
                if (job) await processar(job, workerId);
                else await new Promise(resolve => setTimeout(resolve, intervaloMs));
            } catch (erro) {
                console.error("Erro no worker PostgreSQL de relatórios:", erro);
                await new Promise(resolve => setTimeout(resolve, intervaloMs));
            }
        }
    });
    return {
        async close() { parando = true; await Promise.all(loops); },
    };
}

export const jobsService = {
    criar(analise: NomeAnalise, formato: FormatoRelatorio, parceiro: string) {
        return prisma.jobRelatorio.create({ data: { tipo: analise, formato, parceiro, parametros: { analise, formato }, status: "PENDENTE" } });
    },
    buscar(id: string, parceiro: string) {
        return prisma.jobRelatorio.findFirst({
            where: { id, parceiro },
            select: { id: true, tipo: true, formato: true, status: true, parametros: true, erro: true, tentativas: true, proximaExecucao: true, criadoEm: true, atualizadoEm: true },
        });
    },
    async arquivo(id: string, parceiro: string) {
        const job = await prisma.jobRelatorio.findFirst({ where: { id, parceiro }, select: { id: true, formato: true, status: true, arquivo: true } });
        if (!job) return { tipo: "nao-encontrado" as const };
        if (job.status !== "CONCLUIDO" || !job.arquivo) return { tipo: "nao-pronto" as const };
        const caminho = path.resolve(job.arquivo);
        if (!caminho.startsWith(`${diretorioSaida}${path.sep}`)) return { tipo: "nao-encontrado" as const };
        try { return { tipo: "pronto" as const, formato: job.formato, conteudo: await readFile(caminho) }; }
        catch { return { tipo: "arquivo-ausente" as const }; }
    },
    listarDeadLetter() {
        return prisma.jobRelatorio.findMany({
            where: { status: "FALHOU" }, orderBy: { atualizadoEm: "desc" }, take: 100,
            select: { id: true, tipo: true, formato: true, parceiro: true, tentativas: true, erro: true, criadoEm: true, atualizadoEm: true },
        });
    },
};

export async function responderDownload(reply: FastifyReply, jobId: string, formato: string, conteudo: Buffer) {
    const extensao = formato.toLowerCase();
    const contentType = formato === "CSV" ? "text/csv; charset=utf-8" : "application/json; charset=utf-8";
    return reply.header("Content-Type", contentType)
        .header("Content-Disposition", `attachment; filename="relatorio-${jobId}.${extensao}"`)
        .send(conteudo);
}
