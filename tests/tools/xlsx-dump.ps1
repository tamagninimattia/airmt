param([string]$Dir, [string]$Sheet, [string]$Out)
# Scrive una riga per cella: riferimento <TAB> valore <TAB> formula (stringhe condivise risolte)
[xml]$ss = Get-Content -Raw -Encoding UTF8 (Join-Path $Dir 'xl\sharedStrings.xml')
$strings = @()
foreach ($si in $ss.sst.si) {
  if ($si.t -ne $null) { $strings += [string]($si.t.'#text' + $si.t) }
  else { $strings += (($si.r | ForEach-Object { if ($_.t.'#text') { $_.t.'#text' } else { $_.t } }) -join '') }
}
[xml]$ws = Get-Content -Raw -Encoding UTF8 (Join-Path $Dir "xl\worksheets\$Sheet.xml")
$lines = New-Object System.Collections.Generic.List[string]
foreach ($row in $ws.worksheet.sheetData.row) {
  foreach ($c in $row.c) {
    $v = $c.v
    if ($c.t -eq 's' -and $v -ne $null) { $v = $strings[[int]$v] }
    $f = ''
    if ($c.f) { $f = if ($c.f.'#text') { $c.f.'#text' } else { [string]$c.f } }
    if ($v -ne $null -or $f) { $lines.Add("$($c.r)`t$v`t$f") }
  }
}
[System.IO.File]::WriteAllLines($Out, $lines, [System.Text.UTF8Encoding]::new($false))
