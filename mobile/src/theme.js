export const lightTheme = {
  background: '#FFFFFF', surface: '#F5F7F6', raised: '#FFFFFF',
  text: '#18221D', muted: '#66736B', border: '#DDE5E0',
  accent: '#176B46', onAccent: '#FFFFFF', accentSoft: '#E5F1E9',
  danger: '#C43838', dangerSoft: '#FFF0F0', overlay: 'rgba(0,0,0,0.55)',
};

export const darkTheme = {
  background: '#080808', surface: '#181818', raised: '#202020',
  text: '#F5F5F5', muted: '#A6A6A6', border: '#343434',
  accent: '#FF9B45', onAccent: '#16100B', accentSoft: '#342315',
  danger: '#FF8585', dangerSoft: '#341818', overlay: 'rgba(0,0,0,0.78)',
};

export const getTheme = (isDarkMode) => isDarkMode ? darkTheme : lightTheme;
