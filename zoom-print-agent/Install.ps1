$ErrorActionPreference = "Stop"
$installDir = "$env:ProgramData\ZoomDepoPrintAgent"

Write-Host "Zoom Depo Zebra Yazdirma Ajani Kurulumu" -ForegroundColor Cyan
$appUrl = Read-Host "Uygulama adresi [https://zora-depo-pro-production.up.railway.app]"
if (!$appUrl) { $appUrl = "https://zora-depo-pro-production.up.railway.app" }

$printers = @(Get-Printer | Select-Object -ExpandProperty Name)
if (!$printers.Count) { throw "Windows'ta kurulu yazici bulunamadi." }
$printers | ForEach-Object -Begin { $index = 0 } -Process {
    Write-Host "[$index] $_"
    $index++
}
$printerIndex = Read-Host "Zebra GK420D yazicisinin numarasi"
if ([int]$printerIndex -lt 0 -or [int]$printerIndex -ge $printers.Count) { throw "Gecersiz yazici secimi." }
$printerName = $printers[[int]$printerIndex]

$username = Read-Host "Zoom Depo yonetici kullanici adi"
$password = Read-Host "Zoom Depo yonetici parolasi" -AsSecureString
$credential = [PSCredential]::new($username, $password)
$plainPassword = $credential.GetNetworkCredential().Password
$session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$loginBody = @{ username = $username; password = $plainPassword } | ConvertTo-Json
Invoke-RestMethod -Uri "$($appUrl.TrimEnd('/'))/auth/login" -Method Post `
    -ContentType "application/json" -Body $loginBody -WebSession $session | Out-Null
$plainPassword = $null

$tokenResult = Invoke-RestMethod -Uri "$($appUrl.TrimEnd('/'))/admin/print-agent/token" `
    -Method Post -ContentType "application/json" -Body "{}" -WebSession $session

New-Item -ItemType Directory -Path $installDir -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $PSScriptRoot "Agent.ps1") -Destination (Join-Path $installDir "Agent.ps1") -Force
@{
    appUrl = $appUrl.TrimEnd("/")
    printerName = $printerName
    token = $tokenResult.token
    pollSeconds = 3
} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $installDir "config.json") -Encoding UTF8

$acl = Get-Acl $installDir
$acl.SetAccessRuleProtection($true, $false)
$rule = New-Object System.Security.AccessControl.FileSystemAccessRule(
    "$env:USERDOMAIN\$env:USERNAME", "FullControl", "ContainerInherit,ObjectInherit", "None", "Allow"
)
$acl.SetAccessRule($rule)
Set-Acl -Path $installDir -AclObject $acl

$action = New-ScheduledTaskAction -Execute "powershell.exe" `
    -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$installDir\Agent.ps1`""
$trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
$settings = New-ScheduledTaskSettingsSet -RestartCount 10 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero)
Register-ScheduledTask -TaskName "Zoom Depo Zebra Yazdirma Ajani" -Action $action `
    -Trigger $trigger -Settings $settings -Description "Zoom Depo etiket kuyrugunu Zebra yaziciya basar." -Force | Out-Null
Start-ScheduledTask -TaskName "Zoom Depo Zebra Yazdirma Ajani"

Write-Host ""
Write-Host "Kurulum tamamlandi." -ForegroundColor Green
Write-Host "Yazici: $printerName"
Write-Host "Bilgisayar acikken hazirlanan siparis etiketleri otomatik basilacak."
