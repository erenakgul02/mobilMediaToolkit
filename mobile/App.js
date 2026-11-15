import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  SafeAreaView,
  Image,
  Platform,
  NativeModules,
  DeviceEventEmitter,
  StatusBar as RNStatusBar,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';

import DownloaderTab from './src/components/DownloaderTab';
import HistoryTab from './src/components/HistoryTab';
import {
  getAudioPlayerState,
  togglePlayPauseAudio,
  nextAudioTrack,
  prevAudioTrack,
  stopAudioPlayer,
} from './src/services/api';

function formatMs(ms) {
  const totalSec = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  return `${mins < 10 ? '0' : ''}${mins}:${secs < 10 ? '0' : ''}${secs}`;
}

export default function App() {
  const [activeTab, setActiveTab] = useState('downloader');
  const [playerState, setPlayerState] = useState({
    isActive: false,
    isPlaying: false,
    currentIndex: 0,
    playlistCount: 0,
    positionMs: 0,
    durationMs: 0,
    id: '',
    title: '',
    uploader: '',
    filename: '',
  });

  useEffect(() => {
    // Uygulama açıldığında yerel motoru (NewPipeExtractor) hazırla
    if (NativeModules.YoutubeDLNative && NativeModules.YoutubeDLNative.initEngine) {
      NativeModules.YoutubeDLNative.initEngine().catch((err) => {
        console.warn('Native init uyarısı:', err);
      });
    }

    // Arka planda çalan aktif bir şarkı varsa durumunu senkronize et
    getAudioPlayerState()
      .then((st) => {
        if (st && typeof st.isActive === 'boolean') {
          setPlayerState(st);
        }
      })
      .catch(() => {});

    // Android Foreground Service'ten gelen gerçek zamanlı oynatıcı olaylarını dinle
    let sub = null;
    if (Platform.OS === 'android') {
      sub = DeviceEventEmitter.addListener('onMusicPlayerStateChanged', (event) => {
        if (event) {
          setPlayerState(event);
        }
      });
    }

    return () => {
      if (sub) sub.remove();
    };
  }, []);

  const progressRatio =
    playerState.durationMs > 0
      ? Math.min(1, Math.max(0, playerState.positionMs / playerState.durationMs))
      : 0;

  return (
    <SafeAreaView style={styles.safeContainer}>
      <StatusBar style="dark" />

      {/* Üst Başlık Çubuğu */}
      <View style={styles.topHeader}>
        <View style={styles.logoRow}>
          <View style={styles.logoBadge}>
            <Image
              source={require('./assets/app-logo.png')}
              style={styles.logoImage}
              resizeMode="contain"
            />
          </View>
          <Text style={styles.brandTitle}>MediaToolkit</Text>
        </View>

        <View style={styles.headerRightBadge}>
          <View style={styles.statusDot} />
          <Text style={styles.statusBadgeText}>Hazır</Text>
        </View>
      </View>

      {/* Ana Gövde (Aktif Ekran) */}
      <View style={styles.tabContentArea}>
        {activeTab === 'downloader' ? (
          <DownloaderTab
            onSwitchToHistory={() => setActiveTab('history')}
          />
        ) : (
          <HistoryTab
            onSwitchToDownloader={() => setActiveTab('downloader')}
            playerState={playerState}
          />
        )}
      </View>

      {/* Arka Plan Müzik Çalar Alt Kontrol Çubuğu (Mini Player) */}
      {playerState.isActive && (
        <View style={styles.miniPlayerContainer}>
          {/* Üst İlerleme Çizgisi */}
          <View style={styles.miniProgressBg}>
            <View
              style={[
                styles.miniProgressFill,
                { width: `${Math.round(progressRatio * 100)}%` },
              ]}
            />
          </View>

          <View style={styles.miniPlayerContent}>
            <TouchableOpacity
              style={styles.miniSongInfo}
              activeOpacity={0.8}
              onPress={() => setActiveTab('history')}
            >
              <View style={styles.miniMusicIconBox}>
                <Ionicons
                  name={playerState.isPlaying ? 'musical-notes' : 'pause'}
                  size={18}
                  color="#FFFFFF"
                />
              </View>
              <View style={styles.miniTextCol}>
                <Text style={styles.miniSongTitle} numberOfLines={1}>
                  {playerState.title || 'Şarkı Çalıyor'}
                </Text>
                <Text style={styles.miniSongMeta} numberOfLines={1}>
                  {playerState.uploader || 'MediaToolkit'} •{' '}
                  {formatMs(playerState.positionMs)} /{' '}
                  {formatMs(playerState.durationMs)}
                  {playerState.playlistCount > 1
                    ? ` (${playerState.currentIndex + 1}/${playerState.playlistCount})`
                    : ''}
                </Text>
              </View>
            </TouchableOpacity>

            {/* Kontroller: Önceki | Oynat/Duraklat | Sonraki | Kapat */}
            <View style={styles.miniControlsRow}>
              <TouchableOpacity
                style={styles.miniCtrlBtn}
                onPress={() => prevAudioTrack()}
              >
                <Ionicons name="play-skip-back" size={20} color="#E2E8F0" />
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.miniPlayPauseBtn}
                onPress={() => togglePlayPauseAudio()}
              >
                <Ionicons
                  name={playerState.isPlaying ? 'pause' : 'play'}
                  size={20}
                  color="#1E1B4B"
                />
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.miniCtrlBtn}
                onPress={() => nextAudioTrack()}
              >
                <Ionicons name="play-skip-forward" size={20} color="#E2E8F0" />
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.miniCloseBtn}
                onPress={() => stopAudioPlayer()}
              >
                <Ionicons name="close" size={18} color="#94A3B8" />
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}

      {/* Alt Navigasyon Çubuğu */}
      <View style={styles.bottomNav}>
        <TouchableOpacity
          style={[
            styles.navItem,
            activeTab === 'downloader' && styles.navItemActive,
          ]}
          onPress={() => setActiveTab('downloader')}
        >
          <Ionicons
            name={activeTab === 'downloader' ? 'download' : 'download-outline'}
            size={22}
            color={activeTab === 'downloader' ? '#2563EB' : '#94A3B8'}
          />
          <Text
            style={[
              styles.navLabel,
              activeTab === 'downloader' && styles.navLabelActive,
            ]}
          >
            İndir
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.navItem,
            activeTab === 'history' && styles.navItemActive,
          ]}
          onPress={() => setActiveTab('history')}
        >
          <Ionicons
            name={activeTab === 'history' ? 'musical-notes' : 'musical-notes-outline'}
            size={22}
            color={activeTab === 'history' ? '#2563EB' : '#94A3B8'}
          />
          <Text
            style={[
              styles.navLabel,
              activeTab === 'history' && styles.navLabelActive,
            ]}
          >
            İndirilenler
          </Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeContainer: {
    flex: 1,
    backgroundColor: '#F8FAFC',
    paddingTop: Platform.OS === 'android' ? RNStatusBar.currentHeight : 0,
    width: '100%',
    height: '100%',
    ...(Platform.OS === 'web' ? { minHeight: '100vh' } : {}),
  },
  topHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
    backgroundColor: '#FFFFFF',
  },
  logoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  logoBadge: {
    width: 34,
    height: 34,
    borderRadius: 8,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  logoImage: {
    width: 26,
    height: 26,
  },
  brandTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0F172A',
    letterSpacing: -0.4,
  },
  headerRightBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#F0FDF4',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#BBF7D0',
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#16A34A',
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#16A34A',
  },
  tabContentArea: {
    flex: 1,
  },
  miniPlayerContainer: {
    backgroundColor: '#1E1B4B',
    borderTopWidth: 1,
    borderTopColor: '#312E81',
  },
  miniProgressBg: {
    height: 3,
    backgroundColor: '#312E81',
    width: '100%',
  },
  miniProgressFill: {
    height: '100%',
    backgroundColor: '#818CF8',
  },
  miniPlayerContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
  },
  miniSongInfo: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  miniMusicIconBox: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: '#4F46E5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  miniTextCol: {
    flex: 1,
  },
  miniSongTitle: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  miniSongMeta: {
    color: '#A5B4FC',
    fontSize: 11,
    marginTop: 2,
  },
  miniControlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  miniCtrlBtn: {
    width: 34,
    height: 34,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  miniPlayPauseBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  miniCloseBtn: {
    width: 30,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 2,
  },
  bottomNav: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
    paddingTop: 10,
    paddingBottom: Platform.OS === 'web' ? 22 : 12,
    paddingHorizontal: 32,
    justifyContent: 'space-around',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 8,
  },
  navItem: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
    paddingHorizontal: 28,
    borderRadius: 12,
  },
  navItemActive: {
    backgroundColor: '#EFF6FF',
  },
  navLabel: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 3,
    fontWeight: '500',
  },
  navLabelActive: {
    color: '#2563EB',
    fontWeight: '700',
  },
});
