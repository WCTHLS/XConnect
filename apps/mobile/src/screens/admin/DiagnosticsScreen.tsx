import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
} from 'react-native';
import { useTheme } from '../../theme/useTheme';
import { palette } from '../../theme/colors';
import { TopBar } from '../../components/ui/TopBar';
import { SensorPill } from '../../components/ui/SensorPill';
import { MobileScreen } from '../../components/navigation/BottomNav';
import { PresenceStatus } from '../../services/presenceService';
import { AppLogger, LogEntry } from '../../services/appLogger';

interface DiagnosticsScreenProps {
  status?: PresenceStatus;
  deviceId?: string;
  onNavigate: (screen: MobileScreen) => void;
}

export const DiagnosticsScreen: React.FC<DiagnosticsScreenProps> = ({
  status,
  deviceId,
  onNavigate,
}) => {
  const { colors, theme } = useTheme();
  const isDark = theme === 'dark';
  const [logs, setLogs] = useState<LogEntry[]>([]);

  useEffect(() => {
    return AppLogger.subscribe(setLogs);
  }, []);

  const peerCount = status?.peerCount ?? 0;
  const wifiApCount = status?.wifiApCount ?? 0;
  const rotatingId = status?.rotatingId || deviceId || 'Generating...';
  const ultrasonicToken = status?.ultrasonicToken || 'Listening...';
  const isRunning = status?.state === 'running';

  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>
      <TopBar
        title="Hardware Diagnostics"
        subtitle="Sensor Telemetry"
        onBack={() => onNavigate('home')}
      />

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* Bluetooth Telemetry */}
        <View
          style={[
            styles.card,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <View style={styles.cardHeader}>
            <Text style={[styles.cardTitle, { color: colors.sub }]}>
              BLE MESH & ADVERTISING
            </Text>
            <SensorPill
              label={isRunning ? 'Active' : 'Idle'}
              status={isRunning ? 'active' : 'warn'}
            />
          </View>
          <View style={styles.metricRow}>
            <Text style={[styles.label, { color: colors.muted }]}>Rotating UUID</Text>
            <Text style={[styles.valueMono, { color: colors.txt }]}>
              {rotatingId}
            </Text>
          </View>
          <View style={styles.metricRow}>
            <Text style={[styles.label, { color: colors.muted }]}>Active Peer Count</Text>
            <Text style={[styles.value, { color: palette.mintPresence }]}>
              {peerCount} peer{peerCount === 1 ? '' : 's'} in mesh
            </Text>
          </View>
        </View>

        {/* Ultrasonic Telemetry */}
        <View
          style={[
            styles.card,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <View style={styles.cardHeader}>
            <Text style={[styles.cardTitle, { color: colors.sub }]}>
              NEAR-ULTRASOUND (ACOUSTIC GATE)
            </Text>
            <SensorPill
              label={
                status?.ultrasonicState === 'verified'
                  ? 'Verified'
                  : status?.ultrasonicState === 'broadcasting'
                  ? 'Broadcasting'
                  : 'Listening (19kHz)'
              }
              status={status?.ultrasonicState ? 'active' : 'warn'}
            />
          </View>
          <View style={styles.metricRow}>
            <Text style={[styles.label, { color: colors.muted }]}>Acoustic Token</Text>
            <Text style={[styles.value, { color: palette.tealUltra }]}>
              {ultrasonicToken}
            </Text>
          </View>
          <View style={styles.metricRow}>
            <Text style={[styles.label, { color: colors.muted }]}>Sampling Window</Text>
            <Text style={[styles.value, { color: palette.mintPresence }]}>
              18.5 kHz – 19.5 kHz (Goertzel FFT)
            </Text>
          </View>
        </View>

        {/* Wi-Fi RSSI Sweeps */}
        <View
          style={[
            styles.card,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <View style={styles.cardHeader}>
            <Text style={[styles.cardTitle, { color: colors.sub }]}>
              IN-ROOM WI-FI ACCESS POINTS
            </Text>
            <SensorPill
              label={wifiApCount > 0 ? `${wifiApCount} APs` : 'Scanning'}
              status={wifiApCount > 0 ? 'active' : 'warn'}
            />
          </View>
          <View style={styles.metricRow}>
            <Text style={[styles.label, { color: colors.muted }]}>Visible Access Points</Text>
            <Text style={[styles.value, { color: palette.mintPresence }]}>
              {wifiApCount > 0 ? `${wifiApCount} APs Fingerprinted` : 'Scanning APs...'}
            </Text>
          </View>
        </View>

        {/* Live Event Stream */}
        <View
          style={[
            styles.card,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <View style={styles.cardHeader}>
            <Text style={[styles.cardTitle, { color: colors.sub }]}>
              LIVE SENSOR EVENT LOG
            </Text>
            <SensorPill label={`${logs.length} events`} status="active" />
          </View>
          {logs.slice(0, 8).map(log => (
            <View key={log.id} style={styles.logRow}>
              <Text style={[styles.logTime, { color: colors.muted }]}>[{log.timestamp}]</Text>
              <Text
                style={[
                  styles.logCategory,
                  {
                    color:
                      log.category === 'ULTRASONIC'
                        ? palette.tealUltra
                        : log.category === 'BLE'
                        ? palette.skyMesh
                        : palette.mintPresence,
                  },
                ]}
              >
                {log.category}
              </Text>
              <Text
                numberOfLines={2}
                style={[styles.logMessage, { color: colors.txt }]}
              >
                {log.message}
              </Text>
            </View>
          ))}
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
    gap: 14,
  },
  card: {
    padding: 16,
    borderRadius: 16,
    borderWidth: 1.5,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  cardTitle: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  metricRow: {
    marginBottom: 8,
  },
  label: {
    fontSize: 11,
    fontWeight: '600',
    marginBottom: 2,
  },
  value: {
    fontSize: 13,
    fontWeight: '700',
  },
  valueMono: {
    fontSize: 11,
    fontFamily: 'monospace',
  },
  apItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  apBssid: {
    fontSize: 12,
    fontWeight: '500',
  },
  apRssi: {
    fontSize: 12,
    fontWeight: '700',
  },
  logRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    paddingVertical: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(150, 150, 150, 0.2)',
  },
  logTime: {
    fontSize: 10,
    fontFamily: 'monospace',
    marginTop: 1,
  },
  logCategory: {
    fontSize: 10,
    fontWeight: '800',
    fontFamily: 'monospace',
    marginTop: 1,
  },
  logMessage: {
    flex: 1,
    fontSize: 11,
    lineHeight: 15,
  },
});

