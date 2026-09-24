import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
} from 'react-native';
import { useTheme } from '../../theme/useTheme';
import { palette } from '../../theme/colors';
import { TopBar } from '../../components/ui/TopBar';
import { SensorPill } from '../../components/ui/SensorPill';
import { RoomMatrixItem } from './AdminOverviewScreen';
import { MobileScreen } from '../../components/navigation/BottomNav';

interface AdminRoomDetailScreenProps {
  room: RoomMatrixItem;
  onNavigate: (screen: MobileScreen) => void;
}

export const AdminRoomDetailScreen: React.FC<AdminRoomDetailScreenProps> = ({
  room,
  onNavigate,
}) => {
  const { colors } = useTheme();

  const handleEvictPresenter = () => {
    Alert.alert(
      'Evict Presenter',
      `Are you sure you want to evict the host from ${room.name}? This will free the room for other hosts.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Evict', style: 'destructive', onPress: () => onNavigate('adminOverview') },
      ]
    );
  };

  const handleCloseRoom = () => {
    Alert.alert(
      'Close Room Session',
      `End all active dwell sessions for ${room.name}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Close Room', style: 'destructive', onPress: () => onNavigate('adminOverview') },
      ]
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>
      <TopBar
        title={room.name}
        subtitle={`Admin Diagnostics · ${room.count} Live`}
        onBack={() => onNavigate('adminOverview')}
      />

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* Key Metrics */}
        <View style={styles.metricsRow}>
          <View
            style={[
              styles.metricBox,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <Text style={[styles.metricLabel, { color: colors.muted }]}>
              CURRENT LIVE
            </Text>
            <Text style={[styles.metricValue, { color: palette.mintPresence }]}>
              {room.count}
            </Text>
          </View>

          <View
            style={[
              styles.metricBox,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <Text style={[styles.metricLabel, { color: colors.muted }]}>
              SESSION PEAK
            </Text>
            <Text style={[styles.metricValue, { color: palette.skyMesh }]}>
              {room.peak}
            </Text>
          </View>
        </View>

        {/* Anchor Presenter Card */}
        <View
          style={[
            styles.card,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <Text style={[styles.cardTitle, { color: colors.sub }]}>
            ANCHOR PRESENTER
          </Text>

          <Text style={[styles.anchorName, { color: colors.txt }]}>
            {room.anchor}
          </Text>
          <Text style={[styles.anchorMeta, { color: colors.muted }]}>
            Active continuous broadcast since {room.since}
          </Text>

          <View style={styles.pillsRow}>
            <SensorPill label="Acoustic 19kHz Transmitting" status="active" />
            <SensorPill label="BLE Beacon Advertising" status="active" />
          </View>

          <TouchableOpacity
            activeOpacity={0.8}
            onPress={handleEvictPresenter}
            style={styles.evictButton}
          >
            <Text style={styles.evictText}>Evict Anchor Host</Text>
          </TouchableOpacity>
        </View>

        {/* Room Security Actions */}
        <View
          style={[
            styles.card,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <Text style={[styles.cardTitle, { color: colors.sub }]}>
            ROOM OPERATIONS
          </Text>

          <TouchableOpacity
            activeOpacity={0.8}
            onPress={() => onNavigate('diagnostics')}
            style={[styles.actionRow, { borderBottomColor: colors.border }]}
          >
            <Text style={[styles.actionText, { color: colors.txt }]}>
              View Live Sensor Telemetry
            </Text>
            <Text style={{ color: palette.mintPresence, fontWeight: '700' }}>
              Inspect →
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            activeOpacity={0.8}
            onPress={handleCloseRoom}
            style={styles.actionRow}
          >
            <Text style={[styles.actionText, { color: palette.roseError }]}>
              Force Close Room Session
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
  metricsRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
  },
  metricBox: {
    flex: 1,
    padding: 16,
    borderRadius: 16,
    borderWidth: 1.5,
    alignItems: 'center',
  },
  metricLabel: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.8,
    marginBottom: 4,
  },
  metricValue: {
    fontSize: 32,
    fontWeight: '900',
    letterSpacing: -1,
  },
  card: {
    padding: 16,
    borderRadius: 16,
    borderWidth: 1.5,
    marginBottom: 16,
  },
  cardTitle: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
    marginBottom: 10,
  },
  anchorName: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 2,
  },
  anchorMeta: {
    fontSize: 12,
    marginBottom: 10,
  },
  pillsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 14,
  },
  evictButton: {
    backgroundColor: 'rgba(239,68,68,0.12)',
    borderWidth: 1,
    borderColor: palette.roseError,
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: 'center',
  },
  evictText: {
    color: palette.roseError,
    fontSize: 12,
    fontWeight: '700',
  },
  actionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  actionText: {
    fontSize: 14,
    fontWeight: '600',
  },
});
