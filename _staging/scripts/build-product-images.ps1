# Builds /product-images/ for the Stock & Prices photos (shared/stock-prices.js).
#
#   powershell -File _staging\scripts\build-product-images.ps1 [-Source <folder>] [-Codes <file>]
#
# Source: Marketing's PRODUCT IMAGES folder. Any image whose file name STARTS
#   with an 8-digit item code (10000123.jpg, "10000037 D750800-Contenedor.jpg")
#   counts for that item. Subfolders are searched too; a file directly in the
#   Source folder beats one in a subfolder, then the file named exactly <code>,
#   then the biggest file.
# Codes (optional): text file, one item code per line - only those items are
#   built (e.g. the Active list from stock_items_raw). Without it every coded
#   image is built.
#
# Writes <code>.jpg (800px) and t/<code>.jpg (160px thumbnail) and rewrites
# index.json, the list of codes the stock list shows a photo for. Existing files
# are overwritten; photos for codes no longer found are left in place but
# dropped from index.json. .webp is skipped: System.Drawing can't read it, so
# convert those to .jpg first. Run from the repo root, then commit product-images/.
param(
  [string]$Source = "$env:USERPROFILE\OneDrive - DFL Importers & Distributors\09 Marketing & Design\Going Online\PRODUCT IMAGES",
  [string]$Codes = ''
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$out = Join-Path (Get-Location) 'product-images'
if (-not (Test-Path (Join-Path (Get-Location) 'shared\stock-prices.js'))) { throw 'Run this from the repo root.' }
New-Item -ItemType Directory -Force $out, (Join-Path $out 't') | Out-Null
$want = $null
if ($Codes) { $want = @{}; Get-Content $Codes | ForEach-Object { $c = $_.Trim(); if ($c) { $want[$c] = 1 } } }

$jpg = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object MimeType -eq 'image/jpeg'
function Save-Resized($img, [int]$max, [long]$q, [string]$path) {
  $r = [math]::Min(1.0, $max / [math]::Max($img.Width, $img.Height))
  $w = [math]::Max(1, [int]($img.Width * $r)); $h = [math]::Max(1, [int]($img.Height * $r))
  $bmp = New-Object System.Drawing.Bitmap $w, $h
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.Clear([System.Drawing.Color]::White)   # transparent PNGs get a white background
  $g.InterpolationMode = 'HighQualityBicubic'; $g.SmoothingMode = 'HighQuality'; $g.PixelOffsetMode = 'HighQuality'
  $g.DrawImage($img, 0, 0, $w, $h)
  $ep = New-Object System.Drawing.Imaging.EncoderParameters 1
  $ep.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter ([System.Drawing.Imaging.Encoder]::Quality), $q
  $bmp.Save($path, $jpg, $ep); $g.Dispose(); $bmp.Dispose()
}

$files = Get-ChildItem -LiteralPath $Source -Recurse -File | Where-Object { $_.Name -match '^(1000\d{4}).*\.(jpe?g|png|jfif|gif|bmp)$' } |
  ForEach-Object { $code = $_.Name.Substring(0, 8); if (-not $want -or $want.ContainsKey($code)) {
    [pscustomobject]@{ Code = $code; Path = $_.FullName; Top = ($_.DirectoryName -eq (Get-Item -LiteralPath $Source).FullName); Exact = ($_.BaseName -eq $code); Size = $_.Length } } }

$done = @(); $failed = @()
foreach ($grp in ($files | Group-Object Code)) {
  $ok = $false
  foreach ($c in ($grp.Group | Sort-Object @{e='Top';Descending=$true}, @{e='Exact';Descending=$true}, @{e='Size';Descending=$true})) {
    $img = $null
    try {
      $img = [System.Drawing.Image]::FromFile($c.Path)
      if ($img.PropertyIdList -contains 0x0112) {   # honour EXIF orientation
        switch ([int]$img.GetPropertyItem(0x0112).Value[0]) { 3 {$img.RotateFlip('Rotate180FlipNone')} 6 {$img.RotateFlip('Rotate90FlipNone')} 8 {$img.RotateFlip('Rotate270FlipNone')} }
      }
      if ([math]::Max($img.Width, $img.Height) -lt 120) { $img.Dispose(); continue }   # too small to be useful
      Save-Resized $img 800 82 (Join-Path $out "$($grp.Name).jpg")
      Save-Resized $img 160 78 (Join-Path $out "t\$($grp.Name).jpg")
      $img.Dispose(); $done += $grp.Name; $ok = $true; break
    } catch { if ($img) { $img.Dispose() } }
  }
  if (-not $ok) { $failed += $grp.Name }
}
'[' + (($done | Sort-Object | ForEach-Object { '"' + $_ + '"' }) -join ',') + ']' | Set-Content -Encoding ascii -NoNewline (Join-Path $out 'index.json')
"Built $($done.Count) photos. Couldn't read: $($failed.Count) $($failed -join ', ')"
