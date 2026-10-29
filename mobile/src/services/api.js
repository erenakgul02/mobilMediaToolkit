import { Platform, NativeModules, DeviceEventEmitter } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { getServerUrl } from '../config';

const LOCAL_HISTORY_KEY = '@mobil_media_toolkit_local_downloads';
const YoutubeDLNative = NativeModules.YoutubeDLNative;

// In-memory native task status tracker for progress polling
const nativeTasks = {};

// Listen to native download progress events from Android Kotlin module
if (Platform.OS === 'android') {
  DeviceEventEmitter.addListener('onNativeDownloadProgress', (event) => {
    const { progress, eta, line } = event;
    const activeId = Object.keys(nativeTasks).find((id) => nativeTasks[id].status === 'downloading');
    if (activeId && nativeTasks[activeId]) {
      nativeTasks[activeId].progress = Math.round(progress);
      nativeTasks[activeId].eta = eta ? `${Math.round(eta)}s` : '';
      nativeTasks[activeId].speed = line ? line.slice(0, 30) : '';
    }
  });
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

export async function checkHealth(customUrl = null) {
  // If running with native module on Android, health is always OK!
  if (YoutubeDLNative) {
    return { status: 'online', native: true };
  }

  const baseUrl = customUrl || (await getServerUrl());
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 3500);

  try {
    const res = await fetch(`${baseUrl}/api/health`, {
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    clearTimeout(timeoutId);
    throw err;
  }
}

export async function fetchVideoInfo(url) {
  // 1. YouTube oEmbed (Hızlı, sunucusuz, HTTPS üzerinden doğrudan Google API)
  try {
    const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
    const res = await fetch(oembedUrl);
    if (res.ok) {
      const data = await res.json();
      return {
        title: data.title || 'YouTube Medya',
        thumbnail: data.thumbnail_url || '',
        author: data.author_name || 'YouTube',
        duration: 0,
        formats_audio: [
          { label: '320 kbps (Yüksek Kalite)', value: '320' },
          { label: '192 kbps (Standart Kalite)', value: '192' },
        ],
        formats_video: [
          { label: '1080p HD Video', value: '1080p' },
          { label: '720p HD Video', value: '720p' },
        ],
      };
    }
  } catch (e) {
    console.log('oEmbed fallbacking to native or backend:', e);
  }

  // 2. Native Module getVideoInfo
  if (YoutubeDLNative && YoutubeDLNative.getVideoInfo) {
    try {
      const nativeData = await YoutubeDLNative.getVideoInfo(url);
      return {
        title: nativeData.title || 'YouTube Medya',
        thumbnail: nativeData.thumbnail || '',
        author: nativeData.uploader || 'YouTube',
        duration: nativeData.duration || 0,
        formats_audio: [
          { label: '320 kbps (Yüksek Kalite)', value: '320' },
        ],
        formats_video: [
          { label: '1080p HD Video', value: '1080p' },
          { label: '720p HD Video', value: '720p' },
        ],
      };
    } catch (err) {
      console.warn('Native video info hatası:', err);
    }
  }

  // 3. Fallback to backend (Web / Geliştirici bilgisayarı)
  const baseUrl = await getServerUrl();
  const res = await fetch(`${baseUrl}/api/info`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Video bilgileri alınamadı.');
  }
  return data;
}

export async function startDownload({ url, type, quality, title, thumbnail }) {
  // Eğer Android telefon üzerindeysek ve yerel motor (Native Module) varsa:
  if (YoutubeDLNative && YoutubeDLNative.download) {
    const taskId = `native_${Date.now()}`;
    nativeTasks[taskId] = {
      id: taskId,
      status: 'downloading',
      progress: 0,
      speed: 'Başlatılıyor...',
      eta: '',
      filename: `${title || 'Medya'}.${type === 'mp3' ? 'mp3' : 'mp4'}`,
      isNative: true,
    };

    // Arka planda indirmeyi başlat
    (async () => {
      try {
        const result = await YoutubeDLNative.download(url, type, quality);
        nativeTasks[taskId].status = 'completed';
        nativeTasks[taskId].progress = 100;

        // Yerel geçmişe ekle
        const filename = `${title || 'YouTube Medya'}.${type === 'mp3' ? 'mp3' : 'mp4'}`;
        await addLocalHistoryItem({
          filename: filename,
          title: title || 'YouTube Medya',
          thumbnail: thumbnail || '',
          type: type,
          quality: quality,
          download_url: result.outputDir ? `file://${result.outputDir}/${filename}` : '',
          createdAt: new Date().toISOString(),
        });
      } catch (err) {
        nativeTasks[taskId].status = 'failed';
        nativeTasks[taskId].error = err.message || 'Yerel indirme başarısız oldu.';
      }
    })();

    return { taskId };
  }

  // Fallback to backend (Web veya sunucu modu)
  const baseUrl = await getServerUrl();
  const res = await fetch(`${baseUrl}/api/download`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, type, quality, title, thumbnail }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'İndirme başlatılamadı.');
  }
  return data;
}

export async function checkProgress(taskId) {
  if (nativeTasks[taskId]) {
    return nativeTasks[taskId];
  }

  const baseUrl = await getServerUrl();
  const res = await fetch(`${baseUrl}/api/progress/${taskId}`);
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'İlerleme durumu alınamadı.');
  }
  return data;
}

export async function fetchHistory() {
  // Cihaz içi geçmiş her zaman önceliklidir
  const localItems = await getLocalHistory();
  if (localItems && localItems.length > 0) {
    return localItems;
  }

  try {
    const baseUrl = await getServerUrl();
    const res = await fetch(`${baseUrl}/api/history`);
    if (res.ok) {
      return await res.json();
    }
  } catch (e) {}

  return [];
}

export async function deleteHistoryItem(filename) {
  await deleteLocalHistoryItem(filename);
  try {
    const baseUrl = await getServerUrl();
    await fetch(`${baseUrl}/api/history/${encodeURIComponent(filename)}`, {
      method: 'DELETE',
    });
  } catch (e) {}
  return { success: true };
}

export async function downloadFileToDevice(relativeUrl, filename, onProgress) {
  if (Platform.OS === 'web') {
    const baseUrl = await getServerUrl();
    const fullUrl = `${baseUrl}${relativeUrl.startsWith('/') ? '' : '/'}${relativeUrl}`;
    try {
      const link = document.createElement('a');
      link.href = fullUrl;
      link.setAttribute('download', filename);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      return { success: true, mode: 'web-download' };
    } catch (e) {
      window.open(fullUrl, '_blank');
      return { success: true, mode: 'web-open' };
    }
  }

  // Eğer zaten file:// protokolü ile yerel telefondaysa doğrudan paylaş
  if (relativeUrl.startsWith('file://')) {
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(relativeUrl);
    }
    return { success: true, uri: relativeUrl };
  }

  // Mobil Cihaz FileSystem üzerinden indirme
  try {
    const baseUrl = await getServerUrl();
    const fullUrl = `${baseUrl}${relativeUrl.startsWith('/') ? '' : '/'}${relativeUrl}`;
    const fileUri = `${FileSystem.documentDirectory}${filename}`;
    const downloadResumable = FileSystem.createDownloadResumable(
      fullUrl,
      fileUri,
      {},
      (downloadProgress) => {
        if (onProgress && downloadProgress.totalBytesExpectedToWrite > 0) {
          const progress =
            downloadProgress.totalBytesWritten / downloadProgress.totalBytesExpectedToWrite;
          onProgress(Math.round(progress * 100));
        }
      }
    );

    const result = await downloadResumable.downloadAsync();
    if (result && result.uri) {
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(result.uri);
      }
      return { success: true, uri: result.uri };
    }
    throw new Error('Dosya indirilemedi.');
  } catch (err) {
    console.error('Mobil dosya indirme hatası:', err);
    throw err;
  }
}
