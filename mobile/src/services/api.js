import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { getServerUrl } from '../config';

const LOCAL_HISTORY_KEY = '@mobil_media_toolkit_local_downloads';

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
  return data; // { taskId: '...' }
}

export async function checkProgress(taskId) {
  const baseUrl = await getServerUrl();
  const res = await fetch(`${baseUrl}/api/progress/${taskId}`);
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'İlerleme durumu alınamadı.');
  }
  return data;
}

export async function fetchHistory() {
  const baseUrl = await getServerUrl();
  const res = await fetch(`${baseUrl}/api/history`);
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Geçmiş alınamadı.');
  }
  return data;
}

export async function deleteHistoryItem(filename) {
  const baseUrl = await getServerUrl();
  const res = await fetch(`${baseUrl}/api/history/${encodeURIComponent(filename)}`, {
    method: 'DELETE',
  });
  return await res.json();
}

/**
 * Dosyayı cihaz hafızasına indirir veya paylaşır.
 * Web ortamında doğrudan tarayıcı indirmesi tetikler.
 * Android / iOS'ta FileSystem ile indirip Paylaş/Kaydet açar.
 */
export async function downloadFileToDevice(relativeUrl, filename, onProgress) {
  const baseUrl = await getServerUrl();
  let fullUrl = relativeUrl;

  if (!fullUrl.startsWith('http')) {
    const slash = relativeUrl.startsWith('/') ? '' : '/';
    if (relativeUrl.includes('/api/download-direct/')) {
      const parts = relativeUrl.split('/api/download-direct/');
      fullUrl = `${baseUrl}/api/download-direct/${encodeURIComponent(decodeURIComponent(parts[1]))}`;
    } else {
      fullUrl = `${baseUrl}${slash}${relativeUrl}`;
    }
  } else {
    try {
      fullUrl = encodeURI(decodeURI(fullUrl));
    } catch (e) {}
  }

  if (Platform.OS === 'web') {
    // Tarayıcı ortamında doğrudan link oluşturup tıkla
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

  // Mobil Cihaz (Android / iOS)
  try {
    const cleanFilename = (filename || 'media')
      .replace(/[\\/:*?"<>|]/g, '_')
      .trim();
    const fileUri = `${FileSystem.documentDirectory}${cleanFilename}`;
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
