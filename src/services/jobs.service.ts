import {Queue,Worker} from "bullmq";
import { Redis } from "ioredis";
import {prisma} from "../database/prisma.js";
import {executarAnalise} from "./analytics.service.js";
const connectionString=process.env.REDIS_URL;
let queue:Queue|undefined;
if(connectionString){const connection=new Redis(connectionString,{maxRetriesPerRequest:null});queue=new Queue("relatorios",{connection});if(process.env.RUN_REPORT_WORKER==="true")new Worker("relatorios",async job=>{const jobId=String(job.data.jobId);await prisma.jobRelatorio.update({where:{id:jobId},data:{status:"EM_PROCESSAMENTO",tentativas:{increment:1}}});try{const resultado=await executarAnalise(String(job.data.analise));await prisma.jobRelatorio.update({where:{id:jobId},data:{status:"CONCLUIDO",resultado:JSON.parse(JSON.stringify(resultado)),erro:null}});return resultado;}catch(error){if(job.attemptsMade+1>=Number(job.opts.attempts??1))await prisma.jobRelatorio.update({where:{id:jobId},data:{status:"FALHOU",erro:String(error)}});throw error;}},{connection});}
export const jobsService={
 async criar(analise:string){const job=await prisma.jobRelatorio.create({data:{tipo:analise,parametros:{analise}}});if(queue)await queue.add("analise",{analise,jobId:job.id},{jobId:job.id,attempts:5,backoff:{type:"exponential",delay:1000},removeOnComplete:100,removeOnFail:false});else void (async()=>{try{await prisma.jobRelatorio.update({where:{id:job.id},data:{status:"EM_PROCESSAMENTO",tentativas:{increment:1}}});const resultado=await executarAnalise(analise);await prisma.jobRelatorio.update({where:{id:job.id},data:{status:"CONCLUIDO",resultado:JSON.parse(JSON.stringify(resultado))}});}catch(e){await prisma.jobRelatorio.update({where:{id:job.id},data:{status:"FALHOU",erro:String(e)}});}})();return job;},
 buscar(id:string){return prisma.jobRelatorio.findUnique({where:{id}});},
};
