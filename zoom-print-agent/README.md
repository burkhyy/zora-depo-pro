# Zoom Depo Zebra Yazdırma Ajanı

Bu ajan, telefonda tamamlanan siparişlerin 100x50 mm etiketlerini Zebra GK420D'ye otomatik basar.

## Kurulum

1. Zebra GK420D'yi Windows'a kurun ve 100x50 mm etiket ayarını yapın.
2. PowerShell'i yönetici olarak açın.
3. Bu klasörde şu komutu çalıştırın:

```powershell
powershell -ExecutionPolicy Bypass -File .\Install.ps1
```

4. Listeden Zebra yazıcısını seçin.
5. Zoom Depo yönetici hesabıyla bir kez giriş yapın.

Yönetici parolası saklanmaz. Kurulum, yalnızca yazdırma kuyruğuna erişen ayrı bir ajan anahtarı oluşturur.

Etikette müşteri adı, telefon, adres, il/ilçe, sipariş numarası, platform, ürün adı, renk, beden, adet ve sevkiyat barkodu bulunur.
