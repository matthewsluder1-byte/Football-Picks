# Local dev server for the pick'em tracker.
# - Serves the project folder at http://localhost:8787/
# - Accepts PUT for *.json files under data/ so the Import screen can save locally.
#   (The hosted page saves through GitHub instead; see README, Phase 3.)
# Usage:  powershell -ExecutionPolicy Bypass -File tools\serve.ps1 [-Port 8787]
param([int]$Port = 8787)

$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$dataRoot = Join-Path $root 'data'
$sep = [IO.Path]::DirectorySeparatorChar
$types = @{
  '.html' = 'text/html; charset=utf-8'; '.js' = 'text/javascript; charset=utf-8'
  '.css' = 'text/css; charset=utf-8'; '.json' = 'application/json; charset=utf-8'
  '.txt' = 'text/plain; charset=utf-8'; '.md' = 'text/plain; charset=utf-8'
  '.svg' = 'image/svg+xml'; '.png' = 'image/png'; '.ico' = 'image/x-icon'
}

$listener = [System.Net.HttpListener]::new()
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Start()
Write-Host "Serving $root at http://localhost:$Port/  (Ctrl+C to stop)"

function Send($res, [int]$code, [string]$text) {
  $res.StatusCode = $code
  if ($text) {
    $b = [Text.Encoding]::UTF8.GetBytes($text)
    $res.ContentType = 'text/plain; charset=utf-8'
    $res.OutputStream.Write($b, 0, $b.Length)
  }
}

while ($listener.IsListening) {
  $ctx = $listener.GetContext()
  $req = $ctx.Request; $res = $ctx.Response
  try {
    $rel = [Uri]::UnescapeDataString($req.Url.AbsolutePath).TrimStart('/')
    if ($rel -eq '') { $rel = 'index.html' }
    $full = [IO.Path]::GetFullPath((Join-Path $root $rel))
    if (-not $full.StartsWith($root, [StringComparison]::OrdinalIgnoreCase)) { Send $res 403 'forbidden'; continue }

    if ($req.HttpMethod -eq 'PUT') {
      if (-not $full.StartsWith($dataRoot + $sep, [StringComparison]::OrdinalIgnoreCase) -or [IO.Path]::GetExtension($full) -ne '.json') {
        Send $res 403 'PUT only allowed for data/*.json'; continue
      }
      $body = (New-Object IO.StreamReader($req.InputStream, [Text.Encoding]::UTF8)).ReadToEnd()
      try { $null = $body | ConvertFrom-Json } catch { Send $res 400 'invalid JSON'; continue }
      $dir = Split-Path $full -Parent
      if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force $dir | Out-Null }
      [IO.File]::WriteAllText($full, $body, [Text.UTF8Encoding]::new($false))
      Write-Host "saved $rel"
      Send $res 204 $null
      continue
    }

    if (Test-Path $full -PathType Container) { $full = Join-Path $full 'index.html' }
    if (-not (Test-Path $full -PathType Leaf)) { Send $res 404 'not found'; continue }
    $bytes = [IO.File]::ReadAllBytes($full)
    $ext = [IO.Path]::GetExtension($full).ToLower()
    $res.ContentType = if ($types.ContainsKey($ext)) { $types[$ext] } else { 'application/octet-stream' }
    $res.Headers.Add('Cache-Control', 'no-store')
    if ($req.HttpMethod -ne 'HEAD') { $res.OutputStream.Write($bytes, 0, $bytes.Length) }
  } catch {
    try { Send $res 500 $_.Exception.Message } catch {}
  } finally {
    $res.Close()
  }
}
