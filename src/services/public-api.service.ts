import { Prisma } from "@prisma/client";
import type { EstadoFisico, TipoEquipamento } from "@prisma/client";
import { prisma } from "../database/prisma.js";

export class ErroApiPublica extends Error { constructor(public statusCode:number,message:string){super(message);} }
type Entrada={id:string;organizacaoId:string;notaFiscal:string;transportadora:string;equipamentos:Array<{id:string;tipo:TipoEquipamento;marca:string;modelo:string;anoFabricacao:number;estadoFisico:EstadoFisico;pesoQuilogramas:number}>};
export const publicApiService={
 async submeterLote(dados:Entrada){
  if(!dados.id?.trim()||dados.id!==dados.id.trim()||!dados.notaFiscal?.trim()||!dados.transportadora?.trim())throw new ErroApiPublica(400,"ID, nota fiscal e transportadora são obrigatórios.");
  if(!dados.equipamentos?.length)throw new ErroApiPublica(400,"Informe ao menos um equipamento no lote.");
  const ids=new Set<string>();for(const e of dados.equipamentos){if(!e.id?.trim()||e.id!==e.id.trim()||ids.has(e.id))throw new ErroApiPublica(400,"IDs de equipamento devem ser únicos e sem espaços nas extremidades.");ids.add(e.id);if(!Number.isInteger(e.anoFabricacao)||e.anoFabricacao<1900||!Number.isFinite(e.pesoQuilogramas)||e.pesoQuilogramas<=0)throw new ErroApiPublica(400,"Ano de fabricação ou peso inválido.");}
  const agora=new Date();const org=await prisma.organizacao.findUnique({where:{id:dados.organizacaoId},include:{contrato:true}});
  if(!org||!org.ativo)throw new ErroApiPublica(404,"Organização não encontrada ou inativa.");
  if(!org.contrato||org.contrato.dataAssinatura>agora||org.contrato.dataVencimento<agora)throw new ErroApiPublica(409,"A organização precisa ter contrato vigente para receber lotes.");
  try{return await prisma.lote.create({data:{id:dados.id,dataEntrada:agora,organizacaoId:org.id,notaFiscal:dados.notaFiscal.trim(),transportadora:dados.transportadora.trim(),equipamentos:{create:dados.equipamentos.map((e,posicaoNoLote)=>({...e,codigoBarrasInterno:e.id,posicaoNoLote:posicaoNoLote+1,historicoValores:{create:{estadoFisico:e.estadoFisico,valorEstimado:0,motivo:"Estado físico inicial registrado na submissão pública"}}}))}},include:{equipamentos:true}});}
  catch(error){if(error instanceof Prisma.PrismaClientKnownRequestError){if(error.code==="P2002")throw new ErroApiPublica(409,"ID de lote ou equipamento já cadastrado.");if(error.code==="P2003")throw new ErroApiPublica(404,"Organização não encontrada.");}throw error;}
 },
};
