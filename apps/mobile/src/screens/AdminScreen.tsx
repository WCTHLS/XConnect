import { useEffect, useRef, useState } from "react";
import {
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
import type { LiveRoomState, RoomMemberInfo } from "@confpresence/shared";

const ADMIN_PIN = "2468";
const POLL_INTERVAL_MS = 5000;

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

export function AdminScreen({ serverUrl, sessionId, onBack }: AdminScreenProps) {
  const [unlocked, setUnlocked] = useState(false);
  const [pinInput, setPinInput] = useState("");
  const [pinError, setPinError] = useState(false);
  const [rooms, setRooms] = useState<LiveRoomState[]>([]);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const unlockedRef = useRef(false);

  useEffect(() => {
    unlockedRef.current = unlocked;
  }, [unlocked]);

  useEffect(() => {
    if (!unlocked) return;

    const fetchOverview = async () => {
      try {
        const res = await fetch(`${serverUrl}/api/admin/overview?sessionId=${encodeURIComponent(sessionId)}`);
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
  }, [unlocked, serverUrl, sessionId]);

  const handleUnlock = () => {
    if (pinInput.trim() === ADMIN_PIN) {
      setPinError(false);
      setUnlocked(true);
    } else {
      setPinError(true);
    }
  };

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
        <View>
          <Text style={styles.headerTitle}>Live Session Overview</Text>
          <Text style={styles.headerSubtitle}>
            {rooms.length} active room{rooms.length === 1 ? "" : "s"}
            {lastUpdated ? ` · updated ${lastUpdated}` : ""}
          </Text>
        </View>
        <TouchableOpacity style={styles.backBtn} onPress={onBack} activeOpacity={0.7}>
          <Text style={styles.backBtnText}>{"✕"} Close</Text>
        </TouchableOpacity>
      </View>

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
            <View key={room.roomId} style={styles.roomCard}>
              <Text style={styles.roomTitle}>
                Room: {room.roomId} {"·"} {room.presenterName || room.presenterDeviceId || "Unknown host"}
              </Text>
              <Text style={styles.roomSubtitle}>{room.members?.length ?? 0} member(s)</Text>

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
  headerTitle: { fontSize: 17, fontWeight: "800", color: "#173A63" },
  headerSubtitle: { fontSize: 12, color: "#5D6873", marginTop: 2 },
  backBtn: { paddingHorizontal: 12, paddingVertical: 6, backgroundColor: "#ECEFF1", borderRadius: 6 },
  backBtnText: { fontSize: 13, fontWeight: "700", color: "#455A64" },
  errorBanner: { backgroundColor: "#FDECEA", padding: 10, paddingHorizontal: 16 },
  errorBannerText: { color: "#A31D33", fontSize: 12 },
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
