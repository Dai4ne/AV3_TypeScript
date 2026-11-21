import type { FastifyInstance } from "fastify";
import { autenticar, exigirPapeis } from "../plugins/auth.js";
import { apiKeyService } from "../services/api-key.service.js";
import { executarAnalise } from "../services/analytics.service.js";
import { materializarEsquema } from "./openapi.js";

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
}
