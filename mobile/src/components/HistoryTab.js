import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getTheme, lightTheme, darkTheme } from '../theme';
import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Platform,
  Image,
  TextInput,
  ScrollView,
  Modal,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  getLocalHistory,
  deleteLocalHistoryItem,
  downloadFileToDevice,
  playAudioPlaylist,
  togglePlayPauseAudio,
  playVideoInApp,
  getPlaylists,
  createPlaylist,
  deletePlaylist,
  renamePlaylist,
  toggleTrackInPlaylist,
  trimAudioClip,
} from '../services/api';

function isItemAudio(item) {
  const fname = (item?.filename || '').toLowerCase();
  return (
    item?.type === 'm4a' ||
    item?.type === 'mp3' ||
    fname.endsWith('.m4a') ||
    fname.endsWith('.mp3') ||
    fname.endsWith('.aac') ||
    fname.endsWith('.ogg')
  );
}

function parseSizeToBytes(sizeStr) {
  if (!sizeStr) return 0;
  const s = String(sizeStr).trim().toUpperCase().replace(',', '.');
  const num = parseFloat(s) || 0;
  if (s.includes('GB')) return num * 1024 * 1024 * 1024;
  if (s.includes('MB')) return num * 1024 * 1024;
  if (s.includes('KB')) return num * 1024;
  return num;
}

function formatTotalBytes(bytes) {
  if (!bytes || bytes <= 0) return '0 MB';
  const mb = bytes / (1024 * 1024);
  if (mb >= 1024) {
    return `${(mb / 1024).toFixed(2)} GB`;
  }
  return `${mb.toFixed(1)} MB`;
}

const SORT_OPTIONS = [
  { id: 'date_desc', label: 'En Yeni', icon: /** @type {const} */ ('time-outline') },
  { id: 'date_asc', label: 'En Eski', icon: /** @type {const} */ ('hourglass-outline') },
  { id: 'title_asc', label: 'İsim (A-Z)', icon: /** @type {const} */ ('text-outline') },
  { id: 'title_desc', label: 'İsim (Z-A)', icon: /** @type {const} */ ('text-outline') },
  { id: 'artist_asc', label: 'Sanatçı (A-Z)', icon: /** @type {const} */ ('person-outline') },
  { id: 'size_desc', label: 'Boyut', icon: /** @type {const} */ ('analytics-outline') },
];

export default function HistoryTab({
  initialSearch = '',
  isDarkMode,
  onSwitchToDownloader,
  playerState,
  onOpenExpandedPlayer,
}) {
  const theme = getTheme(isDarkMode);
  const styles = isDarkMode ? darkStyles : lightStyles;
  const [items, setItems] = useState([]);
  const [menuItem, setMenuItem] = useState(null);
  const [playlists, setPlaylists] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(null);

  // Filtre ve Sıralama State'leri
  const [filterType, setFilterType] = useState('all'); // 'all' | 'audio' | 'video'
  const [selectedArtist, setSelectedArtist] = useState('ALL');
  const [selectedPlaylistId, setSelectedPlaylistId] = useState('ALL');
  const [sortBy, setSortBy] = useState('date_desc');
  const [showSortBar, setShowSortBar] = useState(false);

  const [searchQuery, setSearchQuery] = useState(initialSearch);

  // Playlist Oluşturma & Şarkı Seçme Modal State'leri
  const [playlistModalVisible, setPlaylistModalVisible] = useState(false);
  const [playlistModalMode, setPlaylistModalMode] = useState('create'); // 'create' | 'edit' | 'quickAdd'
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [draftSelectedFilenames, setDraftSelectedFilenames] = useState([]);
  const [editingPlaylistId, setEditingPlaylistId] = useState(null);
  const [quickAddTargetSong, setQuickAddTargetSong] = useState(null);

  // Depolama Özeti & Ses Kırpıcı (Zil Sesi) State'leri
  const insets = useSafeAreaInsets();
  const [showLists, setShowLists] = useState(false);
  const [showArtists, setShowArtists] = useState(false);
  const [trimModalVisible, setTrimModalVisible] = useState(false);
  const [trimTargetSong, setTrimTargetSong] = useState(null);
  const [trimStartSec, setTrimStartSec] = useState('30');
  const [trimEndSec, setTrimEndSec] = useState('60');
  const [trimLoading, setTrimLoading] = useState(false);

  const loadHistoryAndPlaylists = async () => {
    setLoading(true);
    try {
      const [historyData, playlistData] = await Promise.all([
        getLocalHistory(),
        getPlaylists(),
      ]);
      setItems(historyData);
      setPlaylists(playlistData);
    } catch (e) {
      console.warn('Geçmiş veya listeler alınamadı:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let active = true;
    Promise.all([getLocalHistory(), getPlaylists()])
      .then(([history, lists]) => {
        if (!active) return;
        setItems(history);
        setPlaylists(lists);
      })
      .catch((error) => console.warn('Arşiv yüklenemedi:', error))
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const audioItems = useMemo(() => items.filter(isItemAudio), [items]);
  const videoItems = useMemo(() => items.filter((i) => !isItemAudio(i)), [items]);

  const totalDownloadedSizeLabel = useMemo(() => {
    const sumBytes = items.reduce(
      (acc, cur) => acc + parseSizeToBytes(cur.filesize),
      0
    );
    return formatTotalBytes(sumBytes);
  }, [items]);

  const openTrimmerModal = (songItem) => {
    setTrimTargetSong(songItem);
    setTrimStartSec('30');
    setTrimEndSec('60');
    setTrimModalVisible(true);
  };

  const handleApplyQuickTrimRange = (startS, durationS) => {
    const s = Math.max(0, Number(startS) || 0);
    const d = Math.max(5, Number(durationS) || 30);
    setTrimStartSec(String(s));
    setTrimEndSec(String(s + d));
  };

  const handleExecuteTrim = async (setAsRingtone) => {
    if (!trimTargetSong) return;
    const startN = parseFloat(trimStartSec) || 0;
    const endN = parseFloat(trimEndSec) || 0;
    if (endN <= startN + 1) {
      Alert.alert(
        'Uyarı',
        'Bitiş saniyesi başlangıç saniyesinden en az 2 saniye büyük olmalıdır.'
      );
      return;
    }

    setTrimLoading(true);
    try {
      const res = await trimAudioClip({
        item: trimTargetSong,
        startSec: startN,
        endSec: endN,
        setAsRingtone,
      });
      await loadHistoryAndPlaylists();
      setTrimModalVisible(false);

      if (setAsRingtone) {
        if (res?.needsWriteSettingsPermission) {
          Alert.alert(
            'Kesit Kaydedildi & İzin Gerekli',
            `Şarkı kesiti (${res.fileName}) Arşiv listesine kaydedildi. Telefon zil sesi olarak otomatik atanabilmesi için açılan ekrandan 'Sistem ayarlarını değiştirme' iznini aktif edip tekrar deneyebilirsiniz.`
          );
        } else if (res?.ringtoneSet) {
          Alert.alert(
            'Zil Sesi Ayarlandı',
            `Seçtiğiniz ${Math.floor(endN - startN)} saniyelik kesit (${res.fileName}) kaydedildi ve telefon zil sesi olarak ayarlandı.`
          );
        } else {
          Alert.alert(
            'Kesit Kaydedildi',
            `Şarkı kesiti (${res?.fileName || 'M4A'}) Arşiv listesine ve Ringtones klasörüne kaydedildi.`
          );
        }
      } else {
        Alert.alert(
          'Kesit Hazır',
          `${Math.floor(endN - startN)} saniyelik şarkı kesiti (${res?.fileName || 'M4A'}) Arşiv listesinin en üstüne eklendi.`
        );
      }
    } catch (e) {
      Alert.alert('Kırpma Hatası', e.message || 'Ses dosyası kesilemedi.');
    } finally {
      setTrimLoading(false);
    }
  };

  const activePlaylistObj = useMemo(
    () => playlists.find((p) => p.id === selectedPlaylistId) || null,
    [playlists, selectedPlaylistId]
  );

  // Benzersiz sanatçı / kanal listesini çıkar
  const artistList = useMemo(() => {
    const counts = {};
    items.forEach((item) => {
      const artist = (item.uploader || '').trim();
      if (artist && artist !== 'YouTube' && artist !== 'Media Toolkit') {
        counts[artist] = (counts[artist] || 0) + 1;
      }
    });
    return Object.keys(counts)
      .sort((a, b) => a.localeCompare(b, 'tr'))
      .map((name) => ({ name, count: counts[name] }));
  }, [items]);

  // Tür, Playlist, Sanatçı, Arama ve Sıralama uygulanmış liste
  const filteredAndSortedItems = useMemo(() => {
    let list =
      filterType === 'audio'
        ? [...audioItems]
        : filterType === 'video'
        ? [...videoItems]
        : [...items];

    if (selectedPlaylistId !== 'ALL' && activePlaylistObj) {
      const trackSet = new Set(activePlaylistObj.trackFilenames || []);
      list = audioItems.filter((i) => trackSet.has(i.filename));
    }

    if (selectedArtist !== 'ALL') {
      list = list.filter(
        (i) => (i.uploader || '').trim() === selectedArtist
      );
    }

    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      list = list.filter(
        (i) =>
          (i.title || i.filename || '').toLowerCase().includes(q) ||
          (i.uploader || '').toLowerCase().includes(q)
      );
    }

    list.sort((a, b) => {
      switch (sortBy) {
        case 'date_asc': {
          const tA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
          const tB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
          return tA - tB;
        }
        case 'title_asc':
          return (a.title || a.filename || '').localeCompare(
            b.title || b.filename || '',
            'tr'
          );
        case 'title_desc':
          return (b.title || b.filename || '').localeCompare(
            a.title || a.filename || '',
            'tr'
          );
        case 'artist_asc':
          return (a.uploader || 'Z').localeCompare(b.uploader || 'Z', 'tr');
        case 'size_desc':
          return parseSizeToBytes(b.filesize) - parseSizeToBytes(a.filesize);
        case 'date_desc':
        default: {
          const tA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
          const tB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
          return tB - tA;
        }
      }
    });

    return list;
  }, [
    items,
    audioItems,
    videoItems,
    filterType,
    selectedPlaylistId,
    activePlaylistObj,
    selectedArtist,
    searchQuery,
    sortBy,
  ]);

  const activeAudioPlaylist = useMemo(
    () => filteredAndSortedItems.filter(isItemAudio),
    [filteredAndSortedItems]
  );

  // ==========================================
  // PLAYLIST (ÇALMA LİSTESİ) AKSİYONLARI
  // ==========================================

  const openCreatePlaylistModal = (preselectedFilename = null) => {
    setPlaylistModalMode('create');
    setNewPlaylistName('');
    setDraftSelectedFilenames(preselectedFilename ? [preselectedFilename] : []);
    setEditingPlaylistId(null);
    setPlaylistModalVisible(true);
  };

  const openEditPlaylistTracksModal = (playlist) => {
    if (!playlist) return;
    setPlaylistModalMode('edit');
    setEditingPlaylistId(playlist.id);
    setNewPlaylistName(playlist.name);
    setDraftSelectedFilenames([...(playlist.trackFilenames || [])]);
    setPlaylistModalVisible(true);
  };

  const openQuickAddSongModal = (songItem) => {
    setQuickAddTargetSong(songItem);
    setPlaylistModalMode('quickAdd');
    setNewPlaylistName('');
    setPlaylistModalVisible(true);
  };

  const toggleDraftSongSelection = (filename) => {
    setDraftSelectedFilenames((prev) =>
      prev.includes(filename)
        ? prev.filter((f) => f !== filename)
        : [...prev, filename]
    );
  };

  const handleSaveCreatePlaylist = async () => {
    const cleanName = newPlaylistName.trim();
    if (!cleanName) {
      Alert.alert('Uyarı', 'Lütfen çalma listesi için bir ad yazın.');
      return;
    }
    try {
      const { playlist, playlists: updated } = await createPlaylist(
        cleanName,
        draftSelectedFilenames
      );
      setPlaylists(updated);
      setFilterType('audio');
      setSelectedPlaylistId(playlist.id);
      setPlaylistModalVisible(false);
    } catch (e) {
      Alert.alert('Hata', e.message || 'Liste oluşturulamadı.');
    }
  };

  const handleSaveEditPlaylist = async () => {
    const cleanName = newPlaylistName.trim();
    if (!cleanName) {
      Alert.alert('Uyarı', 'Lütfen çalma listesi için bir ad yazın.');
      return;
    }
    try {
      if (editingPlaylistId) {
        const updated = await renamePlaylist(editingPlaylistId, cleanName);
        setPlaylists(updated);
      }
      setPlaylistModalVisible(false);
    } catch (e) {
      Alert.alert('Hata', e.message || 'Liste adı güncellenemedi.');
    }
  };

  const handleToggleSongInExistingPlaylist = async (playlistId, filename) => {
    const updated = await toggleTrackInPlaylist(playlistId, filename);
    setPlaylists(updated);
    const targetPl = updated.find((p) => p.id === playlistId);
    if (targetPl) {
      setDraftSelectedFilenames([...(targetPl.trackFilenames || [])]);
    }
  };

  const handleDeletePlaylist = (playlist) => {
    if (!playlist) return;
    Alert.alert(
      'Çalma Listesini Sil',
      `'${playlist.name}' çalma listesini silmek istediğinize emin misiniz? (İndirilen şarkılarınız telefondan silinmez.)`,
      [
        { text: 'İptal', style: 'cancel' },
        {
          text: 'Listeyi Sil',
          style: 'destructive',
          onPress: async () => {
            const updated = await deletePlaylist(playlist.id);
            setPlaylists(updated);
            if (selectedPlaylistId === playlist.id) {
              setSelectedPlaylistId('ALL');
            }
          },
        },
      ]
    );
  };

  // ==========================================
  // MEDYA OYNATMA VE DOSYA AKSİYONLARI
  // ==========================================

  const handlePlaySong = async (targetItem) => {
    const playlistPool =
      activeAudioPlaylist.length > 0 ? activeAudioPlaylist : audioItems;
    if (playlistPool.length === 0) return;

    const isCurrentlyLoaded =
      playerState?.isActive &&
      ((targetItem.id && playerState.id === targetItem.id) ||
        (targetItem.filename && playerState.filename === targetItem.filename));

    if (isCurrentlyLoaded) {
      try {
        await togglePlayPauseAudio();
      } catch (e) {
        Alert.alert('Hata', 'Oynatıcı durumu değiştirilemedi: ' + e.message);
      }
      return;
    }

    const startIndex = Math.max(
      0,
      playlistPool.findIndex(
        (a) =>
          (targetItem.id && a.id === targetItem.id) ||
          a.filename === targetItem.filename
      )
    );

    try {
      await playAudioPlaylist(playlistPool, startIndex);
    } catch (e) {
      Alert.alert('Oynatma Hatası', e.message || 'Şarkı başlatılamadı.');
    }
  };

  const handlePlayAllSongs = async () => {
    const playlistPool =
      activeAudioPlaylist.length > 0 ? activeAudioPlaylist : audioItems;
    if (playlistPool.length === 0) {
      Alert.alert('Uyarı', 'Bu listede henüz çalınacak şarkı bulunmuyor.');
      return;
    }
    try {
      await playAudioPlaylist(playlistPool, 0);
    } catch (e) {
      Alert.alert('Oynatma Hatası', e.message || 'Şarkı listesi başlatılamadı.');
    }
  };

  const handlePlayVideo = async (item) => {
    const key = `${item.filename}_video`;
    setActionLoading(key);
    try {
      await playVideoInApp(item);
    } catch (e) {
      Alert.alert('Video Hatası', 'Video açılamadı: ' + e.message);
    } finally {
      setActionLoading(null);
    }
  };

  const handleShare = async (item) => {
    const key = `${item.filename}_share`;
    setActionLoading(key);
    try {
      await downloadFileToDevice(item.download_url, item.filename, 'share');
    } catch (e) {
      Alert.alert('Paylaşım Hatası', 'Dosya paylaşılamadı: ' + e.message);
    } finally {
      setActionLoading(null);
    }
  };

  const handleDelete = async (item) => {
    const filename = item.filename;
    const displayTitle = item.title || filename;
    const doDelete = async () => {
      try {
        await deleteLocalHistoryItem(filename, item.download_url || '');
        setItems((prev) => prev.filter((i) => i.filename !== filename));
        const updatedPlaylists = await getPlaylists();
        setPlaylists(updatedPlaylists);
      } catch (e) {
        Alert.alert('Hata', 'Silinemedi: ' + e.message);
      }
    };

    if (Platform.OS === 'web') {
      if (
        window.confirm(
          `'${displayTitle}' dosyasını telefon hafızasından ve listeden silmek istediğinize emin misiniz?`
        )
      ) {
        doDelete();
      }
    } else {
      Alert.alert(
        'Telefondan Kalıcı Olarak Sil',
        `'${displayTitle}' dosyasını hem uygulama listesinden hem de telefon hafızasından (Download/MediaToolkit) tamamen silmek istediğinize emin misiniz?`,
        [
          { text: 'İptal', style: 'cancel' },
          { text: 'Tamamen Sil', style: 'destructive', onPress: doDelete },
        ]
      );
    }
  };

  const currentSortLabel =
    SORT_OPTIONS.find((s) => s.id === sortBy)?.label || 'En Yeni';

  const renderItem = ({ item }) => {
    const fname = item.filename || '';
    const isAudio = isItemAudio(item);
    const badgeLabel = fname.toLowerCase().endsWith('.mp3')
      ? 'MP3'
      : isAudio
      ? 'M4A'
      : 'MP4';

    const isVideoLoading = actionLoading === `${item.filename}_video`;

    const isCurrentTrack =
      isAudio &&
      playerState?.isActive &&
      ((item.id && playerState.id === item.id) ||
        (item.filename && playerState.filename === item.filename));
    const isCurrentTrackPlaying = isCurrentTrack && playerState?.isPlaying;

    const metaParts = [];
    if (item.uploader) metaParts.push(item.uploader);
    if (item.filesize) metaParts.push(item.filesize);
    if (item.quality) {
      metaParts.push(item.quality === 'high' ? 'AAC' : item.quality);
    }
    const subtitleText = metaParts.join(' • ') || (item.date || 'Bugün');

    return (
      <TouchableOpacity
        activeOpacity={0.78}
        onPress={() => {
          if (isAudio) {
            if (isCurrentTrack && onOpenExpandedPlayer) {
              onOpenExpandedPlayer();
            } else {
              handlePlaySong(item);
            }
          } else {
            handlePlayVideo(item);
          }
        }}
        style={[
          styles.compactCard,
          isDarkMode && styles.compactCardDark,
          isCurrentTrack &&
            (isDarkMode
              ? styles.compactCardPlayingDark
              : styles.compactCardPlaying),
        ]}
      >
        {/* Sol: Kapak Görseli */}
        <View style={styles.thumbWrapper}>
          {isAudio ? (
            <View
              style={[
                styles.vinylThumbOuter,
                isCurrentTrackPlaying && styles.vinylThumbActiveBorder,
              ]}
            >
              {item.thumbnail ? (
                <Image
                  source={{ uri: item.thumbnail }}
                  style={styles.vinylThumbImage}
                  resizeMode="cover"
                />
              ) : (
                <View style={styles.vinylFallback}>
                  <Ionicons name="musical-notes" size={16} color={theme.onAccent} />
                </View>
              )}
              <View style={styles.vinylCenterHole} />
            </View>
          ) : (
            <View style={styles.videoThumbBox}>
              {item.thumbnail ? (
                <Image
                  source={{ uri: item.thumbnail }}
                  style={styles.videoThumbImage}
                  resizeMode="cover"
                />
              ) : (
                <View style={styles.videoFallback}>
                  <Ionicons name="videocam" size={18} color={theme.onAccent} />
                </View>
              )}
              <View style={styles.videoPlayOverlay}>
                <Ionicons name="play" size={12} color={theme.text} />
              </View>
            </View>
          )}

          {/* Küçük Format Rozeti */}
          <View
            style={[
              styles.miniTypeBadge,
              { backgroundColor: theme.accent },
            ]}
          >
            <Text style={styles.miniTypeBadgeText}>{badgeLabel}</Text>
          </View>
        </View>

        {/* Orta: Başlık & Detay Satırı */}
        <View style={styles.infoCol}>
          <Text
            style={[
              styles.titleText,
              isDarkMode && styles.textPrimaryDark,
              isCurrentTrack &&
                (isDarkMode
                  ? styles.titleTextPlayingDark
                  : styles.titleTextPlaying),
            ]}
            numberOfLines={1}
          >
            {item.title || item.filename}
          </Text>

          <View style={styles.subRow}>
            {isCurrentTrack && (
              <View style={styles.liveDotBadge}>
                <Ionicons
                  name={isCurrentTrackPlaying ? 'volume-high' : 'pause'}
                  size={10}
                  color={theme.accent}
                />
                <Text style={styles.liveDotText}>
                  {isCurrentTrackPlaying ? 'Çalıyor' : 'Duraklatıldı'}
                </Text>
              </View>
            )}
            <Text
              style={[styles.subtitleText, isDarkMode && styles.textSecondaryDark]}
              numberOfLines={1}
            >
              {subtitleText}
            </Text>
          </View>
        </View>

        {/* Sağ: Kompakt Aksiyon İkonları */}
        <View style={styles.actionsCol}>
          {isAudio ? (
            <TouchableOpacity
              style={[
                styles.primaryCircleBtn,
                { backgroundColor: isCurrentTrackPlaying ? theme.accent : theme.accent },
              ]}
              onPress={() => handlePlaySong(item)}
            >
              <Ionicons
                name={isCurrentTrackPlaying ? 'pause' : 'play'}
                size={15}
                color={theme.onAccent}
                style={!isCurrentTrackPlaying ? { marginLeft: 1 } : undefined}
              />
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={[styles.primaryCircleBtn, { backgroundColor: theme.accent }]}
              onPress={() => handlePlayVideo(item)}
              disabled={isVideoLoading}
            >
              {isVideoLoading ? (
                <ActivityIndicator size="small" color={theme.onAccent} />
              ) : (
                <Ionicons
                  name="play"
                  size={15}
                  color={theme.onAccent}
                  style={{ marginLeft: 1 }}
                />
              )}
            </TouchableOpacity>
          )}

          <TouchableOpacity
            style={styles.iconCircleBtn}
            hitSlop={5}
            accessibilityRole="button"
            accessibilityLabel={`${item.title || item.filename} için işlemler`}
            onPress={() => setMenuItem(item)}
          >
            <Ionicons name="ellipsis-vertical" size={20} color={theme.text} />
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={[styles.container, isDarkMode && styles.containerDark]}>
      <FlatList
        data={filteredAndSortedItems}
        keyExtractor={(item) => item.id || item.filename}
        renderItem={renderItem}
        contentContainerStyle={styles.listContent}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
        refreshing={loading}
        onRefresh={loadHistoryAndPlaylists}
        ListHeaderComponent={<>
      {/* Kompakt Üst Başlık */}
      <View style={styles.header}>
        <View style={styles.headerLeftRow}>
          <View>
            <Text style={[styles.headerTitle, isDarkMode && styles.textPrimaryDark]}>
              Arşiv
            </Text>
            <Text
              style={[styles.headerSubtitle, isDarkMode && styles.textSecondaryDark]}
            >
              {items.length} parça · {totalDownloadedSizeLabel}

            </Text>
          </View>
        </View>

        <View style={styles.headerRightActions}>
          {items.length > 0 && (
            <TouchableOpacity
              style={[
                styles.sortToggleBtn,
                isDarkMode && styles.sortToggleBtnDark,
                showSortBar && styles.sortToggleBtnActive,
              ]}
              accessibilityLabel={`Sıralama: ${currentSortLabel}`}
              onPress={() => setShowSortBar((prev) => !prev)}
            >
              <Ionicons
                name="swap-vertical-outline"
                size={14}
                color={
                  showSortBar
                    ? theme.onAccent
                    : isDarkMode
                    ? theme.accent
                    : theme.accent
                }
              />

            </TouchableOpacity>
          )}

          {audioItems.length > 0 && (
            <TouchableOpacity
              style={styles.playAllCompactBtn}
              onPress={handlePlayAllSongs}
            >
              <Ionicons name="headset-outline" size={14} color={theme.onAccent} />
              <Text style={styles.playAllCompactText}>Çal</Text>
            </TouchableOpacity>
          )}


        </View>
      </View>

      {/* Arşiv İçi Hızlı Arama Kutusu */}
      {items.length > 0 && (
        <View
          style={[
            styles.inlineSearchBox,
            isDarkMode && styles.inlineSearchBoxDark,
          ]}
        >
          <Ionicons name="search-outline" size={16} color={theme.muted} />
          <TextInput
            style={[
              styles.inlineSearchInput,
              isDarkMode && styles.textPrimaryDark,
            ]}
            placeholder="Arşivde ara"
            placeholderTextColor={theme.muted}
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery('')}>
              <Ionicons name="close-circle" size={17} color={theme.muted} />
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* Sıralama Seçenekleri Çubuğu */}
      {showSortBar && items.length > 0 && (
        <View style={styles.sortSectionBox}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.sortScrollContent}
          >
            {SORT_OPTIONS.map((opt) => {
              const active = sortBy === opt.id;
              return (
                <TouchableOpacity
                  key={opt.id}
                  style={[
                    styles.sortOptionChip,
                    isDarkMode && styles.sortOptionChipDark,
                    active && styles.sortOptionChipActive,
                  ]}
                  onPress={() => setSortBy(opt.id)}
                >
                  <Ionicons
                    name={opt.icon}
                    size={13}
                    color={
                      active
                        ? theme.onAccent
                        : isDarkMode
                        ? theme.muted
                        : theme.muted
                    }
                  />
                  <Text
                    style={[
                      styles.sortOptionText,
                      isDarkMode && styles.textSecondaryDark,
                      active && styles.sortOptionTextActive,
                    ]}
                  >
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      )}

      {/* Tür Filtresi: Tümü | Şarkılar | Videolar */}
      {items.length > 0 && (
        <View style={styles.filterRow}>
          <TouchableOpacity
            style={[
              styles.filterChip,
              isDarkMode && styles.filterChipDark,
              filterType === 'all' &&
                selectedPlaylistId === 'ALL' &&
                styles.filterChipActive,
            ]}
            onPress={() => {
              setFilterType('all');
              setSelectedPlaylistId('ALL');
            }}
          >
            <Text
              style={[
                styles.filterChipText,
                isDarkMode && styles.textSecondaryDark,
                filterType === 'all' &&
                  selectedPlaylistId === 'ALL' &&
                  styles.filterChipTextActive,
              ]}
            >
              Tümü ({items.length})
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.filterChip,
              isDarkMode && styles.filterChipDark,
              filterType === 'audio' && styles.filterChipActiveAudio,
            ]}
            onPress={() => setFilterType('audio')}
          >
            <Ionicons
              name="disc-outline"
              size={13}
              color={
                filterType === 'audio'
                  ? theme.onAccent
                  : isDarkMode
                  ? theme.accent
                  : theme.accent
              }
            />
            <Text
              style={[
                styles.filterChipText,
                isDarkMode && styles.textSecondaryDark,
                filterType === 'audio' && styles.filterChipTextActive,
              ]}
            >
              Ses ({audioItems.length})
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.filterChip,
              isDarkMode && styles.filterChipDark,
              filterType === 'video' && styles.filterChipActive,
            ]}
            onPress={() => {
              setFilterType('video');
              setSelectedPlaylistId('ALL');
            }}
          >
            <Ionicons
              name="videocam-outline"
              size={13}
              color={
                filterType === 'video'
                  ? theme.onAccent
                  : isDarkMode
                  ? theme.accent
                  : theme.accent
              }
            />
            <Text
              style={[
                styles.filterChipText,
                isDarkMode && styles.textSecondaryDark,
                filterType === 'video' && styles.filterChipTextActive,
              ]}
            >
              Video ({videoItems.length})
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {items.length > 0 && (
        <View style={styles.libraryTools}>
          {filterType !== 'video' && <TouchableOpacity hitSlop={4} style={styles.libraryTool} onPress={() => setShowLists((value) => !value)}>
            <Ionicons name="list-outline" size={14} color={theme.accent} />
            <Text style={styles.libraryToolText} numberOfLines={1}>{activePlaylistObj?.name || 'Listeler'} ({playlists.length})</Text>
            <Ionicons name={showLists ? 'chevron-up' : 'chevron-down'} size={12} color={theme.muted} />
          </TouchableOpacity>}
          <TouchableOpacity hitSlop={4} style={styles.libraryTool} onPress={() => setShowArtists((value) => !value)}>
            <Text style={styles.libraryToolText} numberOfLines={1}>{selectedArtist === 'ALL' ? 'Sanatçılar' : selectedArtist}</Text>
            <Ionicons name={showArtists ? 'chevron-up' : 'chevron-down'} size={12} color={theme.muted} />
          </TouchableOpacity>
        </View>
      )}
      {/* Şarkılar Bölümü: Özel Çalma Listeleri (Playlist) Çubuğu */}
      {showLists && filterType !== 'video' && audioItems.length > 0 && (
        <View style={styles.playlistSectionWrapper}>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.playlistScrollContent}
          >
            {/* + Yeni liste Oluştur Butonu */}
            <TouchableOpacity
              style={[
                styles.newPlaylistBtn,
                isDarkMode && styles.newPlaylistBtnDark,
              ]}
              onPress={() => openCreatePlaylistModal(null)}
            >
              <Ionicons name="add-circle" size={14} color={theme.accent} />
              <Text
                style={[
                  styles.newPlaylistBtnText,
                  isDarkMode && { color: theme.accent },
                ]}
              >
                Yeni liste
              </Text>
            </TouchableOpacity>

            {/* Tümü Seçeneği */}
            {playlists.length > 0 && (
              <TouchableOpacity
                style={[
                  styles.playlistChip,
                  isDarkMode && styles.playlistChipDark,
                  selectedPlaylistId === 'ALL' && styles.playlistChipActive,
                ]}
                onPress={() => setSelectedPlaylistId('ALL')}
              >
                <Ionicons
                  name="musical-notes-outline"
                  size={12}
                  color={
                    selectedPlaylistId === 'ALL'
                      ? theme.onAccent
                      : isDarkMode
                      ? theme.muted
                      : theme.muted
                  }
                />
                <Text
                  style={[
                    styles.playlistChipText,
                    isDarkMode && styles.textSecondaryDark,
                    selectedPlaylistId === 'ALL' &&
                      styles.playlistChipTextActive,
                  ]}
                >
                  Tümü
                </Text>
              </TouchableOpacity>
            )}

            {/* Kullanıcının Oluşturduğu Çalma Listeleri */}
            {playlists.map((pl) => {
              const isSelected = selectedPlaylistId === pl.id;
              const validCount = audioItems.filter((a) =>
                (pl.trackFilenames || []).includes(a.filename)
              ).length;

              return (
                <TouchableOpacity
                  key={pl.id}
                  style={[
                    styles.playlistChip,
                    isDarkMode && styles.playlistChipDark,
                    isSelected && styles.playlistChipActive,
                  ]}
                  onPress={() => {
                    setFilterType('audio');
                    setSelectedPlaylistId(isSelected ? 'ALL' : pl.id);
                  }}
                >
                  {items.find((track) => (pl.trackFilenames || []).includes(track.filename) && track.thumbnail)?.thumbnail ? (
                    <Image source={{ uri: items.find((track) => (pl.trackFilenames || []).includes(track.filename) && track.thumbnail).thumbnail }} style={styles.playlistCover} />
                  ) : (
                    <View style={styles.playlistCover}><Ionicons name="musical-notes-outline" size={24} color={theme.accent} /></View>
                  )}
                  <Text
                    style={[
                      styles.playlistChipText,
                      isDarkMode && styles.textSecondaryDark,
                      isSelected && styles.playlistChipTextActive,
                    ]}
                    numberOfLines={1}
                  >
                    {pl.name} ({validCount})
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          {/* Seçili Playlist Yönetim Çubuğu (Çal | Şarkı Ekle/Çıkar | Sil) */}
          {activePlaylistObj && (
            <View
              style={[
                styles.activePlaylistBanner,
                isDarkMode && styles.activePlaylistBannerDark,
              ]}
            >
              <View style={styles.activePlaylistInfo}>
                <Ionicons name="musical-notes" size={15} color={theme.accent} />
                <Text
                  style={[
                    styles.activePlaylistTitle,
                    isDarkMode && styles.textPrimaryDark,
                  ]}
                  numberOfLines={1}
                >
                  {activePlaylistObj.name} ({activeAudioPlaylist.length} şarkı)
                </Text>
              </View>

              <View style={styles.activePlaylistActions}>
                <TouchableOpacity
                  style={styles.plActionPlayBtn}
                  onPress={handlePlayAllSongs}
                >
                  <Ionicons name="play" size={12} color={theme.onAccent} />
                  <Text style={styles.plActionPlayText}>Çal</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.plActionEditBtn,
                    isDarkMode && styles.plActionEditBtnDark,
                  ]}
                  onPress={() => openEditPlaylistTracksModal(activePlaylistObj)}
                >
                  <Ionicons
                    name="create-outline"
                    size={14}
                    color={theme.accent}
                  />
                  <Text
                    style={[
                      styles.plActionEditText,
                      isDarkMode && { color: theme.accent },
                    ]}
                  >
                    Düzenle
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.plActionDeleteBtn}
                  onPress={() => handleDeletePlaylist(activePlaylistObj)}
                >
                  <Ionicons name="trash-outline" size={14} color={theme.danger} />
                </TouchableOpacity>
              </View>
            </View>
          )}
        </View>
      )}

      {/* Sanatçı / Kanal Filtresi */}
      {showArtists && artistList.length > 0 && (
        <View style={styles.artistFilterWrapper}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.artistScrollContent}
          >
            <TouchableOpacity
              style={[
                styles.artistChip,
                isDarkMode && styles.artistChipDark,
                selectedArtist === 'ALL' && styles.artistChipActive,
              ]}
              onPress={() => setSelectedArtist('ALL')}
            >
              <Ionicons
                name="people-outline"
                size={12}
                color={
                  selectedArtist === 'ALL'
                    ? theme.onAccent
                    : isDarkMode
                    ? theme.muted
                    : theme.muted
                }
              />
              <Text
                style={[
                  styles.artistChipText,
                  isDarkMode && styles.textSecondaryDark,
                  selectedArtist === 'ALL' && styles.artistChipTextActive,
                ]}
              >
                Tümü
              </Text>
            </TouchableOpacity>

            {artistList.map((art) => {
              const isSelected = selectedArtist === art.name;
              return (
                <TouchableOpacity
                  key={art.name}
                  style={[
                    styles.artistChip,
                    isDarkMode && styles.artistChipDark,
                    isSelected && styles.artistChipActive,
                  ]}
                  onPress={() =>
                    setSelectedArtist(isSelected ? 'ALL' : art.name)
                  }
                >
                  <Text
                    style={[
                      styles.artistChipText,
                      isDarkMode && styles.textSecondaryDark,
                      isSelected && styles.artistChipTextActive,
                    ]}
                    numberOfLines={1}
                  >
                    {art.name} ({art.count})
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      )}

        </>}
        ListEmptyComponent={
<View style={styles.emptyContainer}>
          <Ionicons
            name={
              activePlaylistObj
                ? 'list-outline'
                : filterType === 'audio'
                ? 'musical-notes-outline'
                : 'cloud-download-outline'
            }
            size={46}
            color={isDarkMode ? theme.text : theme.muted}
          />
          <Text style={[styles.emptyTitle, isDarkMode && styles.textPrimaryDark]}>
            {activePlaylistObj
              ? `'${activePlaylistObj.name}' listesinde henüz şarkı yok`
              : searchQuery || selectedArtist !== 'ALL'
              ? 'Filtreyle eşleşen medya bulunamadı'
              : filterType === 'audio'
              ? 'Henüz indirilmiş şarkı (M4A) yok'
              : filterType === 'video'
              ? 'Henüz indirilmiş video (MP4) yok'
              : 'Henüz indirdiğin bir şey yok.'}
          </Text>
          <Text
            style={[styles.emptyText, isDarkMode && styles.textSecondaryDark]}
          >
            {activePlaylistObj
              ? 'İndirdiğiniz şarkılardan istediklerinizi bu çalma listesine ekleyebilirsiniz.'
              : searchQuery || selectedArtist !== 'ALL'
              ? 'Farklı bir sanatçı seçebilir veya filtreyi temizleyebilirsiniz.'
              : "YouTube'dan indirdiğiniz şarkı ve videolar kapak resimleriyle birlikte burada listelenir."}
          </Text>
          {activePlaylistObj ? (
            <TouchableOpacity
              style={styles.goToDownloadBtn}
              onPress={() => openEditPlaylistTracksModal(activePlaylistObj)}
            >
              <Ionicons name="add" size={18} color={theme.onAccent} />
              <Text style={styles.goToDownloadText}>
                İndirilen Şarkılardan Ekle
              </Text>
            </TouchableOpacity>
          ) : searchQuery || selectedArtist !== 'ALL' ? (
            <TouchableOpacity
              style={styles.goToDownloadBtn}
              onPress={() => {
                setSearchQuery('');
                setSelectedArtist('ALL');
              }}
            >
              <Ionicons name="refresh-outline" size={16} color={theme.onAccent} />
              <Text style={styles.goToDownloadText}>Filtreleri Temizle</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={styles.goToDownloadBtn}
              onPress={onSwitchToDownloader}
            >
              <Ionicons name="add" size={18} color={theme.onAccent} />
              <Text style={styles.goToDownloadText}>İndir</Text>
            </TouchableOpacity>
          )}
        </View>}
      />

      <Modal visible={Boolean(menuItem)} transparent animationType="fade" onRequestClose={() => setMenuItem(null)}>
        <View style={styles.actionBackdrop}>
          <TouchableOpacity style={StyleSheet.absoluteFill} accessibilityLabel="Menüyü kapat" onPress={() => setMenuItem(null)} />
          <View style={[styles.actionSheet, { paddingBottom: Math.max(insets.bottom, 12) + 12 }]}>
            <Text style={styles.sectionTitle} numberOfLines={2}>{menuItem?.title || menuItem?.filename}</Text>
            {[
              ...(menuItem && isItemAudio(menuItem) ? [
                { label: 'Listeye ekle', icon: /** @type {const} */ ('list-outline'), run: openQuickAddSongModal },
                { label: 'Sesi kes', icon: /** @type {const} */ ('cut-outline'), run: openTrimmerModal },
              ] : []),
              { label: 'Paylaş', icon: /** @type {const} */ ('share-outline'), run: handleShare },
              { label: 'Cihazdan sil', icon: /** @type {const} */ ('trash-outline'), run: handleDelete, danger: true },
            ].map((action) => (
              <TouchableOpacity key={action.label} style={styles.actionRow} accessibilityRole="button" onPress={() => {
                const selected = menuItem;
                setMenuItem(null);
                if (selected) action.run(selected);
              }}>
                <Ionicons name={action.icon} size={22} color={action.danger ? theme.danger : theme.text} />
                <Text style={{ color: action.danger ? theme.danger : theme.text, fontSize: 16 }}>{action.label}</Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity style={styles.actionRow} onPress={() => setMenuItem(null)}><Text style={{ color: theme.muted }}>Vazgeç</Text></TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* PLAYLIST OLUŞTURMA / DÜZENLEME / HIZLI EKLEME MODALI */}
      <Modal
        visible={playlistModalVisible}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setPlaylistModalVisible(false)}
      >
        <View style={styles.modalBackdrop}>
          <View
            style={[
              styles.playlistModalCard,
              isDarkMode && styles.playlistModalCardDark,
            ]}
          >
            <View style={styles.modalHeaderRow}>
              <Text
                style={[
                  styles.modalHeaderTitle,
                  isDarkMode && styles.textPrimaryDark,
                ]}
              >
                {playlistModalMode === 'create'
                  ? 'Yeni Çalma Listesi Oluştur'
                  : playlistModalMode === 'edit'
                  ? `'${newPlaylistName}' Listesini Düzenle`
                  : 'Çalma Listesine Ekle'}
              </Text>
              <TouchableOpacity
                style={styles.modalCloseBtn}
                onPress={() => setPlaylistModalVisible(false)}
              >
                <Ionicons
                  name="close"
                  size={20}
                  color={theme.muted}
                />
              </TouchableOpacity>
            </View>

            {/* MOD 1 & 2: YENİ PLAYLIST OLUŞTUR VEYA MEVCUT LİSTEYİ / ADINI DÜZENLE */}
            {(playlistModalMode === 'create' || playlistModalMode === 'edit') && (
              <>
                <View style={styles.modalInputGroup}>
                  <Text
                    style={[
                      styles.modalInputLabel,
                      isDarkMode && styles.textSecondaryDark,
                    ]}
                  >
                    Çalma Listesi Adı
                  </Text>
                  <TextInput
                    style={[
                      styles.modalTextInput,
                      isDarkMode && styles.modalTextInputDark,
                    ]}
                    placeholder="Örn: Arabada, Spor, Favorilerim..."
                    placeholderTextColor={theme.muted}
                    value={newPlaylistName}
                    onChangeText={setNewPlaylistName}
                    autoFocus={playlistModalMode === 'create'}
                  />
                </View>

                <Text
                  style={[
                    styles.modalSectionSubtitle,
                    isDarkMode && styles.textSecondaryDark,
                  ]}
                >
                  Listeye Eklemek İstediğiniz İndirilen Şarkıları Seçin (
                  {draftSelectedFilenames.length} seçili)
                </Text>

                <ScrollView
                  style={styles.songSelectScroll}
                  showsVerticalScrollIndicator={false}
                >
                  {audioItems.map((song) => {
                    const isChecked = draftSelectedFilenames.includes(
                      song.filename
                    );
                    return (
                      <TouchableOpacity
                        key={song.id || song.filename}
                        style={[
                          styles.songSelectRow,
                          isDarkMode && styles.songSelectRowDark,
                          isChecked &&
                            (isDarkMode
                              ? styles.songSelectRowActiveDark
                              : styles.songSelectRowActive),
                        ]}
                        onPress={() => {
                          if (playlistModalMode === 'edit' && editingPlaylistId) {
                            handleToggleSongInExistingPlaylist(
                              editingPlaylistId,
                              song.filename
                            );
                          } else {
                            toggleDraftSongSelection(song.filename);
                          }
                        }}
                      >
                        <Ionicons
                          name={isChecked ? 'checkbox' : 'square-outline'}
                          size={20}
                          color={
                            isChecked
                              ? theme.accent
                              : isDarkMode
                              ? theme.muted
                              : theme.muted
                          }
                        />
                        <View style={styles.songSelectTextCol}>
                          <Text
                            style={[
                              styles.songSelectTitle,
                              isDarkMode && styles.textPrimaryDark,
                            ]}
                            numberOfLines={1}
                          >
                            {song.title || song.filename}
                          </Text>
                          <Text
                            style={[
                              styles.songSelectSub,
                              isDarkMode && styles.textSecondaryDark,
                            ]}
                            numberOfLines={1}
                          >
                            {song.uploader || 'Media Toolkit'}
                          </Text>
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>

                <TouchableOpacity
                  style={styles.modalPrimarySaveBtn}
                  onPress={
                    playlistModalMode === 'create'
                      ? handleSaveCreatePlaylist
                      : handleSaveEditPlaylist
                  }
                >
                  <Ionicons
                    name="checkmark-circle-outline"
                    size={18}
                    color={theme.onAccent}
                  />
                  <Text style={styles.modalPrimarySaveText}>
                    {playlistModalMode === 'create'
                      ? 'Çalma Listesini Oluştur'
                      : 'Değişiklikleri Kaydet'}
                  </Text>
                </TouchableOpacity>
              </>
            )}

            {/* MOD 3: TEK ŞARKIYI HIZLICA BİR LİSTEYE EKLE / ÇIKAR */}
            {playlistModalMode === 'quickAdd' && quickAddTargetSong && (
              <>
                <Text
                  style={[
                    styles.quickAddSongName,
                    isDarkMode && styles.textSecondaryDark,
                  ]}
                  numberOfLines={1}
                >
                  Şarkı: {quickAddTargetSong.title || quickAddTargetSong.filename}
                </Text>

                {playlists.length === 0 ? (
                  <View style={styles.noPlaylistYetBox}>
                    <Text
                      style={[
                        styles.noPlaylistYetText,
                        isDarkMode && styles.textSecondaryDark,
                      ]}
                    >
                      Henüz oluşturulmuş bir çalma listeniz yok.
                    </Text>
                  </View>
                ) : (
                  <ScrollView
                    style={styles.songSelectScroll}
                    showsVerticalScrollIndicator={false}
                  >
                    {playlists.map((pl) => {
                      const inList = (pl.trackFilenames || []).includes(
                        quickAddTargetSong.filename
                      );
                      return (
                        <TouchableOpacity
                          key={pl.id}
                          style={[
                            styles.songSelectRow,
                            isDarkMode && styles.songSelectRowDark,
                            inList &&
                              (isDarkMode
                                ? styles.songSelectRowActiveDark
                                : styles.songSelectRowActive),
                          ]}
                          onPress={() =>
                            handleToggleSongInExistingPlaylist(
                              pl.id,
                              quickAddTargetSong.filename
                            )
                          }
                        >
                          <Ionicons
                            name={inList ? 'checkbox' : 'square-outline'}
                            size={20}
                            color={inList ? theme.accent : theme.muted}
                          />
                          <View style={styles.songSelectTextCol}>
                            <Text
                              style={[
                                styles.songSelectTitle,
                                isDarkMode && styles.textPrimaryDark,
                              ]}
                            >
                              {pl.name}
                            </Text>
                            <Text
                              style={[
                                styles.songSelectSub,
                                isDarkMode && styles.textSecondaryDark,
                              ]}
                            >
                              {(pl.trackFilenames || []).length} şarkı
                            </Text>
                          </View>
                        </TouchableOpacity>
                      );
                    })}
                  </ScrollView>
                )}

                <View style={styles.quickAddBottomRow}>
                  <TouchableOpacity
                    style={[
                      styles.quickCreateNewBtn,
                      isDarkMode && styles.quickCreateNewBtnDark,
                    ]}
                    onPress={() =>
                      openCreatePlaylistModal(quickAddTargetSong.filename)
                    }
                  >
                    <Ionicons name="add-circle-outline" size={16} color={theme.accent} />
                    <Text
                      style={[
                        styles.quickCreateNewText,
                        isDarkMode && { color: theme.accent },
                      ]}
                    >
                      Bu Şarkıyla Yeni Liste Oluştur
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.modalPrimarySaveBtn}
                    onPress={() => setPlaylistModalVisible(false)}
                  >
                    <Text style={styles.modalPrimarySaveText}>Tamam</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>

      {/* ZİL SESİ / BİLDİRİM SESİ KIRPICI (AUDIO TRIMMER) MODALI */}
      <Modal
        visible={trimModalVisible && Boolean(trimTargetSong)}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setTrimModalVisible(false)}
      >
        <View style={styles.modalBackdrop}>
          <View
            style={[
              styles.playlistModalCard,
              isDarkMode && styles.playlistModalCardDark,
            ]}
          >
            <View style={styles.modalHeaderRow}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, flex: 1 }}>
                <Ionicons name="cut" size={18} color={theme.accent} />
                <Text
                  style={[
                    styles.modalHeaderTitle,
                    isDarkMode && styles.textPrimaryDark,
                  ]}
                >
                  Sesi kes
                </Text>
              </View>
              <TouchableOpacity
                style={styles.modalCloseBtn}
                onPress={() => setTrimModalVisible(false)}
              >
                <Ionicons
                  name="close"
                  size={20}
                  color={theme.muted}
                />
              </TouchableOpacity>
            </View>

            {trimTargetSong && (
              <>
                <Text
                  style={[
                    styles.quickAddSongName,
                    isDarkMode && styles.textSecondaryDark,
                  ]}
                  numberOfLines={1}
                >
                  Seçili Şarkı: {trimTargetSong.title || trimTargetSong.filename}
                </Text>

                {/* Hızlı 30 Saniyelik Nakarat Başlangıç Seçicileri */}
                <Text
                  style={[
                    styles.modalSectionSubtitle,
                    isDarkMode && styles.textSecondaryDark,
                  ]}
                >
                  Hızlı 30 Saniyelik Kesit Aralığı Seç:
                </Text>
                <View style={styles.trimPresetRow}>
                  {[
                    { label: '0s - 30s', s: 0, d: 30 },
                    { label: '30s - 60s', s: 30, d: 30 },
                    { label: '60s - 90s', s: 60, d: 30 },
                    { label: '90s - 120s', s: 90, d: 30 },
                  ].map((pr) => {
                    const active =
                      Number(trimStartSec) === pr.s &&
                      Number(trimEndSec) === pr.s + pr.d;
                    return (
                      <TouchableOpacity
                        key={pr.label}
                        style={[
                          styles.trimPresetChip,
                          isDarkMode && styles.trimPresetChipDark,
                          active && styles.trimPresetChipActive,
                        ]}
                        onPress={() => handleApplyQuickTrimRange(pr.s, pr.d)}
                      >
                        <Text
                          style={[
                            styles.trimPresetChipText,
                            isDarkMode && styles.textSecondaryDark,
                            active && { color: theme.onAccent },
                          ]}
                        >
                          {pr.label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                {/* Özel Başlangıç ve Bitiş Saniyesi Girişi */}
                <View style={styles.trimInputsRow}>
                  <View style={{ flex: 1 }}>
                    <Text
                      style={[
                        styles.modalInputLabel,
                        isDarkMode && styles.textSecondaryDark,
                      ]}
                    >
                      Başlangıç (Saniye)
                    </Text>
                    <TextInput
                      style={[
                        styles.modalTextInput,
                        isDarkMode && styles.modalTextInputDark,
                      ]}
                      keyboardType="numeric"
                      value={trimStartSec}
                      onChangeText={setTrimStartSec}
                      placeholder="30"
                      placeholderTextColor={theme.muted}
                    />
                  </View>

                  <View style={{ flex: 1 }}>
                    <Text
                      style={[
                        styles.modalInputLabel,
                        isDarkMode && styles.textSecondaryDark,
                      ]}
                    >
                      Bitiş (Saniye)
                    </Text>
                    <TextInput
                      style={[
                        styles.modalTextInput,
                        isDarkMode && styles.modalTextInputDark,
                      ]}
                      keyboardType="numeric"
                      value={trimEndSec}
                      onChangeText={setTrimEndSec}
                      placeholder="60"
                      placeholderTextColor={theme.muted}
                    />
                  </View>
                </View>

                <View style={{ gap: 8, marginTop: 10 }}>
                  <TouchableOpacity
                    style={[
                      styles.modalPrimarySaveBtn,
                      { backgroundColor: theme.accent },
                      trimLoading && { opacity: 0.7 },
                    ]}
                    onPress={() => handleExecuteTrim(true)}
                    disabled={trimLoading}
                  >
                    {trimLoading ? (
                      <ActivityIndicator size="small" color={theme.onAccent} />
                    ) : (
                      <>
                        <Ionicons
                          name="notifications-outline"
                          size={17}
                          color={theme.onAccent}
                        />
                        <Text style={styles.modalPrimarySaveText}>
                          Kes ve Telefon Zil Sesi Yap
                        </Text>
                      </>
                    )}
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[
                      styles.modalPrimarySaveBtn,
                      trimLoading && { opacity: 0.7 },
                    ]}
                    onPress={() => handleExecuteTrim(false)}
                    disabled={trimLoading}
                  >
                    <Ionicons name="save-outline" size={17} color={theme.onAccent} />
                    <Text style={styles.modalPrimarySaveText}>
                      Kesiti kaydet
                    </Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const createStyles = (theme) => StyleSheet.create({
  libraryTools: { flexDirection: 'row', gap: 12, marginBottom: 6 },
  libraryTool: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 5, maxWidth: '55%' },
  libraryToolText: { color: theme.accent, fontSize: 12, flexShrink: 1 },
  sectionTitle: { fontSize: 18, fontWeight: '700', color: theme.text, marginBottom: 10 },
  playlistCover: { width: 28, height: 28, borderRadius: 10, backgroundColor: theme.accentSoft, alignItems: 'center', justifyContent: 'center' },
  actionBackdrop: { flex: 1, backgroundColor: theme.overlay, justifyContent: 'flex-end' },
  actionSheet: { backgroundColor: theme.raised, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 40 },
  actionRow: { flexDirection: 'row', alignItems: 'center', gap: 16, minHeight: 52 },
  container: {
    flex: 1,
    backgroundColor: theme.background,
    paddingHorizontal: 14,
    paddingTop: 4,
  },
  containerDark: {
    backgroundColor: theme.background,
  },
  textPrimaryDark: {
    color: theme.text,
  },
  textSecondaryDark: {
    color: theme.muted,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
    flexWrap: 'nowrap',
    gap: 6,
  },
  headerLeftRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  backIconBtn: {
    width: 34,
    height: 34,
    borderRadius: 12,
    backgroundColor: theme.surface,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: theme.border,
    shadowColor: theme.surface,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0,
    shadowRadius: 4,
    elevation: 0,
  },
  backIconBtnDark: {
    backgroundColor: theme.surface,
    borderColor: theme.border,
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: theme.text,
  },
  headerSubtitle: {
    fontSize: 11,
    color: theme.muted,
  },
  headerRightActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
  },
  iconActionBtn: {
    width: 34,
    height: 34,
    borderRadius: 12,
    backgroundColor: theme.surface,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: theme.border,
  },
  iconActionBtnDark: {
    backgroundColor: theme.surface,
    borderColor: theme.border,
  },
  iconActionBtnActive: {
    backgroundColor: theme.accent,
    borderColor: theme.accent,
  },
  sortToggleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.border,
    paddingHorizontal: 8,
    height: 30,
    borderRadius: 8,
  },
  sortToggleBtnDark: {
    backgroundColor: theme.surface,
    borderColor: theme.border,
  },
  sortToggleBtnActive: {
    backgroundColor: theme.accent,
    borderColor: theme.accent,
  },
  sortToggleText: {
    color: theme.accent,
    fontSize: 13,
    fontWeight: '700',
  },
  playAllCompactBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: theme.accent,
    paddingHorizontal: 8,
    height: 30,
    borderRadius: 8,
    shadowColor: theme.accent,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0,
    shadowRadius: 5,
    elevation: 0,
  },
  playAllCompactText: {
    color: theme.onAccent,
    fontSize: 12,
    fontWeight: '700',
  },
  refreshBtn: {
    width: 34,
    height: 34,
    borderRadius: 12,
    backgroundColor: theme.surface,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: theme.border,
  },
  inlineSearchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme.border,
    paddingHorizontal: 10,
    height: 36,
    marginBottom: 8,
    gap: 6,
  },
  inlineSearchBoxDark: {
    backgroundColor: theme.surface,
    borderColor: theme.border,
  },
  inlineSearchInput: {
    flex: 1,
    fontSize: 12,
    color: theme.text,
    paddingVertical: 0,
  },
  sortSectionBox: {
    marginBottom: 8,
  },
  sortScrollContent: {
    gap: 6,
    paddingVertical: 2,
  },
  sortOptionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.border,
  },
  sortOptionChipDark: {
    backgroundColor: theme.surface,
    borderColor: theme.border,
  },
  sortOptionChipActive: {
    backgroundColor: theme.accent,
    borderColor: theme.accent,
  },
  sortOptionText: {
    fontSize: 13,
    fontWeight: '700',
    color: theme.muted,
  },
  sortOptionTextActive: {
    color: theme.onAccent,
  },
  filterRow: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 8,
  },
  filterChip: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    paddingVertical: 5,
    borderRadius: 8,
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.border,
  },
  filterChipDark: {
    backgroundColor: theme.surface,
    borderColor: theme.border,
  },
  filterChipActive: {
    backgroundColor: theme.accent,
    borderColor: theme.accent,
  },
  filterChipActiveAudio: {
    backgroundColor: theme.accent,
    borderColor: theme.accent,
  },
  filterChipText: {
    fontSize: 11,
    fontWeight: '700',
    color: theme.muted,
  },
  filterChipTextActive: {
    color: theme.onAccent,
  },
  // Playlist (Çalma Listeleri) Stilleri
  playlistSectionWrapper: {
    marginBottom: 6,
  },
  playlistScrollContent: {
    gap: 6,
    paddingVertical: 2,
  },
  newPlaylistBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
    backgroundColor: theme.accentSoft,
    borderWidth: 1,
    borderColor: theme.border,
  },
  newPlaylistBtnDark: {
    backgroundColor: theme.accentSoft,
    borderColor: theme.border,
  },
  newPlaylistBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: theme.accent,
  },
  playlistChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.border,
    minHeight: 38,
  },
  playlistChipDark: {
    backgroundColor: theme.surface,
    borderColor: theme.border,
  },
  playlistChipActive: {
    backgroundColor: theme.accentSoft,
    borderColor: theme.accent,
  },
  playlistChipText: {
    fontSize: 13,
    fontWeight: '600',
    color: theme.muted,
    maxWidth: 140,
  },
  playlistChipTextActive: {
    color: theme.accent,
    fontWeight: '700',
  },
  activePlaylistBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: theme.accentSoft,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 5,
    marginTop: 6,
    flexWrap: 'wrap',
    gap: 6,
  },
  activePlaylistBannerDark: {
    backgroundColor: theme.accentSoft,
    borderColor: theme.border,
  },
  activePlaylistInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flex: 1,
  },
  activePlaylistTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: theme.accent,
    flex: 1,
  },
  activePlaylistActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  plActionPlayBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: theme.accent,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 7,
  },
  plActionPlayText: {
    color: theme.onAccent,
    fontSize: 13,
    fontWeight: '700',
  },
  plActionEditBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.border,
    paddingHorizontal: 8,
    paddingVertical: 4.5,
    borderRadius: 7,
  },
  plActionEditBtnDark: {
    backgroundColor: theme.surface,
    borderColor: theme.border,
  },
  plActionEditText: {
    color: theme.accent,
    fontSize: 13,
    fontWeight: '700',
  },
  plActionDeleteBtn: {
    padding: 4,
  },
  artistFilterWrapper: {
    marginBottom: 8,
  },
  artistScrollContent: {
    gap: 6,
    paddingVertical: 1,
  },
  artistChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.border,
  },
  artistChipDark: {
    backgroundColor: theme.surface,
    borderColor: theme.border,
  },
  artistChipActive: {
    backgroundColor: theme.accent,
    borderColor: theme.accent,
  },
  artistChipText: {
    fontSize: 13,
    fontWeight: '600',
    color: theme.muted,
    maxWidth: 150,
  },
  artistChipTextActive: {
    color: theme.onAccent,
    fontWeight: '700',
  },
  listContent: {
    paddingBottom: 12,
    gap: 0,
    flexGrow: 1,
  },
  compactCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.background,
    borderRadius: 0,
    paddingVertical: 7,
    paddingHorizontal: 0,
    borderWidth: 0,
    borderColor: theme.border,
    gap: 8,
    shadowColor: theme.surface,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0,
    shadowRadius: 8,
    elevation: 0,
    borderBottomWidth: 1,
  },
  compactCardDark: {
    backgroundColor: theme.background,
    borderColor: theme.border,
  },
  compactCardPlaying: {
    borderColor: theme.accent,
    backgroundColor: theme.accentSoft,
  },
  compactCardPlayingDark: {
    borderColor: theme.accent,
    backgroundColor: theme.accentSoft,
  },
  thumbWrapper: {
    position: 'relative',
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  vinylThumbOuter: {
    width: 42,
    height: 42,
    borderRadius: 10,
    backgroundColor: theme.surface,
    padding: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 0,
    borderColor: theme.border,
  },
  vinylThumbActiveBorder: {
    borderColor: theme.accent,
  },
  vinylThumbImage: {
    width: '100%',
    height: '100%',
    borderRadius: 10,
  },
  vinylFallback: {
    width: '100%',
    height: '100%',
    borderRadius: 16,
    backgroundColor: theme.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  vinylCenterHole: {
    position: 'absolute',
    width: 9,
    height: 9,
    borderRadius: 4.5,
    backgroundColor: theme.surface,
    borderWidth: 1.5,
    borderColor: theme.border,
    display: 'none',
  },
  videoThumbBox: {
    width: 44,
    height: 36,
    borderRadius: 7,
    overflow: 'hidden',
    backgroundColor: theme.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  videoThumbImage: {
    width: '100%',
    height: '100%',
  },
  videoFallback: {
    width: '100%',
    height: '100%',
    backgroundColor: theme.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  videoPlayOverlay: {
    position: 'absolute',
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: theme.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  miniTypeBadge: {
    position: 'absolute',
    bottom: -1,
    right: -2,
    paddingHorizontal: 3.5,
    paddingVertical: 1,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: theme.border,
  },
  miniTypeBadgeText: {
    color: theme.onAccent,
    fontSize: 8,
    fontWeight: '800',
  },
  infoCol: {
    flex: 1,
    justifyContent: 'center',
  },
  titleText: {
    fontSize: 14,
    fontWeight: '700',
    color: theme.text,
    marginBottom: 2,
  },
  titleTextPlaying: {
    color: theme.accent,
  },
  titleTextPlayingDark: {
    color: theme.accent,
  },
  subRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  liveDotBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: theme.accentSoft,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 4,
  },
  liveDotText: {
    color: theme.accent,
    fontSize: 9,
    fontWeight: '700',
  },
  subtitleText: {
    fontSize: 11,
    color: theme.muted,
    flex: 1,
  },
  actionsCol: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  primaryCircleBtn: {
    width: 32,
    height: 32,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: theme.accent,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0,
    shadowRadius: 4,
    elevation: 0,
  },
  iconCircleBtn: {
    width: 32,
    height: 32,
    borderRadius: 9,
    backgroundColor: theme.surface,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: theme.border,
  },
  iconCircleBtnDark: {
    backgroundColor: theme.surface,
    borderColor: theme.border,
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingVertical: 24,
  },
  emptyTitle: {
    fontSize: 15.5,
    fontWeight: '700',
    color: theme.text,
    marginTop: 12,
    textAlign: 'center',
  },
  emptyText: {
    fontSize: 13,
    color: theme.muted,
    textAlign: 'center',
    marginTop: 5,
    lineHeight: 17,
    marginBottom: 16,
  },
  goToDownloadBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: theme.accent,
    paddingHorizontal: 15,
    paddingVertical: 9,
    borderRadius: 10,
  },
  goToDownloadText: {
    color: theme.onAccent,
    fontSize: 13,
    fontWeight: '700',
  },
  // Playlist Modal Stilleri
  modalBackdrop: {
    flex: 1,
    backgroundColor: theme.overlay,
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  playlistModalCard: {
    backgroundColor: theme.surface,
    borderRadius: 16,
    padding: 16,
    maxHeight: '82%',
    borderWidth: 1,
    borderColor: theme.border,
  },
  playlistModalCardDark: {
    backgroundColor: theme.surface,
    borderColor: theme.border,
  },
  modalHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  modalHeaderTitle: {
    fontSize: 15.5,
    fontWeight: '800',
    color: theme.text,
    flex: 1,
  },
  modalCloseBtn: {
    padding: 4,
  },
  modalInputGroup: {
    marginBottom: 12,
  },
  modalInputLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: theme.muted,
    marginBottom: 6,
  },
  modalTextInput: {
    height: 42,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.surface,
    paddingHorizontal: 12,
    fontSize: 13.5,
    color: theme.text,
  },
  modalTextInputDark: {
    backgroundColor: theme.surface,
    borderColor: theme.border,
    color: theme.text,
  },
  modalSectionSubtitle: {
    fontSize: 13,
    fontWeight: '700',
    color: theme.muted,
    marginBottom: 8,
  },
  songSelectScroll: {
    maxHeight: 280,
    marginBottom: 12,
  },
  songSelectRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 9,
    paddingHorizontal: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.surface,
    marginBottom: 6,
  },
  songSelectRowDark: {
    backgroundColor: theme.surface,
    borderColor: theme.border,
  },
  songSelectRowActive: {
    borderColor: theme.accent,
    backgroundColor: theme.accentSoft,
  },
  songSelectRowActiveDark: {
    borderColor: theme.accent,
    backgroundColor: theme.accentSoft,
  },
  songSelectTextCol: {
    flex: 1,
  },
  songSelectTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: theme.text,
  },
  songSelectSub: {
    fontSize: 13,
    color: theme.muted,
    marginTop: 1,
  },
  modalPrimarySaveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: theme.accent,
    height: 42,
    borderRadius: 10,
  },
  modalPrimarySaveText: {
    color: theme.onAccent,
    fontSize: 13.5,
    fontWeight: '700',
  },
  quickAddSongName: {
    fontSize: 13,
    fontWeight: '600',
    color: theme.muted,
    marginBottom: 10,
  },
  noPlaylistYetBox: {
    paddingVertical: 20,
    alignItems: 'center',
  },
  noPlaylistYetText: {
    fontSize: 13,
    color: theme.muted,
  },
  quickAddBottomRow: {
    gap: 8,
  },
  quickCreateNewBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 38,
    borderRadius: 10,
    backgroundColor: theme.accentSoft,
    borderWidth: 1,
    borderColor: theme.border,
  },
  quickCreateNewBtnDark: {
    backgroundColor: theme.accentSoft,
    borderColor: theme.border,
  },
  quickCreateNewText: {
    color: theme.accent,
    fontSize: 13,
    fontWeight: '700',
  },
  trimPresetRow: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 12,
  },
  trimPresetChip: {
    flex: 1,
    paddingVertical: 7,
    borderRadius: 8,
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  trimPresetChipDark: {
    backgroundColor: theme.surface,
    borderColor: theme.border,
  },
  trimPresetChipActive: {
    backgroundColor: theme.accent,
    borderColor: theme.accent,
  },
  trimPresetChipText: {
    fontSize: 13,
    fontWeight: '700',
    color: theme.muted,
  },
  trimInputsRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 6,
  },
});

const lightStyles = createStyles(lightTheme);
const darkStyles = createStyles(darkTheme);
