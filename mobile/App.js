import React, { useState } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  SafeAreaView,
  Image,
  Platform,
  StatusBar as RNStatusBar,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';

import DownloaderTab from './src/components/DownloaderTab';
import HistoryTab from './src/components/HistoryTab';

export default function App() {
  const [activeTab, setActiveTab] = useState('downloader');

  return (
    <SafeAreaView style={styles.safeContainer}>
      <StatusBar style="light" />

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
          />
        )}
      </View>

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
            color={activeTab === 'downloader' ? '#F472B6' : '#A78BFA'}
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
            name={activeTab === 'history' ? 'folder' : 'folder-outline'}
            size={22}
            color={activeTab === 'history' ? '#F472B6' : '#A78BFA'}
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
    backgroundColor: '#0C0714',
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
    borderBottomColor: '#28173E',
    backgroundColor: '#130C22',
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
    backgroundColor: '#1F1533',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#4C2D75',
  },
  logoImage: {
    width: 26,
    height: 26,
  },
  brandTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#FAF5FF',
    letterSpacing: -0.4,
  },
  headerRightBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(217, 70, 239, 0.12)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#D946EF',
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#10B981',
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#F472B6',
  },
  tabContentArea: {
    flex: 1,
  },
  bottomNav: {
    flexDirection: 'row',
    backgroundColor: '#130C22',
    borderTopWidth: 1,
    borderTopColor: '#28173E',
    paddingTop: 10,
    paddingBottom: Platform.OS === 'web' ? 22 : 12,
    paddingHorizontal: 32,
    justifyContent: 'space-around',
    alignItems: 'center',
  },
  navItem: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
    paddingHorizontal: 28,
    borderRadius: 12,
  },
  navItemActive: {
    backgroundColor: 'rgba(236, 72, 153, 0.15)',
  },
  navLabel: {
    fontSize: 12,
    color: '#A78BFA',
    marginTop: 3,
    fontWeight: '500',
  },
  navLabelActive: {
    color: '#F472B6',
    fontWeight: '700',
  },
});
