import { criarAplicacao } from "./app.js";
import { configuracao } from "./config/env.js";
import cron from "node-cron";
import { executarAnalise } from "./services/analytics.service.js";

// Inicializa o servidor usando os valores do arquivo .env.
const app = await criarAplicacao();
const tarefaAnalitica = cron.schedule("0 2 * * *", async () => { for (const nome of ["eficiencia", "rentabilidade", "vidaUtil"] as const) { try { await executarAnalise(nome); } catch (erro) { app.log.error(erro); } } }, { timezone: "America/Sao_Paulo" });

try {
    await app.listen({ host: configuracao.host, port: configuracao.port });
} catch (erro) {
    app.log.error(erro);
    await app.close();
    tarefaAnalitica.stop();
    process.exitCode = 1;
}

// Fecha conexões abertas quando a pessoa encerrar com Ctrl+C.
let encerrando = false;
async function encerrar(): Promise<void> {
    if (encerrando) return;
    encerrando = true;
    tarefaAnalitica.stop();
    await app.close();
}

process.once("SIGINT", () => void encerrar());
process.once("SIGTERM", () => void encerrar());
