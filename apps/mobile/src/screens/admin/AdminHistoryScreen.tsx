import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  ActivityIndicator,
} from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { useTheme } from '../../theme/useTheme';
import { palette } from '../../theme/colors';
import { TopBar } from '../../components/ui/TopBar';
import { MobileScreen } from '../../components/navigation/BottomNav';
import { AppAlert } from '../../components/ui/AppAlert';
import {
  aggregateAttendees,
  computeOccupiedDurationMs,
  exportHistoryReport,
  formatDuration,
  formatTime,
  formatTimestamp,
  type HistoryDetail,
  type SessionOccurrence,
} from '../../services/sessionHistory';

type Attendee = ReturnType<typeof aggregateAttendees>[number];
type Room = HistoryDetail['rooms'][number];

// One flat list drives both views, so only the rows near the screen exist as native views. A
// room of 800+ attendees used to be ~20,000 views inside a ScrollView (over 20s to open); here
// each attendee is its own row. A room's header and its attendees are separate rows, drawn with
// matching borders so they still read as one card.
type ListRow =
  | { kind: 'occ'; occ: SessionOccurrence }
  | { kind: 'export' }
  | { kind: 'empty' }
  | {
      kind: 'room';
      room: Room;
      attendeeCount: number;
      earliestStart: number;
      durationMs: number;
      stillOpen: boolean;
      expanded: boolean;
      hasAttendeeRows: boolean;
    }
  | { kind: 'attendee'; roomId: string; attendee: Attendee; last: boolean };

function rowKey(row: ListRow): string {
  switch (row.kind) {
    case 'occ':
      return `occ:${row.occ.id}`;
    case 'room':
      return `room:${row.room.roomId}`;
    case 'attendee':
      return `att:${row.roomId}:${row.attendee.deviceId}`;
    default:
      return row.kind;
  }
}

interface AdminHistoryScreenProps {
  /** Lists past room occurrences. A blank code means "everything", not "nothing". */
  onSearch: (code: string) => Promise<SessionOccurrence[]>;
  onOpenOccurrence: (occurrenceId: string) => Promise<HistoryDetail>;
  onNavigate: (screen: MobileScreen) => void;
}

export const AdminHistoryScreen: React.FC<AdminHistoryScreenProps> = ({
  onSearch,
  onOpenOccurrence,
  onNavigate,
}) => {
  const { colors } = useTheme();
  const [code, setCode] = useState('');
  const [occurrences, setOccurrences] = useState<SessionOccurrence[]>([]);
  const [selected, setSelected] = useState<HistoryDetail | null>(null);
  const [expandedRooms, setExpandedRooms] = useState<Set<string>>(new Set());
  // Per-person visit breakdowns, keyed `${roomId}::${deviceId}` so the same person in two rooms
  // expands independently.
  const [expandedVisits, setExpandedVisits] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  // What the currently-listed results were actually filtered by, so the empty state can say
  // "none for this code" only when a code really was applied — not while a typed-but-unsearched
  // code sits in the box.
  const [appliedCode, setAppliedCode] = useState('');

  const runSearch = useCallback(
    async (searchCode: string) => {
      setLoading(true);
      setError(null);
      setSelected(null);
      try {
        const list = await onSearch(searchCode);
        setOccurrences(list);
        setAppliedCode(searchCode);
      } catch (err: any) {
        setError(err?.message || 'Could not load past sessions.');
        setOccurrences([]);
      } finally {
        setLoading(false);
      }
    },
    [onSearch]
  );

  // Load everything on mount so the tab opens with real content rather than an empty search box.
  useEffect(() => {
    void runSearch('');
  }, [runSearch]);

  const openOccurrence = async (occurrenceId: string) => {
    setLoading(true);
    setError(null);
    try {
      const detail = await onOpenOccurrence(occurrenceId);
      setSelected(detail);
      setExpandedRooms(new Set());
    } catch (err: any) {
      setError(err?.message || 'Could not load that session.');
    } finally {
      setLoading(false);
    }
  };

  const handleExport = async () => {
    if (!selected || exporting) return;
    setExporting(true);
    try {
      const outcome = await exportHistoryReport(selected);
      if (outcome.kind === 'savedToFolder') {
        AppAlert.alert('PDF saved', 'Saved to the folder you selected.');
      } else if (outcome.kind === 'savedToFile') {
        AppAlert.alert('Sharing unavailable', `PDF saved to ${outcome.uri}`);
      }
    } catch (err: any) {
      AppAlert.alert('Could not create PDF', err?.message || 'Unknown error');
    } finally {
      setExporting(false);
    }
  };

  // Grouped per person once per opened room, not on every re-render (the screen re-renders often).
  const attendeesByRoom = useMemo(
    () => new Map((selected?.rooms ?? []).map(room => [room.roomId, aggregateAttendees(room.members)])),
    [selected]
  );

  const toggleRoom = (roomId: string) => {
    setExpandedRooms(prev => {
      const next = new Set(prev);
      if (next.has(roomId)) next.delete(roomId);
      else next.add(roomId);
      return next;
    });
  };

  const toggleVisits = (visitKey: string) => {
    setExpandedVisits(prev => {
      const next = new Set(prev);
      if (next.has(visitKey)) next.delete(visitKey);
      else next.add(visitKey);
      return next;
    });
  };

  const rows = useMemo<ListRow[]>(() => {
    if (loading) return [];
    if (!selected) return occurrences.map(occ => ({ kind: 'occ', occ }));

    const out: ListRow[] = [{ kind: selected.rooms.length > 0 ? 'export' : 'empty' }];
    for (const room of selected.rooms) {
      const attendeeCount = new Set(
        room.members.filter(m => m.role === 'attendee').map(m => m.deviceId)
      ).size;
      let earliestStart = Infinity;
      for (const m of room.members) {
        earliestStart = Math.min(earliestStart, new Date(m.startedAt).getTime());
      }
      const { durationMs, stillOpen } = computeOccupiedDurationMs(room.members);
      const attendees = attendeesByRoom.get(room.roomId) ?? [];
      const expanded = expandedRooms.has(room.roomId);
      const hasAttendeeRows = expanded && attendees.length > 0;

      out.push({
        kind: 'room',
        room,
        attendeeCount,
        earliestStart,
        durationMs,
        stillOpen,
        expanded,
        hasAttendeeRows,
      });
      if (hasAttendeeRows) {
        attendees.forEach((attendee, i) =>
          out.push({ kind: 'attendee', roomId: room.roomId, attendee, last: i === attendees.length - 1 })
        );
      }
    }
    return out;
  }, [loading, selected, occurrences, attendeesByRoom, expandedRooms]);

  // Rows read these from the closure, so FlatList is told to redraw when they change.
  const extraData = useMemo(
    () => ({ expandedVisits, exporting, colors }),
    [expandedVisits, exporting, colors]
  );

  const renderRow = ({ item }: { item: ListRow }) => {
    switch (item.kind) {
      case 'occ': {
        const occ = item.occ;
        // hasActivity=false means the room was minted but nobody was ever recorded in it —
        // distinct from "ongoing" (has activity, still open) and "ended".
        const isOngoing = occ.hasActivity && occ.stillOpen;
        return (
          <TouchableOpacity
            activeOpacity={0.8}
            onPress={() => void openOccurrence(occ.id)}
            style={[styles.occCard, { backgroundColor: colors.card, borderColor: colors.border }]}
          >
            <View style={styles.occHeader}>
              <View style={styles.occTitleRow}>
                <View
                  style={[
                    styles.statusDot,
                    { backgroundColor: isOngoing ? palette.mintPresence : colors.muted },
                  ]}
                />
                <Text style={[styles.occTitle, { color: colors.txt }]} numberOfLines={1}>
                  {occ.rooms.length > 0 ? occ.rooms.join(', ').toUpperCase() : 'NO ROOMS'}
                </Text>
              </View>
              <Text
                style={[
                  styles.occStatus,
                  { color: isOngoing ? palette.mintPresence : colors.muted },
                ]}
              >
                {isOngoing ? 'ONGOING' : 'ENDED'}
              </Text>
            </View>

            <Text style={[styles.occCode, { color: colors.sub }]} numberOfLines={1}>
              Session: {occ.code}
            </Text>
            <Text style={[styles.occHosts, { color: colors.muted }]} numberOfLines={1}>
              Host: {occ.hosts.length > 0 ? occ.hosts.join(', ') : 'No host recorded'}
            </Text>

            <View style={[styles.occFooter, { borderTopColor: colors.border }]}>
              {occ.hasActivity ? (
                <>
                  <Text style={[styles.occMeta, { color: colors.muted }]}>
                    {occ.startedAt ? new Date(occ.startedAt).toLocaleDateString() : '--'}
                  </Text>
                  <Text style={[styles.occMeta, { color: colors.muted }]}>
                    {occ.attendeeCount} attendee{occ.attendeeCount === 1 ? '' : 's'}
                  </Text>
                  <Text style={[styles.occMeta, { color: colors.muted }]}>
                    {isOngoing ? 'Ongoing' : formatDuration(occ.durationMs)}
                  </Text>
                </>
              ) : (
                <Text style={[styles.occMeta, { color: colors.muted }]}>No room activity</Text>
              )}
              <Text style={styles.occOpen}>Open →</Text>
            </View>
          </TouchableOpacity>
        );
      }

      case 'export':
        return (
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={() => void handleExport()}
            disabled={exporting}
            style={[styles.exportBtn, exporting && styles.exportBtnDisabled]}
          >
            <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
              <Path
                d="M12 3v12m0 0l-4-4m4 4l4-4M4 19h16"
                stroke="#0F2F2C"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </Svg>
            <Text style={styles.exportBtnText}>
              {exporting ? 'Generating PDF…' : 'Download PDF Report'}
            </Text>
          </TouchableOpacity>
        );

      case 'empty':
        return (
          <View style={[styles.emptyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.emptyText, { color: colors.muted }]}>
              No recorded room activity for this session.
            </Text>
          </View>
        );

      case 'room':
        return (
          <View
            style={[
              styles.roomHeader,
              { backgroundColor: colors.card, borderColor: colors.border },
              item.hasAttendeeRows ? styles.roomHeaderOpen : styles.roomHeaderClosed,
            ]}
          >
            <TouchableOpacity activeOpacity={0.8} onPress={() => toggleRoom(item.room.roomId)}>
              <Text style={[styles.roomTitle, { color: colors.txt }]}>
                {item.room.roomId.toUpperCase()}
              </Text>
              <Text style={[styles.roomMeta, { color: colors.muted }]}>
                {formatTimestamp(item.earliestStart)}
              </Text>

              <View style={styles.roomStatsRow}>
                <View style={styles.statBlock}>
                  <Text style={[styles.statValue, { color: palette.mintPresence }]}>
                    {item.attendeeCount}
                  </Text>
                  <Text style={[styles.statLabel, { color: colors.muted }]}>ATTENDEES</Text>
                </View>
                <View style={styles.statBlock}>
                  <Text style={[styles.statValue, { color: colors.txt }]}>
                    {item.stillOpen ? 'Ongoing' : formatDuration(item.durationMs)}
                  </Text>
                  <Text style={[styles.statLabel, { color: colors.muted }]}>OCCUPIED</Text>
                </View>
              </View>

              <Text style={[styles.expandToggle, { color: palette.mintPresence }]}>
                {item.expanded ? '▲ Hide attendees' : '▼ Show attendees'}
              </Text>
            </TouchableOpacity>
          </View>
        );

      case 'attendee': {
        const a = item.attendee;
        const visitKey = `${item.roomId}::${a.deviceId}`;
        const visitsOpen = expandedVisits.has(visitKey);
        return (
          <View
            style={[
              styles.attendeeItem,
              { backgroundColor: colors.card, borderColor: colors.border },
              item.last && styles.attendeeItemLast,
            ]}
          >
            <View style={[styles.attendeeRow, { borderTopColor: colors.border }]}>
              <View style={styles.attendeeTopRow}>
                <View style={styles.attendeeLeft}>
                  <Text style={[styles.attendeeName, { color: colors.txt }]} numberOfLines={1}>
                    {a.displayName}
                  </Text>
                  {a.email ? (
                    <Text style={[styles.attendeeEmail, { color: colors.muted }]} numberOfLines={1}>
                      {a.email}
                    </Text>
                  ) : null}
                  <View style={styles.flagRow}>
                    {a.role === 'presenter' && (
                      <View style={[styles.flag, { backgroundColor: palette.skySubtle }]}>
                        <Text style={[styles.flagText, { color: palette.skyMesh }]}>HOST</Text>
                      </View>
                    )}
                    {/* How long, not just whether: flagged for four seconds and
                        flagged all session are very different findings. */}
                    {a.ultrasonicVerifiedMs === null ? (
                      <View style={[styles.flag, { backgroundColor: palette.skySubtle }]}>
                        <Text style={[styles.flagText, { color: palette.skyMesh }]}>
                          EMITTER
                        </Text>
                      </View>
                    ) : a.ultrasonicVerifiedMs > 0 ? (
                      <View style={[styles.flag, { backgroundColor: palette.mintSubtle }]}>
                        <Text style={[styles.flagText, { color: palette.mintPresence }]}>
                          VERIFIED {formatDuration(a.ultrasonicVerifiedMs)}
                        </Text>
                      </View>
                    ) : null}
                    {a.motionAnomalyMs > 0 && (
                      <View style={[styles.flag, { backgroundColor: 'rgba(245,158,11,0.15)' }]}>
                        <Text style={[styles.flagText, { color: palette.amberWarn }]}>
                          INACTIVE {formatDuration(a.motionAnomalyMs)}
                        </Text>
                      </View>
                    )}
                  </View>
                </View>

                <View style={styles.attendeeRight}>
                  <Text style={[styles.attendeeDuration, { color: colors.txt }]}>
                    {formatDuration(a.totalDurationMs)}
                  </Text>
                  {a.hasOpenStay && (
                    <View style={styles.ongoingRow}>
                      <Svg width={10} height={10} viewBox="0 0 24 24" fill="none">
                        <Circle cx={12} cy={12} r={10} fill={palette.mintPresence} />
                      </Svg>
                      <Text style={[styles.ongoingText, { color: palette.mintPresence }]}>
                        ongoing
                      </Text>
                    </View>
                  )}
                </View>
              </View>

              {/* First/last and the average sit on the summary row; the individual
                  visits behind them are a tap away, since most people have one. */}
              <View style={styles.attendeeFactsRow}>
                <View style={styles.attendeeFact}>
                  <Text style={[styles.attendeeFactLabel, { color: colors.muted }]}>JOINED</Text>
                  <Text style={[styles.attendeeFactValue, { color: colors.txt }]}>
                    {formatTime(a.firstStartedAt)}
                  </Text>
                </View>
                <View style={styles.attendeeFact}>
                  <Text style={[styles.attendeeFactLabel, { color: colors.muted }]}>LEFT</Text>
                  <Text
                    style={[
                      styles.attendeeFactValue,
                      { color: a.hasOpenStay ? palette.mintPresence : colors.txt },
                    ]}
                  >
                    {a.hasOpenStay ? 'In room' : formatTime(a.lastEndedAt)}
                  </Text>
                </View>
                <View style={styles.attendeeFact}>
                  <Text style={[styles.attendeeFactLabel, { color: colors.muted }]}>AVG SCORE</Text>
                  <Text style={[styles.attendeeFactValue, { color: colors.txt }]}>
                    {a.avgConfidence === undefined
                      ? '--'
                      : `${Math.round(a.avgConfidence * 100)}%`}
                  </Text>
                </View>
              </View>

              <TouchableOpacity activeOpacity={0.7} onPress={() => toggleVisits(visitKey)}>
                <Text style={[styles.visitsToggle, { color: palette.mintPresence }]}>
                  {visitsOpen ? '▲ Hide' : '▼ Show'} {a.stays.length} visit
                  {a.stays.length === 1 ? '' : 's'}
                </Text>
              </TouchableOpacity>

              {visitsOpen && (
                <View style={[styles.visitsBox, { borderColor: colors.border }]}>
                  {a.stays.map((s, i) => (
                    <View
                      key={`${s.startedAt}-${i}`}
                      style={[
                        styles.visitRow,
                        i > 0 && { borderTopWidth: 1, borderTopColor: colors.border },
                      ]}
                    >
                      <Text style={[styles.visitIndex, { color: colors.muted }]}>{i + 1}</Text>
                      <Text style={[styles.visitTime, { color: colors.txt }]}>
                        {formatTime(s.startedAt)}
                        <Text style={{ color: colors.muted }}> → </Text>
                        {s.endedAt ? (
                          formatTime(s.endedAt)
                        ) : (
                          <Text style={{ color: palette.mintPresence }}>still in room</Text>
                        )}
                      </Text>
                      <Text style={[styles.visitDuration, { color: colors.sub }]}>
                        {s.endedAt ? formatDuration(s.durationMs) : '--'}
                      </Text>
                      <Text style={[styles.visitScore, { color: colors.muted }]}>
                        {s.score === undefined ? '--' : `${Math.round(s.score * 100)}%`}
                      </Text>
                    </View>
                  ))}
                  {(a.ultrasonicVerifiedMs !== null || a.motionAnomalyMs > 0) && (
                    <View style={[styles.visitFooter, { borderTopColor: colors.border }]}>
                      {a.ultrasonicVerifiedMs !== null && (
                        <Text style={[styles.visitFooterText, { color: colors.muted }]}>
                          Verified{' '}
                          <Text style={{ color: palette.mintPresence, fontWeight: '700' }}>
                            {a.ultrasonicVerifiedMs > 0
                              ? formatDuration(a.ultrasonicVerifiedMs)
                              : 'never'}
                          </Text>
                        </Text>
                      )}
                      {a.motionAnomalyMs > 0 && (
                        <Text style={[styles.visitFooterText, { color: colors.muted }]}>
                          Inactive{' '}
                          <Text style={{ color: palette.amberWarn, fontWeight: '700' }}>
                            {formatDuration(a.motionAnomalyMs)}
                          </Text>
                        </Text>
                      )}
                    </View>
                  )}
                </View>
              )}
            </View>
          </View>
        );
      }
    }
  };

  const emptyState = loading ? (
    <View style={styles.loadingWrap}>
      <ActivityIndicator color={palette.mintPresence} />
    </View>
  ) : !selected && !error ? (
    <View style={[styles.emptyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <Text style={[styles.emptyText, { color: colors.muted }]}>
        {appliedCode
          ? `No past rooms recorded under "${appliedCode}".`
          : 'No rooms have been recorded yet. Sessions appear here once a room has had someone in it.'}
      </Text>
    </View>
  ) : null;

  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>
      <TopBar
        title="Session History"
        subtitle={
          selected
            ? selected.code
            : `${occurrences.length} past room${occurrences.length === 1 ? '' : 's'}`
        }
        onBack={() => (selected ? setSelected(null) : onNavigate('adminOverview'))}
      />

      {!selected && (
        <View style={styles.searchRow}>
          <TextInput
            style={[
              styles.searchInput,
              { backgroundColor: colors.card, borderColor: colors.border, color: colors.txt },
            ]}
            value={code}
            onChangeText={setCode}
            placeholder="Filter by session code"
            placeholderTextColor={colors.muted}
            autoCapitalize="none"
            returnKeyType="search"
            onSubmitEditing={() => void runSearch(code.trim())}
          />
          <TouchableOpacity
            activeOpacity={0.85}
            style={styles.searchBtn}
            onPress={() => void runSearch(code.trim())}
          >
            <Text style={styles.searchBtnText}>Search</Text>
          </TouchableOpacity>
        </View>
      )}

      {error && (
        <View style={[styles.errorBanner, { borderColor: palette.roseError }]}>
          <Text style={[styles.errorText, { color: palette.roseError }]}>{error}</Text>
        </View>
      )}

      <FlatList
        data={rows}
        keyExtractor={rowKey}
        renderItem={renderRow}
        extraData={extraData}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        initialNumToRender={12}
        maxToRenderPerBatch={12}
        windowSize={5}
        removeClippedSubviews
        ListEmptyComponent={emptyState}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  searchRow: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    paddingBottom: 12,
    gap: 8,
  },
  searchInput: {
    flex: 1,
    borderWidth: 1.5,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
  },
  searchBtn: {
    backgroundColor: palette.mintPresence,
    paddingHorizontal: 18,
    justifyContent: 'center',
    borderRadius: 12,
  },
  searchBtnText: {
    color: '#0F2F2C',
    fontSize: 13,
    fontWeight: '800',
  },
  errorBanner: {
    marginHorizontal: 20,
    marginBottom: 12,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1.5,
  },
  errorText: {
    fontSize: 12,
    lineHeight: 18,
  },
  // Rows space themselves with a bottom margin: `gap` is unreliable between virtualized cells.
  content: {
    paddingHorizontal: 20,
    paddingBottom: 28,
  },
  loadingWrap: {
    paddingVertical: 32,
  },
  emptyCard: {
    padding: 20,
    borderRadius: 16,
    borderWidth: 1.5,
    alignItems: 'center',
    marginBottom: 12,
  },
  emptyText: {
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
  },
  occCard: {
    padding: 16,
    borderRadius: 16,
    borderWidth: 1.5,
    marginBottom: 12,
  },
  occHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  occTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  occTitle: {
    fontSize: 15,
    fontWeight: '800',
    flexShrink: 1,
  },
  occStatus: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  occCode: {
    fontSize: 12,
    marginBottom: 2,
  },
  occHosts: {
    fontSize: 12,
    marginBottom: 10,
  },
  occFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    paddingTop: 8,
    gap: 8,
  },
  occMeta: {
    fontSize: 11,
  },
  occOpen: {
    fontSize: 12,
    fontWeight: '700',
    color: palette.mintPresence,
  },
  exportBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: palette.mintPresence,
    paddingVertical: 13,
    borderRadius: 14,
    marginBottom: 12,
  },
  exportBtnDisabled: {
    opacity: 0.6,
  },
  exportBtnText: {
    color: '#0F2F2C',
    fontSize: 14,
    fontWeight: '800',
  },
  // A room card is drawn as several rows: this header, then one row per attendee. The header
  // loses its bottom edge when attendees follow, and the last attendee row closes the card.
  roomHeader: {
    padding: 16,
    borderRadius: 16,
    borderWidth: 1.5,
  },
  roomHeaderOpen: {
    borderBottomWidth: 0,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
  },
  roomHeaderClosed: {
    marginBottom: 12,
  },
  attendeeItem: {
    borderLeftWidth: 1.5,
    borderRightWidth: 1.5,
    paddingHorizontal: 16,
  },
  attendeeItemLast: {
    borderBottomWidth: 1.5,
    borderBottomLeftRadius: 16,
    borderBottomRightRadius: 16,
    paddingBottom: 16,
    marginBottom: 12,
  },
  roomTitle: {
    fontSize: 16,
    fontWeight: '800',
  },
  roomMeta: {
    fontSize: 11,
    marginTop: 2,
  },
  roomStatsRow: {
    flexDirection: 'row',
    gap: 28,
    marginTop: 12,
  },
  statBlock: {
    gap: 2,
  },
  statValue: {
    fontSize: 20,
    fontWeight: '900',
    letterSpacing: -0.5,
  },
  statLabel: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  expandToggle: {
    fontSize: 12,
    fontWeight: '700',
    marginTop: 12,
  },
  attendeeRow: {
    borderTopWidth: 1,
    paddingTop: 10,
    marginTop: 10,
  },
  attendeeTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  attendeeLeft: {
    flex: 1,
  },
  attendeeFactsRow: {
    flexDirection: 'row',
    marginTop: 10,
    gap: 16,
  },
  attendeeFact: {
    flex: 1,
  },
  attendeeFactLabel: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  attendeeFactValue: {
    fontSize: 13,
    fontWeight: '700',
    marginTop: 2,
  },
  visitsToggle: {
    fontSize: 11,
    fontWeight: '700',
    marginTop: 10,
  },
  visitsBox: {
    borderWidth: 1,
    borderRadius: 10,
    marginTop: 8,
    paddingHorizontal: 10,
  },
  visitRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
  },
  visitIndex: {
    fontSize: 10,
    fontWeight: '700',
    width: 14,
  },
  visitTime: {
    flex: 1,
    fontSize: 12,
    fontWeight: '600',
  },
  visitDuration: {
    fontSize: 11,
    fontWeight: '700',
  },
  visitScore: {
    fontSize: 11,
    width: 38,
    textAlign: 'right',
  },
  visitFooter: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 14,
    borderTopWidth: 1,
    paddingVertical: 8,
  },
  visitFooterText: {
    fontSize: 11,
  },
  attendeeName: {
    fontSize: 14,
    fontWeight: '700',
  },
  attendeeEmail: {
    fontSize: 11,
    marginTop: 1,
  },
  flagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 6,
  },
  flag: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 999,
  },
  flagText: {
    fontSize: 8,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  attendeeRight: {
    alignItems: 'flex-end',
  },
  attendeeDuration: {
    fontSize: 13,
    fontWeight: '800',
  },
  ongoingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 2,
  },
  ongoingText: {
    fontSize: 10,
    fontWeight: '700',
  },
});
