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
    $text = $text.Replace('ç','c').Replace('Ç','C')
    $text = $text.Replace('ğ','g').Replace('Ğ','G')
    $text = $text.Replace('ı','i').Replace('İ','I')
    $text = $text.Replace('ö','o').Replace('Ö','O')
    $text = $text.Replace('ş','s').Replace('Ş','S')
    $text = $text.Replace('ü','u').Replace('Ü','U')
    $text = $text -replace '[\^~\\]', ' ' -replace '\s+', ' '
    $text = $text.Trim()
    if ($text.Length -gt $MaxLength) { $text = $text.Substring(0, [Math]::Max(1, $MaxLength - 3)) + "..." }
    return $text
}

function New-ShippingLabelZpl($Payload) {
    $customer = Convert-ToZplText $Payload.customerName 42
    $phone = Convert-ToZplText $Payload.phone 25
    $orderCode = Convert-ToZplText $Payload.orderCode 35
    $platform = Convert-ToZplText $Payload.platform 20
    $address = Convert-ToZplText $Payload.delivery.address 76
    $city = Convert-ToZplText ("{0} / {1}" -f $Payload.delivery.district, $Payload.delivery.city) 48
    $barcode = Convert-ToZplText $Payload.barcode 45
    $products = @($Payload.products)

    $zpl = "^XA^PW800^LL400^LH0,0^CI27"
    $zpl += "^FO24,18^A0N,31,31^FD$customer^FS"
    if ($phone) { $zpl += "^FO520,22^A0N,22,22^FD$phone^FS" }
    $zpl += "^FO24,56^A0N,21,21^FDSiparis: $orderCode  $platform^FS"
    $zpl += "^FO24,84^GB752,1,1^FS"
    $zpl += "^FO24,96^A0N,21,21^FB752,2,2,L,0^FD$address^FS"
    $zpl += "^FO24,142^A0N,23,23^FD$city^FS"
    $zpl += "^FO24,172^GB752,1,1^FS"
    $zpl += "^FO24,181^A0N,20,20^FDUrunler:^FS"

    $visibleCount = [Math]::Min(3, $products.Count)
    for ($index = 0; $index -lt $visibleCount; $index++) {
        $product = $products[$index]
        $detail = "{0} - {1}/{2} x{3}" -f $product.name, $product.color, $product.size, $product.quantity
        $line = Convert-ToZplText $detail 67
        $y = 207 + ($index * 24)
        $zpl += "^FO24,$y^A0N,19,19^FD$line^FS"
    }
    if ($products.Count -gt 3) {
        $remaining = $products.Count - 3
        $zpl += "^FO24,279^A0N,18,18^FD+$remaining urun daha^FS"
    }

    $zpl += "^FO150,302^BY3,2,62^BCN,62,Y,N,N^FD$barcode^FS"
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
