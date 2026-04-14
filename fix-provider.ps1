# Fix Code Janitor Provider Setting
# This script finds and fixes the provider setting in VS Code settings

Write-Host "=== Code Janitor Provider Fix Script ===" -ForegroundColor Cyan
Write-Host ""

# Find VS Code settings file
$settingsPath = "$env:APPDATA\Code\User\settings.json"

if (-not (Test-Path $settingsPath)) {
    Write-Host "ERROR: VS Code settings file not found at: $settingsPath" -ForegroundColor Red
    Write-Host "Please manually open VS Code Settings (Ctrl+,) and search for 'codeJanitor.ai.provider'" -ForegroundColor Yellow
    pause
    exit
}

Write-Host "Found VS Code settings at: $settingsPath" -ForegroundColor Green
Write-Host ""

# Read settings
$settings = Get-Content $settingsPath -Raw

# Check if Code Janitor provider is set
if ($settings -match '"codeJanitor\.ai\.provider"\s*:\s*"([^"]+)"') {
    $currentProvider = $matches[1]
    Write-Host "Current provider: $currentProvider" -ForegroundColor Yellow
    
    if ($currentProvider -eq "groq") {
        Write-Host ""
        Write-Host "FOUND THE PROBLEM!" -ForegroundColor Red
        Write-Host "Your settings have provider set to 'groq' but you don't have a Groq API key." -ForegroundColor Red
        Write-Host ""
        Write-Host "Fixing..." -ForegroundColor Cyan
        
        # Backup original settings
        $backupPath = "$settingsPath.backup-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
        Copy-Item $settingsPath $backupPath
        Write-Host "Backup created: $backupPath" -ForegroundColor Green
        
        # Replace groq with ollama
        $newSettings = $settings -replace '"codeJanitor\.ai\.provider"\s*:\s*"groq"', '"codeJanitor.ai.provider": "ollama"'
        Set-Content $settingsPath $newSettings -NoNewline
        
        Write-Host ""
        Write-Host "FIXED! Provider changed from 'groq' to 'ollama'" -ForegroundColor Green
        Write-Host ""
        Write-Host "Next steps:" -ForegroundColor Cyan
        Write-Host "1. Reload VS Code (Ctrl+Shift+P -> 'Reload Window')" -ForegroundColor White
        Write-Host "2. Make sure Ollama is running: ollama serve" -ForegroundColor White
        Write-Host "3. Open Code Janitor chat and try 'hi'" -ForegroundColor White
    } else {
        Write-Host "Provider is already set to '$currentProvider' (not groq)" -ForegroundColor Green
        Write-Host "The 401 error might be caused by something else." -ForegroundColor Yellow
    }
} else {
    Write-Host "No 'codeJanitor.ai.provider' setting found in your settings.json" -ForegroundColor Green
    Write-Host "This means it's using the default (ollama)" -ForegroundColor Green
    Write-Host ""
    Write-Host "If you're still getting 401 errors, make sure:" -ForegroundColor Yellow
    Write-Host "1. Ollama is running: ollama serve" -ForegroundColor White
    Write-Host "2. You've reloaded VS Code" -ForegroundColor White
}

Write-Host ""
Write-Host "Press any key to exit..." -ForegroundColor Cyan
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
