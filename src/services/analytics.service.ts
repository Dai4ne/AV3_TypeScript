import { linearRegression, mean, standardDeviation } from "simple-statistics";
import { prisma } from "../database/prisma.js";

export const analyticsService = {
  async eficiencia() {
    const lotes = await prisma.lote.findMany({ where: { ativo: true, triagemConcluidaEm: { not: null } }, select: { id: true, dataEntrada: true, triagemConcluidaEm: true, operadorTriagem: true } });
    const registros = lotes.map(l => ({ loteId:l.id, operador:l.operadorTriagem, mes:l.triagemConcluidaEm!.getUTCMonth()+1, horas:(l.triagemConcluidaEm!.getTime()-l.dataEntrada.getTime())/3600000 }));
    const grupos = (chave: (r: typeof registros[number]) => string) => {
      const agrupados = new Map<string, typeof registros>();
      for (const registro of registros) { const grupo=chave(registro); agrupados.set(grupo,[...(agrupados.get(grupo)??[]),registro]); }
      return [...agrupados].map(([grupo,itens])=>({grupo,lotes:itens.length,mediaHoras:Number(mean(itens.map(i=>i.horas)).toFixed(2)),desvioHoras:Number((itens.length>1?standardDeviation(itens.map(i=>i.horas)):0).toFixed(2))}));
    };
    return { quantidadeLotes:registros.length, mediaHoras:registros.length?Number(mean(registros.map(r=>r.horas)).toFixed(2)):null, porOperador:grupos(r=>r.operador??"Não informado"), porMes:grupos(r=>String(r.mes).padStart(2,"0")), observacao:"Gargalos são períodos ou operadores acima da média geral." };
  },
  async rentabilidade() {
    const items=await prisma.equipamento.findMany({where:{ativo:true},include:{historicoValores:{where:{valorRecuperacao:{not:null}},orderBy:{dataHora:"desc"},take:1}}});
    const rows=items.filter(x=>x.historicoValores[0]).map(x=>({estado:x.estadoFisico,marca:x.marca,modelo:x.modelo,valor:Number(x.historicoValores[0]!.valorRecuperacao)}));
    const grupos=(fn:(x:typeof rows[number])=>string)=>{const agrupados=new Map<string,typeof rows>();for(const row of rows){const chave=fn(row);agrupados.set(chave,[...(agrupados.get(chave)??[]),row]);}return [...agrupados].map(([grupo,x])=>({grupo,amostras:x.length,valorMedio:Number(mean(x.map(y=>y.valor)).toFixed(2))}));};
    return { porEstado:grupos(x=>x.estado), porMarca:grupos(x=>x.marca), porModelo:grupos(x=>`${x.marca} ${x.modelo}`) };
  },
  async vidaUtil() {
    const items=await prisma.equipamento.findMany({where:{ativo:true},include:{historicoValores:{orderBy:{dataHora:"asc"}}}});
    return items.map(x=>{ const points=x.historicoValores.map(h=>[h.dataHora.getTime(),Number(h.valorEstimado)] as [number,number]); if(points.length<2)return {equipamentoId:x.id,projecao:null,motivo:"Histórico insuficiente (mínimo 2 medições)."}; const model=linearRegression(points); const valorAtual=points.at(-1)![1]; const alvo=valorAtual*0.1; const instante=model.m?((alvo-model.b)/model.m):NaN; return {equipamentoId:x.id,projecao:Number.isFinite(instante)&&model.m<0?new Date(instante).toISOString():null,valorEstimadoAtual:valorAtual,estado:x.estadoFisico}; });
  },
};

export async function executarAnalise(nome:string) {
  const exec=await prisma.execucaoAnalitica.create({data:{analise:nome,parametros:{}}});
  try { const resultado=nome==="eficiencia"?await analyticsService.eficiencia():nome==="rentabilidade"?await analyticsService.rentabilidade():await analyticsService.vidaUtil(); await prisma.execucaoAnalitica.update({where:{id:exec.id},data:{concluidoEm:new Date(),resultado:JSON.parse(JSON.stringify(resultado))}}); return resultado; }
  catch(e) { await prisma.execucaoAnalitica.update({where:{id:exec.id},data:{concluidoEm:new Date(),resultado:{erro:String(e)}}}); throw e; }
}
