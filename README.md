# <div align='center'> 🌿GreenCode — AV3 </div>

API REST da continuação do GreenCode da <a href='https://github.com/Dai4ne/AV2_TypeScript'> AV2</a> (que por sua vez continua a <a href='https://github.com/Dai4ne/AV1_TypeScript'> AV1</a>), feita com TypeScript, Fastify, Prisma e PostgreSQL. A AV3 parte do código completo da AV2 e acrescenta a camada analítica, a API pública e o processamento assíncrono.

O sistema controla logística reversa de eletrônicos: usuários com papéis, organizações, contratos, lotes, equipamentos, movimentações e relatórios. A documentação interativa fica em `/docs` (Swagger UI). O roteiro de requisições manuais está em `tests/requests.http`.

Os dados da AV1 **não** são importados. A AV3 começa com os mesmos registros fictícios criados pelo seed da AV2 (`DEMO-`).

## 📃Sumário

1. [Ferramentas necessárias](#ferramentas-necessárias)
2. [Instalar as ferramentas](#instalar-as-ferramentas)
3. [Preparar o PostgreSQL](#preparar-o-postgresql)
4. [Configurar e subir o projeto](#configurar-e-subir-o-projeto)
5. [Rodar no Linux](#rodar-no-linux)
6. [Usar o Swagger](#usar-o-swagger)
7. [Usar o `tests/requests.http`](#usar-o-testsrequestshttp)
8. [Operações disponíveis](#operações-disponíveis)
9. [Relatórios](#relatórios)
10. [Controle de concorrência (`versao`)](#controle-de-concorrência-versao)
11. [Comandos úteis](#comandos-úteis)
12. [Problemas comuns](#problemas-comuns)
13. [API pública e análises AV3](#api-pública-e-análises-av3)
14. [Fila e worker de relatórios](#fila-e-worker-de-relatórios)
15. [Relatório técnico da AV3](#relatório-técnico-da-av3)

## 🔧Ferramentas necessárias

| Ferramenta | Versão mínima | Para que serve |
| --- | --- | --- |
| [Git](https://git-scm.com/) | qualquer recente | clonar o repositório |
| [Node.js](https://nodejs.org/) | **20 ou superior** (recomendado **20 LTS** ou **22 LTS**) | executar a API |
| npm | vem com o Node.js | instalar dependências e rodar scripts |
| [PostgreSQL](https://www.postgresql.org/download/) | **14 ou superior** | banco de dados |
| Editor (VS Code, Cursor ou similar) | — | editar código e enviar o roteiro HTTP |
| Extensão [REST Client](https://marketplace.visualstudio.com/items?itemName=humao.rest-client) (`humao.rest-client`) | — | executar `tests/requests.http` |

Navegador qualquer (Chrome, Firefox, Edge) para abrir o Swagger em `http://localhost:3000/docs`.

Não é obrigatório Docker. Prisma Studio (`npm run db:studio`) é opcional e abre uma tela das tabelas.

<Br>

## 🔧Instalar as ferramentas

### 🪟Windows

1. Instale o [Node.js LTS](https://nodejs.org/). No instalador, deixe marcada a opção de adicionar ao `PATH`.
2. Instale o [PostgreSQL](https://www.postgresql.org/download/windows/). Anote a senha do usuário `postgres` e a porta (padrão `5432`).
3. Instale o [Git](https://git-scm.com/download/win) se ainda não tiver.
4. Confira no PowerShell ou no Prompt:

       node -v
       npm -v
       psql --version
       git --version

   Se `psql` não for encontrado, use o **SQL Shell (psql)** do menu Iniciar ou adicione a pasta `bin` do PostgreSQL ao `PATH` (exemplo: `C:\Program Files\PostgreSQL\16\bin`).

### 🐧Linux (Ubuntu/Debian)

       sudo apt update
       sudo apt install -y git curl ca-certificates
       curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
       sudo apt install -y nodejs postgresql postgresql-contrib
       sudo systemctl enable --now postgresql
       node -v
       npm -v
       psql --version

Compatibilidade-alvo: Windows 10 ou superior, Ubuntu 24.04.3 ou superior e distribuições Linux derivadas do Ubuntu. Em outras distribuições, instale Node.js 20+ e PostgreSQL 14+ pelos gerenciadores da distro. No Linux, o motor do Prisma também precisa das bibliotecas OpenSSL do sistema (em Ubuntu costumam vir com `ca-certificates` / `libssl`).

O workflow `.github/workflows/compatibilidade.yml` valida o schema Prisma e compila o projeto em Windows Server 2022 e Ubuntu 24.04 a cada push ou pull request. Ele não precisa de conexão ativa com PostgreSQL; a validação ponta a ponta da aplicação ainda requer o banco local.

<br>

## 🐘Preparar o PostgreSQL

1. Inicie o serviço, se ainda não estiver em execução.

   - Windows: serviços do Windows → **postgresql**, ou reinicie o computador após a instalação.
   - Linux:

         sudo systemctl start postgresql

2. Abra o `psql` como superusuário.

   - Windows (SQL Shell): aceite host `localhost`, porta `5432`, usuário `postgres` e informe a senha definida na instalação.
   - Linux:

         sudo -u postgres psql

3. Crie o banco e, se quiser, um usuário só para o projeto (troque `senha_local`):

       CREATE DATABASE greencode;
       CREATE USER greencode WITH PASSWORD 'senha_local';
       GRANT ALL PRIVILEGES ON DATABASE greencode TO greencode;

   No PostgreSQL 15+, também conceda permissão no schema `public` depois de conectar no banco:

       \c greencode
       GRANT ALL ON SCHEMA public TO greencode;
       ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO greencode;
       ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO greencode;

   Se preferir usar o usuário `postgres` já existente, pule a criação de usuário e aponte `DATABASE_URL` para ele.

4. Saia com `\q`.

Para conferir se o banco existe:

       psql -U postgres -h localhost -c "\l"

<br>

## 🧱Configurar e subir o projeto

Faça estes passos na pasta raiz do repositório (onde está o `package.json`).

1. Instale as dependências:

       npm install

2. Copie o arquivo de exemplo de ambiente:

       cp .env.example .env

   No PowerShell do Windows:

       Copy-Item .env.example .env

3. Edite o `.env`. Os campos são estes:

   | Variável | Obrigatório | Significado |
   | --- | --- | --- |
   | `DATABASE_URL` | sim | conexão Prisma/PostgreSQL |
   | `JWT_SECRET` | sim | chave do token; **mínimo 32 caracteres** |
   | `HOST` | não (padrão `127.0.0.1`) | endereço em que a API escuta |
   | `PORT` | não (padrão `3000`) | porta da API |
   | `ADMIN_USER` | sim para o seed | login do primeiro administrador |
   | `ADMIN_PASSWORD` | sim para o seed | senha do primeiro administrador |
   | `REPORTS_DIR` | não | destino dos arquivos CSV/JSON (padrão `data/reports`) |
   | `REPORT_WORKER_CONCURRENCY` | não | jobs processados em paralelo pelo worker PostgreSQL (padrão `2`) |
   | `REPORT_WORKER_POLL_MS` | não | intervalo entre consultas de jobs (padrão `1000`) |
   | `REPORT_JOB_MAX_ATTEMPTS` | não | tentativas totais antes de falha final (padrão `5`) |
   | `REPORT_JOB_LOCK_TIMEOUT_MS` | não | lease do worker para recuperação após parada inesperada (padrão `600000`) |

   Exemplo (troque senha, chave JWT e senha do admin):

       DATABASE_URL="postgresql://postgres:senha_local@localhost:5432/greencode?schema=public"
       JWT_SECRET="troque-esta-chave-por-uma-chave-local-com-mais-de-32-caracteres"
       HOST="127.0.0.1"
       PORT="3000"
       ADMIN_USER=admin
       ADMIN_PASSWORD=troque-por-uma-senha-segura

   Formato de `DATABASE_URL`: `postgresql://USUARIO:SENHA@HOST:PORTA/BANCO?schema=public`.

   Se a senha do PostgreSQL tiver caracteres especiais (`@`, `#`, `%`, `/`), codifique-os na URL (por exemplo `@` vira `%40`).

   `ADMIN_USER` e `ADMIN_PASSWORD` são usados **somente no seed** para criar o primeiro administrador. A senha fica no banco com hash e salt. Troque os valores de exemplo. Se já existir um administrador ativo, o seed **não** recria nem altera a senha.

4. Aplique as migrações que já vêm no repositório e gere o Prisma Client:

       npx prisma migrate deploy
       npm run db:generate

   Em desenvolvimento, `npm run db:migrate` também aplica migrações pendentes e gera o client. Use esse comando se você **alterar** `prisma/schema.prisma` e precisar criar uma migração nova (o Prisma pede um nome). **Não** rode `npm run db:migrate -- --name inicial` de novo neste repositório: a migração inicial já existe em `prisma/migrations`.

5. Crie o administrador inicial e os dados demonstrativos:

       npm run db:seed

   O seed cria o administrador (se ainda não houver um ativo) e inclui organizações, contratos, lotes, equipamentos e movimentações fictícios, cobrindo status e contrato expirado. Os IDs de demonstração começam com `DEMO-`. Executar o seed de novo atualiza esses `DEMO-` e não apaga cadastros feitos depois (por exemplo os `HTTP-` do roteiro).

6. Inicie a API em modo desenvolvimento (recarrega ao salvar arquivos):

       npm run dev

   A API fica em `http://127.0.0.1:3000` (ou no `HOST`/`PORT` do `.env`). Encerre com `Ctrl+C`.

7. Confira a saúde (não exige login):

       curl http://127.0.0.1:3000/health

   Resposta esperada: `{"status":"ok","banco":"conectado"}` (campos equivalentes). Se o PostgreSQL estiver parado, a rota responde erro interno.

Para produção local, depois do `npm run dev` funcionar:

       npm run build
       npm start

`npm start` executa o JavaScript gerado em `dist/` e **não** recarrega sozinho ao editar o código.

## API pública e análises AV3

Rotas públicas v1 usam `X-API-Key`; rotas internas usam JWT e permissões de usuário. Um administrador gerencia chaves em `/api/v1/internal/chaves`. O segredo é exibido uma vez e o banco guarda apenas seu hash. Permissões: `rastreabilidade:read`, `lotes:write` e `analises:read`; limite padrão: 120 requisições por minuto por chave. A API está versionada em `/api/v1`; versões antigas terão aviso de remoção com pelo menos 90 dias.

- `GET /api/v1/public/rastreabilidade/:codigo`
- `POST /api/v1/public/lotes`
- `GET /api/v1/public/analises/eficiencia|rentabilidade|vida-util`
- `POST /api/v1/public/relatorios` com `{ "analise": "eficiencia", "formato": "CSV" }` (formato opcional: `JSON` ou `CSV`; retorna 202 e ID); `GET /api/v1/public/relatorios/:id` consulta o status; `GET /api/v1/public/relatorios/:id/download` baixa o arquivo quando concluído.
- `GET /api/v1/internal/analises/{eficiencia,rentabilidade,vida-util}` (JWT)

As análises medem tempo de triagem por operador/período, recuperação média por tipo/estado/marca/modelo e projeção de vida útil por regressão linear. A projeção combina estado físico, valor e falhas; os critérios e limitações estão em [RELATORIO_TECNICO_AV3.md](RELATORIO_TECNICO_AV3.md). A biblioteca usada é `simple-statistics`.

As análises também rodam diariamente às 02:00 (`America/Sao_Paulo`). Execuções e resultados ficam persistidos para consulta em `/api/v1/internal/analises/historico`; previsões podem ser comparadas ao registro real de `INSERVIVEL` em `/api/v1/internal/analises/vida-util/comparacoes`.

`ExecucaoAnalitica` guarda resultados; `HistoricoValorEquipamento` e `FalhaEquipamento` registram dados para as análises. `JobRelatorio` armazena estado, parceiro, resultado e tentativas.

## Fila e worker de relatórios

O worker usa PostgreSQL como fila, sem exigir Redis. Inicie `npm run dev` e `npm run worker` em terminais separados. O `POST /api/v1/public/relatorios` retorna um ID; consulte o status e baixe o arquivo quando estiver `CONCLUIDO`. Há até cinco tentativas com backoff exponencial; falhas finais ficam na dead-letter (`/api/v1/internal/relatorios/dead-letter`). Os arquivos ficam em `data/reports`.

### Verificação automatizada da AV3

Para demonstrar os principais caminhos da AV3, rode `scripts/demonstrar-av3.ps1` no PowerShell. Ele executa as chamadas HTTP e informa os status esperados.

#### Preparação e execução do script de avaliação

1. Confirme que PostgreSQL está ligado, migrations e seed foram aplicados. Abra terminais PowerShell na raiz do projeto. Inicie a API:

   ```powershell
   npm run dev
   ```

2. Em outro terminal, inicie o worker:

   ```powershell
   npm run worker
   ```

   Deixe API e worker ativos. Em um terceiro terminal, execute:

   ```powershell
   .\scripts\demonstrar-av3.ps1
   ```

3. Informe usuário e senha de administrador quando solicitado. A senha fica oculta. O padrão é `http://127.0.0.1:3000`; para outra porta, defina `API_BASE_URL`, por exemplo:

   ```powershell
   $env:API_BASE_URL = "http://127.0.0.1:3001"
   .\scripts\demonstrar-av3.ps1
   ```

4. Aguarde a conclusão dos relatórios (até 180 segundos cada). A mensagem `TODOS OS FLUXOS AV3 PASSARAM` confirma sucesso; falhas são listadas e retornam código de erro.

O script cobre autenticação, chaves e permissões, rastreabilidade, envio de lotes, análises e histórico, limite de requisições, isolamento de parceiros e relatórios JSON/CSV. Ao final, tenta remover os dados temporários e revoga as chaves; jobs e arquivos gerados ficam registrados.

Para rodar apenas um grupo de verificações, os scripts individuais continuam disponíveis:

```powershell
.\scripts\verificar-api-publica.ps1
.\scripts\verificar-analises.ps1
.\scripts\verificar-relatorios.ps1
```

Os verificadores individuais cobrem API pública, análises e relatórios. Mantenha API e, para relatórios, worker ativos; falhas encerram o script com código de erro.

## Relatório técnico da AV3

O Swagger (`/docs`) descreve parâmetros, exemplos e erros. O [relatório técnico](RELATORIO_TECNICO_AV3.md) detalha estatística, modelagem, retries, versionamento e opções de escala.

<br>

## 🐧Rodar no Linux

Os passos são os mesmos da seção anterior. Pontos específicos:

- Use `cp .env.example .env` e um editor (`nano .env`, `vim .env` ou o VS Code).
- Garanta que o PostgreSQL aceite conexão em `localhost:5432`. Se `DATABASE_URL` usar o usuário `postgres` e a autenticação for `peer` (comum no Ubuntu), crie um usuário com senha como na seção do banco, ou ajuste `pg_hba.conf` para `md5`/`scram-sha-256` em conexões TCP. A forma mais simples para desenvolvimento é um usuário com senha e `DATABASE_URL` apontando para `localhost`.
- Mantenha `HOST=127.0.0.1` para aceitar só a máquina local. Use `HOST=0.0.0.0` somente se precisar acessar a API de outro computador na rede.
- Caminhos e maiúsculas/minúsculas importam (`tests/requests.http`, não `Tests/Requests.HTTP`).
- Se o Prisma falhar ao baixar o motor nativo, instale as libs SSL da distro e rode de novo `npm install` / `npx prisma generate`.

<br>

## 📗Usar o Swagger

Com a API no ar (`npm run dev`):

1. Abra [http://localhost:3000/docs](http://localhost:3000/docs) no navegador. Essa é a interface Swagger UI.
2. A especificação OpenAPI também fica em [http://localhost:3000/docs/json](http://localhost:3000/docs/json) (JSON) e [http://localhost:3000/docs/yaml](http://localhost:3000/docs/yaml) (YAML).
3. No Swagger, as rotas internas usam **JWT de usuário**; as rotas versionadas públicas usam **chave de API do parceiro**. `GET /health` e `POST /auth/login` não exigem credencial. JWT e chave de API são credenciais diferentes e não substituem uma à outra.

### Autorizar chamadas internas com JWT

1. Faça login:
   - Expanda **autenticação** → `POST /auth/login` → **Try it out**.
   - Corpo de exemplo (use `ADMIN_USER` e `ADMIN_PASSWORD` do `.env`):

         {
           "usuario": "admin",
           "senha": "troque-por-uma-senha-segura"
         }

   - Clique em **Execute**.
   - Na resposta `200`, copie o valor de `token`.
2. Clique em **Authorize**, cole o token no campo **bearerAuth** (sem `Bearer`) e confirme. Use JWT em `/api/v1/internal/*`; o token dura 30 minutos. `401` indica token inválido/ausente e `403` falta de papel.

### Autorizar chamadas públicas com chave de API

1. Com JWT de administrador, abra **API interna v1** → `POST /api/v1/internal/chaves` → **Try it out** e envie:

   ```json
   {
     "parceiro": "Parceiro de demonstração",
     "permissoes": ["rastreabilidade:read", "lotes:write", "analises:read"]
   }
   ```

   Na resposta `201`, copie o campo `chave` (ele só é exibido uma vez). Em **Authorize**, cole-a em **apiKeyAuth**. As rotas públicas enviam `X-API-Key`. Use `rastreabilidade:read`, `lotes:write` ou `analises:read` conforme a operação.

`401`: credencial ausente/inválida; `403`: permissão insuficiente; `404`: recurso inexistente ou de outro parceiro; `409`: conflito; `429`: limite excedido.

Com JWT, rotacione em `POST /api/v1/internal/chaves/{id}/rotacionar` ou revogue em `DELETE /api/v1/internal/chaves/{id}`. O segredo novo aparece uma vez; atualize o **apiKeyAuth**.

Escolha uma rota, clique em **Try it out** e **Execute** para ver status e resposta. A segurança indicada na operação mostra qual credencial usar; `demonstrar-av3.ps1` automatiza os mesmos principais fluxos.

No Swagger, ao atualizar, alterar status, inativar, reativar ou excluir, envie a `versao` atual (veja [Controle de concorrência](#controle-de-concorrência-versao)). No cadastro de equipamento, envie `versaoLote`.
Para testar outro papel nas rotas internas que permitem esse papel, faça login com essa conta (depois de criá-la como administrador) e substitua o token no **bearerAuth**. Para testar permissões públicas, crie uma chave contendo só a permissão que deseja validar e use-a em **apiKeyAuth**.

<br>

## 👨‍💻Papéis
- O `ADMINISTRADOR` acessa todas as rotas protegidas.
- O `OPERADOR` de cadastro gerencia organizações e contratos.
- O `GESTOR` de almoxarifado gerencia lotes e equipamentos.
- O `AUDITOR` consulta rastreamento, movimentações e relatórios. 

Os `RELATÓRIOS` também aceitam operador, gestor, auditor e administrador.

<br>

## 📋Usar o `tests/requests.http`

O seed e o roteiro HTTP têm funções diferentes: o seed prepara o administrador e os exemplos `DEMO-`; o arquivo `tests/requests.http` envia chamadas à API. Os cadastros do roteiro usam IDs `HTTP-` e nomes `http_`, então não substituem nem se confundem com os `DEMO-`.

### Extensão e variáveis

1. No VS Code ou no Cursor, instale a extensão **REST Client** (`humao.rest-client`).
2. Rode o seed e deixe a API no ar (`npm run db:seed` se ainda não rodou, depois `npm run dev`).
3. Abra `tests/requests.http`.
4. No início do arquivo, alinhe as variáveis com o seu ambiente:

       @url = http://localhost:3000
       @admin = admin
       @senhaAdmin = troque_por_sua_senha

   `@admin` e `@senhaAdmin` precisam ser iguais a `ADMIN_USER` e `ADMIN_PASSWORD` do `.env`. Se a porta no `.env` não for `3000`, ajuste `@url`.
5. Cada bloco começa com `###`. Clique em **Send Request** acima do bloco.
6. Envie **na ordem**. Vários pedidos reutilizam o token e IDs de respostas anteriores (`# @name loginAdmin`, `{{loginAdmin.response.body.$.token}}`, `{{criarOrg.response.body.$.versao}}`, etc.). Pular um sucesso quebra os seguintes.
7. Os títulos indicam o status esperado (`sucesso 200`, `erro 401`, `erro 409`, …). Um dos erros de lote usa `DEMO-ORG-CONTRATO-EXPIRADO` e por isso depende do seed.

Login **NÃO** cria uma sessão global: cada pedido usa o `Authorization` escrito nele. Depois de `loginAdmin`, `loginOperador`, `loginGestor` e `loginAuditor`, os blocos seguintes já apontam para o token certo.

Um pedido de `GET /health` está marcado para erro `500`: ele só falha se o PostgreSQL estiver parado. Não pare o banco no meio do roteiro; use esse caso à parte, se quiser demonstrar a falha, e religue o PostgreSQL em seguida.

### Repetir o roteiro

Os registros `HTTP-` permanecem no banco. Rodar o seed de novo **não** os apaga. Para recomeçar com os mesmos IDs:

1. Pare o servidor (`Ctrl+C`).
2. Confira no `.env` que `DATABASE_URL` aponta para o banco **local** de desenvolvimento.
3. Execute:

       npx prisma migrate reset

4. Confirme. **O reset apaga todos os dados desse banco**, reaplica as migrações e, se o Prisma estiver configurado para seed no `package.json`, pode tentar o seed; neste projeto o seed é o script `npm run db:seed`, então rode-o de novo depois:

       npm run db:seed

5. Suba a API e envie o `requests.http` do começo.

Como alternativa, altere os IDs (`HTTP-ORG-001`, …) e os nomes de usuário (`http_operador_001`, …) no arquivo antes de repetir, para não colidir com o que já existe.

<br>

## 📖Operações disponíveis

- **Usuários:** cadastrar, consultar, listar todos os ativos ou filtrar por papel (`GET /usuarios/papel/{papel}`), alterar nome/papel, inativar e reativar. A própria pessoa pode trocar a senha (envie `senhaAtual` e `senha`); administrador pode redefinir senhas (envie só `senha`) e gerenciar contas. Não é permitido rebaixar ou inativar o último administrador ativo. Senhas e hashes nunca voltam nas respostas.
- **Organizações:** cadastrar, consultar, listar, atualizar CNPJ e dados, inativar e reativar. E-mails são normalizados (minúsculas) e não podem ser repetidos. Inativar ou reativar uma organização também inativa ou reativa seus lotes e equipamentos vinculados.
- **Contratos:** cadastrar, consultar, listar, atualizar e excluir definitivamente. Cada organização pode ter no máximo um contrato. A organização precisa estar ativa para cadastrar contrato.
- **Lotes:** cadastrar, consultar com equipamentos, listar, atualizar, inativar, reativar e alterar manualmente o status. Só é permitido cadastrar lote para organização ativa com contrato vigente. Inativar ou reativar lote também inativa ou reativa seus equipamentos; para reativar o lote, a organização precisa estar ativa.
- **Equipamentos:** cadastrar, consultar, listar, atualizar, alterar status e excluir definitivamente. O ID do equipamento também é seu código de barras. A exclusão definitiva remove as movimentações vinculadas. Alterações do estado físico ficam na observação do histórico, incluindo a justificativa quando informada. Piora de duas ou mais categorias no estado físico exige `justificativa`.
- **Movimentações:** registrar e consultar no histórico do equipamento. O histórico é somente de acréscimo. As respostas incluem `dataHora` (instante no banco, com fuso) e `dataHoraBrasilia` (`America/Sao_Paulo`).

### Status do lote (AV2)

O responsável altera manualmente `RECEBIDO`, `EM_TRIAGEM`, `ENCAMINHADO` e `FINALIZADO`. `TRIAGEM_CONCLUIDA` é atribuído automaticamente quando todos os equipamentos ativos do lote chegam a `BAIXA_DEFINITIVA`. Não é permitido definir `TRIAGEM_CONCLUIDA` na mão, nem alterar manualmente um lote já concluído dessa forma.

<br>

## 📝Relatórios

Acesso: operador de cadastro, gestor de almoxarifado, auditor e administrador.

- `GET /relatorios/organizacoes/{organizacaoId}?dataInicio=...&dataFim=...`: quantidade e lista de lotes da organização no período.
- `GET /relatorios/status?status=...`: quantidade de equipamentos ativos em um status de rastreamento.
- `GET /relatorios/financeiro?dataInicio=...&dataFim=...`: contratos vigentes que se sobrepõem ao período e soma de seus valores mensais.
- `GET /lotes/periodo?dataInicio=...&dataFim=...`: lotes ativos recebidos no período.
- `GET /lotes/{id}/relatorio-triagem`: quantidade de equipamentos ativos, peso total e distribuição por status.

Datas no formato ISO-8601, por exemplo `2026-01-01T00:00:00.000Z`. Período invertido (`dataInicio` depois de `dataFim`) retorna `400`.

<br>

## 🎚️Controle de concorrência (`versao`)

Organizações, contratos, lotes e equipamentos têm o campo `versao`, iniciado em `1`. As consultas devolvem esse número. Ao atualizar, alterar status, inativar, reativar ou excluir, envie a versão recebida na consulta ou na resposta da operação anterior. Ao cadastrar equipamento, envie `versaoLote` com a versão atual do lote. Se outra requisição já alterou o registro, a API responde `409 Conflict`; consulte de novo e reaplique a mudança.

- `PUT` e alterações de status/reativação recebem `versao` no JSON.
- `DELETE` recebe `?versao=NUMERO` na URL.
- `POST /equipamentos` recebe `versaoLote` junto com o `loteId`.
- Inativação/reativação em cadeia também aumenta a versão dos lotes/equipamentos afetados.

Exemplo: se `GET /lotes/LOTE-01` retorna `"versao": 3`, envie `"versao": 3` no JSON do `PUT /lotes/LOTE-01`.

<br>

## 💻Comandos úteis

| Comando | Função |
| --- | --- |
| `npm install` | instala dependências |
| `npm run dev` | sobe a API com recarga (`tsx watch`) |
| `npm run build` | compila TypeScript para `dist/` |
| `npm start` | executa `dist/server.js` |
| `npx prisma migrate deploy` | aplica migrações já existentes no repositório |
| `npm run db:migrate` | migrações em desenvolvimento (pode criar uma nova) |
| `npm run db:generate` | gera o Prisma Client depois de mudar o schema |
| `npm run db:validate` | valida `prisma/schema.prisma` |
| `npm run db:format` | formata o schema Prisma |
| `npm run db:studio` | interface visual das tabelas (em geral `http://localhost:5555`) |
| `npm run db:seed` | administrador inicial (se faltar) e dados `DEMO-` |
| `npx prisma migrate reset` | **apaga** o banco apontado por `DATABASE_URL`, reaplica migrações |

<br>

## 🚨Problemas comuns

| Sintoma | O que conferir |
| --- | --- |
| `JWT_SECRET` / “pelo menos 32 caracteres” | o `.env` existe na raiz, a chave tem 32+ caracteres, e você reiniciou `npm run dev` depois de editar |
| Falha de conexão Prisma / `P1000` / `P1001` | PostgreSQL no ar, `DATABASE_URL` com usuário/senha/porta/banco certos, banco `greencode` criado |
| `P2021` (tabela não existe) | rode `npx prisma migrate deploy` |
| Seed pede `ADMIN_USER` / `ADMIN_PASSWORD` | as duas variáveis estão no `.env` |
| Login `401` no Swagger ou no HTTP | usuário/senha iguais aos do seed; se o admin já existia, o seed não muda a senha |
| `401` depois de meia hora | token expirado; faça login de novo |
| `403` | papel sem permissão naquela rota |
| `409` em atualização | versão desatualizada; faça GET e envie a `versao` nova |
| Roteiro HTTP quebra no meio | pedidos fora de ordem, ou IDs `HTTP-` já existentes; reset + seed, ou troque os IDs |
| Porta 3000 em uso | mude `PORT` no `.env` e o `@url` do `requests.http` |
| Swagger abre mas as rotas protegidas falham | Authorize com o token puro, sem prefixo `Bearer ` |
