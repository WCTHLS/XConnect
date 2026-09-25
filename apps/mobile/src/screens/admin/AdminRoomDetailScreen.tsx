import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
} from 'react-native';
import Svg, { Path } from 'react-native-svg';
import type { LiveRoomState, RoomMemberInfo } from '@confpresence/shared';
import { useTheme } from '../../theme/useTheme';
import { palette } from '../../theme/colors';
import { MobileScreen } from '../../components/navigation/BottomNav';

interface AdminRoomDetailScreenProps {
  room: LiveRoomState;
  /** Highest members.length observed across admin polls this session — the server doesn't
   * track a lifetime peak, so this is a real but session-scoped high, not "since room started". */
  peak: number;
  onEndRoom: () => Promise<void>;
  onNavigate: (screen: MobileScreen) => void;
}

function initialsFor(name: string): string {
  const letters = name
    .trim()
    .split(/\s+/)
    .map(w => w[0])
    .filter(Boolean);
  return letters.slice(0, 3).join('').toUpperCase() || '?';
}

function formatJoinedAndDuration(durationMs: number | undefined): { joinedAt: string; duration: string } {
  const ms = durationMs ?? 0;
  const joinedDate = new Date(Date.now() - ms);
  const joinedAt = joinedDate.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const duration = minutes > 0 ? `${minutes}m ${seconds.toString().padStart(2, '0')}s` : `${seconds}s`;
  return { joinedAt, duration };
}

export const AdminRoomDetailScreen: React.FC<AdminRoomDetailScreenProps> = ({
  room,
  peak,
  onEndRoom,
  onNavigate,
}) => {
  const { colors } = useTheme();
  const [tab, setTab] = useState<'all' | 'inRoom'>('all');

  const members = room.members ?? [];
  const presenter = members.find(m => m.role === 'presenter');
  const attendees = members.filter(m => m.role !== 'presenter');
  const roomName = room.roomId.toUpperCase();
  // "All" and "In-Room" currently show the same set — the live overview endpoint only reports
  // who's in the room right now, not history of who's left. Both tabs are wired for real so a
  // "Left" tab can be added later without a rework, not because they mean different things yet.
  const rosterOrder: RoomMemberInfo[] = presenter ? [presenter, ...attendees] : attendees;

  const handleCloseRoom = () => {
    Alert.alert(
      'End Room Session',
      `End ${roomName} now? This disconnects everyone currently in it — the presenter and all ${attendees.length} attendee${attendees.length === 1 ? '' : 's'} — and records their attendance as ended.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'End Room', style: 'destructive', onPress: () => void onEndRoom() },
      ]
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          activeOpacity={0.7}
          onPress={() => onNavigate('adminOverview')}
          style={[styles.backButton, { backgroundColor: colors.card }]}
        >
          <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
            <Path
              d="M15 18l-6-6 6-6"
              stroke={colors.sub}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </Svg>
        </TouchableOpacity>

        <View style={styles.headerTitleBlock}>
          <Text style={[styles.headerTitle, { color: colors.txt }]} numberOfLines={1}>
            {roomName}
          </Text>
          <Text style={[styles.headerSubtitle, { color: colors.muted }]} numberOfLines={1}>
            Anchor: {presenter ? (presenter.displayName || presenter.deviceId) : 'No presenter'}
          </Text>
        </View>

        <View style={styles.headerCountBlock}>
          <Text style={[styles.headerCount, { color: palette.mintPresence }]}>{members.length}</Text>
          <Text style={[styles.headerPeak, { color: colors.muted }]}>peak {peak}</Text>
        </View>
      </View>

      {/* Filter Tabs */}
      <View style={styles.tabRow}>
        <TouchableOpacity
          activeOpacity={0.8}
          onPress={() => setTab('all')}
          style={[
            styles.tabChip,
            {
              backgroundColor: tab === 'all' ? 'rgba(51,209,172,0.18)' : colors.card,
              borderColor: tab === 'all' ? palette.mintPresence : colors.border,
            },
          ]}
        >
          <Text style={[styles.tabChipText, { color: tab === 'all' ? palette.mintPresence : colors.muted }]}>
            All ({members.length})
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          activeOpacity={0.8}
          onPress={() => setTab('inRoom')}
          style={[
            styles.tabChip,
            {
              backgroundColor: tab === 'inRoom' ? 'rgba(51,209,172,0.18)' : colors.card,
              borderColor: tab === 'inRoom' ? palette.mintPresence : colors.border,
            },
          ]}
        >
          <Text style={[styles.tabChipText, { color: tab === 'inRoom' ? palette.mintPresence : colors.muted }]}>
            In-Room ({members.length})
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          activeOpacity={0.8}
          onPress={handleCloseRoom}
          style={styles.closeRoomButton}
        >
          <Text style={styles.closeRoomText}>Force Close</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {rosterOrder.length === 0 ? (
          <View style={[styles.emptyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.emptyText, { color: colors.muted }]}>
              No presenter or attendees in this room right now.
            </Text>
          </View>
        ) : (
          rosterOrder.map(m => {
            const isPresenter = m.role === 'presenter';
            const { joinedAt, duration } = formatJoinedAndDuration(m.durationMs);
            const confidencePct = typeof m.confidence === 'number' ? Math.round(m.confidence * 100) : undefined;
            return (
              <View
                key={m.deviceId}
                style={[
                  styles.memberCard,
                  isPresenter
                    ? { backgroundColor: 'rgba(51,209,172,0.10)', borderColor: palette.mintPresence }
                    : { backgroundColor: colors.card, borderColor: colors.border },
                ]}
              >
                <View style={styles.memberTopRow}>
                  <View
                    style={[
                      styles.avatar,
                      isPresenter
                        ? { backgroundColor: 'rgba(51,209,172,0.22)' }
                        : { backgroundColor: 'rgba(56,189,248,0.18)' },
                    ]}
                  >
                    <Text style={[styles.avatarText, { color: isPresenter ? palette.mintPresence : palette.skyMesh }]}>
                      {initialsFor(m.displayName || m.deviceId)}
                    </Text>
                  </View>

                  <View style={{ flex: 1 }}>
                    <Text style={[styles.memberName, { color: colors.txt }]} numberOfLines={1}>
                      {m.displayName || m.deviceId}
                    </Text>
                    <Text style={[styles.memberMeta, { color: colors.muted }]} numberOfLines={1}>
                      {m.email ? `${m.email}` : m.deviceId}
                      {isPresenter ? ' · Anchor Host' : ''}
                    </Text>
                  </View>

                  <View style={styles.activeBadge}>
                    <View style={styles.activeDot} />
                    <Text style={styles.activeBadgeText}>ACTIVE</Text>
                  </View>
                </View>

                <View style={[styles.memberDivider, { borderTopColor: colors.border }]} />

                <Text style={[styles.joinedText, { color: colors.sub }]}>
                  ← Joined {joinedAt} · {duration}
                </Text>

                <View style={styles.pillsRow}>
                  {m.ultrasonicVerified ? (
                    <View style={[styles.verifyPill, { backgroundColor: 'rgba(51,209,172,0.14)' }]}>
                      <Text style={[styles.verifyPillText, { color: palette.mintPresence }]}>
                        Acoustic Hard Gate {confidencePct ?? 99}%
                      </Text>
                    </View>
                  ) : (
                    <View style={[styles.verifyPill, { backgroundColor: 'rgba(56,189,248,0.14)' }]}>
                      <Text style={[styles.verifyPillText, { color: palette.skyMesh }]}>
                        BLE Mesh {confidencePct ?? 85}%
                      </Text>
                    </View>
                  )}
                  {m.motionAnomalyFlag ? (
                    <View style={[styles.verifyPill, { backgroundColor: 'rgba(245,158,11,0.14)' }]}>
                      <Text style={[styles.verifyPillText, { color: palette.amberWarn }]}>
                        ⚠ Inactivity Flag
                      </Text>
                    </View>
                  ) : null}
                </View>
              </View>
            );
          })
        )}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 8,
    gap: 12,
  },
  backButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitleBlock: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '800',
  },
  headerSubtitle: {
    fontSize: 12,
    marginTop: 2,
  },
  headerCountBlock: {
    alignItems: 'flex-end',
  },
  headerCount: {
    fontSize: 26,
    fontWeight: '900',
    letterSpacing: -0.5,
  },
  headerPeak: {
    fontSize: 11,
    fontWeight: '600',
    marginTop: -2,
  },
  tabRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 12,
    gap: 8,
  },
  tabChip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1.5,
  },
  tabChipText: {
    fontSize: 12,
    fontWeight: '700',
  },
  closeRoomButton: {
    marginLeft: 'auto',
    backgroundColor: 'rgba(239,68,68,0.12)',
    borderWidth: 1,
    borderColor: palette.roseError,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 999,
  },
  closeRoomText: {
    color: palette.roseError,
    fontSize: 11,
    fontWeight: '700',
  },
  content: {
    paddingHorizontal: 16,
    paddingBottom: 28,
    gap: 12,
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
  memberCard: {
    padding: 14,
    borderRadius: 16,
    borderWidth: 1.5,
  },
  memberTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize: 13,
    fontWeight: '800',
  },
  memberName: {
    fontSize: 15,
    fontWeight: '700',
  },
  memberMeta: {
    fontSize: 11,
    marginTop: 1,
  },
  activeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(51,209,172,0.16)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    gap: 5,
  },
  activeDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: palette.mintPresence,
  },
  activeBadgeText: {
    fontSize: 9,
    fontWeight: '800',
    color: palette.mintPresence,
    letterSpacing: 0.4,
  },
  memberDivider: {
    borderTopWidth: 1,
    marginVertical: 10,
  },
  joinedText: {
    fontSize: 11,
    fontWeight: '600',
    marginBottom: 10,
  },
  pillsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  verifyPill: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
  },
  verifyPillText: {
    fontSize: 11,
    fontWeight: '700',
  },
});
