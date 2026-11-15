import { Platform, NativeModules, DeviceEventEmitter, PermissionsAndroid } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';

const LOCAL_HISTORY_KEY = '@mobil_media_toolkit_local_downloads';
const PLAYLISTS_STORAGE_KEY = '@mobil_media_toolkit_playlists';
const THEME_STORAGE_KEY = '@mobil_media_toolkit_theme';
const DEFAULT_PRESET_STORAGE_KEY = '@mobil_media_toolkit_default_preset';

export const DOWNLOAD_PRESETS = [
  {
    id: 'm4a_high',
    type: 'm4a',
    quality: 'high',
    shortLabel: 'M4A Yüksek',
    fullLabel: 'M4A Yüksek Kalite (Ses)',
    icon: 'musical-notes',
  },
  {
    id: 'm4a_128',
    type: 'm4a',
    quality: '128',
    shortLabel: 'M4A Standart',
    fullLabel: 'M4A Standart (Ses)',
    icon: 'musical-note-outline',
  },
  {
    id: 'mp4_1080p',
    type: 'mp4',
    quality: '1080p',
    shortLabel: 'MP4 1080p HD',
    fullLabel: 'MP4 1080p Full HD (Video)',
    icon: 'videocam',
  },
  {
    id: 'mp4_720p',
    type: 'mp4',
    quality: '720p',
    shortLabel: 'MP4 720p HD',
    fullLabel: 'MP4 720p HD (Video)',
    icon: 'videocam-outline',
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

const YoutubeDLNative = NativeModules.YoutubeDLNative;

// Yerel (Native) görev durumu ve sıralı indirme kuyruğu takipçisi
const nativeTasks = {};
const downloadQueue = [];
const taskOrderList = [];
let currentActiveTaskId = null;
let isProcessingQueue = false;

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
  } catch (e) {
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

// ==========================================
// SIRALI İNDİRME KUYRUĞU (BEKLEYEN İNDİRMELER)
// ==========================================

async function processDownloadQueue() {
  if (isProcessingQueue) return;
  isProcessingQueue = true;

  while (downloadQueue.length > 0) {
    const nextTaskId = downloadQueue.shift();
    const task = nativeTasks[nextTaskId];
    if (!task || task.status === 'cancelled') {
      continue;
    }

    currentActiveTaskId = nextTaskId;
    task.status = 'downloading';
    task.progress = 0;
    task.speed = 'Başlatılıyor...';
    task.eta = '';

    try {
      const result = await YoutubeDLNative.download(
        task.cleanUrl,
        task.type,
        task.quality
      );
      const actualFilename = result.fileName || task.filename;
      const downloadUrl = result.filePath
        ? `file://${result.filePath}`
        : result.outputDir
        ? `file://${result.outputDir}/${actualFilename}`
        : '';
      const filesize = result.fileSize || '';

      task.status = 'completed';
      task.progress = 100;
      task.filename = actualFilename;
      task.download_url = downloadUrl;
      task.filesize = filesize;
      task.speed = 'Tamamlandı';
      task.eta = '';

      await addLocalHistoryItem({
        id: nextTaskId,
        filename: actualFilename,
        title: task.title || 'YouTube Medya',
        uploader: task.uploader || 'YouTube',
        thumbnail: task.thumbnail || '',
        type: task.type,
        quality: task.quality,
        filesize: filesize,
        download_url: downloadUrl,
        date: 'Bugün',
        createdAt: new Date().toISOString(),
      });
    } catch (err) {
      console.error('Native indirme hatası:', err);
      task.status = 'failed';
      task.error =
        (err && (err.message || err.toString())) || 'Yerel indirme başarısız oldu.';
    }

    currentActiveTaskId = null;
  }

  isProcessingQueue = false;
}

export async function startDownload({ url, type, quality, title, thumbnail, uploader }) {
  const cleanUrl = normalizeUrl(url);
  const isAudio = type === 'm4a' || type === 'mp3';
  const ext = isAudio ? 'm4a' : 'mp4';

  if (YoutubeDLNative && YoutubeDLNative.download) {
    const taskId = `native_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const defaultFilename = `${(title || 'YouTube_Medya').replace(/[\\/:*?"<>|]/g, '_')}.${ext}`;
    const wasBusy = isProcessingQueue || downloadQueue.length > 0;

    nativeTasks[taskId] = {
      id: taskId,
      cleanUrl,
      status: 'queued',
      progress: 0,
      speed: wasBusy ? 'Sırada bekliyor...' : 'Başlatılıyor...',
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
      createdAt: Date.now(),
    };

    taskOrderList.unshift(taskId);
    downloadQueue.push(taskId);
    processDownloadQueue();

    return { taskId, queued: wasBusy };
  }

  throw new Error('Cihaz içi indirme motoru bulunamadı. Lütfen güncel APK dosyasını yükleyin.');
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

export function cancelQueuedDownload(taskId) {
  const idx = downloadQueue.indexOf(taskId);
  if (idx >= 0) {
    downloadQueue.splice(idx, 1);
  }
  if (nativeTasks[taskId] && nativeTasks[taskId].status === 'queued') {
    nativeTasks[taskId].status = 'cancelled';
  }
  const orderIdx = taskOrderList.indexOf(taskId);
  if (orderIdx >= 0) {
    taskOrderList.splice(orderIdx, 1);
  }
  return getDownloadQueueState();
}

export function clearCompletedDownloadsFromQueue() {
  for (let i = taskOrderList.length - 1; i >= 0; i--) {
    const id = taskOrderList[i];
    const t = nativeTasks[id];
    if (!t || t.status === 'completed' || t.status === 'failed' || t.status === 'cancelled') {
      taskOrderList.splice(i, 1);
    }
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
      item?.uploader || 'MediaToolkit'
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
