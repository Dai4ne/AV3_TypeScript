import { createHash } from "node:crypto";
import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from "fastify";
import { prisma } from "../database/prisma.js";

declare module "fastify" { interface FastifyRequest { parceiroApi?: string; permissoesApi?: string[] } }
export const autenticarChaveApi:preHandlerHookHandler=async(req:FastifyRequest,reply:FastifyReply)=>{
 const raw=req.headers["x-api-key"]; if(typeof raw!=="string")return reply.code(401).send({erro:"Chave de API obrigatória."});
 const row=await prisma.chaveApi.findUnique({where:{hash:createHash("sha256").update(raw).digest("hex")}});
 if(!row||!row.ativo||(row.expiraEm&&row.expiraEm<new Date()))return reply.code(401).send({erro:"Chave inválida, inativa ou expirada."});
 req.parceiroApi=row.parceiro; req.permissoesApi=row.permissoes;
};
export function exigirPermissaoApi(permissao:string):preHandlerHookHandler{return async(req,reply)=>{if(!req.permissoesApi?.includes(permissao))return reply.code(403).send({erro:"A chave não possui esta permissão."});};}
