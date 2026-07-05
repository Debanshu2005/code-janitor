$userSettings = Join-Path $env:APPDATA 'Code\User\settings.json'
$content = Get-Content $userSettings -Raw | ConvertFrom-Json

# Switch to a reliable NVIDIA model
$content.'codeJanitor.ai.model' = 'meta/llama-3.1-8b-instruct'
$content.'codeJanitor.ai.nvidiaModel' = 'meta/llama-3.1-8b-instruct'

$content | ConvertTo-Json -Depth 100 | Set-Content $userSettings
Write-Host "Switched to meta/llama-3.1-8b-instruct (reliable NVIDIA model)"
Write-Host "Restart VS Code or reload the Code Janitor extension"
