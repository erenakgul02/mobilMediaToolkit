$ErrorActionPreference = "SilentlyContinue"

if ($PSScriptRoot) {
    $projectDir = $PSScriptRoot
} elseif ($MyInvocation.MyCommand.Path) {
    $projectDir = Split-Path -Parent $MyInvocation.MyCommand.Path
} else {
    $projectDir = Join-Path $env:USERPROFILE "Downloads\mobilMediaToolkit"
}

# 1. Onceden acik kalan process ve portlari temizle
Stop-Process -Name cloudflared -Force -ErrorAction SilentlyContinue
Get-NetTCPConnection -LocalPort 5000 -ErrorAction SilentlyContinue | ForEach-Object {
    Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue
}

Clear-Host
Write-Host "=======================================================" -ForegroundColor Cyan
Write-Host "          Mobil Media Toolkit Baslatiliyor...          " -ForegroundColor Green
Write-Host "=======================================================" -ForegroundColor Cyan

# 2. Python Sunucusunu baslat
Write-Host ">> Sistem ve Canli Mobil Baglanti baslatiliyor..." -ForegroundColor Yellow
$backendProc = Start-Process -FilePath "python" -ArgumentList "app.py" -WorkingDirectory "$projectDir\backend" -WindowStyle Hidden -PassThru

# 3. Sunucunun hazir olmasini bekle
for ($i = 0; $i -lt 10; $i++) {
    Start-Sleep -Milliseconds 400
    try {
        $res = Invoke-WebRequest -Uri "http://localhost:5000" -UseBasicParsing -TimeoutSec 1
        if ($res.StatusCode -eq 200) {
            break
        }
    } catch {}
}

# Tarayicida hemen ac
Start-Process "http://localhost:5000"

Write-Host ""
Write-Host ">> [OK] UYGULAMA AKTIF!" -ForegroundColor Green
Write-Host ">> Tarayicinizda acildi: http://localhost:5000" -ForegroundColor White
Write-Host ">> Ekrandaki 'Safari QR' butonuna tiklayarak telefonunuzdan acabilirsiniz!" -ForegroundColor Cyan
Write-Host ""
Write-Host "=======================================================" -ForegroundColor Cyan
Write-Host "  Uygulamayi KAPATMAK icin bu pencereyi kapatin veya  " -ForegroundColor Magenta
Write-Host "  ENTER tusuna basin.                                  " -ForegroundColor Magenta
Write-Host "=======================================================" -ForegroundColor Cyan

try {
    $null = Read-Host
} finally {
    Write-Host "Sunucular guvenle durduruluyor..." -ForegroundColor Yellow
    if ($backendProc -and !$backendProc.HasExited) {
        Stop-Process -Id $backendProc.Id -Force -ErrorAction SilentlyContinue
    }
    Stop-Process -Name cloudflared -Force -ErrorAction SilentlyContinue
    Get-NetTCPConnection -LocalPort 5000 -ErrorAction SilentlyContinue | ForEach-Object {
        Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue
    }
    Write-Host "Sunucular kapatildi." -ForegroundColor Green
}
