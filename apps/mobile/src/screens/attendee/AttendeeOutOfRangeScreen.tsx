import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
} from 'react-native';
import Svg, { Path, Circle } from 'react-native-svg';
import { useTheme } from '../../theme/useTheme';
import { palette } from '../../theme/colors';
import { TopBar } from '../../components/ui/TopBar';
import { MobileScreen } from '../../components/navigation/BottomNav';

interface AttendeeOutOfRangeScreenProps {
  roomId: string;
  onRejoin: () => void;
  onLeave: () => void;
  onNavigate: (screen: MobileScreen) => void;
}

export const AttendeeOutOfRangeScreen: React.FC<AttendeeOutOfRangeScreenProps> = ({
  roomId,
  onRejoin,
  onLeave,
  onNavigate,
}) => {
  const { colors } = useTheme();
  const [countdown, setCountdown] = useState(30);

  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setInterval(() => {
      setCountdown(prev => prev - 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [countdown]);

  const handleRejoin = () => {
    onRejoin();
    onNavigate('attendeeConfirmed');
  };

  const handleLeave = () => {
    onLeave();
    onNavigate('home');
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>
      <TopBar
        title="Signal Disrupted"
        subtitle={`${roomId.toUpperCase()} · Grace Period`}
        onBack={() => onNavigate('home')}
      />

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* Warning Banner */}
        <View
          style={[
            styles.warningCard,
            {
              backgroundColor: 'rgba(245,158,11,0.12)',
              borderColor: palette.amberWarn,
            },
          ]}
        >
          <View style={styles.warningIcon}>
            <Svg width={32} height={32} viewBox="0 0 24 24" fill="none">
              <Path
                d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"
                stroke={palette.amberWarn}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <Path
                d="M12 9v4M12 17h.01"
                stroke={palette.amberWarn}
                strokeWidth={2}
                strokeLinecap="round"
              />
            </Svg>
          </View>

          <Text style={[styles.warningTitle, { color: palette.amberWarn }]}>
            Out of In-Room Range
          </Text>
          <Text style={[styles.warningSubtitle, { color: colors.sub }]}>
            Acoustic token and BLE peer signal lost. Step back into {roomId.toUpperCase()} to maintain attendance.
          </Text>
        </View>

        {/* Countdown Card */}
        <View
          style={[
            styles.countdownCard,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <Text style={[styles.countdownLabel, { color: colors.muted }]}>
            GRACE PERIOD REMAINING
          </Text>
          <Text style={[styles.countdownValue, { color: palette.amberWarn }]}>
            {countdown}s
          </Text>
          <Text style={[styles.countdownSub, { color: colors.muted }]}>
            Session will auto-disconnect if signal is not restored.
          </Text>
        </View>

        {/* Actions */}
        <View style={styles.actions}>
          <TouchableOpacity
            activeOpacity={0.8}
            onPress={handleRejoin}
            style={styles.rejoinButton}
          >
            <Text style={styles.rejoinButtonText}>Restore & Rejoin Room</Text>
          </TouchableOpacity>

          <TouchableOpacity
            activeOpacity={0.8}
            onPress={handleLeave}
            style={[
              styles.leaveButton,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <Text style={[styles.leaveButtonText, { color: colors.sub }]}>
              Exit Room Now
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 28,
  },
  warningCard: {
    padding: 20,
    borderRadius: 20,
    borderWidth: 1.5,
    alignItems: 'center',
    marginBottom: 20,
  },
  warningIcon: {
    marginBottom: 12,
  },
  warningTitle: {
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: -0.3,
    marginBottom: 6,
  },
  warningSubtitle: {
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
  },
  countdownCard: {
    padding: 24,
    borderRadius: 18,
    borderWidth: 1.5,
    alignItems: 'center',
    marginBottom: 24,
  },
  countdownLabel: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
    marginBottom: 8,
  },
  countdownValue: {
    fontSize: 54,
    fontWeight: '900',
    letterSpacing: -2,
    marginBottom: 4,
  },
  countdownSub: {
    fontSize: 12,
  },
  actions: {
    gap: 12,
  },
  rejoinButton: {
    backgroundColor: palette.mintPresence,
    paddingVertical: 15,
    borderRadius: 14,
    alignItems: 'center',
    shadowColor: palette.mintPresence,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 3,
  },
  rejoinButtonText: {
    color: '#060B12',
    fontSize: 15,
    fontWeight: '800',
  },
  leaveButton: {
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1.5,
    alignItems: 'center',
  },
  leaveButtonText: {
    fontSize: 14,
    fontWeight: '700',
  },
});
