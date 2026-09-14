param(
    [Parameter(Mandatory=$true, Position=0)]
    [string]$FolderPath
)

$files = Get-ChildItem -Path $FolderPath -Recurse -Include *.js, *.jsx -File -Exclude node_modules, build, dist

$results = foreach ($file in $files) {
    $lineCount = (Get-Content -Path $file.FullName | Measure-Object -Line).Lines
    [PSCustomObject]@{
        Path  = $file.FullName
        Lines = $lineCount
    }
}

# Sort ascending so the file with the most lines prints last
$sortedResults = $results | Sort-Object Lines -Descending:$false

# Print per-file counts
$sortedResults | Format-Table -AutoSize

# Calculate and print total
$totalLines = ($sortedResults | Measure-Object -Property Lines -Sum).Sum
Write-Host "Total Lines: $totalLines" -ForegroundColor Green