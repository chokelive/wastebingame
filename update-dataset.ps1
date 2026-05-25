$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$binRoot = Join-Path $root "Bin"
$westRoot = Join-Path $root "West"
$outputPath = Join-Path $root "dataset.json"
$imageExtensions = @(".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp")

function Normalize-Name($value) {
  return (($value -replace "[_-]+", " ") -replace "\s+", " ").Trim().ToLowerInvariant()
}

function Convert-ToWebPath($path) {
  $relative = Resolve-Path -LiteralPath $path -Relative
  return ($relative -replace "^\.\\", "") -replace "\\", "/"
}

$binFiles = Get-ChildItem -LiteralPath $binRoot -File |
  Where-Object { $imageExtensions -contains $_.Extension.ToLowerInvariant() }

$categories = Get-ChildItem -LiteralPath $westRoot -Directory | ForEach-Object {
  $category = $_
  $categoryKey = Normalize-Name $category.Name
  $binFile = $binFiles | Where-Object {
    (Normalize-Name $_.BaseName) -eq $categoryKey
  } | Select-Object -First 1

  if (-not $binFile) {
    Write-Warning "No matching bin image found for '$($category.Name)'."
    return
  }

  $items = Get-ChildItem -LiteralPath $category.FullName -File |
    Where-Object { $imageExtensions -contains $_.Extension.ToLowerInvariant() } |
    Sort-Object Name |
    ForEach-Object {
      [ordered]@{
        name = $_.BaseName
        path = Convert-ToWebPath $_.FullName
      }
    }

  [ordered]@{
    name = $category.Name
    binImage = Convert-ToWebPath $binFile.FullName
    items = @($items)
  }
} | Where-Object { $_ -ne $null } | Sort-Object name

$dataset = [ordered]@{
  generatedAt = (Get-Date).ToString("s")
  categories = @($categories)
}

$json = $dataset | ConvertTo-Json -Depth 6
Set-Content -LiteralPath $outputPath -Value $json -Encoding UTF8
Write-Host "Updated dataset.json with $($categories.Count) categories."
