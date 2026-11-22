import type { FastifyInstance } from "fastify";
import { createHash } from "node:crypto";
import { prisma } from "../database/prisma.js";
import { autenticarChaveApi, exigirPermissaoApi } from "../plugins/api-key.js";
import { executarAnalise } from "../services/analytics.service.js";
import type { NomeAnalise } from "../services/analytics.service.js";
import { jobsService, responderDownload } from "../services/jobs.service.js";
import { materializarEsquema } from "./openapi.js";
import { ErroApiPublica, publicApiService } from "../services/public-api.service.js";

const exemploErro = (descricao: string, erro: string) => ({
    description: descricao,
    content: { "application/json": { schema: materializarEsquema("#/components/schemas/Erro"), examples: { erro: { summary: descricao, value: { erro } } } } },
});

const exemploFastify = (descricao: string, statusCode: number, error: string, message: string) => ({
    description: descricao,
    content: { "application/json": { schema: materializarEsquema("#/components/schemas/ErroFastify"), examples: { erro: { summary: descricao, value: { statusCode, error, message } } } } },
});

function respostaComExemplo(descricao: string, esquema: string, valor: unknown) {
    return {
        description: descricao,
        content: { "application/json": { schema: materializarEsquema(esquema), examples: { sucesso: { summary: "Resposta de sucesso", value: valor } } } },
    };
}

function esquemaApiKey(summary: string, description: string) {
    return {
        summary,
        description,
        tags: ["API pública v1"],
        security: [{ apiKeyAuth: [] }],
        response: {
            401: exemploErro("Chave ausente, inválida ou expirada.", "Chave inválida, inativa ou expirada."),
            403: exemploErro("Permissão insuficiente para a operação.", "A chave não possui esta permissão."),
            429: exemploFastify("Limite de requisições por chave excedido.", 429, "Too Many Requests", "Rate limit exceeded, retry in 1 minute"),
            500: exemploFastify("Erro interno inesperado.", 500, "Internal Server Error", "Erro interno inesperado."),
        },
    };
}

const exemplosAnalise: Record<"eficiencia" | "rentabilidade" | "vida-util", { esquema: string; valor: unknown }> = {
    eficiencia: {
        esquema: "#/components/schemas/AnaliseEficiencia",
        valor: { quantidadeLotes: 1, mediaHoras: 48, gargalos: 0, porOperador: [{ grupo: "operador-demo", quantidadeLotes: 1, mediaHoras: 48, desvioPadraoHoras: 0, gargalo: false }], porPeriodo: [{ grupo: "2026-11", quantidadeLotes: 1, mediaHoras: 48, desvioPadraoHoras: 0, gargalo: false }], definicaoGargalo: "Grupo com tempo médio acima da média geral dos lotes concluídos." },
    },
    rentabilidade: {
        esquema: "#/components/schemas/AnaliseRentabilidade",
        valor: { quantidadeEquipamentosComRecuperacao: 1, porTipo: [{ grupo: "SERVIDOR", amostras: 1, valorMedioRecuperacao: 475 }], porEstadoFisico: [{ grupo: "DANIFICADO_GRAVE", amostras: 1, valorMedioRecuperacao: 475 }], porMarca: [{ grupo: "Marca Exemplo", amostras: 1, valorMedioRecuperacao: 475 }], porModelo: [{ grupo: "Marca Exemplo Modelo 1", amostras: 1, valorMedioRecuperacao: 475 }] },
    },
    "vida-util": {
        esquema: "#/components/schemas/AnaliseVidaUtil",
        valor: [{ equipamentoId: "DEMO-EQ-TRIAGEM-01", estadoAtual: "USADO_LEVE", dataPrevista: "2027-10-20T00:00:00.000Z", jaInservivel: false, metodo: "Regressão linear sobre estado, depreciação e falhas registradas." }],
    },
};

export async function registrarApiPublica(app: FastifyInstance): Promise<void> {
    await app.register(import("@fastify/rate-limit"), {
        max: 120,
        timeWindow: "1 minute",
        keyGenerator: request => request.headers["x-api-key"]
            ? createHash("sha256").update(String(request.headers["x-api-key"])).digest("hex")
            : request.ip,
    });

    app.get("/api/v1/public/rastreabilidade/:codigo", {
        preHandler: [autenticarChaveApi, exigirPermissaoApi("rastreabilidade:read")],
        schema: {
            ...esquemaApiKey("Consultar rastreabilidade", "Busca equipamento por ID ou código de barras. O parâmetro codigo é o identificador do equipamento."),
            params: { type: "object", required: ["codigo"], properties: { codigo: { type: "string", minLength: 1, description: "ID ou código de barras interno do equipamento.", example: "DEMO-EQ-RECEBIDO-01" } } },
            response: {
                ...esquemaApiKey("", "").response,
                200: respostaComExemplo("Equipamento, lote e histórico de movimentações.", "#/components/schemas/RastreabilidadePublica", {
                    id: "DEMO-EQ-RECEBIDO-01", codigoBarrasInterno: "DEMO-EQ-RECEBIDO-01", tipo: "NOTEBOOK", marca: "Marca Exemplo", modelo: "Modelo 1", estadoFisico: "BOM_ESTADO", statusRastreamento: "AGUARDANDO_TRIAGEM",
                    lote: { id: "DEMO-LOTE-RECEBIDO", statusProcessamento: "RECEBIDO", dataEntrada: "2026-11-20T12:00:00.000Z", triagemConcluidaEm: null }, movimentacoes: [],
                }),
                404: exemploErro("Equipamento não encontrado.", "Equipamento não encontrado."),
            },
        },
    }, async (request, reply) => {
        const { codigo } = request.params as { codigo: string };
        const item = await prisma.equipamento.findFirst({
            where: { OR: [{ id: codigo }, { codigoBarrasInterno: codigo }], ativo: true },
            select: {
                id: true, codigoBarrasInterno: true, tipo: true, marca: true, modelo: true, estadoFisico: true, statusRastreamento: true,
                lote: { select: { id: true, statusProcessamento: true, dataEntrada: true, triagemConcluidaEm: true } },
                movimentacoes: { orderBy: { dataHora: "asc" }, select: { dataHora: true, origem: true, destino: true, responsavel: true, observacao: true } },
            },
        });
        if (!item) return reply.code(404).send({ erro: "Equipamento não encontrado." });
        return item;
    });

    app.post("/api/v1/public/lotes", {
        preHandler: [autenticarChaveApi, exigirPermissaoApi("lotes:write")],
        schema: {
            ...esquemaApiKey("Submeter lote", "Envia lote com um ou mais equipamentos. A data de entrada é definida pelo servidor; a organização precisa estar ativa e ter contrato vigente."),
            body: materializarEsquema("#/components/schemas/LotePublicoEntrada"),
            response: {
                ...esquemaApiKey("", "").response,
                201: respostaComExemplo("Lote recebido.", "#/components/schemas/LotePublicoResposta", {
                    id: "PARC-LOTE-001", dataEntrada: "2026-11-22T12:00:00.000Z", organizacaoId: "DEMO-ORG-ATIVA", notaFiscal: "NF-2026-001", transportadora: "Transportadora Exemplo", statusProcessamento: "RECEBIDO", observacoes: "", ativo: true, versao: 1,
                    equipamentos: [{ id: "PARC-EQ-001", codigoBarrasInterno: "PARC-EQ-001", tipo: "NOTEBOOK", marca: "Exemplo", modelo: "E14", anoFabricacao: 2023, estadoFisico: "USADO_LEVE", pesoQuilogramas: "2.100", loteId: "PARC-LOTE-001", posicaoNoLote: 1, statusRastreamento: "AGUARDANDO_TRIAGEM", ativo: true, versao: 1 }],
                }),
                400: exemploErro("Dados inválidos.", "Informe os campos obrigatórios e ao menos um equipamento válido."),
                404: exemploErro("Organização inexistente ou inativa.", "Organização não encontrada ou inativa."),
                409: exemploErro("Organização sem contrato vigente ou identificador duplicado.", "A organização não possui contrato vigente ou o lote/equipamento já existe."),
            },
        },
    }, async (request, reply) => {
        try { return reply.code(201).send(await publicApiService.submeterLote(request.body as Parameters<typeof publicApiService.submeterLote>[0])); }
        catch (error) {
            if (error instanceof ErroApiPublica) return reply.code(error.statusCode).send({ erro: error.message });
            throw error;
        }
    });

    for (const name of ["eficiencia", "rentabilidade", "vida-util"] as const) {
        const exemplo = exemplosAnalise[name];
        const nomeInterno: NomeAnalise = name === "vida-util" ? "vidaUtil" : name;
        app.get(`/api/v1/public/analises/${name}`, {
            preHandler: [autenticarChaveApi, exigirPermissaoApi("analises:read")],
            schema: {
                ...esquemaApiKey(`Análise ${name}`, "Executa a análise e registra o resultado no histórico analítico."),
                response: {
                    ...esquemaApiKey("", "").response,
                    200: respostaComExemplo("Resultado calculado e registrado.", exemplo.esquema, exemplo.valor),
                    500: exemploFastify("Falha interna ao calcular a análise.", 500, "Internal Server Error", "Erro interno inesperado."),
                },
            },
        }, () => executarAnalise(nomeInterno));
    }

    app.post("/api/v1/public/relatorios", {
        preHandler: [autenticarChaveApi, exigirPermissaoApi("analises:read")],
        schema: {
            ...esquemaApiKey("Solicitar relatório assíncrono", "Enfileira um relatório CSV ou JSON e retorna HTTP 202 com identificador para consulta por polling."),
            body: materializarEsquema("#/components/schemas/JobCriacao"),
            response: {
                ...esquemaApiKey("", "").response,
                202: respostaComExemplo("Job aceito para processamento.", "#/components/schemas/JobRelatorio", {
                    id: "b8cfc2a1-9f10-4e5b-9f2b-b0a0e2f2a001", tipo: "eficiencia", formato: "CSV", status: "PENDENTE", parametros: { analise: "eficiencia", formato: "CSV" }, tentativas: 0,
                    criadoEm: "2026-11-22T12:00:00.000Z", atualizadoEm: "2026-11-22T12:00:00.000Z", downloadUrl: "/api/v1/public/relatorios/b8cfc2a1-9f10-4e5b-9f2b-b0a0e2f2a001/download",
                }),
                400: exemploErro("Análise ou formato inválidos.", "Análise inválida. Use eficiencia, rentabilidade ou vidaUtil."),
            },
        },
    }, async (request, reply) => {
        const body = request.body as { analise: string; formato?: string };
        if (!["eficiencia", "rentabilidade", "vidaUtil"].includes(body.analise)) return reply.code(400).send({ erro: "Análise inválida." });
        const formato = (body.formato ?? "JSON").toUpperCase();
        if (formato !== "JSON" && formato !== "CSV") return reply.code(400).send({ erro: "Formato inválido. Use JSON ou CSV." });
        const job = await jobsService.criar(body.analise as NomeAnalise, formato, request.parceiroApi ?? "");
        return reply.code(202).send({ ...job, downloadUrl: `/api/v1/public/relatorios/${job.id}/download` });
    });

    app.get("/api/v1/public/relatorios/:id", {
        preHandler: [autenticarChaveApi, exigirPermissaoApi("analises:read")],
        schema: {
            ...esquemaApiKey("Consultar job", "Use o ID retornado pelo POST para acompanhar o estado; a URL de download só fica disponível quando CONCLUIDO."),
            params: { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid", description: "Identificador UUID retornado ao criar o relatório." } } },
            response: {
                ...esquemaApiKey("", "").response,
                200: respostaComExemplo("Estado do job, número de tentativas e URL de download quando disponível.", "#/components/schemas/JobRelatorio", {
                    id: "b8cfc2a1-9f10-4e5b-9f2b-b0a0e2f2a001", tipo: "eficiencia", formato: "CSV", status: "CONCLUIDO", parametros: { analise: "eficiencia", formato: "CSV" }, tentativas: 1,
                    criadoEm: "2026-11-22T12:00:00.000Z", atualizadoEm: "2026-11-22T12:00:02.000Z", downloadUrl: "/api/v1/public/relatorios/b8cfc2a1-9f10-4e5b-9f2b-b0a0e2f2a001/download",
                }),
                404: exemploErro("Job não encontrado para este parceiro.", "Job não encontrado."),
            },
        },
    }, async (request, reply) => {
        const job = await jobsService.buscar((request.params as { id: string }).id, request.parceiroApi ?? "");
        return job
            ? reply.send({ ...job, downloadUrl: job.status === "CONCLUIDO" ? `/api/v1/public/relatorios/${job.id}/download` : null })
            : reply.code(404).send({ erro: "Job não encontrado." });
    });

    app.get("/api/v1/public/relatorios/:id/download", {
        preHandler: [autenticarChaveApi, exigirPermissaoApi("analises:read")],
        schema: {
            ...esquemaApiKey("Baixar relatório", "Baixa o arquivo CSV ou JSON depois que o job atingir o estado CONCLUIDO."),
            params: { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid", description: "Identificador UUID do job concluído." } } },
            response: {
                ...esquemaApiKey("", "").response,
                200: { description: "Arquivo gerado (CSV ou JSON).", content: { "text/csv": { schema: { type: "string", example: "campo;valor\nquantidadeLotes;1" } }, "application/json": { schema: { type: "string", format: "binary", example: "{\"quantidadeLotes\":1}" } } } },
                404: exemploErro("Job não encontrado para este parceiro.", "Job não encontrado."),
                409: exemploErro("Job ainda não foi concluído.", "O relatório ainda não foi concluído."),
                410: exemploErro("Arquivo do job não está mais disponível.", "O arquivo do relatório não está disponível."),
            },
        },
    }, async (request, reply) => {
        const id = (request.params as { id: string }).id;
        const arquivo = await jobsService.arquivo(id, request.parceiroApi ?? "");
        if (arquivo.tipo === "nao-encontrado") return reply.code(404).send({ erro: "Job não encontrado." });
        if (arquivo.tipo === "nao-pronto") return reply.code(409).send({ erro: "O relatório ainda não foi concluído." });
        if (arquivo.tipo === "arquivo-ausente") return reply.code(410).send({ erro: "O arquivo do relatório não está disponível." });
        return responderDownload(reply, id, arquivo.formato, arquivo.conteudo);
    });
}
