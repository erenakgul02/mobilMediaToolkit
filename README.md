# Media Toolkit

Android cihazlar için geliştirilmiş, harici bir sunucuya ihtiyaç duymadan doğrudan telefon üzerinde çalışan açık kaynaklı YouTube medya indirici, arka plan müzik çalar ve video oynatıcı uygulaması.

## Uygulamayı İndir

Android telefonunuza kurmak için aşağıdaki bağlantıyı kullanabilirsiniz:

### [Android APK İndir (Son Sürüm)](https://github.com/erenakgul02/mobilMediaToolkit/releases/latest/download/mobilMediaToolkit.apk)

Bağlantıya tıkladığınızda en güncel `.apk` kurulum dosyası doğrudan cihazınıza iner. Herhangi bir hesap girişi veya ek kurulum adımı gerekmez.

---

## Temel Özellikler

- **Dahili YouTube Arama Motoru:** Uygulamadan çıkmadan şarkı, sanatçı veya video adı aratarak sonuçları doğrudan listeleyebilir ya da bağlantı yapıştırarak analiz edebilirsiniz.
- **Otomatik İndirme Formatı (Tek Tıkla İndir):** Üst barda bulunan kalıcı format seçici (varsayılan: M4A Yüksek Kalite) sayesinde her seferinde format ve kalite seçmekle uğraşmadan arama sonuçlarından veya bağlantıdan tek dokunuşla indirme başlatabilirsiniz.
- **İndirmeden Önce Şarkı Dinleme (Önizleme):** Doğru şarkıyı veya versiyonu indirdiğinizden emin olmak için arama sonuçlarındaki veya analiz ekranındaki dinleme butonuna basarak medyayı telefonunuza kaydetmeden önce dinleyip kontrol edebilirsiniz.
- **Yüksek Kaliteli Ses ve Video İndirme:** Şarkıları yüksek kaliteli M4A (AAC) formatında, videoları ise 1080p Full HD ve 720p HD MP4 formatında cihazınızın `Download/MediaToolkit` klasörüne kaydeder.
- **Sıralı İndirme Kuyruğu ve Wi-Fi Kilidi:** Bir medya indirilirken yeni şarkı veya videoları indirme sırasına ekleyebilir, mobil veriyi korumak için "Yalnızca Wi-Fi" kilidini aktif edebilirsiniz.
- **Toplu YouTube Oynatma Listesi (Playlist / Albüm) İndirme:** Bir YouTube oynatma listesi bağlantısı yapıştırdığınızda listedeki tüm şarkıları görüntüleyip tek dokunuşla tamamını seçili formatla indirme kuyruğuna ekleyebilirsiniz.
- **Arka Plan Müzik Çalar ve Gelişmiş Ses Kontrolleri:** İndirilen şarkıları ekran kapalıyken arka planda çalar. Karışık çalma (Shuffle), tekrarlama (Repeat), uyku zamanlayıcısı (15/30/60 dk veya şarkı sonu), oynatma hızı (0.75x - 1.5x), bas güçlendirici / ses profilleri (Equalizer) ve uzun ses kayıtlarında kaldığı saniyeden devam etme (Resume) özelliklerini destekler.
- **Zil Sesi ve Şarkı Kesici (Audio Trimmer):** İndirdiğiniz şarkıların istediğiniz saniye aralığını (örneğin 30 saniyelik nakarat kısmını) cihaz içi `MediaExtractor` ve `MediaMuxer` motoruyla kesip kaydedebilir veya doğrudan telefon zil sesi olarak atayabilirsiniz.
- **Özel Çalma Listeleri (Playlist):** İndirdiğiniz şarkılardan özel isim vererek dilediğiniz kadar çalma listesi oluşturabilir, listelerinize istediğiniz zaman şarkı ekleyip çıkarabilirsiniz.
- **Gelişmiş Filtreleme, Sıralama ve Depolama Özeti:** İndirilen medyaları sanatçıya, alfabetik sıraya (A-Z / Z-A), indirme tarihine ve dosya boyutuna göre filtreleyebilir; üst kısımda toplam medya boyutunu ve cihazda kalan boş alanı görebilirsiniz.
- **Uygulama İçi Video Oynatıcı:** İndirilen MP4 videoları tam ekran, yatay/dikey ekran döndürme destekli ve ekranın sağ/sol tarafına çift dokunarak 10 saniye ileri/geri sarma kontrollü dahili oynatıcıda açar.
- **Gece ve Gündüz Modu:** Üst çubuktan tek dokunuşla gece veya gündüz temasına geçiş yapabilirsiniz.
- **Tamamen Cihaz İçi Mimari:** Tüm arama, ayrıştırma (`NewPipeExtractor`) ve ses/video birleştirme (`Android MediaMuxer`) işlemleri doğrudan telefon üzerinde gerçekleşir. Verileriniz hiçbir uzak sunucuya gönderilmez.

---

## Teknik Mimari

Proje iki ana bileşenden oluşur:

1. **Android Yerel Motor (`mobile/native-android`):** Kotlin ile yazılmış yerel modüller; `NewPipeExtractor v0.27.1` kütüphanesi üzerinden YouTube akışlarını çözer, `MediaMuxer` ile yüksek çözünürlüklü video ve ses akışlarını senkronize şekilde birleştirir ve Android `ForegroundService` + `MediaSession` yapısıyla arka plan müzik oynatımını yönetir.
2. **Kullanıcı Arayüzü (`mobile/src`):** React Native ve Expo altyapısıyla geliştirilmiş; indirme kuyruğu, çalma listeleri, filtreleme ve tema yönetimini içeren arayüz katmanıdır.

---

## Geliştirici Kurulumu

Projeyi kendi bilgisayarınızda derlemek veya geliştirmek için aşağıdaki adımları izleyebilirsiniz:

```bash
cd mobile
npm install
npx expo prebuild --platform android
python setup-native.py
cd android
./gradlew assembleRelease
```

Geliştirme sunucusunu başlatmak için:

```bash
cd mobile
npm run android
```

## Lisans

Bu proje MIT Lisansı ile lisanslanmıştır.
