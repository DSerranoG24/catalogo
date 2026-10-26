param([string]$ReportPath = (Join-Path $env:TEMP 'catalog-theme-postgres-results.json'))
$ErrorActionPreference = 'Stop'
$Host.UI.RawUI.WindowTitle = 'Catalogo: ensayo LOCAL catalogo_test'
if (-not (Test-Path -LiteralPath (Join-Path $env:TEMP 'catalog-theme-baseline.json'))) {
    throw 'Falta la referencia visual historica. No registrar una nueva para ocultar diferencias.'
}
$apiRoot = Split-Path -Parent $PSScriptRoot
Push-Location $apiRoot
try {
    & npm.cmd run build
    if ($LASTEXITCODE -ne 0) { throw 'El build debe pasar antes de solicitar la URI.' }
} finally { Pop-Location }
$previousApiUrl = $env:NEXT_PUBLIC_CATALOG_API_URL
Push-Location (Join-Path (Split-Path -Parent $apiRoot) 'catalog-generator')
try {
    $env:NEXT_PUBLIC_CATALOG_API_URL = 'https://127.0.0.1:4317/api'
    & npm.cmd run build
    if ($LASTEXITCODE -ne 0) { throw 'El build de navegador local debe pasar antes de solicitar la URI.' }
} finally {
    $env:NEXT_PUBLIC_CATALOG_API_URL = $previousApiUrl
    Pop-Location
}
$secretUri = Read-Host 'URI PostgreSQL de catalogo_test en loopback (entrada oculta; sin tuneles a servicios remotos)' -AsSecureString
$secretPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secretUri)
$previousOutputEncoding = $OutputEncoding
try {
    $OutputEncoding = [System.Text.UTF8Encoding]::new($false)
    $privateUri = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($secretPointer)
    Push-Location $apiRoot
    try {
        $privateUri | & node dist/scripts/verify-catalog-theme-postgres.js $ReportPath
        if ($LASTEXITCODE -ne 0) { throw 'Ensayo fallido o incompleto. Revisar solo el JSON saneado; no aplicar en Supabase.' }
        Write-Host "Ensayo local aprobado. JSON sin credenciales: $ReportPath"
    } finally { Pop-Location }
} finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($secretPointer)
    $privateUri = $null
    $secretUri.Dispose()
    $OutputEncoding = $previousOutputEncoding
}
