# Sends product photos through the Photoroom API for a catalogue look:
# background removed, white background, product centred with padding, soft
# shadow, square. Originals are never touched - results go to a separate
# folder, which build-product-images.ps1 then publishes:
#
#   $env:PHOTOROOM_API_KEY must be set (see below). Then, from the repo root:
#   powershell -File _staging\scripts\clean-product-images.ps1 -Codes <file> [-Limit 10] [-NoShadow] [-Force]
#   powershell -File _staging\scripts\clean-product-images.ps1 -All
#   powershell -File _staging\scripts\build-product-images.ps1 -Source "<Dest folder>"
#
# Every image sent costs a Photoroom credit, so you must say which items:
#   -Codes  text file, one item code per line (e.g. Active items only)
#   -All    every item that has a coded photo in -Source
#   -Limit  stop after N images (try a handful first)
# Items already in -Dest are skipped (no second charge) unless -Force.
#
# API key: kept in an environment variable on this PC, never in the repo.
#   setx PHOTOROOM_API_KEY "your-key"      (then open a new terminal)
# A Photoroom *sandbox* key (starts with "sandbox_") is free and returns
# watermarked images - use it to check the look before spending credits.
#
# Same picking rule as build-product-images.ps1: files whose name starts with
# an 8-digit item code; top-level file beats subfolder, then exact name, then
# biggest. .webp IS accepted here (Photoroom reads it), so cleaning also covers
# the .webp-only items the build script can't read.
param(
  [string]$Source = "$env:USERPROFILE\OneDrive - DFL Importers & Distributors\09 Marketing & Design\Going Online\PRODUCT IMAGES",
  [string]$Dest   = "$env:USERPROFILE\OneDrive - DFL Importers & Distributors\09 Marketing & Design\Going Online\PRODUCT IMAGES CLEAN",
  [string]$Codes = '',
  [switch]$All,
  [int]$Limit = 0,
  [switch]$NoShadow,
  [switch]$Force,
  [string]$Size = '1000x1000',
  [string]$Padding = '0.1'
)
$ErrorActionPreference = 'Stop'
$key = $env:PHOTOROOM_API_KEY
if (-not $key) { throw 'Set PHOTOROOM_API_KEY first: setx PHOTOROOM_API_KEY "your-key", then open a new terminal.' }
if (-not $Codes -and -not $All) { throw 'Say which items: -Codes <file> or -All (each image costs a credit).' }
New-Item -ItemType Directory -Force $Dest | Out-Null
$want = $null
if ($Codes) { $want = @{}; Get-Content $Codes | ForEach-Object { $c = $_.Trim(); if ($c) { $want[$c] = 1 } } }

Add-Type -AssemblyName System.Net.Http
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$http = New-Object System.Net.Http.HttpClient
$http.Timeout = [TimeSpan]::FromSeconds(120)
$http.DefaultRequestHeaders.Add('x-api-key', $key)

$srcRoot = (Get-Item -LiteralPath $Source).FullName
$files = Get-ChildItem -LiteralPath $Source -Recurse -File | Where-Object { $_.Name -match '^(1000\d{4}).*\.(jpe?g|png|webp|jfif)$' } |
  ForEach-Object { $code = $_.Name.Substring(0, 8); if (-not $want -or $want.ContainsKey($code)) {
    [pscustomobject]@{ Code = $code; Path = $_.FullName; Top = ($_.DirectoryName -eq $srcRoot); Exact = ($_.BaseName -eq $code); Size = $_.Length } } }
$picks = $files | Group-Object Code | ForEach-Object { $_.Group | Sort-Object @{e='Top';Descending=$true}, @{e='Exact';Descending=$true}, @{e='Size';Descending=$true} | Select-Object -First 1 } | Sort-Object Code
$todo = @($picks | Where-Object { $Force -or -not (Test-Path (Join-Path $Dest "$($_.Code).png")) })
if ($Limit -gt 0) { $todo = @($todo | Select-Object -First $Limit) }
"$(@($picks).Count) items have a photo; $($todo.Count) to send (the rest are already cleaned)."

$log = Join-Path $Dest '_clean_log.csv'
$sent = 0; $failed = 0
foreach ($p in $todo) {
  $tries = 0
  while ($true) {
    $tries++
    $form = New-Object System.Net.Http.MultipartFormDataContent
    $fs = [IO.File]::OpenRead($p.Path)
    $fc = New-Object System.Net.Http.StreamContent $fs
    $ext = [IO.Path]::GetExtension($p.Path).ToLower()
    $fc.Headers.ContentType = [System.Net.Http.Headers.MediaTypeHeaderValue]::Parse($(switch ($ext) { '.png' {'image/png'} '.webp' {'image/webp'} default {'image/jpeg'} }))
    $form.Add($fc, 'imageFile', [IO.Path]::GetFileName($p.Path))
    $fields = @{ 'background.color' = 'FFFFFF'; 'padding' = $Padding; 'outputSize' = $Size }
    if (-not $NoShadow) { $fields['shadow.mode'] = 'ai.soft' }
    foreach ($k in $fields.Keys) { $form.Add((New-Object System.Net.Http.StringContent $fields[$k]), $k) }
    try { $resp = $http.PostAsync('https://image-api.photoroom.com/v2/edit', $form).GetAwaiter().GetResult() }
    finally { $fs.Dispose(); $form.Dispose() }
    $status = [int]$resp.StatusCode
    if ($status -eq 200) {
      [IO.File]::WriteAllBytes((Join-Path $Dest "$($p.Code).png"), $resp.Content.ReadAsByteArrayAsync().GetAwaiter().GetResult())
      $sent++; $msg = 'ok'; break
    }
    $body = $resp.Content.ReadAsStringAsync().GetAwaiter().GetResult()
    if ($status -eq 429 -and $tries -le 5) { Start-Sleep -Seconds (5 * $tries); continue }   # rate limited: back off and retry
    if ($status -eq 401 -or $status -eq 402 -or $status -eq 403) {
      [pscustomobject]@{ Code = $p.Code; Source = $p.Path; Result = "HTTP $status"; Detail = $body } | Export-Csv $log -Append -NoTypeInformation -Encoding UTF8
      throw "Photoroom refused the request (HTTP $status): $body  -- key wrong, plan doesn't include this API, or out of credits. Stopped after $sent images."
    }
    $failed++; $msg = "HTTP $status"; break
  }
  [pscustomobject]@{ Code = $p.Code; Source = $p.Path; Result = $msg; Detail = $(if ($msg -ne 'ok') { $body } else { '' }) } | Export-Csv $log -Append -NoTypeInformation -Encoding UTF8
  if ($msg -ne 'ok') { "  $($p.Code): $msg $body" }
  if (($sent + $failed) % 25 -eq 0) { "  ...$($sent + $failed) of $($todo.Count)" }
}
"Done: $sent cleaned, $failed failed. Results in $Dest (log: _clean_log.csv)."
"Next: powershell -File _staging\scripts\build-product-images.ps1 -Source `"$Dest`""
