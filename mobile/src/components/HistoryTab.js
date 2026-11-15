import React, { useState, useEffect } from 'react';
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
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  getLocalHistory,
  deleteLocalHistoryItem,
  downloadFileToDevice,
  playAudioPlaylist,
  togglePlayPauseAudio,
  playVideoInApp,
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

export default function HistoryTab({
  onSwitchToDownloader,
  playerState,
  onOpenExpandedPlayer,
}) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(null);
  const [filterType, setFilterType] = useState('all'); // 'all' | 'audio' | 'video'

  const loadHistory = async () => {
    setLoading(true);
    try {
      const data = await getLocalHistory();
      setItems(data);
    } catch (e) {
      console.warn('Geçmiş alınamadı:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadHistory();
  }, []);

  const audioItems = items.filter(isItemAudio);
  const videoItems = items.filter((i) => !isItemAudio(i));

  const filteredItems =
    filterType === 'audio'
      ? audioItems
      : filterType === 'video'
      ? videoItems
      : items;

  const handlePlaySong = async (targetItem) => {
    if (audioItems.length === 0) return;

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
      audioItems.findIndex(
        (a) =>
          (targetItem.id && a.id === targetItem.id) ||
          a.filename === targetItem.filename
      )
    );

    try {
      await playAudioPlaylist(audioItems, startIndex);
    } catch (e) {
      Alert.alert('Oynatma Hatası', e.message || 'Şarkı başlatılamadı.');
    }
  };

  const handlePlayAllSongs = async () => {
    if (audioItems.length === 0) return;
    try {
      await playAudioPlaylist(audioItems, 0);
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

  const handleDelete = async (filename) => {
    const doDelete = async () => {
      try {
        await deleteLocalHistoryItem(filename);
        setItems((prev) => prev.filter((i) => i.filename !== filename));
      } catch (e) {
        Alert.alert('Hata', 'Silinemedi: ' + e.message);
      }
    };

    if (Platform.OS === 'web') {
      if (window.confirm(`'${filename}' dosyasını silmek istediğinize emin misiniz?`)) {
        doDelete();
      }
    } else {
      Alert.alert(
        'Dosyayı Sil',
        `'${filename}' dosyasını listeden silmek istediğinize emin misiniz?`,
        [
          { text: 'İptal', style: 'cancel' },
          { text: 'Sil', style: 'destructive', onPress: doDelete },
        ]
      );
    }
  };

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
          isCurrentTrack && styles.compactCardPlaying,
        ]}
      >
        {/* Sol: Kapak Görseli (Şarkılar için Plak Görünümü, Videolar için 16:9 Kapak) */}
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
                <Ionicons name="play" size={13} color="#FFFFFF" />
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
              isCurrentTrack && styles.titleTextPlaying,
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
            <Text style={styles.subtitleText} numberOfLines={1}>
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
                size={16}
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
                  size={16}
                  color="#FFFFFF"
                  style={{ marginLeft: 1 }}
                />
              )}
            </TouchableOpacity>
          )}

          <TouchableOpacity
            style={styles.iconCircleBtn}
            onPress={() => handleShare(item)}
            disabled={isShareLoading}
          >
            {isShareLoading ? (
              <ActivityIndicator size="small" color="#2563EB" />
            ) : (
              <Ionicons name="share-social-outline" size={15} color="#2563EB" />
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.iconCircleBtn}
            onPress={() => handleDelete(item.filename)}
          >
            <Ionicons name="trash-outline" size={15} color="#EF4444" />
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      {/* Kompakt Üst Başlık */}
      <View style={styles.header}>
        <View style={styles.headerLeftRow}>
          <TouchableOpacity
            style={styles.backIconBtn}
            onPress={onSwitchToDownloader}
          >
            <Ionicons name="arrow-back" size={18} color="#2563EB" />
          </TouchableOpacity>
          <View>
            <Text style={styles.headerTitle}>İndirilenler</Text>
            <Text style={styles.headerSubtitle}>
              {audioItems.length} şarkı • {videoItems.length} video
            </Text>
          </View>
        </View>

        <View style={styles.headerRightActions}>
          {audioItems.length > 0 && (
            <TouchableOpacity
              style={styles.playAllCompactBtn}
              onPress={handlePlayAllSongs}
            >
              <Ionicons name="headset" size={14} color="#FFFFFF" />
              <Text style={styles.playAllCompactText}>Tümünü Çal</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity
            style={styles.refreshBtn}
            onPress={loadHistory}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator size="small" color="#2563EB" />
            ) : (
              <Ionicons name="refresh" size={17} color="#2563EB" />
            )}
          </TouchableOpacity>
        </View>
      </View>

      {/* Kompakt Filtre Sekmeleri: Tümü | Şarkılar | Videolar */}
      {items.length > 0 && (
        <View style={styles.filterRow}>
          <TouchableOpacity
            style={[
              styles.filterChip,
              filterType === 'all' && styles.filterChipActive,
            ]}
            onPress={() => setFilterType('all')}
          >
            <Text
              style={[
                styles.filterChipText,
                filterType === 'all' && styles.filterChipTextActive,
              ]}
            >
              Tümü ({items.length})
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.filterChip,
              filterType === 'audio' && styles.filterChipActiveAudio,
            ]}
            onPress={() => setFilterType('audio')}
          >
            <Ionicons
              name="disc"
              size={13}
              color={filterType === 'audio' ? '#FFFFFF' : '#4F46E5'}
            />
            <Text
              style={[
                styles.filterChipText,
                filterType === 'audio' && styles.filterChipTextActive,
              ]}
            >
              Şarkılar ({audioItems.length})
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.filterChip,
              filterType === 'video' && styles.filterChipActive,
            ]}
            onPress={() => setFilterType('video')}
          >
            <Ionicons
              name="videocam"
              size={13}
              color={filterType === 'video' ? '#FFFFFF' : '#0284C7'}
            />
            <Text
              style={[
                styles.filterChipText,
                filterType === 'video' && styles.filterChipTextActive,
              ]}
            >
              Videolar ({videoItems.length})
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Liste veya Boş Durum */}
      {filteredItems.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Ionicons
            name={
              filterType === 'audio'
                ? 'musical-notes-outline'
                : 'cloud-download-outline'
            }
            size={48}
            color="#CBD5E1"
          />
          <Text style={styles.emptyTitle}>
            {filterType === 'audio'
              ? 'Henüz indirilmiş şarkı (M4A) yok'
              : filterType === 'video'
              ? 'Henüz indirilmiş video (MP4) yok'
              : 'Henüz indirme yok'}
          </Text>
          <Text style={styles.emptyText}>
            YouTube'dan indirdiğiniz şarkı ve videolar kapak resimleriyle birlikte burada listelenir.
          </Text>
          <TouchableOpacity
            style={styles.goToDownloadBtn}
            onPress={onSwitchToDownloader}
          >
            <Ionicons name="add" size={18} color="#FFFFFF" />
            <Text style={styles.goToDownloadText}>Yeni Medya İndir</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={filteredItems}
          keyExtractor={(i) => i.id || i.filename}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC',
    paddingHorizontal: 14,
    paddingTop: 10,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  headerLeftRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  backIconBtn: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: '#EFF6FF',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#BFDBFE',
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#0F172A',
  },
  headerSubtitle: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 1,
  },
  headerRightActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  playAllCompactBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#4F46E5',
    paddingHorizontal: 11,
    height: 34,
    borderRadius: 10,
  },
  playAllCompactText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  refreshBtn: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  filterRow: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 10,
  },
  filterChip: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 6,
    borderRadius: 9,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
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
  listContent: {
    paddingBottom: 20,
    gap: 8,
  },
  compactCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    gap: 10,
  },
  compactCardPlaying: {
    borderColor: '#6366F1',
    backgroundColor: '#F5F3FF',
  },
  thumbWrapper: {
    position: 'relative',
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  vinylThumbOuter: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: '#111827',
    padding: 4,
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
    borderRadius: 20,
  },
  vinylFallback: {
    width: '100%',
    height: '100%',
    borderRadius: 20,
    backgroundColor: '#4F46E5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  vinylCenterHole: {
    position: 'absolute',
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#111827',
    borderWidth: 2,
    borderColor: '#E5E7EB',
  },
  videoThumbBox: {
    width: 48,
    height: 40,
    borderRadius: 8,
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
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  miniTypeBadge: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#FFFFFF',
  },
  miniTypeBadgeText: {
    color: '#FFFFFF',
    fontSize: 8.5,
    fontWeight: '800',
  },
  infoCol: {
    flex: 1,
    justifyContent: 'center',
  },
  titleText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0F172A',
    marginBottom: 3,
  },
  titleTextPlaying: {
    color: '#4338CA',
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
    paddingVertical: 1.5,
    borderRadius: 4,
  },
  liveDotText: {
    color: '#4338CA',
    fontSize: 9.5,
    fontWeight: '700',
  },
  subtitleText: {
    fontSize: 11,
    color: '#64748B',
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
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconCircleBtn: {
    width: 30,
    height: 30,
    borderRadius: 8,
    backgroundColor: '#F8FAFC',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0F172A',
    marginTop: 14,
    textAlign: 'center',
  },
  emptyText: {
    fontSize: 12.5,
    color: '#64748B',
    textAlign: 'center',
    marginTop: 6,
    lineHeight: 18,
    marginBottom: 18,
  },
  goToDownloadBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#2563EB',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
  },
  goToDownloadText: {
    color: '#FFFFFF',
    fontSize: 13.5,
    fontWeight: '700',
  },
});
