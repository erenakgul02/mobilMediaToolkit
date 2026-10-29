import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  SafeAreaView,
  Image,
  Platform,
  StatusBar as RNStatusBar,
  Modal,
  TextInput,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';

import DownloaderTab from './src/components/DownloaderTab';
import HistoryTab from './src/components/HistoryTab';
import { getServerUrl, setServerUrl, DEFAULT_SERVER_URL } from './src/config';
import { checkHealth } from './src/services/api';

export default function App() {
  const [activeTab, setActiveTab] = useState('downloader');
  const [isOnline, setIsOnline] = useState(false);
  const [showServerModal, setShowServerModal] = useState(false);
  const [serverInput, setServerInput] = useState('');
  const [testingConnection, setTestingConnection] = useState(false);
  const [testResult, setTestResult] = useState(null);

  useEffect(() => {
    // Ilk acilista sunucu adresini oku ve baglantiyi kontrol et
    getServerUrl().then((url) => {
      setServerInput(url);
      checkHealth(url)
        .then(() => setIsOnline(true))
        .catch(() => setIsOnline(false));
    });
  }, []);

  const handleOpenServerModal = async () => {
    const current = await getServerUrl();
    setServerInput(current);
    setTestResult(null);
    setShowServerModal(true);
  };

  const handleTestConnection = async () => {
    const target = (serverInput || '').trim();
    if (!target) return;
    setTestingConnection(true);
    setTestResult(null);
    try {
      const data = await checkHealth(target);
      setIsOnline(true);
      setTestResult({
        success: true,
        message: 'Baglanti basarili! Sunucu aktif.',
      });
    } catch (e) {
      setIsOnline(false);
      setTestResult({
        success: false,
        message: 'Sunucuya ulasilamadi: ' + (e.message || 'Baglanti zaman asimi'),
      });
    } finally {
      setTestingConnection(false);
    }
  };

  const handleSaveServerUrl = async () => {
    const target = (serverInput || '').trim();
    if (!target) {
      Alert.alert('Uyari', 'Gecerli bir URL adresi girin.');
      return;
    }
    await setServerUrl(target);
    setShowServerModal(false);
    handleTestConnection();
  };

  const handleResetServerUrl = async () => {
    setServerInput(DEFAULT_SERVER_URL);
    await setServerUrl(DEFAULT_SERVER_URL);
    setTestResult(null);
  };

  return (
    <SafeAreaView style={styles.safeContainer}>
      <StatusBar style="dark" />

      {/* Ust Baslik Cubugu */}
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

        <TouchableOpacity
          style={[
            styles.headerRightBadge,
            !isOnline && styles.headerRightBadgeOffline,
          ]}
          onPress={handleOpenServerModal}
          activeOpacity={0.8}
        >
          <View
            style={[
              styles.statusDot,
              !isOnline && styles.statusDotOffline,
            ]}
          />
          <Text
            style={[
              styles.statusBadgeText,
              !isOnline && styles.statusBadgeTextOffline,
            ]}
          >
            {isOnline ? 'Online' : 'Baglanti'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Ana Govde */}
      <View style={styles.tabContentArea}>
        {activeTab === 'downloader' ? (
          <DownloaderTab
            onSwitchToHistory={() => setActiveTab('history')}
          />
        ) : (
          <HistoryTab
            onSwitchToDownloader={() => setActiveTab('downloader')}
          />
        )}
      </View>

      {/* Alt Navigasyon Cubugu */}
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
            Indir
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
            name={activeTab === 'history' ? 'folder' : 'folder-outline'}
            size={22}
            color={activeTab === 'history' ? '#2563EB' : '#94A3B8'}
          />
          <Text
            style={[
              styles.navLabel,
              activeTab === 'history' && styles.navLabelActive,
            ]}
          >
            Indirilenler
          </Text>
        </TouchableOpacity>
      </View>

      {/* Sunucu Ayarlari Modali */}
      <Modal
        visible={showServerModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowServerModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <View style={styles.modalTitleRow}>
                <Ionicons name="server-outline" size={20} color="#0F172A" />
                <Text style={styles.modalTitle}>Sunucu Baglantisi</Text>
              </View>
              <TouchableOpacity onPress={() => setShowServerModal(false)}>
                <Ionicons name="close" size={22} color="#64748B" />
              </TouchableOpacity>
            </View>

            <Text style={styles.modalDescription}>
              Indirme islemleri icin bilgisayardaki arka uc sunucu adresini (Yerel Wi-Fi IP veya Cloudflare baglantisini) ayarlayin.
            </Text>

            <View style={styles.inputBox}>
              <TextInput
                style={styles.serverTextInput}
                value={serverInput}
                onChangeText={setServerInput}
                placeholder="http://192.168.1.21:5000"
                placeholderTextColor="#94A3B8"
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>

            {testResult && (
              <View
                style={[
                  styles.testResultBox,
                  testResult.success
                    ? styles.testResultSuccess
                    : styles.testResultError,
                ]}
              >
                <Ionicons
                  name={
                    testResult.success ? 'checkmark-circle' : 'alert-circle'
                  }
                  size={16}
                  color={testResult.success ? '#16A34A' : '#EF4444'}
                />
                <Text
                  style={[
                    styles.testResultText,
                    testResult.success
                      ? styles.testResultTextSuccess
                      : styles.testResultTextError,
                  ]}
                >
                  {testResult.message}
                </Text>
              </View>
            )}

            <View style={styles.modalButtonRow}>
              <TouchableOpacity
                style={styles.testBtn}
                onPress={handleTestConnection}
                disabled={testingConnection}
              >
                {testingConnection ? (
                  <ActivityIndicator size="small" color="#2563EB" />
                ) : (
                  <Text style={styles.testBtnText}>Test Et</Text>
                )}
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.saveBtn}
                onPress={handleSaveServerUrl}
              >
                <Text style={styles.saveBtnText}>Kaydet</Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              style={styles.resetBtn}
              onPress={handleResetServerUrl}
            >
              <Text style={styles.resetBtnText}>Varsayilana Sifirla</Text>
            </TouchableOpacity>
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
    paddingVertical: 5,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#BBF7D0',
  },
  headerRightBadgeOffline: {
    backgroundColor: '#F1F5F9',
    borderColor: '#E2E8F0',
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#16A34A',
  },
  statusDotOffline: {
    backgroundColor: '#94A3B8',
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#16A34A',
  },
  statusBadgeTextOffline: {
    color: '#64748B',
  },
  tabContentArea: {
    flex: 1,
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
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalCard: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 10,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  modalTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0F172A',
  },
  modalDescription: {
    fontSize: 13,
    color: '#64748B',
    lineHeight: 18,
    marginBottom: 16,
  },
  inputBox: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 12,
  },
  serverTextInput: {
    fontSize: 14,
    color: '#0F172A',
  },
  testResultBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    padding: 10,
    borderRadius: 8,
    marginBottom: 12,
  },
  testResultSuccess: {
    backgroundColor: '#F0FDF4',
    borderWidth: 1,
    borderColor: '#BBF7D0',
  },
  testResultError: {
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
  },
  testResultText: {
    fontSize: 12,
    flex: 1,
  },
  testResultTextSuccess: {
    color: '#16A34A',
    fontWeight: '600',
  },
  testResultTextError: {
    color: '#EF4444',
  },
  modalButtonRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 4,
  },
  testBtn: {
    flex: 1,
    paddingVertical: 11,
    borderRadius: 10,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  testBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#2563EB',
  },
  saveBtn: {
    flex: 1,
    paddingVertical: 11,
    borderRadius: 10,
    backgroundColor: '#2563EB',
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  resetBtn: {
    alignItems: 'center',
    marginTop: 12,
    paddingVertical: 4,
  },
  resetBtnText: {
    fontSize: 12,
    color: '#94A3B8',
    textDecorationLine: 'underline',
  },
});
