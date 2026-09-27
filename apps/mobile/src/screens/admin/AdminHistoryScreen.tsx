import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
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
  formatTimestamp,
  type HistoryDetail,
  type SessionOccurrence,
} from '../../services/sessionHistory';

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

  const toggleRoom = (roomId: string) => {
    setExpandedRooms(prev => {
      const next = new Set(prev);
      if (next.has(roomId)) next.delete(roomId);
      else next.add(roomId);
      return next;
    });
  };

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

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {loading && (
          <View style={styles.loadingWrap}>
            <ActivityIndicator color={palette.mintPresence} />
          </View>
        )}

        {/* List view */}
        {!loading && !selected && occurrences.length === 0 && !error && (
          <View style={[styles.emptyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.emptyText, { color: colors.muted }]}>
              {appliedCode
                ? `No past rooms recorded under "${appliedCode}".`
                : 'No rooms have been recorded yet. Sessions appear here once a room has had someone in it.'}
            </Text>
          </View>
        )}

        {!loading &&
          !selected &&
          occurrences.map(occ => {
            // hasActivity=false means the room was minted but nobody was ever recorded in it —
            // distinct from "ongoing" (has activity, still open) and "ended".
            const isOngoing = occ.hasActivity && occ.stillOpen;
            return (
              <TouchableOpacity
                key={occ.id}
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
          })}

        {/* Detail view */}
        {!loading && selected && (
          <>
            {selected.rooms.length > 0 && (
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
            )}

            {selected.rooms.length === 0 ? (
              <View style={[styles.emptyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Text style={[styles.emptyText, { color: colors.muted }]}>
                  No recorded room activity for this session.
                </Text>
              </View>
            ) : (
              selected.rooms.map(room => {
                const attendeeCount = new Set(
                  room.members.filter(m => m.role === 'attendee').map(m => m.deviceId)
                ).size;
                const earliestStart = Math.min(...room.members.map(m => new Date(m.startedAt).getTime()));
                const { durationMs, stillOpen } = computeOccupiedDurationMs(room.members);
                const isExpanded = expandedRooms.has(room.roomId);
                const attendees = aggregateAttendees(room.members);

                return (
                  <View
                    key={room.roomId}
                    style={[styles.roomCard, { backgroundColor: colors.card, borderColor: colors.border }]}
                  >
                    <TouchableOpacity activeOpacity={0.8} onPress={() => toggleRoom(room.roomId)}>
                      <Text style={[styles.roomTitle, { color: colors.txt }]}>
                        {room.roomId.toUpperCase()}
                      </Text>
                      <Text style={[styles.roomMeta, { color: colors.muted }]}>
                        {formatTimestamp(earliestStart)}
                      </Text>

                      <View style={styles.roomStatsRow}>
                        <View style={styles.statBlock}>
                          <Text style={[styles.statValue, { color: palette.mintPresence }]}>
                            {attendeeCount}
                          </Text>
                          <Text style={[styles.statLabel, { color: colors.muted }]}>ATTENDEES</Text>
                        </View>
                        <View style={styles.statBlock}>
                          <Text style={[styles.statValue, { color: colors.txt }]}>
                            {stillOpen ? 'Ongoing' : formatDuration(durationMs)}
                          </Text>
                          <Text style={[styles.statLabel, { color: colors.muted }]}>OCCUPIED</Text>
                        </View>
                      </View>

                      <Text style={[styles.expandToggle, { color: palette.mintPresence }]}>
                        {isExpanded ? '▲ Hide attendees' : '▼ Show attendees'}
                      </Text>
                    </TouchableOpacity>

                    {isExpanded &&
                      attendees.map(a => (
                        <View
                          key={a.deviceId}
                          style={[styles.attendeeRow, { borderTopColor: colors.border }]}
                        >
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
                              {a.everUltrasonicVerified && (
                                <View style={[styles.flag, { backgroundColor: palette.mintSubtle }]}>
                                  <Text style={[styles.flagText, { color: palette.mintPresence }]}>
                                    VERIFIED
                                  </Text>
                                </View>
                              )}
                              {a.everMotionAnomaly && (
                                <View style={[styles.flag, { backgroundColor: 'rgba(245,158,11,0.15)' }]}>
                                  <Text style={[styles.flagText, { color: palette.amberWarn }]}>
                                    INACTIVE
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
                      ))}
                  </View>
                );
              })
            )}
          </>
        )}
      </ScrollView>
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
  content: {
    paddingHorizontal: 20,
    paddingBottom: 28,
    gap: 12,
  },
  loadingWrap: {
    paddingVertical: 32,
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
  occCard: {
    padding: 16,
    borderRadius: 16,
    borderWidth: 1.5,
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
  },
  exportBtnDisabled: {
    opacity: 0.6,
  },
  exportBtnText: {
    color: '#0F2F2C',
    fontSize: 14,
    fontWeight: '800',
  },
  roomCard: {
    padding: 16,
    borderRadius: 16,
    borderWidth: 1.5,
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
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    paddingTop: 10,
    marginTop: 10,
    gap: 12,
  },
  attendeeLeft: {
    flex: 1,
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
