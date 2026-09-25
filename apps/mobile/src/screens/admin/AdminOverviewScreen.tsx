import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
} from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import type { LiveRoomState } from '@confpresence/shared';
import { useTheme } from '../../theme/useTheme';
import { palette } from '../../theme/colors';
import { TopBar } from '../../components/ui/TopBar';
import { LiveBadge } from '../../components/ui/LiveBadge';
import { MobileScreen } from '../../components/navigation/BottomNav';

// A room's updatedAt is refreshed by any device's batch (presenter or attendee) roughly every
// 10s; twice that with slack is a reasonable "still actively reporting" cutoff before flagging
// it amber the same way the presenter-offline indicator elsewhere in the app does.
const STALE_MS = 25_000;

interface AdminOverviewScreenProps {
  rooms: LiveRoomState[];
  error: string | null;
  onSelectRoom: (room: LiveRoomState) => void;
  onNavigate: (screen: MobileScreen) => void;
}

export const AdminOverviewScreen: React.FC<AdminOverviewScreenProps> = ({
  rooms,
  error,
  onSelectRoom,
  onNavigate,
}) => {
  const { colors } = useTheme();

  const totalLiveAttendees = rooms.reduce((sum, r) => sum + (r.members?.length ?? 0), 0);

  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>
      <TopBar
        title="Multi-Room Operations"
        subtitle={`Live Monitor · ${rooms.length} Active Room${rooms.length === 1 ? '' : 's'}`}
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

          {error ? (
            <View style={[styles.emptyCard, { backgroundColor: colors.card, borderColor: palette.roseError }]}>
              <Text style={[styles.emptyText, { color: palette.roseError }]}>{error}</Text>
            </View>
          ) : rooms.length === 0 ? (
            <View style={[styles.emptyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.emptyText, { color: colors.muted }]}>
                No active rooms right now. This list updates every 5 seconds as presenters start broadcasting.
              </Text>
            </View>
          ) : (
            rooms.map(r => {
              const presenter = r.members?.find(m => m.role === 'presenter');
              const memberCount = r.members?.length ?? 0;
              const isFresh = Date.now() - new Date(r.updatedAt).getTime() < STALE_MS;
              const key = `${r.sessionId}::${r.roomId}`;
              return (
                <TouchableOpacity
                  key={key}
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
                            backgroundColor: isFresh
                              ? palette.mintPresence
                              : palette.amberWarn,
                          },
                        ]}
                      />
                      <Text style={[styles.roomName, { color: colors.txt }]}>
                        {r.roomId.toUpperCase()}
                      </Text>
                    </View>

                    <View style={styles.countBadge}>
                      <Text style={styles.countDigit}>{memberCount}</Text>
                      <Text style={styles.countLabel}>LIVE</Text>
                    </View>
                  </View>

                  <Text style={[styles.anchorText, { color: colors.muted }]}>
                    Anchor: {presenter?.displayName ?? presenter?.deviceId ?? 'Unknown'}
                  </Text>

                  <View style={styles.roomFooter}>
                    <Text style={[styles.peakText, { color: colors.sub }]}>
                      Session: {r.sessionId} {isFresh ? '' : '· possibly offline'}
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
            })
          )}
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
  emptyCard: {
    padding: 20,
    borderRadius: 16,
    borderWidth: 1.5,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
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
