import type {FastifyInstance} from "fastify";
import {createHash} from "node:crypto";
import {prisma} from "../database/prisma.js";
import {autenticarChaveApi,exigirPermissaoApi} from "../plugins/api-key.js";
import {analyticsService,executarAnalise} from "../services/analytics.service.js";
import {jobsService} from "../services/jobs.service.js";

export async function registrarApiPublica(app:FastifyInstance){
 await app.register(import("@fastify/rate-limit"),{max:120,timeWindow:"1 minute",keyGenerator:(req)=>req.headers["x-api-key"]?createHash("sha256").update(String(req.headers["x-api-key"])).digest("hex"):req.ip});
 app.get("/api/v1/public/rastreabilidade/:codigo",{preHandler:[autenticarChaveApi,exigirPermissaoApi("rastreabilidade:read")]},async(req,reply)=>{const {codigo}=req.params as {codigo:string};const item=await prisma.equipamento.findFirst({where:{OR:[{id:codigo},{codigoBarrasInterno:codigo}],ativo:true},include:{lote:{select:{id:true,statusProcessamento:true,dataEntrada:true}},movimentacoes:{orderBy:{dataHora:"asc"}}}});if(!item)return reply.code(404).send({erro:"Equipamento não encontrado."});return item;});
 app.post("/api/v1/public/lotes",{preHandler:[autenticarChaveApi,exigirPermissaoApi("lotes:write")]},async(req,reply)=>{const b=req.body as {id:string;organizacaoId:string;notaFiscal:string;transportadora:string;equipamentos?:Array<{id:string;tipo:any;marca:string;modelo:string;anoFabricacao:number;estadoFisico:any;pesoQuilogramas:number}>};const lote=await prisma.lote.create({data:{id:b.id,dataEntrada:new Date(),organizacaoId:b.organizacaoId,notaFiscal:b.notaFiscal,transportadora:b.transportadora,equipamentos:{create:(b.equipamentos??[]).map((x,i)=>({...x,codigoBarrasInterno:x.id,posicaoNoLote:i+1}))}}});return reply.code(201).send(lote);});
 for(const name of ["eficiencia","rentabilidade","vida-util"] as const)app.get(`/api/v1/public/analises/${name}`,{preHandler:[autenticarChaveApi,exigirPermissaoApi("analises:read")]},()=>executarAnalise(name==="vida-util"?"vidaUtil":name));
 app.post("/api/v1/public/relatorios",{preHandler:[autenticarChaveApi,exigirPermissaoApi("analises:read")]},async(req,reply)=>{const b=req.body as {analise:string};if(!["eficiencia","rentabilidade","vidaUtil"].includes(b.analise))return reply.code(400).send({erro:"Análise inválida."});return reply.code(202).send(await jobsService.criar(b.analise));});
 app.get("/api/v1/public/relatorios/:id",{preHandler:[autenticarChaveApi,exigirPermissaoApi("analises:read")]},async(req,reply)=>{const j=await jobsService.buscar((req.params as {id:string}).id);return j??reply.code(404).send({erro:"Job não encontrado."});});
 app.get("/api/v1/internal/analises/eficiencia",async()=>analyticsService.eficiencia());app.get("/api/v1/internal/analises/rentabilidade",async()=>analyticsService.rentabilidade());app.get("/api/v1/internal/analises/vida-util",async()=>analyticsService.vidaUtil());
}
