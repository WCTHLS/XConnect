import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
} from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { useTheme } from '../../theme/useTheme';
import { palette } from '../../theme/colors';
import { TopBar } from '../../components/ui/TopBar';
import { LiveBadge } from '../../components/ui/LiveBadge';
import { MobileScreen } from '../../components/navigation/BottomNav';

export interface RoomMatrixItem {
  id: string;
  name: string;
  anchor: string;
  count: number;
  peak: number;
  health: 'green' | 'amber';
  since: string;
}

const DEFAULT_MATRIX: RoomMatrixItem[] = [
  {
    id: 'room-a',
    name: 'ROOM A',
    anchor: 'Alex M. (Presenter)',
    count: 14,
    peak: 18,
    health: 'green',
    since: '09:30 AM',
  },
  {
    id: 'room-b',
    name: 'ROOM B',
    anchor: 'Sarah L. (Presenter)',
    count: 8,
    peak: 12,
    health: 'green',
    since: '10:00 AM',
  },
  {
    id: 'auditorium',
    name: 'AUDITORIUM',
    anchor: 'Keynote Host',
    count: 42,
    peak: 45,
    health: 'green',
    since: '09:00 AM',
  },
  {
    id: 'workshop-1',
    name: 'WORKSHOP 1',
    anchor: 'David K. (Presenter)',
    count: 6,
    peak: 10,
    health: 'amber',
    since: '11:15 AM',
  },
];

interface AdminOverviewScreenProps {
  onSelectRoom: (room: RoomMatrixItem) => void;
  onNavigate: (screen: MobileScreen) => void;
}

export const AdminOverviewScreen: React.FC<AdminOverviewScreenProps> = ({
  onSelectRoom,
  onNavigate,
}) => {
  const { colors } = useTheme();
  const [matrix, setMatrix] = useState<RoomMatrixItem[]>(DEFAULT_MATRIX);

  const totalLiveAttendees = matrix.reduce((sum, r) => sum + r.count, 0);

  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>
      <TopBar
        title="Multi-Room Operations"
        subtitle={`Live Monitor · ${matrix.length} Active Rooms`}
        onBack={() => onNavigate('home')}
        onSettings={() => onNavigate('diagnostics')}
      />

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* Total In-Room Count Card */}
        <View
          style={[
            styles.totalCard,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <LiveBadge label="ENTERPRISE MONITOR" />
          <View style={styles.totalRow}>
            <Text style={[styles.totalDigit, { color: palette.mintPresence }]}>
              {totalLiveAttendees}
            </Text>
            <View style={{ marginLeft: 12 }}>
              <Text style={[styles.totalTitle, { color: colors.txt }]}>
                Live In-Room Attendees
              </Text>
              <Text style={[styles.totalSub, { color: colors.muted }]}>
                Across all verified spaces
              </Text>
            </View>
          </View>
        </View>

        {/* Room Matrix Grid */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.sub }]}>
            ACTIVE ROOM MATRIX
          </Text>

          {matrix.map(r => {
            const isGreen = r.health === 'green';
            return (
              <TouchableOpacity
                key={r.id}
                activeOpacity={0.8}
                onPress={() => {
                  onSelectRoom(r);
                  onNavigate('adminRoomDetail');
                }}
                style={[
                  styles.roomCard,
                  {
                    backgroundColor: colors.card,
                    borderColor: colors.border,
                  },
                ]}
              >
                <View style={styles.roomHeader}>
                  <View style={styles.roomTitleRow}>
                    <View
                      style={[
                        styles.healthDot,
                        {
                          backgroundColor: isGreen
                            ? palette.mintPresence
                            : palette.amberWarn,
                        },
                      ]}
                    />
                    <Text style={[styles.roomName, { color: colors.txt }]}>
                      {r.name}
                    </Text>
                  </View>

                  <View style={styles.countBadge}>
                    <Text style={styles.countDigit}>{r.count}</Text>
                    <Text style={styles.countLabel}>LIVE</Text>
                  </View>
                </View>

                <Text style={[styles.anchorText, { color: colors.muted }]}>
                  Anchor: {r.anchor}
                </Text>

                <View style={styles.roomFooter}>
                  <Text style={[styles.peakText, { color: colors.sub }]}>
                    Peak: {r.peak} · Active since {r.since}
                  </Text>
                  <Text
                    style={{
                      color: palette.mintPresence,
                      fontSize: 12,
                      fontWeight: '700',
                    }}
                  >
                    Inspect →
                  </Text>
                </View>
              </TouchableOpacity>
            );
          })}
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
    paddingTop: 8,
    paddingBottom: 28,
  },
  totalCard: {
    borderRadius: 20,
    borderWidth: 1.5,
    padding: 18,
    marginBottom: 20,
  },
  totalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
  },
  totalDigit: {
    fontSize: 48,
    fontWeight: '900',
    letterSpacing: -2,
  },
  totalTitle: {
    fontSize: 16,
    fontWeight: '800',
  },
  totalSub: {
    fontSize: 12,
  },
  section: {
    gap: 12,
  },
  sectionTitle: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
    marginBottom: 4,
  },
  roomCard: {
    padding: 16,
    borderRadius: 16,
    borderWidth: 1.5,
  },
  roomHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  roomTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  healthDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  roomName: {
    fontSize: 16,
    fontWeight: '800',
  },
  countBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(51,209,172,0.15)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    gap: 4,
  },
  countDigit: {
    fontSize: 12,
    fontWeight: '800',
    color: palette.mintPresence,
  },
  countLabel: {
    fontSize: 8,
    fontWeight: '800',
    color: palette.mintPresence,
  },
  anchorText: {
    fontSize: 12,
    marginBottom: 10,
  },
  roomFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: 'rgba(226,232,240,0.1)',
    paddingTop: 8,
  },
  peakText: {
    fontSize: 11,
  },
});
