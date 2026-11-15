import { Platform, NativeModules, DeviceEventEmitter, PermissionsAndroid } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';

const LOCAL_HISTORY_KEY = '@mobil_media_toolkit_local_downloads';
const YoutubeDLNative = NativeModules.YoutubeDLNative;

// Yerel (Native) görev durumu takipçisi
const nativeTasks = {};

// Android Kotlin motorundan gelen indirme ilerleme olaylarını dinle
if (Platform.OS === 'android') {
  DeviceEventEmitter.addListener('onNativeDownloadProgress', (event) => {
    const { progress, eta, line } = event;
    const activeId = Object.keys(nativeTasks).find(
      (id) => nativeTasks[id].status === 'downloading'
    );
    if (activeId && nativeTasks[activeId]) {
      nativeTasks[activeId].progress = Math.round(progress);
      nativeTasks[activeId].eta = eta && eta > 0 ? `${Math.round(eta)}s` : '';
      nativeTasks[activeId].speed = line ? line.slice(0, 35) : '';
    }
  });
}

function normalizeUrl(rawUrl) {
  let u = (rawUrl || '').trim();
  if (!u) return '';
  if (u.startsWith('http://') || u.startsWith('https://')) {
    return u;
  }
  if (u.includes('youtube.com') || u.includes('youtu.be')) {
    return 'https://' + u;
  }
  // Video veya Shorts ID
  return 'https://www.youtube.com/watch?v=' + u;
}

function formatDuration(sec) {
  const s = Number(sec) || 0;
  if (s <= 0) return '';
  const hrs = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const rem = Math.floor(s % 60);
  const pad = (n) => (n < 10 ? `0${n}` : `${n}`);
  if (hrs > 0) {
    return `${hrs}:${pad(mins)}:${pad(rem)}`;
  }
  return `${mins}:${pad(rem)}`;
}

function formatViewCount(views) {
  const v = Number(views) || 0;
  if (v <= 0) return '';
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}B`;
  return String(Math.round(v));
}

const DEFAULT_AUDIO_FORMATS = [
  { label: 'Yüksek Kalite Ses (M4A / AAC)', value: 'high' },
  { label: 'Standart Kalite Ses (M4A)', value: '128' },
];

const DEFAULT_VIDEO_FORMATS = [
  { label: '1080p Full HD Video (MP4)', value: '1080p' },
  { label: '720p HD Video (MP4)', value: '720p' },
];

export function isLikelyYouTubeUrl(rawInput) {
  const s = (rawInput || '').trim().toLowerCase();
  if (!s) return false;
  if (s.startsWith('http://') || s.startsWith('https://')) return true;
  if (s.includes('youtube.com/') || s.includes('youtu.be/')) return true;
  // 11 karakterlik tek kelimeli YouTube Video ID kontrolü
  if (/^[a-zA-Z0-9_-]{11}$/.test((rawInput || '').trim())) return true;
  return false;
}

export async function searchYouTubeVideos(query) {
  const q = (query || '').trim();
  if (!q) {
    throw new Error('Lütfen aramak istediğiniz şarkı veya video adını yazın.');
  }

  if (YoutubeDLNative && YoutubeDLNative.searchYouTube) {
    const rawResults = await YoutubeDLNative.searchYouTube(q);
    if (!Array.isArray(rawResults) || rawResults.length === 0) {
      throw new Error('Aramanızla eşleşen bir YouTube videosu bulunamadı.');
    }
    return rawResults.map((item, idx) => ({
      id: `search_${idx}_${item.url || ''}`,
      title: item.title || 'YouTube Video',
      url: item.url || '',
      thumbnail: item.thumbnail || '',
      author: item.uploader || 'YouTube',
      channel: item.uploader || 'YouTube',
      duration: formatDuration(item.duration),
      view_count: formatViewCount(item.viewCount),
      formats_audio: DEFAULT_AUDIO_FORMATS,
      formats_video: DEFAULT_VIDEO_FORMATS,
    }));
  }

  throw new Error('Arama motoru yalnızca güncel Android APK üzerinde desteklenir.');
}

export async function getLocalHistory() {
  try {
    const raw = await AsyncStorage.getItem(LOCAL_HISTORY_KEY);
    if (raw) {
      return JSON.parse(raw);
    }
  } catch (e) {
    console.warn('Lokal geçmiş okunamadı:', e);
  }
  return [];
}

export async function addLocalHistoryItem(item) {
  try {
    const existing = await getLocalHistory();
    const filtered = existing.filter((i) => i.filename !== item.filename);
    const updated = [item, ...filtered];
    await AsyncStorage.setItem(LOCAL_HISTORY_KEY, JSON.stringify(updated));
    return updated;
  } catch (e) {
    console.warn('Lokal geçmişe eklenemedi:', e);
    return [];
  }
}

export async function deleteLocalHistoryItem(filename, fileUrlOrPath = '') {
  try {
    const existing = await getLocalHistory();
    const targetItem = existing.find((i) => i.filename === filename);
    const resolvedUrl = fileUrlOrPath || targetItem?.download_url || '';

    // 1. Önce telefon hafızasından (Download/MediaToolkit) fiziksel olarak sil
    if (Platform.OS === 'android' && YoutubeDLNative && YoutubeDLNative.deleteMediaFile) {
      try {
        await YoutubeDLNative.deleteMediaFile(resolvedUrl, filename || '');
      } catch (delErr) {
        console.warn('Fiziksel dosya silme uyarısı:', delErr);
      }
    }

    // 2. Uygulama içi geçmiş listesinden kaldır
    const updated = existing.filter((i) => i.filename !== filename);
    await AsyncStorage.setItem(LOCAL_HISTORY_KEY, JSON.stringify(updated));
    return updated;
  } catch (e) {
    console.warn('Lokal geçmişten silinemedi:', e);
    return [];
  }
}

export async function checkHealth() {
  return { status: 'online', native: true };
}

export async function fetchVideoInfo(url) {
  const cleanUrl = normalizeUrl(url);
  if (!cleanUrl) {
    throw new Error('Lütfen bir YouTube linki yapıştırın.');
  }

  // 1. Önce Cihaz İçi NewPipeExtractor Motoru (Tam süre, kanal, görüntülenme ve çözünürlük bilgisi)
  if (YoutubeDLNative && YoutubeDLNative.getVideoInfo) {
    try {
      const nativeData = await YoutubeDLNative.getVideoInfo(cleanUrl);
      const ch = nativeData.uploader || 'YouTube';
      return {
        title: nativeData.title || 'YouTube Medya',
        thumbnail: nativeData.thumbnail || '',
        author: ch,
        channel: ch,
        duration: formatDuration(nativeData.duration),
        view_count: formatViewCount(nativeData.viewCount),
        formats_audio: DEFAULT_AUDIO_FORMATS,
        formats_video: DEFAULT_VIDEO_FORMATS,
      };
    } catch (err) {
      console.warn('Native video info uyarısı, oEmbed deneniyor:', err);
    }
  }

  // 2. Yedek: YouTube Resmi oEmbed Servisi
  try {
    const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(cleanUrl)}&format=json`;
    const res = await fetch(oembedUrl);
    if (res.ok) {
      const data = await res.json();
      const ch = data.author_name || 'YouTube';
      return {
        title: data.title || 'YouTube Medya',
        thumbnail: data.thumbnail_url || '',
        author: ch,
        channel: ch,
        duration: '',
        view_count: '',
        formats_audio: DEFAULT_AUDIO_FORMATS,
        formats_video: DEFAULT_VIDEO_FORMATS,
      };
    }
  } catch (e) {
    console.log('oEmbed hatası:', e);
  }

  throw new Error('Video bilgileri alınamadı. Lütfen geçerli bir YouTube video linki yapıştırın.');
}

export async function startDownload({ url, type, quality, title, thumbnail, uploader }) {
  const cleanUrl = normalizeUrl(url);
  const isAudio = type === 'm4a' || type === 'mp3';
  const ext = isAudio ? 'm4a' : 'mp4';

  // Yerel Android Motoru (NewPipeExtractor)
  if (YoutubeDLNative && YoutubeDLNative.download) {
    const taskId = `native_${Date.now()}`;
    const defaultFilename = `${(title || 'YouTube_Medya').replace(/[\\/:*?"<>|]/g, '_')}.${ext}`;

    nativeTasks[taskId] = {
      id: taskId,
      status: 'downloading',
      progress: 0,
      speed: 'Başlatılıyor...',
      eta: '',
      title: title || 'YouTube Medya',
      uploader: uploader || 'YouTube',
      thumbnail: thumbnail || '',
      type: isAudio ? 'm4a' : 'mp4',
      quality: quality,
      filename: defaultFilename,
      download_url: '',
      filesize: '',
      isNative: true,
    };

    (async () => {
      try {
        const result = await YoutubeDLNative.download(cleanUrl, isAudio ? 'm4a' : 'mp4', quality);
        const actualFilename = result.fileName || defaultFilename;
        const downloadUrl = result.filePath
          ? `file://${result.filePath}`
          : (result.outputDir ? `file://${result.outputDir}/${actualFilename}` : '');
        const filesize = result.fileSize || '';

        nativeTasks[taskId].status = 'completed';
        nativeTasks[taskId].progress = 100;
        nativeTasks[taskId].filename = actualFilename;
        nativeTasks[taskId].download_url = downloadUrl;
        nativeTasks[taskId].filesize = filesize;

        await addLocalHistoryItem({
          id: taskId,
          filename: actualFilename,
          title: title || 'YouTube Medya',
          uploader: uploader || 'YouTube',
          thumbnail: thumbnail || '',
          type: isAudio ? 'm4a' : 'mp4',
          quality: quality,
          filesize: filesize,
          download_url: downloadUrl,
          date: 'Bugün',
          createdAt: new Date().toISOString(),
        });
      } catch (err) {
        console.error('Native indirme hatası:', err);
        nativeTasks[taskId].status = 'failed';
        nativeTasks[taskId].error = (err && (err.message || err.toString())) || 'Yerel indirme başarısız oldu.';
      }
    })();

    return { taskId };
  }

  throw new Error('Cihaz içi indirme motoru bulunamadı. Lütfen güncel APK dosyasını yükleyin.');
}

export async function checkProgress(taskId) {
  if (nativeTasks[taskId]) {
    return { ...nativeTasks[taskId] };
  }
  return { status: 'failed', error: 'Görev bulunamadı.' };
}

export async function fetchHistory() {
  return await getLocalHistory();
}

export async function deleteHistoryItem(filename) {
  await deleteLocalHistoryItem(filename);
  return { success: true };
}

export async function playVideoInApp(item) {
  if (Platform.OS === 'android' && YoutubeDLNative && YoutubeDLNative.playVideoInApp) {
    return await YoutubeDLNative.playVideoInApp(
      item?.download_url || '',
      item?.filename || '',
      item?.title || item?.filename || 'Video',
      item?.uploader || 'MediaToolkit'
    );
  }
  return await downloadFileToDevice(item?.download_url, item?.filename, 'open');
}

export async function downloadFileToDevice(fileUrlOrPath, filename, actionType = 'open') {
  // Android üzerinde kendi MediaToolkitFileProvider köprümüzü kullan (ExpoSharing "Not allowed to read file" hatasını tamamen önler)
  if (Platform.OS === 'android' && YoutubeDLNative && YoutubeDLNative.openOrShareFile) {
    await YoutubeDLNative.openOrShareFile(fileUrlOrPath || '', filename || '', actionType);
    return { success: true, uri: fileUrlOrPath };
  }

  const lower = (filename || fileUrlOrPath || '').toLowerCase();
  const mimeType = lower.endsWith('.m4a')
    ? 'audio/mp4'
    : lower.endsWith('.mp3')
    ? 'audio/mpeg'
    : 'video/mp4';

  if (fileUrlOrPath && fileUrlOrPath.startsWith('file://')) {
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(fileUrlOrPath, { mimeType, dialogTitle: filename || 'Medya Paylaş' });
    }
    return { success: true, uri: fileUrlOrPath };
  }

  const cleanFilename = (filename || 'media').replace(/[\\/:*?"<>|]/g, '_').trim();
  const fileUri = `${FileSystem.documentDirectory}${cleanFilename}`;
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(fileUri, { mimeType, dialogTitle: filename || 'Medya Paylaş' });
  }
  return { success: true, uri: fileUri };
}

// ==========================================
// ARKA PLAN MÜZİK OYNATICI (FOREGROUND SERVICE)
// ==========================================

export async function requestNotificationPermissionIfNeeded() {
  if (Platform.OS === 'android' && Platform.Version >= 33) {
    try {
      const granted = await PermissionsAndroid.check(
        PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS
      );
      if (!granted) {
        await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
          {
            title: 'Medya Bildirimi İzni',
            message:
              'Şarkıları arka planda dinlerken bildirim çubuğundan durdurup değiştirebilmek için bildirim izni verin.',
            buttonPositive: 'İzin Ver',
            buttonNegative: 'Daha Sonra',
          }
        );
      }
    } catch (e) {
      console.warn('Bildirim izni kontrol hatası:', e);
    }
  }
}

export async function playAudioPlaylist(tracks, startIndex = 0) {
  if (Platform.OS === 'android' && YoutubeDLNative && YoutubeDLNative.playPlaylist) {
    await requestNotificationPermissionIfNeeded();
    return await YoutubeDLNative.playPlaylist(tracks, startIndex);
  }
  throw new Error('Arka plan müzik oynatıcı yalnızca Android APK üzerinde desteklenir.');
}

export async function togglePlayPauseAudio() {
  if (Platform.OS === 'android' && YoutubeDLNative && YoutubeDLNative.togglePlayPause) {
    return await YoutubeDLNative.togglePlayPause();
  }
}

export async function nextAudioTrack() {
  if (Platform.OS === 'android' && YoutubeDLNative && YoutubeDLNative.nextTrack) {
    return await YoutubeDLNative.nextTrack();
  }
}

export async function prevAudioTrack() {
  if (Platform.OS === 'android' && YoutubeDLNative && YoutubeDLNative.previousTrack) {
    return await YoutubeDLNative.previousTrack();
  }
}

export async function stopAudioPlayer() {
  if (Platform.OS === 'android' && YoutubeDLNative && YoutubeDLNative.stopPlayer) {
    return await YoutubeDLNative.stopPlayer();
  }
}

export async function seekAudioTo(positionMs) {
  if (Platform.OS === 'android' && YoutubeDLNative && YoutubeDLNative.seekTo) {
    return await YoutubeDLNative.seekTo(Math.max(0, Math.round(positionMs)));
  }
}

export async function getAudioPlayerState() {
  if (Platform.OS === 'android' && YoutubeDLNative && YoutubeDLNative.getPlayerState) {
    return await YoutubeDLNative.getPlayerState();
  }
  return { isActive: false, isPlaying: false };
}
