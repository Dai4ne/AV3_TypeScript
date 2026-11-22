import "dotenv/config";
import { prisma } from "./database/prisma.js";
import { iniciarWorkerRelatorios } from "./services/jobs.service.js";

const worker = iniciarWorkerRelatorios();
console.log("Worker PostgreSQL pronto para processar JobRelatorio.");

let encerrando = false;
async function encerrar() {
    if (encerrando) return;
    encerrando = true;
    await worker.close();
    await prisma.$disconnect();
}
process.once("SIGINT", () => void encerrar());
process.once("SIGTERM", () => void encerrar());
