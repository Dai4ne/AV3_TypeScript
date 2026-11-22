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
import { esquemasOpenApi } from "./routes/openapi.js";
import { registrarApiPublica } from "./routes/public.js";
import { registrarApiInterna } from "./routes/internal.js";

// Monta o servidor, plugins E todos os grupos de rotas.
export async function criarAplicacao() {
    // `example` é metadado OpenAPI; AJV deve ignorá-lo sem afrouxar os campos de validação.
    const app = Fastify({ logger: true, ajv: { customOptions: { strict: false } } });
    await app.register(fastifyJwt, { secret: configuracao.jwtSecret });
    await app.register(fastifySwagger, {
        openapi: {
            info: { title: "GreenCode API", description: "API REST de logística reversa de eletrônicos. Integrações usam /api/v1/public com chave de API; operações internas usam /api/v1/internal com JWT. As rotas antigas da AV2 permanecem como aliases protegidos durante a transição.", version: "1.0.0" },
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
    await registrarApiInterna(app);
    await registrarRotaSaude(app);
    await registrarRotasAuth(app);
    // Mantém os caminhos da AV2 e oferece seus equivalentes internos versionados.
    await registrarRotasRelatorio(app);
    await registrarRotasUsuario(app);
    await registrarRotasOrganizacao(app);
    await registrarRotasContrato(app);
    await registrarRotasLote(app);
    await registrarRotasEquipamento(app);
    await app.register(registrarRotasRelatorio, { prefix: "/api/v1/internal" });
    await app.register(registrarRotasUsuario, { prefix: "/api/v1/internal" });
    await app.register(registrarRotasOrganizacao, { prefix: "/api/v1/internal" });
    await app.register(registrarRotasContrato, { prefix: "/api/v1/internal" });
    await app.register(registrarRotasLote, { prefix: "/api/v1/internal" });
    await app.register(registrarRotasEquipamento, { prefix: "/api/v1/internal" });
    app.addHook("onClose", async () => { await prisma.$disconnect(); });
    return app;
}
