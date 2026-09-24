import React from 'react';
import { TouchableOpacity, Text, StyleSheet } from 'react-native';
import { useTheme } from '../../theme/useTheme';
import { palette } from '../../theme/colors';

interface RoomChipProps {
  label: string;
  active: boolean;
  onPress?: () => void;
}

export const RoomChip: React.FC<RoomChipProps> = ({ label, active, onPress }) => {
  const { colors, theme } = useTheme();
  const isDark = theme === 'dark';

  return (
    <TouchableOpacity
      activeOpacity={0.7}
      onPress={onPress}
      style={[
        styles.chip,
        {
          backgroundColor: active
            ? 'rgba(51,209,172,0.18)'
            : isDark
            ? 'rgba(34,49,71,0.5)'
            : 'rgba(226,232,240,0.6)',
          borderColor: active ? palette.mintPresence : colors.border,
        },
      ]}
    >
      <Text
        style={[
          styles.text,
          {
            color: active ? palette.mintPresence : colors.sub,
            fontWeight: active ? '700' : '600',
          },
        ]}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  chip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1.5,
    marginRight: 8,
  },
  text: {
    fontSize: 13,
  },
});
