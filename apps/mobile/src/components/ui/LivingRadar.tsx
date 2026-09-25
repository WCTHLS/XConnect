import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated, Easing } from 'react-native';
import Svg, { Circle, Line } from 'react-native-svg';
import { useTheme } from '../../theme/useTheme';
import { palette } from '../../theme/colors';

interface LivingRadarProps {
  scanning?: boolean;
  participantCount?: number;
  statusText?: string;
}

const NODES = [
  { x: 42, y: 28, initials: 'AK', verified: true },
  { x: 68, y: 52, initials: 'MR', verified: true },
  { x: 30, y: 62, initials: 'JP', verified: false },
  { x: 72, y: 30, initials: 'SL', verified: true },
  { x: 22, y: 42, initials: 'BC', verified: true },
  { x: 58, y: 72, initials: 'TW', verified: true },
];

export const LivingRadar: React.FC<LivingRadarProps> = ({
  scanning = false,
  participantCount = 6,
  statusText,
}) => {
  const { colors, theme } = useTheme();
  const isDark = theme === 'dark';

  const pulse1 = useRef(new Animated.Value(0)).current;
  const pulse2 = useRef(new Animated.Value(0)).current;
  const pulse3 = useRef(new Animated.Value(0)).current;
  const spinAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const createPulseAnim = (anim: Animated.Value, delay: number) => {
      return Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(anim, {
            toValue: 1,
            duration: 2400,
            easing: Easing.out(Easing.ease),
            useNativeDriver: true,
          }),
        ])
      );
    };

    const p1 = createPulseAnim(pulse1, 0);
    const p2 = createPulseAnim(pulse2, 800);
    const p3 = createPulseAnim(pulse3, 1600);

    p1.start();
    p2.start();
    p3.start();

    const spin = Animated.loop(
      Animated.timing(spinAnim, {
        toValue: 1,
        duration: 3000,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    );
    if (scanning) {
      spin.start();
    } else {
      spin.stop();
    }

    return () => {
      p1.stop();
      p2.stop();
      p3.stop();
      spin.stop();
    };
  }, [scanning, pulse1, pulse2, pulse3, spinAnim]);

  const spinInterpolation = spinAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  const ringColor = scanning ? palette.skyMesh : palette.mintPresence;
  const activeNodes = NODES.slice(0, Math.min(participantCount, 6));

  const renderPulseRing = (anim: Animated.Value) => {
    const scale = anim.interpolate({
      inputRange: [0, 1],
      outputRange: [0.6, 1.4],
    });
    const opacity = anim.interpolate({
      inputRange: [0, 0.4, 1],
      outputRange: [0.7, 0.4, 0],
    });

    return (
      <Animated.View
        style={[
          styles.pulseRing,
          {
            borderColor: ringColor,
            transform: [{ scale }],
            opacity,
          },
        ]}
      />
    );
  };

  return (
    // Purely decorative — never interactive. pulseRing scales up to 1.4x (220px -> ~308px),
    // overflowing its own container's bounds; same class of touch-stealing bug found in
    // HomeScreen's orb rings (see HomeScreen.tsx). Guarding the whole radar preemptively.
    <View style={styles.wrapper} pointerEvents="none">
      <View style={styles.container}>
        {/* Pulsing concentric rings */}
        {renderPulseRing(pulse1)}
        {renderPulseRing(pulse2)}
        {renderPulseRing(pulse3)}

        {/* Fixed Concentric Grid Circles */}
        <Svg width={240} height={240} style={StyleSheet.absoluteFill}>
          <Circle
            cx={120}
            cy={120}
            r={105}
            stroke={isDark ? 'rgba(34,49,71,0.8)' : 'rgba(226,232,240,0.8)'}
            strokeWidth={1}
            fill="none"
          />
          <Circle
            cx={120}
            cy={120}
            r={75}
            stroke={isDark ? 'rgba(34,49,71,0.8)' : 'rgba(226,232,240,0.8)'}
            strokeWidth={1}
            fill="none"
          />
          <Circle
            cx={120}
            cy={120}
            r={45}
            stroke={isDark ? 'rgba(34,49,71,0.8)' : 'rgba(226,232,240,0.8)'}
            strokeWidth={1}
            fill="none"
          />
          {/* Crosshairs */}
          <Line
            x1={0}
            y1={120}
            x2={240}
            y2={120}
            stroke={isDark ? 'rgba(34,49,71,0.6)' : 'rgba(226,232,240,0.6)'}
            strokeWidth={1}
          />
          <Line
            x1={120}
            y1={0}
            x2={120}
            y2={240}
            stroke={isDark ? 'rgba(34,49,71,0.6)' : 'rgba(226,232,240,0.6)'}
            strokeWidth={1}
          />
        </Svg>

        {/* Rotating Scanner Sweep Line */}
        {scanning && (
          <Animated.View
            style={[
              styles.sweepContainer,
              { transform: [{ rotate: spinInterpolation }] },
            ]}
          >
            <View style={styles.sweepLine} />
          </Animated.View>
        )}

        {/* Active In-Room Participant Nodes */}
        {!scanning &&
          activeNodes.map((node, i) => {
            const verifiedColor = node.verified
              ? palette.mintPresence
              : palette.skyMesh;
            return (
              <View
                key={i}
                style={[
                  styles.node,
                  {
                    left: `${node.x}%`,
                    top: `${node.y}%`,
                    borderColor: verifiedColor,
                    backgroundColor: `${verifiedColor}25`,
                  },
                ]}
              >
                <Text style={[styles.nodeText, { color: verifiedColor }]}>
                  {node.initials}
                </Text>
              </View>
            );
          })}

        {/* Center Presence Core */}
        <View
          style={[
            styles.centerCore,
            {
              backgroundColor: scanning
                ? 'rgba(56,189,248,0.25)'
                : 'rgba(51,209,172,0.25)',
              borderColor: ringColor,
            },
          ]}
        >
          <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
            <Circle cx={12} cy={12} r={3.5} fill={ringColor} />
            <Circle
              cx={12}
              cy={12}
              r={7}
              stroke={ringColor}
              strokeWidth={1.2}
              strokeDasharray="3 2"
              opacity={0.6}
            />
          </Svg>
        </View>
      </View>

      {/* Bottom Status Pill */}
      <View
        style={[
          styles.statusPill,
          {
            backgroundColor: colors.card,
            borderColor: ringColor,
          },
        ]}
      >
        <Text style={[styles.statusPillText, { color: ringColor }]}>
          {statusText ??
            (scanning
              ? 'Scanning Ambient Space...'
              : 'Acoustic Gate Verified · 99% Confidence')}
        </Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  wrapper: {
    alignItems: 'center',
    marginVertical: 14,
  },
  container: {
    width: 240,
    height: 240,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  pulseRing: {
    position: 'absolute',
    width: 220,
    height: 220,
    borderRadius: 110,
    borderWidth: 1.5,
  },
  sweepContainer: {
    position: 'absolute',
    width: 240,
    height: 240,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sweepLine: {
    position: 'absolute',
    top: 120,
    left: 120,
    width: 105,
    height: 2,
    backgroundColor: 'rgba(56,189,248,0.85)',
    transformOrigin: '0 50%',
  },
  node: {
    position: 'absolute',
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    transform: [{ translateX: -14 }, { translateY: -14 }],
  },
  nodeText: {
    fontSize: 9,
    fontWeight: '800',
  },
  centerCore: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusPill: {
    marginTop: 10,
    paddingHorizontal: 14,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
    alignSelf: 'center',
  },
  statusPillText: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.4,
  },
});
