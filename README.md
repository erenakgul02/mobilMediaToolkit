# 📱 Mobil Media Toolkit

> **YouTube Medya İndirici (MP3 & MP4)** — Modern, hızlı ve cihazınıza özel YouTube ses ve video indirme uygulaması.

---

## ✨ Özellikler

- 🎵 **MP3 Stüdyo Kalitesi (320 kbps):** YouTube videolarını ve müziklerini kayıpsız, yüksek kaliteli sese dönüştürür.
- 🎬 **MP4 Video (1080p / 720p):** FFmpeg motoru ile yüksek çözünürlüklü video ve ses akışlarını tek bir dosyada birleştirir.
- 🎨 **Lila & Pembe Modern Tema:** Gece modu tabanlı, zarif ve mobil ergonomisine uygun arayüz.
- 🔒 **%100 Cihaza Özel Gizlilik:** İndirme geçmişi sunucuda değil, yalnızca sizin telefonunuzun dahili hafızasında (`AsyncStorage`) saklanır. Kimse başkasının indirdiği medyayı göremez.
- ⚡ **Otomatik APK Üretimi:** GitHub Actions altyapısı sayesinde depoya her güncelleme geldiğinde indirilebilir Android `.apk` dosyası otomatik olarak derlenir.

---

## 📥 Android APK Olarak İndirme ve Kurma

1. GitHub sayfasında sağ taraftaki **Releases** (veya **Actions -> Artifacts**) bölümüne gidin.
2. **`MediaToolkit-Android-APK`** dosyasını telefonunuza indirin.
3. İndirilen `.apk` dosyasına dokunarak telefonunuza kurun.
4. Ana ekranınıza eklenen mor/lila simgeye dokunarak uygulamayı doğrudan başlatın!

---

## 🚀 Proje Yapısı

```
mobilMediaToolkit/
├── .github/workflows/
│   └── build-apk.yml       # GitHub Actions otomatik Android APK derleme hattı
├── backend/
│   ├── app.py              # Flask + yt-dlp + FFmpeg indirme ve dönüştürme API'si
│   ├── Dockerfile          # 7/24 ücretsiz bulut dağıtım yapılandırması
│   ├── render.yaml         # Render.com tek tıkla dağıtım manifesti
│   └── requirements.txt    # Python bağımlılıkları
├── mobile/
│   ├── App.js              # React Native ana ekranı & navigasyon
│   ├── app.json            # Android paket ve simge yapılandırması
│   ├── eas.json            # Expo EAS Cloud Build ayarları
│   ├── assets/             # Uygulama simgeleri (adaptive-icon, favicon, logo)
│   └── src/
│       ├── components/     # İndirici ve Geçmiş ekranları
│       └── services/       # Yerel hafıza ve indirme istemcisi
└── launcher.ps1            # Masaüstü yerel başlatıcı
```

---

## 🛠️ Yerel Geliştirici Kurulumu

### 1. Backend (Python):
```bash
cd backend
pip install -r requirements.txt
python app.py
```

### 2. Frontend (React Native / Expo):
```bash
cd mobile
npm install
npm run android   # Android geliştirme
npm run web       # Web önizleme
```

---

## 📄 Lisans

MIT License — İstediğiniz gibi özelleştirebilir ve kullanabilirsiniz.
