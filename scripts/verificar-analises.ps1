$ErrorActionPreference = "Stop"
$base = "http://127.0.0.1:3000"
$usuario = Read-Host "Usuário administrador"
$senhaSegura = Read-Host "Senha do administrador" -AsSecureString
$senha = [System.Net.NetworkCredential]::new("", $senhaSegura).Password

try {
    $loginBody = @{ usuario = $usuario; senha = $senha } | ConvertTo-Json -Compress
    $login = Invoke-RestMethod -Method Post -Uri "$base/auth/login" -ContentType "application/json" -Body $loginBody
    $headers = @{ Authorization = "Bearer $($login.token)" }

    foreach ($endpoint in @("eficiencia", "rentabilidade", "vida-util")) {
        Write-Output "`n=== $endpoint ==="
        try {
            $resultado = Invoke-RestMethod -Method Get -Uri "$base/api/v1/internal/analises/$endpoint" -Headers $headers
            Write-Output "HTTP 200"
            $resultado | ConvertTo-Json -Depth 10
        } catch {
            $status = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { "sem resposta HTTP" }
            Write-Output "Falha HTTP $status : $($_.Exception.Message)"
        }
    }

    foreach ($endpoint in @("historico?analise=vidaUtil&limite=5", "vida-util/comparacoes")) {
        Write-Output "`n=== persistência: $endpoint ==="
        try {
            $resultado = Invoke-RestMethod -Method Get -Uri "$base/api/v1/internal/analises/$endpoint" -Headers $headers
            Write-Output "HTTP 200"
            $resultado | ConvertTo-Json -Depth 10
        } catch {
            $status = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { "sem resposta HTTP" }
            Write-Output "Falha HTTP $status : $($_.Exception.Message)"
        }
    }
} catch {
    Write-Output "Falha no login/conexão: $($_.Exception.Message)"
} finally {
    $senha = $null
    $senhaSegura.Dispose()
}
