import { createHash, randomBytes } from "node:crypto";
import { prisma } from "../database/prisma.js";
const hash=(key:string)=>createHash("sha256").update(key).digest("hex");
const permissoesPermitidas=new Set(["rastreabilidade:read","lotes:write","analises:read"]);
export const apiKeyService={
 async criar(parceiro:string,permissoes:string[]){if(!parceiro?.trim())throw new Error("Nome do parceiro é obrigatório.");if(!Array.isArray(permissoes)||permissoes.length===0||permissoes.some(p=>!permissoesPermitidas.has(p)))throw new Error("Informe ao menos uma permissão válida.");const permissoesUnicas=[...new Set(permissoes)];const chave=`gc_${randomBytes(32).toString("base64url")}`; const registro=await prisma.chaveApi.create({data:{hash:hash(chave),parceiro:parceiro.trim(),permissoes:permissoesUnicas}}); return {id:registro.id,parceiro:registro.parceiro,permissoes:registro.permissoes,chave};},
 listar(){return prisma.chaveApi.findMany({select:{id:true,parceiro:true,permissoes:true,ativo:true,criadaEm:true,expiraEm:true,revogadaEm:true}});},
 async revogar(id:string){return prisma.chaveApi.update({where:{id},data:{ativo:false,revogadaEm:new Date()}});},
 async rotacionar(id:string){return prisma.$transaction(async tx=>{const atual=await tx.chaveApi.findUnique({where:{id}});if(!atual)throw new Error("Chave não encontrada.");const chave=`gc_${randomBytes(32).toString("base64url")}`;const registro=await tx.chaveApi.create({data:{hash:hash(chave),parceiro:atual.parceiro,permissoes:atual.permissoes}});await tx.chaveApi.update({where:{id},data:{ativo:false,revogadaEm:new Date()}});return {id:registro.id,parceiro:registro.parceiro,permissoes:registro.permissoes,chave};});},
};
