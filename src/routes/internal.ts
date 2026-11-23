import type { FastifyInstance } from "fastify";
import { autenticar, exigirPapeis } from "../plugins/auth.js";
import { apiKeyService } from "../services/api-key.service.js";
import { executarAnalise, historicoAnaliticoService } from "../services/analytics.service.js";
import { materializarEsquema } from "./openapi.js";
import { jobsService } from "../services/jobs.service.js";

const permissoes = ["rastreabilidade:read", "lotes:write", "analises:read"];

export async function registrarApiInterna(app: FastifyInstance): Promise<void> {
    const admin = {
        preHandler: [autenticar, exigirPapeis("ADMINISTRADOR")],
        schema: {
            tags: ["API interna v1"],
            security: [{ bearerAuth: [] }],
            response: {
                401: { description: "JWT ausente, inválido ou expirado." },
                403: { description: "Apenas administradores." },
            },
        },
    };

    app.post("/api/v1/internal/chaves", {
        ...admin,
        schema: {
            ...admin.schema,
            summary: "Criar chave de parceiro",
            description: "A chave completa é retornada uma única vez.",
            body: {
                type: "object", additionalProperties: false, required: ["parceiro", "permissoes"],
                properties: {
                    parceiro: { type: "string", minLength: 1, example: "Parceiro Exemplo" },
                    permissoes: { type: "array", minItems: 1, uniqueItems: true, items: { type: "string", enum: permissoes } },
                },
            },
            response: {
                ...admin.schema.response,
                201: { description: "Chave criada.", content: { "application/json": { schema: materializarEsquema("#/components/schemas/ChaveApiCriada") } } },
                400: { description: "Parceiro ou permissões inválidas." },
            },
        },
    }, async (request, reply) => {
        const body = request.body as { parceiro: string; permissoes: string[] };
        try { return reply.code(201).send(await apiKeyService.criar(body.parceiro, body.permissoes)); }
        catch (error) { return reply.code(400).send({ erro: error instanceof Error ? error.message : "Dados inválidos." }); }
    });

    app.get("/api/v1/internal/chaves", {
        ...admin,
        schema: { ...admin.schema, summary: "Listar chaves", description: "Lista metadados; nunca retorna hash ou segredo." },
    }, () => apiKeyService.listar());

    app.delete("/api/v1/internal/chaves/:id", {
        ...admin,
        schema: {
            ...admin.schema, summary: "Revogar chave",
            params: { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } },
            response: { ...admin.schema.response, 200: { description: "Chave revogada." }, 404: { description: "Chave inexistente." } },
        },
    }, async (request, reply) => {
        try { return await apiKeyService.revogar((request.params as { id: string }).id); }
        catch { return reply.code(404).send({ erro: "Chave não encontrada." }); }
    });

    app.post("/api/v1/internal/chaves/:id/rotacionar", {
        ...admin,
        schema: {
            ...admin.schema, summary: "Rotacionar chave",
            description: "Cria uma nova chave com as mesmas permissões e revoga a atual.",
            params: { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } },
            response: {
                ...admin.schema.response,
                200: { description: "Nova chave; o segredo é exibido somente nesta resposta.", content: { "application/json": { schema: materializarEsquema("#/components/schemas/ChaveApiCriada") } } },
                404: { description: "Chave inexistente." },
            },
        },
    }, async (request, reply) => {
        try { return await apiKeyService.rotacionar((request.params as { id: string }).id); }
        catch { return reply.code(404).send({ erro: "Chave não encontrada." }); }
    });

    const analises = [
        ["eficiencia", "Eficiência operacional"],
        ["rentabilidade", "Rentabilidade por equipamento"],
        ["vida-util", "Projeção de vida útil"],
    ] as const;
    for (const [rota, nome] of analises) {
        const chaveAnalise = rota === "vida-util" ? "vidaUtil" : rota;
        app.get(`/api/v1/internal/analises/${rota}`, {
            ...admin,
            schema: { ...admin.schema, summary: nome, description: "Requer JWT de administrador; registra a execução analítica." },
        }, () => executarAnalise(chaveAnalise));
    }

    app.get("/api/v1/internal/analises/historico", {
        ...admin,
        schema: {
            ...admin.schema,
            summary: "Consultar execuções analíticas",
            description: "Lista execuções e resultados persistidos, da mais recente para a mais antiga.",
            querystring: {
                type: "object", additionalProperties: false,
                properties: {
                    analise: { type: "string", enum: ["eficiencia", "rentabilidade", "vidaUtil"] },
                    limite: { type: "integer", minimum: 1, maximum: 100, default: 20 },
                },
            },
        },
    }, async request => {
        const query = request.query as { analise?: string; limite?: number };
        return historicoAnaliticoService.execucoes(query.analise, query.limite ?? 20);
    });

    app.get("/api/v1/internal/analises/vida-util/comparacoes", {
        ...admin,
        schema: {
            ...admin.schema,
            summary: "Consultar previsões versus resultados reais",
            description: "Cada previsão mantém data calculada, data real de INSERVIVEL quando observada e erro em dias (real menos previsto).",
            querystring: {
                type: "object", additionalProperties: false,
                properties: { equipamentoId: { type: "string", minLength: 1 } },
            },
        },
    }, async request => {
        const query = request.query as { equipamentoId?: string };
        return historicoAnaliticoService.comparacoesVidaUtil(query.equipamentoId);
    });

    app.get("/api/v1/internal/relatorios/dead-letter", {
        ...admin,
        schema: { ...admin.schema, summary: "Inspecionar relatórios esgotados", description: "Lista até 100 jobs falhos persistidos no PostgreSQL.", response: { ...admin.schema.response, 200: { description: "Jobs esgotados; estes registros formam a dead-letter." } } },
    }, async (_request, reply) => {
        return reply.send(await jobsService.listarDeadLetter());
    });
}
//71 75 65