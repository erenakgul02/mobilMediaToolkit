# Mobil Media Toolkit

YouTube videolarını mobil cihazlar için MP3 ve MP4 formatında indirmeye yarayan açık kaynaklı bir mobil uygulama projesidir.

## Genel Bakış

Bu uygulama React Native (Expo) tabanlı bir mobil arayüz ile arka planda çalışan Python (yt-dlp ve FFmpeg) servisinden oluşur.

- MP3 (ses) ve MP4 (video) formatlarında indirme yapılabilir.
- 320 kbps ses ve 1080p / 720p video kaliteleri desteklenir.
- İndirilen dosyaların geçmişi sunucuda tutulmaz, gizlilik amacıyla doğrudan kullanıcının kendi cihazında (AsyncStorage) saklanır.
- Kod tabanı, GitHub Actions üzerinden doğrudan kurulabilir Android APK çıktısı üretecek şekilde yapılandırılmıştır.

## Kurulum ve Çalıştırma

Projeyi yerel ortamda çalıştırmak için aşağıdaki adımları izleyebilirsiniz.

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

## Android APK Derleme

Uygulamanın Android APK dosyası depoya dahil edilen GitHub Actions iş akışı ile derlenir:

1. Deponun **Actions** sekmesine gidin.
2. **Android APK Derleme ve Yayinlama** iş akışını seçin.
3. Derleme tamamlandığında sayfanın altındaki **Artifacts** bölümünden `MediaToolkit-Android-APK` dosyasını indirip doğrudan telefonunuza kurabilirsiniz.

Alternatif olarak Expo EAS Build kullanmak için:

```bash
cd mobile
npx eas build -p android --profile preview
```

## Dizin Yapısı

- `backend/`: Flask, yt-dlp ve FFmpeg içeren dönüştürme ve indirme servisi.
- `mobile/`: React Native mobil kullanıcı arayüzü ve ekran bileşenleri.
- `.github/workflows/`: Otomatik Android APK derleme yapılandırması.

## Lisans

Bu proje MIT lisansı ile dağıtılmaktadır.
