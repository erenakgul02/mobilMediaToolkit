import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Image,
  ActivityIndicator,
  Alert,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import {
  fetchVideoInfo,
  startDownload,
  checkProgress,
  downloadFileToDevice,
  addLocalHistoryItem,
} from '../services/api';

export default function DownloaderTab({ onSwitchToHistory }) {
  const [url, setUrl] = useState('');
  const [loadingInfo, setLoadingInfo] = useState(false);
  const [videoInfo, setVideoInfo] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');

  // Format selection
  const [mediaType, setMediaType] = useState('mp3'); // 'mp3' or 'mp4'
  const [selectedQuality, setSelectedQuality] = useState('320');

  // Active Download state
  const [activeTask, setActiveTask] = useState(null);
  const [downloading, setDownloading] = useState(false);
  const [savingToDevice, setSavingToDevice] = useState(false);
  const pollTimerRef = useRef(null);
  const urlInputRef = useRef(null);

  // Clear polling on unmount
  useEffect(() => {
    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
  }, []);

  const cleanAndSetUrl = (rawText) => {
    if (!rawText) return false;
    const trimmed = String(rawText).trim();
    // YouTube linklerini metin icinden cikar (ozellikle mobilde 'Paylas' deyince baslik + link kopyalanir)
    const urlMatch = trimmed.match(/https?:\/\/(www\.)?(youtube\.com|youtu\.be)\/[^\s]+/i);
    if (urlMatch) {
      setUrl(urlMatch[0]);
      setErrorMsg('');
      return true;
    }
    const genericMatch = trimmed.match(/https?:\/\/[^\s]+/i);
    if (genericMatch) {
      setUrl(genericMatch[0]);
      setErrorMsg('');
      return true;
    }
    if (trimmed.length > 5) {
      setUrl(trimmed);
      setErrorMsg('');
      return true;
    }
    return false;
  };

  const handlePaste = async () => {
    setErrorMsg('');
    let pastedText = '';

    // 1. Web standart Navigator Clipboard (Safari/Chrome)
    if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.readText) {
      try {
        pastedText = await navigator.clipboard.readText();
      } catch (err) {
        console.log('navigator.clipboard error:', err);
      }
    }

    // 2. Expo Clipboard alternatifi
    if (!pastedText) {
      try {
        pastedText = await Clipboard.getStringAsync();
      } catch (err) {
        console.log('expo clipboard error:', err);
      }
    }

    const success = cleanAndSetUrl(pastedText);
    if (!success) {
      // Eger tarayici guvenligi engellediyse kutuya odaklan ve klavye ac
      if (urlInputRef.current) {
        urlInputRef.current.focus();
      }
      setErrorMsg('Safari panoyu otomatik okumaya izin vermedi. Lutfen yukaridaki kutucuga dokunup "Yapistir" secin.');
    }
  };

  const handleFetchInfo = async () => {
    if (!url.trim()) {
      setErrorMsg('Lütfen önce bir YouTube linki yapıştırın.');
      return;
    }
    setErrorMsg('');
    setLoadingInfo(true);
    setVideoInfo(null);

    try {
      const info = await fetchVideoInfo(url.trim());
      setVideoInfo(info);
      // Default to 320 for mp3, or 720 for mp4
      if (mediaType === 'mp3') {
        setSelectedQuality('320');
      } else {
        const defaultVid = info.formats_video?.[0]?.value || '720';
        setSelectedQuality(defaultVid);
      }
    } catch (err) {
      setErrorMsg(err.message || 'Video bilgileri alınamadı.');
    } finally {
      setLoadingInfo(false);
    }
  };

  const handleStartDownload = async () => {
    if (!url.trim()) return;
    setErrorMsg('');
    setDownloading(true);

    try {
      const res = await startDownload({
        url: url.trim(),
        type: mediaType,
        quality: selectedQuality,
        title: videoInfo?.title || 'Video',
        thumbnail: videoInfo?.thumbnail || '',
      });

      const taskId = res.taskId;
      setActiveTask({
        id: taskId,
        status: 'queued',
        progress: 0,
        speed: '',
        eta: '',
        filename: null,
      });

      // Poll progress every 1 second
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
      pollTimerRef.current = setInterval(async () => {
        try {
          const taskData = await checkProgress(taskId);
          setActiveTask(taskData);

          if (taskData.status === 'completed' || taskData.status === 'failed') {
            clearInterval(pollTimerRef.current);
            setDownloading(false);
            if (taskData.status === 'completed' && taskData.filename) {
              await addLocalHistoryItem({
                id: taskData.id,
                filename: taskData.filename,
                title: taskData.title,
                type: taskData.type,
                quality: taskData.quality,
                filesize: taskData.filesize,
                download_url: `/api/download-direct/${taskData.filename}`,
                date: 'Bugün',
              });
            }
            if (taskData.status === 'failed') {
              setErrorMsg(taskData.error || 'İndirme sırasında bir hata oluştu.');
            }
          }
        } catch (e) {
          console.warn('Progress poll hatası:', e);
        }
      }, 1000);
    } catch (err) {
      setErrorMsg(err.message || 'İndirme başlatılamadı.');
      setDownloading(false);
    }
  };

  const handleSaveToDevice = async () => {
    if (!activeTask || !activeTask.filename) return;
    setSavingToDevice(true);
    try {
      const relUrl = `/api/download-direct/${activeTask.filename}`;
      await downloadFileToDevice(relUrl, activeTask.filename);
      if (Platform.OS !== 'web') {
        Alert.alert('Başarılı', 'Dosya cihazınıza kaydedildi / paylaşıldı!');
      }
    } catch (err) {
      Alert.alert('Hata', 'Dosya cihaza kaydedilemedi: ' + err.message);
    } finally {
      setSavingToDevice(false);
    }
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.contentContainer}
      showsVerticalScrollIndicator={false}
    >
      {/* Başlık & Slogan */}
      <View style={styles.headerArea}>
        <Text style={styles.appTitle}>YouTube Medya İndirici</Text>
        <Text style={styles.appSubtitle}>
          YouTube videolarını yüksek kalitede MP3 veya MP4 olarak telefonunuza indirin.
        </Text>
      </View>

      {/* URL Giriş Kartı */}
      <View style={styles.card}>
        <Text style={styles.inputLabel}>YouTube Video veya Shorts Linki</Text>
        <View style={styles.inputWrapper}>
          <Ionicons name="link-outline" size={20} color="#94A3B8" style={styles.linkIcon} />
          <TextInput
            ref={urlInputRef}
            style={styles.textInput}
            placeholder="https://youtu.be/... veya youtube.com/watch..."
            placeholderTextColor="#64748B"
            value={url}
            onChangeText={(txt) => {
              setUrl(txt);
              if (errorMsg) setErrorMsg('');
            }}
            autoCapitalize="none"
            autoCorrect={false}
          />
          {url.length > 0 && (
            <TouchableOpacity onPress={() => setUrl('')} style={styles.clearBtn}>
              <Ionicons name="close-circle" size={18} color="#94A3B8" />
            </TouchableOpacity>
          )}
        </View>

        {/* Butonlar: Panodan Yapıştır & Bilgileri Getir */}
        <View style={styles.inputButtonsRow}>
          <TouchableOpacity style={styles.pasteBtn} onPress={handlePaste}>
            <Ionicons name="clipboard-outline" size={16} color="#E2E8F0" />
            <Text style={styles.pasteBtnText}>Panodan Yapıştır</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.fetchBtn, loadingInfo && { opacity: 0.7 }]}
            onPress={handleFetchInfo}
            disabled={loadingInfo}
          >
            {loadingInfo ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <>
                <Ionicons name="search" size={16} color="#FFFFFF" />
                <Text style={styles.fetchBtnText}>Analiz Et</Text>
              </>
            )}
          </TouchableOpacity>
        </View>

        {/* Hata Mesajı */}
        {errorMsg ? (
          <View style={styles.errorBox}>
            <Ionicons name="alert-circle" size={18} color="#EF4444" />
            <Text style={styles.errorText}>{errorMsg}</Text>
          </View>
        ) : null}
      </View>

      {/* Video Önizleme Kartı */}
      {videoInfo && (
        <View style={styles.card}>
          <View style={styles.previewHeader}>
            <View style={styles.thumbnailContainer}>
              <Image
                source={{ uri: videoInfo.thumbnail }}
                style={styles.thumbnail}
                resizeMode="cover"
              />
              <View style={styles.durationBadge}>
                <Text style={styles.durationText}>{videoInfo.duration}</Text>
              </View>
            </View>

            <View style={styles.videoMeta}>
              <Text style={styles.videoTitle} numberOfLines={2}>
                {videoInfo.title}
              </Text>
              <View style={styles.channelRow}>
                <Ionicons name="person-circle-outline" size={14} color="#94A3B8" />
                <Text style={styles.channelText} numberOfLines={1}>
                  {videoInfo.channel}
                </Text>
              </View>
              <View style={styles.viewsRow}>
                <Ionicons name="eye-outline" size={14} color="#64748B" />
                <Text style={styles.viewsText}>{videoInfo.view_count} görüntüleme</Text>
              </View>
            </View>
          </View>

          {/* Format Seçimi: MP3 vs MP4 */}
          <Text style={styles.sectionLabel}>İndirme Formatı</Text>
          <View style={styles.formatToggleContainer}>
            <TouchableOpacity
              style={[
                styles.formatTab,
                mediaType === 'mp3' && styles.formatTabActive,
              ]}
              onPress={() => {
                setMediaType('mp3');
                setSelectedQuality('320');
              }}
            >
              <Ionicons
                name="musical-notes"
                size={18}
                color={mediaType === 'mp3' ? '#FFFFFF' : '#64748B'}
              />
              <Text
                style={[
                  styles.formatTabText,
                  mediaType === 'mp3' && styles.formatTabTextActive,
                ]}
              >
                MP3 (Ses)
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.formatTab,
                mediaType === 'mp4' && styles.formatTabActive,
              ]}
              onPress={() => {
                setMediaType('mp4');
                const defaultVid = videoInfo.formats_video?.[0]?.value || '720';
                setSelectedQuality(defaultVid);
              }}
            >
              <Ionicons
                name="videocam"
                size={18}
                color={mediaType === 'mp4' ? '#FFFFFF' : '#64748B'}
              />
              <Text
                style={[
                  styles.formatTabText,
                  mediaType === 'mp4' && styles.formatTabTextActive,
                ]}
              >
                MP4 (Video)
              </Text>
            </TouchableOpacity>
          </View>

          {/* Kalite Seçenekleri */}
          <Text style={styles.sectionLabel}>
            {mediaType === 'mp3' ? 'Ses Kalitesi (Bitrate)' : 'Video Çözünürlüğü'}
          </Text>
          <View style={styles.qualityList}>
            {(mediaType === 'mp3'
              ? videoInfo.formats_audio
              : videoInfo.formats_video
            )?.map((fmt) => {
              const isSelected = selectedQuality === fmt.value;
              return (
                <TouchableOpacity
                  key={fmt.value}
                  style={[
                    styles.qualityChip,
                    isSelected && styles.qualityChipSelected,
                  ]}
                  onPress={() => setSelectedQuality(fmt.value)}
                >
                  <Ionicons
                    name={isSelected ? 'checkmark-circle' : 'radio-button-off'}
                    size={16}
                    color={isSelected ? '#2563EB' : '#94A3B8'}
                  />
                  <Text
                    style={[
                      styles.qualityChipText,
                      isSelected && styles.qualityChipTextSelected,
                    ]}
                  >
                    {fmt.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* İndirme Başlat Butonu */}
          <TouchableOpacity
            style={[
              styles.downloadActionBtn,
              downloading && { opacity: 0.6 },
            ]}
            onPress={handleStartDownload}
            disabled={downloading}
          >
            {downloading ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <>
                <Ionicons
                  name={mediaType === 'mp3' ? 'musical-note' : 'download'}
                  size={20}
                  color="#FFFFFF"
                />
                <Text style={styles.downloadActionBtnText}>
                  {mediaType === 'mp3' ? 'MP3 Olarak İndir' : 'MP4 Olarak İndir'}
                </Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      )}

      {/* Aktif İndirme & İlerleme Kartı */}
      {activeTask && (
        <View style={[styles.card, styles.taskCard]}>
          <View style={styles.taskHeader}>
            <View style={styles.taskHeaderLeft}>
              <View
                style={[
                  styles.typeBadge,
                  {
                    backgroundColor:
                      activeTask.type === 'mp3' ? '#1E3A8A' : '#14532D',
                  },
                ]}
              >
                <Text style={styles.typeBadgeText}>
                  {activeTask.type === 'mp3' ? 'MP3' : 'MP4'}
                </Text>
              </View>
              <Text style={styles.taskTitle} numberOfLines={1}>
                {activeTask.title || 'İndiriliyor...'}
              </Text>
            </View>

            <Text style={styles.percentText}>{activeTask.progress}%</Text>
          </View>

          {/* İlerleme Çubuğu */}
          <View style={styles.progressBarBg}>
            <View
              style={[
                styles.progressBarFill,
                { width: `${Math.min(100, Math.max(0, activeTask.progress))}%` },
                activeTask.status === 'completed' && { backgroundColor: '#10B981' },
              ]}
            />
          </View>

          {/* Durum & Hız Bilgileri */}
          <View style={styles.taskMetaRow}>
            <Text style={styles.taskStatusText}>
              {activeTask.status === 'queued' && '⏳ Kuyrukta bekleniyor...'}
              {activeTask.status === 'downloading' &&
                `⚡ İndiriliyor ${activeTask.speed ? '(' + activeTask.speed + ')' : ''}`}
              {activeTask.status === 'processing' && '🎬 FFmpeg ile dönüştürülüyor...'}
              {activeTask.status === 'completed' && '✅ İndirme ve Dönüştürme Tamamlandı!'}
              {activeTask.status === 'failed' && '❌ İndirme Başarısız Oldu'}
            </Text>

            {activeTask.eta ? (
              <Text style={styles.taskEtaText}>Kalan: {activeTask.eta}</Text>
            ) : null}
          </View>

          {/* Tamamlandıysa: Cihaza Kaydet Butonu */}
          {activeTask.status === 'completed' && (
            <View style={styles.completedActions}>
              <TouchableOpacity
                style={styles.saveFileBtn}
                onPress={handleSaveToDevice}
                disabled={savingToDevice}
              >
                {savingToDevice ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <>
                    <Ionicons name="cloud-download" size={18} color="#FFFFFF" />
                    <Text style={styles.saveFileBtnText}>
                      Telefona Kaydet / İndir
                    </Text>
                  </>
                )}
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.historyShortcutBtn}
                onPress={onSwitchToHistory}
              >
                <Ionicons name="folder-open-outline" size={16} color="#94A3B8" />
                <Text style={styles.historyShortcutText}>İndirilenlere Git</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  contentContainer: {
    padding: 16,
    paddingBottom: 40,
  },
  headerArea: {
    marginBottom: 16,
  },
  appTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#0F172A',
    letterSpacing: -0.5,
  },
  appSubtitle: {
    fontSize: 13,
    color: '#64748B',
    marginTop: 4,
    lineHeight: 18,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  inputLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#334155',
    marginBottom: 8,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    paddingHorizontal: 12,
  },
  linkIcon: {
    marginRight: 8,
  },
  textInput: {
    flex: 1,
    height: 46,
    color: '#0F172A',
    fontSize: 14,
  },
  clearBtn: {
    padding: 4,
  },
  inputButtonsRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 12,
  },
  pasteBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#F1F5F9',
    height: 42,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#CBD5E1',
  },
  pasteBtnText: {
    color: '#334155',
    fontSize: 13,
    fontWeight: '600',
  },
  fetchBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#2563EB',
    height: 42,
    borderRadius: 10,
    shadowColor: '#2563EB',
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 3,
  },
  fetchBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FEF2F2',
    borderRadius: 10,
    padding: 10,
    marginTop: 12,
    borderWidth: 1,
    borderColor: '#FCA5A5',
  },
  errorText: {
    color: '#DC2626',
    fontSize: 12,
    flex: 1,
  },
  previewHeader: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
  },
  thumbnailContainer: {
    width: 120,
    height: 75,
    borderRadius: 10,
    overflow: 'hidden',
    position: 'relative',
    backgroundColor: '#E2E8F0',
  },
  thumbnail: {
    width: '100%',
    height: '100%',
  },
  durationBadge: {
    position: 'absolute',
    bottom: 4,
    right: 4,
    backgroundColor: 'rgba(0,0,0,0.85)',
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 4,
  },
  durationText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '700',
  },
  videoMeta: {
    flex: 1,
    justifyContent: 'space-between',
  },
  videoTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
    lineHeight: 18,
  },
  channelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 4,
  },
  channelText: {
    fontSize: 12,
    color: '#64748B',
    fontWeight: '500',
  },
  viewsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  viewsText: {
    fontSize: 11,
    color: '#94A3B8',
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#334155',
    marginBottom: 8,
    marginTop: 6,
  },
  formatToggleContainer: {
    flexDirection: 'row',
    backgroundColor: '#F1F5F9',
    borderRadius: 12,
    padding: 4,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  formatTab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 10,
    borderRadius: 8,
  },
  formatTabActive: {
    backgroundColor: '#2563EB',
    shadowColor: '#2563EB',
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 2,
  },
  formatTabText: {
    color: '#64748B',
    fontSize: 13,
    fontWeight: '600',
  },
  formatTabTextActive: {
    color: '#FFFFFF',
  },
  qualityList: {
    gap: 8,
    marginBottom: 16,
  },
  qualityChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#FFFFFF',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  qualityChipSelected: {
    borderColor: '#2563EB',
    backgroundColor: '#EFF6FF',
  },
  qualityChipText: {
    color: '#475569',
    fontSize: 13,
    fontWeight: '500',
  },
  qualityChipTextSelected: {
    color: '#1D4ED8',
    fontWeight: '700',
  },
  downloadActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#2563EB',
    height: 48,
    borderRadius: 12,
    shadowColor: '#2563EB',
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },
  downloadActionBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  taskCard: {
    borderColor: '#BFDBFE',
    backgroundColor: '#F8FAFC',
  },
  taskHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  taskHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  typeBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  typeBadgeText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '800',
  },
  taskTitle: {
    color: '#0F172A',
    fontSize: 13,
    fontWeight: '600',
    flex: 1,
  },
  percentText: {
    color: '#2563EB',
    fontSize: 15,
    fontWeight: '800',
    marginLeft: 8,
  },
  progressBarBg: {
    height: 8,
    backgroundColor: '#E2E8F0',
    borderRadius: 4,
    overflow: 'hidden',
    marginBottom: 8,
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: '#2563EB',
    borderRadius: 4,
  },
  taskMetaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  taskStatusText: {
    color: '#334155',
    fontSize: 12,
    fontWeight: '500',
  },
  taskEtaText: {
    color: '#64748B',
    fontSize: 11,
  },
  completedActions: {
    marginTop: 14,
    gap: 8,
  },
  saveFileBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#16A34A',
    height: 44,
    borderRadius: 10,
    shadowColor: '#16A34A',
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 3,
  },
  saveFileBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  historyShortcutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 36,
  },
  historyShortcutText: {
    color: '#2563EB',
    fontSize: 12,
    fontWeight: '600',
  },
});
