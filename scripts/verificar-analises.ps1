$ErrorActionPreference = "Stop"
$base = "http://127.0.0.1:3000"
$usuario = Read-Host "Usuário administrador"
$senhaSegura = Read-Host "Senha do administrador" -AsSecureString
$senha = [System.Net.NetworkCredential]::new("", $senhaSegura).Password
$falhas = [System.Collections.Generic.List[string]]::new()

try {
    $loginBody = @{ usuario = $usuario; senha = $senha } | ConvertTo-Json -Compress
    $login = Invoke-RestMethod -Method Post -Uri "$base/auth/login" -ContentType "application/json" -Body $loginBody
    $headers = @{ Authorization = "Bearer $($login.token)" }

    foreach ($endpoint in @("eficiencia", "rentabilidade", "vida-util")) {
        Write-Output "`n=== $endpoint ==="
        try {
            $resultado = Invoke-RestMethod -Method Get -Uri "$base/api/v1/internal/analises/$endpoint" -Headers $headers
            Write-Output "OK - HTTP 200"
            $resultado | ConvertTo-Json -Depth 10
        } catch {
            $status = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { "sem resposta HTTP" }
            $mensagem = "Análise $endpoint falhou (HTTP $status): $($_.Exception.Message)"
            Write-Output "FALHA - $mensagem"
            $falhas.Add($mensagem)
        }
    }

    foreach ($endpoint in @("historico?analise=vidaUtil&limite=5", "vida-util/comparacoes")) {
        Write-Output "`n=== persistência: $endpoint ==="
        try {
            $resultado = Invoke-RestMethod -Method Get -Uri "$base/api/v1/internal/analises/$endpoint" -Headers $headers
            Write-Output "OK - HTTP 200"
            $resultado | ConvertTo-Json -Depth 10
        } catch {
            $status = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { "sem resposta HTTP" }
            $mensagem = "Consulta de persistência $endpoint falhou (HTTP $status): $($_.Exception.Message)"
            Write-Output "FALHA - $mensagem"
            $falhas.Add($mensagem)
        }
    }
} catch {
    $mensagem = "Login ou conexão falhou: $($_.Exception.Message)"
    Write-Output "FALHA - $mensagem"
    $falhas.Add($mensagem)
} finally {
    $senha = $null
    $senhaSegura.Dispose()
}

if ($falhas.Count -gt 0) { exit 1 }
Write-Output "Todas as verificações analíticas passaram."
