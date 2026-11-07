# Dev helper: Spotify's memory (private MB) by process type. Usage: powershell -File mem.ps1 "label"
param([string]$label = "")
$rows = Get-CimInstance Win32_Process -Filter "Name='Spotify.exe'" | ForEach-Object {
  $t = if ($_.CommandLine -match '--type=([\w-]+)') { $matches[1] } else { 'main' }
  [pscustomobject]@{ Type = $t; MB = (Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue).PrivateMemorySize64 / 1MB }
}
$g = $rows | Group-Object Type | ForEach-Object { "{0}={1:N0}" -f $_.Name, ($_.Group | Measure-Object MB -Sum).Sum }
"{0,-22} total={1:N0} MB  ({2})" -f $label, ($rows | Measure-Object MB -Sum).Sum, ($g -join ' ')
