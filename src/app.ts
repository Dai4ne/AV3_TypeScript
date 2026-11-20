import Fastify from "fastify";
import fastifyJwt from "@fastify/jwt";
import fastifySwagger from "@fastify/swagger";
import fastifySwaggerUi from "@fastify/swagger-ui";
import { configuracao } from "./config/env.js";
import { prisma } from "./database/prisma.js";
import { registrarRotaSaude } from "./routes/health.js";
import { registrarRotasOrganizacao } from "./routes/organizacoes.js";
import { registrarRotasLote } from "./routes/lotes.js";
import { registrarRotasContrato } from "./routes/contratos.js";
import { registrarRotasEquipamento } from "./routes/equipamentos.js";
import { registrarRotasUsuario } from "./routes/usuarios.js";
import { registrarRotasAuth } from "./routes/auth.js";
import { registrarRotasRelatorio } from "./routes/relatorios.js";
import { esquemasOpenApi, materializarEsquema } from "./routes/openapi.js";
import { registrarApiPublica } from "./routes/public.js";
import { apiKeyService } from "./services/api-key.service.js";
import { autenticar, exigirPapeis } from "./plugins/auth.js";

// Monta o servidor, plugins E todos os grupos de rotas.
export async function criarAplicacao() {
    const app = Fastify({ logger: true });
    await app.register(fastifyJwt, { secret: configuracao.jwtSecret });
    await app.register(fastifySwagger, {
        openapi: {
            info: { title: "GreenCode API", description: "API REST de logística reversa de eletrônicos. Rotas protegidas exigem JWT Bearer. O administrador acessa todas as rotas protegidas; os demais papéis seguem as permissões descritas em cada grupo.", version: "1.0.0" },
            components: {
                securitySchemes: { bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" }, apiKeyAuth: { type:"apiKey",in:"header",name:"X-API-Key",description:"Chave individual do parceiro. Permissões: rastreabilidade:read, lotes:write, analises:read." } },
                schemas: esquemasOpenApi as any,
            },
            tags: [
                { name: "autenticação", description: "Login e emissão de token JWT, válido por 30 minutos." },
                { name: "saúde", description: "Verifica disponibilidade da API e conexão PostgreSQL." },
                { name: "usuários", description: "Administração de contas; somente o administrador gerencia contas, e cada usuário pode trocar sua senha." },
                { name: "organizações", description: "Operações de organizações; operador de cadastro e administrador." },
                { name: "contratos", description: "Operações de contratos; operador de cadastro e administrador." },
                { name: "lotes", description: "Operações de lotes; gestor de almoxarifado e administrador." },
                { name: "equipamentos", description: "Cadastro e rastreamento; gestor de almoxarifado e administrador. Auditor pode consultar." },
                { name: "movimentações", description: "Histórico de movimentações; gestor registra, gestor e auditor consultam." },
                { name: "relatórios", description: "Relatórios de lotes, status, triagem e contratos; todos os papéis operacionais e administrador." },
                { name: "API pública v1", description: "Integração de parceiros via X-API-Key; limite padrão de 120 requisições por minuto por chave." },
                { name: "API interna v1", description: "Análises e administração de chaves protegidas por JWT de administrador." },
            ],
            security: [{ bearerAuth: [] }],
        },
    });
    await app.register(fastifySwaggerUi, { routePrefix: "/docs" });
    await registrarApiPublica(app);
    const admin={preHandler:[autenticar,exigirPapeis("ADMINISTRADOR")],schema:{tags:["API interna v1"],security:[{bearerAuth:[]}],response:{401:{description:"JWT ausente, inválido ou expirado."},403:{description:"Apenas administradores."}}}};
    app.post("/api/v1/internal/chaves", { ...admin,schema:{...admin.schema,summary:"Criar chave de parceiro",description:"Permissões aceitas: rastreabilidade:read, lotes:write, analises:read. A chave completa é retornada uma única vez.",body:{type:"object",additionalProperties:false,required:["parceiro","permissoes"],properties:{parceiro:{type:"string",minLength:1,example:"Parceiro Exemplo"},permissoes:{type:"array",minItems:1,uniqueItems:true,items:{type:"string",enum:["rastreabilidade:read","lotes:write","analises:read"]}}}},response:{...admin.schema.response,201:{description:"Chave criada.",content:{"application/json":{schema:materializarEsquema("#/components/schemas/ChaveApiCriada")}}}}} }, async (request,reply) => { const body=request.body as {parceiro:string;permissoes:string[]}; return reply.code(201).send(await apiKeyService.criar(body.parceiro,body.permissoes)); });
    app.get("/api/v1/internal/chaves", { ...admin,schema:{...admin.schema,summary:"Listar chaves",description:"Lista metadados sem revelar hashes ou segredos."} }, () => apiKeyService.listar());
    app.delete("/api/v1/internal/chaves/:id", { ...admin,schema:{...admin.schema,summary:"Revogar chave",params:{type:"object",required:["id"],properties:{id:{type:"string",format:"uuid"}}},response:{...admin.schema.response,200:{description:"Chave revogada."},404:{description:"Chave inexistente."}}} }, (request) => apiKeyService.revogar((request.params as {id:string}).id));
    app.post("/api/v1/internal/chaves/:id/rotacionar", { ...admin,schema:{...admin.schema,summary:"Rotacionar chave",description:"Cria uma nova chave com as mesmas permissões e revoga a atual.",params:{type:"object",required:["id"],properties:{id:{type:"string",format:"uuid"}}},response:{...admin.schema.response,200:{description:"Nova chave; o segredo é exibido somente nesta resposta.",content:{"application/json":{schema:materializarEsquema("#/components/schemas/ChaveApiCriada")}}},404:{description:"Chave inexistente."}}} }, (request) => apiKeyService.rotacionar((request.params as {id:string}).id));
    await registrarRotaSaude(app);
    await registrarRotasAuth(app);
    await registrarRotasRelatorio(app);
    await registrarRotasUsuario(app);
    await registrarRotasOrganizacao(app);
    await registrarRotasContrato(app);
    await registrarRotasLote(app);
    await registrarRotasEquipamento(app);
    app.addHook("onClose", async () => { await prisma.$disconnect(); });
    return app;
}
