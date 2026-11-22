// Respostas comuns mantêm os códigos HTTP documentados de forma consistente.
export function respostas(
    sucesso: string,
    descricao: string,
    codigo = 200,
    erros: number[] = [400, 401, 403, 404, 409, 500],
) {
    const resultado: Record<string, unknown> = {};
    resultado[codigo] = codigo === 204
        ? { description: descricao }
        : { description: descricao, content: { "application/json": { schema: materializarEsquema(sucesso) } } };

    const mensagens: Record<number, string> = {
        400: "Requisição inválida ou regra de negócio não atendida.",
        401: "Token ausente, inválido ou expirado; ou credenciais inválidas.",
        403: "O papel do usuário não permite esta operação.",
        404: "Registro não encontrado ou inativo.",
        409: "Conflito de dados, como duplicidade ou versão desatualizada.",
        500: "Erro interno inesperado.",
    };
    for (const codigoErro of erros) {
        resultado[codigoErro] = {
            description: mensagens[codigoErro],
            content: { "application/json": { schema: materializarEsquema("#/components/schemas/Erro") } },
        };
    }
    return resultado as any;
}

export const esquemasOpenApi = {
    ChaveApiCriada: { type:"object", required:["id","parceiro","permissoes","chave"], properties:{id:{type:"string",format:"uuid"},parceiro:{type:"string",example:"Parceiro Exemplo"},permissoes:{type:"array",items:{type:"string",enum:["rastreabilidade:read","lotes:write","analises:read"]}},chave:{type:"string",description:"Exibida somente na criação ou rotação.",example:"gc_exemplo"}} },
    LotePublicoEntrada: { type:"object",additionalProperties:false,required:["id","organizacaoId","notaFiscal","transportadora","equipamentos"],example:{id:"PARC-LOTE-001",organizacaoId:"DEMO-ORG-ATIVA",notaFiscal:"NF-2026-001",transportadora:"Transportadora Exemplo",equipamentos:[{id:"PARC-EQ-001",tipo:"NOTEBOOK",marca:"Exemplo",modelo:"E14",anoFabricacao:2023,estadoFisico:"USADO_LEVE",pesoQuilogramas:2.1}]},properties:{id:{type:"string",example:"PARC-LOTE-001",description:"Identificador único do lote no sistema parceiro."},organizacaoId:{type:"string",example:"DEMO-ORG-ATIVA",description:"Identificador de uma organização com contrato vigente."},notaFiscal:{type:"string",example:"NF-2026-001"},transportadora:{type:"string",example:"Transportadora Exemplo"},equipamentos:{type:"array",minItems:1,items:{type:"object",required:["id","tipo","marca","modelo","anoFabricacao","estadoFisico","pesoQuilogramas"],properties:{id:{type:"string",example:"PARC-EQ-001"},tipo:{type:"string",enum:["COMPUTADOR_MESA","NOTEBOOK","MONITOR","IMPRESSORA","SERVIDOR","ROTEADOR","CABO_ESTRUTURADO","FONTE_ALIMENTACAO"]},marca:{type:"string",example:"Exemplo"},modelo:{type:"string",example:"E14"},anoFabricacao:{type:"integer",minimum:1900,example:2023},estadoFisico:{type:"string",enum:["NOVO","BOM_ESTADO","USADO_LEVE","USADO_MODERADO","DANIFICADO_LEVE","DANIFICADO_GRAVE","INSERVIVEL"]},pesoQuilogramas:{type:"number",exclusiveMinimum:0,example:2.1}}}}} },
    RastreabilidadePublica: { type:"object",required:["id","tipo","marca","modelo","estadoFisico","statusRastreamento","lote","movimentacoes"],properties:{id:{type:"string",example:"DEMO-EQ-RECEBIDO-01"},codigoBarrasInterno:{type:"string",example:"DEMO-EQ-RECEBIDO-01"},tipo:{type:"string",example:"NOTEBOOK"},marca:{type:"string",example:"Marca Exemplo"},modelo:{type:"string",example:"Modelo 1"},estadoFisico:{type:"string",example:"BOM_ESTADO"},statusRastreamento:{type:"string",example:"AGUARDANDO_TRIAGEM"},lote:{type:"object",example:{id:"DEMO-LOTE-RECEBIDO",statusProcessamento:"RECEBIDO",dataEntrada:"2026-11-20T12:00:00.000Z",triagemConcluidaEm:null}},movimentacoes:{type:"array",items:{type:"object"},example:[]}} },
    AnaliseEficiencia: { type:"object",example:{quantidadeLotes:1,mediaHoras:48,gargalos:0,porOperador:[{grupo:"operador-demo",quantidadeLotes:1,mediaHoras:48,desvioPadraoHoras:0,gargalo:false}],porPeriodo:[{grupo:"2026-11",quantidadeLotes:1,mediaHoras:48,desvioPadraoHoras:0,gargalo:false}],definicaoGargalo:"Grupo com tempo médio acima da média geral dos lotes concluídos."}} ,
    AnaliseRentabilidade: { type:"object",example:{quantidadeEquipamentosComRecuperacao:1,porTipo:[{grupo:"SERVIDOR",amostras:1,valorMedioRecuperacao:475}],porEstadoFisico:[{grupo:"DANIFICADO_GRAVE",amostras:1,valorMedioRecuperacao:475}],porMarca:[{grupo:"Marca Exemplo",amostras:1,valorMedioRecuperacao:475}],porModelo:[{grupo:"Marca Exemplo Modelo 1",amostras:1,valorMedioRecuperacao:475}]}} ,
    AnaliseVidaUtil: { type:"array",items:{type:"object"},example:[{equipamentoId:"DEMO-EQ-TRIAGEM-01",estadoAtual:"USADO_LEVE",dataPrevista:"2027-10-20T00:00:00.000Z",jaInservivel:false,metodo:"Regressão linear com estado, depreciação e falhas"}]},
    LotePublicoResposta: { type:"object",example:{id:"PARC-LOTE-001",dataEntrada:"2026-11-22T12:00:00.000Z",organizacaoId:"DEMO-ORG-ATIVA",notaFiscal:"NF-2026-001",transportadora:"Transportadora Exemplo",statusProcessamento:"RECEBIDO",observacoes:"",ativo:true,versao:1,equipamentos:[{id:"PARC-EQ-001",codigoBarrasInterno:"PARC-EQ-001",tipo:"NOTEBOOK",marca:"Exemplo",modelo:"E14",anoFabricacao:2023,estadoFisico:"USADO_LEVE",pesoQuilogramas:"2.100",loteId:"PARC-LOTE-001",posicaoNoLote:1,statusRastreamento:"AGUARDANDO_TRIAGEM",ativo:true,versao:1}]}},
    JobCriacao: { type:"object",additionalProperties:false,required:["analise"],example:{analise:"eficiencia",formato:"CSV"},properties:{analise:{type:"string",enum:["eficiencia","rentabilidade","vidaUtil"],example:"eficiencia",description:"Análise que será executada pelo worker."},formato:{type:"string",enum:["JSON","CSV"],default:"JSON",example:"CSV",description:"Formato do arquivo de saída."}} },
    JobRelatorio: { type:"object",required:["id","tipo","formato","status","parametros","tentativas","criadoEm","atualizadoEm","downloadUrl"],example:{id:"b8cfc2a1-9f10-4e5b-9f2b-b0a0e2f2a001",tipo:"eficiencia",formato:"CSV",status:"PENDENTE",parametros:{analise:"eficiencia",formato:"CSV"},tentativas:0,criadoEm:"2026-11-22T12:00:00.000Z",atualizadoEm:"2026-11-22T12:00:00.000Z",downloadUrl:null},properties:{id:{type:"string",format:"uuid"},tipo:{type:"string"},formato:{type:"string",enum:["JSON","CSV"]},status:{type:"string",enum:["PENDENTE","EM_PROCESSAMENTO","CONCLUIDO","FALHOU"]},parametros:{type:"object"},tentativas:{type:"integer"},erro:{type:"string",nullable:true},criadoEm:{type:"string",format:"date-time"},atualizadoEm:{type:"string",format:"date-time"},downloadUrl:{type:"string",nullable:true}} },
    Erro429: { type:"object",required:["statusCode","error","message"],properties:{statusCode:{type:"integer",example:429},error:{type:"string",example:"Too Many Requests"},message:{type:"string"}} },
    Erro: { oneOf: [{ $ref: "#/components/schemas/ErroDominio" }, { $ref: "#/components/schemas/ErroFastify" }] },
    ErroDominio: {
        type: "object", additionalProperties: false, required: ["erro"], example:{erro:"Dados inválidos ou permissão insuficiente."},
        properties: { erro: { type: "string", description: "Mensagem de validação, regra de negócio, autenticação ou conflito.",example:"Dados inválidos ou permissão insuficiente." } },
    },
    ErroFastify: {
        type: "object", required: ["statusCode", "error", "message"], example:{statusCode:429,error:"Too Many Requests",message:"Rate limit exceeded, retry in 1 minute"},
        properties: { statusCode: { type: "integer",example:429 }, error: { type: "string",example:"Too Many Requests" }, message: { type: "string",example:"Rate limit exceeded, retry in 1 minute" } },
    },
    Mensagem: {
        type: "object", required: ["mensagem"], properties: { mensagem: { type: "string" } },
    },
    Usuario: {
        type: "object", required: ["id", "usuario", "papel", "criadoEm", "ativo"],
        properties: {
            id: { type: "string", format: "uuid" }, usuario: { type: "string" },
            ultimoAcesso: { type: "string", format: "date-time", nullable: true },
            papel: { type: "string", enum: ["ADMINISTRADOR", "OPERADOR_CADASTRO", "GESTOR_ALMOXARIFADO", "AUDITOR"] },
            criadoEm: { type: "string", format: "date-time" }, ativo: { type: "boolean" },
        },
    },
    Organizacao: {
        type: "object", required: ["id", "razaoSocial", "cnpj", "inscricaoEstadual", "enderecoCompleto", "telefone", "email", "dataCadastro", "ativo", "versao"],
        properties: {
            id: { type: "string" }, razaoSocial: { type: "string" }, cnpj: { type: "string" },
            inscricaoEstadual: { type: "string" }, enderecoCompleto: { type: "string" }, telefone: { type: "string" },
            email: { type: "string", format: "email" }, dataCadastro: { type: "string", format: "date-time" },
            ativo: { type: "boolean" }, versao: { type: "integer", minimum: 1, description: "Número usado para detectar alterações simultâneas." },
        },
    },
    Contrato: {
        type: "object", required: ["id", "organizacaoId", "dataAssinatura", "dataVencimento", "clausulas", "valorMensal", "renovacaoAutomatica", "versao"],
        properties: {
            id: { type: "string", format: "uuid" }, organizacaoId: { type: "string" },
            dataAssinatura: { type: "string", format: "date-time" }, dataVencimento: { type: "string", format: "date-time" },
            clausulas: { type: "array", items: { type: "string" } }, valorMensal: { type: "string", description: "Valor decimal em formato textual." },
            renovacaoAutomatica: { type: "boolean" }, versao: { type: "integer", minimum: 1 },
        },
    },
    Lote: {
        type: "object", required: ["id", "dataEntrada", "organizacaoId", "notaFiscal", "transportadora", "statusProcessamento", "observacoes", "ativo", "versao"],
        properties: {
            id: { type: "string" }, dataEntrada: { type: "string", format: "date-time" }, organizacaoId: { type: "string" },
            notaFiscal: { type: "string" }, transportadora: { type: "string" },
            statusProcessamento: { type: "string", enum: ["RECEBIDO", "EM_TRIAGEM", "TRIAGEM_CONCLUIDA", "ENCAMINHADO", "FINALIZADO"] },
            observacoes: { type: "string" }, ativo: { type: "boolean" }, versao: { type: "integer", minimum: 1 },
            equipamentos: { type: "array", items: { $ref: "#/components/schemas/Equipamento" } },
        },
    },
    Equipamento: {
        type: "object", required: ["id", "codigoBarrasInterno", "tipo", "marca", "modelo", "anoFabricacao", "estadoFisico", "pesoQuilogramas", "loteId", "posicaoNoLote", "statusRastreamento", "ativo", "versao"],
        properties: {
            id: { type: "string" }, codigoBarrasInterno: { type: "string", description: "É igual ao ID do equipamento." },
            tipo: { type: "string", enum: ["COMPUTADOR_MESA", "NOTEBOOK", "MONITOR", "IMPRESSORA", "SERVIDOR", "ROTEADOR", "CABO_ESTRUTURADO", "FONTE_ALIMENTACAO"] },
            marca: { type: "string" }, modelo: { type: "string" }, anoFabricacao: { type: "integer" },
            estadoFisico: { type: "string", enum: ["NOVO", "BOM_ESTADO", "USADO_LEVE", "USADO_MODERADO", "DANIFICADO_LEVE", "DANIFICADO_GRAVE", "INSERVIVEL"] },
            pesoQuilogramas: { type: "string", description: "Peso decimal em formato textual." }, loteId: { type: "string" }, posicaoNoLote: { type: "integer" },
            statusRastreamento: { type: "string", enum: ["AGUARDANDO_TRIAGEM", "EM_TRIAGEM", "AGUARDANDO_DESMONTAGEM", "EM_DESMONTAGEM", "PECAS_REAPROVEITADAS", "MATERIAL_RECICLAVEL", "DESCARTE_SEGURO", "BAIXA_DEFINITIVA"] },
            ativo: { type: "boolean" }, versao: { type: "integer", minimum: 1 },
            movimentacoes: { type: "array", items: { $ref: "#/components/schemas/Movimentacao" } },
        },
    },
    Movimentacao: {
        type: "object", required: ["id", "equipamentoId", "dataHora", "origem", "destino", "responsavel", "observacao"],
        properties: {
            id: { type: "string", format: "uuid" }, equipamentoId: { type: "string" },
            dataHora: { type: "string", format: "date-time" }, dataHoraBrasilia: { type: "string" },
            origem: { type: "string" }, destino: { type: "string" }, responsavel: { type: "string" }, observacao: { type: "string" },
        },
    },
    Login: {
        type: "object", required: ["token", "tipo", "expiraEm"],
        properties: { token: { type: "string" }, tipo: { type: "string", example: "Bearer" }, expiraEm: { type: "string", example: "30 minutos" } },
    },
    RelatorioStatus: {
        type: "object", required: ["status", "quantidadeEquipamentosAtivos"],
        properties: { status: { type: "string" }, quantidadeEquipamentosAtivos: { type: "integer" } },
    },
    RelatorioOrganizacao: {
        type: "object", required: ["organizacaoId", "razaoSocial", "periodo", "quantidadeLotes", "lotes"],
        properties: {
            organizacaoId: { type: "string" }, razaoSocial: { type: "string" },
            periodo: { type: "object", required: ["inicio", "fim"], properties: { inicio: { type: "string", format: "date-time" }, fim: { type: "string", format: "date-time" } } },
            quantidadeLotes: { type: "integer" },
            lotes: { type: "array", items: { type: "object", required: ["id", "dataEntrada", "statusProcessamento"], properties: { id: { type: "string" }, dataEntrada: { type: "string", format: "date-time" }, statusProcessamento: { type: "string" } } } },
        },
    },
    RelatorioFinanceiro: {
        type: "object", required: ["periodo", "quantidadeContratos", "somaValoresMensais", "contratos"],
        properties: {
            periodo: { type: "object", required: ["inicio", "fim"], properties: { inicio: { type: "string", format: "date-time" }, fim: { type: "string", format: "date-time" } } },
            quantidadeContratos: { type: "integer" }, somaValoresMensais: { type: "number" },
            contratos: { type: "array", items: { type: "object", required: ["id", "organizacaoId", "razaoSocial", "valorMensal", "dataAssinatura", "dataVencimento"], properties: { id: { type: "string" }, organizacaoId: { type: "string" }, razaoSocial: { type: "string" }, valorMensal: { type: "number" }, dataAssinatura: { type: "string", format: "date-time" }, dataVencimento: { type: "string", format: "date-time" } } } },
        },
    },
    RelatorioTriagem: {
        type: "object", required: ["loteId", "quantidadeEquipamentos", "pesoTotalQuilogramas", "quantidadePorStatus"],
        properties: { loteId: { type: "string" }, quantidadeEquipamentos: { type: "integer" }, pesoTotalQuilogramas: { type: "number" }, quantidadePorStatus: { type: "object", additionalProperties: { type: "integer" } } },
    },
};

// Fastify usa referências próprias para serializar respostas; expandimos os componentes aqui.
export function materializarEsquema(referencia: string): any {
    const nome = referencia.split("/").pop() as keyof typeof esquemasOpenApi;
    const expandir = (valor: any): any => {
        if (Array.isArray(valor)) return valor.map(expandir);
        if (valor && typeof valor === "object") {
            if (typeof valor.$ref === "string" && valor.$ref.startsWith("#/components/schemas/")) {
                return materializarEsquema(valor.$ref);
            }
            return Object.fromEntries(Object.entries(valor).map(([chave, item]) => [chave, expandir(item)]));
        }
        return valor;
    };
    return expandir(esquemasOpenApi[nome]);
}

export function respostaLista(esquema: string, descricao: string) {
    return {
        200: { description: descricao, content: { "application/json": { schema: { type: "array", items: materializarEsquema(esquema) } } } },
        401: { description: "Token ausente, inválido ou expirado.", content: { "application/json": { schema: materializarEsquema("#/components/schemas/Erro") } } },
        403: { description: "O papel do usuário não permite esta operação.", content: { "application/json": { schema: materializarEsquema("#/components/schemas/Erro") } } },
        500: {
            description: "Erro interno inesperado.",
            content: { "application/json": { schema: materializarEsquema("#/components/schemas/Erro") } },
        },
    } as any;
}
