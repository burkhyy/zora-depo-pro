param(
    [string]$ConfigPath = "$env:ProgramData\ZoomDepoPrintAgent\config.json",
    [switch]$Once
)

$ErrorActionPreference = "Stop"

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class RawPrinter {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Ansi)]
    public class DOCINFOA {
        [MarshalAs(UnmanagedType.LPStr)] public string pDocName;
        [MarshalAs(UnmanagedType.LPStr)] public string pOutputFile;
        [MarshalAs(UnmanagedType.LPStr)] public string pDataType;
    }
    [DllImport("winspool.drv", SetLastError=true, CharSet=CharSet.Ansi)]
    static extern bool OpenPrinter(string name, out IntPtr handle, IntPtr defaults);
    [DllImport("winspool.drv", SetLastError=true)]
    static extern bool ClosePrinter(IntPtr handle);
    [DllImport("winspool.drv", SetLastError=true, CharSet=CharSet.Ansi)]
    static extern bool StartDocPrinter(IntPtr handle, int level, [In] DOCINFOA doc);
    [DllImport("winspool.drv", SetLastError=true)]
    static extern bool EndDocPrinter(IntPtr handle);
    [DllImport("winspool.drv", SetLastError=true)]
    static extern bool StartPagePrinter(IntPtr handle);
    [DllImport("winspool.drv", SetLastError=true)]
    static extern bool EndPagePrinter(IntPtr handle);
    [DllImport("winspool.drv", SetLastError=true)]
    static extern bool WritePrinter(IntPtr handle, IntPtr bytes, int count, out int written);

    public static void Send(string printerName, string zpl) {
        IntPtr handle;
        if (!OpenPrinter(printerName, out handle, IntPtr.Zero))
            throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
        try {
            var doc = new DOCINFOA { pDocName = "Zoom Depo Etiketi", pDataType = "RAW" };
            if (!StartDocPrinter(handle, 1, doc)) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
            try {
                StartPagePrinter(handle);
                byte[] data = System.Text.Encoding.ASCII.GetBytes(zpl);
                IntPtr ptr = Marshal.AllocCoTaskMem(data.Length);
                try {
                    Marshal.Copy(data, 0, ptr, data.Length);
                    int written;
                    if (!WritePrinter(handle, ptr, data.Length, out written) || written != data.Length)
                        throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
                } finally { Marshal.FreeCoTaskMem(ptr); }
                EndPagePrinter(handle);
            } finally { EndDocPrinter(handle); }
        } finally { ClosePrinter(handle); }
    }
}
"@

function Convert-ToZplText([object]$Value, [int]$MaxLength = 80) {
    $text = [string]$Value
    $text = $text.Replace([string][char]0x00E7, 'c').Replace([string][char]0x00C7, 'C')
    $text = $text.Replace([string][char]0x011F, 'g').Replace([string][char]0x011E, 'G')
    $text = $text.Replace([string][char]0x0131, 'i').Replace([string][char]0x0130, 'I')
    $text = $text.Replace([string][char]0x00F6, 'o').Replace([string][char]0x00D6, 'O')
    $text = $text.Replace([string][char]0x015F, 's').Replace([string][char]0x015E, 'S')
    $text = $text.Replace([string][char]0x00FC, 'u').Replace([string][char]0x00DC, 'U')
    $text = $text -creplace '[^\u0020-\u007E]', ' '
    $text = $text -replace '[\^~\\]', ' ' -replace '\s+', ' '
    $text = $text.Trim()
    if ($text.Length -gt $MaxLength) { $text = $text.Substring(0, [Math]::Max(1, $MaxLength - 3)) + "..." }
    return $text
}

function Split-ZplText([string]$Text, [int]$LineLength = 58) {
    $words = @($Text -split ' ')
    $lines = @("")
    foreach ($word in $words) {
        $candidate = ($lines[-1] + " " + $word).Trim()
        if ($candidate.Length -le $LineLength) {
            $lines[-1] = $candidate
        } elseif ($lines.Count -lt 2) {
            $lines += $word
        }
    }
    return @($lines | ForEach-Object { Convert-ToZplText $_ $LineLength })
}

function New-ShippingLabelZpl($Payload) {
    $customer = Convert-ToZplText $Payload.customerName 42
    $phone = Convert-ToZplText $Payload.phone 25
    $orderCode = Convert-ToZplText $Payload.orderCode 35
    $platform = Convert-ToZplText $Payload.platform 20
    $addressLines = Split-ZplText (Convert-ToZplText $Payload.delivery.address 116) 58
    $city = Convert-ToZplText ("{0} / {1}" -f $Payload.delivery.district, $Payload.delivery.city) 48
    $barcode = Convert-ToZplText $Payload.barcode 45
    $products = @($Payload.products)
    $productGroups = @($products | Group-Object {
        if ($_.code) { [string]$_.code } else { [string]$_.name }
    })

    $zpl = "^XA^PW800^LL800^LH0,0^LT0^LS0^PON^FWN^CI27^PR3^MD15"
    $zpl += "^FO38,24^A0N,38,38^FD$customer^FS"
    if ($phone) { $zpl += "^FO540,30^A0N,21,21^FD$phone^FS" }
    $zpl += "^FO38,72^A0N,24,24^FDSiparis: $orderCode  $platform^FS"
    $zpl += "^FO38,108^GB724,2,2^FS"
    $zpl += "^FO38,126^A0N,21,21^FDAdres:^FS"
    if ($addressLines.Count -gt 0) { $zpl += "^FO38,157^A0N,24,24^FD$($addressLines[0])^FS" }
    if ($addressLines.Count -gt 1) { $zpl += "^FO38,190^A0N,24,24^FD$($addressLines[1])^FS" }
    $zpl += "^FO38,228^A0N,27,27^FD$city^FS"
    $zpl += "^FO38,270^GB724,2,2^FS"
    $zpl += "^FO38,288^A0N,23,23^FDUrunler:^FS"
    $zpl += "^FO630,288^A0N,23,23^FDRaf:^FS"

    $visibleCount = [Math]::Min(5, $productGroups.Count)
    for ($index = 0; $index -lt $visibleCount; $index++) {
        $group = $productGroups[$index]
        $product = $group.Group[0]
        $name = Convert-ToZplText $product.name 30
        $code = Convert-ToZplText $product.code 20
        $location = Convert-ToZplText $product.location 10
        $variantDetails = @($group.Group | ForEach-Object {
            $color = Convert-ToZplText $_.color 10
            $size = Convert-ToZplText $_.size 7
            $quantity = [Math]::Max(1, [int]$_.quantity)
            $variant = @($color, $size) | Where-Object { $_ -and $_ -ne "-" }
            if ($variant.Count) { ($variant -join "/") + " x$quantity" } else { "x$quantity" }
        })
        $detail = "$name"
        if ($code) { $detail += " [$code]" }
        if ($variantDetails.Count) { $detail += " - " + ($variantDetails -join ", ") }
        $line = Convert-ToZplText $detail 54
        $y = 324 + ($index * 32)
        $zpl += "^FO38,$y^A0N,22,22^FB570,1,0,L,0^FD$line^FS"
        $zpl += "^FO630,$y^A0N,24,24^FD$location^FS"
    }
    if ($productGroups.Count -gt 5) {
        $remaining = $productGroups.Count - 5
        $zpl += "^FO38,488^A0N,20,20^FD+$remaining urun grubu daha^FS"
    }

    $barcodeModules = (11 * ($barcode.Length + 2)) + 13
    $barcodeModuleWidth = if (($barcodeModules * 3) -le 700) { 3 } else { 2 }
    $barcodeWidth = $barcodeModules * $barcodeModuleWidth
    $barcodeX = [Math]::Max(20, [Math]::Floor((800 - $barcodeWidth) / 2))
    $zpl += "^FO38,525^GB724,2,2^FS"
    $zpl += "^FO$barcodeX,555^BY$barcodeModuleWidth,2,150^BCN,150,Y,N,N^FD$barcode^FS"
    $zpl += "^XZ"
    return $zpl
}

if (!(Test-Path -LiteralPath $ConfigPath)) {
    throw "Yazdirma ajani ayar dosyasi bulunamadi: $ConfigPath"
}

$config = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
$headers = @{
    Authorization = "Bearer $($config.token)"
    "X-Agent-Name" = $env:COMPUTERNAME
}

do {
    try {
        $response = Invoke-WebRequest `
            -Uri "$($config.appUrl.TrimEnd('/'))/print-agent/jobs/next" `
            -Headers $headers -UseBasicParsing -TimeoutSec 20

        if ($response.StatusCode -eq 200 -and $response.Content) {
            $job = ($response.Content | ConvertFrom-Json).result
            try {
                $zpl = New-ShippingLabelZpl $job.payload
                [RawPrinter]::Send($config.printerName, $zpl)
                $body = @{ success = $true } | ConvertTo-Json
            } catch {
                $body = @{ success = $false; error = $_.Exception.Message } | ConvertTo-Json
            }
            Invoke-RestMethod `
                -Uri "$($config.appUrl.TrimEnd('/'))/print-agent/jobs/$($job.id)/result" `
                -Method Post -Headers $headers -ContentType "application/json" -Body $body -TimeoutSec 20 | Out-Null
        }
    } catch {
        if ($_.Exception.Response -and [int]$_.Exception.Response.StatusCode -ne 204) {
            Write-Warning $_.Exception.Message
        }
    }

    if (!$Once) { Start-Sleep -Seconds ([Math]::Max(2, [int]$config.pollSeconds)) }
} while (!$Once)
