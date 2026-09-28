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
  lastConfidence?: number;
  ultrasonicVerified?: boolean;
  motionAnomalyFlag?: boolean;
};

/** The full attendance record for one room occurrence, from GET /api/admin/history. */
export type HistoryDetail = {
  sessionId: string;
  code: string;
  startedAt: string;
  endedAt: string | null;
  rooms: { roomId: string; members: HistoryMember[] }[];
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

    return {
      ...attendee,
      firstStartedAt,
      lastEndedAt,
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
        const flags = [
          a.everUltrasonicVerified ? 'Ultrasonic Verified' : null,
          a.everMotionAnomaly ? 'Inactivity flag' : null,
        ]
          .filter(Boolean)
          .join(', ');
        return `<tr>
          <td>${escapeHtml(a.displayName)}${a.email ? `<br/><span style="color:#5D6873">${escapeHtml(a.email)}</span>` : ''}</td>
          <td>${a.role === 'presenter' ? 'Host' : 'User'}</td>
          <td>${formatDuration(a.totalDurationMs)}${a.hasOpenStay ? ' (ongoing)' : ''}</td>
          <td>${escapeHtml(flags || '--')}</td>
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
        <thead><tr><th>Name</th><th>Role</th><th>Duration</th><th>Flags</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="4">No attendees recorded</td></tr>`}</tbody>
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
