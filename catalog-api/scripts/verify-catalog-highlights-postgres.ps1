param([string]$ReportPath = (Join-Path $env:TEMP 'catalog-highlights-postgres-results.json'))
$ErrorActionPreference = 'Stop'
$apiRoot = Split-Path -Parent $PSScriptRoot
Push-Location $apiRoot
try {
    & npm.cmd run build
    if ($LASTEXITCODE -ne 0) { throw 'El build debe pasar antes de solicitar la URI.' }
    $secretUri = Read-Host 'URI de catalogo_test LOCAL en loopback (oculta; sin tuneles remotos)' -AsSecureString
    $secretPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secretUri)
    $previousOutputEncoding = $OutputEncoding
    try {
        $OutputEncoding = [System.Text.UTF8Encoding]::new($false)
        $privateUri = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($secretPointer)
        $privateUri | & node dist/scripts/verify-catalog-highlights-postgres.js $ReportPath
        if ($LASTEXITCODE -ne 0) { throw 'Ensayo fallido: detenerse; no hacer commit/push ni migrar Supabase.' }
        Write-Host "Ensayo aprobado. JSON sin credenciales: $ReportPath"
    } finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($secretPointer)
        $privateUri = $null
        $secretUri.Dispose()
        $OutputEncoding = $previousOutputEncoding
    }
} finally { Pop-Location }
