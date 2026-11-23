$ErrorActionPreference = "Stop"
$base = "http://127.0.0.1:3000"
$usuario = Read-Host "Usuário administrador"
$senhaSegura = Read-Host "Senha do administrador" -AsSecureString
$senha = [System.Net.NetworkCredential]::new("", $senhaSegura).Password
$resultados = [System.Collections.Generic.List[string]]::new()
$adminHeaders = @{}
$chaveId = $null
$falhou = $false
function Invoke-Api($method, $path, $headers = @{}, $body = $null) {
    $argumentos = @{ Method = $method; Uri = "$base$path"; Headers = $headers; UseBasicParsing = $true }
    if ($null -ne $body) {
        $argumentos.ContentType = "application/json"
        $argumentos.Body = ($body | ConvertTo-Json -Depth 10 -Compress)
    }
    try {
        $response = Invoke-WebRequest @argumentos
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

try {
    $login = Invoke-Api POST "/auth/login" @{} @{ usuario = $usuario; senha = $senha }
    if ($login.Status -ne 200) { throw "Login falhou (HTTP $($login.Status))." }
    $jwt = ($login.Body | ConvertFrom-Json).token
    $adminHeaders = @{ Authorization = "Bearer $jwt" }

    $respostaChave = Invoke-Api POST "/api/v1/internal/chaves" $adminHeaders @{ parceiro = "Verificação de relatórios assíncronos"; permissoes = @("analises:read") }
    if ($respostaChave.Status -ne 201) { throw "Não foi possível criar a chave de teste (HTTP $($respostaChave.Status)): $($respostaChave.Body)" }
    $chave = $respostaChave.Body | ConvertFrom-Json
    $chaveId = $chave.id
    $headersApi = @{ "X-API-Key" = $chave.chave }

    foreach ($formato in @("JSON", "CSV")) {
        $criado = Invoke-Api POST "/api/v1/public/relatorios" $headersApi @{ analise = "eficiencia"; formato = $formato }
        $resultados.Add("Criar relatório ${formato}: HTTP $($criado.Status) (esperado 202)")
        if ($criado.Status -ne 202) { throw "A API não aceitou o relatório ${formato}: $($criado.Body)" }
        $job = $criado.Body | ConvertFrom-Json
        $id = [string]$job.id
        $downloadPath = [string]$job.downloadUrl
        if ([string]::IsNullOrWhiteSpace($id) -or [string]::IsNullOrWhiteSpace($downloadPath)) { throw "A resposta 202 não trouxe o ID e a URL do relatório ${formato}." }

        $limite = [DateTime]::UtcNow.AddSeconds(120)
        $status = "PENDENTE"
        while ([DateTime]::UtcNow -lt $limite -and $status -in @("PENDENTE", "EM_PROCESSAMENTO")) {
            Start-Sleep -Seconds 1
            $consulta = Invoke-Api GET "/api/v1/public/relatorios/$id" $headersApi
            if ($consulta.Status -ne 200) { throw "Consulta do job $id falhou (HTTP $($consulta.Status)): $($consulta.Body)" }
            $jobAtual = $consulta.Body | ConvertFrom-Json
            $status = [string]$jobAtual.status
        }
        $resultados.Add("Processamento ${formato}: $status (esperado CONCLUIDO)")
        if ($status -ne "CONCLUIDO") { throw "Job $id terminou como $status ou excedeu 120 segundos. Detalhe: $($jobAtual.erro)" }

        if ($jobAtual.downloadUrl) { $downloadPath = [string]$jobAtual.downloadUrl }
        $download = Invoke-Api GET $downloadPath $headersApi
        $resultados.Add("Download ${formato}: HTTP $($download.Status) (esperado 200)")
        if ($download.Status -ne 200) { throw "Download do relatório $id falhou: $($download.Body)" }

        if ($formato -eq "JSON") {
            $conteudo = $download.Body | ConvertFrom-Json
            if ($null -eq $conteudo -or $null -eq $conteudo.quantidadeLotes) { throw "O arquivo JSON não contém o resultado esperado da análise de eficiência." }
        } elseif ($download.Body -notmatch "campo;valor") {
            throw "O arquivo CSV não contém o cabeçalho esperado campo;valor."
        }
        $resultados.Add("Conteúdo ${formato}: válido")
    }
} catch {
    $falhou = $true
    $resultados.Add("FALHA: $($_.Exception.Message)")
} finally {
    if ($chaveId -and $adminHeaders.Authorization) {
        try { [void](Invoke-Api DELETE "/api/v1/internal/chaves/$chaveId" $adminHeaders) }
        catch { $resultados.Add("Aviso: não foi possível revogar a chave de teste $chaveId.") }
    }
    $senha = $null
    $senhaSegura.Dispose()
}

$resultados | ForEach-Object { Write-Output $_ }
if ($falhou) { exit 1 }
