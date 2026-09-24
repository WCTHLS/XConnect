import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { palette } from '../../theme/colors';

interface SensorPillProps {
  label: string;
  status: 'active' | 'warn' | 'error' | 'off';
}

export const SensorPill: React.FC<SensorPillProps> = ({ label, status }) => {
  const color =
    status === 'active'
      ? palette.mintPresence
      : status === 'warn'
      ? palette.amberWarn
      : status === 'error'
      ? palette.roseError
      : palette.darkMuted;

  return (
    <View style={[styles.container, { borderColor: `${color}45`, backgroundColor: `${color}18` }]}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text style={[styles.label, { color }]}>{label}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1,
    marginRight: 6,
    marginBottom: 4,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 4,
  },
  label: {
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
});
