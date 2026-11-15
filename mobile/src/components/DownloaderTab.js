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
  Keyboard,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import {
  fetchVideoInfo,
  searchYouTubeVideos,
  isLikelyYouTubeUrl,
  startDownload,
  checkProgress,
  downloadFileToDevice,
} from '../services/api';

export default function DownloaderTab({ onSwitchToHistory }) {
  const [queryOrUrl, setQueryOrUrl] = useState('');
  const [loadingInfo, setLoadingInfo] = useState(false);
  const [searchResults, setSearchResults] = useState([]);
  const [videoInfo, setVideoInfo] = useState(null);
  const [selectedVideoUrl, setSelectedVideoUrl] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  // Format selection ('m4a' or 'mp4')
  const [mediaType, setMediaType] = useState('m4a');
  const [selectedQuality, setSelectedQuality] = useState('high');

  // Active Download state
  const [activeTask, setActiveTask] = useState(null);
  const [downloading, setDownloading] = useState(false);
  const [savingToDevice, setSavingToDevice] = useState(false);
  const pollTimerRef = useRef(null);
  const urlInputRef = useRef(null);

  useEffect(() => {
    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
  }, []);

  const cleanAndSetInput = (rawText) => {
    if (!rawText) return '';
    const trimmed = String(rawText).trim();
    const urlMatch = trimmed.match(/https?:\/\/(www\.)?(youtube\.com|youtu\.be)\/[^\s]+/i);
    if (urlMatch) {
      setQueryOrUrl(urlMatch[0]);
      setErrorMsg('');
      return urlMatch[0];
    }
    const genericMatch = trimmed.match(/https?:\/\/[^\s]+/i);
    if (genericMatch) {
      setQueryOrUrl(genericMatch[0]);
      setErrorMsg('');
      return genericMatch[0];
    }
    if (trimmed.length > 1) {
      setQueryOrUrl(trimmed);
      setErrorMsg('');
      return trimmed;
    }
    return '';
  };

  const handlePaste = async () => {
    setErrorMsg('');
    let pastedText = '';

    if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.readText) {
      try {
        pastedText = await navigator.clipboard.readText();
      } catch (err) {
        console.log('navigator.clipboard error:', err);
      }
    }

    if (!pastedText) {
      try {
        pastedText = await Clipboard.getStringAsync();
      } catch (err) {
        console.log('expo clipboard error:', err);
      }
    }

    const cleaned = cleanAndSetInput(pastedText);
    if (!cleaned) {
      if (urlInputRef.current) {
        urlInputRef.current.focus();
      }
      setErrorMsg('Panoda metin veya bağlantı bulunamadı.');
    }
  };

  const handleSearchOrFetch = async () => {
    const input = queryOrUrl.trim();
    if (!input) {
      setErrorMsg('Lütfen bir şarkı/video adı yazın veya YouTube linki yapıştırın.');
      return;
    }

    Keyboard.dismiss();
    setErrorMsg('');
    setLoadingInfo(true);
    setVideoInfo(null);

    try {
      if (isLikelyYouTubeUrl(input)) {
        setSearchResults([]);
        const info = await fetchVideoInfo(input);
        setVideoInfo(info);
        setSelectedVideoUrl(input);
        if (mediaType === 'm4a') {
          setSelectedQuality(info.formats_audio?.[0]?.value || 'high');
        } else {
          setSelectedQuality(info.formats_video?.[0]?.value || '1080p');
        }
      } else {
        const results = await searchYouTubeVideos(input);
        setSearchResults(results);
      }
    } catch (err) {
      setErrorMsg(err.message || 'Arama veya video analizi başarısız oldu.');
    } finally {
      setLoadingInfo(false);
    }
  };

  const handleSelectSearchResult = (item) => {
    setVideoInfo(item);
    setSelectedVideoUrl(item.url);
    if (mediaType === 'm4a') {
      setSelectedQuality(item.formats_audio?.[0]?.value || 'high');
    } else {
      setSelectedQuality(item.formats_video?.[0]?.value || '1080p');
    }
  };

  const handleStartDownload = async () => {
    const targetUrl = (selectedVideoUrl || queryOrUrl).trim();
    if (!targetUrl) return;
    setErrorMsg('');
    setDownloading(true);

    try {
      const res = await startDownload({
        url: targetUrl,
        type: mediaType,
        quality: selectedQuality,
        title: videoInfo?.title || 'Video',
        thumbnail: videoInfo?.thumbnail || '',
        uploader: videoInfo?.channel || videoInfo?.author || 'YouTube',
      });

      const taskId = res.taskId;
      setActiveTask({
        id: taskId,
        status: 'downloading',
        progress: 0,
        speed: 'Başlatılıyor...',
        eta: '',
        type: mediaType,
        title: videoInfo?.title || 'İndiriliyor...',
        filename: null,
        download_url: '',
      });

      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
      pollTimerRef.current = setInterval(async () => {
        try {
          const taskData = await checkProgress(taskId);
          setActiveTask(taskData);

          if (taskData.status === 'completed' || taskData.status === 'failed') {
            clearInterval(pollTimerRef.current);
            setDownloading(false);
            if (taskData.status === 'failed') {
              setErrorMsg(taskData.error || 'İndirme sırasında bir hata oluştu.');
            }
          }
        } catch (e) {
          console.warn('Progress poll hatası:', e);
        }
      }, 500);
    } catch (err) {
      setErrorMsg(err.message || 'İndirme başlatılamadı.');
      setDownloading(false);
    }
  };

  const handleSaveToDevice = async () => {
    if (!activeTask || !activeTask.filename) return;
    setSavingToDevice(true);
    try {
      await downloadFileToDevice(activeTask.download_url || '', activeTask.filename, 'open');
    } catch (err) {
      Alert.alert('Hata', 'Dosya açılamadı: ' + err.message);
    } finally {
      setSavingToDevice(false);
    }
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.contentContainer}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      {/* Başlık & Slogan */}
      <View style={styles.headerArea}>
        <Text style={styles.appTitle}>YouTube Arama & Medya İndirici</Text>
        <Text style={styles.appSubtitle}>
          İstediğiniz şarkı veya videoyu doğrudan aratıp yüksek kalitede M4A (Ses) veya Full HD MP4 (Video) olarak indirin.
        </Text>
      </View>

      {/* Arama Motoru & URL Giriş Kartı */}
      <View style={styles.card}>
        <Text style={styles.inputLabel}>
          YouTube'da Şarkı / Video Ara veya Link Yapıştır
        </Text>
        <View style={styles.inputWrapper}>
          <Ionicons name="search-outline" size={20} color="#2563EB" style={styles.linkIcon} />
          <TextInput
            ref={urlInputRef}
            style={styles.textInput}
            placeholder="Şarkı/sanatçı adı yazın veya link yapıştırın..."
            placeholderTextColor="#64748B"
            value={queryOrUrl}
            onChangeText={(txt) => {
              setQueryOrUrl(txt);
              if (errorMsg) setErrorMsg('');
            }}
            onSubmitEditing={handleSearchOrFetch}
            returnKeyType="search"
            autoCapitalize="none"
            autoCorrect={false}
          />
          {queryOrUrl.length > 0 && (
            <TouchableOpacity
              onPress={() => {
                setQueryOrUrl('');
                setSearchResults([]);
                setVideoInfo(null);
              }}
              style={styles.clearBtn}
            >
              <Ionicons name="close-circle" size={18} color="#94A3B8" />
            </TouchableOpacity>
          )}
        </View>

        {/* Butonlar: Panodan Yapıştır & Ara / Analiz Et */}
        <View style={styles.inputButtonsRow}>
          <TouchableOpacity style={styles.pasteBtn} onPress={handlePaste}>
            <Ionicons name="clipboard-outline" size={16} color="#334155" />
            <Text style={styles.pasteBtnText}>Link Yapıştır</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.fetchBtn, loadingInfo && { opacity: 0.7 }]}
            onPress={handleSearchOrFetch}
            disabled={loadingInfo}
          >
            {loadingInfo ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <>
                <Ionicons name="search" size={16} color="#FFFFFF" />
                <Text style={styles.fetchBtnText}>
                  {isLikelyYouTubeUrl(queryOrUrl) ? 'Analiz Et' : 'YouTube\'da Ara'}
                </Text>
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

      {/* YouTube Arama Sonuçları Listesi (Kullanıcı bir video seçmediyse gösterilir) */}
      {!videoInfo && searchResults.length > 0 && (
        <View style={styles.card}>
          <View style={styles.searchResultsHeader}>
            <View style={styles.searchHeaderLeft}>
              <Ionicons name="logo-youtube" size={18} color="#EF4444" />
              <Text style={styles.searchResultsTitle}>
                Arama Sonuçları ({searchResults.length})
              </Text>
            </View>
            <Text style={styles.searchResultsHint}>İndirmek için dokunun</Text>
          </View>

          <View style={styles.searchResultsList}>
            {searchResults.map((item) => (
              <TouchableOpacity
                key={item.id}
                style={styles.searchResultRow}
                activeOpacity={0.75}
                onPress={() => handleSelectSearchResult(item)}
              >
                <View style={styles.searchThumbBox}>
                  {item.thumbnail ? (
                    <Image
                      source={{ uri: item.thumbnail }}
                      style={styles.searchThumbImg}
                      resizeMode="cover"
                    />
                  ) : (
                    <View style={styles.searchThumbFallback}>
                      <Ionicons name="play" size={18} color="#FFFFFF" />
                    </View>
                  )}
                  {item.duration ? (
                    <View style={styles.durationBadge}>
                      <Text style={styles.durationText}>{item.duration}</Text>
                    </View>
                  ) : null}
                </View>

                <View style={styles.searchResultMeta}>
                  <Text style={styles.searchResultItemTitle} numberOfLines={2}>
                    {item.title}
                  </Text>
                  <Text style={styles.searchResultSub} numberOfLines={1}>
                    {item.channel}
                    {item.view_count ? ` • ${item.view_count} görüntüleme` : ''}
                  </Text>
                </View>

                <View style={styles.selectPill}>
                  <Ionicons name="download-outline" size={16} color="#2563EB" />
                </View>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      )}

      {/* Seçilen Video Önizleme & İndirme Kartı */}
      {videoInfo && (
        <View style={styles.card}>
          {/* Eğer arama sonuçlarından seçildiyse geri dönüş butonu */}
          {searchResults.length > 0 && (
            <TouchableOpacity
              style={styles.backToSearchBtn}
              onPress={() => setVideoInfo(null)}
            >
              <Ionicons name="arrow-back" size={15} color="#2563EB" />
              <Text style={styles.backToSearchText}>
                Diğer Arama Sonuçlarına Dön ({searchResults.length})
              </Text>
            </TouchableOpacity>
          )}

          <View style={styles.previewHeader}>
            <View style={styles.thumbnailContainer}>
              <Image
                source={{ uri: videoInfo.thumbnail }}
                style={styles.thumbnail}
                resizeMode="cover"
              />
              {videoInfo.duration ? (
                <View style={styles.durationBadge}>
                  <Text style={styles.durationText}>{videoInfo.duration}</Text>
                </View>
              ) : null}
            </View>

            <View style={styles.videoMeta}>
              <Text style={styles.videoTitle} numberOfLines={2}>
                {videoInfo.title}
              </Text>
              <View style={styles.channelRow}>
                <Ionicons name="person-circle-outline" size={14} color="#94A3B8" />
                <Text style={styles.channelText} numberOfLines={1}>
                  {videoInfo.channel || videoInfo.author || 'YouTube'}
                </Text>
              </View>
              {videoInfo.view_count ? (
                <View style={styles.viewsRow}>
                  <Ionicons name="eye-outline" size={14} color="#64748B" />
                  <Text style={styles.viewsText}>{videoInfo.view_count} görüntüleme</Text>
                </View>
              ) : null}
            </View>
          </View>

          {/* Format Seçimi: M4A vs MP4 */}
          <Text style={styles.sectionLabel}>İndirme Formatı</Text>
          <View style={styles.formatToggleContainer}>
            <TouchableOpacity
              style={[
                styles.formatTab,
                mediaType === 'm4a' && styles.formatTabActive,
              ]}
              onPress={() => {
                setMediaType('m4a');
                setSelectedQuality(videoInfo.formats_audio?.[0]?.value || 'high');
              }}
            >
              <Ionicons
                name="musical-notes"
                size={18}
                color={mediaType === 'm4a' ? '#FFFFFF' : '#64748B'}
              />
              <Text
                style={[
                  styles.formatTabText,
                  mediaType === 'm4a' && styles.formatTabTextActive,
                ]}
              >
                M4A (Ses / Şarkı)
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.formatTab,
                mediaType === 'mp4' && styles.formatTabActive,
              ]}
              onPress={() => {
                setMediaType('mp4');
                const defaultVid = videoInfo.formats_video?.[0]?.value || '1080p';
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
                MP4 (HD Video)
              </Text>
            </TouchableOpacity>
          </View>

          {/* Kalite Seçenekleri */}
          <Text style={styles.sectionLabel}>
            {mediaType === 'm4a' ? 'Ses Kalitesi' : 'Video Çözünürlüğü'}
          </Text>
          <View style={styles.qualityList}>
            {(mediaType === 'm4a'
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
                  name={mediaType === 'm4a' ? 'musical-note' : 'download'}
                  size={20}
                  color="#FFFFFF"
                />
                <Text style={styles.downloadActionBtnText}>
                  {mediaType === 'm4a' ? 'M4A Şarkı Olarak İndir' : 'MP4 HD Video Olarak İndir'}
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
                      activeTask.type === 'm4a' || activeTask.type === 'mp3' ? '#4F46E5' : '#0284C7',
                  },
                ]}
              >
                <Text style={styles.typeBadgeText}>
                  {activeTask.type === 'm4a' || activeTask.type === 'mp3' ? 'M4A' : 'MP4'}
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
              {activeTask.status === 'queued' && '⏳ Hazırlanıyor...'}
              {activeTask.status === 'downloading' &&
                `⚡ İndiriliyor ${activeTask.speed ? '(' + activeTask.speed + ')' : ''}`}
              {activeTask.status === 'processing' && '🎬 Birleştiriliyor...'}
              {activeTask.status === 'completed' && '✅ İndirilenler listesine kaydedildi!'}
              {activeTask.status === 'failed' && '❌ İndirme Başarısız Oldu'}
            </Text>

            {activeTask.eta ? (
              <Text style={styles.taskEtaText}>Kalan: {activeTask.eta}</Text>
            ) : null}
          </View>

          {/* Tamamlandıysa: İndirilenlere Git / Oynat Butonu */}
          {activeTask.status === 'completed' && (
            <View style={styles.completedActions}>
              <TouchableOpacity
                style={styles.saveFileBtn}
                onPress={onSwitchToHistory}
              >
                <Ionicons name="musical-notes" size={18} color="#FFFFFF" />
                <Text style={styles.saveFileBtnText}>
                  İndirilenlere Git & Oynat
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.historyShortcutBtn}
                onPress={handleSaveToDevice}
                disabled={savingToDevice}
              >
                <Ionicons name="share-social-outline" size={16} color="#2563EB" />
                <Text style={styles.historyShortcutText}>Aç / Paylaş</Text>
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
    padding: 15,
    paddingBottom: 32,
  },
  headerArea: {
    marginBottom: 14,
  },
  appTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#0F172A',
    letterSpacing: -0.5,
  },
  appSubtitle: {
    fontSize: 12.5,
    color: '#64748B',
    marginTop: 3,
    lineHeight: 18,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 15,
    padding: 14,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  inputLabel: {
    fontSize: 12.5,
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
    height: 44,
    color: '#0F172A',
    fontSize: 13.5,
  },
  clearBtn: {
    padding: 4,
  },
  inputButtonsRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 10,
  },
  pasteBtn: {
    flex: 0.9,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#F1F5F9',
    height: 40,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#CBD5E1',
  },
  pasteBtnText: {
    color: '#334155',
    fontSize: 12.5,
    fontWeight: '600',
  },
  fetchBtn: {
    flex: 1.1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#2563EB',
    height: 40,
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
  // Arama Sonuçları Stilleri
  searchResultsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  searchHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  searchResultsTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0F172A',
  },
  searchResultsHint: {
    fontSize: 11,
    color: '#64748B',
    fontWeight: '600',
  },
  searchResultsList: {
    gap: 8,
  },
  searchResultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderRadius: 11,
    padding: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    gap: 10,
  },
  searchThumbBox: {
    width: 84,
    height: 50,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: '#0F172A',
    position: 'relative',
  },
  searchThumbImg: {
    width: '100%',
    height: '100%',
  },
  searchThumbFallback: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1E293B',
  },
  searchResultMeta: {
    flex: 1,
    justifyContent: 'center',
  },
  searchResultItemTitle: {
    fontSize: 12.5,
    fontWeight: '700',
    color: '#0F172A',
    lineHeight: 16,
  },
  searchResultSub: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 3,
  },
  selectPill: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
    alignItems: 'center',
    justifyContent: 'center',
  },
  backToSearchBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    alignSelf: 'flex-start',
    backgroundColor: '#EFF6FF',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#BFDBFE',
    marginBottom: 12,
  },
  backToSearchText: {
    color: '#2563EB',
    fontSize: 11.5,
    fontWeight: '700',
  },
  previewHeader: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 14,
  },
  thumbnailContainer: {
    width: 116,
    height: 70,
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
    bottom: 3,
    right: 3,
    backgroundColor: 'rgba(0,0,0,0.85)',
    paddingHorizontal: 4,
    paddingVertical: 1.5,
    borderRadius: 4,
  },
  durationText: {
    color: '#FFFFFF',
    fontSize: 9.5,
    fontWeight: '700',
  },
  videoMeta: {
    flex: 1,
    justifyContent: 'space-between',
  },
  videoTitle: {
    fontSize: 13.5,
    fontWeight: '700',
    color: '#0F172A',
    lineHeight: 18,
  },
  channelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 3,
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
    fontSize: 12.5,
    fontWeight: '700',
    color: '#334155',
    marginBottom: 7,
    marginTop: 4,
  },
  formatToggleContainer: {
    flexDirection: 'row',
    backgroundColor: '#F1F5F9',
    borderRadius: 11,
    padding: 4,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  formatTab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    paddingVertical: 9,
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
    fontSize: 12.5,
    fontWeight: '600',
  },
  formatTabTextActive: {
    color: '#FFFFFF',
  },
  qualityList: {
    gap: 7,
    marginBottom: 14,
  },
  qualityChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    backgroundColor: '#FFFFFF',
    paddingVertical: 9,
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
    fontSize: 12.5,
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
    height: 46,
    borderRadius: 12,
    shadowColor: '#2563EB',
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },
  downloadActionBtnText: {
    color: '#FFFFFF',
    fontSize: 14.5,
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
    fontSize: 14,
    fontWeight: '800',
    marginLeft: 8,
  },
  progressBarBg: {
    height: 8,
    backgroundColor: '#E2E8F0',
    borderRadius: 4,
    overflow: 'hidden',
    marginBottom: 10,
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
    color: '#475569',
    fontSize: 12,
    fontWeight: '500',
    flex: 1,
  },
  taskEtaText: {
    color: '#2563EB',
    fontSize: 11,
    fontWeight: '700',
  },
  completedActions: {
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
    gap: 8,
  },
  saveFileBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#10B981',
    height: 42,
    borderRadius: 10,
  },
  saveFileBtnText: {
    color: '#FFFFFF',
    fontSize: 13.5,
    fontWeight: '700',
  },
  historyShortcutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 36,
    borderRadius: 8,
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
  },
  historyShortcutText: {
    color: '#2563EB',
    fontSize: 12.5,
    fontWeight: '700',
  },
});
