import { youtubeVideoId, downloadKey, publishedMediaName } from './downloadIdentity';
import { Platform, NativeModules, DeviceEventEmitter, PermissionsAndroid } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';

const LOCAL_HISTORY_KEY = '@mobil_media_toolkit_local_downloads';
const PLAYLISTS_STORAGE_KEY = '@mobil_media_toolkit_playlists';
const THEME_STORAGE_KEY = '@mobil_media_toolkit_theme';
const DEFAULT_PRESET_STORAGE_KEY = '@mobil_media_toolkit_default_preset';
const QUEUE_STORAGE_KEY = '@mobil_media_toolkit_download_queue_v1';
const WIFI_ONLY_STORAGE_KEY = '@mobil_media_toolkit_wifi_only';

let wifiOnlyEnabledMemory = false;

export const DOWNLOAD_PRESETS = [
  {
    id: 'm4a_high',
    type: 'm4a',
    quality: 'high',
    shortLabel: 'M4A Yüksek',
    fullLabel: 'M4A Yüksek Kalite (Ses)',
    icon: /** @type {const} */ ('musical-notes'),
  },
  {
    id: 'm4a_128',
    type: 'm4a',
    quality: '128',
    shortLabel: 'M4A Standart',
    fullLabel: 'M4A Standart (Ses)',
    icon: /** @type {const} */ ('musical-note-outline'),
  },
  {
    id: 'mp4_1080p',
    type: 'mp4',
    quality: '1080p',
    shortLabel: 'MP4 1080p HD',
    fullLabel: 'MP4 1080p Full HD (Video)',
    icon: /** @type {const} */ ('videocam'),
  },
  {
    id: 'mp4_720p',
    type: 'mp4',
    quality: '720p',
    shortLabel: 'MP4 720p HD',
    fullLabel: 'MP4 720p HD (Video)',
    icon: /** @type {const} */ ('videocam-outline'),
  },
];

export async function getDefaultDownloadPreset() {
  try {
    const savedId = await AsyncStorage.getItem(DEFAULT_PRESET_STORAGE_KEY);
    if (savedId) {
      const found = DOWNLOAD_PRESETS.find((p) => p.id === savedId);
      if (found) return found;
    }
  } catch (e) {
    console.warn('Varsayılan indirme tercihi okunamadı:', e);
  }
  return DOWNLOAD_PRESETS[0]; // Varsayılan: M4A Yüksek Kalite
}

export async function setDefaultDownloadPreset(presetId) {
  try {
    await AsyncStorage.setItem(DEFAULT_PRESET_STORAGE_KEY, presetId);
  } catch (e) {
    console.warn('Varsayılan indirme tercihi kaydedilemedi:', e);
  }
  return DOWNLOAD_PRESETS.find((p) => p.id === presetId) || DOWNLOAD_PRESETS[0];
}

export async function getWifiOnlyMode() {
  try {
    const val = await AsyncStorage.getItem(WIFI_ONLY_STORAGE_KEY);
    wifiOnlyEnabledMemory = val === 'true';
    return wifiOnlyEnabledMemory;
  } catch (_) {
    return false;
  }
}

export async function setWifiOnlyMode(enabled) {
  wifiOnlyEnabledMemory = Boolean(enabled);
  try {
    await AsyncStorage.setItem(WIFI_ONLY_STORAGE_KEY, wifiOnlyEnabledMemory ? 'true' : 'false');
  } catch (e) {
    console.warn('Wi-Fi modu kaydedilemedi:', e);
  }
  if (!wifiOnlyEnabledMemory) {
    processDownloadQueue();
  }
  return wifiOnlyEnabledMemory;
}

export async function checkWifiConnected() {
  if (Platform.OS === 'android' && YoutubeDLNative && YoutubeDLNative.isWifiConnected) {
    try {
      return await YoutubeDLNative.isWifiConnected();
    } catch (_) {
      return true;
    }
  }
  return true;
}

const YoutubeDLNative = NativeModules.YoutubeDLNative;

// Yerel (Native) görev durumu ve sıralı indirme kuyruğu takipçisi
const nativeTasks = {};
const downloadQueue = [];
const taskOrderList = [];
let currentActiveTaskId = null;
let isProcessingQueue = false;

let queueInitialization = null;
let queueWrites = Promise.resolve();
let enqueueChain = Promise.resolve();

function persistQueue() {
  const snapshot = JSON.stringify(taskOrderList.map((id) => nativeTasks[id]).filter(Boolean));
  const write = queueWrites.catch(() => {}).then(() => AsyncStorage.setItem(QUEUE_STORAGE_KEY, snapshot));
  queueWrites = write;
  return write;
}

export function initializeDownloadQueue() {
  if (!queueInitialization) {
    queueInitialization = (async () => {
      await getWifiOnlyMode();
      const raw = await AsyncStorage.getItem(QUEUE_STORAGE_KEY);
      let saved = [];
      try { saved = raw ? JSON.parse(raw) : []; } catch { saved = []; }
      const ordered = (Array.isArray(saved) ? saved : []).filter(Boolean).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
      for (const entry of ordered) {
        if (!entry || typeof entry.id !== 'string' || !/^native_[A-Za-z0-9_]+$/.test(entry.id) || !youtubeVideoId(entry.cleanUrl) || nativeTasks[entry.id]) continue;
        const task = { ...entry };
        if (['downloading', 'processing'].includes(task.status)) {
          task.status = 'paused';
          task.error = 'İndirme yarım kaldı. Devam edebilirsiniz.';
        }
        if (!['queued', 'paused', 'completed', 'failed'].includes(task.status)) continue;
        nativeTasks[task.id] = task;
        taskOrderList.push(task.id);
      }
      // Both display and execution use the original enqueue order (FIFO).
      downloadQueue.push(...taskOrderList.filter((id) => nativeTasks[id].status === 'queued'));
    })().catch((error) => { queueInitialization = null; throw error; });
  }
  return queueInitialization;
}

export async function restoreDownloads() {
  await initializeDownloadQueue();
  void processDownloadQueue();
}

export async function resumeDownload(taskId) {
  await initializeDownloadQueue();
  const task = nativeTasks[taskId];
  if (!task || !['paused', 'failed'].includes(task.status)) return;
  task.status = 'queued';
  task.error = '';
  if (!downloadQueue.includes(taskId)) downloadQueue.push(taskId);
  try { await persistQueue(); }
  catch (error) {
    const index = downloadQueue.indexOf(taskId);
    if (index >= 0) downloadQueue.splice(index, 1);
    task.status = 'paused';
    task.error = 'İndirme sırası kaydedilemedi. Tekrar deneyin.';
    throw error;
  }
  void processDownloadQueue();
}

// Android Kotlin motorundan gelen indirme ilerleme olaylarını dinle
if (Platform.OS === 'android') {
  DeviceEventEmitter.addListener('onNativeDownloadProgress', (event) => {
    const { progress, eta, line } = event;
    const activeId =
      currentActiveTaskId ||
      Object.keys(nativeTasks).find((id) => nativeTasks[id].status === 'downloading');
    if (activeId && nativeTasks[activeId]) {
      nativeTasks[activeId].progress = Math.round(progress);
      nativeTasks[activeId].eta = eta && eta > 0 ? `${Math.round(eta)}s` : '';
      nativeTasks[activeId].speed = line ? line.slice(0, 38) : '';
    }
  });
}

// ==========================================
// GECE MODU (TEMA) YÖNETİMİ
// ==========================================

export async function getThemeMode() {
  try {
    const val = await AsyncStorage.getItem(THEME_STORAGE_KEY);
    return val === 'dark';
  } catch (_) {
    return false;
  }
}

export async function setThemeMode(isDark) {
  try {
    await AsyncStorage.setItem(THEME_STORAGE_KEY, isDark ? 'dark' : 'light');
  } catch (e) {
    console.warn('Tema tercihi kaydedilemedi:', e);
  }
}

// ==========================================
// ÖZEL ÇALMA LİSTELERİ (PLAYLIST) YÖNETİMİ
// ==========================================

export async function getPlaylists() {
  try {
    const raw = await AsyncStorage.getItem(PLAYLISTS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch (e) {
    console.warn('Çalma listeleri okunamadı:', e);
  }
  return [];
}

async function savePlaylists(list) {
  try {
    await AsyncStorage.setItem(PLAYLISTS_STORAGE_KEY, JSON.stringify(list));
  } catch (e) {
    console.warn('Çalma listeleri kaydedilemedi:', e);
  }
}

export async function createPlaylist(name, initialTrackFilenames = []) {
  const cleanName = (name || '').trim();
  if (!cleanName) {
    throw new Error('Lütfen çalma listesi için bir isim girin.');
  }
  const existing = await getPlaylists();
  const newPlaylist = {
    id: `pl_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    name: cleanName,
    createdAt: new Date().toISOString(),
    trackFilenames: Array.from(new Set(initialTrackFilenames.filter(Boolean))),
  };
  const updated = [newPlaylist, ...existing];
  await savePlaylists(updated);
  return { playlist: newPlaylist, playlists: updated };
}

export async function deletePlaylist(playlistId) {
  const existing = await getPlaylists();
  const updated = existing.filter((p) => p.id !== playlistId);
  await savePlaylists(updated);
  return updated;
}

export async function renamePlaylist(playlistId, newName) {
  const cleanName = (newName || '').trim();
  if (!cleanName) {
    throw new Error('Lütfen çalma listesi için geçerli bir isim girin.');
  }
  const existing = await getPlaylists();
  const updated = existing.map((pl) =>
    pl.id === playlistId ? { ...pl, name: cleanName } : pl
  );
  await savePlaylists(updated);
  return updated;
}

export async function toggleTrackInPlaylist(playlistId, filename) {
  if (!playlistId || !filename) return await getPlaylists();
  const existing = await getPlaylists();
  const updated = existing.map((pl) => {
    if (pl.id !== playlistId) return pl;
    const current = Array.isArray(pl.trackFilenames) ? pl.trackFilenames : [];
    const exists = current.includes(filename);
    const nextTracks = exists
      ? current.filter((f) => f !== filename)
      : [...current, filename];
    return {
      ...pl,
      trackFilenames: nextTracks,
    };
  });
  await savePlaylists(updated);
  return updated;
}

// ==========================================
// YARDIMCI FORMAT FONKSİYONLARI
// ==========================================

function normalizeUrl(rawUrl) {
  let u = (rawUrl || '').trim();
  if (!u) return '';
  if (u.startsWith('http://') || u.startsWith('https://')) {
    return u;
  }
  if (u.includes('youtube.com') || u.includes('youtu.be')) {
    return 'https://' + u;
  }
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

let historyWrites = Promise.resolve();
function withHistoryWrite(operation) {
  const pending = historyWrites.catch(() => {}).then(operation);
  historyWrites = pending.catch(() => {});
  return pending;
}

async function readHistoryForUpdate() {
  const raw = await AsyncStorage.getItem(LOCAL_HISTORY_KEY);
  const history = raw ? JSON.parse(raw) : [];
  if (!Array.isArray(history)) throw new Error('Arşiv kaydı okunamadı; mevcut kayıt değiştirilmedi.');
  return history;
}

async function ensureSharedStoragePermission() {
  if (Platform.OS !== 'android' || Platform.Version > 29 || !Platform.Version) return;
  const permissions = Platform.Version <= 28
    ? [PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE, PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE]
    : [PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE];
  const results = await PermissionsAndroid.requestMultiple(permissions);
  if (permissions.some((permission) => results[permission] !== PermissionsAndroid.RESULTS.GRANTED)) {
    throw new Error('Dosyaların ortak İndirilenler klasörüne kaydedilmesi için depolama izni gerekiyor.');
  }
}

function sameFileLocation(a, b) {
  if (!a || !b) return false;
  try { return decodeURI(a) === decodeURI(b); } catch { return a === b; }
}

export async function scanArchiveFolder(chooseFolder = false) {
  if (Platform.OS !== 'android' || !YoutubeDLNative?.scanArchiveFolder) {
    throw new Error('Klasör tarama için güncel Android APK gerekli.');
  }
  await ensureSharedStoragePermission();
  const result = await YoutubeDLNative.scanArchiveFolder(chooseFolder);
  if (result.cancelled) return { ...result, added: 0, updated: 0 };
  return withHistoryWrite(async () => {
    const history = await readHistoryForUpdate();
    const merged = [...history];
    const renamed = new Map();
    let added = 0;
    let updated = 0;
    for (const candidate of result.items || []) {
      const { originalDownloadUrl, originalFilename: _originalFilename, modifiedAt, ...item } = candidate;
      if (!item.filename || !item.download_url) continue;
      const originalIndex = originalDownloadUrl ? merged.findIndex((existing) => sameFileLocation(existing.download_url, originalDownloadUrl)) : -1;
      const index = originalIndex >= 0 ? originalIndex : merged.findIndex((existing) =>
        publishedMediaName(existing.filename) === item.filename || sameFileLocation(existing.download_url, item.download_url));
      if (index >= 0) {
        const existing = merged[index];
        if (existing.filename !== item.filename) renamed.set(existing.filename, item.filename);
        if (existing.download_url !== item.download_url || existing.filesize !== item.filesize) updated++;
        merged[index] = { ...item, ...existing, filename: item.filename, download_url: item.download_url, filesize: item.filesize };
      } else {
        merged.push({ ...item, createdAt: new Date(modifiedAt || Date.now()).toISOString(), date: 'Dosyadan eklendi' });
        added++;
      }
    }
    const unique = merged.filter((item, index) => merged.findIndex((other) => other.filename === item.filename) === index);
    if (renamed.size) {
      const rawPlaylists = await AsyncStorage.getItem(PLAYLISTS_STORAGE_KEY);
      const playlists = rawPlaylists ? JSON.parse(rawPlaylists) : [];
      if (!Array.isArray(playlists)) throw new Error('Çalma listeleri okunamadı; kayıtlar değiştirilmedi.');
      const updatedPlaylists = playlists.map((playlist) => ({ ...playlist,
        trackFilenames: [...new Set((playlist.trackFilenames || []).map((name) => renamed.get(name) || name))],
      }));
      await AsyncStorage.multiSet([
        [LOCAL_HISTORY_KEY, JSON.stringify(unique)],
        [PLAYLISTS_STORAGE_KEY, JSON.stringify(updatedPlaylists)],
      ]);
    } else await AsyncStorage.setItem(LOCAL_HISTORY_KEY, JSON.stringify(unique));
    return { ...result, items: unique, added, updated };
  });
}

export async function addLocalHistoryItem(item) {
  return withHistoryWrite(async () => {
    try {
      const existing = await readHistoryForUpdate();
      const filtered = existing.filter((i) => i.filename !== item.filename);
      const updated = [item, ...filtered];
      await AsyncStorage.setItem(LOCAL_HISTORY_KEY, JSON.stringify(updated));
      return updated;
    } catch (e) {
      console.warn('Lokal geçmişe eklenemedi:', e);
      throw e;
    }
  });
}

export async function deleteLocalHistoryItem(filename, fileUrlOrPath = '') {
  return withHistoryWrite(async () => {
    try {
      const existing = await readHistoryForUpdate();
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

      // 2. Çalma listelerinde bu dosya varsa temizle
      try {
        const playlists = await getPlaylists();
        const updatedPlaylists = playlists.map((pl) => ({
          ...pl,
          trackFilenames: (pl.trackFilenames || []).filter((f) => f !== filename),
        }));
        await savePlaylists(updatedPlaylists);
      } catch (plErr) {
        console.warn('Playlist temizleme uyarısı:', plErr);
      }

      // 3. Uygulama içi geçmiş listesinden kaldır
      const updated = existing.filter((i) => i.filename !== filename);
      await AsyncStorage.setItem(LOCAL_HISTORY_KEY, JSON.stringify(updated));
      return updated;
    } catch (e) {
      console.warn('Lokal geçmişten silinemedi:', e);
      return [];
    }
  });
}


export async function checkHealth() {
  return { status: 'online', native: true };
}

export async function fetchVideoInfo(url) {
  const cleanUrl = normalizeUrl(url);
  if (!cleanUrl) {
    throw new Error('Lütfen bir YouTube linki yapıştırın.');
  }

  // 1. Önce Cihaz İçi NewPipeExtractor Motoru
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

export function isYouTubePlaylistUrl(rawInput) {
  const s = (rawInput || '').trim();
  if (!s) return false;
  if (/youtube\.com\/playlist\?list=/i.test(s)) return true;
  if (/[?&]list=[a-zA-Z0-9_-]+/i.test(s) && !/start_radio=1/i.test(s)) return true;
  return false;
}

export async function fetchYouTubePlaylistInfo(url) {
  let cleanUrl = normalizeUrl(url);
  // Eğer hem watch?v= hem list= varsa ve kullanıcı playlist analizi istediyse list ID'yi ayıkla
  const listMatch = cleanUrl.match(/[?&]list=([a-zA-Z0-9_-]+)/);
  if (listMatch && listMatch[1] && !cleanUrl.includes('/playlist?list=')) {
    cleanUrl = `https://www.youtube.com/playlist?list=${listMatch[1]}`;
  }

  if (YoutubeDLNative && YoutubeDLNative.getPlaylistInfo) {
    const data = await YoutubeDLNative.getPlaylistInfo(cleanUrl);
    const items = Array.isArray(data?.items)
      ? data.items.map((item, idx) => ({
          id: `pl_item_${idx}_${item.url || ''}`,
          title: item.title || `Parça ${idx + 1}`,
          url: item.url || '',
          thumbnail: item.thumbnail || data.thumbnail || '',
          author: item.uploader || data.uploader || 'YouTube',
          channel: item.uploader || data.uploader || 'YouTube',
          duration: formatDuration(item.duration),
        }))
      : [];

    if (items.length === 0) {
      throw new Error('Bu oynatma listesinde indirilebilir video bulunamadı.');
    }

    return {
      title: data.title || 'YouTube Oynatma Listesi',
      uploader: data.uploader || 'YouTube',
      thumbnail: data.thumbnail || items[0]?.thumbnail || '',
      itemCount: items.length,
      items,
    };
  }

  throw new Error('Playlist indirme özelliği yalnızca güncel Android APK üzerinde desteklenir.');
}

// ==========================================
// SIRALI İNDİRME KUYRUĞU (BEKLEYEN İNDİRMELER)
// ==========================================

async function processDownloadQueue() {
  if (isProcessingQueue || !YoutubeDLNative?.downloadResumable) return;
  isProcessingQueue = true;
  try {
    while (downloadQueue.length > 0) {
      const nextTaskId = downloadQueue[0];
      const task = nativeTasks[nextTaskId];
      if (!task || task.status === 'cancelled') { downloadQueue.shift(); continue; }
      if (wifiOnlyEnabledMemory && !(await checkWifiConnected())) {
        task.speed = 'Wi-Fi bekleniyor';
        await new Promise((resolve) => setTimeout(resolve, 2500));
        continue;
      }
      // Cancellation may happen while the Wi-Fi check is awaiting native code.
      if (task.status !== 'queued') continue;
      downloadQueue.shift();
      currentActiveTaskId = nextTaskId;
      task.status = 'downloading';
      task.speed = 'Bağlanıyor...';
      task.error = '';
      try {
        // Save before starting native work so process death cannot lose the job.
        await persistQueue();
        await ensureSharedStoragePermission();
        const result = await YoutubeDLNative.downloadResumable(task.cleanUrl, task.type, task.quality, task.id);
        task.filename = result.fileName;
        task.download_url = `file://${result.filePath}`;
        task.filesize = result.fileSize || '';
        await addLocalHistoryItem({
          id: task.id, videoId: youtubeVideoId(task.cleanUrl), sourceUrl: task.cleanUrl,
          filename: task.filename, title: task.title, uploader: task.uploader,
          thumbnail: task.thumbnail, type: task.type, quality: task.quality,
          filesize: task.filesize, download_url: task.download_url,
          date: 'Bugün', createdAt: new Date().toISOString(),
        });
        task.status = 'completed';
        task.progress = 100;
        task.speed = 'Tamamlandı';
        task.eta = '';
        await persistQueue();
        // Keep native completion receipts until the user clears the task. This also
        // covers a JS crash between file publication and history persistence.
      } catch (error) {
        task.status = 'paused';
        task.error = error?.message || 'İndirme kesildi. Devam edebilirsiniz.';
        task.speed = '';
        task.eta = '';
        await persistQueue().catch((err) => console.warn('Kuyruk kaydedilemedi:', err));
      }
      currentActiveTaskId = null;
    }
  } finally {
    currentActiveTaskId = null;
    isProcessingQueue = false;
  }
}

export function startDownload(options) {
  // Serialize duplicate checking and enqueueing, including fast repeated taps.
  const result = enqueueChain.catch(() => {}).then(() => enqueueDownload(options));
  enqueueChain = result.then(() => {}, () => {});
  return result;
}

async function enqueueDownload({ url, type, quality, title, thumbnail, uploader, force = false }) {
  await initializeDownloadQueue();
  const videoId = youtubeVideoId(url);
  if (!videoId) throw new Error('Geçerli bir YouTube video bağlantısı girin.');
  const cleanUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const mediaType = type === 'mp4' ? 'mp4' : 'm4a';
  if (!YoutubeDLNative?.downloadResumable) throw new Error('Bu özellik için güncel Android APK dosyasını yükleyin.');
  const key = downloadKey(cleanUrl, mediaType, quality);
  const existing = Object.values(nativeTasks).find((task) =>
    ['queued', 'downloading', 'paused', 'failed'].includes(task.status) && downloadKey(task.cleanUrl, task.type, task.quality) === key);
  if (existing) {
    if (['paused', 'failed'].includes(existing.status)) await resumeDownload(existing.id);
    return { taskId: existing.id, alreadyQueued: true, queued: true, duplicate: null };
  }
  if (!force) {
    for (const item of await getLocalHistory()) {
      // Older history records have no source ID; never guess from titles.
      if ((item.videoId || youtubeVideoId(item.sourceUrl)) !== videoId) continue;
      const exists = await YoutubeDLNative.mediaFileExists(item.download_url || '', item.filename || '');
      if (exists) return { duplicate: item, taskId: null, alreadyQueued: false, queued: false };
    }
  }
  const taskId = `native_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const wasBusy = isProcessingQueue || downloadQueue.length > 0;
  nativeTasks[taskId] = {
    id: taskId, cleanUrl, videoId, status: 'queued', progress: 0,
    speed: 'Sırada', eta: '', error: '', title: title || 'YouTube Medya',
    uploader: uploader || 'YouTube', thumbnail: thumbnail || '', type: mediaType,
    quality, filename: '', download_url: '', filesize: '', isNative: true, createdAt: Date.now(),
  };
  taskOrderList.push(taskId);
  downloadQueue.push(taskId);
  try { await persistQueue(); }
  catch (error) {
    delete nativeTasks[taskId];
    taskOrderList.splice(taskOrderList.indexOf(taskId), 1);
    downloadQueue.splice(downloadQueue.indexOf(taskId), 1);
    throw error;
  }
  void processDownloadQueue();
  return { taskId, queued: wasBusy, alreadyQueued: false, duplicate: null };
}

export async function checkProgress(taskId) {
  if (nativeTasks[taskId]) {
    const t = nativeTasks[taskId];
    const queueIndex = downloadQueue.indexOf(taskId);
    return {
      ...t,
      queuePosition: queueIndex >= 0 ? queueIndex + 1 : 0,
    };
  }
  return { status: 'failed', error: 'Görev bulunamadı.' };
}

export function getDownloadQueueState() {
  const tasks = [];
  for (const id of taskOrderList) {
    const t = nativeTasks[id];
    if (!t || t.status === 'cancelled') continue;
    const queueIndex = downloadQueue.indexOf(id);
    tasks.push({
      ...t,
      queuePosition: queueIndex >= 0 ? queueIndex + 1 : 0,
    });
  }
  return {
    isBusy: isProcessingQueue || downloadQueue.length > 0,
    activeCount: isProcessingQueue ? 1 : 0,
    queuedCount: downloadQueue.length,
    tasks,
  };
}

export async function cancelQueuedDownload(taskId) {
  const task = nativeTasks[taskId];
  if (!task || !['queued', 'paused', 'failed'].includes(task.status)) return getDownloadQueueState();
  task.status = 'cancelled';
  const index = downloadQueue.indexOf(taskId);
  if (index >= 0) downloadQueue.splice(index, 1);
  const order = taskOrderList.indexOf(taskId);
  if (order >= 0) taskOrderList.splice(order, 1);
  await persistQueue();
  delete nativeTasks[taskId];
  await YoutubeDLNative?.discardDownload?.(taskId);
  return getDownloadQueueState();
}

export async function clearCompletedDownloadsFromQueue() {
  const cleared = taskOrderList.filter((id) => nativeTasks[id]?.status === 'completed');
  for (const id of cleared) taskOrderList.splice(taskOrderList.indexOf(id), 1);
  await persistQueue();
  for (const id of cleared) {
    delete nativeTasks[id];
    await YoutubeDLNative?.discardDownload?.(id);
  }
  return getDownloadQueueState();
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
      item?.uploader || 'Media Toolkit',
      await getThemeMode()
    );
  }
  return await downloadFileToDevice(item?.download_url, item?.filename, 'open');
}

export async function downloadFileToDevice(fileUrlOrPath, filename, actionType = 'open') {
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

export async function previewYouTubeAudio({ url, title, uploader, thumbnail }) {
  const cleanUrl = normalizeUrl(url);
  if (!cleanUrl) {
    throw new Error('Önizlenecek medya bağlantısı bulunamadı.');
  }
  if (Platform.OS === 'android' && YoutubeDLNative && YoutubeDLNative.previewAudio) {
    await requestNotificationPermissionIfNeeded();
    return await YoutubeDLNative.previewAudio(
      cleanUrl,
      title || 'Şarkı Önizleme',
      uploader || 'YouTube',
      thumbnail || ''
    );
  }
  throw new Error('Şarkı önizleme özelliği yalnızca güncel Android APK üzerinde desteklenir.');
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

export async function toggleShuffleAudio() {
  if (Platform.OS === 'android' && YoutubeDLNative && YoutubeDLNative.toggleShuffle) {
    return await YoutubeDLNative.toggleShuffle();
  }
  return false;
}

export async function cycleRepeatModeAudio() {
  if (Platform.OS === 'android' && YoutubeDLNative && YoutubeDLNative.cycleRepeatMode) {
    return await YoutubeDLNative.cycleRepeatMode();
  }
  return 'OFF';
}

export async function setSleepTimerAudio(minutes, stopAtTrackEnd = false) {
  if (Platform.OS === 'android' && YoutubeDLNative && YoutubeDLNative.setSleepTimer) {
    return await YoutubeDLNative.setSleepTimer(Number(minutes) || 0, Boolean(stopAtTrackEnd));
  }
  return false;
}

export async function setPlaybackSpeedAudio(speed) {
  if (Platform.OS === 'android' && YoutubeDLNative && YoutubeDLNative.setPlaybackSpeed) {
    return await YoutubeDLNative.setPlaybackSpeed(Number(speed) || 1.0);
  }
  return false;
}

export async function setAudioPresetAudio(preset) {
  if (Platform.OS === 'android' && YoutubeDLNative && YoutubeDLNative.setAudioPreset) {
    return await YoutubeDLNative.setAudioPreset(String(preset || 'NORMAL'));
  }
  return false;
}

export async function fetchDeviceStorageStats() {
  if (Platform.OS === 'android' && YoutubeDLNative && YoutubeDLNative.getStorageStats) {
    try {
      return await YoutubeDLNative.getStorageStats();
    } catch (_) {
      return null;
    }
  }
  return null;
}

export async function trimAudioClip({ item, startSec, endSec, setAsRingtone = false }) {
  if (Platform.OS === 'android' && YoutubeDLNative && YoutubeDLNative.trimAudioFile) {
    await ensureSharedStoragePermission();
    const res = await YoutubeDLNative.trimAudioFile(
      item?.download_url || '',
      item?.filename || '',
      Number(startSec) || 0,
      Number(endSec) || 30,
      Boolean(setAsRingtone)
    );

    if (res && res.fileName) {
      const downloadUrl = res.filePath ? `file://${res.filePath}` : '';
      const trimmedEntry = {
        id: `trim_${Date.now()}`,
        filename: res.fileName,
        title: `${item?.title || item?.filename || 'Şarkı'} (Kesit ${Math.floor(startSec)}s-${Math.floor(endSec)}s)`,
        uploader: item?.uploader || 'Media Toolkit',
        thumbnail: item?.thumbnail || '',
        type: 'm4a',
        quality: 'high',
        filesize: res.fileSize || '',
        download_url: downloadUrl,
        date: 'Bugün',
        createdAt: new Date().toISOString(),
      };
      await addLocalHistoryItem(trimmedEntry);
    }

    return res;
  }
  throw new Error('Ses kırpıcı yalnızca güncel Android APK üzerinde desteklenir.');
}
