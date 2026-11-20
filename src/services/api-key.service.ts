import { createHash, randomBytes } from "node:crypto";
import { prisma } from "../database/prisma.js";
const hash=(key:string)=>createHash("sha256").update(key).digest("hex");
export const apiKeyService={
 async criar(parceiro:string,permissoes:string[]){const chave=`gc_${randomBytes(32).toString("base64url")}`; const registro=await prisma.chaveApi.create({data:{hash:hash(chave),parceiro,permissoes}}); return {id:registro.id,parceiro,permissoes,chave};},
 listar(){return prisma.chaveApi.findMany({select:{id:true,parceiro:true,permissoes:true,ativo:true,criadaEm:true,expiraEm:true,revogadaEm:true}});},
 async revogar(id:string){return prisma.chaveApi.update({where:{id},data:{ativo:false,revogadaEm:new Date()}});},
 async rotacionar(id:string){const atual=await prisma.chaveApi.findUniqueOrThrow({where:{id}}); const nova=await this.criar(atual.parceiro,atual.permissoes); await this.revogar(id); return nova;},
};
