import { registerRootComponent } from "expo";
import { StatusBar } from "expo-status-bar";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Button,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from "react-native";
import type { ParticipantRole, RoomMemberInfo } from "@confpresence/shared";
import { PresenceService, type PresenceStatus } from "./src/services/presenceService";
import { getOrCreateDeviceId } from "./src/services/deviceIdentity";
import { AppLogger } from "./src/services/appLogger";
import { LogsModal } from "./src/components/LogsModal";

const DEFAULT_SESSION = "poc-session";
const DEFAULT_ROOMS = ["room-a", "room-b", "auditorium"];
const CLOUD_API_URL = "https://confpresence-api.onrender.com";
const LOCAL_API_URL = "http://192.168.0.195:3000";
const DEFAULT_API_URL = process.env.EXPO_PUBLIC_API_URL ?? CLOUD_API_URL;

export default function App() {
  const [role, setRole] = useState<ParticipantRole>("attendee");
  const [sessionId, setSessionId] = useState(DEFAULT_SESSION);
  const [serverEnv, setServerEnv] = useState<"cloud" | "local" | "custom">("cloud");
  const [serverUrl, setServerUrl] = useState(DEFAULT_API_URL);
  const [serverHealth, setServerHealth] = useState<"checking" | "online" | "offline">("checking");
  const [showServerConfig, setShowServerConfig] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [rooms, setRooms] = useState<string[]>(DEFAULT_ROOMS);
  const [roomId, setRoomId] = useState("room-a");
  const [detectedRoom, setDetectedRoom] = useState("");
  const [newRoomText, setNewRoomText] = useState("");
  const [showAddRoom, setShowAddRoom] = useState(false);
  const [deviceId, setDeviceId] = useState("");
  const [status, setStatus] = useState<PresenceStatus>({ state: "idle", peerCount: 0 });
  const [running, setRunning] = useState(false);
  const runningRef = useRef(false);
  const [roomMembers, setRoomMembers] = useState<RoomMemberInfo[]>([]);
  const [serverConnected, setServerConnected] = useState<boolean | null>(null);
  const [isAutoDetecting, setIsAutoDetecting] = useState(false);
  const [showLogs, setShowLogs] = useState(false);
  const [logCount, setLogCount] = useState(0);

  useEffect(() => {
    return AppLogger.subscribe((logs) => {
      setLogCount(logs.length);
    });
  }, []);

  const service = useMemo(() => new PresenceService(setStatus), []);

  const checkHealth = async (url: string) => {
    setServerHealth("checking");
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 2500);
      const res = await fetch(`${url}/health`, { signal: controller.signal });
      clearTimeout(timer);
      if (res.ok) {
        setServerHealth("online");
        setServerConnected(true);
      } else {
        setServerHealth("offline");
        setServerConnected(false);
      }
    } catch {
      setServerHealth("offline");
      setServerConnected(false);
    }
  };

  useEffect(() => {
    getOrCreateDeviceId().then(setDeviceId);
    checkHealth(DEFAULT_API_URL);
    return () => {
      runningRef.current = false;
      void service.stop();
    };
  }, [service]);

  const fetchLiveRoom = async () => {
    if (!runningRef.current) return;

    try {
      const url =
        role === "presenter"
          ? `${serverUrl}/api/rooms/${roomId}/live?sessionId=${sessionId}`
          : `${serverUrl}/api/devices/${deviceId}/live?sessionId=${sessionId}`;

      const res = await fetch(url);
      if (!runningRef.current) return;

      if (res.ok) {
        setServerConnected(true);
        setServerHealth("online");
        const data = await res.json();
        if (!runningRef.current) return;

        if (data.roomId && data.roomId !== "unknown") {
          setDetectedRoom(data.roomId);
        } else {
          setDetectedRoom("");
        }

        let fetchedMembers: RoomMemberInfo[] = [];
        if (Array.isArray(data.members)) {
          fetchedMembers = data.members;
        } else if (Array.isArray(data.estimatedMemberDeviceIds)) {
          fetchedMembers = data.estimatedMemberDeviceIds.map((id: string) => ({
            deviceId: id,
            displayName: id,
            role: "attendee"
          }));
        }

        // Optimistic Host Inclusion for Presenter
        if (role === "presenter") {
          const hasMe = fetchedMembers.some((m) => m.deviceId === deviceId);
          if (!hasMe) {
            fetchedMembers.unshift({
              deviceId,
              displayName: displayName.trim() || deviceId,
              role: "presenter",
              confidence: 1.0
            });
          }
        }

        if (runningRef.current) {
          setRoomMembers(fetchedMembers);
        }
      } else {
        if (!runningRef.current) return;
        setServerConnected(false);
        setServerHealth("offline");
        if (role === "presenter") {
          setRoomMembers([{
            deviceId,
            displayName: displayName.trim() || deviceId,
            role: "presenter",
            confidence: 1.0
          }]);
        }
      }
    } catch {
      if (!runningRef.current) return;
      setServerConnected(false);
      setServerHealth("offline");
      if (role === "presenter") {
        setRoomMembers([{
          deviceId,
          displayName: displayName.trim() || deviceId,
          role: "presenter",
          confidence: 1.0
        }]);
      }
    }
  };

  useEffect(() => {
    if (!running) {
      runningRef.current = false;
      setRoomMembers([]);
      setDetectedRoom("");
      setServerConnected(null);
      return;
    }

    runningRef.current = true;
    if (role === "presenter" && deviceId) {
      setRoomMembers([{
        deviceId,
        displayName: displayName.trim() || deviceId,
        role: "presenter",
        confidence: 1.0
      }]);
    }
    fetchLiveRoom();
    const interval = setInterval(() => fetchLiveRoom(), 3000);
    return () => clearInterval(interval);
  }, [running, role, roomId, sessionId, serverUrl, deviceId]);

  const togglePresence = async (enabled: boolean) => {
    runningRef.current = enabled;
    setRunning(enabled);
    try {
      if (enabled) {
        await service.start({
          sessionId,
          roomId: role === "presenter" ? roomId : undefined,
          role,
          deviceId,
          displayName: displayName.trim() || undefined,
          apiUrl: serverUrl
        });
      } else {
        await service.stop();
        setRoomMembers([]);
        setDetectedRoom("");
        setServerConnected(null);
      }
    } catch (error) {
      runningRef.current = false;
      setRunning(false);
      setRoomMembers([]);
      setDetectedRoom("");
      setServerConnected(null);
      Alert.alert("Unable to start BLE", error instanceof Error ? error.message : "Unknown BLE error");
    }
  };

  const autoDetectServerIP = async () => {
    setIsAutoDetecting(true);
    const candidateIPs = [
      serverUrl,
      "http://192.168.0.195:3000",
      "http://192.168.0.146:3000",
      "http://192.168.0.110:3000",
      "http://192.168.0.100:3000",
      "http://192.168.1.195:3000",
      "http://10.0.2.2:3000"
    ];
    const unique = Array.from(new Set(candidateIPs));

    for (const base of unique) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 1200);
        const res = await fetch(`${base}/health`, { signal: controller.signal });
        clearTimeout(timeoutId);
        if (res.ok) {
          const data = await res.json();
          if (data.ok) {
            setServerUrl(base);
            setServerConnected(true);
            setServerHealth("online");
            setIsAutoDetecting(false);
            Alert.alert("Local Server Discovered! ðŸ’»", `Connected to laptop API server at:\n${base}`);
            return;
          }
        }
      } catch {
        // Probe next candidate
      }
    }
    setIsAutoDetecting(false);
    setServerHealth("offline");
    Alert.alert("Auto-Detect Failed", "Could not reach laptop API on local Wi-Fi. Make sure `pnpm --filter @confpresence/api dev` is running on your laptop.");
  };

  const handleAddRoom = () => {
    const trimmed = newRoomText.trim().toLowerCase().replace(/\s+/g, "-");
    if (!trimmed) {
      setShowAddRoom(false);
      return;
    }
    if (!rooms.includes(trimmed)) {
      setRooms([...rooms, trimmed]);
      setRoomId(trimmed);
    }
    setNewRoomText("");
    setShowAddRoom(false);
  };

  const handleRemoveRoom = (roomToRemove: string) => {
    if (rooms.length <= 1) {
      Alert.alert("Notice", "You must keep at least one room.");
      return;
    }
    const updated = rooms.filter((r) => r !== roomToRemove);
    setRooms(updated);
    if (roomId === roomToRemove) {
      setRoomId(updated[0]);
    }
  };

  const activeRoomTitle = role === "presenter" ? roomId : detectedRoom ? detectedRoom : "Searching...";

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title}>XConnect</Text>
        <Text style={styles.subtitle}>Zero-hardware BLE mesh POC</Text>

        <Text style={styles.label}>Role</Text>
        <View style={styles.roleRow}>
          <Button title="Attendee" onPress={() => setRole("attendee")} color={role === "attendee" ? "#126D7A" : "#75808A"} />
          <Button title="Presenter" onPress={() => setRole("presenter")} color={role === "presenter" ? "#126D7A" : "#75808A"} />
        </View>

        <Text style={styles.label}>Your name (optional)</Text>
        <TextInput
          editable={!running}
          value={displayName}
          onChangeText={setDisplayName}
          placeholder="e.g. Alice, Bob, Dr. Smith"
          placeholderTextColor="#8C9BA5"
          style={styles.input}
          autoCapitalize="words"
        />

        <Text style={styles.label}>Session code</Text>
        <TextInput
          editable={!running}
          value={sessionId}
          onChangeText={setSessionId}
          placeholder="e.g. poc-session"
          placeholderTextColor="#8C9BA5"
          style={styles.input}
          autoCapitalize="none"
        />

        {/* Room Management Section - Presenter Only */}
        {role === "presenter" && (
          <View style={styles.roomSection}>
            <View style={styles.roomHeaderRow}>
              <Text style={styles.label}>Anchor Room ID</Text>
              {!running && !showAddRoom && (
                <TouchableOpacity
                  style={styles.addRoomBtn}
                  onPress={() => setShowAddRoom(true)}
                >
                  <Text style={styles.addRoomBtnText}>+ Add Room</Text>
                </TouchableOpacity>
              )}
            </View>

            {/* Room Selection Chips */}
            <View style={styles.roomChipsWrap}>
              {rooms.map((r) => {
                const isSelected = r === roomId;
                return (
                  <TouchableOpacity
                    key={r}
                    disabled={running}
                    style={[styles.roomChip, isSelected && styles.roomChipSelected]}
                    onPress={() => setRoomId(r)}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.roomChipText, isSelected && styles.roomChipTextSelected]}>
                      {r}
                    </Text>
                    {!running && rooms.length > 1 && (
                      <TouchableOpacity
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        style={styles.roomDeleteIcon}
                        onPress={() => handleRemoveRoom(r)}
                      >
                        <Text style={[styles.roomDeleteText, isSelected && styles.roomDeleteTextSelected]}>{"\u2715"}</Text>
                      </TouchableOpacity>
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Add New Room Input Row */}
            {!running && showAddRoom && (
              <View style={styles.addRoomInputRow}>
                <TextInput
                  value={newRoomText}
                  onChangeText={setNewRoomText}
                  placeholder="e.g. hall-b, workshop-1"
                  placeholderTextColor="#8C9BA5"
                  style={styles.addRoomInput}
                  autoCapitalize="none"
                  autoFocus
                />
                <TouchableOpacity style={styles.addRoomSaveBtn} onPress={handleAddRoom}>
                  <Text style={styles.addRoomSaveText}>Save</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.addRoomCancelBtn}
                  onPress={() => {
                    setNewRoomText("");
                    setShowAddRoom(false);
                  }}
                >
                  <Text style={styles.addRoomCancelText}>Cancel</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        )}

        <View style={styles.startRow}>
          <View>
            <Text style={styles.startTitle}>Share presence</Text>
            <Text style={styles.help}>The POC scans only while the app is open.</Text>
          </View>
          <Switch value={running} onValueChange={togglePresence} />
        </View>

        {/* Live Connected Devices & Presence Dashboard */}
        <View style={styles.statsCard}>
          <View style={styles.statsHeaderRow}>
            <Text style={styles.statsHeader}>Live Connected Presence</Text>
            <TouchableOpacity
              style={styles.refreshButton}
              onPress={() => fetchLiveRoom()}
              activeOpacity={0.7}
            >
              <Text style={styles.refreshButtonText}>{"\u{1F504} Refresh"}</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.statsGrid}>
            <View style={styles.statBox}>
              <Text style={styles.statNumber}>
                {running && roomMembers.length > 0
                  ? Math.max(0, roomMembers.length - 1)
                  : 0}
              </Text>
              <Text style={styles.statLabel}>BLE Peers</Text>
            </View>
            <View style={styles.statBox}>
              <Text style={styles.statNumber}>{status.wifiApCount ?? 0}</Text>
              <Text style={styles.statLabel}>Wi-Fi APs</Text>
            </View>
            <View style={styles.statBox}>
              <Text style={styles.statNumber}>{roomMembers.length}</Text>
              <Text style={styles.statLabel}>
                {role === "presenter"
                  ? `In Room (${roomId})`
                  : detectedRoom
                  ? `In Room (${detectedRoom})`
                  : "In Room (Searching...)"}
              </Text>
            </View>
          </View>

          {/* In-Room Participants Table */}
          {roomMembers.length > 0 && (
            <View style={styles.tableContainer}>
              <Text style={styles.tableTitle}>
                Confirmed In-Room Participants ({activeRoomTitle}):
              </Text>
              
              {/* Table Header Row */}
              <View style={styles.tableHeaderRow}>
                <Text style={[styles.tableColHeader, { flex: 1.3 }]}>Participant Name</Text>
                <Text style={[styles.tableColHeader, { flex: 1.1 }]}>Device ID</Text>
                <Text style={[styles.tableColHeader, { width: 68, textAlign: "right" }]}>Role</Text>
              </View>

              {/* Table Content Rows */}
              {roomMembers.map((member, index) => {
                const isMe = member.deviceId === deviceId;
                const isHost = member.role === "presenter";
                const confPct = Math.round((member.confidence ?? (isHost ? 1.0 : 0.95)) * 100);
                const wifiPct = member.wifiSimilarity != null ? Math.round(member.wifiSimilarity * 100) : null;

                return (
                  <View key={member.deviceId || index} style={[styles.tableRow, isMe && styles.tableRowMe]}>
                    <View style={styles.tableRowTop}>
                      <Text style={[styles.tableCellName, { flex: 1.3 }]} numberOfLines={1}>
                        {member.displayName || member.deviceId} {isMe ? "(You)" : ""}
                      </Text>
                      <Text style={[styles.tableCellId, { flex: 1.1 }]} numberOfLines={1}>
                        {member.deviceId}
                      </Text>
                      <View style={{ width: 68, alignItems: "flex-end" }}>
                        <Text style={[styles.roleBadge, isHost ? styles.roleBadgePresenter : styles.roleBadgeAttendee]}>
                          {isHost ? "Host" : "User"}
                        </Text>
                      </View>
                    </View>

                    {/* Sensor Metrics Row: Confidence & Wi-Fi Match */}
                    <View style={styles.tableRowMetrics}>
                      <Text style={styles.confText}>{"\u{1F3AF} " + confPct + "% Conf"}</Text>
                      {isHost ? (
                        <Text style={styles.wifiMatchText}>{"\u{1F4F6} Wi-Fi Anchor"}</Text>
                      ) : wifiPct != null ? (
                        <Text style={styles.wifiMatchText}>{"\u{1F4F6} Wi-Fi: " + wifiPct + "% match"}</Text>
                      ) : (
                        <Text style={styles.bleMeshText}>{"\u{1F4E1} BLE Proximity"}</Text>
                      )}
                    </View>
                  </View>
                );
              })}
            </View>
          )}
        </View>

        {/* Diagnostic Status Card */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Status: {status.state}</Text>
          <Text style={styles.cardText}>Device ID: {deviceId || "Creating local ID..."}</Text>
          <Text style={styles.cardText}>Name: {displayName.trim() || "(Not specified)"}</Text>
          <Text style={styles.cardText}>Active Role: {role.toUpperCase()}</Text>
          {role === "presenter" && <Text style={styles.cardText}>Anchor Room: {roomId}</Text>}
          {role === "attendee" && (
            <Text style={styles.cardText}>
              Detected Room: {detectedRoom ? detectedRoom : "Searching for active presenter..."}
            </Text>
          )}
          <Text style={styles.cardText}>Current rotating token: {status.rotatingId ?? "Not active"}</Text>
          {status.error && <Text style={styles.error}>{status.error}</Text>}
        </View>

        {/* Server Connection Settings Card */}
        <View style={styles.serverCard}>
          <TouchableOpacity
            style={styles.serverHeaderRow}
            onPress={() => setShowServerConfig(!showServerConfig)}
            activeOpacity={0.7}
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flex: 1 }}>
              <Text style={styles.serverHeaderText}>{"\u{1F310} " + (serverEnv === "cloud" ? "\u2601\uFE0F Cloud Server (Default)" : serverEnv === "local" ? "\u{1F4BB} Local Laptop" : "\u2699\uFE0F Custom Server")}</Text>
              {serverHealth === "online" && <Text style={{ fontSize: 11, color: "#2E7D32", fontWeight: "700" }}>{"\u{1F7E2} Online"}</Text>}
              {serverHealth === "offline" && <Text style={{ fontSize: 11, color: "#C62828", fontWeight: "700" }}>{"\u{1F534} Offline"}</Text>}
              {serverHealth === "checking" && <Text style={{ fontSize: 11, color: "#E65100", fontWeight: "600" }}>{"\u23F3"}</Text>}
            </View>
            <Text style={styles.serverToggleText}>{showServerConfig ? "\u25B2 Hide" : "\u25BC Change"}</Text>
          </TouchableOpacity>

          {/* Collapsible Environment Switcher & Auto-Detection */}
          {showServerConfig && (
            <View style={styles.serverInputWrap}>
              <Text style={styles.serverHelp}>Select Server Environment:</Text>
              
              {/* 1-Tap Preset Selector Chips */}
              <View style={styles.envChipsRow}>
                <TouchableOpacity
                  disabled={running}
                  style={[styles.envChip, serverEnv === "cloud" && styles.envChipSelected]}
                  onPress={() => {
                    setServerEnv("cloud");
                    setServerUrl(CLOUD_API_URL);
                    checkHealth(CLOUD_API_URL);
                  }}
                >
                  <Text style={[styles.envChipText, serverEnv === "cloud" && styles.envChipTextSelected]}>{"\u2601\uFE0F Cloud (Default)"}</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  disabled={running}
                  style={[styles.envChip, serverEnv === "local" && styles.envChipSelected]}
                  onPress={() => {
                    setServerEnv("local");
                    setServerUrl(LOCAL_API_URL);
                    checkHealth(LOCAL_API_URL);
                  }}
                >
                  <Text style={[styles.envChipText, serverEnv === "local" && styles.envChipTextSelected]}>{"\u{1F4BB} Local Laptop"}</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  disabled={running}
                  style={[styles.envChip, serverEnv === "custom" && styles.envChipSelected]}
                  onPress={() => setServerEnv("custom")}
                >
                  <Text style={[styles.envChipText, serverEnv === "custom" && styles.envChipTextSelected]}>{"\u2699\uFE0F Custom"}</Text>
                </TouchableOpacity>
              </View>

              {/* Active URL Display & Custom Input */}
              <TextInput
                editable={!running && serverEnv === "custom"}
                value={serverUrl}
                onChangeText={(val) => {
                  setServerUrl(val);
                  checkHealth(val);
                }}
                placeholder="https://confpresence-api.onrender.com"
                placeholderTextColor="#8C9BA5"
                style={[styles.serverInput, serverEnv !== "custom" && { backgroundColor: "#F5F7FA" }]}
                autoCapitalize="none"
              />

              {/* Status Banner */}
              <View style={styles.serverStatusBanner}>
                <Text style={styles.serverStatusBannerText}>
                  {serverHealth === "online"
                    ? "\u{1F7E2} Connected & Ready for Presence Tracking"
                    : serverHealth === "offline"
                    ? "\u{1F534} Server unreachable. Check Wi-Fi or backend server."
                    : "\u23F3 Checking connection..."}
                </Text>
              </View>

              {/* Smart Cloud Fallback button when Local is offline */}
              {serverEnv !== "cloud" && serverHealth === "offline" && (
                <TouchableOpacity
                  style={styles.switchCloudBtn}
                  onPress={() => {
                    setServerEnv("cloud");
                    setServerUrl(CLOUD_API_URL);
                    checkHealth(CLOUD_API_URL);
                  }}
                >
                  <Text style={styles.switchCloudBtnText}>{"\u2601\uFE0F Switch Back to Cloud (Recommended)"}</Text>
                </TouchableOpacity>
              )}

              {/* Auto-Detect Local Laptop Button */}
              {serverEnv !== "cloud" && (
                <TouchableOpacity
                  disabled={isAutoDetecting || running}
                  style={styles.autoDetectBtn}
                  onPress={autoDetectServerIP}
                >
                  <Text style={styles.autoDetectBtnText}>
                    {isAutoDetecting ? "\u{1F50D} Scanning Local Subnet..." : "\u{1F50D} Auto-Detect Local Laptop IP"}
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          )}
        </View>

        <Text style={styles.note}>
          Dual-sensor POC: the app uses low-latency BLE mesh peer discovery and ambient Wi-Fi access point fingerprinting for zero-hardware in-room presence estimation.
        </Text>
      </ScrollView>

      {/* Floating Diagnostics Log Button */}
      <TouchableOpacity
        style={styles.floatingLogBtn}
        onPress={() => setShowLogs(true)}
        activeOpacity={0.8}
      >
        <Text style={styles.floatingLogIcon}>{"\u{1F4DC}"}</Text>
        <Text style={styles.floatingLogText}>Logs {logCount > 0 ? `(${logCount})` : ""}</Text>
      </TouchableOpacity>

      {/* Diagnostics Logs Modal Popup */}
      <LogsModal visible={showLogs} onClose={() => setShowLogs(false)} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: "#F7FAFB" },
  container: { padding: 24, gap: 12 },
  title: { fontSize: 28, fontWeight: "700", color: "#173A63" },
  subtitle: { fontSize: 16, color: "#5D6873", marginBottom: 8 },
  label: { color: "#173A63", fontWeight: "700", marginTop: 4 },
  input: {
    borderColor: "#C8D3DA",
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    backgroundColor: "#FFFFFF",
    color: "#173A63",
    fontSize: 16
  },
  roleRow: { flexDirection: "row", justifyContent: "space-between", gap: 12 },
  
  // Room Management Styles
  roomSection: { marginTop: 4, gap: 6 },
  roomHeaderRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  addRoomBtn: { backgroundColor: "#E0F2F1", paddingVertical: 4, paddingHorizontal: 10, borderRadius: 6, borderWidth: 1, borderColor: "#80CBC4" },
  addRoomBtnText: { color: "#00695C", fontSize: 12, fontWeight: "700" },
  roomChipsWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 },
  roomChip: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: "#C8D3DA",
    gap: 6
  },
  roomChipSelected: {
    backgroundColor: "#126D7A",
    borderColor: "#126D7A"
  },
  roomChipText: { fontSize: 13, color: "#173A63", fontWeight: "600" },
  roomChipTextSelected: { color: "#FFFFFF", fontWeight: "700" },
  roomDeleteIcon: { paddingHorizontal: 2 },
  roomDeleteText: { fontSize: 11, color: "#75808A", fontWeight: "700" },
  roomDeleteTextSelected: { color: "#B2EBF2" },
  addRoomInputRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 6 },
  addRoomInput: { flex: 1, borderColor: "#00695C", borderWidth: 1.5, borderRadius: 8, padding: 8, backgroundColor: "#FFFFFF", color: "#173A63", fontSize: 14 },
  addRoomSaveBtn: { backgroundColor: "#00695C", paddingVertical: 8, paddingHorizontal: 12, borderRadius: 8 },
  addRoomSaveText: { color: "#FFFFFF", fontWeight: "700", fontSize: 13 },
  addRoomCancelBtn: { paddingVertical: 8, paddingHorizontal: 8 },
  addRoomCancelText: { color: "#5D6873", fontSize: 13 },

  startRow: { marginTop: 6, flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: "#EAF3F7", padding: 14, borderRadius: 10 },
  startTitle: { color: "#173A63", fontWeight: "700" },
  help: { color: "#5D6873", maxWidth: 230, marginTop: 3 },
  statsCard: {
    backgroundColor: "#E6F4F1",
    borderRadius: 10,
    padding: 16,
    borderWidth: 1,
    borderColor: "#B2DFDB",
    marginTop: 4
  },
  statsHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10
  },
  statsHeader: { fontSize: 16, fontWeight: "700", color: "#00695C" },
  refreshButton: {
    backgroundColor: "#FFFFFF",
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "#80CBC4"
  },
  refreshButtonText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#00695C"
  },
  statsGrid: { flexDirection: "row", justifyContent: "space-around", gap: 12 },
  statBox: { alignItems: "center", backgroundColor: "#FFFFFF", padding: 12, borderRadius: 8, flex: 1, borderWidth: 1, borderColor: "#CFD8DC" },
  statNumber: { fontSize: 26, fontWeight: "800", color: "#126D7A" },
  statLabel: { fontSize: 12, color: "#5D6873", marginTop: 4, textAlign: "center", fontWeight: "600" },
  
  // Table View Styles
  tableContainer: {
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: "#B2DFDB"
  },
  tableTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: "#00695C",
    marginBottom: 8
  },
  tableHeaderRow: {
    flexDirection: "row",
    backgroundColor: "#D7ECE8",
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: 6,
    marginBottom: 4
  },
  tableColHeader: {
    fontSize: 11,
    fontWeight: "700",
    color: "#004D40",
    textTransform: "uppercase"
  },
  tableRow: {
    backgroundColor: "#FFFFFF",
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderRadius: 6,
    marginVertical: 3,
    borderWidth: 1,
    borderColor: "#E0E0E0",
    gap: 4
  },
  tableRowTop: {
    flexDirection: "row",
    alignItems: "center"
  },
  tableRowMetrics: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginTop: 2,
    paddingTop: 4,
    borderTopWidth: 1,
    borderTopColor: "#F0F4F8"
  },
  tableRowMe: {
    backgroundColor: "#E0F2F1",
    borderColor: "#80CBC4"
  },
  tableCellName: {
    fontSize: 12,
    fontWeight: "700",
    color: "#173A63"
  },
  tableCellId: {
    fontSize: 11,
    color: "#5D6873",
    fontFamily: "monospace"
  },
  roleBadge: {
    fontSize: 10,
    fontWeight: "700",
    paddingVertical: 2,
    paddingHorizontal: 6,
    borderRadius: 4,
    overflow: "hidden"
  },
  roleBadgePresenter: {
    backgroundColor: "#E0F7FA",
    color: "#00838F"
  },
  roleBadgeAttendee: {
    backgroundColor: "#ECEFF1",
    color: "#455A64"
  },
  confText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#00695C"
  },
  wifiMatchText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#0D47A1"
  },
  bleMeshText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#4A148C"
  },

  card: { backgroundColor: "#FFFFFF", borderRadius: 10, padding: 16, gap: 6, borderWidth: 1, borderColor: "#D9E3E8" },
  cardTitle: { fontWeight: "700", color: "#126D7A", fontSize: 15 },
  cardText: { color: "#2C3E50", fontSize: 13 },
  error: { color: "#A31D33", fontSize: 13, marginTop: 4 },

  // Server Connection Settings Styles
  serverCard: { backgroundColor: "#F0F4F8", borderRadius: 8, padding: 12, borderWidth: 1, borderColor: "#D0DCE5" },
  serverHeaderRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  serverHeaderText: { fontSize: 12, color: "#173A63", fontWeight: "600" },
  serverToggleText: { fontSize: 12, color: "#00695C", fontWeight: "700" },
  serverInputWrap: { marginTop: 8, gap: 6 },
  serverHelp: { fontSize: 11, color: "#5D6873", fontWeight: "600" },
  envChipsRow: { flexDirection: "row", gap: 8, marginTop: 2, marginBottom: 4 },
  envChip: {
    flex: 1,
    paddingVertical: 6,
    paddingHorizontal: 8,
    backgroundColor: "#FFFFFF",
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: "#C8D3DA",
    alignItems: "center"
  },
  envChipSelected: {
    backgroundColor: "#126D7A",
    borderColor: "#126D7A"
  },
  envChipText: { fontSize: 11, color: "#173A63", fontWeight: "700" },
  envChipTextSelected: { color: "#FFFFFF" },
  serverInput: {
    borderColor: "#B0C4D3",
    borderWidth: 1,
    borderRadius: 6,
    padding: 8,
    backgroundColor: "#FFFFFF",
    color: "#173A63",
    fontSize: 12
  },
  serverStatusBanner: {
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 4,
    backgroundColor: "#E8F5E9"
  },
  serverStatusBannerText: {
    fontSize: 11,
    color: "#2E7D32",
    fontWeight: "600"
  },
  switchCloudBtn: {
    backgroundColor: "#00796B",
    paddingVertical: 7,
    borderRadius: 6,
    alignItems: "center",
    marginTop: 2
  },
  switchCloudBtnText: {
    color: "#FFFFFF",
    fontSize: 11,
    fontWeight: "700"
  },
  autoDetectBtn: {
    backgroundColor: "#455A64",
    paddingVertical: 7,
    borderRadius: 6,
    alignItems: "center",
    marginTop: 2
  },
  autoDetectBtnText: {
    color: "#FFFFFF",
    fontSize: 11,
    fontWeight: "700"
  },

  note: { marginTop: 6, fontSize: 12, lineHeight: 17, color: "#5D6873" },
  // Floating Diagnostics Button
  floatingLogBtn: {
    position: "absolute",
    bottom: 20,
    right: 18,
    backgroundColor: "#161B22",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 24,
    borderWidth: 1.5,
    borderColor: "#00E5FF",
    elevation: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 5
  },
  floatingLogIcon: {
    fontSize: 14
  },
  floatingLogText: {
    color: "#F0F6FC",
    fontSize: 12,
    fontWeight: "800"
  }
});

registerRootComponent(App);
