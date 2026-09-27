import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { useTheme } from '../../theme/useTheme';
import { TopBar } from '../../components/ui/TopBar';
import { MobileScreen } from '../../components/navigation/BottomNav';

interface NotCheckedInScreenProps {
  /**
   * 'checking' — asking the server whether a still-live room exists for this device, before
   * settling on "not present" (avoids a flash of the idle state during that round trip).
   * 'scanning' — detection is actively running but hasn't confirmed a room yet.
   * 'idle' — genuinely not in a room and not looking for one.
   */
  state: 'checking' | 'scanning' | 'idle';
  onNavigate: (screen: MobileScreen) => void;
}

const COPY = {
  checking: {
    title: 'Checking your status…',
    body: 'Confirming with the server whether you still have a live room.',
  },
  scanning: {
    title: 'Looking for Your Room',
    body: "Detection is running, but no room has been verified yet. You'll be checked in once the sensors confirm which room you're in.",
  },
  idle: {
    title: 'Not Currently Present',
    body: "You're not checked into any room right now.",
  },
} as const;

export const NotCheckedInScreen: React.FC<NotCheckedInScreenProps> = ({ state, onNavigate }) => {
  const { colors } = useTheme();
  const copy = COPY[state];

  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>
      <TopBar
        title="My Activity"
        subtitle="Attendance Status"
      />

      <View style={styles.content}>
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={[styles.iconBox, { backgroundColor: colors.navBg }]}>
            <Svg width={26} height={26} viewBox="0 0 24 24" fill="none">
              <Circle cx={12} cy={12} r={9} stroke={colors.muted} strokeWidth={2} strokeDasharray="3 3" />
              <Path d="M9 9l6 6M15 9l-6 6" stroke={colors.muted} strokeWidth={2} strokeLinecap="round" />
            </Svg>
          </View>
          <Text style={[styles.title, { color: colors.txt }]}>{copy.title}</Text>
          <Text style={[styles.subtitle, { color: colors.muted }]}>{copy.body}</Text>
        </View>

        {state === 'scanning' && (
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={() => onNavigate('attendeeDiscovery')}
            style={styles.button}
          >
            <Text style={styles.buttonText}>View Detection</Text>
          </TouchableOpacity>
        )}

        {state === 'idle' && (
          <TouchableOpacity activeOpacity={0.85} onPress={() => onNavigate('home')} style={styles.button}>
            <Text style={styles.buttonText}>Find My Room</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 40,
  },
  card: {
    borderRadius: 20,
    borderWidth: 1.5,
    padding: 24,
    alignItems: 'center',
  },
  iconBox: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 16,
    fontWeight: '800',
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 19,
  },
  button: {
    backgroundColor: '#33D1AC',
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
    marginTop: 20,
  },
  buttonText: {
    color: '#0F2F2C',
    fontSize: 14,
    fontWeight: '800',
  },
});
