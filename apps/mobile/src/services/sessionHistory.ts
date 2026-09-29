import { Platform } from 'react-native';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { EncodingType, readAsStringAsync, StorageAccessFramework } from 'expo-file-system/legacy';

/**
 * Past-session reporting: the shapes returned by /api/admin/sessions and /api/admin/history,
 * plus the duration maths and PDF report shared by the on-screen view and the export so the
 * two can never drift apart.
 */

/** One past room occurrence, as listed by GET /api/admin/sessions. */
export type SessionOccurrence = {
  id: string;
  code: string;
  // Derived from room_membership, not the room row's own bookkeeping timestamps — this is when
  // the room was actually occupied, which is the figure that matters here.
  hasActivity: boolean;
  startedAt: string | null;
  endedAt: string | null;
  stillOpen: boolean;
  // Real occupied time across every device in the room (gaps between separate visits excluded),
  // computed server-side — not endedAt - startedAt, which would include those gaps.
  durationMs?: number;
  rooms: string[];
  hosts: string[];
  attendeeCount: number;
};

/** One stay: a single join/leave pair for one person in one room. */
export type HistoryMember = {
  deviceId: string;
  email?: string;
  displayName: string;
  role: 'presenter' | 'attendee';
  startedAt: string;
  endedAt: string | null;
  durationMs?: number;
  /** The last reading before the stay closed — taken as the device dropped off, so it reads low
   *  more often than not. Only used when `avgConfidence` is absent. */
  lastConfidence?: number;
  /** Mean confidence across every heartbeat of the stay. Null on stays recorded before the
   *  server started averaging. */
  avgConfidence?: number | null;
  ultrasonicVerified?: boolean;
  motionAnomalyFlag?: boolean;
  /** How long the inactivity flag was actually true during this stay. */
  motionAnomalyMs?: number;
  /** How long ultrasonic verification held during this stay, or null for a presenter, who emits
   *  the tone rather than hearing it and so has no verification to time. */
  ultrasonicVerifiedMs?: number | null;
};

/** The full attendance record for one room occurrence, from GET /api/admin/history. */
export type HistoryDetail = {
  sessionId: string;
  code: string;
  startedAt: string;
  endedAt: string | null;
  rooms: { roomId: string; members: HistoryMember[] }[];
};

/** One join/leave pair, as shown in a person's visit breakdown. */
export type AttendeeStay = {
  startedAt: string;
  endedAt: string | null;
  /** Wall-clock length of this one visit; absent while it is still open. */
  durationMs?: number;
  /** This visit's score: its mean confidence, or its exit reading on stays recorded before the
   *  server averaged them. */
  score?: number;
  motionAnomalyMs?: number;
  ultrasonicVerifiedMs?: number | null;
};

export type AggregatedAttendee = {
  deviceId: string;
  email?: string;
  displayName: string;
  role: 'presenter' | 'attendee';
  totalDurationMs: number;
  hasOpenStay: boolean;
  everUltrasonicVerified: boolean;
  everMotionAnomaly: boolean;
  firstStartedAt?: string;
  lastEndedAt?: string | null;
  /** Mean of each visit's score, 0–1. Undefined when no visit recorded one. Unweighted across
   *  visits: each visit already carries its own average, and weighting those by length would
   *  over-credit one long visit's steady signal against a short visit's. */
  avgConfidence?: number;
  /** Total time the inactivity flag was true, summed across visits. */
  motionAnomalyMs: number;
  /** Total time ultrasonic verification held, summed across visits — null for a presenter, who
   *  emits the tone rather than hearing it, so nothing verified their presence acoustically. */
  ultrasonicVerifiedMs: number | null;
  /** Every visit this person made to the room, earliest first. */
  stays: AttendeeStay[];
};

/**
 * Real occupied time across a set of stays, not a naive first-start-to-last-end span — a room
 * that empties out between two separate visits (presenter leaves, comes back later) must not
 * have that empty gap counted as if the room were active the whole time. Merges
 * overlapping/adjacent intervals and sums only the merged, actually-occupied ranges. An
 * open-ended stay (no endedAt yet) is treated as running until now for merging purposes, but
 * reported back via `stillOpen` so the caller can show "Ongoing" instead of a fixed figure.
 */
export function computeOccupiedDurationMs(
  stays: { startedAt: string; endedAt: string | null }[]
): { durationMs: number; stillOpen: boolean } {
  if (stays.length === 0) return { durationMs: 0, stillOpen: false };
  const now = Date.now();
  const stillOpen = stays.some(s => !s.endedAt);
  const intervals = stays
    .map(s => ({ start: new Date(s.startedAt).getTime(), end: s.endedAt ? new Date(s.endedAt).getTime() : now }))
    .sort((a, b) => a.start - b.start);

  let totalMs = 0;
  let curStart = intervals[0].start;
  let curEnd = intervals[0].end;
  for (let i = 1; i < intervals.length; i++) {
    const iv = intervals[i];
    if (iv.start <= curEnd) {
      curEnd = Math.max(curEnd, iv.end);
    } else {
      totalMs += curEnd - curStart;
      curStart = iv.start;
      curEnd = iv.end;
    }
  }
  totalMs += curEnd - curStart;

  return { durationMs: totalMs, stillOpen };
}

export function formatDuration(ms?: number): string {
  if (ms == null || ms < 0) return '--';
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    const remMinutes = minutes % 60;
    return `${hours}h ${remMinutes}m`;
  }
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

export function formatTimestamp(iso?: string | number | null): string {
  if (iso === undefined || iso === null) return '--';
  return new Date(iso).toLocaleString();
}

/** Clock time alone, for join/leave columns where the date is already established by the room. */
export function formatTime(iso?: string | number | null): string {
  if (iso === undefined || iso === null) return '--';
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });
}

/**
 * Collapses a room's individual entry/exit rows (one per visit) into one row per person — their
 * total time in the room across every visit, not each stay separately. Shared by the on-screen
 * attendee list and the PDF export so the two never drift apart.
 */
export function aggregateAttendees(members: HistoryMember[]): AggregatedAttendee[] {
  const byPerson = new Map<string, { attendee: AggregatedAttendee; stays: HistoryMember[] }>();
  for (const member of members) {
    const entry = byPerson.get(member.deviceId) ?? {
      attendee: {
        deviceId: member.deviceId,
        email: member.email,
        displayName: member.displayName,
        role: member.role,
        totalDurationMs: 0,
        hasOpenStay: false,
        everUltrasonicVerified: false,
        everMotionAnomaly: false,
        motionAnomalyMs: 0,
        ultrasonicVerifiedMs: 0,
        stays: [],
      },
      stays: [],
    };
    entry.stays.push(member);
    if (!member.endedAt) entry.attendee.hasOpenStay = true;
    if (member.ultrasonicVerified) entry.attendee.everUltrasonicVerified = true;
    if (member.motionAnomalyFlag) entry.attendee.everMotionAnomaly = true;
    byPerson.set(member.deviceId, entry);
  }
  // Merge overlapping stays (a person rejoining from a new phone can overlap the old one for a
  // few seconds) so their time is never counted twice.
  return [...byPerson.values()].map(({ attendee, stays }) => {
    const firstStartedAt = stays.length
      ? stays.reduce((earliest, s) => (new Date(s.startedAt) < new Date(earliest) ? s.startedAt : earliest), stays[0].startedAt)
      : undefined;
    const lastEndedAt = stays.some(s => !s.endedAt)
      ? null
      : stays.length
      ? stays.reduce((latest, s) => (s.endedAt && (!latest || new Date(s.endedAt) > new Date(latest)) ? s.endedAt : latest), stays[0].endedAt)
      : null;

    // Each stay's own average where the server recorded one, falling back to its exit reading so
    // history from before averaging existed still contributes rather than vanishing.
    const scoreOf = (s: HistoryMember) =>
      typeof s.avgConfidence === 'number' ? s.avgConfidence : s.lastConfidence;
    const confidences = stays.map(scoreOf).filter((c): c is number => typeof c === 'number');

    return {
      ...attendee,
      firstStartedAt,
      lastEndedAt,
      avgConfidence:
        confidences.length > 0 ? confidences.reduce((a, b) => a + b, 0) / confidences.length : undefined,
      motionAnomalyMs: stays.reduce((n, s) => n + (s.motionAnomalyMs ?? 0), 0),
      // Null across the board for a presenter — every one of their stays reports null, since
      // there is no acoustic verification of the device that produces the tone.
      ultrasonicVerifiedMs: stays.every(s => s.ultrasonicVerifiedMs === null)
        ? null
        : stays.reduce((n, s) => n + (s.ultrasonicVerifiedMs ?? 0), 0),
      // Earliest first, so the breakdown reads as the order the visits actually happened.
      stays: [...stays]
        .sort((a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime())
        .map(s => ({
          startedAt: s.startedAt,
          endedAt: s.endedAt,
          durationMs:
            s.durationMs ??
            (s.endedAt ? new Date(s.endedAt).getTime() - new Date(s.startedAt).getTime() : undefined),
          score: scoreOf(s),
          motionAnomalyMs: s.motionAnomalyMs,
          ultrasonicVerifiedMs: s.ultrasonicVerifiedMs,
        })),
      totalDurationMs: computeOccupiedDurationMs(stays).durationMs,
    };
  });
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function buildHistoryReportHtml(occurrence: HistoryDetail): string {
  const roomSections = occurrence.rooms.map(room => {
    const { durationMs: roomDurationMs, stillOpen } = computeOccupiedDurationMs(room.members);
    const attendeeCount = new Set(room.members.filter(m => m.role === 'attendee').map(m => m.deviceId)).size;
    const earliestStart = Math.min(...room.members.map(m => new Date(m.startedAt).getTime()));
    const attendees = aggregateAttendees(room.members);

    const rows = attendees
      .map(a => {
        // Durations rather than bare yes/no: "flagged" for four seconds and "flagged" for the
        // whole hour are not the same finding, and the old badge couldn't tell them apart.
        const verified =
          a.ultrasonicVerifiedMs === null
            ? 'n/a (emitter)'
            : a.ultrasonicVerifiedMs > 0
            ? formatDuration(a.ultrasonicVerifiedMs)
            : 'Never';
        const inactive = a.motionAnomalyMs > 0 ? formatDuration(a.motionAnomalyMs) : 'None';
        // Every visit, not just the first and last: someone who left and came back three times
        // has a different attendance story from someone who sat through it once, and the summary
        // row alone can't tell those apart.
        const visitRows = a.stays
          .map(
            (s, i) => `<tr class="visit">
              <td class="visit-index">${i + 1}</td>
              <td>${escapeHtml(formatTime(s.startedAt))}</td>
              <td>${s.endedAt ? escapeHtml(formatTime(s.endedAt)) : 'Still in room'}</td>
              <td>${s.endedAt ? formatDuration(s.durationMs) : '--'}</td>
              <td>${s.score === undefined ? '--' : `${Math.round(s.score * 100)}%`}</td>
              <td>${
                s.ultrasonicVerifiedMs === null
                  ? 'n/a'
                  : s.ultrasonicVerifiedMs
                  ? formatDuration(s.ultrasonicVerifiedMs)
                  : '--'
              }</td>
              <td>${s.motionAnomalyMs ? formatDuration(s.motionAnomalyMs) : '--'}</td>
            </tr>`
          )
          .join('');

        return `<tr>
          <td>${escapeHtml(a.displayName)}${a.email ? `<br/><span style="color:#5D6873">${escapeHtml(a.email)}</span>` : ''}</td>
          <td>${a.role === 'presenter' ? 'Host' : 'User'}</td>
          <td>${escapeHtml(formatTime(a.firstStartedAt))}</td>
          <td>${a.hasOpenStay ? 'Still in room' : escapeHtml(formatTime(a.lastEndedAt))}</td>
          <td>${formatDuration(a.totalDurationMs)}${a.hasOpenStay ? ' (ongoing)' : ''}</td>
          <td>${a.avgConfidence === undefined ? '--' : `${Math.round(a.avgConfidence * 100)}%`}</td>
          <td>${escapeHtml(verified)}</td>
          <td>${escapeHtml(inactive)}</td>
        </tr>
        <tr class="visits-row">
          <td colspan="9">
            <div class="visits-label">${a.stays.length} visit${a.stays.length === 1 ? '' : 's'} to this room</div>
            <table class="visits">
              <thead><tr>
                <th>#</th><th>Joined</th><th>Left</th><th>Time in room</th>
                <th>Score</th><th>Verified</th><th>Inactive</th>
              </tr></thead>
              <tbody>${visitRows}</tbody>
            </table>
          </td>
        </tr>`;
      })
      .join('');

    return `
      <h2>Room: ${escapeHtml(room.roomId)}</h2>
      <p class="meta">
        ${escapeHtml(formatTimestamp(earliestStart))} &middot;
        ${attendeeCount} attendee${attendeeCount === 1 ? '' : 's'} &middot;
        ${stillOpen ? 'Ongoing' : formatDuration(roomDurationMs)}
      </p>
      <table>
        <thead><tr>
          <th>Name</th><th>Role</th><th>First joined</th><th>Last left</th>
          <th>Total in room</th><th>Avg score</th><th>Verified for</th><th>Inactive for</th>
        </tr></thead>
        <tbody>${rows || `<tr><td colspan="8">No attendees recorded</td></tr>`}</tbody>
      </table>`;
  });

  return `
    <html>
      <head>
        <meta charset="utf-8" />
        <style>
          body { font-family: -apple-system, Helvetica, Arial, sans-serif; color: #173A63; padding: 24px; }
          h1 { font-size: 20px; margin-bottom: 2px; }
          .subtitle { color: #5D6873; font-size: 12px; margin-top: 0; margin-bottom: 20px; }
          h2 { font-size: 15px; margin-top: 24px; margin-bottom: 4px; border-top: 1px solid #E0E6EA; padding-top: 16px; }
          .meta { color: #5D6873; font-size: 11px; margin-top: 0; margin-bottom: 8px; }
          table { width: 100%; border-collapse: collapse; font-size: 12px; }
          th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #EEF2F4; }
          th { color: #5D6873; font-weight: 600; }
          .visits-row > td { padding: 0 8px 12px 20px; border-bottom: 1px solid #E0E6EA; }
          .visits-label { color: #5D6873; font-size: 10px; text-transform: uppercase;
                          letter-spacing: 0.4px; margin: 2px 0 4px; }
          table.visits { font-size: 11px; background: #F7F9FA; }
          table.visits th, table.visits td { padding: 4px 8px; border-bottom: 1px solid #EEF2F4; }
          table.visits th { font-size: 10px; }
          .visit-index { color: #5D6873; width: 24px; }
        </style>
      </head>
      <body>
        <h1>Session Report</h1>
        <p class="subtitle">Code: ${escapeHtml(occurrence.code)} &middot; Generated ${escapeHtml(new Date().toLocaleString())}</p>
        ${roomSections.join('') || '<p>No recorded room activity for this session.</p>'}
      </body>
    </html>`;
}

// Asked for once per app launch, then reused so exporting several reports in a row doesn't
// re-prompt for a folder every time.
let savedPdfDirectoryUri: string | null = null;

/** Writes the PDF into a user-chosen folder (Android SAF). Returns false if it could not, so the caller can fall back to the share sheet. */
async function saveToChosenFolder(pdfUri: string, code: string): Promise<boolean> {
  try {
    if (!savedPdfDirectoryUri) {
      const perm = await StorageAccessFramework.requestDirectoryPermissionsAsync();
      if (!perm.granted) return false;
      savedPdfDirectoryUri = perm.directoryUri;
    }
    const base64 = await readAsStringAsync(pdfUri, { encoding: EncodingType.Base64 });
    const safeCode = code.replace(/[^a-zA-Z0-9_-]/g, '_') || 'session';
    const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
    const fileUri = await StorageAccessFramework.createFileAsync(
      savedPdfDirectoryUri,
      `XConnect-${safeCode}-${stamp}`,
      'application/pdf'
    );
    await StorageAccessFramework.writeAsStringAsync(fileUri, base64, { encoding: EncodingType.Base64 });
    return true;
  } catch {
    // A revoked/stale directory grant should re-prompt next time rather than fail forever.
    savedPdfDirectoryUri = null;
    return false;
  }
}

export type ExportOutcome =
  | { kind: 'savedToFolder' }
  | { kind: 'shared' }
  | { kind: 'savedToFile'; uri: string };

/**
 * Renders the occurrence as a PDF and hands it to the user: the folder they picked on Android,
 * otherwise the share sheet, otherwise a bare file path. Throws on failure so the caller owns
 * how the error is surfaced.
 */
export async function exportHistoryReport(occurrence: HistoryDetail): Promise<ExportOutcome> {
  const html = buildHistoryReportHtml(occurrence);
  const { uri } = await Print.printToFileAsync({ html });

  if (Platform.OS === 'android' && (await saveToChosenFolder(uri, occurrence.code))) {
    return { kind: 'savedToFolder' };
  }
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: 'Session Report' });
    return { kind: 'shared' };
  }
  return { kind: 'savedToFile', uri };
}
