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
$keyIds = [System.Collections.Generic.List[string]]::new()
$lotId = "QA-HTTP-$(Get-Date -Format 'yyyyMMddHHmmss')"
$equipmentId = "$lotId-EQ"
$lotCreated = $false
try {
    $login = Invoke-Api POST "/auth/login" @{} @{ usuario = $admin; senha = $senha }
    if ($login.Status -ne 200) { throw "Login falhou (HTTP $($login.Status))." }
    $jwt = ($login.Body | ConvertFrom-Json).token
    $adminHeaders = @{ Authorization = "Bearer $jwt" }

    $readKeyResponse = Invoke-Api POST "/api/v1/internal/chaves" $adminHeaders @{ parceiro = "Verificação HTTP leitura"; permissoes = @("rastreabilidade:read") }
    $writeKeyResponse = Invoke-Api POST "/api/v1/internal/chaves" $adminHeaders @{ parceiro = "Verificação HTTP escrita"; permissoes = @("lotes:write") }
    if ($readKeyResponse.Status -ne 201 -or $writeKeyResponse.Status -ne 201) { throw "Não foi possível criar as chaves de verificação." }
    $readKey = $readKeyResponse.Body | ConvertFrom-Json
    $writeKey = $writeKeyResponse.Body | ConvertFrom-Json
    $keyIds.Add($readKey.id); $keyIds.Add($writeKey.id)

    $r = Invoke-Api GET "/api/v1/public/rastreabilidade/DEMO-EQ-RECEBIDO-01"
    $results.Add("Sem chave: HTTP $($r.Status) (esperado 401)")
    $r = Invoke-Api GET "/api/v1/public/rastreabilidade/DEMO-EQ-RECEBIDO-01" @{ "X-API-Key" = "gc_chave-invalida" }
    $results.Add("Chave inválida: HTTP $($r.Status) (esperado 401)")
    $readHeaders = @{ "X-API-Key" = $readKey.chave }
    $r = Invoke-Api GET "/api/v1/public/rastreabilidade/DEMO-EQ-RECEBIDO-01" $readHeaders
    $results.Add("Rastreabilidade existente: HTTP $($r.Status) (esperado 200)")
    $r = Invoke-Api GET "/api/v1/public/rastreabilidade/QA-INEXISTENTE" $readHeaders
    $results.Add("Equipamento inexistente: HTTP $($r.Status) (esperado 404)")
    $r = Invoke-Api GET "/api/v1/public/analises/eficiencia" $readHeaders
    $results.Add("Chave sem permissão de análise: HTTP $($r.Status) (esperado 403)")
    $rotation = Invoke-Api POST "/api/v1/internal/chaves/$($readKey.id)/rotacionar" $adminHeaders @{}
    $results.Add("Rotação de chave: HTTP $($rotation.Status) (esperado 200)")
    if ($rotation.Status -eq 200) {
        $rotated = $rotation.Body | ConvertFrom-Json
        $keyIds.Add($rotated.id)
        $r = Invoke-Api GET "/api/v1/public/rastreabilidade/DEMO-EQ-RECEBIDO-01" @{ "X-API-Key" = $readKey.chave }
        $results.Add("Chave antiga após rotação: HTTP $($r.Status) (esperado 401)")
        $readKey = $rotated
    }

    $payload = @{ id = $lotId; organizacaoId = "DEMO-ORG-ATIVA"; notaFiscal = "NF-$lotId"; transportadora = "Transportadora QA"; equipamentos = @(@{ id = $equipmentId; tipo = "NOTEBOOK"; marca = "QA"; modelo = "Modelo QA"; anoFabricacao = 2022; estadoFisico = "BOM_ESTADO"; pesoQuilogramas = 2.3 }) }
    $writeHeaders = @{ "X-API-Key" = $writeKey.chave }
    $r = Invoke-Api POST "/api/v1/public/lotes" $writeHeaders $payload
    $results.Add("Submissão de lote válida: HTTP $($r.Status) (esperado 201)")
    if ($r.Status -eq 201) { $lotCreated = $true; $created = $r.Body | ConvertFrom-Json }
    $r = Invoke-Api POST "/api/v1/public/lotes" $writeHeaders $payload
    $results.Add("Lote duplicado: HTTP $($r.Status) (esperado 409)")
    $expiredPayload = $payload.Clone(); $expiredPayload.id = "$lotId-EXP"; $expiredPayload.organizacaoId = "DEMO-ORG-CONTRATO-EXPIRADO"; $expiredPayload.notaFiscal = "NF-$lotId-EXP"; $expiredPayload.equipamentos = @(@{ id = "$equipmentId-EXP"; tipo = "NOTEBOOK"; marca = "QA"; modelo = "Modelo QA"; anoFabricacao = 2022; estadoFisico = "BOM_ESTADO"; pesoQuilogramas = 2.3 })
    $r = Invoke-Api POST "/api/v1/public/lotes" $writeHeaders $expiredPayload
    $results.Add("Organização com contrato expirado: HTTP $($r.Status) (esperado 409)")

    $rateStatus = 0
    for ($i = 0; $i -lt 125 -and $rateStatus -ne 429; $i++) {
        $r = Invoke-Api GET "/api/v1/public/rastreabilidade/DEMO-EQ-RECEBIDO-01" $readHeaders
        $rateStatus = $r.Status
    }
    $results.Add("Rate limit por chave: HTTP $rateStatus ao exceder o limite (esperado 429)")
} catch {
    $results.Add("FALHA DURANTE A VERIFICAÇÃO: $($_.Exception.Message)")
} finally {
    if ($lotCreated) {
        $equipmentVersion = $created.equipamentos[0].versao
        $lotVersion = $created.versao
        [void](Invoke-Api DELETE "/equipamentos/$equipmentId`?versao=$equipmentVersion" $adminHeaders)
        [void](Invoke-Api DELETE "/lotes/$lotId`?versao=$($lotVersion + 1)" $adminHeaders)
    }
    foreach ($id in $keyIds) { [void](Invoke-Api DELETE "/api/v1/internal/chaves/$id" $adminHeaders) }
    $senha = $null
    $senhaSegura.Dispose()
}

$results | ForEach-Object { Write-Output $_ }
