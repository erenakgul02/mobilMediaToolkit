import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Varsayılan sunucu adresi:
// Laptop web tarayıcısında localhost
// Mobil cihazda aynı Wi-Fi ağındaki bilgisayar IP'si (192.168.1.21)
export const DEFAULT_SERVER_URL =
  Platform.OS === 'web' && typeof window !== 'undefined' && window.location && window.location.origin
    ? window.location.origin
    : 'http://192.168.1.21:5000';

const STORAGE_KEY = '@mobil_media_toolkit_server_url';

export async function getServerUrl() {
  try {
    const saved = await AsyncStorage.getItem(STORAGE_KEY);
    if (saved) return saved.trim();
  } catch (e) {
    console.warn('Sunucu URL okunamadı:', e);
  }
  return DEFAULT_SERVER_URL;
}

export async function setServerUrl(url) {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, url.trim());
  } catch (e) {
    console.warn('Sunucu URL kaydedilemedi:', e);
  }
}
