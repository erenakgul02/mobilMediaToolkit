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
  DOWNLOAD_PRESETS,
  getDefaultDownloadPreset,
  setDefaultDownloadPreset,
  getWifiOnlyMode,
  setWifiOnlyMode,
  fetchVideoInfo,
  fetchYouTubePlaylistInfo,
  isYouTubePlaylistUrl,
  searchYouTubeVideos,
  isLikelyYouTubeUrl,
  startDownload,
  getDownloadQueueState,
  cancelQueuedDownload,
  clearCompletedDownloadsFromQueue,
  downloadFileToDevice,
  previewYouTubeAudio,
  togglePlayPauseAudio,
} from '../services/api';

export default function DownloaderTab({
  isDarkMode,
  playerState,
  onOpenExpandedPlayer,
  onSwitchToHistory,
}) {
  const [queryOrUrl, setQueryOrUrl] = useState('');
  const [loadingInfo, setLoadingInfo] = useState(false);
  const [quickLinkDownloading, setQuickLinkDownloading] = useState(false);
  const [searchResults, setSearchResults] = useState([]);
  const [playlistInfo, setPlaylistInfo] = useState(null);
  const [videoInfo, setVideoInfo] = useState(null);
  const [selectedVideoUrl, setSelectedVideoUrl] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  // Kalıcı Otomatik İndirme Tercihi (Varsayılan: M4A Yüksek Kalite) & Yalnızca Wi-Fi
  const [activePreset, setActivePreset] = useState(DOWNLOAD_PRESETS[0]);
  const [presetMenuOpen, setPresetMenuOpen] = useState(false);
  const [wifiOnly, setWifiOnly] = useState(false);
  const [mediaType, setMediaType] = useState('m4a');
  const [selectedQuality, setSelectedQuality] = useState('high');

  // İndirmeden Önce Şarkı Önizleme (Dinleme) Durumu
  const [previewLoadingUrl, setPreviewLoadingUrl] = useState(null);

  // İndirme Kuyruğu & İlerleme Durumu
  const [queueState, setQueueState] = useState(() => getDownloadQueueState());
  const [savingTaskId, setSavingTaskId] = useState(null);
  const pollTimerRef = useRef(null);
  const urlInputRef = useRef(null);

  const syncQueueState = () => {
    const st = getDownloadQueueState();
    setQueueState(st);
    return st;
  };

  useEffect(() => {
    // Kayıtlı varsayılan indirme tercihini yükle (Varsayılan: M4A Yüksek Kalite)
    getDefaultDownloadPreset()
      .then((preset) => {
        if (preset) {
          setActivePreset(preset);
          setMediaType(preset.type);
          setSelectedQuality(preset.quality);
        }
      })
      .catch(() => {});

    getWifiOnlyMode()
      .then((enabled) => setWifiOnly(Boolean(enabled)))
      .catch(() => {});

    syncQueueState();
    pollTimerRef.current = setInterval(() => {
      syncQueueState();
    }, 450);

    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
  }, []);

  const handleSelectPreset = async (preset) => {
    setActivePreset(preset);
    setMediaType(preset.type);
    setSelectedQuality(preset.quality);
    setPresetMenuOpen(false);
    await setDefaultDownloadPreset(preset.id);
  };

  const handleToggleWifiOnly = async () => {
    const next = !wifiOnly;
    setWifiOnly(next);
    await setWifiOnlyMode(next);
    syncQueueState();
  };

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
    setPlaylistInfo(null);

    try {
      if (isYouTubePlaylistUrl(input)) {
        setSearchResults([]);
        const plData = await fetchYouTubePlaylistInfo(input);
        setPlaylistInfo(plData);
      } else if (isLikelyYouTubeUrl(input)) {
        setSearchResults([]);
        const info = await fetchVideoInfo(input);
        setVideoInfo({ ...info, url: input });
        setSelectedVideoUrl(input);
        setMediaType(activePreset.type);
        setSelectedQuality(activePreset.quality);
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

  // YouTube Playlist / Albüm içindeki tüm parçaları seçili otomatik formatla sıraya ekle
  const handleQueueAllPlaylistItems = async () => {
    if (!playlistInfo || !Array.isArray(playlistInfo.items)) return;
    setErrorMsg('');
    let addedCount = 0;
    for (const item of playlistInfo.items) {
      if (!item.url) continue;
      const alreadyInQueue = queueState.tasks.some(
        (t) =>
          t.cleanUrl === item.url &&
          (t.status === 'downloading' || t.status === 'queued')
      );
      if (alreadyInQueue) continue;
      try {
        await startDownload({
          url: item.url,
          type: activePreset.type,
          quality: activePreset.quality,
          title: item.title || 'YouTube Medya',
          thumbnail: item.thumbnail || playlistInfo.thumbnail || '',
          uploader: item.channel || playlistInfo.uploader || 'YouTube',
        });
        addedCount++;
      } catch (_) {}
    }
    syncQueueState();
    if (addedCount > 0) {
      Alert.alert(
        'Kuyruğa Eklendi',
        `${addedCount} parça (${activePreset.shortLabel}) indirme sırasına eklendi.`
      );
    }
  };

  // Yapıştırılan YouTube linkini analiz ekranıyla uğraşmadan doğrudan seçili otomatik formatla indir
  const handleDirectLinkDownload = async () => {
    const input = queryOrUrl.trim();
    if (!input || !isLikelyYouTubeUrl(input)) return;

    Keyboard.dismiss();
    setErrorMsg('');
    setQuickLinkDownloading(true);
    try {
      let info = null;
      try {
        info = await fetchVideoInfo(input);
      } catch (_) {}

      await startDownload({
        url: input,
        type: activePreset.type,
        quality: activePreset.quality,
        title: info?.title || 'YouTube Medya',
        thumbnail: info?.thumbnail || '',
        uploader: info?.channel || info?.author || 'YouTube',
      });
      syncQueueState();
    } catch (err) {
      setErrorMsg(err.message || 'İndirme başlatılamadı.');
    } finally {
      setQuickLinkDownloading(false);
    }
  };

  // Arama sonuçlarından tek tıkla (detay ekranına girmeden) seçili otomatik formatla indir
  const handleOneTapDownloadSearchItem = async (item) => {
    if (!item || !item.url) return;
    setErrorMsg('');
    try {
      await startDownload({
        url: item.url,
        type: activePreset.type,
        quality: activePreset.quality,
        title: item.title || 'YouTube Medya',
        thumbnail: item.thumbnail || '',
        uploader: item.channel || item.author || 'YouTube',
      });
      syncQueueState();
    } catch (err) {
      setErrorMsg(err.message || 'İndirme başlatılamadı.');
    }
  };

  // İndirmeden önce şarkıyı dinle / önizle
  const handlePreviewListen = async (item) => {
    const targetUrl = (item?.url || selectedVideoUrl || queryOrUrl || '').trim();
    if (!targetUrl) return;

    const previewTrackId = `preview_${targetUrl}`;
    const isThisPreviewActive =
      playerState?.isActive && playerState?.id === previewTrackId;

    if (isThisPreviewActive) {
      try {
        await togglePlayPauseAudio();
      } catch (e) {
        Alert.alert('Önizleme Hatası', e.message);
      }
      return;
    }

    setPreviewLoadingUrl(targetUrl);
    setErrorMsg('');
    try {
      await previewYouTubeAudio({
        url: targetUrl,
        title: item?.title || videoInfo?.title || 'Şarkı Önizleme',
        uploader:
          item?.channel ||
          item?.author ||
          videoInfo?.channel ||
          videoInfo?.author ||
          'YouTube',
        thumbnail: item?.thumbnail || videoInfo?.thumbnail || '',
      });
    } catch (err) {
      Alert.alert(
        'Önizleme Başlatılamadı',
        err.message || 'Bu şarkı için önizleme sesi alınamadı.'
      );
    } finally {
      setPreviewLoadingUrl(null);
    }
  };

  const handleSelectSearchResult = (item) => {
    setVideoInfo(item);
    setSelectedVideoUrl(item.url);
    setMediaType(activePreset.type);
    setSelectedQuality(activePreset.quality);
  };

  const handleStartDownload = async () => {
    const targetUrl = (selectedVideoUrl || queryOrUrl).trim();
    if (!targetUrl) return;
    setErrorMsg('');

    try {
      await startDownload({
        url: targetUrl,
        type: mediaType,
        quality: selectedQuality,
        title: videoInfo?.title || 'Video',
        thumbnail: videoInfo?.thumbnail || '',
        uploader: videoInfo?.channel || videoInfo?.author || 'YouTube',
      });
      syncQueueState();
    } catch (err) {
      setErrorMsg(err.message || 'İndirme başlatılamadı.');
    }
  };

  const handleCancelQueued = (taskId) => {
    const nextState = cancelQueuedDownload(taskId);
    setQueueState(nextState);
  };

  const handleClearFinished = () => {
    const nextState = clearCompletedDownloadsFromQueue();
    setQueueState(nextState);
  };

  const handleSaveToDevice = async (task) => {
    if (!task || !task.filename) return;
    setSavingTaskId(task.id);
    try {
      await downloadFileToDevice(task.download_url || '', task.filename, 'open');
    } catch (err) {
      Alert.alert('Hata', 'Dosya açılamadı: ' + err.message);
    } finally {
      setSavingTaskId(null);
    }
  };

  const hasFinishedTasks = queueState.tasks.some(
    (t) => t.status === 'completed' || t.status === 'failed'
  );

  const isUrlInput = isLikelyYouTubeUrl(queryOrUrl);
  const currentPreviewUrl = (selectedVideoUrl || queryOrUrl || '').trim();
  const isCurrentVideoPreviewing =
    playerState?.isActive &&
    currentPreviewUrl &&
    playerState?.id === `preview_${currentPreviewUrl}`;
  const isCurrentVideoPreviewPlaying =
    isCurrentVideoPreviewing && playerState?.isPlaying;

  return (
    <ScrollView
      style={[styles.container, isDarkMode && styles.containerDark]}
      contentContainerStyle={styles.contentContainer}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      {/* ÜST AÇILIR/KAPANIR OTOMATİK İNDİRME FORMATI SEÇİCİSİ & WI-FI KİLİDİ */}
      <View style={[styles.presetCard, isDarkMode && styles.cardDark]}>
        <View style={styles.presetHeaderRow}>
          <TouchableOpacity
            style={styles.presetTitleLeft}
            activeOpacity={0.78}
            onPress={() => setPresetMenuOpen((prev) => !prev)}
          >
            <Ionicons
              name="flash"
              size={15}
              color={isDarkMode ? '#60A5FA' : '#2563EB'}
            />
            <Text style={[styles.presetHeaderTitle, isDarkMode && styles.textPrimaryDark]}>
              İndirme Şekli
            </Text>
          </TouchableOpacity>

          <View style={styles.presetHeaderRightGroup}>
            {/* Yalnızca Wi-Fi'da İndir Kilidi */}
            <TouchableOpacity
              style={[
                styles.wifiTogglePill,
                isDarkMode && styles.wifiTogglePillDark,
                wifiOnly && styles.wifiTogglePillActive,
              ]}
              activeOpacity={0.8}
              onPress={handleToggleWifiOnly}
            >
              <Ionicons
                name={wifiOnly ? 'wifi' : 'wifi-outline'}
                size={13}
                color={
                  wifiOnly
                    ? '#FFFFFF'
                    : isDarkMode
                    ? '#94A3B8'
                    : '#475569'
                }
              />
              <Text
                style={[
                  styles.wifiToggleText,
                  isDarkMode && styles.textSecondaryDark,
                  wifiOnly && { color: '#FFFFFF' },
                ]}
              >
                Wi-Fi
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.presetSelectedBadge,
                activePreset.type === 'm4a'
                  ? styles.presetSelectedBadgeAudio
                  : styles.presetSelectedBadgeVideo,
              ]}
              activeOpacity={0.8}
              onPress={() => setPresetMenuOpen((prev) => !prev)}
            >
              <Ionicons name={activePreset.icon} size={13} color="#FFFFFF" />
              <Text style={styles.presetSelectedBadgeText} numberOfLines={1}>
                {activePreset.fullLabel}
              </Text>
              <Ionicons
                name={presetMenuOpen ? 'chevron-up' : 'chevron-down'}
                size={14}
                color="#FFFFFF"
              />
            </TouchableOpacity>
          </View>
        </View>

        {presetMenuOpen && (
          <View
            style={[
              styles.presetDropdownList,
              isDarkMode && styles.presetDropdownListDark,
            ]}
          >
            {DOWNLOAD_PRESETS.map((preset) => {
              const isSelected = activePreset.id === preset.id;
              const isAudioPreset = preset.type === 'm4a';
              return (
                <TouchableOpacity
                  key={preset.id}
                  style={[
                    styles.presetDropdownItem,
                    isDarkMode && styles.presetDropdownItemDark,
                    isSelected &&
                      (isDarkMode
                        ? styles.presetDropdownItemActiveDark
                        : styles.presetDropdownItemActive),
                  ]}
                  activeOpacity={0.8}
                  onPress={() => handleSelectPreset(preset)}
                >
                  <View style={styles.presetDropdownItemLeft}>
                    <View
                      style={[
                        styles.presetDropdownIconBox,
                        {
                          backgroundColor: isAudioPreset
                            ? isSelected
                              ? '#4F46E5'
                              : isDarkMode
                              ? '#1E1B4B'
                              : '#EEF2FF'
                            : isSelected
                            ? '#0284C7'
                            : isDarkMode
                            ? '#0C4A6E'
                            : '#E0F2FE',
                        },
                      ]}
                    >
                      <Ionicons
                        name={preset.icon}
                        size={15}
                        color={
                          isSelected
                            ? '#FFFFFF'
                            : isAudioPreset
                            ? isDarkMode
                              ? '#A5B4FC'
                              : '#4F46E5'
                            : isDarkMode
                            ? '#38BDF8'
                            : '#0284C7'
                        }
                      />
                    </View>
                    <Text
                      style={[
                        styles.presetDropdownItemText,
                        isDarkMode && styles.textPrimaryDark,
                        isSelected &&
                          (isDarkMode
                            ? { color: '#93C5FD', fontWeight: '800' }
                            : { color: '#1D4ED8', fontWeight: '800' }),
                      ]}
                    >
                      {preset.fullLabel}
                    </Text>
                  </View>

                  <Ionicons
                    name={isSelected ? 'checkmark-circle' : 'radio-button-off'}
                    size={18}
                    color={
                      isSelected
                        ? isDarkMode
                          ? '#60A5FA'
                          : '#2563EB'
                        : '#94A3B8'
                    }
                  />
                </TouchableOpacity>
              );
            })}
          </View>
        )}
      </View>

      {/* Arama Motoru & URL Giriş Kartı */}
      <View style={[styles.card, isDarkMode && styles.cardDark]}>
        <Text style={[styles.inputLabel, isDarkMode && styles.textPrimaryDark]}>
          YouTube'da Şarkı / Video Ara veya Link Yapıştır
        </Text>
        <View style={[styles.inputWrapper, isDarkMode && styles.inputWrapperDark]}>
          <Ionicons
            name="search-outline"
            size={20}
            color={isDarkMode ? '#60A5FA' : '#2563EB'}
            style={styles.linkIcon}
          />
          <TextInput
            ref={urlInputRef}
            style={[styles.textInput, isDarkMode && styles.textPrimaryDark]}
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
                setPlaylistInfo(null);
              }}
              style={styles.clearBtn}
            >
              <Ionicons name="close-circle" size={18} color="#94A3B8" />
            </TouchableOpacity>
          )}
        </View>

        {/* Butonlar: Yapıştır | Ara / Analiz Et | (Link ise) Tek Tıkla İndir */}
        <View style={styles.inputButtonsRow}>
          <TouchableOpacity
            style={[styles.pasteBtn, isDarkMode && styles.pasteBtnDark]}
            onPress={handlePaste}
          >
            <Ionicons
              name="clipboard-outline"
              size={15}
              color={isDarkMode ? '#E2E8F0' : '#334155'}
            />
            <Text style={[styles.pasteBtnText, isDarkMode && styles.textPrimaryDark]}>
              Yapıştır
            </Text>
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
                <Ionicons name="search" size={15} color="#FFFFFF" />
                <Text style={styles.fetchBtnText}>
                  {isUrlInput ? 'Önizle / Detay' : "YouTube'da Ara"}
                </Text>
              </>
            )}
          </TouchableOpacity>

          {isUrlInput && (
            <TouchableOpacity
              style={[
                styles.directDownloadBtn,
                quickLinkDownloading && { opacity: 0.7 },
              ]}
              onPress={handleDirectLinkDownload}
              disabled={quickLinkDownloading}
            >
              {quickLinkDownloading ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <>
                  <Ionicons name="download-outline" size={16} color="#FFFFFF" />
                  <Text style={styles.directDownloadBtnText}>Hemen İndir</Text>
                </>
              )}
            </TouchableOpacity>
          )}
        </View>

        {/* Hata Mesajı */}
        {errorMsg ? (
          <View style={[styles.errorBox, isDarkMode && styles.errorBoxDark]}>
            <Ionicons name="alert-circle" size={18} color="#EF4444" />
            <Text style={styles.errorText}>{errorMsg}</Text>
          </View>
        ) : null}
      </View>

      {/* Toplu YouTube Playlist / Albüm İndirme Kartı */}
      {playlistInfo && (
        <View style={[styles.card, isDarkMode && styles.cardDark]}>
          <View style={styles.playlistBatchHeader}>
            <View style={{ flex: 1 }}>
              <View style={styles.searchHeaderLeft}>
                <Ionicons name="albums-outline" size={18} color="#4F46E5" />
                <Text
                  style={[styles.searchResultsTitle, isDarkMode && styles.textPrimaryDark]}
                  numberOfLines={1}
                >
                  {playlistInfo.title}
                </Text>
              </View>
              <Text
                style={[styles.searchResultSub, isDarkMode && styles.textSecondaryDark]}
              >
                {playlistInfo.uploader} • Toplam {playlistInfo.itemCount} parça
              </Text>
            </View>
          </View>

          <TouchableOpacity
            style={styles.queueAllPlaylistBtn}
            onPress={handleQueueAllPlaylistItems}
          >
            <Ionicons name="layers-outline" size={18} color="#FFFFFF" />
            <Text style={styles.queueAllPlaylistBtnText}>
              Tümünü Seçili Formatla Kuyruğa Ekle ({playlistInfo.itemCount} Parça • {activePreset.shortLabel})
            </Text>
          </TouchableOpacity>

          <View style={[styles.searchResultsList, { marginTop: 12 }]}>
            {playlistInfo.items.map((item) => {
              const isPreviewLoading = previewLoadingUrl === item.url;
              const isItemPreviewActive =
                playerState?.isActive && playerState?.id === `preview_${item.url}`;
              const isItemPreviewPlaying =
                isItemPreviewActive && playerState?.isPlaying;
              const existingQueueTask = queueState.tasks.find(
                (t) =>
                  t.cleanUrl === item.url &&
                  (t.status === 'downloading' || t.status === 'queued')
              );

              return (
                <View
                  key={item.id}
                  style={[
                    styles.searchResultRow,
                    isDarkMode && styles.searchResultRowDark,
                  ]}
                >
                  <View style={styles.searchRowMainClick}>
                    <View style={styles.searchThumbBox}>
                      {item.thumbnail ? (
                        <Image
                          source={{ uri: item.thumbnail }}
                          style={styles.searchThumbImg}
                          resizeMode="cover"
                        />
                      ) : (
                        <View style={styles.searchThumbFallback}>
                          <Ionicons name="musical-notes" size={16} color="#FFFFFF" />
                        </View>
                      )}
                      {item.duration ? (
                        <View style={styles.durationBadge}>
                          <Text style={styles.durationText}>{item.duration}</Text>
                        </View>
                      ) : null}
                    </View>

                    <View style={styles.searchResultMeta}>
                      <Text
                        style={[
                          styles.searchResultItemTitle,
                          isDarkMode && styles.textPrimaryDark,
                        ]}
                        numberOfLines={2}
                      >
                        {item.title}
                      </Text>
                      <Text
                        style={[
                          styles.searchResultSub,
                          isDarkMode && styles.textSecondaryDark,
                        ]}
                        numberOfLines={1}
                      >
                        {item.channel}
                      </Text>
                    </View>
                  </View>

                  <View style={styles.searchRowActions}>
                    <TouchableOpacity
                      style={[
                        styles.previewListenBtn,
                        isDarkMode && styles.previewListenBtnDark,
                        isItemPreviewActive && styles.previewListenBtnActive,
                      ]}
                      onPress={() => handlePreviewListen(item)}
                      disabled={isPreviewLoading}
                    >
                      {isPreviewLoading ? (
                        <ActivityIndicator size="small" color="#4F46E5" />
                      ) : (
                        <>
                          <Ionicons
                            name={isItemPreviewPlaying ? 'pause' : 'headset-outline'}
                            size={14}
                            color={
                              isItemPreviewActive
                                ? '#FFFFFF'
                                : isDarkMode
                                ? '#A5B4FC'
                                : '#4F46E5'
                            }
                          />
                          <Text
                            style={[
                              styles.previewListenBtnText,
                              isDarkMode && { color: '#A5B4FC' },
                              isItemPreviewActive && { color: '#FFFFFF' },
                            ]}
                          >
                            {isItemPreviewPlaying ? 'Durdur' : 'Dinle'}
                          </Text>
                        </>
                      )}
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[
                        styles.oneTapDownloadBtn,
                        existingQueueTask && styles.oneTapDownloadBtnQueued,
                      ]}
                      onPress={() => handleOneTapDownloadSearchItem(item)}
                      disabled={Boolean(existingQueueTask)}
                    >
                      <Ionicons
                        name={existingQueueTask ? 'time-outline' : 'download-outline'}
                        size={15}
                        color="#FFFFFF"
                      />
                      <Text style={styles.oneTapDownloadBtnText}>
                        {existingQueueTask ? 'Sırada' : 'İndir'}
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
              );
            })}
          </View>
        </View>
      )}

      {/* YouTube Arama Sonuçları Listesi (Tek Tıkla Dinle ve Tek Tıkla İndir!) */}
      {!videoInfo && searchResults.length > 0 && (
        <View style={[styles.card, isDarkMode && styles.cardDark]}>
          <View style={styles.searchResultsHeader}>
            <View style={styles.searchHeaderLeft}>
              <Ionicons name="logo-youtube" size={18} color="#EF4444" />
              <Text style={[styles.searchResultsTitle, isDarkMode && styles.textPrimaryDark]}>
                Arama Sonuçları ({searchResults.length})
              </Text>
            </View>
            <Text style={[styles.searchResultsHint, isDarkMode && styles.textSecondaryDark]}>
              Dinle veya tek tıkla indir ({activePreset.shortLabel})
            </Text>
          </View>

          <View style={styles.searchResultsList}>
            {searchResults.map((item) => {
              const isPreviewLoading = previewLoadingUrl === item.url;
              const isItemPreviewActive =
                playerState?.isActive && playerState?.id === `preview_${item.url}`;
              const isItemPreviewPlaying =
                isItemPreviewActive && playerState?.isPlaying;

              const existingQueueTask = queueState.tasks.find(
                (t) =>
                  t.cleanUrl === item.url &&
                  (t.status === 'downloading' || t.status === 'queued')
              );

              return (
                <View
                  key={item.id}
                  style={[
                    styles.searchResultRow,
                    isDarkMode && styles.searchResultRowDark,
                    isItemPreviewActive &&
                      (isDarkMode
                        ? styles.searchResultRowPreviewingDark
                        : styles.searchResultRowPreviewing),
                  ]}
                >
                  {/* Sol & Orta: Kapak + Başlık (Dokununca detay açılır) */}
                  <TouchableOpacity
                    style={styles.searchRowMainClick}
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
                      <Text
                        style={[
                          styles.searchResultItemTitle,
                          isDarkMode && styles.textPrimaryDark,
                        ]}
                        numberOfLines={2}
                      >
                        {item.title}
                      </Text>
                      <Text
                        style={[
                          styles.searchResultSub,
                          isDarkMode && styles.textSecondaryDark,
                        ]}
                        numberOfLines={1}
                      >
                        {item.channel}
                        {item.view_count ? ` • ${item.view_count}` : ''}
                      </Text>
                    </View>
                  </TouchableOpacity>

                  {/* Sağ: 1) İndirmeden Önce Dinle (Önizle) | 2) Seçili Formatla Tek Tıkla İndir */}
                  <View style={styles.searchRowActions}>
                    <TouchableOpacity
                      style={[
                        styles.previewListenBtn,
                        isDarkMode && styles.previewListenBtnDark,
                        isItemPreviewActive && styles.previewListenBtnActive,
                      ]}
                      onPress={() => handlePreviewListen(item)}
                      disabled={isPreviewLoading}
                    >
                      {isPreviewLoading ? (
                        <ActivityIndicator
                          size="small"
                          color={isItemPreviewActive ? '#FFFFFF' : '#4F46E5'}
                        />
                      ) : (
                        <>
                          <Ionicons
                            name={
                              isItemPreviewPlaying
                                ? 'pause'
                                : isItemPreviewActive
                                ? 'play'
                                : 'headset-outline'
                            }
                            size={14}
                            color={
                              isItemPreviewActive
                                ? '#FFFFFF'
                                : isDarkMode
                                ? '#A5B4FC'
                                : '#4F46E5'
                            }
                          />
                          <Text
                            style={[
                              styles.previewListenBtnText,
                              isDarkMode && { color: '#A5B4FC' },
                              isItemPreviewActive && { color: '#FFFFFF' },
                            ]}
                          >
                            {isItemPreviewPlaying ? 'Durdur' : 'Dinle'}
                          </Text>
                        </>
                      )}
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[
                        styles.oneTapDownloadBtn,
                        existingQueueTask && styles.oneTapDownloadBtnQueued,
                      ]}
                      onPress={() => handleOneTapDownloadSearchItem(item)}
                      disabled={Boolean(existingQueueTask)}
                    >
                      <Ionicons
                        name={
                          existingQueueTask
                            ? 'time-outline'
                            : activePreset.type === 'm4a'
                            ? 'download-outline'
                            : 'videocam-outline'
                        }
                        size={15}
                        color="#FFFFFF"
                      />
                      <Text style={styles.oneTapDownloadBtnText}>
                        {existingQueueTask ? 'Sırada' : 'İndir'}
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
              );
            })}
          </View>
        </View>
      )}

      {/* Seçilen Video Detay & Özel Kalite Seçim Kartı */}
      {videoInfo && (
        <View style={[styles.card, isDarkMode && styles.cardDark]}>
          {searchResults.length > 0 && (
            <TouchableOpacity
              style={[styles.backToSearchBtn, isDarkMode && styles.backToSearchBtnDark]}
              onPress={() => setVideoInfo(null)}
            >
              <Ionicons
                name="arrow-back"
                size={15}
                color={isDarkMode ? '#60A5FA' : '#2563EB'}
              />
              <Text
                style={[
                  styles.backToSearchText,
                  isDarkMode && { color: '#60A5FA' },
                ]}
              >
                Arama Sonuçlarına Dön ({searchResults.length})
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
              <Text
                style={[styles.videoTitle, isDarkMode && styles.textPrimaryDark]}
                numberOfLines={2}
              >
                {videoInfo.title}
              </Text>
              <View style={styles.channelRow}>
                <Ionicons name="person-circle-outline" size={14} color="#94A3B8" />
                <Text
                  style={[styles.channelText, isDarkMode && styles.textSecondaryDark]}
                  numberOfLines={1}
                >
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

          {/* İndirmeden Önce Şarkıyı Dinle / Kontrol Et Butonu */}
          <TouchableOpacity
            style={[
              styles.detailPreviewListenBtn,
              isDarkMode && styles.detailPreviewListenBtnDark,
              isCurrentVideoPreviewing && styles.detailPreviewListenBtnActive,
            ]}
            onPress={() =>
              handlePreviewListen({
                url: currentPreviewUrl,
                title: videoInfo.title,
                channel: videoInfo.channel || videoInfo.author,
                thumbnail: videoInfo.thumbnail,
              })
            }
            disabled={previewLoadingUrl === currentPreviewUrl}
          >
            {previewLoadingUrl === currentPreviewUrl ? (
              <ActivityIndicator
                size="small"
                color={isCurrentVideoPreviewing ? '#FFFFFF' : '#4F46E5'}
              />
            ) : (
              <>
                <Ionicons
                  name={
                    isCurrentVideoPreviewPlaying
                      ? 'pause-circle'
                      : 'headset-outline'
                  }
                  size={18}
                  color={
                    isCurrentVideoPreviewing
                      ? '#FFFFFF'
                      : isDarkMode
                      ? '#A5B4FC'
                      : '#4F46E5'
                  }
                />
                <Text
                  style={[
                    styles.detailPreviewListenText,
                    isDarkMode && { color: '#A5B4FC' },
                    isCurrentVideoPreviewing && { color: '#FFFFFF' },
                  ]}
                >
                  {isCurrentVideoPreviewPlaying
                    ? 'Önizleme Çalıyor (Duraklatmak İçin Dokun)'
                    : isCurrentVideoPreviewing
                    ? 'Önizlemeye Devam Et'
                    : 'İndirmeden Önce Şarkıyı Dinle (Kontrol Et)'}
                </Text>
              </>
            )}
          </TouchableOpacity>

          {/* Format Seçimi: M4A vs MP4 */}
          <Text style={[styles.sectionLabel, isDarkMode && styles.textPrimaryDark]}>
            İndirme Formatı
          </Text>
          <View
            style={[
              styles.formatToggleContainer,
              isDarkMode && styles.formatToggleContainerDark,
            ]}
          >
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
                color={mediaType === 'm4a' ? '#FFFFFF' : '#94A3B8'}
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
                color={mediaType === 'mp4' ? '#FFFFFF' : '#94A3B8'}
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
          <Text style={[styles.sectionLabel, isDarkMode && styles.textPrimaryDark]}>
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
                    isDarkMode && styles.qualityChipDark,
                    isSelected &&
                      (isDarkMode
                        ? styles.qualityChipSelectedDark
                        : styles.qualityChipSelected),
                  ]}
                  onPress={() => setSelectedQuality(fmt.value)}
                >
                  <Ionicons
                    name={isSelected ? 'checkmark-circle' : 'radio-button-off'}
                    size={16}
                    color={
                      isSelected
                        ? isDarkMode
                          ? '#60A5FA'
                          : '#2563EB'
                        : '#94A3B8'
                    }
                  />
                  <Text
                    style={[
                      styles.qualityChipText,
                      isDarkMode && styles.textSecondaryDark,
                      isSelected &&
                        (isDarkMode
                          ? styles.qualityChipTextSelectedDark
                          : styles.qualityChipTextSelected),
                    ]}
                  >
                    {fmt.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* İndirme Başlat / Kuyruğa Ekle Butonu */}
          <TouchableOpacity
            style={styles.downloadActionBtn}
            onPress={handleStartDownload}
          >
            <Ionicons
              name={
                queueState.isBusy
                  ? 'add-circle-outline'
                  : mediaType === 'm4a'
                  ? 'musical-note'
                  : 'download'
              }
              size={20}
              color="#FFFFFF"
            />
            <Text style={styles.downloadActionBtnText}>
              {queueState.isBusy
                ? mediaType === 'm4a'
                  ? 'M4A Şarkıyı İndirme Sırasına Ekle'
                  : 'MP4 Videoyu İndirme Sırasına Ekle'
                : mediaType === 'm4a'
                ? 'M4A Şarkı Olarak İndir'
                : 'MP4 HD Video Olarak İndir'}
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Aktif İndirme ve Bekleyen İndirmeler Kuyruğu */}
      {queueState.tasks.length > 0 && (
        <View style={[styles.card, isDarkMode && styles.cardDark]}>
          <View style={styles.queueHeaderRow}>
            <View style={styles.queueTitleGroup}>
              <Ionicons
                name="layers-outline"
                size={18}
                color={isDarkMode ? '#60A5FA' : '#2563EB'}
              />
              <Text style={[styles.queueSectionTitle, isDarkMode && styles.textPrimaryDark]}>
                İndirme Kuyruğu ({queueState.tasks.length})
              </Text>
              {queueState.queuedCount > 0 && (
                <View style={styles.waitingCountBadge}>
                  <Text style={styles.waitingCountBadgeText}>
                    {queueState.queuedCount} Sırada
                  </Text>
                </View>
              )}
            </View>

            {hasFinishedTasks && (
              <TouchableOpacity
                style={styles.clearFinishedBtn}
                onPress={handleClearFinished}
              >
                <Text style={styles.clearFinishedText}>Tamamlananları Gizle</Text>
              </TouchableOpacity>
            )}
          </View>

          <View style={styles.queueTasksList}>
            {queueState.tasks.map((task) => {
              const isAudio = task.type === 'm4a' || task.type === 'mp3';
              const isSavingThis = savingTaskId === task.id;

              return (
                <View
                  key={task.id}
                  style={[
                    styles.taskCard,
                    isDarkMode && styles.taskCardDark,
                    task.status === 'queued' &&
                      (isDarkMode ? styles.taskCardQueuedDark : styles.taskCardQueued),
                  ]}
                >
                  <View style={styles.taskHeader}>
                    <View style={styles.taskHeaderLeft}>
                      <View
                        style={[
                          styles.typeBadge,
                          {
                            backgroundColor: isAudio ? '#4F46E5' : '#0284C7',
                          },
                        ]}
                      >
                        <Text style={styles.typeBadgeText}>
                          {isAudio ? 'M4A' : 'MP4'}
                        </Text>
                      </View>
                      <Text
                        style={[styles.taskTitle, isDarkMode && styles.textPrimaryDark]}
                        numberOfLines={1}
                      >
                        {task.title || 'Medya'}
                      </Text>
                    </View>

                    {task.status === 'queued' ? (
                      <View style={styles.queuedRightAction}>
                        <View style={styles.queueOrderPill}>
                          <Ionicons name="time-outline" size={12} color="#D97706" />
                          <Text style={styles.queueOrderPillText}>
                            {task.queuePosition > 0
                              ? `${task.queuePosition}. Sırada`
                              : 'Sırada'}
                          </Text>
                        </View>
                        <TouchableOpacity
                          style={styles.cancelQueueBtn}
                          onPress={() => handleCancelQueued(task.id)}
                        >
                          <Ionicons name="close-circle" size={19} color="#EF4444" />
                        </TouchableOpacity>
                      </View>
                    ) : (
                      <Text style={styles.percentText}>{task.progress}%</Text>
                    )}
                  </View>

                  {/* İlerleme Çubuğu */}
                  <View
                    style={[
                      styles.progressBarBg,
                      isDarkMode && styles.progressBarBgDark,
                    ]}
                  >
                    <View
                      style={[
                        styles.progressBarFill,
                        {
                          width: `${Math.min(100, Math.max(0, task.progress || 0))}%`,
                        },
                        task.status === 'completed' && { backgroundColor: '#10B981' },
                        task.status === 'failed' && { backgroundColor: '#EF4444' },
                      ]}
                    />
                  </View>

                  {/* Durum & Hız Bilgileri */}
                  <View style={styles.taskMetaRow}>
                    <View style={styles.taskStatusLeft}>
                      <Ionicons
                        name={
                          task.status === 'queued'
                            ? 'hourglass-outline'
                            : task.status === 'downloading'
                            ? 'arrow-down-circle-outline'
                            : task.status === 'completed'
                            ? 'checkmark-circle'
                            : 'alert-circle'
                        }
                        size={14}
                        color={
                          task.status === 'completed'
                            ? '#10B981'
                            : task.status === 'failed'
                            ? '#EF4444'
                            : task.status === 'queued'
                            ? '#D97706'
                            : '#2563EB'
                        }
                      />
                      <Text
                        style={[
                          styles.taskStatusText,
                          isDarkMode && styles.textSecondaryDark,
                        ]}
                        numberOfLines={1}
                      >
                        {task.status === 'queued' &&
                          'Bekleyen indirmelerde sırada bekliyor'}
                        {task.status === 'downloading' &&
                          `İndiriliyor ${task.speed ? '(' + task.speed + ')' : ''}`}
                        {task.status === 'processing' && 'Birleştiriliyor...'}
                        {task.status === 'completed' &&
                          'İndirilenler listesine kaydedildi'}
                        {task.status === 'failed' &&
                          (task.error || 'İndirme başarısız oldu')}
                      </Text>
                    </View>

                    {task.eta && task.status === 'downloading' ? (
                      <Text style={styles.taskEtaText}>Kalan: {task.eta}</Text>
                    ) : null}
                  </View>

                  {/* Tamamlandıysa: Dosyayı Aç / Paylaş ve İndirilenlere Git */}
                  {task.status === 'completed' && (
                    <View
                      style={[
                        styles.completedActions,
                        isDarkMode && styles.completedActionsDark,
                      ]}
                    >
                      <TouchableOpacity
                        style={styles.saveFileBtn}
                        onPress={() => handleSaveToDevice(task)}
                        disabled={isSavingThis}
                      >
                        {isSavingThis ? (
                          <ActivityIndicator size="small" color="#FFFFFF" />
                        ) : (
                          <>
                            <Ionicons
                              name="play-circle-outline"
                              size={17}
                              color="#FFFFFF"
                            />
                            <Text style={styles.saveFileBtnText}>
                              Dosyayı Aç / Paylaş
                            </Text>
                          </>
                        )}
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={[
                          styles.historyShortcutBtn,
                          isDarkMode && styles.historyShortcutBtnDark,
                        ]}
                        onPress={onSwitchToHistory}
                      >
                        <Ionicons
                          name="folder-open-outline"
                          size={15}
                          color={isDarkMode ? '#60A5FA' : '#2563EB'}
                        />
                        <Text
                          style={[
                            styles.historyShortcutText,
                            isDarkMode && { color: '#60A5FA' },
                          ]}
                        >
                          İndirilenlere Git & Oynat
                        </Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
              );
            })}
          </View>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F4F6F9',
  },
  containerDark: {
    backgroundColor: '#090D16',
  },
  contentContainer: {
    paddingHorizontal: 14,
    paddingTop: 8,
    paddingBottom: 24,
  },
  textPrimaryDark: {
    color: '#F8FAFC',
  },
  textSecondaryDark: {
    color: '#94A3B8',
  },
  // Üst Açılır/Kapanır Bento İndirme Formatı Seçici Stilleri
  presetCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 22,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#E6EAF0',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 10,
    elevation: 2,
  },
  presetHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  presetTitleLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  presetHeaderTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#0F172A',
  },
  presetHeaderRightGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  wifiTogglePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderRadius: 10,
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: '#CBD5E1',
  },
  wifiTogglePillDark: {
    backgroundColor: '#1E293B',
    borderColor: '#334155',
  },
  wifiTogglePillActive: {
    backgroundColor: '#059669',
    borderColor: '#059669',
  },
  wifiToggleText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#475569',
  },
  playlistBatchHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  queueAllPlaylistBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    backgroundColor: '#4F46E5',
    height: 42,
    borderRadius: 11,
    paddingHorizontal: 12,
  },
  queueAllPlaylistBtnText: {
    color: '#FFFFFF',
    fontSize: 12.5,
    fontWeight: '700',
  },
  presetSelectedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: 10,
  },
  presetSelectedBadgeAudio: {
    backgroundColor: '#4F46E5',
  },
  presetSelectedBadgeVideo: {
    backgroundColor: '#0284C7',
  },
  presetSelectedBadgeText: {
    fontSize: 11.5,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  presetDropdownList: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
    gap: 7,
  },
  presetDropdownListDark: {
    borderTopColor: '#1E293B',
  },
  presetDropdownItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 9,
    paddingHorizontal: 11,
    borderRadius: 10,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  presetDropdownItemDark: {
    backgroundColor: '#0B0F19',
    borderColor: '#1E293B',
  },
  presetDropdownItemActive: {
    backgroundColor: '#EFF6FF',
    borderColor: '#3B82F6',
  },
  presetDropdownItemActiveDark: {
    backgroundColor: '#1E293B',
    borderColor: '#3B82F6',
  },
  presetDropdownItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    flex: 1,
  },
  presetDropdownIconBox: {
    width: 28,
    height: 28,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  presetDropdownItemText: {
    fontSize: 12.5,
    fontWeight: '600',
    color: '#334155',
    flex: 1,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 22,
    padding: 15,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#E6EAF0',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.05,
    shadowRadius: 12,
    elevation: 3,
  },
  cardDark: {
    backgroundColor: '#111827',
    borderColor: '#1E293B',
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
    backgroundColor: '#F4F6F9',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#DCE2EC',
    paddingHorizontal: 12,
  },
  inputWrapperDark: {
    backgroundColor: '#0B0F19',
    borderColor: '#334155',
  },
  linkIcon: {
    marginRight: 8,
  },
  textInput: {
    flex: 1,
    height: 46,
    color: '#0F172A',
    fontSize: 13.5,
  },
  clearBtn: {
    padding: 4,
  },
  inputButtonsRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 10,
  },
  pasteBtn: {
    flex: 0.8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    backgroundColor: '#F4F6F9',
    height: 44,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#DCE2EC',
  },
  pasteBtnDark: {
    backgroundColor: '#1E293B',
    borderColor: '#334155',
  },
  pasteBtnText: {
    color: '#334155',
    fontSize: 12,
    fontWeight: '700',
  },
  fetchBtn: {
    flex: 1.2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#2563EB',
    height: 44,
    borderRadius: 14,
    shadowColor: '#2563EB',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.22,
    shadowRadius: 8,
    elevation: 3,
  },
  fetchBtnText: {
    color: '#FFFFFF',
    fontSize: 12.5,
    fontWeight: '700',
  },
  directDownloadBtn: {
    flex: 1.1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    backgroundColor: '#4F46E5',
    height: 44,
    borderRadius: 14,
    shadowColor: '#4F46E5',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.22,
    shadowRadius: 8,
    elevation: 3,
  },
  directDownloadBtnText: {
    color: '#FFFFFF',
    fontSize: 12,
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
  errorBoxDark: {
    backgroundColor: '#2A1215',
    borderColor: '#7F1D1D',
  },
  errorText: {
    color: '#EF4444',
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
    fontSize: 13.5,
    fontWeight: '800',
    color: '#0F172A',
  },
  searchResultsHint: {
    fontSize: 10.5,
    color: '#64748B',
    fontWeight: '600',
  },
  searchResultsList: {
    gap: 8,
  },
  searchResultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F4F6F9',
    borderRadius: 16,
    padding: 9,
    borderWidth: 1,
    borderColor: '#E6EAF0',
    gap: 8,
  },
  searchResultRowDark: {
    backgroundColor: '#0B0F19',
    borderColor: '#1E293B',
  },
  searchResultRowPreviewing: {
    borderColor: '#6366F1',
    backgroundColor: '#EEF2FF',
  },
  searchResultRowPreviewingDark: {
    borderColor: '#6366F1',
    backgroundColor: '#1E1B4B',
  },
  searchRowMainClick: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  searchThumbBox: {
    width: 72,
    height: 48,
    borderRadius: 12,
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
    fontSize: 12,
    fontWeight: '700',
    color: '#0F172A',
    lineHeight: 15.5,
  },
  searchResultSub: {
    fontSize: 10.5,
    color: '#64748B',
    marginTop: 2,
  },
  searchRowActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  previewListenBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    height: 34,
    paddingHorizontal: 9,
    borderRadius: 12,
    backgroundColor: '#EEF2FF',
    borderWidth: 1,
    borderColor: '#C7D2FE',
  },
  previewListenBtnDark: {
    backgroundColor: '#1E1B4B',
    borderColor: '#3730A3',
  },
  previewListenBtnActive: {
    backgroundColor: '#4F46E5',
    borderColor: '#4F46E5',
  },
  previewListenBtnText: {
    fontSize: 10.5,
    fontWeight: '700',
    color: '#4F46E5',
  },
  oneTapDownloadBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    height: 34,
    paddingHorizontal: 10,
    borderRadius: 12,
    backgroundColor: '#2563EB',
  },
  oneTapDownloadBtnQueued: {
    backgroundColor: '#D97706',
  },
  oneTapDownloadBtnText: {
    fontSize: 10.5,
    fontWeight: '700',
    color: '#FFFFFF',
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
  backToSearchBtnDark: {
    backgroundColor: '#1E293B',
    borderColor: '#334155',
  },
  backToSearchText: {
    color: '#2563EB',
    fontSize: 11.5,
    fontWeight: '700',
  },
  previewHeader: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 12,
  },
  thumbnailContainer: {
    width: 116,
    height: 70,
    borderRadius: 10,
    overflow: 'hidden',
    position: 'relative',
    backgroundColor: '#1E293B',
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
    fontSize: 9,
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
  detailPreviewListenBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    height: 40,
    borderRadius: 10,
    backgroundColor: '#EEF2FF',
    borderWidth: 1,
    borderColor: '#C7D2FE',
    marginBottom: 12,
  },
  detailPreviewListenBtnDark: {
    backgroundColor: '#1E1B4B',
    borderColor: '#3730A3',
  },
  detailPreviewListenBtnActive: {
    backgroundColor: '#4F46E5',
    borderColor: '#4F46E5',
  },
  detailPreviewListenText: {
    fontSize: 12.5,
    fontWeight: '700',
    color: '#4F46E5',
  },
  sectionLabel: {
    fontSize: 12.5,
    fontWeight: '700',
    color: '#334155',
    marginBottom: 7,
    marginTop: 2,
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
  formatToggleContainerDark: {
    backgroundColor: '#0B0F19',
    borderColor: '#1E293B',
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
  qualityChipDark: {
    backgroundColor: '#0B0F19',
    borderColor: '#1E293B',
  },
  qualityChipSelected: {
    borderColor: '#2563EB',
    backgroundColor: '#EFF6FF',
  },
  qualityChipSelectedDark: {
    borderColor: '#3B82F6',
    backgroundColor: '#1E293B',
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
  qualityChipTextSelectedDark: {
    color: '#60A5FA',
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
    fontSize: 14,
    fontWeight: '700',
  },
  // İndirme Kuyruğu Stilleri
  queueHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  queueTitleGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  queueSectionTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0F172A',
  },
  waitingCountBadge: {
    backgroundColor: '#FEF3C7',
    borderWidth: 1,
    borderColor: '#FDE68A',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 10,
  },
  waitingCountBadgeText: {
    color: '#B45309',
    fontSize: 10.5,
    fontWeight: '800',
  },
  clearFinishedBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  clearFinishedText: {
    color: '#64748B',
    fontSize: 11,
    fontWeight: '700',
  },
  queueTasksList: {
    gap: 10,
  },
  taskCard: {
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#BFDBFE',
    backgroundColor: '#F8FAFC',
  },
  taskCardDark: {
    backgroundColor: '#0B0F19',
    borderColor: '#1E293B',
  },
  taskCardQueued: {
    borderColor: '#FDE68A',
    backgroundColor: '#FFFBEB',
  },
  taskCardQueuedDark: {
    borderColor: '#78350F',
    backgroundColor: '#1C1917',
  },
  taskHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
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
    fontSize: 10.5,
    fontWeight: '800',
  },
  taskTitle: {
    color: '#0F172A',
    fontSize: 12.5,
    fontWeight: '700',
    flex: 1,
  },
  queuedRightAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginLeft: 6,
  },
  queueOrderPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: '#FEF3C7',
    paddingHorizontal: 7,
    paddingVertical: 2.5,
    borderRadius: 8,
  },
  queueOrderPillText: {
    color: '#B45309',
    fontSize: 10.5,
    fontWeight: '800',
  },
  cancelQueueBtn: {
    padding: 2,
  },
  percentText: {
    color: '#2563EB',
    fontSize: 13.5,
    fontWeight: '800',
    marginLeft: 8,
  },
  progressBarBg: {
    height: 7,
    backgroundColor: '#E2E8F0',
    borderRadius: 4,
    overflow: 'hidden',
    marginBottom: 8,
  },
  progressBarBgDark: {
    backgroundColor: '#1E293B',
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
  taskStatusLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    flex: 1,
  },
  taskStatusText: {
    color: '#475569',
    fontSize: 11.5,
    fontWeight: '600',
    flex: 1,
  },
  taskEtaText: {
    color: '#2563EB',
    fontSize: 11,
    fontWeight: '700',
  },
  completedActions: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
    flexDirection: 'row',
    gap: 8,
  },
  completedActionsDark: {
    borderTopColor: '#1E293B',
  },
  saveFileBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#10B981',
    height: 36,
    borderRadius: 9,
  },
  saveFileBtnText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  historyShortcutBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    height: 36,
    borderRadius: 9,
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
  },
  historyShortcutBtnDark: {
    backgroundColor: '#1E293B',
    borderColor: '#334155',
  },
  historyShortcutText: {
    color: '#2563EB',
    fontSize: 12,
    fontWeight: '700',
  },
});
