import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Platform,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from "react-native";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import { authConfigured, authFetch } from "../services/auth";
import { EncodingType, readAsStringAsync, StorageAccessFramework } from "expo-file-system/legacy";
import type { LiveRoomState, RoomMemberInfo } from "@confpresence/shared";

const ADMIN_PIN = "2468";
const POLL_INTERVAL_MS = 5000;

/**
 * Real occupied time across a set of stays, not a naive first-start-to-last-end span — a
 * room that empties out between two separate visits (presenter leaves, comes back later)
 * must not have that empty gap counted as if the room were active the whole time. Merges
 * overlapping/adjacent intervals and sums only the merged, actually-occupied ranges. An
 * open-ended stay (no endedAt yet) is treated as running until now for merging purposes,
 * but reported back via `stillOpen` so the caller can show "Ongoing" instead of a fixed figure.
 */
function computeOccupiedDurationMs(stays: { startedAt: string; endedAt: string | null }[]): { durationMs: number; stillOpen: boolean } {
  if (stays.length === 0) return { durationMs: 0, stillOpen: false };
  const now = Date.now();
  const stillOpen = stays.some((s) => !s.endedAt);
  const intervals = stays
    .map((s) => ({ start: new Date(s.startedAt).getTime(), end: s.endedAt ? new Date(s.endedAt).getTime() : now }))
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

function formatDuration(ms?: number): string {
  if (ms == null || ms < 0) return "--";
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

type AdminScreenProps = {
  serverUrl: string;
  sessionId: string;
  onBack: () => void;
};

type SessionOccurrence = {
  id: string;
  code: string;
  // Derived from room_membership, not the session row's own bookkeeping timestamps — this is
  // when rooms in this occurrence were actually active, which is the figure that matters here.
  hasActivity: boolean;
  startedAt: string | null;
  endedAt: string | null;
  stillOpen: boolean;
  // Real occupied time across every room/device in this session (gaps between separate visits
  // excluded), computed server-side — not endedAt - startedAt, which would include those gaps.
  durationMs?: number;
  rooms: string[];
  hosts: string[];
  attendeeCount: number;
};

type HistoryMember = {
  deviceId: string;
  email?: string;
  displayName: string;
  role: "presenter" | "attendee";
  startedAt: string;
  endedAt: string | null;
  durationMs?: number;
  lastConfidence?: number;
  ultrasonicVerified?: boolean;
  motionAnomalyFlag?: boolean;
};

type HistoryDetail = {
  sessionId: string;
  code: string;
  startedAt: string;
  endedAt: string | null;
  rooms: { roomId: string; members: HistoryMember[] }[];
};

let savedPdfDirectoryUri: string | null = null;

/** Writes the PDF into a user-chosen folder (asked once per app launch). Returns false if it could not, so the caller can fall back to the share sheet. */
async function saveToChosenFolder(pdfUri: string, code: string): Promise<boolean> {
  try {
    if (!savedPdfDirectoryUri) {
      const perm = await StorageAccessFramework.requestDirectoryPermissionsAsync();
      if (!perm.granted) return false;
      savedPdfDirectoryUri = perm.directoryUri;
    }
    const base64 = await readAsStringAsync(pdfUri, { encoding: EncodingType.Base64 });
    const safeCode = code.replace(/[^a-zA-Z0-9_-]/g, "_") || "session";
    const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
    const fileUri = await StorageAccessFramework.createFileAsync(
      savedPdfDirectoryUri,
      `XConnect-${safeCode}-${stamp}`,
      "application/pdf"
    );
    await StorageAccessFramework.writeAsStringAsync(fileUri, base64, { encoding: EncodingType.Base64 });
    Alert.alert("PDF saved", "Saved to the folder you selected.");
    return true;
  } catch {
    savedPdfDirectoryUri = null;
    return false;
  }
}

function formatTimestamp(iso?: string | number | null): string {
  if (iso === undefined || iso === null) return "--";
  return new Date(iso).toLocaleString();
}

type AggregatedAttendee = {
  deviceId: string;
  email?: string;
  displayName: string;
  role: "presenter" | "attendee";
  totalDurationMs: number;
  hasOpenStay: boolean;
  everUltrasonicVerified: boolean;
  everMotionAnomaly: boolean;
};

/**
 * Collapses a room's individual entry/exit rows (one per visit) into one row per person —
 * their total time in the room across every visit, not each stay separately. Shared by the
 * on-screen attendee list and the PDF export so the two never drift apart.
 */
function aggregateAttendees(members: HistoryMember[]): AggregatedAttendee[] {
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
        everMotionAnomaly: false
      },
      stays: []
    };
    entry.stays.push(member);
    if (!member.endedAt) entry.attendee.hasOpenStay = true;
    if (member.ultrasonicVerified) entry.attendee.everUltrasonicVerified = true;
    if (member.motionAnomalyFlag) entry.attendee.everMotionAnomaly = true;
    byPerson.set(member.deviceId, entry);
  }
  // Merge overlapping stays (a person rejoining from a new phone can overlap the old one for a
  // few seconds) so their time is never counted twice.
  return [...byPerson.values()].map(({ attendee, stays }) => ({
    ...attendee,
    totalDurationMs: computeOccupiedDurationMs(stays).durationMs
  }));
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function buildHistoryReportHtml(occurrence: HistoryDetail): string {
  const roomSections = occurrence.rooms.map((room) => {
    const { durationMs: roomDurationMs, stillOpen } = computeOccupiedDurationMs(room.members);
    const attendeeCount = new Set(room.members.filter((m) => m.role === "attendee").map((m) => m.deviceId)).size;
    const earliestStart = Math.min(...room.members.map((m) => new Date(m.startedAt).getTime()));
    const attendees = aggregateAttendees(room.members);

    const rows = attendees
      .map((a) => {
        const flags = [
          a.everUltrasonicVerified ? "Ultrasonic Verified" : null,
          a.everMotionAnomaly ? "Inactivity flag" : null
        ].filter(Boolean).join(", ");
        return `<tr>
          <td>${escapeHtml(a.displayName)}${a.email ? `<br/><span style="color:#5D6873">${escapeHtml(a.email)}</span>` : ""}</td>
          <td>${a.role === "presenter" ? "Host" : "User"}</td>
          <td>${formatDuration(a.totalDurationMs)}${a.hasOpenStay ? " (ongoing)" : ""}</td>
          <td>${escapeHtml(flags || "--")}</td>
        </tr>`;
      })
      .join("");

    return `
      <h2>Room: ${escapeHtml(room.roomId)}</h2>
      <p class="meta">
        ${escapeHtml(formatTimestamp(earliestStart))} &middot;
        ${attendeeCount} attendee${attendeeCount === 1 ? "" : "s"} &middot;
        ${stillOpen ? "Ongoing" : formatDuration(roomDurationMs)}
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
        ${roomSections.join("") || "<p>No recorded room activity for this session.</p>"}
      </body>
    </html>`;
}

export function AdminScreen({ serverUrl, sessionId, onBack }: AdminScreenProps) {
  const [unlocked, setUnlocked] = useState(false);
  const [pinInput, setPinInput] = useState("");
  const [pinError, setPinError] = useState(false);
  const [rooms, setRooms] = useState<LiveRoomState[]>([]);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"live" | "history">("live");
  const [historyCode, setHistoryCode] = useState("");
  const [historyOccurrences, setHistoryOccurrences] = useState<SessionOccurrence[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [selectedOccurrence, setSelectedOccurrence] = useState<HistoryDetail | null>(null);
  const [expandedRooms, setExpandedRooms] = useState<Set<string>>(new Set());
  const [pdfGenerating, setPdfGenerating] = useState(false);
  const unlockedRef = useRef(false);
  // With sign-in on, admin rights come from the server (the PIN is only used when sign-in is off).
  const [adminCheck, setAdminCheck] = useState<"checking" | "allowed" | "denied">(authConfigured ? "checking" : "allowed");

  useEffect(() => {
    if (!authConfigured) return;
    authFetch(`${serverUrl}/api/me`)
      .then((res) => res.json())
      .then((me) => {
        if (me?.isAdmin) {
          setAdminCheck("allowed");
          setUnlocked(true);
        } else {
          setAdminCheck("denied");
        }
      })
      .catch(() => setAdminCheck("denied"));
  }, [serverUrl]);

  useEffect(() => {
    unlockedRef.current = unlocked;
  }, [unlocked]);

  useEffect(() => {
    if (!unlocked) return;

    const fetchOverview = async () => {
      try {
        const res = await authFetch(`${serverUrl}/api/admin/overview`);
        if (!unlockedRef.current) return;
        if (!res.ok) {
          setFetchError(`Server returned ${res.status}`);
          return;
        }
        const data = await res.json();
        if (!unlockedRef.current) return;
        setRooms(Array.isArray(data.rooms) ? data.rooms : []);
        setFetchError(null);
        setLastUpdated(new Date().toLocaleTimeString());
      } catch (err: any) {
        if (!unlockedRef.current) return;
        setFetchError(err?.message || "Network error");
      }
    };

    fetchOverview();
    const interval = setInterval(fetchOverview, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [unlocked, serverUrl]);

  const handleUnlock = () => {
    if (pinInput.trim() === ADMIN_PIN) {
      setPinError(false);
      setUnlocked(true);
    } else {
      setPinError(true);
    }
  };

  const endSessionRequest = async () => {
    try {
      const res = await authFetch(`${serverUrl}/api/admin/session/end`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId })
      });
      const data = await res.json().catch(() => null);
      if (data?.ended) {
        Alert.alert("Session Ended", `"${sessionId}" is closed. The next device to use this code starts a new session.`);
      } else {
        Alert.alert("Nothing to End", `"${sessionId}" has no active occurrence right now.`);
      }
    } catch (err: any) {
      Alert.alert("Failed to End Session", err?.message || "Network error");
    }
  };

  const handleEndSession = () => {
    Alert.alert(
      "End This Session?",
      `This closes out "${sessionId}" for reporting. Anyone who continues using this code afterward starts a brand-new session, not a continuation of this one.`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "End Session", style: "destructive", onPress: endSessionRequest }
      ]
    );
  };

  const searchHistory = async () => {
    const code = historyCode.trim();
    setHistoryLoading(true);
    setHistoryError(null);
    setSelectedOccurrence(null);
    try {
      const url = code
        ? `${serverUrl}/api/admin/sessions?code=${encodeURIComponent(code)}`
        : `${serverUrl}/api/admin/sessions`;
      const res = await authFetch(url);
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setHistoryError(data?.error ? JSON.stringify(data.error) : `Server returned ${res.status}`);
        setHistoryOccurrences([]);
        return;
      }
      setHistoryOccurrences(Array.isArray(data?.sessions) ? data.sessions : []);
    } catch (err: any) {
      setHistoryError(err?.message || "Network error");
      setHistoryOccurrences([]);
    } finally {
      setHistoryLoading(false);
    }
  };

  const openOccurrence = async (occurrenceSessionId: string) => {
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const res = await authFetch(`${serverUrl}/api/admin/history?sessionId=${encodeURIComponent(occurrenceSessionId)}`);
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setHistoryError(data?.error ? JSON.stringify(data.error) : `Server returned ${res.status}`);
        return;
      }
      setSelectedOccurrence(data);
    } catch (err: any) {
      setHistoryError(err?.message || "Network error");
    } finally {
      setHistoryLoading(false);
    }
  };

  const handleDownloadPdf = async () => {
    if (!selectedOccurrence || pdfGenerating) return;
    setPdfGenerating(true);
    try {
      const html = buildHistoryReportHtml(selectedOccurrence);
      const { uri } = await Print.printToFileAsync({ html });
      if (Platform.OS === "android" && (await saveToChosenFolder(uri, selectedOccurrence.code))) {
        return;
      }
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: "application/pdf", dialogTitle: "Session Report" });
      } else {
        Alert.alert("Sharing unavailable", `PDF saved to ${uri}`);
      }
    } catch (err: any) {
      Alert.alert("Could not create PDF", err?.message || "Unknown error");
    } finally {
      setPdfGenerating(false);
    }
  };

  useEffect(() => {
    if (unlocked && activeTab === "history") {
      searchHistory();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unlocked, activeTab]);

  if (adminCheck !== "allowed") {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.pinContainer}>
          <Text style={styles.pinTitle}>Admin Access</Text>
          <Text style={styles.pinSubtitle}>
            {adminCheck === "checking" ? "Checking your access..." : "Your account is not an admin."}
          </Text>
          <TouchableOpacity style={styles.backLink} onPress={onBack} activeOpacity={0.7}>
            <Text style={styles.backLinkText}>{"←"} Back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  if (!unlocked) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.pinContainer}>
          <Text style={styles.pinTitle}>Admin Access</Text>
          <Text style={styles.pinSubtitle}>Enter PIN to view the live session overview.</Text>
          <TextInput
            style={styles.pinInput}
            value={pinInput}
            onChangeText={(t) => {
              setPinInput(t);
              setPinError(false);
            }}
            placeholder="PIN"
            keyboardType="number-pad"
            secureTextEntry
            maxLength={8}
            returnKeyType="done"
            onSubmitEditing={handleUnlock}
          />
          {pinError && <Text style={styles.pinErrorText}>Incorrect PIN</Text>}
          <TouchableOpacity style={styles.unlockBtn} onPress={handleUnlock} activeOpacity={0.8}>
            <Text style={styles.unlockBtnText}>Unlock</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.backLink} onPress={onBack} activeOpacity={0.7}>
            <Text style={styles.backLinkText}>{"←"} Back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.header}>
        <View style={styles.headerTitleWrap}>
          <Text style={styles.headerTitle} numberOfLines={1}>Live Session Overview</Text>
          <Text style={styles.headerSubtitle} numberOfLines={1}>
            {rooms.length} active room{rooms.length === 1 ? "" : "s"}
            {lastUpdated ? ` · updated ${lastUpdated}` : ""}
          </Text>
        </View>
        <View style={styles.headerActions}>
          <TouchableOpacity style={styles.endSessionBtn} onPress={handleEndSession} activeOpacity={0.7}>
            <Text style={styles.endSessionBtnText}>{"\u{1F6D1}"} End Session</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.backBtn} onPress={onBack} activeOpacity={0.7}>
            <Text style={styles.backBtnText}>{"✕"} Close</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.tabRow}>
        <TouchableOpacity
          style={[styles.tabBtn, activeTab === "live" && styles.tabBtnActive]}
          onPress={() => setActiveTab("live")}
          activeOpacity={0.7}
        >
          <Text style={[styles.tabBtnText, activeTab === "live" && styles.tabBtnTextActive]}>Live</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tabBtn, activeTab === "history" && styles.tabBtnActive]}
          onPress={() => setActiveTab("history")}
          activeOpacity={0.7}
        >
          <Text style={[styles.tabBtnText, activeTab === "history" && styles.tabBtnTextActive]}>History</Text>
        </TouchableOpacity>
      </View>

      {activeTab === "live" ? (
        <>
          {fetchError && (
            <View style={styles.errorBanner}>
              <Text style={styles.errorBannerText}>{"⚠️"} {fetchError}</Text>
            </View>
          )}

          <ScrollView contentContainerStyle={styles.scrollContent}>
            {rooms.length === 0 ? (
              <View style={styles.emptyWrap}>
                <Text style={styles.emptyText}>No active rooms right now.</Text>
              </View>
            ) : (
              rooms.map((room) => (
                // Two sessions can each have a room of the same name, so the key carries both.
                <View key={`${room.sessionId}::${room.roomId}`} style={styles.roomCard}>
                  <Text style={styles.roomTitle}>
                    Room: {room.roomId} {"·"} {room.presenterName || room.presenterDeviceId || "Unknown host"}
                  </Text>
                  <Text style={styles.roomSubtitle}>
                    {"\u{1F5C2} " + room.sessionId} {"·"} {room.members?.length ?? 0} member(s)
                  </Text>

                  {(room.members ?? []).map((member: RoomMemberInfo, index: number) => {
                    const isHost = member.role === "presenter";
                    const confPct = Math.round((member.confidence ?? (isHost ? 1.0 : 0.95)) * 100);
                    const wifiPct = member.wifiSimilarity != null ? Math.round(member.wifiSimilarity * 100) : null;

                    return (
                      <View key={member.deviceId || index} style={styles.memberRow}>
                        <View style={styles.memberRowTop}>
                          <Text style={styles.memberName} numberOfLines={1}>
                            {member.displayName || member.deviceId}
                          </Text>
                          <Text style={[styles.roleBadge, isHost ? styles.roleBadgePresenter : styles.roleBadgeAttendee]}>
                            {isHost ? "Host" : "User"}
                          </Text>
                        </View>
                        {member.email && <Text style={styles.memberEmail} numberOfLines={1}>{member.email}</Text>}
                        <Text style={styles.memberId} numberOfLines={1}>{member.deviceId}</Text>
                        <View style={styles.memberMetrics}>
                          <Text style={styles.confText}>{"\u{1F3AF} " + confPct + "% Conf"}</Text>
                          <Text style={styles.durationText}>{"\u{23F1} " + formatDuration(member.durationMs)}</Text>
                          <Text style={styles.bleText}>{"\u{1F4E1} BLE Active"}</Text>
                          {isHost ? (
                            <Text style={styles.wifiText}>{"\u{1F4F6} Wi-Fi Anchor"}</Text>
                          ) : wifiPct != null ? (
                            <Text style={styles.wifiText}>{"\u{1F4F6} Wi-Fi: " + wifiPct + "%"}</Text>
                          ) : null}
                          {member.ultrasonicVerified && (
                            <Text style={styles.ultrasonicText}>{"\u{1F50A} Verified"}</Text>
                          )}
                          {member.motionAnomalyFlag && (
                            <Text style={styles.anomalyText}>{"⚠️ Inactivity"}</Text>
                          )}
                        </View>
                      </View>
                    );
                  })}
                </View>
              ))
            )}
          </ScrollView>
        </>
      ) : (
        <>
          <View style={styles.historySearchRow}>
            <TextInput
              style={styles.historyCodeInput}
              value={historyCode}
              onChangeText={setHistoryCode}
              placeholder="Session code"
              autoCapitalize="none"
            />
            <TouchableOpacity style={styles.historySearchBtn} onPress={searchHistory} activeOpacity={0.7}>
              <Text style={styles.historySearchBtnText}>Search</Text>
            </TouchableOpacity>
          </View>

          {historyError && (
            <View style={styles.errorBanner}>
              <Text style={styles.errorBannerText}>{"⚠️"} {historyError}</Text>
            </View>
          )}

          <ScrollView contentContainerStyle={styles.scrollContent}>
            {historyLoading && (
              <View style={styles.emptyWrap}>
                <Text style={styles.emptyText}>Loading...</Text>
              </View>
            )}

            {!historyLoading && !selectedOccurrence && (
              historyOccurrences.length === 0 ? (
                <View style={styles.emptyWrap}>
                  <Text style={styles.emptyText}>
                    {historyCode.trim() ? "No past sessions found for this code yet." : "No sessions recorded yet."}
                  </Text>
                </View>
              ) : (
                historyOccurrences.map((occ) => {
                  // hasActivity=false means no room ever actually had anyone in it — a session
                  // row that was minted (someone joined) but never got real room_membership
                  // data. Distinct from "active" (has activity, still ongoing) and "ended".
                  const isOngoing = occ.hasActivity && occ.stillOpen;
                  return (
                    <TouchableOpacity
                      key={occ.id}
                      style={styles.occurrenceRow}
                      onPress={() => openOccurrence(occ.id)}
                      activeOpacity={0.7}
                    >
                      <View style={styles.occurrenceLeft}>
                        <Text style={styles.occurrenceTitle} numberOfLines={1}>
                          {occ.rooms.length > 0 ? occ.rooms.join(", ") : "No rooms"}
                        </Text>
                        <Text style={styles.occurrenceCode} numberOfLines={1}>{occ.code}</Text>
                        <Text style={styles.occurrenceSubtitle} numberOfLines={1}>
                          {"\u{1F464} " + (occ.hosts.length > 0 ? occ.hosts.join(", ") : "No host")}
                        </Text>
                      </View>
                      {!occ.hasActivity ? (
                        <View style={styles.occurrenceRight}>
                          <Text style={styles.occurrenceSubtitle}>No room activity</Text>
                        </View>
                      ) : (
                      <View style={styles.occurrenceRight}>
                        <Text style={styles.occurrenceSubtitle}>{occ.startedAt ? new Date(occ.startedAt).toLocaleDateString() : "--"}</Text>
                        <Text style={styles.occurrenceSubtitle}>{"\u{1F465} " + occ.attendeeCount}</Text>
                        <Text style={styles.occurrenceSubtitle}>
                          {"\u{23F1} " + (isOngoing ? "Ongoing" : formatDuration(occ.durationMs))}
                        </Text>
                        <Text style={[styles.occurrenceStatus, isOngoing ? styles.occurrenceStatusActive : styles.occurrenceStatusEnded]}>
                          {isOngoing ? "\u{1F7E2} Active" : "⚫ Ended"}
                        </Text>
                      </View>
                      )}
                    </TouchableOpacity>
                  );
                })
              )
            )}

            {!historyLoading && selectedOccurrence && (
              <View>
                <View style={styles.historyDetailTopRow}>
                  <TouchableOpacity
                    style={styles.backToSessionsBtn}
                    onPress={() => setSelectedOccurrence(null)}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.backToSessionsBtnText}>{"←"} Back to sessions</Text>
                  </TouchableOpacity>

                  {selectedOccurrence.rooms.length > 0 && (
                    <TouchableOpacity
                      style={styles.downloadPdfBtn}
                      onPress={handleDownloadPdf}
                      disabled={pdfGenerating}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.downloadPdfBtnText}>
                        {pdfGenerating ? "Generating..." : "\u{2B07} Download PDF"}
                      </Text>
                    </TouchableOpacity>
                  )}
                </View>

                {selectedOccurrence.rooms.length === 0 ? (
                  <View style={styles.emptyWrap}>
                    <Text style={styles.emptyText}>No recorded room activity for this session.</Text>
                  </View>
                ) : (
                  selectedOccurrence.rooms.map((room) => {
                    const attendeeCount = new Set(
                      room.members.filter((m) => m.role === "attendee").map((m) => m.deviceId)
                    ).size;
                    const starts = room.members.map((m) => new Date(m.startedAt).getTime());
                    const earliestStart = Math.min(...starts);
                    const { durationMs: roomDurationMs, stillOpen } = computeOccupiedDurationMs(room.members);
                    const isExpanded = expandedRooms.has(room.roomId);

                    return (
                    <View key={room.roomId} style={styles.roomCard}>
                      <TouchableOpacity
                        activeOpacity={0.7}
                        onPress={() => {
                          setExpandedRooms((prev) => {
                            const next = new Set(prev);
                            if (next.has(room.roomId)) next.delete(room.roomId);
                            else next.add(room.roomId);
                            return next;
                          });
                        }}
                      >
                        <Text style={styles.roomTitle}>Room: {room.roomId}</Text>
                        <Text style={styles.roomSubtitle}>{"\u{1F4C5} " + formatTimestamp(earliestStart)}</Text>
                        <View style={styles.memberMetrics}>
                          <Text style={styles.confText}>{"\u{1F465} " + attendeeCount + " attendee" + (attendeeCount === 1 ? "" : "s")}</Text>
                          <Text style={styles.durationText}>
                            {"\u{23F1} " + (stillOpen ? "Ongoing" : formatDuration(roomDurationMs))}
                          </Text>
                        </View>
                        <Text style={styles.backLinkText}>{isExpanded ? "▲ Hide attendees" : "▼ Show attendees"}</Text>
                      </TouchableOpacity>

                      {isExpanded && (() => {
                        return aggregateAttendees(room.members).map((attendee) => {
                          const isHost = attendee.role === "presenter";
                          return (
                            <View key={attendee.deviceId} style={styles.memberRow}>
                              <View style={styles.memberRowTop}>
                                <Text style={styles.memberName} numberOfLines={1}>
                                  {attendee.displayName}
                                </Text>
                                <Text style={[styles.roleBadge, isHost ? styles.roleBadgePresenter : styles.roleBadgeAttendee]}>
                                  {isHost ? "Host" : "User"}
                                </Text>
                              </View>
                              {attendee.email && <Text style={styles.memberEmail} numberOfLines={1}>{attendee.email}</Text>}
                              <View style={styles.memberMetrics}>
                                <Text style={styles.durationText}>
                                  {"\u{23F1} " + formatDuration(attendee.totalDurationMs) + (attendee.hasOpenStay ? " (ongoing)" : "")}
                                </Text>
                                {attendee.everUltrasonicVerified && (
                                  <Text style={styles.ultrasonicText}>{"\u{1F50A} Verified"}</Text>
                                )}
                                {attendee.everMotionAnomaly && (
                                  <Text style={styles.anomalyText}>{"⚠️ Inactivity"}</Text>
                                )}
                              </View>
                            </View>
                          );
                        });
                      })()}
                    </View>
                    );
                  })
                )}
              </View>
            )}
          </ScrollView>
        </>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#F7FAFB",
    paddingTop: Platform.OS === "android" ? StatusBar.currentHeight ?? 0 : 0
  },
  pinContainer: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 10 },
  pinTitle: { fontSize: 22, fontWeight: "700", color: "#173A63" },
  pinSubtitle: { fontSize: 13, color: "#5D6873", textAlign: "center", marginBottom: 10 },
  pinInput: {
    borderWidth: 1.5,
    borderColor: "#00695C",
    borderRadius: 8,
    padding: 12,
    width: 160,
    textAlign: "center",
    fontSize: 18,
    letterSpacing: 4,
    color: "#173A63",
    backgroundColor: "#FFFFFF"
  },
  pinErrorText: { color: "#A31D33", fontSize: 12 },
  unlockBtn: { backgroundColor: "#126D7A", paddingVertical: 10, paddingHorizontal: 28, borderRadius: 8, marginTop: 6 },
  unlockBtnText: { color: "#FFFFFF", fontWeight: "700", fontSize: 15 },
  backLink: { marginTop: 16 },
  backLinkText: { color: "#5D6873", fontSize: 13 },
  historyDetailTopRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
    gap: 8
  },
  backToSessionsBtn: {
    alignSelf: "flex-start",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: "#E6F2F3"
  },
  backToSessionsBtnText: { color: "#126D7A", fontSize: 14, fontWeight: "700" },
  downloadPdfBtn: {
    alignSelf: "flex-start",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: "#173A63"
  },
  downloadPdfBtnText: { color: "#FFFFFF", fontSize: 14, fontWeight: "700" },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#D9E3E8",
    backgroundColor: "#FFFFFF"
  },
  headerTitleWrap: { flexShrink: 1, marginRight: 8 },
  headerTitle: { fontSize: 17, fontWeight: "800", color: "#173A63" },
  headerSubtitle: { fontSize: 12, color: "#5D6873", marginTop: 2 },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 0 },
  backBtn: { paddingHorizontal: 12, paddingVertical: 6, backgroundColor: "#ECEFF1", borderRadius: 6 },
  backBtnText: { fontSize: 13, fontWeight: "700", color: "#455A64" },
  endSessionBtn: { paddingHorizontal: 12, paddingVertical: 6, backgroundColor: "#FDECEA", borderRadius: 6 },
  endSessionBtnText: { fontSize: 13, fontWeight: "700", color: "#C62828" },
  errorBanner: { backgroundColor: "#FDECEA", padding: 10, paddingHorizontal: 16 },
  errorBannerText: { color: "#A31D33", fontSize: 12 },
  tabRow: { flexDirection: "row", paddingHorizontal: 16, paddingTop: 10, gap: 8 },
  tabBtn: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8, backgroundColor: "#ECEFF1" },
  tabBtnActive: { backgroundColor: "#126D7A" },
  tabBtnText: { fontSize: 13, fontWeight: "700", color: "#5D6873" },
  tabBtnTextActive: { color: "#FFFFFF" },
  historySearchRow: { flexDirection: "row", paddingHorizontal: 16, paddingTop: 12, gap: 8 },
  historyCodeInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#D8DEE2",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 14,
    color: "#173A63",
    backgroundColor: "#FFFFFF"
  },
  historySearchBtn: { paddingHorizontal: 16, justifyContent: "center", backgroundColor: "#126D7A", borderRadius: 8 },
  historySearchBtnText: { color: "#FFFFFF", fontWeight: "700", fontSize: 13 },
  occurrenceRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    backgroundColor: "#FFFFFF",
    borderRadius: 10,
    padding: 14,
    borderWidth: 1,
    borderColor: "#E3E8EB"
  },
  occurrenceLeft: { flexShrink: 1, marginRight: 10 },
  occurrenceRight: { alignItems: "flex-end", flexShrink: 0 },
  occurrenceCode: { fontSize: 11, fontWeight: "700", color: "#126D7A", textTransform: "uppercase", letterSpacing: 0.5, marginTop: 2 },
  occurrenceTitle: { fontSize: 14, fontWeight: "700", color: "#173A63" },
  occurrenceSubtitle: { fontSize: 12, color: "#5D6873", marginTop: 2 },
  occurrenceStatus: { fontSize: 12, fontWeight: "700", marginTop: 4 },
  occurrenceStatusActive: { color: "#1B7A3D" },
  occurrenceStatusEnded: { color: "#5D6873" },
  scrollContent: { padding: 16, gap: 12 },
  emptyWrap: { paddingVertical: 60, alignItems: "center" },
  emptyText: { color: "#5D6873", fontSize: 14 },
  roomCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 10,
    padding: 14,
    borderWidth: 1,
    borderColor: "#D9E3E8",
    marginBottom: 12,
    gap: 6
  },
  roomTitle: { fontSize: 15, fontWeight: "700", color: "#173A63" },
  roomSubtitle: { fontSize: 12, color: "#5D6873", marginBottom: 4 },
  memberRow: {
    borderTopWidth: 1,
    borderTopColor: "#F0F4F8",
    paddingTop: 8,
    marginTop: 4,
    gap: 4
  },
  memberRowTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  memberName: { fontSize: 13, fontWeight: "700", color: "#173A63", flex: 1 },
  memberId: { fontSize: 11, color: "#5D6873", fontFamily: "monospace" },
  memberEmail: { fontSize: 11, color: "#5D6873", marginTop: 1 },
  roleBadge: {
    fontSize: 10,
    fontWeight: "700",
    paddingVertical: 2,
    paddingHorizontal: 6,
    borderRadius: 4,
    overflow: "hidden"
  },
  roleBadgePresenter: { backgroundColor: "#E0F7FA", color: "#00838F" },
  roleBadgeAttendee: { backgroundColor: "#ECEFF1", color: "#455A64" },
  memberMetrics: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 2 },
  confText: { fontSize: 11, fontWeight: "700", color: "#00695C" },
  durationText: { fontSize: 11, fontWeight: "700", color: "#455A64" },
  bleText: { fontSize: 11, fontWeight: "700", color: "#4A148C" },
  wifiText: { fontSize: 11, fontWeight: "700", color: "#0D47A1" },
  ultrasonicText: { fontSize: 11, fontWeight: "700", color: "#00838F" },
  anomalyText: { fontSize: 11, fontWeight: "700", color: "#B45309" }
});
