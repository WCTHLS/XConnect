import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
} from 'react-native';
import { RoomMemberInfo } from '@confpresence/shared';
import { useTheme } from '../../theme/useTheme';
import { palette } from '../../theme/colors';
import { TopBar } from '../../components/ui/TopBar';
import { HeroCounter } from '../../components/ui/HeroCounter';
import { LivingRadar } from '../../components/ui/LivingRadar';
import { LiveBadge } from '../../components/ui/LiveBadge';
import { SensorPill } from '../../components/ui/SensorPill';
import { ParticipantCard } from '../../components/ui/ParticipantCard';
import { MobileScreen } from '../../components/navigation/BottomNav';

interface PresenterDashboardScreenProps {
  roomId: string;
  sessionId: string;
  acousticToken: string;
  roomMembers: RoomMemberInfo[];
  running: boolean;
  onStopBroadcast: () => void;
  onNavigate: (screen: MobileScreen) => void;
}

export const PresenterDashboardScreen: React.FC<PresenterDashboardScreenProps> = ({
  roomId,
  sessionId,
  acousticToken,
  roomMembers,
  running,
  onStopBroadcast,
  onNavigate,
}) => {
  const { colors } = useTheme();

  const attendeesOnly = roomMembers.filter(m => m.role === 'attendee');
  const attendeeCount = attendeesOnly.length;
  const recentMembers = attendeesOnly.slice(0, 3);

  const formatMemberDwell = (ms?: number) => {
    if (!ms || ms <= 0) return '< 1m';
    const mins = Math.floor(ms / 60000);
    const secs = Math.floor((ms % 60000) / 1000);
    return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
  };

  const handleEndSession = () => {
    onStopBroadcast();
    onNavigate('sessionEnd');
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>
      <TopBar
        title={roomId.toUpperCase()}
        subtitle={`Session: ${sessionId}`}
        onSettings={() => onNavigate('diagnostics')}
      />

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* Headcount Card */}
        <View
          style={[
            styles.headcountCard,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <LiveBadge label="BROADCASTING IN-ROOM" />
          <View style={styles.counterWrapper}>
            <HeroCounter value={attendeeCount} />
            <Text style={[styles.headcountLabel, { color: colors.muted }]}>
              VERIFIED ATTENDEES
            </Text>
          </View>

          {/* Sensor Pills */}
          <View style={styles.pillsRow}>
            <SensorPill label="BLE Mesh" status={running ? 'active' : 'off'} />
            <SensorPill
              label={`Acoustic (${acousticToken})`}
              status={running ? 'active' : 'off'}
            />
            <SensorPill label="Wi-Fi AP" status="active" />
          </View>
        </View>

        {/* Living Radar Animation */}
        <LivingRadar
          scanning={false}
          participantCount={attendeeCount}
          statusText={`Acoustic Gate Verified · Token: ${acousticToken}`}
        />

        {/* Recent Attendees Preview */}
        <View style={styles.rosterSection}>
          <View style={styles.rosterHeader}>
            <Text style={[styles.sectionTitle, { color: colors.sub }]}>
              IN-ROOM ATTENDEES ({attendeeCount})
            </Text>
            <TouchableOpacity onPress={() => onNavigate('presenterRoster')}>
              <Text
                style={{
                  color: palette.mintPresence,
                  fontSize: 12,
                  fontWeight: '700',
                }}
              >
                View All →
              </Text>
            </TouchableOpacity>
          </View>

          {recentMembers.length === 0 ? (
            <View
              style={[
                styles.emptyCard,
                { backgroundColor: colors.card, borderColor: colors.border },
              ]}
            >
              <Text style={[styles.emptyText, { color: colors.muted }]}>
                Waiting for attendees to enter {roomId.toUpperCase()}...
              </Text>
            </View>
          ) : (
            recentMembers.map((m, idx) => (
              <ParticipantCard
                key={m.deviceId || idx}
                name={m.displayName || `Attendee ${idx + 1}`}
                role={m.role === 'presenter' ? 'Host' : 'Attendee'}
                dwell={formatMemberDwell(m.durationMs)}
                ultraVerified={m.ultrasonicVerified ?? false}
                wifiMatch={
                  m.wifiSimilarity ? `${Math.round(m.wifiSimilarity * 100)}%` : 'Active'
                }
                bleActive={true}
                motionFlag={m.motionAnomalyFlag ?? false}
              />
            ))
          )}
        </View>


        {/* End Session Button */}
        <TouchableOpacity
          activeOpacity={0.8}
          onPress={handleEndSession}
          style={styles.endButton}
        >
          <Text style={styles.endButtonText}>End Session & Generate Report</Text>
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
  headcountCard: {
    borderRadius: 20,
    borderWidth: 1.5,
    paddingVertical: 18,
    paddingHorizontal: 16,
    alignItems: 'center',
    marginBottom: 10,
  },
  counterWrapper: {
    alignItems: 'center',
    marginVertical: 4,
  },
  headcountLabel: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
    marginTop: 2,
  },
  pillsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    flexWrap: 'wrap',
    marginTop: 10,
  },
  rosterSection: {
    marginTop: 8,
    marginBottom: 20,
  },
  rosterHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  sectionTitle: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
  },
  emptyCard: {
    padding: 20,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 13,
  },
  endButton: {
    backgroundColor: 'rgba(239,68,68,0.15)',
    borderWidth: 1.5,
    borderColor: palette.roseError,
    paddingVertical: 15,
    borderRadius: 16,
    alignItems: 'center',
  },
  endButtonText: {
    color: palette.roseError,
    fontSize: 14,
    fontWeight: '800',
  },
});
