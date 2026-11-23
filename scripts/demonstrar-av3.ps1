# Demonstração automatizada dos principais fluxos da AV3.
# Antes de executar: PostgreSQL, API (npm run dev), worker (npm run worker) e seed ativos.
# Rode na raiz do projeto com: .\scripts\demonstrar-av3.ps1

$ErrorActionPreference = "Stop"
$base = if ($env:API_BASE_URL) { $env:API_BASE_URL.TrimEnd("/") } else { "http://127.0.0.1:3000" }
$admin = Read-Host "Usuário administrador"
$senhaSegura = Read-Host "Senha do administrador" -AsSecureString
$senha = [System.Net.NetworkCredential]::new("", $senhaSegura).Password
$resultados = [System.Collections.Generic.List[string]]::new()
$falhas = [System.Collections.Generic.List[string]]::new()
$idsChaves = [System.Collections.Generic.List[string]]::new()
$headersAdmin = @{}
$loteId = "DEMO-AV3-$(Get-Date -Format 'yyyyMMddHHmmss')"
$equipamentoId = "$loteId-EQ"
$loteCriado = $false

function Invoke-Api($method, $path, $headers = @{}, $body = $null) {
    $request = @{ Method = $method; Uri = "$base$path"; Headers = $headers; UseBasicParsing = $true }
    if ($null -ne $body) {
        $request.ContentType = "application/json"
        $request.Body = $body | ConvertTo-Json -Depth 12 -Compress
    }
    try {
        $response = Invoke-WebRequest @request
        return [pscustomobject]@{ Status = [int]$response.StatusCode; Body = [string]$response.Content; ContentType = [string]$response.Headers["Content-Type"] }
    } catch {
        if ($_.Exception.Response) {
            $response = $_.Exception.Response
            $reader = [System.IO.StreamReader]::new($response.GetResponseStream())
            return [pscustomobject]@{ Status = [int]$response.StatusCode; Body = $reader.ReadToEnd(); ContentType = [string]$response.ContentType }
        }
        throw
    }
}

function Check-Status($name, $response, [int]$expected) {
    $line = "$name`: HTTP $($response.Status) (esperado $expected)"
    if ($response.Status -ne $expected) {
        $resultados.Add("FALHA - $line")
        $falhas.Add($line)
        throw "$line. Resposta: $($response.Body)"
    }
    $resultados.Add("OK - $line")
}

function Read-JsonBody($response) {
    if ([string]::IsNullOrWhiteSpace($response.Body)) { return $null }
    return ConvertFrom-Json -InputObject $response.Body
}

function New-TestKey($partner, $permissions) {
    $response = Invoke-Api POST "/api/v1/internal/chaves" $headersAdmin @{ parceiro = $partner; permissoes = $permissions }
    Check-Status "Criar chave ($partner)" $response 201
    $key = Read-JsonBody $response
    if (-not $key.id -or -not $key.chave) { throw "A resposta da criação da chave não trouxe o ID e o segredo." }
    $idsChaves.Add([string]$key.id)
    return $key
}

try {
    Write-Output "=== GreenCode AV3: verificação automatizada ==="
    Write-Output "API: $base"

    $health = Invoke-Api GET "/health"
    Check-Status "Saúde da API e banco" $health 200

    $loginInvalido = Invoke-Api POST "/auth/login" @{} @{ usuario = $admin; senha = "senha-intencionalmente-incorreta" }
    Check-Status "Credencial inválida" $loginInvalido 401
    $login = Invoke-Api POST "/auth/login" @{} @{ usuario = $admin; senha = $senha }
    Check-Status "Login do administrador" $login 200
    $jwt = (Read-JsonBody $login).token
    if (-not $jwt) { throw "Login não retornou token JWT." }
    $headersAdmin = @{ Authorization = "Bearer $jwt" }

    $openapi = Invoke-Api GET "/docs/json"
    Check-Status "Documentação OpenAPI" $openapi 200
    if ($openapi.Body -notmatch "/api/v1/public/relatorios") { throw "OpenAPI não contém as rotas públicas de relatórios." }
    $resultados.Add("OK - OpenAPI contém os endpoints públicos AV3")

    $headersListaChaves = $headersAdmin
    $listaChaves = Invoke-Api GET "/api/v1/internal/chaves" $headersListaChaves
    Check-Status "Listagem administrativa de chaves" $listaChaves 200

    $partnerTag = "Professor AV3 $loteId"
    $keyCompleta = New-TestKey "$partnerTag completa" @("rastreabilidade:read", "lotes:write", "analises:read")
    $keyLeitura = New-TestKey "$partnerTag leitura" @("rastreabilidade:read")
    $keyOutroParceiro = New-TestKey "$partnerTag outro parceiro" @("analises:read")
    $keyRateLimit = New-TestKey "$partnerTag rate limit" @("rastreabilidade:read")

    $headersCompleta = @{ "X-API-Key" = $keyCompleta.chave }
    $headersLeitura = @{ "X-API-Key" = $keyLeitura.chave }
    $headersOutroParceiro = @{ "X-API-Key" = $keyOutroParceiro.chave }

    $semChave = Invoke-Api GET "/api/v1/public/rastreabilidade/DEMO-EQ-RECEBIDO-01"
    Check-Status "Rota pública sem chave" $semChave 401
    $chaveInvalida = Invoke-Api GET "/api/v1/public/rastreabilidade/DEMO-EQ-RECEBIDO-01" @{ "X-API-Key" = "gc-chave-invalida" }
    Check-Status "Rota pública com chave inválida" $chaveInvalida 401
    $rastreabilidade = Invoke-Api GET "/api/v1/public/rastreabilidade/DEMO-EQ-RECEBIDO-01" $headersCompleta
    Check-Status "Consultar rastreabilidade existente" $rastreabilidade 200
    $inexistente = Invoke-Api GET "/api/v1/public/rastreabilidade/AV3-NAO-EXISTE" $headersCompleta
    Check-Status "Consultar equipamento inexistente" $inexistente 404
    $semPermissao = Invoke-Api GET "/api/v1/public/analises/eficiencia" $headersLeitura
    Check-Status "Bloquear permissão de análise ausente" $semPermissao 403

    $corpoLote = @{
        id = $loteId
        organizacaoId = "DEMO-ORG-ATIVA"
        notaFiscal = "NF-$loteId"
        transportadora = "Transportadora de Avaliação"
        equipamentos = @(@{
            id = $equipamentoId; tipo = "NOTEBOOK"; marca = "AV3 QA"; modelo = "Modelo Avaliação"
            anoFabricacao = 2023; estadoFisico = "BOM_ESTADO"; pesoQuilogramas = 2.4
        })
    }
    $submissao = Invoke-Api POST "/api/v1/public/lotes" $headersCompleta $corpoLote
    Check-Status "Submeter lote válido" $submissao 201
    $loteCriado = $true
    $consultaNovo = Invoke-Api GET "/api/v1/public/rastreabilidade/$equipamentoId" $headersCompleta
    Check-Status "Rastrear equipamento recém-submetido" $consultaNovo 200
    $duplicado = Invoke-Api POST "/api/v1/public/lotes" $headersCompleta $corpoLote
    Check-Status "Rejeitar lote duplicado" $duplicado 409

    $corpoExpirado = @{
        id = "$loteId-EXP"; organizacaoId = "DEMO-ORG-CONTRATO-EXPIRADO"
        notaFiscal = "NF-$loteId-EXP"; transportadora = "Transportadora de Avaliação"
        equipamentos = @(@{
            id = "$equipamentoId-EXP"; tipo = "NOTEBOOK"; marca = "AV3 QA"; modelo = "Modelo Avaliação"
            anoFabricacao = 2023; estadoFisico = "BOM_ESTADO"; pesoQuilogramas = 2.4
        })
    }
    $contratoExpirado = Invoke-Api POST "/api/v1/public/lotes" $headersCompleta $corpoExpirado
    Check-Status "Rejeitar submissão com contrato expirado" $contratoExpirado 409

    foreach ($analysis in @("eficiencia", "rentabilidade", "vida-util")) {
        $internalAnalysis = Invoke-Api GET "/api/v1/internal/analises/$analysis" $headersAdmin
        Check-Status "Análise interna $analysis" $internalAnalysis 200
        $publicAnalysis = Invoke-Api GET "/api/v1/public/analises/$analysis" $headersCompleta
        Check-Status "Análise pública $analysis" $publicAnalysis 200
    }
    $history = Invoke-Api GET "/api/v1/internal/analises/historico?analise=vidaUtil&limite=5" $headersAdmin
    Check-Status "Histórico de execuções analíticas" $history 200
    $forecastCompare = Invoke-Api GET "/api/v1/internal/analises/vida-util/comparacoes" $headersAdmin
    Check-Status "Comparação de previsão e resultado real" $forecastCompare 200
    $deadLetter = Invoke-Api GET "/api/v1/internal/relatorios/dead-letter" $headersAdmin
    Check-Status "Consulta administrativa da dead-letter" $deadLetter 200

    foreach ($format in @("JSON", "CSV")) {
        $jobResponse = Invoke-Api POST "/api/v1/public/relatorios" $headersCompleta @{ analise = "eficiencia"; formato = $format }
        Check-Status "Criar job $format" $jobResponse 202
        $job = Read-JsonBody $jobResponse
        if (-not $job.id) { throw "Resposta do job $format sem identificador." }

        $foreignJob = Invoke-Api GET "/api/v1/public/relatorios/$($job.id)" $headersOutroParceiro
        Check-Status "Isolamento de job entre parceiros ($format)" $foreignJob 404

        $deadline = [DateTime]::UtcNow.AddSeconds(180)
        $jobState = "PENDENTE"
        while ([DateTime]::UtcNow -lt $deadline -and $jobState -in @("PENDENTE", "EM_PROCESSAMENTO")) {
            Start-Sleep -Seconds 1
            $statusResponse = Invoke-Api GET "/api/v1/public/relatorios/$($job.id)" $headersCompleta
            Check-Status "Polling do job $format" $statusResponse 200
            $jobStatus = Read-JsonBody $statusResponse
            $jobState = [string]$jobStatus.status
        }
        if ($jobState -ne "CONCLUIDO") { throw "Job $format terminou como $jobState, após aguardar até 180 segundos." }
        $resultados.Add("OK - Job $format chegou ao estado CONCLUIDO")

        $downloadPath = if ($jobStatus.downloadUrl) { [string]$jobStatus.downloadUrl } else { [string]$job.downloadUrl }
        $download = Invoke-Api GET $downloadPath $headersCompleta
        Check-Status "Download do relatório $format" $download 200
        if ($format -eq "JSON") {
            $reportJson = Read-JsonBody $download
            if ($null -eq $reportJson -or $null -eq $reportJson.quantidadeLotes) { throw "O arquivo JSON não contém quantidadeLotes." }
        } elseif ($download.Body -notmatch "campo;valor") {
            throw "O CSV não contém o cabeçalho campo;valor."
        }
        $resultados.Add("OK - Conteúdo do relatório $format válido")
    }

    $rateHeaders = @{ "X-API-Key" = $keyRateLimit.chave }
    $rateStatus = 0
    for ($attempt = 0; $attempt -lt 130 -and $rateStatus -ne 429; $attempt++) {
        $rateResponse = Invoke-Api GET "/api/v1/public/rastreabilidade/DEMO-EQ-RECEBIDO-01" $rateHeaders
        $rateStatus = $rateResponse.Status
    }
    Check-Status "Rate limit por chave" ([pscustomobject]@{ Status = $rateStatus; Body = "" }) 429

    $rotatedKeyResponse = Invoke-Api POST "/api/v1/internal/chaves/$($keyLeitura.id)/rotacionar" $headersAdmin @{}
    Check-Status "Rotacionar chave de parceiro" $rotatedKeyResponse 200
    $rotatedKey = Read-JsonBody $rotatedKeyResponse
    $idsChaves.Add([string]$rotatedKey.id)
    $oldRotatedKey = Invoke-Api GET "/api/v1/public/rastreabilidade/DEMO-EQ-RECEBIDO-01" $headersLeitura
    Check-Status "Invalidar segredo antigo após rotação" $oldRotatedKey 401
    $newRotatedKey = Invoke-Api GET "/api/v1/public/rastreabilidade/DEMO-EQ-RECEBIDO-01" @{ "X-API-Key" = $rotatedKey.chave }
    Check-Status "Usar a chave nova após rotação" $newRotatedKey 200

    $revokeKey = Invoke-Api DELETE "/api/v1/internal/chaves/$($keyOutroParceiro.id)" $headersAdmin
    Check-Status "Revogar chave de parceiro" $revokeKey 200
    $revokedKeyRequest = Invoke-Api GET "/api/v1/public/analises/eficiencia" @{ "X-API-Key" = $keyOutroParceiro.chave }
    Check-Status "Bloquear chave revogada" $revokedKeyRequest 401

    $resultados.Add("Todas as rotas e fluxos principais da AV3 foram percorridos.")
} catch {
    if ($falhas.Count -eq 0 -or $falhas[$falhas.Count - 1] -notlike "* $($_.Exception.Message)*") {
        $falhas.Add($_.Exception.Message)
    }
    $resultados.Add("FALHA - $($_.Exception.Message)")
} finally {
    if ($loteCriado -and $headersAdmin.Authorization) {
        try {
            $equipmentResponse = Invoke-Api GET "/equipamentos/$equipamentoId" $headersAdmin
            if ($equipmentResponse.Status -eq 200) {
                $equipment = Read-JsonBody $equipmentResponse
                $deleteEquipment = Invoke-Api DELETE "/equipamentos/$equipamentoId`?versao=$($equipment.versao)" $headersAdmin
                if ($deleteEquipment.Status -ne 204) { throw "HTTP $($deleteEquipment.Status) ao remover equipamento de demonstração." }
                $resultados.Add("OK - Equipamento de teste removido")
            }
            $lotResponse = Invoke-Api GET "/lotes/$loteId" $headersAdmin
            if ($lotResponse.Status -eq 200) {
                $lot = Read-JsonBody $lotResponse
                $deleteLot = Invoke-Api DELETE "/lotes/$loteId`?versao=$($lot.versao)" $headersAdmin
                if ($deleteLot.Status -ne 200) { throw "HTTP $($deleteLot.Status) ao inativar lote de demonstração." }
                $resultados.Add("OK - Lote de teste inativado")
            }
        } catch {
            $falhas.Add("Limpeza do lote de teste falhou: $($_.Exception.Message)")
            $resultados.Add("FALHA - Limpeza do lote de teste: $($_.Exception.Message)")
        }
    }
    if ($headersAdmin.Authorization) {
        foreach ($keyId in $idsChaves) {
            try {
                $revokeResponse = Invoke-Api DELETE "/api/v1/internal/chaves/$keyId" $headersAdmin
                if ($revokeResponse.Status -notin @(200, 404)) { throw "HTTP $($revokeResponse.Status)" }
            } catch {
                $falhas.Add("Não foi possível revogar a chave temporária $keyId.")
                $resultados.Add("FALHA - Revogação de chave temporária $keyId")
            }
        }
    }
    $senha = $null
    $senhaSegura.Dispose()
}

Write-Output ""
Write-Output "=== Resultado da avaliação ==="
$resultados | ForEach-Object { Write-Output $_ }
if ($falhas.Count -gt 0) {
    Write-Output "Total de falhas: $($falhas.Count)"
    exit 1
}
Write-Output "Resultado final: TODOS OS FLUXOS AV3 PASSARAM."
