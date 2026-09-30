Set-Location $PSScriptRoot
Write-Host "Serving OC Hard Tech Site at http://localhost:8080"
py -m http.server 8080
