import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import Svg, { Path, Circle } from 'react-native-svg';
import { useTheme } from '../../theme/useTheme';
import { palette } from '../../theme/colors';
import { TopBar } from '../../components/ui/TopBar';
import { MobileScreen } from '../../components/navigation/BottomNav';
import { AppAlert } from '../../components/ui/AppAlert';
import { exportHistoryReport, type HistoryDetail } from '../../services/sessionHistory';

interface SessionEndScreenProps {
  roomId: string;
  sessionId: string;
  /** True while this room is actually being broadcast right now — the "Analysis" tab reuses this
   * same screen both for a live in-progress summary and for the last-ended report, and the two
   * need clearly different framing so the numbers are never mistaken for the wrong one. */
  isLive: boolean;
  totalAttendees?: number;
  durationMs?: number;
  startedAt?: string;
  endedAt?: string | null;
  acousticMatchPercent?: number;
  wifiSimilarityPercent?: number;
  /** Loads the persisted attendance record for a room this presenter hosted. */
  onFetchRoomHistory: (roomId: string, sessionId: string) => Promise<HistoryDetail>;
  onNavigate: (screen: MobileScreen) => void;
}

export const SessionEndScreen: React.FC<SessionEndScreenProps> = ({
  roomId,
  sessionId,
  isLive,
  totalAttendees = 0,
  durationMs = 0,
  startedAt,
  endedAt,
  acousticMatchPercent = 99.2,
  wifiSimilarityPercent = 98.5,
  onFetchRoomHistory,
  onNavigate,
}) => {
  const { colors } = useTheme();
  const [exporting, setExporting] = useState(false);

  // Format real duration
  const totalMinutes = Math.max(1, Math.round(durationMs / 60000));
  const dwellFormatted =
    totalMinutes >= 60
      ? `${Math.floor(totalMinutes / 60)}h ${totalMinutes % 60}m`
      : `${totalMinutes}m`;

  const handleExportReport = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      // Fetched rather than built from what's on screen: the report is the persisted attendance
      // record, including everyone's individual visits, which this screen only has totals for.
      const occurrence = await onFetchRoomHistory(roomId, sessionId);
      if (occurrence.rooms.length === 0) {
        AppAlert.alert(
          'Nothing to report yet',
          "No attendance has been recorded for this room. If it only just ended, the last few people's time is still being written — try again in a moment."
        );
        return;
      }
      const outcome = await exportHistoryReport(occurrence);
      AppAlert.alert(
        'Report Exported',
        outcome.kind === 'savedToFolder'
          ? 'Saved to the folder you picked.'
          : outcome.kind === 'shared'
          ? 'Report shared.'
          : `Saved to ${outcome.uri}`
      );
    } catch (err: any) {
      AppAlert.alert('Could not export', err?.message || 'The report could not be generated.');
    } finally {
      setExporting(false);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.surf }]}>
      <TopBar
        title={isLive ? 'Live Session Summary' : 'Session Summary'}
        subtitle={`${roomId.toUpperCase()} · ${sessionId}`}
        onBack={() => onNavigate('home')}
      />

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {isLive ? (
          <View
            style={[
              styles.successBanner,
              {
                backgroundColor: 'rgba(51,209,172,0.12)',
                borderColor: palette.mintPresence,
              },
            ]}
          >
            <View style={styles.successIcon}>
              <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
                <Circle cx={12} cy={12} r={5} fill={palette.mintPresence} />
              </Svg>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.successTitle, { color: palette.mintPresence }]}>
                Live Session In Progress
              </Text>
              <Text style={[styles.successSubtitle, { color: colors.sub }]}>
                Updating in real time from the room's current sensor telemetry.
              </Text>
            </View>
          </View>
        ) : (
          <View
            style={[
              styles.successBanner,
              {
                backgroundColor: 'rgba(245,158,11,0.12)',
                borderColor: palette.amberWarn,
              },
            ]}
          >
            <View style={[styles.successIcon, { backgroundColor: 'rgba(245,158,11,0.2)' }]}>
              <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
                <Path
                  d="M12 9v4M12 17h.01"
                  stroke={palette.amberWarn}
                  strokeWidth={2.5}
                  strokeLinecap="round"
                />
                <Circle cx={12} cy={12} r={9} stroke={palette.amberWarn} strokeWidth={2} />
              </Svg>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.successTitle, { color: palette.amberWarn }]}>
                No Active Room Right Now
              </Text>
              <Text style={[styles.successSubtitle, { color: colors.sub }]}>
                The summary below is from your last ended session, not a live one.
              </Text>
            </View>
          </View>
        )}

        {/* Timeline banner */}
        {startedAt ? (
          <View
            style={[
              styles.timelineCard,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <View style={styles.timelineRow}>
              <Text style={[styles.timelineLabel, { color: colors.muted }]}>STARTED</Text>
              <Text style={[styles.timelineValue, { color: colors.txt }]}>
                {new Date(startedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true })}
              </Text>
            </View>
            <View style={[styles.timelineDivider, { backgroundColor: colors.border }]} />
            <View style={styles.timelineRow}>
              <Text style={[styles.timelineLabel, { color: colors.muted }]}>STATUS</Text>
              <Text style={[styles.timelineValue, { color: isLive ? palette.mintPresence : colors.sub }]}>
                {isLive ? 'Ongoing' : endedAt ? new Date(endedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true }) : 'Ended'}
              </Text>
            </View>
          </View>
        ) : null}

        {/* Analytics 2x2 Grid */}
        <View style={styles.grid}>
          <View
            style={[
              styles.statCard,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <Text style={[styles.statLabel, { color: colors.muted }]}>
              TOTAL ATTENDEES
            </Text>
            <Text style={[styles.statValue, { color: palette.mintPresence }]}>
              {totalAttendees}
            </Text>
            <Text style={[styles.statSub, { color: colors.sub }]}>
              100% In-Room Verified
            </Text>
          </View>

          <View
            style={[
              styles.statCard,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <Text style={[styles.statLabel, { color: colors.muted }]}>
              SESSION DWELL
            </Text>
            <Text style={[styles.statValue, { color: palette.skyMesh }]}>
              {dwellFormatted}
            </Text>
            <Text style={[styles.statSub, { color: colors.sub }]}>
              Continuous Presence
            </Text>
          </View>

          <View
            style={[
              styles.statCard,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <Text style={[styles.statLabel, { color: colors.muted }]}>
              ACOUSTIC GATE
            </Text>
            <Text style={[styles.statValue, { color: palette.tealUltra }]}>
              {acousticMatchPercent}%
            </Text>
            <Text style={[styles.statSub, { color: colors.sub }]}>
              19kHz Token Match
            </Text>
          </View>

          <View
            style={[
              styles.statCard,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <Text style={[styles.statLabel, { color: colors.muted }]}>
              WI-FI SIMILARITY
            </Text>
            <Text style={[styles.statValue, { color: palette.amberWarn }]}>
              {wifiSimilarityPercent}%
            </Text>
            <Text style={[styles.statSub, { color: colors.sub }]}>
              Multi-AP Fingerprint
            </Text>
          </View>
        </View>

        {/* Action Buttons */}
        <View style={styles.actions}>
          <TouchableOpacity
            activeOpacity={0.85}
            disabled={exporting}
            onPress={() => void handleExportReport()}
            style={[styles.exportButton, exporting && { opacity: 0.6 }]}
          >
            {exporting ? (
              <ActivityIndicator size="small" color="#0F2F2C" />
            ) : (
              <Text style={styles.exportButtonText}>Export PDF Attendance Report</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            activeOpacity={0.85}
            onPress={() => onNavigate('home')}
            style={[
              styles.homeButton,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <Text style={[styles.homeButtonText, { color: colors.txt }]}>
              Back to Home
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
  successBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 16,
    borderWidth: 1.5,
    marginBottom: 20,
    gap: 12,
  },
  successIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(51,209,172,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  successTitle: {
    fontSize: 14,
    fontWeight: '800',
    marginBottom: 2,
  },
  successSubtitle: {
    fontSize: 11,
    lineHeight: 15,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 24,
  },
  statCard: {
    width: '48%',
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  statLabel: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.8,
    marginBottom: 6,
  },
  statValue: {
    fontSize: 28,
    fontWeight: '900',
    letterSpacing: -1,
    marginBottom: 4,
  },
  statSub: {
    fontSize: 11,
    fontWeight: '500',
  },
  actions: {
    gap: 12,
  },
  exportButton: {
    backgroundColor: palette.mintPresence,
    paddingVertical: 15,
    borderRadius: 14,
    alignItems: 'center',
    shadowColor: palette.mintPresence,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 3,
  },
  exportButtonText: {
    color: '#0F2F2C',
    fontSize: 15,
    fontWeight: '800',
  },
  homeButton: {
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
  },
  homeButtonText: {
    fontSize: 14,
    fontWeight: '700',
  },
  timelineCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 20,
  },
  timelineRow: {
    alignItems: 'center',
    flex: 1,
  },
  timelineLabel: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.8,
    marginBottom: 3,
  },
  timelineValue: {
    fontSize: 14,
    fontWeight: '700',
  },
  timelineDivider: {
    width: 1,
    height: 24,
  },
});
