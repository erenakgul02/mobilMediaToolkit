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
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  getLocalHistory,
  deleteLocalHistoryItem,
  downloadFileToDevice,
  playAudioPlaylist,
  togglePlayPauseAudio,
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

export default function HistoryTab({ onSwitchToDownloader, playerState }) {
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

  const handleOpenOrShare = async (item, actionType = 'open') => {
    const key = `${item.filename}_${actionType}`;
    setActionLoading(key);
    try {
      await downloadFileToDevice(item.download_url, item.filename, actionType);
    } catch (e) {
      Alert.alert('Hata', 'Dosya işlemi başarısız: ' + e.message);
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

    const isOpenLoading = actionLoading === `${item.filename}_open`;
    const isShareLoading = actionLoading === `${item.filename}_share`;

    const isCurrentTrack =
      isAudio &&
      playerState?.isActive &&
      ((item.id && playerState.id === item.id) ||
        (item.filename && playerState.filename === item.filename));
    const isCurrentTrackPlaying = isCurrentTrack && playerState?.isPlaying;

    return (
      <View
        style={[
          styles.historyCard,
          isCurrentTrack && styles.historyCardPlaying,
        ]}
      >
        <View style={styles.cardHeader}>
          <View style={styles.badgeRow}>
            <View
              style={[
                styles.typeBadge,
                { backgroundColor: isAudio ? '#4F46E5' : '#0284C7' },
              ]}
            >
              <Ionicons
                name={isAudio ? 'musical-notes' : 'videocam'}
                size={12}
                color="#FFFFFF"
              />
              <Text style={styles.typeBadgeText}>{badgeLabel}</Text>
            </View>

            {isCurrentTrack && (
              <View style={styles.nowPlayingBadge}>
                <Ionicons
                  name={isCurrentTrackPlaying ? 'volume-high' : 'pause'}
                  size={12}
                  color="#4F46E5"
                />
                <Text style={styles.nowPlayingBadgeText}>
                  {isCurrentTrackPlaying ? 'Şu An Çalıyor' : 'Duraklatıldı'}
                </Text>
              </View>
            )}
          </View>

          <Text style={styles.dateText}>{item.date || 'Bugün'}</Text>
        </View>

        <TouchableOpacity
          activeOpacity={isAudio ? 0.7 : 1}
          onPress={() => {
            if (isAudio) handlePlaySong(item);
          }}
        >
          <Text style={styles.titleText} numberOfLines={2}>
            {item.title || item.filename}
          </Text>
        </TouchableOpacity>

        <View style={styles.metaRow}>
          {item.uploader ? (
            <Text style={styles.uploaderText} numberOfLines={1}>
              {item.uploader}
            </Text>
          ) : null}
          {item.filesize ? (
            <Text style={styles.sizeText}>{item.filesize}</Text>
          ) : null}
          {item.quality ? (
            <Text style={styles.qualityText}>
              {item.quality === 'high' ? 'Yüksek (AAC)' : item.quality}
            </Text>
          ) : null}
        </View>

        {/* Aksiyon butonları */}
        <View style={styles.actionsRow}>
          {isAudio ? (
            <TouchableOpacity
              style={[
                styles.playAudioBtn,
                isCurrentTrackPlaying && styles.playAudioBtnActive,
              ]}
              onPress={() => handlePlaySong(item)}
            >
              <Ionicons
                name={isCurrentTrackPlaying ? 'pause-circle' : 'play-circle'}
                size={19}
                color="#FFFFFF"
              />
              <Text style={styles.playAudioBtnText}>
                {isCurrentTrack
                  ? isCurrentTrackPlaying
                    ? 'Duraklat'
                    : 'Devam Et'
                  : 'Arka Planda Dinle'}
              </Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={styles.downloadBtn}
              onPress={() => handleOpenOrShare(item, 'open')}
              disabled={isOpenLoading}
            >
              {isOpenLoading ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <>
                  <Ionicons name="play-outline" size={17} color="#FFFFFF" />
                  <Text style={styles.downloadBtnText}>Videoyu Aç</Text>
                </>
              )}
            </TouchableOpacity>
          )}

          {/* Paylaş Butonu */}
          <TouchableOpacity
            style={styles.secondaryActionBtn}
            onPress={() => handleOpenOrShare(item, 'share')}
            disabled={isShareLoading}
          >
            {isShareLoading ? (
              <ActivityIndicator size="small" color="#2563EB" />
            ) : (
              <>
                <Ionicons name="share-social-outline" size={16} color="#2563EB" />
                <Text style={styles.secondaryActionText}>Paylaş</Text>
              </>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.deleteBtn}
            onPress={() => handleDelete(item.filename)}
          >
            <Ionicons name="trash-outline" size={16} color="#EF4444" />
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeftCol}>
          <TouchableOpacity
            style={styles.backBtn}
            onPress={onSwitchToDownloader}
          >
            <Ionicons name="arrow-back" size={16} color="#2563EB" />
            <Text style={styles.backBtnText}>İndiriciye Dön</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>İndirilenler & Müzik Çalar</Text>
          <Text style={styles.headerSubtitle}>
            {audioItems.length} şarkı • {videoItems.length} video hazır
          </Text>
        </View>

        <TouchableOpacity
          style={styles.refreshBtn}
          onPress={loadHistory}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator size="small" color="#2563EB" />
          ) : (
            <Ionicons name="refresh" size={18} color="#2563EB" />
          )}
        </TouchableOpacity>
      </View>

      {/* Filtre Sekmeleri: Tümü | Şarkılar | Videolar */}
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
              name="musical-notes"
              size={14}
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
              size={14}
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

      {/* Tüm Şarkıları Arka Planda Çal Butonu */}
      {audioItems.length > 0 && filterType !== 'video' && (
        <TouchableOpacity
          style={styles.playAllBanner}
          onPress={handlePlayAllSongs}
        >
          <View style={styles.playAllLeft}>
            <View style={styles.playAllIconBox}>
              <Ionicons name="headset" size={18} color="#FFFFFF" />
            </View>
            <View>
              <Text style={styles.playAllTitle}>
                Tüm Şarkıları Arka Planda Çal ({audioItems.length})
              </Text>
              <Text style={styles.playAllSub}>
                Ekran kapansa bile çalmaya devam eder • Bildirimden kontrol
              </Text>
            </View>
          </View>
          <Ionicons name="play" size={18} color="#4F46E5" />
        </TouchableOpacity>
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
            size={56}
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
            YouTube'dan bir link yapıştırıp M4A (Ses) olarak indirdiğinizde burada arka planda kesintisiz dinleyebilirsiniz.
          </Text>
          <TouchableOpacity
            style={styles.goToDownloadBtn}
            onPress={onSwitchToDownloader}
          >
            <Ionicons name="add" size={18} color="#FFFFFF" />
            <Text style={styles.goToDownloadText}>Yeni Şarkı / Video İndir</Text>
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
    paddingHorizontal: 16,
    paddingTop: 14,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  headerLeftCol: {
    flex: 1,
  },
  backBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 6,
    alignSelf: 'flex-start',
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  backBtnText: {
    color: '#2563EB',
    fontSize: 12,
    fontWeight: '700',
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#0F172A',
  },
  headerSubtitle: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 2,
  },
  refreshBtn: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  filterRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  filterChip: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  filterChipActive: {
    backgroundColor: '#2563EB',
    borderColor: '#2563EB',
  },
  filterChipActiveAudio: {
    backgroundColor: '#4F46E5',
    borderColor: '#4F46E5',
  },
  filterChipText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#475569',
  },
  filterChipTextActive: {
    color: '#FFFFFF',
  },
  playAllBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#EEF2FF',
    borderWidth: 1,
    borderColor: '#C7D2FE',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    marginBottom: 12,
  },
  playAllLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  playAllIconBox: {
    width: 34,
    height: 34,
    borderRadius: 9,
    backgroundColor: '#4F46E5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  playAllTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#312E81',
  },
  playAllSub: {
    fontSize: 11,
    color: '#4338CA',
    marginTop: 1,
  },
  listContent: {
    paddingBottom: 24,
    gap: 12,
  },
  historyCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 2,
  },
  historyCardPlaying: {
    borderColor: '#6366F1',
    borderWidth: 1.5,
    backgroundColor: '#F5F3FF',
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  typeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  typeBadgeText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '800',
  },
  nowPlayingBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#E0E7FF',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  nowPlayingBadgeText: {
    color: '#4338CA',
    fontSize: 11,
    fontWeight: '700',
  },
  dateText: {
    fontSize: 11,
    color: '#94A3B8',
  },
  titleText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
    lineHeight: 19,
    marginBottom: 6,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 12,
  },
  uploaderText: {
    fontSize: 12,
    color: '#475569',
    fontWeight: '600',
    maxWidth: 160,
  },
  sizeText: {
    fontSize: 12,
    color: '#2563EB',
    fontWeight: '600',
  },
  qualityText: {
    fontSize: 12,
    color: '#64748B',
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  playAudioBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#4F46E5',
    height: 38,
    borderRadius: 9,
    shadowColor: '#4F46E5',
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 2,
  },
  playAudioBtnActive: {
    backgroundColor: '#4338CA',
  },
  playAudioBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  downloadBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#0284C7',
    height: 38,
    borderRadius: 9,
    shadowColor: '#0284C7',
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 2,
  },
  downloadBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  secondaryActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingHorizontal: 12,
    height: 38,
    borderRadius: 9,
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
  },
  secondaryActionText: {
    color: '#2563EB',
    fontSize: 12,
    fontWeight: '700',
  },
  deleteBtn: {
    width: 38,
    height: 38,
    borderRadius: 9,
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
    fontSize: 17,
    fontWeight: '700',
    color: '#0F172A',
    marginTop: 16,
    textAlign: 'center',
  },
  emptyText: {
    fontSize: 13,
    color: '#64748B',
    textAlign: 'center',
    marginTop: 6,
    lineHeight: 18,
    marginBottom: 20,
  },
  goToDownloadBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#2563EB',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
    shadowColor: '#2563EB',
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 3,
  },
  goToDownloadText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
});
