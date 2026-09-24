import { registerRootComponent } from "expo";
import { StatusBar } from "expo-status-bar";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Button,
  KeyboardAvoidingView,
  Platform,
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
import { PresenceService, RoomRejectedError, type PresenceStatus } from "./src/services/presenceService";
import { getOrCreateDeviceId } from "./src/services/deviceIdentity";
import { clearActiveSession, getActiveSession, saveActiveSession, type ActiveSessionSnapshot } from "./src/services/lastActiveSession";
import { AppLogger } from "./src/services/appLogger";
import { LogsModal } from "./src/components/LogsModal";
import { AdminScreen } from "./src/screens/AdminScreen";
import { LoginScreen } from "./src/screens/LoginScreen";
import { authConfigured, authFetch, signOut, useAuthSession } from "./src/services/auth";
import { registerForPushNotifications } from "./src/services/pushNotifications";

const DEFAULT_SESSION = "poc-session";
const DEFAULT_ROOMS = ["room-a", "room-b", "auditorium"];
const CLOUD_API_URL = "https://xconnect-ytoj.onrender.com";
const LOCAL_API_URL = "http://192.168.0.201:3000";

export default function App() {
  const [role, setRole] = useState<ParticipantRole>("attendee");
  const [sessionId, setSessionId] = useState(DEFAULT_SESSION);
  const [serverEnv, setServerEnv] = useState<"cloud" | "local" | "custom">("cloud");
  const [serverUrl, setServerUrl] = useState(CLOUD_API_URL);
  const [serverHealth, setServerHealth] = useState<"checking" | "online" | "offline">("checking");
  const [showServerConfig, setShowServerConfig] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [rooms, setRooms] = useState<string[]>(DEFAULT_ROOMS);
  const [roomId, setRoomId] = useState("room-a");
  const [detectedRoom, setDetectedRoom] = useState("");
  const [newRoomText, setNewRoomText] = useState("");
  const [showAddRoom, setShowAddRoom] = useState(false);
  const [deviceId, setDeviceId] = useState("");
  const [activeSessions, setActiveSessions] = useState<string[]>([]);
  const [status, setStatus] = useState<PresenceStatus>({ state: "idle", peerCount: 0 });
  const [running, setRunning] = useState(false);
  const runningRef = useRef(false);
  const [roomMembers, setRoomMembers] = useState<RoomMemberInfo[]>([]);
  const [serverConnected, setServerConnected] = useState<boolean | null>(null);
  const [isAutoDetecting, setIsAutoDetecting] = useState(false);
  const [showLogs, setShowLogs] = useState(false);
  const [logCount, setLogCount] = useState(0);
  const [view, setView] = useState<"main" | "admin">("main");
  const { session: authSession, ready: authReady } = useAuthSession();

  const signedIn = Boolean(authSession);
  // The name last confirmed by the server, so an unchanged field doesn't trigger a save.
  const savedNameRef = useRef("");

  // The server knows the effective name (a chosen one if set, otherwise the account's), which the
  // sign-in token alone can't tell us. Depends on signedIn rather than the session object so a
  // token refresh doesn't overwrite a name being typed.
  useEffect(() => {
    if (!signedIn) return;
    let cancelled = false;
    const fallback = authSession?.name ?? "";
    authFetch(`${serverUrl}/api/me`)
      .then((res) => res.json())
      .then((me) => {
        if (cancelled) return;
        const name = me?.name ?? fallback;
        savedNameRef.current = name;
        setDisplayName(name);
        // The provider's token can lag behind a name just set at sign-up, so the server may not
        // have it yet on this very first call. The client already knows it (see auth.ts), so push
        // it through explicitly instead of waiting for the next sign-in to pick up the token claim.
        // Only when no preferredName is set server-side yet — never overwrite a name someone chose.
        const hasPreferredName = me?.name && me?.accountName && me.name !== me.accountName;
        if (fallback && !hasPreferredName && name !== fallback) {
          authFetch(`${serverUrl}/api/me`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ preferredName: fallback })
          })
            .then((res) => res.json())
            .then((data) => {
              if (cancelled) return;
              savedNameRef.current = data?.name ?? fallback;
              setDisplayName(savedNameRef.current);
            })
            .catch(() => {});
        }
      })
      .catch(() => {
        if (cancelled) return;
        savedNameRef.current = fallback;
        setDisplayName(fallback);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedIn, serverUrl]);

  // Registers this device for push notifications once signed in. Re-runs on serverUrl change
  // too, since registration is a POST to that specific server, same as every other API call here.
  useEffect(() => {
    if (!signedIn) return;
    void registerForPushNotifications(serverUrl);
  }, [signedIn, serverUrl]);

  /** Saves the chosen name. Blank clears it, falling back to the account's own name. */
  const saveDisplayName = async () => {
    if (!signedIn || displayName.trim() === savedNameRef.current) return;
    try {
      const res = await authFetch(`${serverUrl}/api/me`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ preferredName: displayName.trim() })
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        Alert.alert("Could not save your name", data?.error ? JSON.stringify(data.error) : `Server returned ${res.status}`);
        setDisplayName(savedNameRef.current);
        return;
      }
      savedNameRef.current = data?.name ?? displayName.trim();
      setDisplayName(savedNameRef.current);
    } catch (err: any) {
      Alert.alert("Could not save your name", err?.message || "Network error");
      setDisplayName(savedNameRef.current);
    }
  };

  useEffect(() => {
    return AppLogger.subscribe((logs) => {
      setLogCount(logs.length);
    });
  }, []);

  const roomRejectedRef = useRef<(message: string) => void>(() => {});
  const service = useMemo(() => new PresenceService(setStatus, (message) => roomRejectedRef.current(message)), []);

  const checkHealth = async (url: string): Promise<boolean> => {
    setServerHealth("checking");
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 2500);
      const res = await fetch(`${url}/health`, { signal: controller.signal });
      clearTimeout(timer);
      if (res.ok) {
        setServerHealth("online");
        setServerConnected(true);
        return true;
      } else {
        setServerHealth("offline");
        setServerConnected(false);
        return false;
      }
    } catch {
      setServerHealth("offline");
      setServerConnected(false);
      return false;
    }
  };

  useEffect(() => {
    getOrCreateDeviceId().then(setDeviceId);
    checkHealth(CLOUD_API_URL);
    return () => {
      runningRef.current = false;
      void service.stop();
    };
  }, [service]);

  // Attendees pick from what's actually live instead of typing a code, so this only matters
  // while they're choosing (not sharing yet) and while they're the role that needs it at all.
  useEffect(() => {
    if (role !== "attendee" || running) return;
    let cancelled = false;
    const fetchActiveSessions = async () => {
      try {
        const res = await authFetch(`${serverUrl}/api/sessions/active`);
        if (cancelled || !res.ok) return;
        const data = await res.json().catch(() => null);
        if (!cancelled && Array.isArray(data?.sessions)) setActiveSessions(data.sessions);
      } catch {
        // Leave the last-known list showing rather than clearing it on a transient error.
      }
    };
    fetchActiveSessions();
    const interval = setInterval(fetchActiveSessions, 5000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [role, running, serverUrl]);

  // Passed explicitly through every step below rather than kept in state — Alert buttons fire
  // well after this render, and reading a snapshot back out of state at that point is exactly
  // the kind of stale/no-op-update trap that broke the rejoin flow before (see acceptRejoin's
  // comment). Threading the same object through every function sidesteps it entirely.
  const acceptRejoin = (snapshot: ActiveSessionSnapshot) => {
    setRole(snapshot.role);
    setRoomId(snapshot.roomId);
    setSessionId(snapshot.sessionId);
    // Passed directly rather than read back from state, since setRole/setRoomId/setSessionId
    // above may be no-ops if the rejoin values equal what was already showing (e.g. this
    // screen's own defaults) — state that doesn't change doesn't trigger anything to notice it.
    void togglePresence(true, snapshot);
  };

  const closeRoomAfterDismiss = async () => {
    void clearActiveSession();
    // Read fresh rather than from the deviceId state variable: this whole chain only ever runs
    // from inside the one-time mount effect below, whose closure was captured on the very first
    // render — before getOrCreateDeviceId() had resolved — and never gets a newer one, no matter
    // how much later this actually fires.
    const myDeviceId = await getOrCreateDeviceId();
    authFetch(`${serverUrl}/api/session/leave`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ deviceId: myDeviceId })
    }).catch(() => {});
  };

  const showRejoinPrompt = (snapshot: ActiveSessionSnapshot) => {
    Alert.alert(
      "Resume presenting?",
      `The app closed while you were presenting "${snapshot.roomId}" (session "${snapshot.sessionId}"). Rejoin where you left off?`,
      [
        { text: "Dismiss", style: "cancel", onPress: () => void confirmDismiss(snapshot) },
        { text: "Rejoin", onPress: () => acceptRejoin(snapshot) }
      ]
    );
  };

  const confirmDismiss = async (snapshot: ActiveSessionSnapshot) => {
    let attendeeCount = 0;
    try {
      const res = await authFetch(`${serverUrl}/api/rooms/${encodeURIComponent(snapshot.roomId)}/live?sessionId=${encodeURIComponent(snapshot.sessionId)}`);
      const data = res.ok ? await res.json().catch(() => null) : null;
      if (Array.isArray(data?.members)) {
        attendeeCount = data.members.filter((m: RoomMemberInfo) => m.role === "attendee").length;
      }
    } catch {
      // Unknown count — the confirmation still works, just without a number to show.
    }

    Alert.alert(
      "Close this room?",
      attendeeCount > 0
        ? `"${snapshot.roomId}" currently has ${attendeeCount} attendee${attendeeCount === 1 ? "" : "s"}. Ending it will disconnect them and record their attendance as ended now.`
        : `"${snapshot.roomId}" has no attendees right now. End it for reporting?`,
      [
        // Cancelling here cancels the *dismiss*, not the rejoin — back to the original choice,
        // not a dead end. Nothing has been cleared or ended yet at this point.
        { text: "Cancel", style: "cancel", onPress: () => showRejoinPrompt(snapshot) },
        { text: "End Room", style: "destructive", onPress: closeRoomAfterDismiss }
      ]
    );
  };

  // Sharing was on when the app last closed without a deliberate stop (force close, crash) —
  // offer to resume exactly where things were left off, but only if that room is still genuinely
  // alive: an admin may well have ended it while the app was gone (a presenter that vanished
  // without a trace looks exactly like one that's abandoned it), and rejoining a room that's
  // already gone would just mint a brand-new, empty occurrence under the same name.
  useEffect(() => {
    (async () => {
      const snapshot = await getActiveSession();
      if (!snapshot) return;
      // Read directly rather than from the deviceId state var, which may not have landed yet —
      // this effect only runs once on mount and would otherwise be stuck with its initial value.
      const myDeviceId = await getOrCreateDeviceId();
      try {
        const res = await authFetch(`${serverUrl}/api/devices/${encodeURIComponent(myDeviceId)}/live?sessionId=${encodeURIComponent(snapshot.sessionId)}`);
        const data = res.ok ? await res.json().catch(() => null) : null;
        if (data?.roomEnded) {
          void clearActiveSession();
          Alert.alert("Room already ended", `"${snapshot.roomId}" was ended while the app was closed.`);
          return;
        }
      } catch {
        // Couldn't reach the server to check — fall through and offer the rejoin anyway; the
        // rejoin attempt itself will surface any real problem.
      }
      showRejoinPrompt(snapshot);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchLiveRoom = async () => {
    if (!runningRef.current) return;

    try {
      const url =
        role === "presenter"
          ? `${serverUrl}/api/rooms/${roomId}/live?sessionId=${sessionId}&deviceId=${deviceId}`
          : `${serverUrl}/api/devices/${deviceId}/live?sessionId=${sessionId}`;

      const res = await authFetch(url);
      if (!runningRef.current) return;

      if (res.ok) {
        setServerConnected(true);
        setServerHealth("online");
        const data = await res.json();
        if (!runningRef.current) return;

        // The room was ended (presenter left, or admin ended the session): stop sharing here too.
        if (data.roomEnded === true) {
          void togglePresence(false);
          Alert.alert("Room ended", "This room was ended, so sharing has been turned off.");
          return;
        }

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
    // Keeps the rejoin snapshot's timestamp fresh for as long as sharing is genuinely alive, so
    // a force close is only offered as a rejoin within REJOIN_WINDOW_MS of the app actually
    // dying — not within that window of whenever sharing happened to start. Presenter-only: an
    // attendee's "membership" is just proximity detection, which resumes on its own the moment
    // sharing is back on — there's nothing structural to restore for them. Piggybacks on the
    // same 3s tick as the live-room poll below rather than running its own separate timer.
    const tick = () => {
      fetchLiveRoom();
      if (role === "presenter") void saveActiveSession({ role, roomId, sessionId });
    };
    tick();
    const interval = setInterval(tick, 3000);
    return () => clearInterval(interval);
  }, [running, role, roomId, sessionId, serverUrl, deviceId]);

  // Overrides let a caller (the rejoin flow) start sharing with values it already knows,
  // instead of setting state and hoping an effect notices the change — setState is a no-op
  // when the new value equals the old one (e.g. rejoining into the same defaults this screen
  // already had), and nothing re-runs in that case.
  const togglePresence = async (enabled: boolean, overrides?: { role: ParticipantRole; roomId: string; sessionId: string }) => {
    const effRole = overrides?.role ?? role;
    const effRoomId = overrides?.roomId ?? roomId;
    const effSessionId = overrides?.sessionId ?? sessionId;
    try {
      if (enabled) {
        // Read fresh rather than trust the deviceId state variable: this function is reachable
        // from the rejoin flow (acceptRejoin), whose whole call chain only ever fires from inside
        // a one-time mount effect frozen at the very first render — before getOrCreateDeviceId()
        // had resolved. Without this, a fast rejoin silently sends an empty deviceId, which fails
        // the server's validation with no logging at all, looking exactly like a dropped request.
        const effDeviceId = deviceId || (await getOrCreateDeviceId());
        // running flips only once the join has actually landed — not before — since
        // fetchLiveRoom's polling effect starts the instant `running` becomes true, and it must
        // never be able to reach the server before this join does (see presenceService.start()).
        await service.start({
          sessionId: effSessionId,
          roomId: effRole === "presenter" ? effRoomId : undefined,
          role: effRole,
          deviceId: effDeviceId,
          displayName: displayName.trim() || undefined,
          apiUrl: serverUrl
        });
        runningRef.current = true;
        setRunning(true);
        if (effRole === "presenter") void saveActiveSession({ role: effRole, roomId: effRoomId, sessionId: effSessionId });
      } else {
        runningRef.current = false;
        setRunning(false);
        await service.stop();
        setRoomMembers([]);
        setDetectedRoom("");
        setServerConnected(null);
        void clearActiveSession();
      }
    } catch (error) {
      runningRef.current = false;
      setRunning(false);
      setRoomMembers([]);
      setDetectedRoom("");
      setServerConnected(null);
      // A failed start() can still have already joined server-side before the failure (e.g.
      // joinSession succeeds over HTTP, then BLE setup throws right after — Bluetooth off and
      // the enable prompt dismissed is the common case). Without this, the server keeps showing
      // a presenter that joined once and never sent another update, until it goes stale on its
      // own ~60s later — exactly the "started, then goes to Presenter offline" symptom. stop()
      // is safe to call even when nothing actually started (RoomRejectedError case included):
      // every internal cleanup step it does is already itself guarded/no-op-safe.
      void service.stop();
      if (error instanceof RoomRejectedError) {
        Alert.alert("Room already has a presenter", error.message);
      } else {
        Alert.alert("Unable to start BLE", error instanceof Error ? error.message : "Unknown BLE error");
      }
    }
  };

  roomRejectedRef.current = (message: string) => {
    void togglePresence(false);
    Alert.alert("Room already has a presenter", message);
  };

  const handleToggleSwitch = async (enabled: boolean) => {
    // Not a Wi-Fi-specific check on purpose: the real problem is "can this device reach the
    // selected server at all," which Wi-Fi being off only causes in Local mode (a LAN-only
    // address) — someone on Cloud mode with Wi-Fi off but cellular on is completely fine.
    // Re-checked live here rather than trusting the cached serverHealth state, since that's only
    // ever refreshed at launch or on a manual server-picker tap — stale by the time someone
    // actually flips the switch, e.g. if Wi-Fi was on at launch and got turned off since. Without
    // this, join/observations fail silently server-side while BLE genuinely starts locally — a
    // "phantom presenting" state that looks successful on this device but never created anything
    // server-side.
    if (enabled) {
      const reachable = await checkHealth(serverUrl);
      if (!reachable) {
        Alert.alert("Can't reach the server", "The selected server appears offline — check your connection or switch servers before sharing.");
        return;
      }
    }
    if (enabled && role === "attendee" && !activeSessions.includes(sessionId)) {
      // Joining under a session that isn't actually live fails silently server-side (its
      // /api/session/join and /api/observations calls just get rejected, with the toggle still
      // flipping on locally and BLE scanning genuinely starting) — block it here instead of
      // letting that happen invisibly.
      Alert.alert("Pick an active session first", "There's no active session selected — choose one from the list before sharing.");
      return;
    }
    if (!enabled && role === "presenter") {
      Alert.alert(
        "Stop Sharing?",
        "You're the presenter for this room — stopping closes it for everyone currently in it. Attendees will be disconnected and their attendance will be recorded as ended now.",
        [
          { text: "Cancel", style: "cancel" },
          { text: "Stop & Close Room", style: "destructive", onPress: () => togglePresence(false) }
        ]
      );
      return;
    }
    togglePresence(enabled);
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

  if (authConfigured && !authReady) return null;
  if (authConfigured && !authSession) return <LoginScreen />;

  if (view === "admin") {
    return <AdminScreen serverUrl={serverUrl} sessionId={sessionId} onBack={() => setView("main")} />;
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="dark" />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={Platform.OS === "android" ? 24 : 0}
      >
        <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
          <Text style={styles.title}>XConnect</Text>
          <Text style={styles.subtitle}>Zero-Hardware Quad-Sensor Presence Engine</Text>

          <Text style={styles.label}>Role</Text>
          <View style={styles.roleRow}>
            <Button title="Attendee" onPress={() => setRole("attendee")} color={role === "attendee" ? "#126D7A" : "#75808A"} disabled={running}  />
            <Button title="Presenter" onPress={() => setRole("presenter")} color={role === "presenter" ? "#126D7A" : "#75808A"} disabled={running} />
            <Button title="Admin" onPress={() => setView("admin")} color="#173A63" />
          </View>

          {authSession ? (
            <View style={styles.signedInRow}>
              <Text style={[styles.label, styles.signedInText]} numberOfLines={1} ellipsizeMode="tail">
                Signed in as {authSession.email || "you"}
              </Text>
              <View style={styles.signOutBtn}>
                <Button title="Sign out" onPress={() => void signOut()} color="#75808A" disabled={running} />
              </View>
            </View>
          ) : (
            <Text style={styles.label}>Your name (optional)</Text>
          )}
          <TextInput
            editable={!running}
            value={displayName}
            onChangeText={setDisplayName}
            onEndEditing={() => void saveDisplayName()}
            placeholder={signedIn ? "Display name (blank uses your account name)" : "e.g. Alice, Bob, Dr. Smith"}
            placeholderTextColor="#8C9BA5"
            style={styles.input}
            autoCapitalize="words"
            returnKeyType="done"
          />

          <Text style={styles.label}>Session code</Text>
          {role === "attendee" ? (
            activeSessions.length === 0 ? (
              <Text style={styles.noActiveSessionsText}>No active sessions right now.</Text>
            ) : (
              <View style={styles.roomChipsWrap}>
                {activeSessions.map((s) => {
                  const isSelected = s === sessionId;
                  return (
                    <TouchableOpacity
                      key={s}
                      disabled={running}
                      style={[styles.roomChip, isSelected && styles.roomChipSelected]}
                      onPress={() => setSessionId(s)}
                      activeOpacity={0.7}
                    >
                      <Text style={[styles.roomChipText, isSelected && styles.roomChipTextSelected]}>{s}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            )
          ) : (
            <TextInput
              editable={!running}
              value={sessionId}
              onChangeText={setSessionId}
              placeholder="e.g. poc-session"
              placeholderTextColor="#8C9BA5"
              style={styles.input}
              autoCapitalize="none"
            />
          )}

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
            <Switch
              value={running}
              onValueChange={handleToggleSwitch}
              disabled={!running && role === "attendee" && !activeSessions.includes(sessionId)}
            />
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
                <Text style={styles.statNumber} numberOfLines={1}>
                  {running && roomMembers.length > 0
                    ? Math.max(0, roomMembers.length - 1)
                    : 0}
                </Text>
                <Text style={styles.statLabel} numberOfLines={1}>BLE Peers</Text>
              </View>
              <View style={styles.statBox}>
                <Text style={styles.statNumber} numberOfLines={1}>{status.wifiApCount ?? 0}</Text>
                <Text style={styles.statLabel} numberOfLines={1}>Wi-Fi APs</Text>
              </View>
              <View style={styles.statBox}>
                <Text
                  style={[styles.statNumber, { fontSize: 11 }]}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                >
                  {role === "presenter"
                    ? (running ? "🔊 Pulse" : "🔊 Off")
                    : status.ultrasonicState === "verified"
                      ? "🔊 Gate OK"
                      : running
                        ? "🔊 Scan"
                        : "🔊 Off"}
                </Text>
                <Text style={styles.statLabel} numberOfLines={1}>Ultrasonic</Text>
              </View>
              <View style={styles.statBox}>
                <Text style={styles.statNumber} numberOfLines={1}>{roomMembers.length}</Text>
                <Text style={styles.statLabel} numberOfLines={2}>
                  {role === "presenter"
                    ? `Room (${roomId})`
                    : detectedRoom
                      ? `Room (${detectedRoom})`
                      : "Room (...)"}
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

                      {/* Sensor Metrics Row: Coexistence badges for Confidence, BLE, Wi-Fi, Ultrasonic, & Motion */}
                      <View style={styles.tableRowMetrics}>
                        <Text style={styles.confText}>{"\u{1F3AF} " + confPct + "% Conf"}</Text>
                        <Text style={styles.bleMeshText}>{"\u{1F4E1} BLE Active"}</Text>
                        {isHost ? (
                          <Text style={styles.wifiMatchText}>{"\u{1F4F6} Wi-Fi Anchor"}</Text>
                        ) : wifiPct != null ? (
                          <Text style={styles.wifiMatchText}>{"\u{1F4F6} Wi-Fi: " + wifiPct + "% match"}</Text>
                        ) : null}
                        {member.ultrasonicVerified && (
                          <Text style={styles.ultrasonicMatchText}>{"\u{1F50A} Hard Gate Verified"}</Text>
                        )}
                        {member.motionAnomalyFlag && (
                          <Text style={styles.anomalyText}>{"\u26A0\uFE0F Inactivity flag"}</Text>
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
            {role === "presenter" && (
              <Text style={styles.cardText}>
                Ultrasonic Gate: {running ? `Broadcasting ('${roomId}')` : "Idle"}
              </Text>
            )}
            {role === "attendee" && (
              <Text style={styles.cardText}>
                Ultrasonic Gate: {status.ultrasonicState === "verified" ? `Verified ('${status.ultrasonicToken}') ✅` : running ? "Listening (18.5-19.5 kHz)" : "Idle"}
              </Text>
            )}
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
                  placeholder="https://xconnect-api.onrender.com"
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
            Quad-sensor presence: XConnect fuses low-latency BLE mesh peer discovery, ambient Wi-Fi access point fingerprinting, IMU motion dynamics, and ultrasonic acoustic boundary gates for zero-hardware in-room presence verification.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>

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
  safeArea: {
    flex: 1,
    backgroundColor: "#F7FAFB",
    paddingTop: Platform.OS === "android" ? 10 : 0
  },
  container: { padding: 20, gap: 12 },
  title: { fontSize: 28, fontWeight: "700", color: "#173A63" },
  subtitle: { fontSize: 15, color: "#5D6873", marginBottom: 6, fontWeight: "600" },
  label: { color: "#173A63", fontWeight: "700", marginTop: 4 },
  noActiveSessionsText: { color: "#75808A", fontSize: 13, fontStyle: "italic", marginTop: 4 },
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
  signedInRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  signedInText: { flexShrink: 1, minWidth: 0 },
  signOutBtn: { flexShrink: 0 },

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
    padding: 14,
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
  statsHeader: { fontSize: 15, fontWeight: "700", color: "#00695C" },
  refreshButton: {
    backgroundColor: "#FFFFFF",
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "#80CBC4"
  },
  refreshButtonText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#00695C"
  },
  statsGrid: { flexDirection: "row", justifyContent: "space-between", gap: 6 },
  statBox: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFFFFF",
    paddingVertical: 10,
    paddingHorizontal: 4,
    borderRadius: 8,
    flex: 1,
    borderWidth: 1,
    borderColor: "#CFD8DC"
  },
  statNumber: { fontSize: 18, fontWeight: "800", color: "#126D7A" },
  statLabel: { fontSize: 10.5, color: "#5D6873", marginTop: 4, textAlign: "center", fontWeight: "600" },

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
    flexWrap: "wrap",
    alignItems: "center",
    gap: 6,
    marginTop: 4,
    paddingTop: 6,
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
    fontSize: 10.5,
    fontWeight: "700",
    color: "#00695C",
    backgroundColor: "#E0F2F1",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4
  },
  bleMeshText: {
    fontSize: 10.5,
    fontWeight: "700",
    color: "#4A148C",
    backgroundColor: "#F3E5F5",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4
  },
  wifiMatchText: {
    fontSize: 10.5,
    fontWeight: "700",
    color: "#0D47A1",
    backgroundColor: "#E3F2FD",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4
  },
  ultrasonicMatchText: {
    fontSize: 10.5,
    color: "#004D40",
    fontWeight: "700",
    backgroundColor: "#B2DFDB",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4
  },
  anomalyText: {
    fontSize: 10.5,
    fontWeight: "700",
    color: "#B45309",
    backgroundColor: "#FEF3C7",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4
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
  },
});

registerRootComponent(App);
