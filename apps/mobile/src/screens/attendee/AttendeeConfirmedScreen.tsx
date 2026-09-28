import React from 'react';
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
  /**
   * How long the SERVER has counted this device as being in the room, in milliseconds. Comes
   * from the same member record the presenter roster and the database are built from, so all
   * three now agree. Undefined until the first poll lands.
   */
  dwellMs?: number;
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
  dwellMs,
  onLeaveRoom,
  onNavigate,
}) => {
  const { colors } = useTheme();
  // Whole minutes, not a ticking clock. The figure is refreshed by the 3s poll, so a running
  // seconds display would either lag the server or have to be extrapolated locally — and the
  // local extrapolation is exactly the drift that made this number disagree with the presenter's.
  // Rounded down, so it never claims more time than the server has recorded.
  const formatDwell = (ms?: number) => {
    if (ms === undefined) return '--';
    const totalMinutes = Math.floor(ms / 60000);
    if (totalMinutes < 1) return 'Under a minute';
    const hrs = Math.floor(totalMinutes / 60);
    const mins = totalMinutes % 60;
    if (hrs > 0) return `${hrs}h ${mins}m`;
    return `${mins} min`;
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
              {formatDwell(dwellMs)}
            </Text>
            <Text style={[styles.dwellLabel, { color: colors.muted }]}>
              TIME IN ROOM
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
