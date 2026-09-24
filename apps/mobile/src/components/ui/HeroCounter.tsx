import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';
import { useTheme } from '../../theme/useTheme';

interface HeroCounterProps {
  value: number;
}

export const HeroCounter: React.FC<HeroCounterProps> = ({ value }) => {
  const { colors } = useTheme();
  const [displayValue, setDisplayValue] = useState(value);
  const slideAnim = useRef(new Animated.Value(0)).current;
  const fadeAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (value !== displayValue) {
      Animated.parallel([
        Animated.timing(slideAnim, {
          toValue: -15,
          duration: 180,
          useNativeDriver: true,
        }),
        Animated.timing(fadeAnim, {
          toValue: 0,
          duration: 180,
          useNativeDriver: true,
        }),
      ]).start(() => {
        setDisplayValue(value);
        slideAnim.setValue(15);
        Animated.parallel([
          Animated.timing(slideAnim, {
            toValue: 0,
            duration: 220,
            useNativeDriver: true,
          }),
          Animated.timing(fadeAnim, {
            toValue: 1,
            duration: 220,
            useNativeDriver: true,
          }),
        ]).start();
      });
    }
  }, [value, displayValue, slideAnim, fadeAnim]);

  return (
    <View style={styles.container}>
      <Animated.Text
        style={[
          styles.text,
          {
            color: colors.txt,
            opacity: fadeAnim,
            transform: [{ translateY: slideAnim }],
          },
        ]}
      >
        {displayValue}
      </Animated.Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    height: 78,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  text: {
    fontSize: 68,
    fontWeight: '800',
    letterSpacing: -2,
    lineHeight: 74,
  },
});
