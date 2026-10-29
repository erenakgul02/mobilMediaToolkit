# Mobil Media Toolkit

YouTube videolarını mobil cihazlar için MP3 ve MP4 formatında indirmeye yarayan açık kaynaklı bir mobil uygulama projesidir.

## Genel Bakış

Bu uygulama React Native (Expo) tabanlı bir mobil arayüz ile arka planda çalışan Python (yt-dlp ve FFmpeg) servisinden oluşur.

- MP3 (ses) ve MP4 (video) formatlarında indirme yapılabilir.
- 320 kbps ses ve 1080p / 720p video kaliteleri desteklenir.
- İndirilen dosyaların geçmişi sunucuda tutulmaz, gizlilik amacıyla doğrudan kullanıcının kendi cihazında (AsyncStorage) saklanır.
- Sade, beyaz ve modern kullanıcı arayüzü içerir.
- Kod tabanı, GitHub Actions üzerinden doğrudan kurulabilir Android APK çıktısı üretecek şekilde yapılandırılmıştır.

## Android APK İndirme

Uygulamayı Android telefonunuza kurmak için iki yöntem bulunmaktadır:

### Yöntem 1: GitHub Releases (Önerilen)

Doğrudan APK dosyasını tek tıkla indirmek için Releases sayfasını kullanabilirsiniz. Bu yöntem için GitHub hesabı açma zorunluluğu yoktur.

1. Deponun Releases sayfasına gidin: `https://github.com/erenakgul02/mobilMediaToolkit/releases`
2. En son yayımlanan sürümün altındaki `mobilMediaToolkit.apk` dosyasına tıklayarak indirin.
3. Telefonunuzda indirilen dosyayı açarak kurulumu tamamlayın.

### Yöntem 2: GitHub Actions (Artifacts)

Herhangi bir kod güncellemesinden sonra derlenen en son geliştirme sürümünü indirmek için:

1. Deponun üst menüsündeki Actions sekmesine gidin.
2. Android APK Derleme ve Yayinlama iş akışında en üstteki başarılı (yeşil) çalışmaya tıklayın.
3. Açılan sayfanın altındaki Artifacts başlığı altında yer alan `MediaToolkit-APK` bağlantısına tıklayın.
4. İndirilen zip dosyasının içindeki APK dosyasını telefonunuza aktarıp yükleyin. (Bu yöntem GitHub hesabına giriş yapılmasını gerektirir.)

## Kurulum ve Çalıştırma

Projeyi kendi bilgisayarınızda yerel ortamda çalıştırmak için aşağıdaki adımları izleyebilirsiniz.

### 1. Arka Uç Servisi (Python)

Gerekli Python paketlerini yükleyin ve sunucuyu başlatın:

```bash
cd backend
pip install -r requirements.txt
python app.py
```

Sunucu varsayılan olarak `http://localhost:5000` portunda çalışır.

### 2. Mobil Uygulama (React Native)

Bağımlılıkları kurun ve geliştirici sunucusunu açın:

```bash
cd mobile
npm install
npm run android
```

Tarayıcı üzerinden önizleme yapmak için:

```bash
npm run web
```

## Dizin Yapısı

- `backend/`: Flask, yt-dlp ve FFmpeg içeren dönüştürme ve indirme servisi.
- `mobile/`: React Native mobil kullanıcı arayüzü ve ekran bileşenleri.
- `.github/workflows/`: Otomatik Android APK derleme ve yayınlama iş akışı.

## Lisans

Bu proje MIT lisansı ile dağıtılmaktadır.
