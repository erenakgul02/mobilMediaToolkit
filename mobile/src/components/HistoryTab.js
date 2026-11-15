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

const SORT_OPTIONS = [
  { id: 'date_desc', label: 'En Yeni', icon: 'time-outline' },
  { id: 'date_asc', label: 'En Eski', icon: 'hourglass-outline' },
  { id: 'title_asc', label: 'İsim (A-Z)', icon: 'text-outline' },
  { id: 'title_desc', label: 'İsim (Z-A)', icon: 'text-outline' },
  { id: 'artist_asc', label: 'Sanatçı (A-Z)', icon: 'person-outline' },
  { id: 'size_desc', label: 'Boyut', icon: 'analytics-outline' },
];

export default function HistoryTab({
  isDarkMode,
  onSwitchToDownloader,
  playerState,
  onOpenExpandedPlayer,
}) {
  const [items, setItems] = useState([]);
  const [playlists, setPlaylists] = useState([]);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(null);

  // Filtre ve Sıralama State'leri
  const [filterType, setFilterType] = useState('all'); // 'all' | 'audio' | 'video'
  const [selectedArtist, setSelectedArtist] = useState('ALL');
  const [selectedPlaylistId, setSelectedPlaylistId] = useState('ALL');
  const [sortBy, setSortBy] = useState('date_desc');
  const [showSortBar, setShowSortBar] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Playlist Oluşturma & Şarkı Seçme Modal State'leri
  const [playlistModalVisible, setPlaylistModalVisible] = useState(false);
  const [playlistModalMode, setPlaylistModalMode] = useState('create'); // 'create' | 'edit' | 'quickAdd'
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [draftSelectedFilenames, setDraftSelectedFilenames] = useState([]);
  const [editingPlaylistId, setEditingPlaylistId] = useState(null);
  const [quickAddTargetSong, setQuickAddTargetSong] = useState(null);

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
    loadHistoryAndPlaylists();
  }, []);

  const audioItems = useMemo(() => items.filter(isItemAudio), [items]);
  const videoItems = useMemo(() => items.filter((i) => !isItemAudio(i)), [items]);

  const activePlaylistObj = useMemo(
    () => playlists.find((p) => p.id === selectedPlaylistId) || null,
    [playlists, selectedPlaylistId]
  );

  // Benzersiz sanatçı / kanal listesini çıkar
  const artistList = useMemo(() => {
    const counts = {};
    items.forEach((item) => {
      const artist = (item.uploader || '').trim();
      if (artist && artist !== 'YouTube' && artist !== 'MediaToolkit') {
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
    const isShareLoading = actionLoading === `${item.filename}_share`;

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
                  <Ionicons name="musical-notes" size={16} color="#FFFFFF" />
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
                  <Ionicons name="videocam" size={18} color="#FFFFFF" />
                </View>
              )}
              <View style={styles.videoPlayOverlay}>
                <Ionicons name="play" size={12} color="#FFFFFF" />
              </View>
            </View>
          )}

          {/* Küçük Format Rozeti */}
          <View
            style={[
              styles.miniTypeBadge,
              { backgroundColor: isAudio ? '#4F46E5' : '#0284C7' },
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
                  color="#4F46E5"
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
                { backgroundColor: isCurrentTrackPlaying ? '#4338CA' : '#4F46E5' },
              ]}
              onPress={() => handlePlaySong(item)}
            >
              <Ionicons
                name={isCurrentTrackPlaying ? 'pause' : 'play'}
                size={15}
                color="#FFFFFF"
                style={!isCurrentTrackPlaying ? { marginLeft: 1 } : undefined}
              />
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={[styles.primaryCircleBtn, { backgroundColor: '#0284C7' }]}
              onPress={() => handlePlayVideo(item)}
              disabled={isVideoLoading}
            >
              {isVideoLoading ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Ionicons
                  name="play"
                  size={15}
                  color="#FFFFFF"
                  style={{ marginLeft: 1 }}
                />
              )}
            </TouchableOpacity>
          )}

          {/* Şarkıyı Çalma Listesine Ekle Butonu */}
          {isAudio && (
            <TouchableOpacity
              style={[styles.iconCircleBtn, isDarkMode && styles.iconCircleBtnDark]}
              onPress={() => openQuickAddSongModal(item)}
            >
              <Ionicons
                name="list-outline"
                size={15}
                color={isDarkMode ? '#A5B4FC' : '#4F46E5'}
              />
            </TouchableOpacity>
          )}

          <TouchableOpacity
            style={[styles.iconCircleBtn, isDarkMode && styles.iconCircleBtnDark]}
            onPress={() => handleShare(item)}
            disabled={isShareLoading}
          >
            {isShareLoading ? (
              <ActivityIndicator size="small" color="#2563EB" />
            ) : (
              <Ionicons
                name="share-social-outline"
                size={15}
                color={isDarkMode ? '#60A5FA' : '#2563EB'}
              />
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.iconCircleBtn, isDarkMode && styles.iconCircleBtnDark]}
            onPress={() => handleDelete(item)}
          >
            <Ionicons name="trash-outline" size={15} color="#EF4444" />
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={[styles.container, isDarkMode && styles.containerDark]}>
      {/* Kompakt Üst Başlık */}
      <View style={styles.header}>
        <View style={styles.headerLeftRow}>
          <TouchableOpacity
            style={[styles.backIconBtn, isDarkMode && styles.backIconBtnDark]}
            onPress={onSwitchToDownloader}
          >
            <Ionicons
              name="arrow-back"
              size={17}
              color={isDarkMode ? '#60A5FA' : '#2563EB'}
            />
          </TouchableOpacity>
          <View>
            <Text style={[styles.headerTitle, isDarkMode && styles.textPrimaryDark]}>
              İndirilenler
            </Text>
            <Text
              style={[styles.headerSubtitle, isDarkMode && styles.textSecondaryDark]}
            >
              {audioItems.length} şarkı • {videoItems.length} video
              {playlists.length > 0 ? ` • ${playlists.length} playlist` : ''}
            </Text>
          </View>
        </View>

        <View style={styles.headerRightActions}>
          {items.length > 0 && (
            <TouchableOpacity
              style={[
                styles.iconActionBtn,
                isDarkMode && styles.iconActionBtnDark,
                showSearch && styles.iconActionBtnActive,
              ]}
              onPress={() => {
                setShowSearch((prev) => !prev);
                if (showSearch) setSearchQuery('');
              }}
            >
              <Ionicons
                name="search-outline"
                size={16}
                color={
                  showSearch
                    ? '#FFFFFF'
                    : isDarkMode
                    ? '#CBD5E1'
                    : '#475569'
                }
              />
            </TouchableOpacity>
          )}

          {items.length > 0 && (
            <TouchableOpacity
              style={[
                styles.sortToggleBtn,
                isDarkMode && styles.sortToggleBtnDark,
                showSortBar && styles.sortToggleBtnActive,
              ]}
              onPress={() => setShowSortBar((prev) => !prev)}
            >
              <Ionicons
                name="swap-vertical-outline"
                size={14}
                color={
                  showSortBar
                    ? '#FFFFFF'
                    : isDarkMode
                    ? '#60A5FA'
                    : '#2563EB'
                }
              />
              <Text
                style={[
                  styles.sortToggleText,
                  isDarkMode && { color: '#60A5FA' },
                  showSortBar && { color: '#FFFFFF' },
                ]}
              >
                {currentSortLabel}
              </Text>
            </TouchableOpacity>
          )}

          {audioItems.length > 0 && (
            <TouchableOpacity
              style={styles.playAllCompactBtn}
              onPress={handlePlayAllSongs}
            >
              <Ionicons name="headset-outline" size={14} color="#FFFFFF" />
              <Text style={styles.playAllCompactText}>Çal</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity
            style={[styles.refreshBtn, isDarkMode && styles.iconActionBtnDark]}
            onPress={loadHistoryAndPlaylists}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator size="small" color="#2563EB" />
            ) : (
              <Ionicons
                name="refresh"
                size={16}
                color={isDarkMode ? '#60A5FA' : '#2563EB'}
              />
            )}
          </TouchableOpacity>
        </View>
      </View>

      {/* İndirilenler İçi Hızlı Arama Kutusu */}
      {showSearch && items.length > 0 && (
        <View
          style={[
            styles.inlineSearchBox,
            isDarkMode && styles.inlineSearchBoxDark,
          ]}
        >
          <Ionicons name="search-outline" size={16} color="#64748B" />
          <TextInput
            style={[
              styles.inlineSearchInput,
              isDarkMode && styles.textPrimaryDark,
            ]}
            placeholder="Şarkı, video veya sanatçı adına göre filtrele..."
            placeholderTextColor="#94A3B8"
            value={searchQuery}
            onChangeText={setSearchQuery}
            autoFocus={true}
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery('')}>
              <Ionicons name="close-circle" size={17} color="#94A3B8" />
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
                        ? '#FFFFFF'
                        : isDarkMode
                        ? '#CBD5E1'
                        : '#475569'
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
                  ? '#FFFFFF'
                  : isDarkMode
                  ? '#A5B4FC'
                  : '#4F46E5'
              }
            />
            <Text
              style={[
                styles.filterChipText,
                isDarkMode && styles.textSecondaryDark,
                filterType === 'audio' && styles.filterChipTextActive,
              ]}
            >
              Şarkılar ({audioItems.length})
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
                  ? '#FFFFFF'
                  : isDarkMode
                  ? '#38BDF8'
                  : '#0284C7'
              }
            />
            <Text
              style={[
                styles.filterChipText,
                isDarkMode && styles.textSecondaryDark,
                filterType === 'video' && styles.filterChipTextActive,
              ]}
            >
              Videolar ({videoItems.length})
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Şarkılar Bölümü: Özel Çalma Listeleri (Playlist) Çubuğu */}
      {filterType !== 'video' && audioItems.length > 0 && (
        <View style={styles.playlistSectionWrapper}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.playlistScrollContent}
          >
            {/* + Yeni Playlist Oluştur Butonu */}
            <TouchableOpacity
              style={[
                styles.newPlaylistBtn,
                isDarkMode && styles.newPlaylistBtnDark,
              ]}
              onPress={() => openCreatePlaylistModal(null)}
            >
              <Ionicons name="add-circle" size={14} color="#4F46E5" />
              <Text
                style={[
                  styles.newPlaylistBtnText,
                  isDarkMode && { color: '#A5B4FC' },
                ]}
              >
                Yeni Playlist
              </Text>
            </TouchableOpacity>

            {/* Tüm Şarkılar Seçeneği */}
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
                      ? '#FFFFFF'
                      : isDarkMode
                      ? '#CBD5E1'
                      : '#475569'
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
                  Tüm Şarkılar
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
                  <Ionicons
                    name="list"
                    size={12}
                    color={
                      isSelected
                        ? '#FFFFFF'
                        : isDarkMode
                        ? '#A5B4FC'
                        : '#4F46E5'
                    }
                  />
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

          {/* Seçili Playlist Yönetim Çubuğu (Listeyi Çal | Şarkı Ekle/Çıkar | Sil) */}
          {activePlaylistObj && (
            <View
              style={[
                styles.activePlaylistBanner,
                isDarkMode && styles.activePlaylistBannerDark,
              ]}
            >
              <View style={styles.activePlaylistInfo}>
                <Ionicons name="musical-notes" size={15} color="#4F46E5" />
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
                  <Ionicons name="play" size={12} color="#FFFFFF" />
                  <Text style={styles.plActionPlayText}>Listeyi Çal</Text>
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
                    color={isDarkMode ? '#A5B4FC' : '#4F46E5'}
                  />
                  <Text
                    style={[
                      styles.plActionEditText,
                      isDarkMode && { color: '#A5B4FC' },
                    ]}
                  >
                    Adı / Şarkıları Düzenle
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.plActionDeleteBtn}
                  onPress={() => handleDeletePlaylist(activePlaylistObj)}
                >
                  <Ionicons name="trash-outline" size={14} color="#EF4444" />
                </TouchableOpacity>
              </View>
            </View>
          )}
        </View>
      )}

      {/* Sanatçı / Kanal Filtresi */}
      {artistList.length > 0 && (
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
                    ? '#FFFFFF'
                    : isDarkMode
                    ? '#CBD5E1'
                    : '#475569'
                }
              />
              <Text
                style={[
                  styles.artistChipText,
                  isDarkMode && styles.textSecondaryDark,
                  selectedArtist === 'ALL' && styles.artistChipTextActive,
                ]}
              >
                Tüm Sanatçılar
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

      {/* Liste veya Boş Durum */}
      {filteredAndSortedItems.length === 0 ? (
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
            color={isDarkMode ? '#334155' : '#CBD5E1'}
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
              : 'Henüz indirme yok'}
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
              <Ionicons name="add" size={18} color="#FFFFFF" />
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
              <Ionicons name="refresh-outline" size={16} color="#FFFFFF" />
              <Text style={styles.goToDownloadText}>Filtreleri Temizle</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={styles.goToDownloadBtn}
              onPress={onSwitchToDownloader}
            >
              <Ionicons name="add" size={18} color="#FFFFFF" />
              <Text style={styles.goToDownloadText}>Yeni Medya İndir</Text>
            </TouchableOpacity>
          )}
        </View>
      ) : (
        <FlatList
          data={filteredAndSortedItems}
          keyExtractor={(i) => i.id || i.filename}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
        />
      )}

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
                  color={isDarkMode ? '#CBD5E1' : '#475569'}
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
                    placeholderTextColor="#94A3B8"
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
                              ? '#4F46E5'
                              : isDarkMode
                              ? '#64748B'
                              : '#94A3B8'
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
                            {song.uploader || 'MediaToolkit'}
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
                    color="#FFFFFF"
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
                            color={inList ? '#4F46E5' : '#94A3B8'}
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
                    <Ionicons name="add-circle-outline" size={16} color="#4F46E5" />
                    <Text
                      style={[
                        styles.quickCreateNewText,
                        isDarkMode && { color: '#A5B4FC' },
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
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC',
    paddingHorizontal: 14,
    paddingTop: 8,
  },
  containerDark: {
    backgroundColor: '#0B0F19',
  },
  textPrimaryDark: {
    color: '#F8FAFC',
  },
  textSecondaryDark: {
    color: '#94A3B8',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  headerLeftRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  backIconBtn: {
    width: 32,
    height: 32,
    borderRadius: 9,
    backgroundColor: '#EFF6FF',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#BFDBFE',
  },
  backIconBtnDark: {
    backgroundColor: '#1E293B',
    borderColor: '#334155',
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0F172A',
  },
  headerSubtitle: {
    fontSize: 10.5,
    color: '#64748B',
  },
  headerRightActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  iconActionBtn: {
    width: 32,
    height: 32,
    borderRadius: 9,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  iconActionBtnDark: {
    backgroundColor: '#111827',
    borderColor: '#1E293B',
  },
  iconActionBtnActive: {
    backgroundColor: '#2563EB',
    borderColor: '#2563EB',
  },
  sortToggleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
    paddingHorizontal: 9,
    height: 32,
    borderRadius: 9,
  },
  sortToggleBtnDark: {
    backgroundColor: '#1E293B',
    borderColor: '#334155',
  },
  sortToggleBtnActive: {
    backgroundColor: '#2563EB',
    borderColor: '#2563EB',
  },
  sortToggleText: {
    color: '#2563EB',
    fontSize: 11,
    fontWeight: '700',
  },
  playAllCompactBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#4F46E5',
    paddingHorizontal: 10,
    height: 32,
    borderRadius: 9,
  },
  playAllCompactText: {
    color: '#FFFFFF',
    fontSize: 11.5,
    fontWeight: '700',
  },
  refreshBtn: {
    width: 32,
    height: 32,
    borderRadius: 9,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  inlineSearchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    paddingHorizontal: 10,
    height: 36,
    marginBottom: 8,
    gap: 6,
  },
  inlineSearchBoxDark: {
    backgroundColor: '#111827',
    borderColor: '#334155',
  },
  inlineSearchInput: {
    flex: 1,
    fontSize: 12.5,
    color: '#0F172A',
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
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  sortOptionChipDark: {
    backgroundColor: '#111827',
    borderColor: '#1E293B',
  },
  sortOptionChipActive: {
    backgroundColor: '#2563EB',
    borderColor: '#2563EB',
  },
  sortOptionText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#475569',
  },
  sortOptionTextActive: {
    color: '#FFFFFF',
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
    gap: 4,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  filterChipDark: {
    backgroundColor: '#111827',
    borderColor: '#1E293B',
  },
  filterChipActive: {
    backgroundColor: '#0284C7',
    borderColor: '#0284C7',
  },
  filterChipActiveAudio: {
    backgroundColor: '#4F46E5',
    borderColor: '#4F46E5',
  },
  filterChipText: {
    fontSize: 11.5,
    fontWeight: '700',
    color: '#475569',
  },
  filterChipTextActive: {
    color: '#FFFFFF',
  },
  // Playlist (Çalma Listeleri) Stilleri
  playlistSectionWrapper: {
    marginBottom: 8,
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
    backgroundColor: '#EEF2FF',
    borderWidth: 1,
    borderColor: '#C7D2FE',
  },
  newPlaylistBtnDark: {
    backgroundColor: '#1E1B4B',
    borderColor: '#3730A3',
  },
  newPlaylistBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#4F46E5',
  },
  playlistChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  playlistChipDark: {
    backgroundColor: '#111827',
    borderColor: '#1E293B',
  },
  playlistChipActive: {
    backgroundColor: '#4F46E5',
    borderColor: '#4F46E5',
  },
  playlistChipText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#475569',
    maxWidth: 140,
  },
  playlistChipTextActive: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  activePlaylistBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#EEF2FF',
    borderWidth: 1,
    borderColor: '#C7D2FE',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 7,
    marginTop: 6,
  },
  activePlaylistBannerDark: {
    backgroundColor: '#1E1B4B',
    borderColor: '#3730A3',
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
    color: '#1E1B4B',
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
    backgroundColor: '#4F46E5',
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 7,
  },
  plActionPlayText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
  },
  plActionEditBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#C7D2FE',
    paddingHorizontal: 8,
    paddingVertical: 4.5,
    borderRadius: 7,
  },
  plActionEditBtnDark: {
    backgroundColor: '#111827',
    borderColor: '#3730A3',
  },
  plActionEditText: {
    color: '#4F46E5',
    fontSize: 11,
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
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  artistChipDark: {
    backgroundColor: '#111827',
    borderColor: '#1E293B',
  },
  artistChipActive: {
    backgroundColor: '#0284C7',
    borderColor: '#0284C7',
  },
  artistChipText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#475569',
    maxWidth: 150,
  },
  artistChipTextActive: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  listContent: {
    paddingBottom: 16,
    gap: 7,
  },
  compactCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 11,
    paddingVertical: 7,
    paddingHorizontal: 9,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    gap: 10,
  },
  compactCardDark: {
    backgroundColor: '#111827',
    borderColor: '#1E293B',
  },
  compactCardPlaying: {
    borderColor: '#6366F1',
    backgroundColor: '#F5F3FF',
  },
  compactCardPlayingDark: {
    borderColor: '#6366F1',
    backgroundColor: '#1E1B4B',
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
    borderRadius: 21,
    backgroundColor: '#111827',
    padding: 3.5,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: '#374151',
  },
  vinylThumbActiveBorder: {
    borderColor: '#6366F1',
  },
  vinylThumbImage: {
    width: '100%',
    height: '100%',
    borderRadius: 18,
  },
  vinylFallback: {
    width: '100%',
    height: '100%',
    borderRadius: 18,
    backgroundColor: '#4F46E5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  vinylCenterHole: {
    position: 'absolute',
    width: 9,
    height: 9,
    borderRadius: 4.5,
    backgroundColor: '#111827',
    borderWidth: 1.5,
    borderColor: '#E5E7EB',
  },
  videoThumbBox: {
    width: 44,
    height: 36,
    borderRadius: 7,
    overflow: 'hidden',
    backgroundColor: '#0F172A',
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
    backgroundColor: '#0284C7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  videoPlayOverlay: {
    position: 'absolute',
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: 'rgba(0,0,0,0.55)',
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
    borderColor: '#FFFFFF',
  },
  miniTypeBadgeText: {
    color: '#FFFFFF',
    fontSize: 8,
    fontWeight: '800',
  },
  infoCol: {
    flex: 1,
    justifyContent: 'center',
  },
  titleText: {
    fontSize: 12.5,
    fontWeight: '700',
    color: '#0F172A',
    marginBottom: 2,
  },
  titleTextPlaying: {
    color: '#4338CA',
  },
  titleTextPlayingDark: {
    color: '#A5B4FC',
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
    backgroundColor: '#E0E7FF',
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 4,
  },
  liveDotText: {
    color: '#4338CA',
    fontSize: 9,
    fontWeight: '700',
  },
  subtitleText: {
    fontSize: 10.5,
    color: '#64748B',
    flex: 1,
  },
  actionsCol: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  primaryCircleBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconCircleBtn: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: '#F8FAFC',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  iconCircleBtnDark: {
    backgroundColor: '#1E293B',
    borderColor: '#334155',
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  emptyTitle: {
    fontSize: 15.5,
    fontWeight: '700',
    color: '#0F172A',
    marginTop: 12,
    textAlign: 'center',
  },
  emptyText: {
    fontSize: 12,
    color: '#64748B',
    textAlign: 'center',
    marginTop: 5,
    lineHeight: 17,
    marginBottom: 16,
  },
  goToDownloadBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#2563EB',
    paddingHorizontal: 15,
    paddingVertical: 9,
    borderRadius: 10,
  },
  goToDownloadText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  // Playlist Modal Stilleri
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(9, 13, 22, 0.78)',
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  playlistModalCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    maxHeight: '82%',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  playlistModalCardDark: {
    backgroundColor: '#111827',
    borderColor: '#1E293B',
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
    color: '#0F172A',
    flex: 1,
  },
  modalCloseBtn: {
    padding: 4,
  },
  modalInputGroup: {
    marginBottom: 12,
  },
  modalInputLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#475569',
    marginBottom: 6,
  },
  modalTextInput: {
    height: 42,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    backgroundColor: '#F8FAFC',
    paddingHorizontal: 12,
    fontSize: 13.5,
    color: '#0F172A',
  },
  modalTextInputDark: {
    backgroundColor: '#0B0F19',
    borderColor: '#334155',
    color: '#F8FAFC',
  },
  modalSectionSubtitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#475569',
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
    borderColor: '#E2E8F0',
    backgroundColor: '#F8FAFC',
    marginBottom: 6,
  },
  songSelectRowDark: {
    backgroundColor: '#0B0F19',
    borderColor: '#1E293B',
  },
  songSelectRowActive: {
    borderColor: '#6366F1',
    backgroundColor: '#EEF2FF',
  },
  songSelectRowActiveDark: {
    borderColor: '#6366F1',
    backgroundColor: '#1E1B4B',
  },
  songSelectTextCol: {
    flex: 1,
  },
  songSelectTitle: {
    fontSize: 12.5,
    fontWeight: '700',
    color: '#0F172A',
  },
  songSelectSub: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 1,
  },
  modalPrimarySaveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#4F46E5',
    height: 42,
    borderRadius: 10,
  },
  modalPrimarySaveText: {
    color: '#FFFFFF',
    fontSize: 13.5,
    fontWeight: '700',
  },
  quickAddSongName: {
    fontSize: 12,
    fontWeight: '600',
    color: '#475569',
    marginBottom: 10,
  },
  noPlaylistYetBox: {
    paddingVertical: 20,
    alignItems: 'center',
  },
  noPlaylistYetText: {
    fontSize: 12.5,
    color: '#64748B',
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
    backgroundColor: '#EEF2FF',
    borderWidth: 1,
    borderColor: '#C7D2FE',
  },
  quickCreateNewBtnDark: {
    backgroundColor: '#1E1B4B',
    borderColor: '#3730A3',
  },
  quickCreateNewText: {
    color: '#4F46E5',
    fontSize: 12.5,
    fontWeight: '700',
  },
});
