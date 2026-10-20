# Test call for "Get TPM API access". Needs PowerShell 7.1+.
# Prints status codes and permission fields only, never the secret.
param(
    [Parameter(Mandatory)][int]$PasswordId,
    [string]$ApiVersion = 'v6',
    [string]$BaseUrl = 'https://tpm.gpi.it/index.php'
)

$publicKey = Read-Host 'Public key'
$privateKey = Read-Host 'Private key' -MaskInput
$hmac = [System.Security.Cryptography.HMACSHA256]::new([Text.Encoding]::UTF8.GetBytes($privateKey))
$client = [System.Net.Http.HttpClient]::new()

function Invoke-Tpm([string]$path) {
    $ts = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
    $hash = -join ($hmac.ComputeHash([Text.Encoding]::UTF8.GetBytes("$path$ts")) | ForEach-Object { $_.ToString('x2') })
    $req = [System.Net.Http.HttpRequestMessage]::new('GET', "$BaseUrl/$path")
    $req.Headers.Add('X-Public-Key', $publicKey)
    $req.Headers.Add('X-Request-Hash', $hash)
    $req.Headers.Add('X-Request-Timestamp', "$ts")
    # TPM rejects requests without Content-Type, and .NET only sends it on a request that has content.
    $req.Content = [System.Net.Http.StringContent]::new('', [Text.Encoding]::UTF8, 'application/json')
    $r = $client.SendAsync($req).GetAwaiter().GetResult()
    $body = $r.Content.ReadAsStringAsync().GetAwaiter().GetResult()
    $code = [int]$r.StatusCode
    Write-Host "$path -> $code"
    if ($code -ge 400) { Write-Host "  $body"; return $null }
    $body | ConvertFrom-Json
}

$v = Invoke-Tpm "api/$ApiVersion/version.json"
if ($v) { Write-Host "  version: $($v | ConvertTo-Json -Compress)" }

$me = Invoke-Tpm "api/$ApiVersion/users/me.json"
if ($me) { Write-Host "  is_saml=$($me.is_saml) is_ldap=$($me.is_ldap) is_api_only=$($me.is_api_only)" }

$p = Invoke-Tpm "api/$ApiVersion/passwords/$PasswordId.json"
if ($p) { Write-Host "  user_permission=$($p.user_permission) password_returned=$([bool]$p.password)" }
