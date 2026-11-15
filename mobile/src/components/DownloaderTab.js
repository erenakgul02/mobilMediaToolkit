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
  getDownloadQueueState,
  cancelQueuedDownload,
  clearCompletedDownloadsFromQueue,
  downloadFileToDevice,
} from '../services/api';

export default function DownloaderTab({ isDarkMode, onSwitchToHistory }) {
  const [queryOrUrl, setQueryOrUrl] = useState('');
  const [loadingInfo, setLoadingInfo] = useState(false);
  const [searchResults, setSearchResults] = useState([]);
  const [videoInfo, setVideoInfo] = useState(null);
  const [selectedVideoUrl, setSelectedVideoUrl] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  // Format selection ('m4a' or 'mp4')
  const [mediaType, setMediaType] = useState('m4a');
  const [selectedQuality, setSelectedQuality] = useState('high');

  // Download Queue & Progress state
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
    syncQueueState();
    pollTimerRef.current = setInterval(() => {
      syncQueueState();
    }, 450);

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

  return (
    <ScrollView
      style={[styles.container, isDarkMode && styles.containerDark]}
      contentContainerStyle={styles.contentContainer}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      {/* Başlık & Slogan */}
      <View style={styles.headerArea}>
        <Text style={[styles.appTitle, isDarkMode && styles.textPrimaryDark]}>
          YouTube Arama & Medya İndirici
        </Text>
        <Text style={[styles.appSubtitle, isDarkMode && styles.textSecondaryDark]}>
          İstediğiniz şarkı veya videoyu doğrudan aratıp yüksek kalitede M4A (Ses) veya Full HD MP4 (Video) olarak indirin. Birden fazla medyayı arka arkaya sıraya ekleyebilirsiniz.
        </Text>
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
            placeholderTextColor={isDarkMode ? '#64748B' : '#64748B'}
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
          <TouchableOpacity
            style={[styles.pasteBtn, isDarkMode && styles.pasteBtnDark]}
            onPress={handlePaste}
          >
            <Ionicons
              name="clipboard-outline"
              size={16}
              color={isDarkMode ? '#E2E8F0' : '#334155'}
            />
            <Text style={[styles.pasteBtnText, isDarkMode && styles.textPrimaryDark]}>
              Link Yapıştır
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
                <Ionicons name="search" size={16} color="#FFFFFF" />
                <Text style={styles.fetchBtnText}>
                  {isLikelyYouTubeUrl(queryOrUrl) ? 'Analiz Et' : "YouTube'da Ara"}
                </Text>
              </>
            )}
          </TouchableOpacity>
        </View>

        {/* Hata Mesajı */}
        {errorMsg ? (
          <View style={[styles.errorBox, isDarkMode && styles.errorBoxDark]}>
            <Ionicons name="alert-circle" size={18} color="#EF4444" />
            <Text style={styles.errorText}>{errorMsg}</Text>
          </View>
        ) : null}
      </View>

      {/* YouTube Arama Sonuçları Listesi */}
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
              Seçmek için dokunun
            </Text>
          </View>

          <View style={styles.searchResultsList}>
            {searchResults.map((item) => (
              <TouchableOpacity
                key={item.id}
                style={[styles.searchResultRow, isDarkMode && styles.searchResultRowDark]}
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
                    style={[styles.searchResultItemTitle, isDarkMode && styles.textPrimaryDark]}
                    numberOfLines={2}
                  >
                    {item.title}
                  </Text>
                  <Text
                    style={[styles.searchResultSub, isDarkMode && styles.textSecondaryDark]}
                    numberOfLines={1}
                  >
                    {item.channel}
                    {item.view_count ? ` • ${item.view_count} görüntüleme` : ''}
                  </Text>
                </View>

                <View style={[styles.selectPill, isDarkMode && styles.selectPillDark]}>
                  <Ionicons
                    name="download-outline"
                    size={16}
                    color={isDarkMode ? '#60A5FA' : '#2563EB'}
                  />
                </View>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      )}

      {/* Seçilen Video Önizleme & İndirme Kartı */}
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
    backgroundColor: '#F8FAFC',
  },
  containerDark: {
    backgroundColor: '#0B0F19',
  },
  contentContainer: {
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 28,
  },
  headerArea: {
    marginBottom: 10,
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
  textPrimaryDark: {
    color: '#F8FAFC',
  },
  textSecondaryDark: {
    color: '#94A3B8',
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
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#CBD5E1',
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
  pasteBtnDark: {
    backgroundColor: '#1E293B',
    borderColor: '#334155',
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
  searchResultRowDark: {
    backgroundColor: '#0B0F19',
    borderColor: '#1E293B',
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
  selectPillDark: {
    backgroundColor: '#1E293B',
    borderColor: '#334155',
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
    marginBottom: 14,
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
