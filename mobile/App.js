import React, { useState, useEffect, useRef } from 'react';
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
  Modal,
  Animated,
  Easing,
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
  seekAudioTo,
  downloadFileToDevice,
  getThemeMode,
  setThemeMode,
} from './src/services/api';

function formatMs(ms) {
  const totalSec = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  return `${mins < 10 ? '0' : ''}${mins}:${secs < 10 ? '0' : ''}${secs}`;
}

export default function App() {
  const [activeTab, setActiveTab] = useState('downloader');
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [expandedPlayerVisible, setExpandedPlayerVisible] = useState(false);
  const [seekBarWidth, setSeekBarWidth] = useState(1);

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
    filePath: '',
    thumbnail: '',
  });

  // GPU Hızlandırmalı Plak Dönüş Animasyonu (useNativeDriver: true -> 0% CPU Yükü)
  const spinAnim = useRef(new Animated.Value(0)).current;
  const spinLoopRef = useRef(null);

  useEffect(() => {
    if (playerState.isActive && playerState.isPlaying) {
      spinAnim.setValue(0);
      spinLoopRef.current = Animated.loop(
        Animated.timing(spinAnim, {
          toValue: 1,
          duration: 9000,
          easing: Easing.linear,
          useNativeDriver: true,
        })
      );
      spinLoopRef.current.start();
    } else {
      if (spinLoopRef.current) {
        spinLoopRef.current.stop();
      }
    }
  }, [playerState.isActive, playerState.isPlaying, playerState.id]);

  const spinInterpolate = spinAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  useEffect(() => {
    // Kayıtlı Gece Modu tercihini yükle
    getThemeMode()
      .then((dark) => setIsDarkMode(Boolean(dark)))
      .catch(() => {});

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
          setPlayerState((prev) => ({ ...prev, ...st }));
        }
      })
      .catch(() => {});

    // Android Foreground Service'ten gelen gerçek zamanlı oynatıcı olaylarını dinle
    let sub = null;
    if (Platform.OS === 'android') {
      sub = DeviceEventEmitter.addListener('onMusicPlayerStateChanged', (event) => {
        if (event) {
          setPlayerState((prev) => ({ ...prev, ...event }));
          if (!event.isActive) {
            setExpandedPlayerVisible(false);
          }
        }
      });
    }

    return () => {
      if (sub) sub.remove();
    };
  }, []);

  const handleToggleDarkMode = () => {
    setIsDarkMode((prev) => {
      const next = !prev;
      setThemeMode(next);
      return next;
    });
  };

  const progressRatio =
    playerState.durationMs > 0
      ? Math.min(1, Math.max(0, playerState.positionMs / playerState.durationMs))
      : 0;

  const handleSeekBarTap = (evt) => {
    if (!playerState.durationMs || seekBarWidth <= 0) return;
    const tapX = evt.nativeEvent.locationX;
    const ratio = Math.min(1, Math.max(0, tapX / seekBarWidth));
    const targetMs = Math.round(ratio * playerState.durationMs);
    seekAudioTo(targetMs);
  };

  const handleSkipSeconds = (deltaSec) => {
    const targetMs = Math.min(
      playerState.durationMs || 0,
      Math.max(0, (playerState.positionMs || 0) + deltaSec * 1000)
    );
    seekAudioTo(targetMs);
  };

  return (
    <SafeAreaView
      style={[
        styles.safeContainer,
        isDarkMode && styles.safeContainerDark,
      ]}
    >
      <StatusBar style={isDarkMode ? 'light' : 'dark'} />

      {/* Üst Başlık Çubuğu */}
      <View
        style={[
          styles.topHeader,
          isDarkMode && styles.topHeaderDark,
        ]}
      >
        <View style={styles.logoRow}>
          <View
            style={[
              styles.logoBadge,
              isDarkMode && styles.logoBadgeDark,
            ]}
          >
            <Image
              source={require('./assets/app-logo.png')}
              style={styles.logoImage}
              resizeMode="contain"
            />
          </View>
          <Text
            style={[
              styles.brandTitle,
              isDarkMode && styles.brandTitleDark,
            ]}
          >
            MediaToolkit
          </Text>
        </View>

        {/* Sağ Üst: Gece / Gündüz Modu Geçiş Butonu */}
        <TouchableOpacity
          style={[
            styles.themeToggleBtn,
            isDarkMode && styles.themeToggleBtnDark,
          ]}
          activeOpacity={0.75}
          onPress={handleToggleDarkMode}
        >
          <Ionicons
            name={isDarkMode ? 'sunny' : 'moon'}
            size={14}
            color={isDarkMode ? '#FBBF24' : '#334155'}
          />
          <Text
            style={[
              styles.themeToggleText,
              isDarkMode && styles.themeToggleTextDark,
            ]}
          >
            {isDarkMode ? 'Gündüz' : 'Gece Modu'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Ana Gövde (Aktif Ekran) */}
      <View style={styles.tabContentArea}>
        {activeTab === 'downloader' ? (
          <DownloaderTab
            isDarkMode={isDarkMode}
            onSwitchToHistory={() => setActiveTab('history')}
          />
        ) : (
          <HistoryTab
            isDarkMode={isDarkMode}
            onSwitchToDownloader={() => setActiveTab('downloader')}
            playerState={playerState}
            onOpenExpandedPlayer={() => setExpandedPlayerVisible(true)}
          />
        )}
      </View>

      {/* Arka Plan Müzik Çalar Alt Kontrol Çubuğu (Mini Player - Dokununca Büyür) */}
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
              onPress={() => setExpandedPlayerVisible(true)}
            >
              {/* Dönen Küçük Plak Kapak Resmi */}
              <Animated.View
                style={[
                  styles.miniVinylDisc,
                  { transform: [{ rotate: spinInterpolate }] },
                ]}
              >
                {playerState.thumbnail ? (
                  <Image
                    source={{ uri: playerState.thumbnail }}
                    style={styles.miniVinylImage}
                    resizeMode="cover"
                  />
                ) : (
                  <View style={styles.miniVinylFallback}>
                    <Ionicons name="musical-notes" size={14} color="#FFFFFF" />
                  </View>
                )}
                <View style={styles.miniVinylHole} />
              </Animated.View>

              <View style={styles.miniTextCol}>
                <Text style={styles.miniSongTitle} numberOfLines={1}>
                  {playerState.title || 'Şarkı Çalıyor'}
                </Text>
                <Text style={styles.miniSongMeta} numberOfLines={1}>
                  {playerState.uploader || 'MediaToolkit'} •{' '}
                  {formatMs(playerState.positionMs)} /{' '}
                  {formatMs(playerState.durationMs)}
                </Text>
              </View>
            </TouchableOpacity>

            {/* Kontroller: Önceki | Oynat/Duraklat | Sonraki | Kapat */}
            <View style={styles.miniControlsRow}>
              <TouchableOpacity
                style={styles.miniCtrlBtn}
                onPress={() => prevAudioTrack()}
              >
                <Ionicons name="play-skip-back" size={19} color="#E2E8F0" />
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.miniPlayPauseBtn}
                onPress={() => togglePlayPauseAudio()}
              >
                <Ionicons
                  name={playerState.isPlaying ? 'pause' : 'play'}
                  size={19}
                  color="#1E1B4B"
                  style={!playerState.isPlaying ? { marginLeft: 1 } : undefined}
                />
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.miniCtrlBtn}
                onPress={() => nextAudioTrack()}
              >
                <Ionicons name="play-skip-forward" size={19} color="#E2E8F0" />
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
      <View
        style={[
          styles.bottomNav,
          isDarkMode && styles.bottomNavDark,
        ]}
      >
        <TouchableOpacity
          style={[
            styles.navItem,
            activeTab === 'downloader' &&
              (isDarkMode ? styles.navItemActiveDark : styles.navItemActive),
          ]}
          onPress={() => setActiveTab('downloader')}
        >
          <Ionicons
            name={activeTab === 'downloader' ? 'download' : 'download-outline'}
            size={21}
            color={
              activeTab === 'downloader'
                ? isDarkMode
                  ? '#60A5FA'
                  : '#2563EB'
                : isDarkMode
                ? '#94A3B8'
                : '#64748B'
            }
          />
          <Text
            style={[
              styles.navLabel,
              isDarkMode && styles.navLabelDark,
              activeTab === 'downloader' &&
                (isDarkMode ? styles.navLabelActiveDark : styles.navLabelActive),
            ]}
          >
            İndir
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.navItem,
            activeTab === 'history' &&
              (isDarkMode ? styles.navItemActiveDark : styles.navItemActive),
          ]}
          onPress={() => setActiveTab('history')}
        >
          <Ionicons
            name={activeTab === 'history' ? 'musical-notes' : 'musical-notes-outline'}
            size={21}
            color={
              activeTab === 'history'
                ? isDarkMode
                  ? '#60A5FA'
                  : '#2563EB'
                : isDarkMode
                ? '#94A3B8'
                : '#64748B'
            }
          />
          <Text
            style={[
              styles.navLabel,
              isDarkMode && styles.navLabelDark,
              activeTab === 'history' &&
                (isDarkMode ? styles.navLabelActiveDark : styles.navLabelActive),
            ]}
          >
            İndirilenler
          </Text>
        </TouchableOpacity>
      </View>

      {/* BÜYÜK TAM EKRAN MÜZİK ÇALAR MODALI (Mini Player'a Dokununca Açılır) */}
      <Modal
        visible={expandedPlayerVisible && playerState.isActive}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setExpandedPlayerVisible(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.expandedPlayerSheet}>
            {/* Üst Bar: Küçült + Başlık + Paylaş */}
            <View style={styles.expandedTopBar}>
              <TouchableOpacity
                style={styles.expandedTopBtn}
                onPress={() => setExpandedPlayerVisible(false)}
              >
                <Ionicons name="chevron-down" size={24} color="#E2E8F0" />
              </TouchableOpacity>

              <View style={styles.expandedHeaderCenter}>
                <Text style={styles.expandedPlayingLabel}>ŞU AN ÇALIYOR</Text>
                {playerState.playlistCount > 0 && (
                  <Text style={styles.expandedPlaylistPos}>
                    Parça {playerState.currentIndex + 1} / {playerState.playlistCount}
                  </Text>
                )}
              </View>

              <TouchableOpacity
                style={styles.expandedTopBtn}
                onPress={() => {
                  if (playerState.filename) {
                    downloadFileToDevice(
                      playerState.filePath ? `file://${playerState.filePath}` : '',
                      playerState.filename,
                      'share'
                    ).catch(() => {});
                  }
                }}
              >
                <Ionicons name="share-social-outline" size={20} color="#E2E8F0" />
              </TouchableOpacity>
            </View>

            {/* Orta: Büyük Dönen Plak (Vinyl Record) + Kapak Resmi */}
            <View style={styles.vinylStage}>
              <Animated.View
                style={[
                  styles.largeVinylOuter,
                  { transform: [{ rotate: spinInterpolate }] },
                ]}
              >
                <View style={styles.largeVinylGroove1}>
                  <View style={styles.largeVinylGroove2}>
                    <View style={styles.largeVinylCoverHolder}>
                      {playerState.thumbnail ? (
                        <Image
                          source={{ uri: playerState.thumbnail }}
                          style={styles.largeVinylCoverImg}
                          resizeMode="cover"
                        />
                      ) : (
                        <View style={styles.largeVinylCoverFallback}>
                          <Ionicons name="musical-notes" size={54} color="#FFFFFF" />
                        </View>
                      )}
                      {/* Plak Merkez Deliği */}
                      <View style={styles.largeVinylSpindleOuter}>
                        <View style={styles.largeVinylSpindleInner} />
                      </View>
                    </View>
                  </View>
                </View>
              </Animated.View>
            </View>

            {/* Şarkı Başlığı ve Kanal Bilgisi */}
            <View style={styles.expandedTrackInfo}>
              <Text style={styles.expandedSongTitle} numberOfLines={2}>
                {playerState.title || 'Bilinmeyen Şarkı'}
              </Text>
              <Text style={styles.expandedSongArtist} numberOfLines={1}>
                {playerState.uploader || 'MediaToolkit'}
              </Text>
            </View>

            {/* Dokunmatik İlerleme Çubuğu ve Saniye Göstergeleri */}
            <View style={styles.seekSection}>
              <TouchableOpacity
                activeOpacity={0.9}
                onLayout={(e) =>
                  setSeekBarWidth(Math.max(1, e.nativeEvent.layout.width))
                }
                onPress={handleSeekBarTap}
                style={styles.seekBarHitBox}
              >
                <View style={styles.seekTrackBg}>
                  <View
                    style={[
                      styles.seekTrackFill,
                      { width: `${Math.round(progressRatio * 100)}%` },
                    ]}
                  />
                </View>
              </TouchableOpacity>

              <View style={styles.timeLabelsRow}>
                <Text style={styles.timeLabelText}>
                  {formatMs(playerState.positionMs)}
                </Text>
                <Text style={styles.timeLabelText}>
                  {formatMs(playerState.durationMs)}
                </Text>
              </View>
            </View>

            {/* Alt Büyük Oynatma Kontrolleri */}
            <View style={styles.expandedControlsRow}>
              <TouchableOpacity
                style={styles.expandedSecondaryBtn}
                onPress={() => handleSkipSeconds(-10)}
              >
                <Ionicons name="play-back" size={18} color="#CBD5E1" />
                <Text style={styles.skipSecText}>-10s</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.expandedSkipBtn}
                onPress={() => prevAudioTrack()}
              >
                <Ionicons name="play-skip-back" size={28} color="#FFFFFF" />
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.expandedPlayPauseBtn}
                onPress={() => togglePlayPauseAudio()}
              >
                <Ionicons
                  name={playerState.isPlaying ? 'pause' : 'play'}
                  size={32}
                  color="#1E1B4B"
                  style={!playerState.isPlaying ? { marginLeft: 3 } : undefined}
                />
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.expandedSkipBtn}
                onPress={() => nextAudioTrack()}
              >
                <Ionicons name="play-skip-forward" size={28} color="#FFFFFF" />
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.expandedSecondaryBtn}
                onPress={() => handleSkipSeconds(10)}
              >
                <Ionicons name="play-forward" size={18} color="#CBD5E1" />
                <Text style={styles.skipSecText}>+10s</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeContainer: {
    flex: 1,
    backgroundColor: '#F8FAFC',
    paddingTop:
      Platform.OS === 'android'
        ? Math.max(0, (RNStatusBar.currentHeight || 20) - 8)
        : 0,
    width: '100%',
    height: '100%',
    ...(Platform.OS === 'web' ? { minHeight: '100vh' } : {}),
  },
  safeContainerDark: {
    backgroundColor: '#0B0F19',
  },
  topHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
    backgroundColor: '#FFFFFF',
  },
  topHeaderDark: {
    backgroundColor: '#111827',
    borderBottomColor: '#1E293B',
  },
  logoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  logoBadge: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  logoBadgeDark: {
    backgroundColor: '#1E293B',
    borderColor: '#334155',
  },
  logoImage: {
    width: 24,
    height: 24,
  },
  brandTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#0F172A',
    letterSpacing: -0.4,
  },
  brandTitleDark: {
    color: '#F8FAFC',
  },
  themeToggleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 11,
    paddingVertical: 5,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#CBD5E1',
  },
  themeToggleBtnDark: {
    backgroundColor: '#1E293B',
    borderColor: '#334155',
  },
  themeToggleText: {
    fontSize: 11.5,
    fontWeight: '700',
    color: '#334155',
  },
  themeToggleTextDark: {
    color: '#F8FAFC',
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
    paddingVertical: 8,
    gap: 8,
  },
  miniSongInfo: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  miniVinylDisc: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#0F172A',
    padding: 3,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: '#6366F1',
  },
  miniVinylImage: {
    width: '100%',
    height: '100%',
    borderRadius: 17,
  },
  miniVinylFallback: {
    width: '100%',
    height: '100%',
    borderRadius: 17,
    backgroundColor: '#4F46E5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  miniVinylHole: {
    position: 'absolute',
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#0F172A',
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
  },
  miniTextCol: {
    flex: 1,
  },
  miniSongTitle: {
    color: '#FFFFFF',
    fontSize: 12.5,
    fontWeight: '700',
  },
  miniSongMeta: {
    color: '#A5B4FC',
    fontSize: 10.5,
    marginTop: 2,
  },
  miniControlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  miniCtrlBtn: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  miniPlayPauseBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  miniCloseBtn: {
    width: 28,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bottomNav: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
    paddingTop: 6,
    paddingBottom: Platform.OS === 'android' ? 24 : 14,
    paddingHorizontal: 24,
    justifyContent: 'space-around',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 10,
  },
  bottomNavDark: {
    backgroundColor: '#111827',
    borderTopColor: '#1E293B',
  },
  navItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    paddingVertical: 6,
    paddingHorizontal: 24,
    borderRadius: 12,
  },
  navItemActive: {
    backgroundColor: '#EFF6FF',
  },
  navItemActiveDark: {
    backgroundColor: '#1E293B',
  },
  navLabel: {
    fontSize: 13,
    color: '#64748B',
    fontWeight: '600',
  },
  navLabelDark: {
    color: '#94A3B8',
  },
  navLabelActive: {
    color: '#2563EB',
    fontWeight: '800',
  },
  navLabelActiveDark: {
    color: '#60A5FA',
    fontWeight: '800',
  },
  // BÜYÜK TAM EKRAN MÜZİK ÇALAR MODAL STİLLERİ
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(9, 13, 22, 0.92)',
    justifyContent: 'flex-end',
  },
  expandedPlayerSheet: {
    flex: 1,
    backgroundColor: '#13112E',
    paddingTop: Platform.OS === 'android' ? (RNStatusBar.currentHeight || 24) + 10 : 40,
    paddingBottom: Platform.OS === 'android' ? 54 : 36,
    paddingHorizontal: 24,
    justifyContent: 'space-between',
  },
  expandedTopBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  expandedTopBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  expandedHeaderCenter: {
    alignItems: 'center',
  },
  expandedPlayingLabel: {
    color: '#A5B4FC',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.2,
  },
  expandedPlaylistPos: {
    color: '#E2E8F0',
    fontSize: 12,
    fontWeight: '600',
    marginTop: 2,
  },
  vinylStage: {
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 10,
  },
  largeVinylOuter: {
    width: 248,
    height: 248,
    borderRadius: 124,
    backgroundColor: '#090D16',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: '#312E81',
    shadowColor: '#6366F1',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 20,
    elevation: 14,
  },
  largeVinylGroove1: {
    width: 224,
    height: 224,
    borderRadius: 112,
    borderWidth: 1,
    borderColor: '#1E293B',
    alignItems: 'center',
    justifyContent: 'center',
  },
  largeVinylGroove2: {
    width: 200,
    height: 200,
    borderRadius: 100,
    borderWidth: 1,
    borderColor: '#334155',
    alignItems: 'center',
    justifyContent: 'center',
  },
  largeVinylCoverHolder: {
    width: 172,
    height: 172,
    borderRadius: 86,
    overflow: 'hidden',
    borderWidth: 2.5,
    borderColor: '#6366F1',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#312E81',
  },
  largeVinylCoverImg: {
    width: '100%',
    height: '100%',
  },
  largeVinylCoverFallback: {
    width: '100%',
    height: '100%',
    backgroundColor: '#4F46E5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  largeVinylSpindleOuter: {
    position: 'absolute',
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#090D16',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#6366F1',
  },
  largeVinylSpindleInner: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#E2E8F0',
  },
  expandedTrackInfo: {
    alignItems: 'center',
    paddingHorizontal: 10,
  },
  expandedSongTitle: {
    color: '#FFFFFF',
    fontSize: 19,
    fontWeight: '800',
    textAlign: 'center',
    lineHeight: 25,
  },
  expandedSongArtist: {
    color: '#A5B4FC',
    fontSize: 14,
    fontWeight: '600',
    marginTop: 6,
    textAlign: 'center',
  },
  seekSection: {
    width: '100%',
  },
  seekBarHitBox: {
    paddingVertical: 12,
    justifyContent: 'center',
  },
  seekTrackBg: {
    height: 6,
    backgroundColor: '#312E81',
    borderRadius: 3,
    overflow: 'hidden',
    width: '100%',
  },
  seekTrackFill: {
    height: '100%',
    backgroundColor: '#818CF8',
    borderRadius: 3,
  },
  timeLabelsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 2,
  },
  timeLabelText: {
    color: '#94A3B8',
    fontSize: 12,
    fontWeight: '700',
  },
  expandedControlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
  },
  expandedSecondaryBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 8,
  },
  skipSecText: {
    color: '#CBD5E1',
    fontSize: 10,
    fontWeight: '700',
    marginTop: 2,
  },
  expandedSkipBtn: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  expandedPlayPauseBtn: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#818CF8',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 8,
  },
});
