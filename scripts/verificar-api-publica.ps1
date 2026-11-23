$ErrorActionPreference = "Stop"
$base = "http://127.0.0.1:3000"
$admin = Read-Host "Usuário administrador: "
$senhaSegura = Read-Host "Senha do administrador: " -AsSecureString
$senha = [System.Net.NetworkCredential]::new("", $senhaSegura).Password

function Invoke-Api($method, $path, $headers = @{}, $body = $null) {
    $args = @{ Method = $method; Uri = "$base$path"; Headers = $headers; UseBasicParsing = $true }
    if ($null -ne $body) { $args.ContentType = "application/json"; $args.Body = ($body | ConvertTo-Json -Depth 8 -Compress) }
    try {
        $response = Invoke-WebRequest @args
        return [pscustomobject]@{ Status = [int]$response.StatusCode; Body = $response.Content }
    } catch {
        if ($_.Exception.Response) {
            $status = [int]$_.Exception.Response.StatusCode
            $reader = [System.IO.StreamReader]::new($_.Exception.Response.GetResponseStream())
            return [pscustomobject]@{ Status = $status; Body = $reader.ReadToEnd() }
        }
        throw
    }
}

$results = [System.Collections.Generic.List[string]]::new()
$failures = [System.Collections.Generic.List[string]]::new()
$keyIds = [System.Collections.Generic.List[string]]::new()
$lotId = "QA-HTTP-$(Get-Date -Format 'yyyyMMddHHmmss')"
$equipmentId = "$lotId-EQ"
$lotCreated = $false
$adminHeaders = @{}

function Add-Check($name, $observed, $expected) {
    $line = "$name`: HTTP $observed (esperado $expected)"
    if ([string]$observed -eq [string]$expected) { $results.Add("OK - $line") }
    else { $results.Add("FALHA - $line"); $failures.Add($line) }
}

function Remove-QATestLot($id, $headers) {
    $detailsResponse = Invoke-Api GET "/lotes/$id" $headers
    if ($detailsResponse.Status -ne 200) { throw "Não foi possível consultar o lote de teste antigo $id (HTTP $($detailsResponse.Status))." }
    $details = $detailsResponse.Body | ConvertFrom-Json
    foreach ($equipment in @($details.equipamentos)) {
        if ($null -eq $equipment) { continue }
        $removed = Invoke-Api DELETE "/equipamentos/$($equipment.id)`?versao=$($equipment.versao)" $headers
        if ($removed.Status -ne 204) { throw "Não foi possível remover o equipamento de teste $($equipment.id) (HTTP $($removed.Status))." }
    }
    $currentResponse = Invoke-Api GET "/lotes/$id" $headers
    if ($currentResponse.Status -ne 200) { throw "Não foi possível consultar a versão atual do lote $id (HTTP $($currentResponse.Status))." }
    $currentLot = $currentResponse.Body | ConvertFrom-Json
    $removedLot = Invoke-Api DELETE "/lotes/$id`?versao=$($currentLot.versao)" $headers
    if ($removedLot.Status -ne 200) { throw "Não foi possível inativar o lote de teste $id (HTTP $($removedLot.Status))." }
    $results.Add("OK - Remoção de lote de teste anterior $id")
}

try {
    $login = Invoke-Api POST "/auth/login" @{} @{ usuario = $admin; senha = $senha }
    if ($login.Status -ne 200) { throw "Login falhou (HTTP $($login.Status))." }
    $jwt = ($login.Body | ConvertFrom-Json).token
    $adminHeaders = @{ Authorization = "Bearer $jwt" }

    # Limpa resíduos de uma execução anterior que tenha sido interrompida durante a limpeza.
    $keysResponse = Invoke-Api GET "/api/v1/internal/chaves" $adminHeaders
    if ($keysResponse.Status -ne 200) { throw "Não foi possível listar as chaves para limpar resíduos (HTTP $($keysResponse.Status))." }
    $oldKeys = @($keysResponse.Body | ConvertFrom-Json | Where-Object { $_.ativo -and $_.parceiro -in @("Verificação HTTP leitura", "Verificação HTTP escrita") })
    foreach ($oldKey in $oldKeys) {
        $revoked = Invoke-Api DELETE "/api/v1/internal/chaves/$($oldKey.id)" $adminHeaders
        Add-Check "Revogar chave de teste anterior" $revoked.Status 200
    }
    $lotsResponse = Invoke-Api GET "/lotes" $adminHeaders
    if ($lotsResponse.Status -ne 200) { throw "Não foi possível listar lotes para limpar resíduos (HTTP $($lotsResponse.Status))." }
    $allLots = ConvertFrom-Json -InputObject $lotsResponse.Body
    foreach ($candidateLot in $allLots) {
        if ($null -ne $candidateLot -and $candidateLot.id -is [string] -and $candidateLot.id.StartsWith("QA-HTTP-")) {
            Remove-QATestLot -id $candidateLot.id -headers $adminHeaders
        }
    }

    $readKeyResponse = Invoke-Api POST "/api/v1/internal/chaves" $adminHeaders @{ parceiro = "Verificação HTTP leitura"; permissoes = @("rastreabilidade:read") }
    if ($readKeyResponse.Status -ne 201) { throw "Não foi possível criar a chave de leitura (HTTP $($readKeyResponse.Status))." }
    $readKey = $readKeyResponse.Body | ConvertFrom-Json
    $keyIds.Add($readKey.id)
    $writeKeyResponse = Invoke-Api POST "/api/v1/internal/chaves" $adminHeaders @{ parceiro = "Verificação HTTP escrita"; permissoes = @("lotes:write") }
    if ($writeKeyResponse.Status -ne 201) { throw "Não foi possível criar a chave de escrita (HTTP $($writeKeyResponse.Status))." }
    $writeKey = $writeKeyResponse.Body | ConvertFrom-Json
    $keyIds.Add($writeKey.id)

    $r = Invoke-Api GET "/api/v1/public/rastreabilidade/DEMO-EQ-RECEBIDO-01"
    Add-Check "Sem chave" $r.Status 401
    $r = Invoke-Api GET "/api/v1/public/rastreabilidade/DEMO-EQ-RECEBIDO-01" @{ "X-API-Key" = "gc_chave-invalida" }
    Add-Check "Chave inválida" $r.Status 401
    $readHeaders = @{ "X-API-Key" = $readKey.chave }
    $r = Invoke-Api GET "/api/v1/public/rastreabilidade/DEMO-EQ-RECEBIDO-01" $readHeaders
    Add-Check "Rastreabilidade existente" $r.Status 200
    $r = Invoke-Api GET "/api/v1/public/rastreabilidade/QA-INEXISTENTE" $readHeaders
    Add-Check "Equipamento inexistente" $r.Status 404
    $r = Invoke-Api GET "/api/v1/public/analises/eficiencia" $readHeaders
    Add-Check "Chave sem permissão de análise" $r.Status 403
    $rotation = Invoke-Api POST "/api/v1/internal/chaves/$($readKey.id)/rotacionar" $adminHeaders @{}
    Add-Check "Rotação de chave" $rotation.Status 200
    if ($rotation.Status -eq 200) {
        $rotated = $rotation.Body | ConvertFrom-Json
        $keyIds.Add($rotated.id)
        $r = Invoke-Api GET "/api/v1/public/rastreabilidade/DEMO-EQ-RECEBIDO-01" @{ "X-API-Key" = $readKey.chave }
        Add-Check "Chave antiga após rotação" $r.Status 401
        $readKey = $rotated
    }

    $payload = @{ id = $lotId; organizacaoId = "DEMO-ORG-ATIVA"; notaFiscal = "NF-$lotId"; transportadora = "Transportadora QA"; equipamentos = @(@{ id = $equipmentId; tipo = "NOTEBOOK"; marca = "QA"; modelo = "Modelo QA"; anoFabricacao = 2022; estadoFisico = "BOM_ESTADO"; pesoQuilogramas = 2.3 }) }
    $writeHeaders = @{ "X-API-Key" = $writeKey.chave }
    $r = Invoke-Api POST "/api/v1/public/lotes" $writeHeaders $payload
    Add-Check "Submissão de lote válida" $r.Status 201
    if ($r.Status -eq 201) { $lotCreated = $true }
    $r = Invoke-Api POST "/api/v1/public/lotes" $writeHeaders $payload
    Add-Check "Lote duplicado" $r.Status 409
    $expiredPayload = $payload.Clone(); $expiredPayload.id = "$lotId-EXP"; $expiredPayload.organizacaoId = "DEMO-ORG-CONTRATO-EXPIRADO"; $expiredPayload.notaFiscal = "NF-$lotId-EXP"; $expiredPayload.equipamentos = @(@{ id = "$equipmentId-EXP"; tipo = "NOTEBOOK"; marca = "QA"; modelo = "Modelo QA"; anoFabricacao = 2022; estadoFisico = "BOM_ESTADO"; pesoQuilogramas = 2.3 })
    $r = Invoke-Api POST "/api/v1/public/lotes" $writeHeaders $expiredPayload
    Add-Check "Organização com contrato expirado" $r.Status 409

    $rateStatus = 0
    for ($i = 0; $i -lt 125 -and $rateStatus -ne 429; $i++) {
        $r = Invoke-Api GET "/api/v1/public/rastreabilidade/DEMO-EQ-RECEBIDO-01" $readHeaders
        $rateStatus = $r.Status
    }
    Add-Check "Rate limit por chave" $rateStatus 429
} catch {
    $results.Add("FALHA DURANTE A VERIFICAÇÃO: $($_.Exception.Message)")
    $failures.Add($_.Exception.Message)
} finally {
    if ($lotCreated -and $adminHeaders.Authorization) {
        try {
            $equipmentResponse = Invoke-Api GET "/equipamentos/$equipmentId" $adminHeaders
            if ($equipmentResponse.Status -ne 200) { throw "Não foi possível consultar o equipamento de teste para removê-lo (HTTP $($equipmentResponse.Status))." }
            $equipment = $equipmentResponse.Body | ConvertFrom-Json
            $deleteEquipment = Invoke-Api DELETE "/equipamentos/$equipmentId`?versao=$($equipment.versao)" $adminHeaders
            if ($deleteEquipment.Status -ne 204) { throw "Não foi possível remover o equipamento de teste (HTTP $($deleteEquipment.Status))." }
            $results.Add("OK - Limpeza do equipamento de teste: HTTP 204")

            $lotResponse = Invoke-Api GET "/lotes/$lotId" $adminHeaders
            if ($lotResponse.Status -ne 200) { throw "Não foi possível consultar o lote de teste para removê-lo (HTTP $($lotResponse.Status))." }
            $lot = $lotResponse.Body | ConvertFrom-Json
            $deleteLot = Invoke-Api DELETE "/lotes/$lotId`?versao=$($lot.versao)" $adminHeaders
            if ($deleteLot.Status -ne 200) { throw "Não foi possível inativar o lote de teste (HTTP $($deleteLot.Status))." }
            $results.Add("OK - Limpeza do lote de teste: HTTP 200")
        } catch {
            $results.Add("FALHA - Limpeza dos dados de teste: $($_.Exception.Message)")
            $failures.Add($_.Exception.Message)
        }
    }
    foreach ($id in $keyIds) {
        try {
            $deleteKey = Invoke-Api DELETE "/api/v1/internal/chaves/$id" $adminHeaders
            if ($deleteKey.Status -ne 200) { throw "HTTP $($deleteKey.Status)" }
        } catch {
            $results.Add("FALHA - Revogação da chave de teste $id`: $($_.Exception.Message)")
            $failures.Add("Não foi possível revogar a chave de teste $id.")
        }
    }
    $senha = $null
    $senhaSegura.Dispose()
}

$results | ForEach-Object { Write-Output $_ }
if ($failures.Count -gt 0) { exit 1 }
Write-Output "Todas as verificações da API pública passaram."
