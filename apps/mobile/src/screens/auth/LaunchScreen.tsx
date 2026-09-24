import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Animated,
  Easing,
  Dimensions,
} from 'react-native';
import Svg, { Path, Circle } from 'react-native-svg';
import { palette } from '../../theme/colors';

interface LaunchScreenProps {
  onComplete: () => void;
}

const { width: SCREEN_WIDTH } = Dimensions.get('window');

export const LaunchScreen: React.FC<LaunchScreenProps> = ({ onComplete }) => {
  const [phase, setPhase] = useState(0);

  // Animations
  const xScaleAnim = useRef(new Animated.Value(3.2)).current;
  const xTranslateAnim = useRef(new Animated.Value(0)).current;
  const connectTranslateAnim = useRef(new Animated.Value(180)).current;
  const connectOpacityAnim = useRef(new Animated.Value(0)).current;
  const screenFadeAnim = useRef(new Animated.Value(1)).current;

  // Radar waves
  const wave1 = useRef(new Animated.Value(0)).current;
  const wave2 = useRef(new Animated.Value(0)).current;
  const wave3 = useRef(new Animated.Value(0)).current;

  const runAnimation = useCallback(() => {
    // Phase 1: Zoom out X (200ms -> 950ms)
    setTimeout(() => {
      setPhase(1);
      Animated.timing(xScaleAnim, {
        toValue: 1,
        duration: 750,
        easing: Easing.bezier(0.4, 0, 0.2, 1),
        useNativeDriver: true,
      }).start();
    }, 200);

    // Phase 2: X moves left (950ms -> 1270ms)
    setTimeout(() => {
      setPhase(2);
      Animated.timing(xTranslateAnim, {
        toValue: -80,
        duration: 320,
        easing: Easing.bezier(0.4, 0, 0.2, 1),
        useNativeDriver: true,
      }).start();
    }, 950);

    // Phase 3: "Connect" slides in from right (1050ms -> 1430ms)
    setTimeout(() => {
      setPhase(3);
      Animated.parallel([
        Animated.timing(connectTranslateAnim, {
          toValue: 46,
          duration: 380,
          easing: Easing.bezier(0.22, 1, 0.36, 1),
          useNativeDriver: true,
        }),
        Animated.timing(connectOpacityAnim, {
          toValue: 1,
          duration: 220,
          useNativeDriver: true,
        }),
      ]).start();
    }, 1050);

    // Phase 5: Radar wave burst (1750ms)
    setTimeout(() => {
      setPhase(5);
      const startWave = (anim: Animated.Value) => {
        return Animated.timing(anim, {
          toValue: 1,
          duration: 780,
          easing: Easing.bezier(0.2, 0, 0.8, 1),
          useNativeDriver: true,
        });
      };
      startWave(wave1).start();
      setTimeout(() => startWave(wave2).start(), 230);
      setTimeout(() => startWave(wave3).start(), 460);
    }, 1750);

    // Phase 6: Fade out and complete (2200ms -> 2480ms)
    setTimeout(() => {
      setPhase(6);
      Animated.timing(screenFadeAnim, {
        toValue: 0,
        duration: 280,
        useNativeDriver: true,
      }).start(() => {
        onComplete();
      });
    }, 2200);
  }, [xScaleAnim, xTranslateAnim, connectTranslateAnim, connectOpacityAnim, screenFadeAnim, wave1, wave2, wave3, onComplete]);

  useEffect(() => {
    runAnimation();
  }, [runAnimation]);

  const renderWave = (anim: Animated.Value) => {
    const scale = anim.interpolate({
      inputRange: [0, 1],
      outputRange: [1, 3.6],
    });
    const opacity = anim.interpolate({
      inputRange: [0, 0.2, 1],
      outputRange: [0.7, 0.6, 0],
    });

    return (
      <Animated.View
        style={[
          styles.waveCircle,
          {
            transform: [{ scale }],
            opacity,
          },
        ]}
      />
    );
  };

  return (
    <Animated.View style={[styles.container, { opacity: screenFadeAnim }]}>
      {/* Center Stage Container */}
      <View style={styles.centerStage}>
        {/* Expanding Radar Wave Burst */}
        {renderWave(wave1)}
        {renderWave(wave2)}
        {renderWave(wave3)}

        {/* X Emblem */}
        <Animated.View
          style={[
            styles.xEmblemWrapper,
            {
              transform: [
                { translateX: xTranslateAnim },
                { scale: xScaleAnim },
              ],
            },
          ]}
        >
          <View style={styles.xLogoBadge}>
            <Svg width={54} height={54} viewBox="0 0 54 54" fill="none">
              <Path
                d="M10 10L44 44M44 10L10 44"
                stroke={palette.mintPresence}
                strokeWidth={7}
                strokeLinecap="round"
              />
              <Circle
                cx={27}
                cy={27}
                r={10}
                stroke={palette.skyMesh}
                strokeWidth={1.5}
                strokeDasharray="3 2"
                opacity={0.8}
              />
            </Svg>
          </View>
        </Animated.View>

        {/* "Connect" Text */}
        <Animated.View
          style={[
            styles.connectTextWrapper,
            {
              opacity: connectOpacityAnim,
              transform: [{ translateX: connectTranslateAnim }],
            },
          ]}
        >
          <Text style={styles.connectText}>Connect</Text>
        </Animated.View>
      </View>

      {/* Tap to continue skip button */}
      <TouchableOpacity
        activeOpacity={0.7}
        onPress={onComplete}
        style={styles.skipButton}
      >
        <Text style={styles.skipText}>tap to continue</Text>
      </TouchableOpacity>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F2F2C',
    alignItems: 'center',
    justifyContent: 'center',
  },
  centerStage: {
    width: 320,
    height: 120,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  waveCircle: {
    position: 'absolute',
    width: 100,
    height: 100,
    borderRadius: 50,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.4)',
  },
  xEmblemWrapper: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 3,
  },
  xLogoBadge: {
    width: 80,
    height: 80,
    borderRadius: 22,
    backgroundColor: 'rgba(51,209,172,0.14)',
    borderWidth: 1.5,
    borderColor: 'rgba(51,209,172,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  connectTextWrapper: {
    position: 'absolute',
    zIndex: 2,
  },
  connectText: {
    fontSize: 34,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: -0.8,
  },
  skipButton: {
    position: 'absolute',
    bottom: 40,
    paddingVertical: 10,
    paddingHorizontal: 20,
  },
  skipText: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 12,
    fontWeight: '500',
  },
});
