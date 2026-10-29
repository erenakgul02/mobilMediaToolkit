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
} from '../services/api';

export default function HistoryTab({ onSwitchToDownloader }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(null);

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

  const handleDownload = async (item) => {
    setActionLoading(item.filename);
    try {
      await downloadFileToDevice(item.download_url, item.filename);
      if (Platform.OS !== 'web') {
        Alert.alert('Başarılı', `${item.filename} cihazınıza kaydedildi / paylaşıldı.`);
      }
    } catch (e) {
      Alert.alert('Hata', 'Dosya indirilemedi: ' + e.message);
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
        `'${filename}' dosyasını silmek istediğinize emin misiniz?`,
        [
          { text: 'İptal', style: 'cancel' },
          { text: 'Sil', style: 'destructive', onPress: doDelete },
        ]
      );
    }
  };

  const renderItem = ({ item }) => {
    const isMp3 = item.type === 'mp3' || item.filename.endsWith('.mp3');
    const isCurrentAction = actionLoading === item.filename;

    return (
      <View style={styles.historyCard}>
        <View style={styles.cardHeader}>
          <View
            style={[
              styles.typeBadge,
              { backgroundColor: isMp3 ? '#4F46E5' : '#0284C7' },
            ]}
          >
            <Ionicons
              name={isMp3 ? 'musical-notes' : 'videocam'}
              size={12}
              color="#FFFFFF"
            />
            <Text style={styles.typeBadgeText}>{isMp3 ? 'MP3' : 'MP4'}</Text>
          </View>

          <Text style={styles.dateText}>{item.date || 'Bugün'}</Text>
        </View>

        <Text style={styles.titleText} numberOfLines={2}>
          {item.title || item.filename}
        </Text>

        <View style={styles.metaRow}>
          <Text style={styles.sizeText}>{item.filesize || 'Bilinmiyor'}</Text>
          {item.quality && (
            <Text style={styles.qualityText}>
              Kalite: {item.quality} {isMp3 ? 'kbps' : 'p'}
            </Text>
          )}
        </View>

        {/* Aksiyon butonları */}
        <View style={styles.actionsRow}>
          <TouchableOpacity
            style={styles.downloadBtn}
            onPress={() => handleDownload(item)}
            disabled={isCurrentAction}
          >
            {isCurrentAction ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <>
                <Ionicons name="cloud-download-outline" size={16} color="#FFFFFF" />
                <Text style={styles.downloadBtnText}>Telefona İndir</Text>
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
          <Text style={styles.headerTitle}>İndirilenler & Geçmiş</Text>
          <Text style={styles.headerSubtitle}>
            {items.length} adet medya dosyası hazır
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

      {/* Hızlı Yeni İndirme Butonu */}
      {items.length > 0 && (
        <TouchableOpacity
          style={styles.newDownloadPill}
          onPress={onSwitchToDownloader}
        >
          <Ionicons name="add-circle" size={18} color="#2563EB" />
          <Text style={styles.newDownloadPillText}>+ Yeni Video / MP3 İndir</Text>
        </TouchableOpacity>
      )}

      {/* Liste veya Boş Durum */}
      {items.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Ionicons name="cloud-download-outline" size={56} color="#CBD5E1" />
          <Text style={styles.emptyTitle}>Henüz indirme yok</Text>
          <Text style={styles.emptyText}>
            YouTube'dan bir link yapıştırıp MP3 veya MP4 olarak indirdiğinizde burada listelenecektir.
          </Text>
          <TouchableOpacity
            style={styles.goToDownloadBtn}
            onPress={onSwitchToDownloader}
          >
            <Ionicons name="add" size={18} color="#FFFFFF" />
            <Text style={styles.goToDownloadText}>İlk Videoyu İndir</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={items}
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
    padding: 16,
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
    marginBottom: 8,
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
  newDownloadPill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
    paddingVertical: 10,
    borderRadius: 10,
    marginBottom: 14,
  },
  newDownloadPillText: {
    color: '#2563EB',
    fontSize: 13,
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
  listContent: {
    paddingBottom: 30,
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
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
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
  dateText: {
    fontSize: 11,
    color: '#94A3B8',
  },
  titleText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
    lineHeight: 18,
    marginBottom: 8,
  },
  metaRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 12,
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
  downloadBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#2563EB',
    height: 38,
    borderRadius: 8,
    shadowColor: '#2563EB',
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 2,
  },
  downloadBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
  },
  deleteBtn: {
    width: 38,
    height: 38,
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
    fontSize: 17,
    fontWeight: '700',
    color: '#0F172A',
    marginTop: 16,
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
