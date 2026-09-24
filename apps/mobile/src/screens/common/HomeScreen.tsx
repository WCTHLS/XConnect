import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Animated,
  Easing,
} from 'react-native';
import Svg, { Path, Circle, Rect } from 'react-native-svg';
import { useTheme } from '../../theme/useTheme';
import { palette } from '../../theme/colors';
import { MobileScreen, Role } from '../../components/navigation/BottomNav';

interface HomeScreenProps {
  displayName: string;
  role: Role;
  onSelectRole: (role: Role) => void;
  onNavigate: (screen: MobileScreen) => void;
  serverConnected: boolean | null;
  serverEnv: 'cloud' | 'local' | 'custom';
  rooms: string[];
  selectedRoom: string;
  onSelectRoom: (room: string) => void;
  onStartPresence: () => void;
}

export const HomeScreen: React.FC<HomeScreenProps> = ({
  displayName,
  role,
  onSelectRole,
  onNavigate,
  serverConnected,
  serverEnv,
  rooms,
  selectedRoom,
  onSelectRoom,
  onStartPresence,
}) => {
  const { colors, theme } = useTheme();
  const isDark = theme === 'dark';

  // Orb animations
  const orbScale = useRef(new Animated.Value(1)).current;
  const ring1 = useRef(new Animated.Value(0)).current;
  const ring2 = useRef(new Animated.Value(0)).current;

  // Mini radar pulse in quad-sensor box
  const miniPulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Pulse orb
    const pulseAnim = Animated.loop(
      Animated.sequence([
        Animated.timing(orbScale, {
          toValue: 1.06,
          duration: 1400,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(orbScale, {
          toValue: 1,
          duration: 1400,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    );
    pulseAnim.start();

    // Orb ring waves
    const createRing = (anim: Animated.Value, delay: number) => {
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

    const r1 = createRing(ring1, 0);
    const r2 = createRing(ring2, 800);
    r1.start();
    r2.start();

    // Mini radar
    const mini = Animated.loop(
      Animated.timing(miniPulse, {
        toValue: 1,
        duration: 2000,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      })
    );
    mini.start();

    return () => {
      pulseAnim.stop();
      r1.stop();
      r2.stop();
      mini.stop();
    };
  }, [orbScale, ring1, ring2, miniPulse]);

  const renderOrbRing = (anim: Animated.Value) => {
    const scale = anim.interpolate({
      inputRange: [0, 1],
      outputRange: [1, 1.7],
    });
    const opacity = anim.interpolate({
      inputRange: [0, 0.4, 1],
      outputRange: [0.45, 0.25, 0],
    });

    return (
      <Animated.View
        style={[
          styles.orbRing,
          {
            transform: [{ scale }],
            opacity,
          },
        ]}
      />
    );
  };

  const miniScale = miniPulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.8, 1.6],
  });
  const miniOpacity = miniPulse.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [0.6, 0.3, 0],
  });

  const attendeeHistory = [
    { room: 'Hall A', date: 'Sep 11', dwell: '38m', status: 'Verified' },
    { room: 'Workshop 1', date: 'Sep 10', dwell: '52m', status: 'Verified' },
    { room: 'Auditorium', date: 'Sep 9', dwell: '1h 14m', status: 'Verified' },
    { room: 'Hall A', date: 'Sep 8', dwell: '29m', status: 'Verified' },
  ];

  const presenterHistory = [
    { room: 'Hall A', date: 'Sep 11', dwell: '38m', count: 24 },
    { room: 'Workshop 1', date: 'Sep 10', dwell: '52m', count: 12 },
    { room: 'Auditorium', date: 'Sep 9', dwell: '1h 14m', count: 85 },
    { room: 'Hall A', date: 'Sep 8', dwell: '29m', count: 19 },
  ];

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.surf }]}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      {/* Top Bar — XConnect branding + Live Connected badge */}
      <View style={styles.topBar}>
        <View style={styles.brandRow}>
          <View style={styles.miniLogoBadge}>
            <Text style={styles.miniLogoX}>X</Text>
          </View>
          <Text style={[styles.brandTitle, { color: isDark ? '#FFFFFF' : '#0F2F2C' }]}>
            XConnect
          </Text>
        </View>

        <View style={styles.connectedBadge}>
          <View style={styles.liveGreenDot} />
          <Text style={styles.connectedText}>
            {serverConnected === false ? 'OFFLINE' : 'CONNECTED'}
          </Text>
        </View>
      </View>

      {/* Role Switcher Tabs */}
      <View style={[styles.roleTabContainer, { backgroundColor: isDark ? '#131C2E' : '#F1F5F9' }]}>
        {(['attendee', 'presenter', 'admin'] as const).map(r => (
          <TouchableOpacity
            key={r}
            onPress={() => onSelectRole(r)}
            style={[
              styles.roleTabButton,
              role === r && {
                backgroundColor: colors.card,
                shadowColor: '#000',
                shadowOffset: { width: 0, height: 1 },
                shadowOpacity: 0.1,
                shadowRadius: 2,
                elevation: 2,
              },
            ]}
          >
            <Text
              style={[
                styles.roleTabText,
                {
                  color: role === r ? palette.mintPresence : colors.muted,
                  fontWeight: role === r ? '800' : '600',
                },
              ]}
            >
              {r === 'attendee' ? 'Attendee' : r === 'presenter' ? 'Presenter' : 'Admin'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Presence Core Orb */}
      <View style={styles.orbSection}>
        <View style={styles.orbContainer}>
          {renderOrbRing(ring1)}
          {renderOrbRing(ring2)}

          <Animated.View
            style={[
              styles.centerOrb,
              {
                transform: [{ scale: orbScale }],
              },
            ]}
          >
            <Svg width={44} height={44} viewBox="0 0 44 44" fill="none">
              <Path
                d="M8 8L36 36M36 8L8 36"
                stroke={palette.mintPresence}
                strokeWidth={5}
                strokeLinecap="round"
              />
              <Circle
                cx={22}
                cy={22}
                r={8}
                stroke={palette.skyMesh}
                strokeWidth={1.2}
                strokeDasharray="3 2"
                opacity={0.7}
              />
            </Svg>
          </Animated.View>
        </View>

        <Text style={styles.orbStatusText}>Space Ready · 18ms</Text>
      </View>

      {/* Role Action Card */}
      <View style={styles.actionCardSection}>
        {role === 'attendee' && (
          <View
            style={[
              styles.actionCard,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
              },
            ]}
          >
            <View style={styles.cardHeaderRow}>
              <View style={styles.radarIconBox}>
                <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
                  <Circle cx={12} cy={12} r={3} fill="#0284C7" />
                  <Circle
                    cx={12}
                    cy={12}
                    r={7}
                    stroke="#0284C7"
                    strokeWidth={1.5}
                    strokeDasharray="3 2"
                    opacity={0.7}
                  />
                  <Circle
                    cx={12}
                    cy={12}
                    r={11}
                    stroke="#38BDF8"
                    strokeWidth={1}
                    strokeDasharray="2 3"
                    opacity={0.4}
                  />
                </Svg>
              </View>
              <View>
                <Text style={[styles.actionCardTitle, { color: colors.txt }]}>
                  Find My Room
                </Text>
                <Text style={[styles.actionCardSub, { color: colors.muted }]}>
                  Zero-touch automatic detection
                </Text>
              </View>
            </View>

            {/* Quad-Sensor Active Box */}
            <View style={[styles.quadSensorBox, { backgroundColor: isDark ? '#162338' : '#F0F9FF' }]}>
              <View style={styles.miniRadarWrapper}>
                <Animated.View
                  style={[
                    styles.miniRadarPulse,
                    {
                      transform: [{ scale: miniScale }],
                      opacity: miniOpacity,
                    },
                  ]}
                />
                <View style={styles.miniRadarCore}>
                  <View style={styles.miniRadarDot} />
                </View>
              </View>
              <View>
                <Text style={styles.quadTitle}>Quad-sensor active</Text>
                <Text style={[styles.quadSub, { color: colors.muted }]}>
                  BLE · Ultrasonic · Wi-Fi · IMU
                </Text>
              </View>
            </View>

            <TouchableOpacity
              activeOpacity={0.85}
              onPress={() => {
                onStartPresence();
                onNavigate('attendeeDiscovery');
              }}
              style={styles.primaryActionButton}
            >
              <Text style={styles.primaryActionText}>Begin Detection</Text>
            </TouchableOpacity>
          </View>
        )}

        {role === 'presenter' && (
          <View
            style={[
              styles.actionCard,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
              },
            ]}
          >
            <View style={styles.cardHeaderRow}>
              <View
                style={[
                  styles.radarIconBox,
                  {
                    backgroundColor: 'rgba(51,209,172,0.12)',
                    borderColor: 'rgba(51,209,172,0.3)',
                  },
                ]}
              >
                <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
                  <Circle cx={12} cy={8} r={4} stroke="#33D1AC" strokeWidth={2} />
                  <Path
                    d="M4 20c0-4 3.6-7 8-7s8 3 8 7"
                    stroke="#33D1AC"
                    strokeWidth={2}
                    strokeLinecap="round"
                  />
                  <Path
                    d="M19 8l2 2-2 2"
                    stroke="#33D1AC"
                    strokeWidth={2}
                    strokeLinecap="round"
                  />
                </Svg>
              </View>
              <View>
                <Text style={[styles.actionCardTitle, { color: colors.txt }]}>
                  Host / Anchor Room
                </Text>
                <Text style={[styles.actionCardSub, { color: colors.muted }]}>
                  Broadcast presence gate
                </Text>
              </View>
            </View>

            {/* Room selector chips */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.roomChipsScroll}
            >
              {rooms.map(r => (
                <TouchableOpacity
                  key={r}
                  onPress={() => onSelectRoom(r)}
                  style={[
                    styles.roomChip,
                    {
                      backgroundColor:
                        selectedRoom === r
                          ? 'rgba(51,209,172,0.15)'
                          : isDark
                          ? '#1A2638'
                          : '#F1F5F9',
                      borderColor:
                        selectedRoom === r
                          ? palette.mintPresence
                          : colors.border,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.roomChipText,
                      {
                        color:
                          selectedRoom === r
                            ? palette.mintPresence
                            : colors.sub,
                      },
                    ]}
                  >
                    {r.toUpperCase()}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            <TouchableOpacity
              activeOpacity={0.85}
              onPress={() => onNavigate('presenterSetup')}
              style={styles.primaryActionButton}
            >
              <Text style={styles.primaryActionText}>Start Broadcasting</Text>
            </TouchableOpacity>
          </View>
        )}

        {role === 'admin' && (
          <View
            style={[
              styles.actionCard,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
              },
            ]}
          >
            <View style={styles.cardHeaderRow}>
              <View
                style={[
                  styles.radarIconBox,
                  {
                    backgroundColor: 'rgba(245,158,11,0.12)',
                    borderColor: 'rgba(245,158,11,0.3)',
                  },
                ]}
              >
                <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
                  <Rect
                    x={3}
                    y={3}
                    width={8}
                    height={8}
                    rx={2}
                    stroke={palette.amberWarn}
                    strokeWidth={2}
                  />
                  <Rect
                    x={13}
                    y={3}
                    width={8}
                    height={8}
                    rx={2}
                    stroke={palette.amberWarn}
                    strokeWidth={2}
                  />
                  <Rect
                    x={3}
                    y={13}
                    width={8}
                    height={8}
                    rx={2}
                    stroke={palette.amberWarn}
                    strokeWidth={2}
                  />
                  <Rect
                    x={13}
                    y={13}
                    width={8}
                    height={8}
                    rx={2}
                    stroke={palette.amberWarn}
                    strokeWidth={2}
                  />
                </Svg>
              </View>
              <View>
                <Text style={[styles.actionCardTitle, { color: colors.txt }]}>
                  Admin Multi-Room Matrix
                </Text>
                <Text style={[styles.actionCardSub, { color: colors.muted }]}>
                  Live enterprise presence overview
                </Text>
              </View>
            </View>

            <TouchableOpacity
              activeOpacity={0.85}
              onPress={() => onNavigate('adminOverview')}
              style={styles.primaryActionButton}
            >
              <Text style={styles.primaryActionText}>Open Admin Matrix</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      {/* Recent Sessions Carousel */}
      <View style={styles.recentSection}>
        <Text style={[styles.recentTitle, { color: colors.sub }]}>
          RECENT SESSIONS
        </Text>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.recentScroll}
        >
          {(role === 'presenter' ? presenterHistory : attendeeHistory).map(
            (s: any, i) => (
              <View
                key={i}
                style={[
                  styles.recentCard,
                  {
                    backgroundColor: colors.card,
                    borderColor: colors.border,
                  },
                ]}
              >
                <View style={styles.recentIconBox}>
                  <Svg width={13} height={13} viewBox="0 0 24 24" fill="none">
                    <Rect
                      x={3}
                      y={9}
                      width={18}
                      height={13}
                      rx={2}
                      stroke={palette.mintPresence}
                      strokeWidth={2}
                    />
                    <Path
                      d="M3 9l9-7 9 7"
                      stroke={palette.mintPresence}
                      strokeWidth={2}
                      strokeLinecap="round"
                    />
                  </Svg>
                </View>

                <Text style={[styles.recentRoomName, { color: colors.txt }]} numberOfLines={1}>
                  {s.room}
                </Text>
                <Text style={[styles.recentDate, { color: colors.muted }]}>
                  {s.date}
                </Text>

                <View style={styles.recentBottomRow}>
                  <Text style={styles.recentDwell}>{s.dwell}</Text>
                  <Text style={styles.recentCheck}>
                    {s.count ? `${s.count}✓` : '✓'}
                  </Text>
                </View>
              </View>
            )
          )}
        </ScrollView>
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    paddingBottom: 28,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 10,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  miniLogoBadge: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: palette.mintPresence,
    alignItems: 'center',
    justifyContent: 'center',
  },
  miniLogoX: {
    fontSize: 18,
    fontWeight: '900',
    color: '#060B12',
  },
  brandTitle: {
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  connectedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(51,209,172,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(51,209,172,0.25)',
  },
  liveGreenDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: palette.mintPresence,
  },
  connectedText: {
    fontSize: 11,
    fontWeight: '800',
    color: palette.mintPresence,
    letterSpacing: 0.5,
  },
  roleTabContainer: {
    flexDirection: 'row',
    marginHorizontal: 20,
    marginTop: 6,
    marginBottom: 10,
    padding: 3,
    borderRadius: 12,
  },
  roleTabButton: {
    flex: 1,
    paddingVertical: 7,
    alignItems: 'center',
    borderRadius: 9,
  },
  roleTabText: {
    fontSize: 12,
  },
  orbSection: {
    alignItems: 'center',
    paddingVertical: 14,
  },
  orbContainer: {
    width: 130,
    height: 130,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  orbRing: {
    position: 'absolute',
    width: 130,
    height: 130,
    borderRadius: 65,
    borderWidth: 1.5,
    borderColor: 'rgba(51,209,172,0.3)',
  },
  centerOrb: {
    width: 90,
    height: 90,
    borderRadius: 45,
    backgroundColor: 'rgba(51,209,172,0.12)',
    borderWidth: 2,
    borderColor: 'rgba(51,209,172,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: palette.mintPresence,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.3,
    shadowRadius: 15,
    elevation: 4,
  },
  orbStatusText: {
    marginTop: 10,
    fontSize: 12,
    fontWeight: '700',
    color: palette.mintPresence,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  actionCardSection: {
    paddingHorizontal: 20,
    marginTop: 4,
  },
  actionCard: {
    borderRadius: 20,
    borderWidth: 1,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 12,
  },
  radarIconBox: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: 'rgba(2,132,199,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(2,132,199,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionCardTitle: {
    fontSize: 15,
    fontWeight: '700',
  },
  actionCardSub: {
    fontSize: 11,
    marginTop: 1,
  },
  quadSensorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 14,
    gap: 10,
    marginBottom: 14,
  },
  miniRadarWrapper: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  miniRadarPulse: {
    position: 'absolute',
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(56,189,248,0.6)',
  },
  miniRadarCore: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(56,189,248,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  miniRadarDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: palette.skyMesh,
  },
  quadTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: '#0284C7',
  },
  quadSub: {
    fontSize: 11,
    marginTop: 1,
  },
  roomChipsScroll: {
    flexDirection: 'row',
    gap: 8,
    paddingBottom: 12,
  },
  roomChip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1.5,
  },
  roomChipText: {
    fontSize: 11,
    fontWeight: '700',
  },
  primaryActionButton: {
    backgroundColor: palette.mintPresence,
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
    shadowColor: palette.mintPresence,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 3,
  },
  primaryActionText: {
    color: '#0F2F2C',
    fontSize: 14,
    fontWeight: '800',
  },
  recentSection: {
    marginTop: 18,
    paddingHorizontal: 20,
  },
  recentTitle: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
    marginBottom: 10,
  },
  recentScroll: {
    gap: 10,
    paddingBottom: 6,
  },
  recentCard: {
    width: 130,
    borderRadius: 16,
    borderWidth: 1,
    padding: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  recentIconBox: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: 'rgba(51,209,172,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(51,209,172,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  recentRoomName: {
    fontSize: 13,
    fontWeight: '700',
  },
  recentDate: {
    fontSize: 10,
    marginTop: 1,
  },
  recentBottomRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 10,
  },
  recentDwell: {
    fontSize: 11,
    fontWeight: '700',
    color: palette.mintPresence,
  },
  recentCheck: {
    fontSize: 10,
    fontWeight: '800',
    color: palette.mintPresence,
  },
});
