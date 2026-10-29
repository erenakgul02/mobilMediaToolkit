import { Platform, NativeModules, DeviceEventEmitter } from 'react-native';
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
      nativeTasks[activeId].eta = eta ? `${Math.round(eta)}s` : '';
      nativeTasks[activeId].speed = line ? line.slice(0, 30) : '';
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

export async function deleteLocalHistoryItem(filename) {
  try {
    const existing = await getLocalHistory();
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

  // 1. YouTube Resmi oEmbed Servisi (Tamamen sunucusuz, doğrudan Google'dan)
  try {
    const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(cleanUrl)}&format=json`;
    const res = await fetch(oembedUrl);
    if (res.ok) {
      const data = await res.json();
      return {
        title: data.title || 'YouTube Medya',
        thumbnail: data.thumbnail_url || '',
        author: data.author_name || 'YouTube',
        duration: 0,
        formats_audio: [
          { label: '320 kbps (Yüksek Kalite MP3)', value: '320' },
          { label: '192 kbps (Standart Kalite MP3)', value: '192' },
        ],
        formats_video: [
          { label: '1080p Full HD Video', value: '1080p' },
          { label: '720p HD Video', value: '720p' },
        ],
      };
    }
  } catch (e) {
    console.log('oEmbed hatası:', e);
  }

  // 2. Cihaz İçi Yerel Motor (Native Module)
  if (YoutubeDLNative && YoutubeDLNative.getVideoInfo) {
    try {
      const nativeData = await YoutubeDLNative.getVideoInfo(cleanUrl);
      return {
        title: nativeData.title || 'YouTube Medya',
        thumbnail: nativeData.thumbnail || '',
        author: nativeData.uploader || 'YouTube',
        duration: nativeData.duration || 0,
        formats_audio: [
          { label: '320 kbps (Yüksek Kalite MP3)', value: '320' },
          { label: '192 kbps (Standart Kalite MP3)', value: '192' },
        ],
        formats_video: [
          { label: '1080p Full HD Video', value: '1080p' },
          { label: '720p HD Video', value: '720p' },
        ],
      };
    } catch (err) {
      console.warn('Native video info hatası:', err);
    }
  }

  throw new Error('Video bilgileri alınamadı. Lütfen geçerli bir YouTube video linki yapıştırın.');
}

export async function startDownload({ url, type, quality, title, thumbnail }) {
  const cleanUrl = normalizeUrl(url);

  // Yerel Android Motoru (Seal / youtubedl-android)
  if (YoutubeDLNative && YoutubeDLNative.download) {
    const taskId = `native_${Date.now()}`;
    nativeTasks[taskId] = {
      id: taskId,
      status: 'downloading',
      progress: 0,
      speed: 'Başlatılıyor...',
      eta: '',
      title: title || 'YouTube Medya',
      thumbnail: thumbnail || '',
      type: type,
      quality: quality,
      filename: `${(title || 'Medya').replace(/[\\/:*?"<>|]/g, '_')}.${type === 'mp3' ? 'mp3' : 'mp4'}`,
      isNative: true,
    };

    (async () => {
      try {
        const result = await YoutubeDLNative.download(cleanUrl, type, quality);
        nativeTasks[taskId].status = 'completed';
        nativeTasks[taskId].progress = 100;

        const defaultFilename = `${(title || 'YouTube Medya').replace(/[\\/:*?"<>|]/g, '_')}.${type === 'mp3' ? 'mp3' : 'mp4'}`;
        const actualFilename = result.fileName || defaultFilename;
        const downloadUrl = result.filePath
          ? `file://${result.filePath}`
          : (result.outputDir ? `file://${result.outputDir}/${actualFilename}` : '');

        nativeTasks[taskId].filename = actualFilename;
        nativeTasks[taskId].download_url = downloadUrl;

        await addLocalHistoryItem({
          id: taskId,
          filename: actualFilename,
          title: title || 'YouTube Medya',
          thumbnail: thumbnail || '',
          type: type,
          quality: quality,
          download_url: downloadUrl,
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
    return nativeTasks[taskId];
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

export async function downloadFileToDevice(relativeUrl, filename, onProgress) {
  // Eğer zaten file:// protokolü ile yerel telefondaysa doğrudan paylaş
  if (relativeUrl.startsWith('file://')) {
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(relativeUrl);
    }
    return { success: true, uri: relativeUrl };
  }

  // FileSystem
  try {
    const cleanFilename = (filename || 'media').replace(/[\\/:*?"<>|]/g, '_').trim();
    const fileUri = `${FileSystem.documentDirectory}${cleanFilename}`;
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(fileUri);
    }
    return { success: true, uri: fileUri };
  } catch (err) {
    throw err;
  }
}
