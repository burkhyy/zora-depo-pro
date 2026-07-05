# Zoom Depo Zebra Yazdırma Ajanı

Bu ajan, personel kuyruğundan Zebra'ya gönderilen 100x100 mm etiketleri GK420D'ye sırayla basar.

## Kurulum

1. Zebra GK420D'yi Windows'a kurun ve 100x100 mm etiket ayarını yapın.
2. PowerShell'i yönetici olarak açın.
3. Bu klasörde şu komutu çalıştırın:

```powershell
powershell -ExecutionPolicy Bypass -File .\Install.ps1
```

4. Listeden Zebra yazıcısını seçin.
5. Zoom Depo yönetici hesabıyla bir kez giriş yapın.

Yönetici parolası saklanmaz. Kurulum, yalnızca yazdırma kuyruğuna erişen ayrı bir ajan anahtarı oluşturur.

Etikette müşteri adı, telefon, adres, il/ilçe, sipariş numarası, platform, ürün adı, renk, beden, adet, hazırlayan personel, paket sıra numarası ve sevkiyat barkodu bulunur.

Sipariş tamamlandığında etiket doğrudan basılmaz. `Kargoya Hazır` ekranında personelin özel kuyruğuna eklenir. Personel kendi kuyruğunu, yönetici tüm personel kuyruklarını görür. `Etiketleri Zebra'ya Gönder` komutundan sonra ajan etiketleri sırayla yazdırır.
