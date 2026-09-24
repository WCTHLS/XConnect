export type Theme = 'dark' | 'light';

export const palette = {
  // Brand Accents
  mintPresence: '#33D1AC',
  mintGlow: 'rgba(51, 209, 172, 0.4)',
  mintSubtle: 'rgba(51, 209, 172, 0.15)',
  skyMesh: '#38BDF8',
  skyDark: '#0284C7',
  skyGlow: 'rgba(56, 189, 248, 0.4)',
  skySubtle: 'rgba(56, 189, 248, 0.15)',
  tealUltra: '#2DD4BF',
  amberWarn: '#F59E0B',
  roseError: '#EF4444',
  
  // Surfaces
  darkBg: '#060B12',
  darkSurf: '#0F2F2C',
  darkCard: '#131C2E',
  darkCardSecondary: '#161F30',
  darkBorder: '#22314E',
  
  // Figma Light Canvas
  lightBg: '#FFFFFF',
  lightSurf: '#FFFFFF',
  lightCard: '#FFFFFF',
  lightCardSecondary: '#F8FAFC',
  lightBorder: '#E2E8F0',
  
  // Text Hierarchy
  darkTxt: '#F8FAFC',
  darkSub: '#94A3B8',
  darkMuted: '#64748B',
  
  lightTxt: '#0F172A',
  lightSub: '#475569',
  lightMuted: '#94A3B8',
};

export const getThemeColors = (theme: Theme) => {
  const isDark = theme === 'dark';
  return {
    isDark,
    bg: isDark ? palette.darkBg : palette.lightBg,
    surf: isDark ? palette.darkSurf : palette.lightSurf,
    card: isDark ? palette.darkCard : palette.lightCard,
    cardSecondary: isDark ? palette.darkCardSecondary : palette.lightCardSecondary,
    border: isDark ? palette.darkBorder : palette.lightBorder,
    txt: isDark ? palette.darkTxt : palette.lightTxt,
    sub: isDark ? palette.darkSub : palette.lightSub,
    muted: isDark ? palette.darkMuted : palette.lightMuted,
    primary: palette.mintPresence,
    accent: palette.skyMesh,
    warn: palette.amberWarn,
    error: palette.roseError,
    navBg: isDark ? '#0D1522' : '#FFFFFF',
    navBorder: isDark ? '#1E293B' : '#EAEAEA',
  };
};

export type ThemeColors = ReturnType<typeof getThemeColors>;
