param(
    [ValidateRange(10, 10000)][int]$Accounts = 1000,
    [ValidateRange(100, 1000000)][int]$Orders = 100000
)

$ErrorActionPreference = 'Stop'
$apiRoot = Split-Path -Parent $PSScriptRoot
Push-Location $apiRoot
try {
    & npm.cmd run build
    if ($LASTEXITCODE -ne 0) { throw 'El build debe pasar antes de solicitar la URI.' }
} finally { Pop-Location }
$secretUri = Read-Host 'URI PostgreSQL de catalogo_test en loopback (entrada oculta; sin proxy a servicios remotos)' -AsSecureString
$secretPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secretUri)
try {
    $privateUri = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($secretPointer)
    Push-Location $apiRoot
    try {
        # URI goes through stdin, never command arguments, a file or shell history.
        $privateUri | & node dist/scripts/verify-platform-metrics-postgres.js $Accounts $Orders
        if ($LASTEXITCODE -ne 0) { throw 'Verificación incompleta o fallida; revise el JSON saneado.' }
    } finally { Pop-Location }
} finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($secretPointer)
    $privateUri = $null
    $secretUri.Dispose()
}
