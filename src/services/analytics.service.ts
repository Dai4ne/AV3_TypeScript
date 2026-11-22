import { linearRegression, mean, standardDeviation } from "simple-statistics";
import type { EstadoFisico } from "@prisma/client";
import { prisma } from "../database/prisma.js";

const ordemEstados: EstadoFisico[] = ["NOVO", "BOM_ESTADO", "USADO_LEVE", "USADO_MODERADO", "DANIFICADO_LEVE", "DANIFICADO_GRAVE", "INSERVIVEL"];
const arredondar = (valor: number, casas = 2) => Number(valor.toFixed(casas));

type RegistroTempo = { loteId: string; operador: string; periodo: string; horas: number };
function resumirGrupos(registros: RegistroTempo[], chave: (r: RegistroTempo) => string, mediaGeral: number) {
    const grupos = new Map<string, RegistroTempo[]>();
    for (const registro of registros) {
        const nome = chave(registro);
        grupos.set(nome, [...(grupos.get(nome) ?? []), registro]);
    }
    return [...grupos].map(([grupo, itens]) => {
        const mediaHoras = mean(itens.map(item => item.horas));
        return {
            grupo,
            quantidadeLotes: itens.length,
            mediaHoras: arredondar(mediaHoras),
            desvioPadraoHoras: arredondar(itens.length > 1 ? standardDeviation(itens.map(item => item.horas)) : 0),
            gargalo: mediaHoras > mediaGeral,
        };
    }).sort((a, b) => b.mediaHoras - a.mediaHoras);
}

export const analyticsService = {
    async eficiencia() {
        const lotes = await prisma.lote.findMany({
            where: { ativo: true, triagemConcluidaEm: { not: null } },
            select: { id: true, dataEntrada: true, triagemConcluidaEm: true, operadorTriagem: true },
        });
        const registros: RegistroTempo[] = lotes.flatMap(lote => {
            const conclusao = lote.triagemConcluidaEm;
            if (!conclusao) return [];
            const horas = (conclusao.getTime() - lote.dataEntrada.getTime()) / 3_600_000;
            if (horas < 0) return [];
            return [{
                loteId: lote.id,
                operador: lote.operadorTriagem?.trim() || "Não informado",
                periodo: `${conclusao.getUTCFullYear()}-${String(conclusao.getUTCMonth() + 1).padStart(2, "0")}`,
                horas,
            }];
        });
        const mediaGeral = registros.length ? mean(registros.map(registro => registro.horas)) : 0;
        return {
            quantidadeLotes: registros.length,
            mediaHoras: registros.length ? arredondar(mediaGeral) : null,
            gargalos: registros.filter(registro => registro.horas > mediaGeral).length,
            porOperador: resumirGrupos(registros, registro => registro.operador, mediaGeral),
            porPeriodo: resumirGrupos(registros, registro => registro.periodo, mediaGeral),
            definicaoGargalo: "Grupo com tempo médio acima da média geral dos lotes concluídos.",
        };
    },

    async rentabilidade() {
        const equipamentos = await prisma.equipamento.findMany({
            where: { ativo: true },
            select: {
                tipo: true, estadoFisico: true, marca: true, modelo: true,
                historicoValores: {
                    where: { valorRecuperacao: { not: null } },
                    orderBy: { dataHora: "desc" }, take: 1,
                    select: { valorRecuperacao: true },
                },
            },
        });
        const registros = equipamentos.flatMap(equipamento => {
            const valor = equipamento.historicoValores[0]?.valorRecuperacao;
            return valor === null || valor === undefined ? [] : [{
                tipo: equipamento.tipo, estado: equipamento.estadoFisico, marca: equipamento.marca,
                modelo: equipamento.modelo, valor: Number(valor),
            }];
        });
        const resumir = (chave: (registro: typeof registros[number]) => string) => {
            const grupos = new Map<string, number[]>();
            for (const registro of registros) {
                const nome = chave(registro);
                grupos.set(nome, [...(grupos.get(nome) ?? []), registro.valor]);
            }
            return [...grupos].map(([grupo, valores]) => ({
                grupo, amostras: valores.length, valorMedioRecuperacao: arredondar(mean(valores)),
            })).sort((a, b) => b.valorMedioRecuperacao - a.valorMedioRecuperacao);
        };
        return {
            quantidadeEquipamentosComRecuperacao: registros.length,
            porTipo: resumir(registro => registro.tipo),
            porEstadoFisico: resumir(registro => registro.estado),
            porMarca: resumir(registro => registro.marca),
            porModelo: resumir(registro => `${registro.marca} ${registro.modelo}`),
        };
    },

    async vidaUtil() {
        const equipamentos = await prisma.equipamento.findMany({
            where: { ativo: true },
            select: {
                id: true, estadoFisico: true,
                historicoValores: {
                    where: { estadoFisico: { not: null } }, orderBy: { dataHora: "asc" },
                    select: { dataHora: true, estadoFisico: true, valorEstimado: true },
                },
            },
        });
        const alvo = ordemEstados.indexOf("INSERVIVEL");
        return equipamentos.map(equipamento => {
            if (equipamento.estadoFisico === "INSERVIVEL") {
                return { equipamentoId: equipamento.id, estadoAtual: equipamento.estadoFisico, dataPrevista: null, jaInservivel: true, motivo: "O equipamento já está classificado como INSERVIVEL." };
            }
            const pontos = equipamento.historicoValores.flatMap(historico => {
                if (!historico.estadoFisico) return [];
                const estado = ordemEstados.indexOf(historico.estadoFisico);
                return estado < 0 ? [] : [[historico.dataHora.getTime(), estado] as [number, number]];
            });
            if (pontos.length < 2) {
                return { equipamentoId: equipamento.id, estadoAtual: equipamento.estadoFisico, dataPrevista: null, jaInservivel: false, motivo: "Histórico insuficiente: são necessárias ao menos duas medições com estado físico." };
            }
            const modelo = linearRegression(pontos);
            const dataMs = modelo.m > 0 ? (alvo - modelo.b) / modelo.m : NaN;
            const ultimaData = pontos[pontos.length - 1]![0];
            const dataPrevista = Number.isFinite(dataMs) && dataMs >= ultimaData ? new Date(dataMs).toISOString() : null;
            return {
                equipamentoId: equipamento.id,
                estadoAtual: equipamento.estadoFisico,
                valorEstimadoAtual: Number(equipamento.historicoValores.at(-1)?.valorEstimado ?? 0),
                dataPrevista,
                jaInservivel: false,
                metodo: "Regressão linear por mínimos quadrados sobre o índice ordinal do estado físico ao longo do tempo.",
                motivo: dataPrevista ? undefined : "A tendência histórica não indica uma data futura de chegada a INSERVIVEL.",
            };
        });
    },
};

export type NomeAnalise = "eficiencia" | "rentabilidade" | "vidaUtil";
export async function executarAnalise(nome: NomeAnalise) {
    const execucao = await prisma.execucaoAnalitica.create({ data: { analise: nome, parametros: {} } });
    try {
        const resultado = nome === "eficiencia" ? await analyticsService.eficiencia()
            : nome === "rentabilidade" ? await analyticsService.rentabilidade()
                : await analyticsService.vidaUtil();
        await prisma.execucaoAnalitica.update({
            where: { id: execucao.id },
            data: { concluidoEm: new Date(), resultado: JSON.parse(JSON.stringify(resultado)) },
        });
        return resultado;
    } catch (erro) {
        await prisma.execucaoAnalitica.update({
            where: { id: execucao.id },
            data: { concluidoEm: new Date(), resultado: { erro: String(erro) } },
        });
        throw erro;
    }
}
