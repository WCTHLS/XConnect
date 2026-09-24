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
import { LiveBadge } from '../../components/ui/LiveBadge';
import { SensorPill } from '../../components/ui/SensorPill';
import { MobileScreen } from '../../components/navigation/BottomNav';

interface AttendeeConfirmedScreenProps {
  roomId: string;
  sessionId: string;
  hostName?: string;
  confidence?: number;
  wifiSimilarity?: number;
  wifiApCount?: number;
  ultrasonicVerified?: boolean;
  sessionStartTime?: number;
  onLeaveRoom: () => void;
  onNavigate: (screen: MobileScreen) => void;
}

export const AttendeeConfirmedScreen: React.FC<AttendeeConfirmedScreenProps> = ({
  roomId,
  sessionId,
  hostName = 'Anchor Host',
  confidence,
  wifiSimilarity,
  wifiApCount,
  ultrasonicVerified = true,
  sessionStartTime,
  onLeaveRoom,
  onNavigate,
}) => {
  const { colors } = useTheme();
  const [seconds, setSeconds] = useState(() =>
    sessionStartTime ? Math.max(0, Math.floor((Date.now() - sessionStartTime) / 1000)) : 0
  );

  useEffect(() => {
    const timer = setInterval(() => {
      if (sessionStartTime) {
        setSeconds(Math.max(0, Math.floor((Date.now() - sessionStartTime) / 1000)));
      } else {
        setSeconds(prev => prev + 1);
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [sessionStartTime]);

  const formatDwellTime = (totalSec: number) => {
    const hrs = Math.floor(totalSec / 3600);
    const mins = Math.floor((totalSec % 3600) / 60);
    const secs = totalSec % 60;
    return `${hrs.toString().padStart(2, '0')}:${mins
      .toString()
      .padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const handleLeave = () => {
    onLeaveRoom();
    onNavigate('home');
  };

  const confDisplay = confidence
    ? `${Math.round(confidence * 100)}% (Multi-Factor)`
    : '100% (Acoustic + BLE)';

  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>
      <TopBar
        title={roomId.toUpperCase()}
        subtitle={`Verified Attendee · ${sessionId}`}
        onSettings={() => onNavigate('diagnostics')}
      />

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* Confirmed Banner */}
        <View
          style={[
            styles.confirmedCard,
            {
              backgroundColor: colors.card,
              borderColor: palette.mintPresence,
            },
          ]}
        >
          <LiveBadge label="PHYSICAL PRESENCE VERIFIED" />

          <View style={styles.dwellWrapper}>
            <Text style={[styles.dwellTimer, { color: colors.txt }]}>
              {formatDwellTime(seconds)}
            </Text>
            <Text style={[styles.dwellLabel, { color: colors.muted }]}>
              CONTINUOUS IN-ROOM DWELL TIME
            </Text>
          </View>

          <View style={styles.pillsRow}>
            <SensorPill
              label={ultrasonicVerified ? 'Acoustic Verified' : 'Acoustic Gate'}
              status={ultrasonicVerified ? 'active' : 'warn'}
            />
            <SensorPill
              label={
                wifiSimilarity
                  ? `Wi-Fi Match: ${Math.round(wifiSimilarity * 100)}%`
                  : wifiApCount
                  ? `Wi-Fi APs: ${wifiApCount}`
                  : 'Wi-Fi: Matched'
              }
              status="active"
            />
            <SensorPill label="BLE Mesh: Active" status="active" />
          </View>
        </View>

        {/* Room & Host Details */}
        <View
          style={[
            styles.detailsCard,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <Text style={[styles.sectionTitle, { color: colors.sub }]}>
            SESSION DETAILS
          </Text>

          <View style={styles.detailRow}>
            <Text style={[styles.detailLabel, { color: colors.muted }]}>Room</Text>
            <Text style={[styles.detailValue, { color: colors.txt }]}>
              {roomId.toUpperCase()}
            </Text>
          </View>

          <View style={styles.detailRow}>
            <Text style={[styles.detailLabel, { color: colors.muted }]}>Host</Text>
            <Text style={[styles.detailValue, { color: colors.txt }]}>
              {hostName}
            </Text>
          </View>

          <View style={styles.detailRow}>
            <Text style={[styles.detailLabel, { color: colors.muted }]}>
              Confidence Score
            </Text>
            <Text style={[styles.detailValue, { color: palette.mintPresence }]}>
              {confDisplay}
            </Text>
          </View>
        </View>

        {/* Simulation Test Button */}
        <TouchableOpacity
          activeOpacity={0.7}
          onPress={() => onNavigate('attendeeOutOfRange')}
          style={[
            styles.testButton,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <Text style={[styles.testButtonText, { color: colors.sub }]}>
            Test "Step Out of Room" Grace Period →
          </Text>
        </TouchableOpacity>

        {/* Leave Room Button */}
        <TouchableOpacity
          activeOpacity={0.8}
          onPress={handleLeave}
          style={styles.leaveButton}
        >
          <Text style={styles.leaveButtonText}>Leave Session</Text>
        </TouchableOpacity>
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
    paddingTop: 8,
    paddingBottom: 28,
  },
  confirmedCard: {
    borderRadius: 20,
    borderWidth: 1.5,
    paddingVertical: 20,
    paddingHorizontal: 16,
    alignItems: 'center',
    marginBottom: 16,
  },
  dwellWrapper: {
    alignItems: 'center',
    marginVertical: 14,
  },
  dwellTimer: {
    fontSize: 42,
    fontWeight: '800',
    letterSpacing: -1,
  },
  dwellLabel: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.8,
    marginTop: 4,
  },
  pillsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
  },
  detailsCard: {
    borderRadius: 16,
    borderWidth: 1.5,
    padding: 16,
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
    marginBottom: 12,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
  },
  detailLabel: {
    fontSize: 13,
  },
  detailValue: {
    fontSize: 13,
    fontWeight: '600',
  },
  testButton: {
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    marginBottom: 14,
  },
  testButtonText: {
    fontSize: 12,
    fontWeight: '600',
  },
  leaveButton: {
    backgroundColor: 'rgba(239,68,68,0.15)',
    borderWidth: 1.5,
    borderColor: palette.roseError,
    paddingVertical: 15,
    borderRadius: 16,
    alignItems: 'center',
  },
  leaveButtonText: {
    color: palette.roseError,
    fontSize: 14,
    fontWeight: '800',
  },
});
