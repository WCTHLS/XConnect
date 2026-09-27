import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import Svg, { Path, Circle } from 'react-native-svg';
import { useTheme } from '../../theme/useTheme';

interface TopBarProps {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  onToggleTheme?: () => void;
}

export const TopBar: React.FC<TopBarProps> = ({
  title,
  subtitle,
  onBack,
  onToggleTheme,
}) => {
  const { colors, theme } = useTheme();
  const isDark = theme === 'dark';

  return (
    <View style={styles.container}>
      {onBack && (
        <TouchableOpacity
          activeOpacity={0.7}
          onPress={onBack}
          style={[
            styles.iconButton,
            {
              backgroundColor: isDark
                ? 'rgba(34,49,71,0.5)'
                : 'rgba(226,232,240,0.7)',
            },
          ]}
        >
          <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
            <Path
              d="M15 18l-6-6 6-6"
              stroke={colors.sub}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </Svg>
        </TouchableOpacity>
      )}

      <View style={styles.titleContainer}>
        <Text style={[styles.title, { color: colors.txt }]} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={[styles.subtitle, { color: colors.muted }]} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>

      <View style={styles.rightActions}>
        {onToggleTheme && (
          <TouchableOpacity
            activeOpacity={0.7}
            onPress={onToggleTheme}
            style={[
              styles.iconButton,
              {
                backgroundColor: isDark
                  ? 'rgba(34,49,71,0.5)'
                  : 'rgba(226,232,240,0.7)',
              },
            ]}
          >
            <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
              <Circle cx={12} cy={12} r={5} stroke={colors.sub} strokeWidth={2} />
              <Path
                d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"
                stroke={colors.sub}
                strokeWidth={2}
                strokeLinecap="round"
              />
            </Svg>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 10,
    gap: 12,
  },
  iconButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleContainer: {
    flex: 1,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  subtitle: {
    fontSize: 12,
    marginTop: 2,
    fontWeight: '500',
  },
  rightActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
});
