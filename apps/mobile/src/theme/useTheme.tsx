import React, { createContext, useContext, useState, useEffect } from 'react';
import * as SecureStore from 'expo-secure-store';
import { Theme, ThemeColors, getThemeColors } from './colors';

const ONBOARDED_KEY = 'xconnect.has_onboarded_v1';
const THEME_KEY = 'xconnect.theme_v1';

interface ThemeContextType {
  theme: Theme;
  colors: ThemeColors;
  toggleTheme: () => void;
  setTheme: (t: Theme) => void;
  hasOnboarded: boolean | null;
  markOnboarded: () => Promise<void>;
}

const ThemeContext = createContext<ThemeContextType>({
  theme: 'light',
  colors: getThemeColors('light'),
  toggleTheme: () => {},
  setTheme: () => {},
  hasOnboarded: null,
  markOnboarded: async () => {},
});

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // Default to Figma's signature Light Mode — overridden below once the persisted choice (if
  // any) loads from SecureStore, same pattern as hasOnboarded.
  const [theme, setThemeState] = useState<Theme>('light');
  const [hasOnboarded, setHasOnboarded] = useState<boolean | null>(null);

  useEffect(() => {
    SecureStore.getItemAsync(ONBOARDED_KEY)
      .then(res => {
        setHasOnboarded(res === 'true');
      })
      .catch(() => {
        setHasOnboarded(false);
      });
    SecureStore.getItemAsync(THEME_KEY)
      .then(res => {
        if (res === 'light' || res === 'dark') setThemeState(res);
      })
      .catch(() => {
        // No stored preference (or read failed) — keep the 'light' default.
      });
  }, []);

  const markOnboarded = async () => {
    try {
      await SecureStore.setItemAsync(ONBOARDED_KEY, 'true');
      setHasOnboarded(true);
    } catch {
      setHasOnboarded(true);
    }
  };

  const setTheme = (t: Theme) => {
    setThemeState(t);
    void SecureStore.setItemAsync(THEME_KEY, t).catch(() => {
      // Best-effort: worst case, this choice doesn't survive a restart.
    });
  };

  const toggleTheme = () => {
    setTheme(theme === 'dark' ? 'light' : 'dark');
  };

  const colors = getThemeColors(theme);

  return (
    <ThemeContext.Provider
      value={{
        theme,
        colors,
        toggleTheme,
        setTheme,
        hasOnboarded,
        markOnboarded,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => useContext(ThemeContext);
