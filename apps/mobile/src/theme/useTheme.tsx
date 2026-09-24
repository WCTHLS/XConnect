import React, { createContext, useContext, useState, useEffect } from 'react';
import * as SecureStore from 'expo-secure-store';
import { Theme, ThemeColors, getThemeColors } from './colors';

const ONBOARDED_KEY = 'xconnect.has_onboarded_v1';

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
  // Default to Figma's signature Light Mode
  const [theme, setTheme] = useState<Theme>('light');
  const [hasOnboarded, setHasOnboarded] = useState<boolean | null>(null);

  useEffect(() => {
    SecureStore.getItemAsync(ONBOARDED_KEY)
      .then(res => {
        setHasOnboarded(res === 'true');
      })
      .catch(() => {
        setHasOnboarded(false);
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

  const toggleTheme = () => {
    setTheme(prev => (prev === 'dark' ? 'light' : 'dark'));
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
