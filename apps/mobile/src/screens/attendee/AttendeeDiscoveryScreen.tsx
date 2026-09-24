import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
} from 'react-native';
import { useTheme } from '../../theme/useTheme';
import { palette } from '../../theme/colors';
import { TopBar } from '../../components/ui/TopBar';
import { LivingRadar } from '../../components/ui/LivingRadar';
import { SensorPill } from '../../components/ui/SensorPill';
import { MobileScreen } from '../../components/navigation/BottomNav';

interface AttendeeDiscoveryScreenProps {
  targetRoom?: string;
  detectedRoom?: string;
  acousticToken?: string;
  peerCount: number;
  wifiApCount?: number;
  ultrasonicState?: 'broadcasting' | 'listening' | 'verified' | 'idle';
  running: boolean;
  onJoinDetectedRoom: (room: string) => void;
  onNavigate: (screen: MobileScreen) => void;
}

export const AttendeeDiscoveryScreen: React.FC<AttendeeDiscoveryScreenProps> = ({
  targetRoom,
  detectedRoom,
  acousticToken,
  peerCount,
  wifiApCount = 0,
  ultrasonicState = 'listening',
  running,
  onJoinDetectedRoom,
  onNavigate,
}) => {
  const { colors, theme } = useTheme();
  const isDark = theme === 'dark';
  const hasDetected = Boolean(detectedRoom);

  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>
      <TopBar
        title="In-Room Discovery"
        subtitle="Zero-Hardware Attendance"
        onBack={() => onNavigate('home')}
        onSettings={() => onNavigate('diagnostics')}
      />

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* Radar Scanner */}
        <LivingRadar
          scanning={!hasDetected}
          participantCount={hasDetected ? 1 : 0}
          statusText={
            hasDetected
              ? `Acoustic Gate Verified · ${detectedRoom?.toUpperCase()}`
              : 'Scanning Acoustic + BLE Space...'
          }
        />

        {/* Live Hardware Telemetry Pills */}
        <View
          style={[
            styles.telemetryCard,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <Text style={[styles.cardTitle, { color: colors.sub }]}>
            LOCAL SENSOR PIPELINE
          </Text>

          <View style={styles.pillsRow}>
            <SensorPill
              label={`BLE Mesh (${peerCount} peers)`}
              status={running && peerCount > 0 ? 'active' : running ? 'warn' : 'off'}
            />
            <SensorPill
              label={
                acousticToken
                  ? `19kHz Ultrasonic (${acousticToken})`
                  : ultrasonicState === 'listening'
                  ? '19kHz Ultrasonic Mic'
                  : 'Ultrasonic Gate'
              }
              status={acousticToken || ultrasonicState === 'verified' ? 'active' : running ? 'active' : 'warn'}
            />
            <SensorPill
              label={
                wifiApCount > 0
                  ? `Wi-Fi APs (${wifiApCount} detected)`
                  : 'Wi-Fi Scanning'
              }
              status={wifiApCount > 0 ? 'active' : 'warn'}
            />
          </View>
        </View>

        {/* Dynamic Detection Card */}
        {hasDetected ? (
          <View
            style={[
              styles.detectedCard,
              {
                backgroundColor: colors.card,
                borderColor: palette.mintPresence,
              },
            ]}
          >
            <View style={styles.detectedHeader}>
              <View style={styles.roomDotActive} />
              <Text style={[styles.detectedTitle, { color: colors.txt }]}>
                {detectedRoom?.toUpperCase()} DETECTED
              </Text>
            </View>
            <Text style={[styles.detectedDesc, { color: colors.muted }]}>
              {acousticToken
                ? `High-confidence physical proximity confirmed via ultrasonic token (${acousticToken}).`
                : 'High-confidence physical proximity confirmed via multi-sensor match.'}
            </Text>

            <TouchableOpacity
              activeOpacity={0.8}
              onPress={() => {
                if (detectedRoom) {
                  onJoinDetectedRoom(detectedRoom);
                  onNavigate('attendeeConfirmed');
                }
              }}
              style={styles.joinButton}
            >
              <Text style={styles.joinButtonText}>
                Verify & Enter {detectedRoom?.toUpperCase()}
              </Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View
            style={[
              styles.detectedCard,
              {
                backgroundColor: colors.card,
                borderColor: isDark ? '#1F2E45' : '#E2E8F0',
              },
            ]}
          >
            <View style={styles.detectedHeader}>
              <View style={styles.roomDotSearching} />
              <Text style={[styles.detectedTitle, { color: colors.muted }]}>
                SEARCHING FOR IN-ROOM ANCHOR...
              </Text>
            </View>
            <Text style={[styles.detectedDesc, { color: colors.muted }]}>
              Stay in the room. The ultrasonic microphone and BLE receiver are listening for the presenter's active broadcast beacon.
            </Text>

            {targetRoom ? (
              <TouchableOpacity
                activeOpacity={0.8}
                onPress={() => {
                  onJoinDetectedRoom(targetRoom);
                  onNavigate('attendeeConfirmed');
                }}
                style={[
                  styles.joinButton,
                  {
                    backgroundColor: isDark ? '#1C293D' : '#E2E8F0',
                    shadowOpacity: 0,
                    elevation: 0,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.joinButtonText,
                    { color: isDark ? '#94A3B8' : '#475569' },
                  ]}
                >
                  Manual Join: {targetRoom.toUpperCase()}
                </Text>
              </TouchableOpacity>
            ) : null}
          </View>
        )}
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
    paddingBottom: 24,
  },
  telemetryCard: {
    padding: 16,
    borderRadius: 16,
    borderWidth: 1.5,
    marginVertical: 12,
  },
  cardTitle: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.8,
    marginBottom: 8,
  },
  pillsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  detectedCard: {
    padding: 18,
    borderRadius: 18,
    borderWidth: 1.5,
    marginTop: 6,
  },
  detectedHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  roomDotActive: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: palette.mintPresence,
    marginRight: 8,
  },
  roomDotSearching: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#F59E0B',
    marginRight: 8,
  },
  detectedTitle: {
    fontSize: 15,
    fontWeight: '800',
  },
  detectedDesc: {
    fontSize: 12,
    lineHeight: 16,
    marginBottom: 16,
  },
  joinButton: {
    backgroundColor: palette.mintPresence,
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
    shadowColor: palette.mintPresence,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 3,
  },
  joinButtonText: {
    color: '#060B12',
    fontSize: 14,
    fontWeight: '800',
  },
});

