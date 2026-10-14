import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated, Easing } from 'react-native';
import Svg, { Circle, Line } from 'react-native-svg';
import { useTheme } from '../../theme/useTheme';
import { palette } from '../../theme/colors';

export function getMemberInitials(name?: string, fallbackId?: string): string {
  if (!name || !name.trim()) {
    return fallbackId ? fallbackId.slice(-2).toUpperCase() : '??';
  }
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return parts[0].slice(0, 2).toUpperCase();
}

export interface LivingRadarMember {
  displayName?: string;
  deviceId?: string;
  ultrasonicVerified?: boolean;
}

interface LivingRadarProps {
  scanning?: boolean;
  participantCount?: number;
  members?: LivingRadarMember[];
  statusText?: string;
}

// The radar is a 240px square centered on (120, 120). Dots sit on three rings between the center
// core (24px radius) and the outer ring (105px), at fixed slots at least 28px apart for 24px
// dots, so two dots can never overlap each other, the core, or the edge.
const RADAR_SIZE = 240;
const RING_SLOTS = [
  { radius: 48, count: 10, offset: 0 },
  { radius: 76, count: 16, offset: Math.PI / 16 },
  { radius: 104, count: 22, offset: Math.PI / 22 },
];
const SLOTS = RING_SLOTS.flatMap(ring =>
  Array.from({ length: ring.count }, (_, i) => {
    const angle = ring.offset + (i / ring.count) * Math.PI * 2;
    return {
      x: ((RADAR_SIZE / 2 + Math.cos(angle) * ring.radius) / RADAR_SIZE) * 100,
      y: ((RADAR_SIZE / 2 + Math.sin(angle) * ring.radius) / RADAR_SIZE) * 100,
    };
  })
);
// Every slot. The radar is physically full at this point, and the closer it gets to full the more
// other dots shift to a neighbouring slot when one person joins (about 1.5 dots at 36 people, 3 at
// 42, 6 at 47). More than this is counted in an overflow badge instead.
const MAX_NODES = SLOTS.length;

/** 32-bit FNV-1a: a stable hash, so the same device always lands on the same spot. */
function hashString(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Gives each person a slot, as percentages of the radar. The slot starts from a hash of their
 * device id (display name when there is no id), not from their place in the list, so dots stay
 * put while people join and leave instead of every dot shuffling on each poll. Two people who
 * hash to the same slot are separated by moving the later one (in hash order) to the next free
 * slot, which is deterministic for a given set of people.
 */
function assignSlots(seeds: string[]): Map<string, { x: number; y: number }> {
  const ordered = [...new Set(seeds)]
    .map(seed => ({ seed, hash: hashString(seed) }))
    .sort((a, b) => a.hash - b.hash || (a.seed < b.seed ? -1 : 1));
  const taken = new Set<number>();
  const result = new Map<string, { x: number; y: number }>();
  for (const { seed, hash } of ordered) {
    if (taken.size >= SLOTS.length) break;
    let slot = hash % SLOTS.length;
    while (taken.has(slot)) slot = (slot + 1) % SLOTS.length;
    taken.add(slot);
    result.set(seed, SLOTS[slot]);
  }
  return result;
}

export const LivingRadar: React.FC<LivingRadarProps> = ({
  scanning = false,
  participantCount = 0,
  members,
  statusText,
}) => {
  const { colors, theme } = useTheme();
  const isDark = theme === 'dark';

  const pulse1 = useRef(new Animated.Value(0)).current;
  const pulse2 = useRef(new Animated.Value(0)).current;
  const pulse3 = useRef(new Animated.Value(0)).current;
  const spinAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const startPulse = (anim: Animated.Value, initialDelay: number) => {
      let timeoutId: any;
      let loopAnim: Animated.CompositeAnimation | null = null;

      const run = () => {
        anim.setValue(0);
        loopAnim = Animated.loop(
          Animated.sequence([
            Animated.timing(anim, {
              toValue: 1,
              duration: 2400,
              easing: Easing.out(Easing.ease),
              useNativeDriver: true,
            }),
            Animated.timing(anim, {
              toValue: 0,
              duration: 0,
              useNativeDriver: true,
            }),
          ])
        );
        loopAnim.start();
      };

      if (initialDelay > 0) {
        timeoutId = setTimeout(run, initialDelay);
      } else {
        run();
      }

      return () => {
        if (timeoutId) clearTimeout(timeoutId);
        if (loopAnim) loopAnim.stop();
      };
    };

    const stopP1 = startPulse(pulse1, 0);
    const stopP2 = startPulse(pulse2, 800);
    const stopP3 = startPulse(pulse3, 1600);

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
      stopP1();
      stopP2();
      stopP3();
      spin.stop();
    };
  }, [scanning, pulse1, pulse2, pulse3, spinAnim]);

  const spinInterpolation = spinAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  const { activeNodes, hiddenCount } = React.useMemo(() => {
    if (members && members.length > 0) {
      const visible = members.slice(0, MAX_NODES).map((m, i) => ({
        m,
        seed: m.deviceId || m.displayName || `member-${i}`,
      }));
      const slots = assignSlots(visible.map(v => v.seed));
      const shown = visible.flatMap(({ m, seed }) => {
        const position = slots.get(seed);
        if (!position) return [];
        return [
          {
            ...position,
            key: seed,
            initials: getMemberInitials(m.displayName, m.deviceId),
            // Same default as the roster cards: unverified until the server says otherwise.
            verified: m.ultrasonicVerified ?? false,
          },
        ];
      });
      return { activeNodes: shown, hiddenCount: Math.max(0, members.length - shown.length) };
    }
    // No roster to draw (the attendee view only knows a room was detected). Drawing invented
    // people would be false, so show only this device's own dot, labeled as such.
    if (participantCount && participantCount > 0) {
      return {
        activeNodes: [{ ...SLOTS[0], key: 'self', initials: 'YOU', verified: true }],
        hiddenCount: 0,
      };
    }
    return { activeNodes: [], hiddenCount: 0 };
  }, [members, participantCount]);

  const ringColor = scanning ? palette.skyMesh : palette.mintPresence;

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
          activeNodes.map(node => {
            const verifiedColor = node.verified
              ? palette.mintPresence
              : palette.skyMesh;
            return (
              <View
                key={node.key}
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

        {/* People beyond what the radar can draw */}
        {!scanning && hiddenCount > 0 && (
          <View style={[styles.overflowBadge, { backgroundColor: colors.card, borderColor: ringColor }]}>
            <Text style={[styles.overflowText, { color: ringColor }]}>+{hiddenCount}</Text>
          </View>
        )}

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
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    transform: [{ translateX: -12 }, { translateY: -12 }],
  },
  nodeText: {
    fontSize: 8,
    fontWeight: '800',
  },
  overflowBadge: {
    position: 'absolute',
    right: 4,
    bottom: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1,
  },
  overflowText: {
    fontSize: 10,
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
