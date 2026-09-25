import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import {
  Alert,
  Platform,
  SafeAreaView,
  StatusBar,
  StyleSheet,
  View,
} from 'react-native';
import { registerRootComponent } from 'expo';
import { StatusBar as ExpoStatusBar } from 'expo-status-bar';
import type { ParticipantRole, RoomMemberInfo, LiveRoomState } from '@confpresence/shared';
import { getAcousticTokenForRoom, getRoomForAcousticToken } from '@confpresence/shared';
import { PresenceService, RoomRejectedError, type PresenceStatus } from './src/services/presenceService';
import { getOrCreateDeviceId } from './src/services/deviceIdentity';
import {
  clearActiveSession,
  getActiveSession,
  saveActiveSession,
  type ActiveSessionSnapshot,
} from './src/services/lastActiveSession';
import { authConfigured, authFetch, signOut, useAuthSession } from './src/services/auth';
import { registerForPushNotifications } from './src/services/pushNotifications';
import { ThemeProvider, useTheme } from './src/theme/useTheme';
import { BottomNav, MobileScreen, Role } from './src/components/navigation/BottomNav';
import { DevScreenSwitcher } from './src/components/navigation/DevScreenSwitcher';

// Screens
import { LaunchScreen } from './src/screens/auth/LaunchScreen';
import { OnboardingScreen } from './src/screens/auth/OnboardingScreen';
import { PermissionsScreen } from './src/screens/auth/PermissionsScreen';
import { LoginScreen } from './src/screens/auth/LoginScreen';
import { CreateAccountScreen } from './src/screens/auth/CreateAccountScreen';
import { HomeScreen } from './src/screens/common/HomeScreen';
import { ProfileScreen } from './src/screens/common/ProfileScreen';
import { PresenterSetupScreen } from './src/screens/presenter/PresenterSetupScreen';
import { PresenterDashboardScreen } from './src/screens/presenter/PresenterDashboardScreen';
import { PresenterRosterScreen } from './src/screens/presenter/PresenterRosterScreen';
import { SessionEndScreen } from './src/screens/presenter/SessionEndScreen';
import { AttendeeDiscoveryScreen } from './src/screens/attendee/AttendeeDiscoveryScreen';
import { AttendeeConfirmedScreen } from './src/screens/attendee/AttendeeConfirmedScreen';
import { AttendeeOutOfRangeScreen } from './src/screens/attendee/AttendeeOutOfRangeScreen';
import { AdminOverviewScreen } from './src/screens/admin/AdminOverviewScreen';
import { AdminRoomDetailScreen } from './src/screens/admin/AdminRoomDetailScreen';
import { AdminNotifyScreen } from './src/screens/admin/AdminNotifyScreen';
import { DiagnosticsScreen } from './src/screens/admin/DiagnosticsScreen';
import { EdgeStateScreen } from './src/screens/admin/EdgeStateScreen';

const DEFAULT_SESSION = 'poc-session';
const DEFAULT_ROOMS = ['Hall A', 'Workshop 1', 'Auditorium', 'Room B'];
const CLOUD_API_URL = 'https://xconnect-ytoj.onrender.com';
const LOCAL_API_URL = 'http://192.168.0.201:3000';

const NAV_SCREENS: MobileScreen[] = [
  'home',
  'profile',
  'presenterSetup',
  'presenterDashboard',
  'presenterRoster',
  'sessionEnd',
  'attendeeDiscovery',
  'attendeeConfirmed',
  'attendeeOutOfRange',
  'adminOverview',
  'adminRoomDetail',
  'adminNotify',
  'diagnostics',
  'edgeState',
];

function MainApp() {
  const { colors, theme, hasOnboarded, markOnboarded } = useTheme();
  const isDark = theme === 'dark';

  // Navigation State
  const [screen, setScreen] = useState<MobileScreen>('launch');
  const [role, setRole] = useState<Role>('attendee');
  const [selectedAdminRoom, setSelectedAdminRoom] = useState<LiveRoomState | null>(null);
  const [adminRooms, setAdminRooms] = useState<LiveRoomState[]>([]);
  const [adminError, setAdminError] = useState<string | null>(null);
  // Running max of members.length seen per room across admin polls this session — the server
  // doesn't track a peak, so this is a real (if session-scoped, not lifetime) observed high.
  const [adminRoomPeaks, setAdminRoomPeaks] = useState<Record<string, number>>({});

  // Backend & Session State
  const [sessionId, setSessionId] = useState(DEFAULT_SESSION);
  const [serverEnv, setServerEnv] = useState<'cloud' | 'local' | 'custom'>('cloud');
  const [serverUrl, setServerUrl] = useState(CLOUD_API_URL);
  const [serverHealth, setServerHealth] = useState<'checking' | 'online' | 'offline'>('checking');
  const [serverConnected, setServerConnected] = useState<boolean | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [rooms, setRooms] = useState<string[]>(DEFAULT_ROOMS);
  const [roomId, setRoomId] = useState('Hall A');
  const [detectedRoom, setDetectedRoom] = useState('');
  const [deviceId, setDeviceId] = useState('');
  const [running, setRunning] = useState(false);
  const runningRef = useRef(false);
  const [status, setStatus] = useState<PresenceStatus>({ state: 'idle', peerCount: 0 });
  const [roomMembers, setRoomMembers] = useState<RoomMemberInfo[]>([]);
  const [sessionStartTime, setSessionStartTime] = useState<number>(Date.now());
  const [sessionDurationMs, setSessionDurationMs] = useState<number>(0);

  // Auth Hook
  const { session: authSession, ready: authReady } = useAuthSession();
  const signedIn = Boolean(authSession);
  const savedNameRef = useRef('');

  const nav = useCallback((s: MobileScreen) => {
    setScreen(s);
  }, []);

  const roomRejectedRef = useRef<(message: string) => void>(() => {});
  const service = useMemo(
    () => new PresenceService(setStatus, message => roomRejectedRef.current(message)),
    []
  );

  // Health check
  const checkHealth = async (url: string) => {
    setServerHealth('checking');
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 2500);
      const res = await fetch(`${url}/health`, { signal: controller.signal });
      clearTimeout(timer);
      if (res.ok) {
        setServerHealth('online');
        setServerConnected(true);
      } else {
        setServerHealth('offline');
        setServerConnected(false);
      }
    } catch {
      setServerHealth('offline');
      setServerConnected(false);
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

  // Sync Preferred Name
  useEffect(() => {
    if (!signedIn) return;
    let cancelled = false;
    const fallback = authSession?.name ?? '';
    authFetch(`${serverUrl}/api/me`)
      .then(res => res.json())
      .then(me => {
        if (cancelled) return;
        const name = me?.name ?? fallback;
        savedNameRef.current = name;
        setDisplayName(name);
      })
      .catch(() => {
        if (cancelled) return;
        savedNameRef.current = fallback;
        setDisplayName(fallback);
      });
    return () => {
      cancelled = true;
    };
  }, [signedIn, serverUrl, authSession]);

  // Registers this device for push notifications once signed in. Re-runs on serverUrl change
  // too, since registration is a POST to that specific server, same as every other API call here.
  useEffect(() => {
    if (!signedIn) return;
    void registerForPushNotifications(serverUrl);
  }, [signedIn, serverUrl]);

  const saveDisplayName = async (newName: string) => {
    try {
      const res = await authFetch(`${serverUrl}/api/me`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ preferredName: newName.trim() }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok) {
        savedNameRef.current = data?.name ?? newName.trim();
        setDisplayName(savedNameRef.current);
      }
    } catch (err: any) {
      throw new Error(err?.message || 'Network error');
    }
  };

  // Instant Acoustic Token Resolver
  useEffect(() => {
    if (status.ultrasonicToken) {
      const resolved = getRoomForAcousticToken(status.ultrasonicToken, rooms);
      if (resolved) {
        setDetectedRoom(resolved);
      }
    }
  }, [status.ultrasonicToken, rooms]);

  // Switch server environment
  const handleSelectServerEnv = (env: 'cloud' | 'local' | 'custom', customUrl?: string) => {
    setServerEnv(env);
    const newUrl = env === 'cloud' ? CLOUD_API_URL : env === 'local' ? LOCAL_API_URL : (customUrl || CLOUD_API_URL);
    setServerUrl(newUrl);
    checkHealth(newUrl);
  };

  // Toggle Presence Engine
  const togglePresence = async (overrideRunning?: boolean, explicitSnapshot?: ActiveSessionSnapshot) => {
    const targetRunning = overrideRunning ?? !runningRef.current;
    if (targetRunning) {
      try {
        const activeRoom = explicitSnapshot?.roomId ?? roomId;
        const activeSession = explicitSnapshot?.sessionId ?? sessionId;
        const activeRole = (explicitSnapshot?.role ?? role) as ParticipantRole;

        setSessionStartTime(Date.now());

        await service.start({
          role: activeRole,
          roomId: activeRoom,
          sessionId: activeSession,
          displayName: displayName || 'Participant',
          deviceId: deviceId || (await getOrCreateDeviceId()),
          apiUrl: serverUrl,
        });

        runningRef.current = true;
        setRunning(true);

        if (activeRole === 'presenter') {
          void saveActiveSession({
            role: 'presenter',
            roomId: activeRoom,
            sessionId: activeSession,
          });
        }
      } catch (err: any) {
        Alert.alert('Session Error', err?.message || 'Could not initiate presence service');
      }
    } else {
      setSessionDurationMs(Date.now() - sessionStartTime);
      runningRef.current = false;
      setRunning(false);
      void clearActiveSession();
      await service.stop();
    }
  };

  // Real-Time Live Room & Headcount Polling
  const fetchLiveRoom = useCallback(async () => {
    if (!runningRef.current) return;

    try {
      const effDeviceId = deviceId || (await getOrCreateDeviceId());
      const url =
        role === 'presenter'
          ? `${serverUrl}/api/rooms/${encodeURIComponent(roomId)}/live?sessionId=${encodeURIComponent(sessionId)}&deviceId=${encodeURIComponent(effDeviceId)}`
          : `${serverUrl}/api/devices/${encodeURIComponent(effDeviceId)}/live?sessionId=${encodeURIComponent(sessionId)}`;

      const res = await authFetch(url);
      if (!runningRef.current) return;

      if (res.ok) {
        setServerConnected(true);
        setServerHealth('online');
        const data = await res.json();
        if (!runningRef.current) return;

        // Session was ended
        if (data.roomEnded === true) {
          void togglePresence(false);
          nav('home');
          Alert.alert('Room ended', 'This session has ended.');
          return;
        }

        if (data.roomId && data.roomId !== 'unknown') {
          setDetectedRoom(data.roomId);
        }

        let fetchedMembers: RoomMemberInfo[] = [];
        if (Array.isArray(data.members)) {
          fetchedMembers = data.members;
        } else if (Array.isArray(data.estimatedMemberDeviceIds)) {
          fetchedMembers = data.estimatedMemberDeviceIds.map((id: string) => ({
            deviceId: id,
            displayName: id,
            role: 'attendee',
          }));
        }

        // Host inclusion for presenter
        if (role === 'presenter') {
          const hasHost = fetchedMembers.some(m => m.deviceId === effDeviceId);
          if (!hasHost) {
            fetchedMembers.unshift({
              deviceId: effDeviceId,
              displayName: displayName.trim() || 'Host',
              role: 'presenter',
              confidence: 1.0,
              durationMs: Date.now() - sessionStartTime,
            });
          }
        }

        setRoomMembers(fetchedMembers);
      } else {
        setServerConnected(false);
        setServerHealth('offline');
      }
    } catch {
      if (runningRef.current) {
        setServerConnected(false);
        setServerHealth('offline');
      }
    }
  }, [role, roomId, sessionId, serverUrl, deviceId, displayName, sessionStartTime, nav]);

  // 3-Second Live Polling Interval
  useEffect(() => {
    if (!running) {
      runningRef.current = false;
      setRoomMembers([]);
      setDetectedRoom('');
      return;
    }

    runningRef.current = true;
    if (role === 'presenter' && deviceId) {
      setRoomMembers([
        {
          deviceId,
          displayName: displayName.trim() || 'Host',
          role: 'presenter',
          confidence: 1.0,
          durationMs: 0,
        },
      ]);
    }

    const tick = () => {
      void fetchLiveRoom();
      if (role === 'presenter') {
        void saveActiveSession({ role, roomId, sessionId });
      }
    };

    tick();
    const interval = setInterval(tick, 3000);
    return () => clearInterval(interval);
  }, [running, role, roomId, sessionId, fetchLiveRoom, deviceId, displayName]);

  // Attendee Live Session Discovery on Home
  useEffect(() => {
    if (role !== 'attendee' || running) return;
    let cancelled = false;
    const fetchActiveSessions = async () => {
      try {
        const res = await authFetch(`${serverUrl}/api/sessions/active`);
        if (cancelled || !res.ok) return;
        const data = await res.json().catch(() => null);
        if (!cancelled && Array.isArray(data?.sessions) && data.sessions.length > 0) {
          const activeRoom = data.sessions[0].roomId;
          if (activeRoom && activeRoom !== roomId) {
            setRoomId(activeRoom);
          }
        }
      } catch {
        // Ignore transient errors
      }
    };
    void fetchActiveSessions();
    const interval = setInterval(fetchActiveSessions, 5000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [role, running, serverUrl, roomId]);

  // Admin Live Overview Polling — every active room across every session, refreshed on the same
  // 5s cadence the old single-screen admin view used. Runs whenever the admin role is selected,
  // not just while on the overview/detail screens, so switching between them doesn't restart it.
  useEffect(() => {
    if (role !== 'admin') return;
    let cancelled = false;
    const fetchOverview = async () => {
      try {
        const res = await authFetch(`${serverUrl}/api/admin/overview`);
        if (cancelled) return;
        if (!res.ok) {
          setAdminError(res.status === 403 ? 'This account is not an admin.' : `Server returned ${res.status}`);
          return;
        }
        const data = await res.json().catch(() => null);
        if (cancelled) return;
        setAdminError(null);
        const rooms: LiveRoomState[] = Array.isArray(data?.rooms) ? data.rooms : [];
        setAdminRooms(rooms);
        setAdminRoomPeaks(prev => {
          const next = { ...prev };
          for (const r of rooms) {
            const key = `${r.sessionId}::${r.roomId}`;
            const count = r.members?.length ?? 0;
            next[key] = Math.max(next[key] ?? 0, count);
          }
          return next;
        });
      } catch {
        if (!cancelled) setAdminError('Unable to reach the server.');
      }
    };
    void fetchOverview();
    const interval = setInterval(fetchOverview, 5000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [role, serverUrl]);

  // Presenter Rejoin flow on app launch
  useEffect(() => {
    (async () => {
      const snapshot = await getActiveSession();
      if (!snapshot) return;
      const myDeviceId = await getOrCreateDeviceId();
      try {
        const res = await authFetch(
          `${serverUrl}/api/devices/${encodeURIComponent(myDeviceId)}/live?sessionId=${encodeURIComponent(snapshot.sessionId)}`
        );
        const data = res.ok ? await res.json().catch(() => null) : null;
        if (data?.roomEnded) {
          void clearActiveSession();
          return;
        }
      } catch {
        // Ignore
      }

      Alert.alert(
        'Resume presenting?',
        `The app was presenting "${snapshot.roomId}" (session "${snapshot.sessionId}"). Rejoin where you left off?`,
        [
          {
            text: 'Dismiss',
            style: 'cancel',
            onPress: () => void clearActiveSession(),
          },
          {
            text: 'Rejoin',
            onPress: () => {
              setRole(snapshot.role as Role);
              setRoomId(snapshot.roomId);
              setSessionId(snapshot.sessionId);
              void togglePresence(true, snapshot);
              nav('presenterDashboard');
            },
          },
        ]
      );
    })();
  }, []);

  // The launch animation runs on its own fixed timer (or can be skipped early by a tap),
  // completely independent of how long SecureStore/auth-session restoration actually takes to
  // resolve. Routing the moment the animation finishes used to read hasOnboarded/signedIn
  // before they'd settled from their initial "still loading" values (null / not-yet-ready),
  // which could send an already-signed-in user to the login screen on a slow cold start or a
  // skipped animation. Splitting "animation finished" from "we actually know where to go"
  // fixes that: this effect only navigates once every piece of state it needs has resolved.
  const [launchAnimationDone, setLaunchAnimationDone] = useState(false);
  const handleLaunchComplete = () => setLaunchAnimationDone(true);

  useEffect(() => {
    if (screen !== 'launch') return;
    if (!launchAnimationDone || hasOnboarded === null || !authReady) return;
    if (hasOnboarded === false) {
      nav('onboarding');
    } else {
      nav(signedIn ? 'home' : 'login');
    }
  }, [screen, launchAnimationDone, hasOnboarded, authReady, signedIn]);

  // Ends the currently-selected admin room via the real backend action — the only primitive
  // this API exposes is ending the whole room occurrence (attendees included); there's no way
  // to remove just the presenter and keep the room open, which is why the admin UI only offers
  // one real close action rather than a separate (and undeliverable) "evict presenter" button.
  const handleEndAdminRoom = async () => {
    if (!selectedAdminRoom) return;
    try {
      const res = await authFetch(`${serverUrl}/api/admin/rooms/end`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId: selectedAdminRoom.sessionId, roomId: selectedAdminRoom.roomId }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.ended) {
        setSelectedAdminRoom(null);
        nav('adminOverview');
      } else {
        Alert.alert('Could not end room', 'The room may have already ended on its own.');
      }
    } catch (err: any) {
      Alert.alert('Network error', err?.message || 'Could not reach the server.');
    }
  };

  // Sends a push notification to whoever's signed in under the given emails. Throws on failure
  // (network error, non-2xx, or push not configured server-side) so AdminNotifyScreen's own
  // try/catch can show the error inline rather than this owning that UI concern.
  const handleSendNotification = async (emails: string[], title: string, message: string) => {
    const res = await authFetch(`${serverUrl}/api/admin/notifications/send`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ emails, title, message }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      throw new Error(data?.error ? JSON.stringify(data.error) : `Server returned ${res.status}`);
    }
    return { matchedEmails: data.matchedEmails ?? [], unmatchedEmails: data.unmatchedEmails ?? [] };
  };

  // Every known account with an email, for the Notify screen's recipient picker — fetched once
  // when that screen mounts, not polled, since the user list doesn't change fast enough to need it.
  const handleFetchUsers = async () => {
    const res = await authFetch(`${serverUrl}/api/admin/users`);
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      throw new Error(data?.error ? JSON.stringify(data.error) : `Server returned ${res.status}`);
    }
    return (data.users ?? []) as { id: string; email: string; name: string }[];
  };

  const showNav = NAV_SCREENS.includes(screen);

  const renderScreen = () => {
    switch (screen) {
      case 'launch':
        return <LaunchScreen onComplete={handleLaunchComplete} />;
      case 'onboarding':
        return <OnboardingScreen onNavigate={nav} />;
      case 'permissions':
        return (
          <PermissionsScreen
            onNavigate={nav}
            onGrantAll={async () => {
              await markOnboarded();
            }}
          />
        );
      case 'login':
        return (
          <LoginScreen
            onNavigate={nav}
            onSuccess={() => {
              void markOnboarded();
              nav('home');
            }}
          />
        );
      case 'createAccount':
        return (
          <CreateAccountScreen
            onNavigate={nav}
            onSuccess={() => {
              void markOnboarded();
              nav('home');
            }}
          />
        );
      case 'home':
        return (
          <HomeScreen
            displayName={displayName}
            role={role}
            onSelectRole={setRole}
            onNavigate={nav}
            serverConnected={serverConnected}
            serverEnv={serverEnv}
            rooms={rooms}
            selectedRoom={roomId}
            onSelectRoom={setRoomId}
            onStartPresence={() => void togglePresence(true)}
          />
        );
      case 'profile':
        return (
          <ProfileScreen
            displayName={displayName}
            onSaveDisplayName={saveDisplayName}
            userEmail={authSession?.email}
            role={role}
            deviceId={deviceId}
            serverEnv={serverEnv}
            serverUrl={serverUrl}
            onSelectServerEnv={handleSelectServerEnv}
            onNavigate={nav}
            onSignOut={() => setScreen('login')}
          />
        );
      case 'presenterSetup':
        return (
          <PresenterSetupScreen
            rooms={rooms}
            selectedRoom={roomId}
            onSelectRoom={setRoomId}
            sessionId={sessionId}
            onSetSessionId={setSessionId}
            onStartBroadcast={(r, s) => {
              setRoomId(r);
              setSessionId(s);
              void togglePresence(true);
            }}
            onNavigate={nav}
          />
        );
      case 'presenterDashboard':
        return (
          <PresenterDashboardScreen
            roomId={roomId}
            sessionId={sessionId}
            acousticToken={getAcousticTokenForRoom(roomId)}
            roomMembers={roomMembers}
            running={running}
            onStopBroadcast={() => void togglePresence(false)}
            onNavigate={nav}
          />
        );
      case 'presenterRoster':
        return (
          <PresenterRosterScreen
            roomId={roomId}
            roomMembers={roomMembers}
            onNavigate={nav}
          />
        );
      case 'sessionEnd': {
        const attendeesOnly = roomMembers.filter(m => m.role === 'attendee');
        const ultraCount = attendeesOnly.filter(m => m.ultrasonicVerified).length;
        const acousticPct = attendeesOnly.length > 0 ? Math.round((ultraCount / attendeesOnly.length) * 100) : 100;
        const avgWifi = attendeesOnly.length > 0
          ? Math.round(
              (attendeesOnly.reduce((sum, m) => sum + (m.wifiSimilarity ?? 0.98), 0) / attendeesOnly.length) * 100
            )
          : 98;

        return (
          <SessionEndScreen
            roomId={roomId}
            sessionId={sessionId}
            totalAttendees={attendeesOnly.length}
            durationMs={sessionDurationMs || (Date.now() - sessionStartTime)}
            acousticMatchPercent={acousticPct}
            wifiSimilarityPercent={avgWifi}
            onNavigate={nav}
          />
        );
      }
      case 'attendeeDiscovery':
        return (
          <AttendeeDiscoveryScreen
            targetRoom={roomId}
            detectedRoom={detectedRoom}
            acousticToken={status.ultrasonicToken}
            peerCount={status.peerCount}
            wifiApCount={status.wifiApCount}
            ultrasonicState={status.ultrasonicState}
            running={running}
            onJoinDetectedRoom={r => {
              setRoomId(r);
              void togglePresence(true, {
                role: 'attendee',
                roomId: r,
                sessionId,
                updatedAt: Date.now(),
              });
            }}
            onNavigate={nav}
          />
        );
      case 'attendeeConfirmed':
        return (
          <AttendeeConfirmedScreen
            roomId={detectedRoom || roomId}
            sessionId={sessionId}
            hostName={roomMembers.find(m => m.role === 'presenter')?.displayName || 'Anchor Host'}
            confidence={roomMembers.find(m => m.deviceId === deviceId)?.confidence ?? 1.0}
            wifiSimilarity={roomMembers.find(m => m.deviceId === deviceId)?.wifiSimilarity}
            wifiApCount={status.wifiApCount}
            ultrasonicVerified={status.ultrasonicState === 'verified' || Boolean(roomMembers.find(m => m.deviceId === deviceId)?.ultrasonicVerified)}
            sessionStartTime={sessionStartTime}
            onLeaveRoom={() => void togglePresence(false)}
            onNavigate={nav}
          />
        );
      case 'attendeeOutOfRange':
        return (
          <AttendeeOutOfRangeScreen
            roomId={roomId}
            onRejoin={() => void togglePresence(true)}
            onLeave={() => void togglePresence(false)}
            onNavigate={nav}
          />
        );
      case 'adminOverview':
        return (
          <AdminOverviewScreen
            rooms={adminRooms}
            error={adminError}
            onSelectRoom={setSelectedAdminRoom}
            onNavigate={nav}
          />
        );
      case 'adminRoomDetail': {
        // selectedAdminRoom is only the identity captured at the moment of selection — the
        // actual displayed room is looked up fresh from adminRooms every render, so the roster
        // updates on each 5s poll instead of freezing at whatever it looked like when tapped.
        // A miss means the room ended (or never existed under this session/roomId anymore).
        const liveSelectedRoom = selectedAdminRoom
          ? adminRooms.find(r => r.sessionId === selectedAdminRoom.sessionId && r.roomId === selectedAdminRoom.roomId) ?? null
          : null;
        if (!liveSelectedRoom) {
          return (
            <AdminOverviewScreen
              rooms={adminRooms}
              error={adminError}
              onSelectRoom={setSelectedAdminRoom}
              onNavigate={nav}
            />
          );
        }
        return (
          <AdminRoomDetailScreen
            room={liveSelectedRoom}
            peak={adminRoomPeaks[`${liveSelectedRoom.sessionId}::${liveSelectedRoom.roomId}`] ?? liveSelectedRoom.members?.length ?? 0}
            onEndRoom={handleEndAdminRoom}
            onNavigate={nav}
          />
        );
      }
      case 'adminNotify':
        return (
          <AdminNotifyScreen
            onSendNotification={handleSendNotification}
            onFetchUsers={handleFetchUsers}
            onNavigate={nav}
          />
        );
      case 'diagnostics':
        return (
          <DiagnosticsScreen
            status={status}
            deviceId={deviceId}
            onNavigate={nav}
          />
        );
      case 'edgeState':
        return <EdgeStateScreen onNavigate={nav} />;
      default:
        return <LaunchScreen onComplete={handleLaunchComplete} />;
    }
  };


  return (
    <SafeAreaView
      style={[
        styles.safeArea,
        {
          backgroundColor: screen === 'launch' ? '#102A2A' : colors.surf, // matches assets/icon.svg
          paddingTop:
            Platform.OS === 'android' && screen !== 'launch'
              ? (StatusBar.currentHeight ?? 24)
              : 0,
        },
      ]}
    >
      <ExpoStatusBar style={screen === 'launch' || isDark ? 'light' : 'dark'} />
      {__DEV__ && <DevScreenSwitcher currentRole={role} onSelectRole={setRole} onNavigate={nav} />}
      <View style={styles.screenContainer}>{renderScreen()}</View>
      {showNav && (
        <BottomNav currentScreen={screen} onNavigate={nav} role={role} />
      )}
    </SafeAreaView>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <MainApp />
    </ThemeProvider>
  );
}

registerRootComponent(App);

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  screenContainer: {
    flex: 1,
  },
});
