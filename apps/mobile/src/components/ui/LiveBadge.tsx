import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';
import { palette } from '../../theme/colors';

interface LiveBadgeProps {
  label?: string;
  color?: string;
}

export const LiveBadge: React.FC<LiveBadgeProps> = ({
  label = 'LIVE IN-ROOM',
  color = palette.mintPresence,
}) => {
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 0.3,
          duration: 700,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 700,
          useNativeDriver: true,
        }),
      ])
    );
    animation.start();
    return () => animation.stop();
  }, [pulseAnim]);

  return (
    <View style={[styles.container, { borderColor: `${color}55`, backgroundColor: `${color}1A` }]}>
      <Animated.View
        style={[
          styles.dot,
          { backgroundColor: color, opacity: pulseAnim },
        ]}
      />
      <Text style={[styles.label, { color }]}>{label}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
    alignSelf: 'center',
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
  label: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
});
