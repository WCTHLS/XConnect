import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import {
  Platform,
  SafeAreaView,
  StatusBar,
  StyleSheet,
  View,
} from 'react-native';
import { registerRootComponent } from 'expo';
import { StatusBar as ExpoStatusBar } from 'expo-status-bar';
import * as SecureStore from 'expo-secure-store';
import type { ParticipantRole, RoomMemberInfo, LiveRoomState, MyInvite } from '@confpresence/shared';
import { getAcousticTokenForRoom } from '@confpresence/shared';
import { PresenceService, RoomRejectedError, type PresenceStatus } from './src/services/presenceService';
import { getOrCreateDeviceId } from './src/services/deviceIdentity';
import { authConfigured, authFetch, signOut, useAuthSession } from './src/services/auth';
import { registerForPushNotifications } from './src/services/pushNotifications';
import type { HistoryDetail, SessionOccurrence } from './src/services/sessionHistory';
import { ThemeProvider, useTheme } from './src/theme/useTheme';
import { BottomNav, MobileScreen, Role } from './src/components/navigation/BottomNav';
import { DevScreenSwitcher } from './src/components/navigation/DevScreenSwitcher';
import { AppAlert, AppAlertHost } from './src/components/ui/AppAlert';
import { BusyOverlay } from './src/components/ui/BusyOverlay';
import { AdminOnlyNotice } from './src/components/ui/AdminOnlyNotice';

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
import { NotCheckedInScreen } from './src/screens/attendee/NotCheckedInScreen';
import { AttendeeOutOfRangeScreen } from './src/screens/attendee/AttendeeOutOfRangeScreen';
import { AdminOverviewScreen } from './src/screens/admin/AdminOverviewScreen';
import { AdminRoomDetailScreen } from './src/screens/admin/AdminRoomDetailScreen';
import { AdminHistoryScreen } from './src/screens/admin/AdminHistoryScreen';
import { AdminNotifyScreen } from './src/screens/admin/AdminNotifyScreen';
import { AdminCheckInScreen, type InviteRoster, type InviteSendResult } from './src/screens/admin/AdminCheckInScreen';
import { DiagnosticsScreen } from './src/screens/admin/DiagnosticsScreen';
import { EdgeStateScreen } from './src/screens/admin/EdgeStateScreen';

const DEFAULT_SESSION = 'poc-session';
const DEFAULT_ROOMS = ['Hall A', 'Workshop 1', 'Auditorium', 'Room B'];
const CLOUD_API_URL = 'https://xconnect-ytoj.onrender.com';
const LOCAL_API_URL = 'http://192.168.0.201:3000';
const SESSION_ID_KEY = 'xconnect.sessionId_v1';
const ROLE_KEY = 'xconnect.role_v1';

/** An explicit role/room/session override for togglePresence, bypassing whatever's currently
 * selected in state — used when joining a specific detected/rejoined room directly. */
type ActiveSessionSnapshot = {
  role: ParticipantRole;
  roomId: string;
  sessionId: string;
  updatedAt: number;
};

/** Turns an admin endpoint's failure into something an admin can act on. 403 is the common one
 * (signed in, but not an admin account); 503 is the server telling us history needs Postgres,
 * which its own `error` string already explains better than a status code would. */
/** Room codes are free-typed text throughout this app ("Hall A" vs "hall a"), so anywhere two
 * room names are compared for identity, whitespace and case must not cause a false mismatch. */
function sameRoomName(a?: string, b?: string): boolean {
  return Boolean(a) && Boolean(b) && a!.trim().toLowerCase() === b!.trim().toLowerCase();
}

/** Wraps AppAlert's callback-style buttons in a Promise, so a caller can `await` the person's
 * choice instead of continuing inside an onPress handler. Resolves false for either button
 * styled "cancel" and for the hardware back button (AppAlert only dismisses on backdrop tap when
 * a cancel button exists, and routes that tap through the cancel button itself). */
function confirmAsync(title: string, message: string, confirmLabel: string): Promise<boolean> {
  return new Promise(resolve => {
    AppAlert.alert(title, message, [
      { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
      { text: confirmLabel, style: 'destructive', onPress: () => resolve(true) },
    ]);
  });
}

function describeAdminError(status: number, data: any): string {
  if (status === 403) return 'This account is not an admin.';
  if (typeof data?.error === 'string') return data.error;
  return data?.error ? JSON.stringify(data.error) : `Server returned ${status}`;
}

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
  'adminHistory',
  'adminNotify',
  'adminCheckIn',
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
  // Server-truth check for "do I already have a room open anywhere" — drives the presenter
  // Home screen's Rejoin/End card instead of the old local-device rejoin snapshot.
  const [myActiveRooms, setMyActiveRooms] = useState<LiveRoomState[]>([]);
  // Check-in invites addressed to this account that haven't been answered yet.
  const [myInvites, setMyInvites] = useState<MyInvite[]>([]);
  // What's actually running right now, independent of the currently-selected role tab — see the
  // comment in togglePresence for why this needs to be tracked separately from `role`.
  const [activePresence, setActivePresence] = useState<{
    role: ParticipantRole;
    roomId: string;
    sessionId: string;
    /**
     * Attendee only: whether a room has actually been verified, as opposed to merely scanning for
     * one. Starting detection is NOT the same as being in a room — without this distinction the
     * "My Activity" tab treats "scanning began" as "confirmed present" and renders a dwell-time
     * counter against whatever stale roomId happened to be in state. Always true for a presenter,
     * where starting to broadcast genuinely is being live.
     */
    confirmed: boolean;
  } | null>(null);
  // Drives the "My Activity" tab when not actively attending: 'checking' while asking the server
  // for a still-live membership within its grace window, 'empty' once confirmed there isn't one.
  // ('resumed' isn't tracked separately — a successful check calls togglePresence, which flips
  // activePresence.role to 'attendee' and the normal confirmed screen takes over from there.)
  const [attendeeCheckState, setAttendeeCheckState] = useState<'checking' | 'empty'>('checking');
  // True only while a stop is in flight. service.stop() now awaits the leave request, so this is
  // a real wait the user would otherwise see as an unresponsive tap.
  const [stopping, setStopping] = useState(false);
  // Whether the signed-in account is actually an admin, per the server. null = not known yet
  // (offline, or the first /api/me hasn't landed), which is treated as "don't block" so a slow
  // network never locks a real admin out of their own screens. The server enforces this for
  // real via requireAdmin; this only stops the UI offering screens that would 403.
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);

  // Mirrors of state that the 3s polling callback needs to read. They are refs, not dependencies,
  // because putting `screen` or `activePresence` in fetchLiveRoom's dep array would rebuild the
  // callback (and tear down and restart the interval) on every navigation and every presence
  // change — turning a steady 3s poll into a burst of requests.
  const screenRef = useRef<MobileScreen>('launch');
  const activePresenceRef = useRef<typeof activePresence>(null);

  // Backend & Session State
  const [sessionId, setSessionId] = useState(DEFAULT_SESSION);
  const [serverEnv, setServerEnv] = useState<'cloud' | 'local' | 'custom'>('cloud');
  const [serverUrl, setServerUrl] = useState(CLOUD_API_URL);
  const [serverHealth, setServerHealth] = useState<'checking' | 'online' | 'offline'>('checking');
  const [serverConnected, setServerConnected] = useState<boolean | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [rooms, setRooms] = useState<string[]>(DEFAULT_ROOMS);
  const [roomId, setRoomId] = useState('Hall A');
  // Detection OUTPUTS — written only from what the server reports this device's sensors matched,
  // never from local input. The attendee counterpart to the presenter-authored roomId/sessionId
  // above: an attendee is told which room (and which session it belongs to) it's physically in,
  // rather than asserting either, so there is no stale local claim to leak into a join.
  const [detectedRoom, setDetectedRoom] = useState('');
  const [detectedSession, setDetectedSession] = useState('');
  const [deviceId, setDeviceId] = useState('');
  const [running, setRunning] = useState(false);
  const runningRef = useRef(false);
  const [status, setStatus] = useState<PresenceStatus>({ state: 'idle', peerCount: 0 });
  const [roomMembers, setRoomMembers] = useState<RoomMemberInfo[]>([]);
  const [sessionStartTime, setSessionStartTime] = useState<number>(Date.now());
  const [sessionDurationMs, setSessionDurationMs] = useState<number>(0);
  // Frozen at the moment presenting stops, same reason sessionDurationMs is: the "3-Second Live
  // Polling Interval" effect wipes roomMembers to [] as soon as running flips false, and
  // SessionEndScreen's summary (attendee count, acoustic/wifi match %) is computed from
  // roomMembers live at render time — without a snapshot, the report would show correct numbers
  // for one paint and then collapse to zero as that cleanup effect lands.
  const [sessionEndMembers, setSessionEndMembers] = useState<RoomMemberInfo[]>([]);

  // Auth Hook
  const { session: authSession, ready: authReady } = useAuthSession();
  const signedIn = Boolean(authSession);
  const savedNameRef = useRef('');

  const nav = useCallback((s: MobileScreen) => {
    // Kept in step here rather than in an effect, so a poll firing in the same tick as a
    // navigation reads where we are going, not where we were.
    screenRef.current = s;
    setScreen(s);
  }, []);

  useEffect(() => {
    activePresenceRef.current = activePresence;
  }, [activePresence]);

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

  // Persist sessionId across app restarts, same pattern as deviceId — without this, reopening
  // the app after a force-quit always resets to DEFAULT_SESSION, so a server-truth "am I still
  // present" check (the attendee resume check below, and the presenter rejoin poll) would query
  // the wrong session label for anyone using a non-default one and wrongly report nothing found.
  const sessionIdLoadedRef = useRef(false);
  useEffect(() => {
    SecureStore.getItemAsync(SESSION_ID_KEY)
      .then(stored => {
        if (stored) setSessionId(stored);
      })
      .catch(() => {
        // No stored value (or read failed) — keep the DEFAULT_SESSION default.
      })
      .finally(() => {
        sessionIdLoadedRef.current = true;
      });
  }, []);

  useEffect(() => {
    // Skip the very first write: without this, the initial DEFAULT_SESSION render would
    // overwrite a real stored value in the instant before the load above resolves.
    if (!sessionIdLoadedRef.current) return;
    void SecureStore.setItemAsync(SESSION_ID_KEY, sessionId).catch(() => {
      // Best-effort: worst case, this doesn't survive the next restart.
    });
  }, [sessionId]);

  // Role is chosen once at sign-in and fixed for the life of the session, so it has to survive a
  // restart the same way sessionId does — otherwise force-quitting the app silently demotes a
  // presenter or admin to attendee with no way back short of signing out again.
  const roleLoadedRef = useRef(false);
  useEffect(() => {
    SecureStore.getItemAsync(ROLE_KEY)
      .then(stored => {
        if (stored === 'attendee' || stored === 'presenter' || stored === 'admin') setRole(stored);
      })
      .catch(() => {
        // No stored value (or read failed) — keep the attendee default.
      })
      .finally(() => {
        roleLoadedRef.current = true;
      });
  }, []);

  useEffect(() => {
    if (!roleLoadedRef.current) return;
    void SecureStore.setItemAsync(ROLE_KEY, role).catch(() => {
      // Best-effort: worst case, this doesn't survive the next restart.
    });
  }, [role]);

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
        // Same response already carries it, so this costs no extra request. With sign-in turned
        // off entirely the server reports isAdmin: true, keeping POC mode open.
        setIsAdmin(typeof me?.isAdmin === 'boolean' ? me.isAdmin : null);
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

  // Switch server environment
  const handleSelectServerEnv = (env: 'cloud' | 'local' | 'custom', customUrl?: string) => {
    setServerEnv(env);
    const newUrl = env === 'cloud' ? CLOUD_API_URL : env === 'local' ? LOCAL_API_URL : (customUrl || CLOUD_API_URL);
    setServerUrl(newUrl);
    checkHealth(newUrl);
  };

  // Toggle Presence Engine. Returns whether it actually succeeded, so a caller that navigates on
  // "start broadcasting" (e.g. PresenterSetupScreen) can wait for that before moving to the
  // dashboard, instead of navigating optimistically and ending up there even when the server
  // rejected the join (room already has a presenter) and never actually started anything.
  /**
   * Set whenever presence stops for a reason the user caused or saw (tapping Leave, ending a
   * room, being told the room ended). The attendee resume check below must not fire after one of
   * those: stopping flips `running`, which re-runs that effect, and it would ask the server "am I
   * still live?" while the leave request it races is still in flight — getting "yes" and putting
   * the person straight back into the room they just left. Cleared on the next deliberate start.
   * A ref, not state, so it never triggers a render, and it resets on reload, which is correct:
   * a fresh launch inside the grace window SHOULD still resume.
   */
  const stoppedDeliberatelyRef = useRef(false);

  const togglePresence = async (overrideRunning?: boolean, explicitSnapshot?: ActiveSessionSnapshot): Promise<boolean> => {
    const targetRunning = overrideRunning ?? !runningRef.current;
    if (targetRunning) {
      try {
        const activeRole = (explicitSnapshot?.role ?? role) as ParticipantRole;
        // roomId/sessionId are PRESENTER-authored config (the room chips, the custom room field,
        // the Session Identifier input). An attendee must never assert them as its own: those
        // values are whatever a previous presenter session or a default left behind, and claiming
        // them tells the server this device belongs to a room it knows nothing about. An attendee
        // only ever asserts a room it was explicitly handed via an already-detected snapshot.
        const isScanningStart = activeRole === 'attendee' && !explicitSnapshot;
        const activeRoom = explicitSnapshot?.roomId ?? (isScanningStart ? undefined : roomId);
        const activeSession = explicitSnapshot?.sessionId ?? sessionId;

        setSessionStartTime(Date.now());
        // A fresh attendee detection must start from a clean slate — detection results are only
        // ever cleared on STOP, not on start, so without this a stale result from an earlier
        // detection this app session would show up instantly as already-detected the moment Begin
        // Detection is tapped, before any real scanning happens.
        if (isScanningStart) {
          setDetectedRoom('');
          setDetectedSession('');
          setRoomMembers([]);
        }

        // Close out any OTHER room this account is still presenting before starting this one.
        // presenceService.start() already leaves a room this device thinks it's running — but
        // that local "am I running" flag resets on every fresh app process, so it does nothing
        // after a force-close: the old room's device record is simply abandoned, live on the
        // server (and visible to attendees/admin) until its 15-minute auto-expiry. Asking the
        // server directly closes that gap regardless of what this device remembers.
        if (activeRole === 'presenter') {
          try {
            const res = await authFetch(`${serverUrl}/api/me/active-rooms`);
            if (res.ok) {
              const data = await res.json().catch(() => null);
              const liveElsewhere: LiveRoomState[] = (Array.isArray(data?.rooms) ? data.rooms : []).filter(
                (r: LiveRoomState) => !(sameRoomName(r.roomId, activeRoom) && sameRoomName(r.sessionId, activeSession))
              );
              if (liveElsewhere.length > 0) {
                // A found room might genuinely still have people in it — closing it is a real
                // action, not housekeeping, so it's confirmed rather than done silently. Naming
                // each room and its live attendee count so the choice is informed, not a guess.
                const roomList = liveElsewhere
                  .map(r => {
                    const attendeeCount = (r.members ?? []).filter(m => m.role === 'attendee').length;
                    return `${r.roomId.toUpperCase()} (${attendeeCount} attendee${attendeeCount === 1 ? '' : 's'})`;
                  })
                  .join(', ');
                const proceed = await confirmAsync(
                  'Still Hosting Another Room',
                  `You're still hosting ${roomList}. Starting ${activeRoom?.toUpperCase()} will end ${
                    liveElsewhere.length === 1 ? 'it' : 'them'
                  } and disconnect anyone still there.`,
                  `End & Start ${activeRoom?.toUpperCase()}`
                );
                if (!proceed) return false;
                await Promise.all(
                  liveElsewhere.map(r =>
                    authFetch(`${serverUrl}/api/me/rooms/end`, {
                      method: 'POST',
                      headers: { 'content-type': 'application/json' },
                      body: JSON.stringify({ sessionId: r.sessionId, roomId: r.roomId }),
                    }).catch(() => {})
                  )
                );
              }
            }
          } catch {
            // Offline or unreachable — proceed with starting the new room regardless; there's
            // nothing actionable to confirm if the check itself couldn't be made.
          }
        }

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
        // A deliberate start re-arms the resume check for the next stop.
        stoppedDeliberatelyRef.current = false;
        // Snapshot of what's ACTUALLY running, independent of whatever role tab you switch to
        // afterward — switching the tab only changes `role`, it doesn't stop this session, so
        // Home needs a way to know "you're still presenting/attending" no matter which tab it's
        // showing right now, instead of misleadingly offering Start Broadcasting / Begin Detection
        // again (which would interrupt and restart the live session).
        setActivePresence({
          role: activeRole,
          // Empty while merely scanning — there is no room yet, and `confirmed` below is what
          // gates every reader of this field.
          roomId: activeRoom ?? '',
          sessionId: activeSession,
          // An explicit snapshot means a specific room was already established — Verify & Enter on
          // a server-detected room, or the resume check finding a still-live membership. A bare
          // attendee start is just "scanning began", with no room confirmed yet.
          confirmed: activeRole === 'presenter' || Boolean(explicitSnapshot),
        });
        return true;
      } catch (err: any) {
        AppAlert.alert('Session Error', err?.message || 'Could not initiate presence service');
        return false;
      }
    } else {
      setSessionDurationMs(Date.now() - sessionStartTime);
      setSessionEndMembers(roomMembers);
      runningRef.current = false;
      setRunning(false);
      setActivePresence(null);
      stoppedDeliberatelyRef.current = true;
      // Cleared here as well as by the poll: setRunning(false) un-gates the myActiveRooms poll
      // immediately, so without this the list shows the just-ended room until the next poll
      // returns. service.stop() now awaits the leave, so this is presentation, not a race fix.
      setMyActiveRooms([]);
      setStopping(true);
      try {
        // Awaited all the way to the server's acknowledgement (or a 4s timeout), so by the time
        // this resolves nothing can observe this device as still being in the room.
        await service.stop();
      } finally {
        setStopping(false);
      }
      return true;
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
          AppAlert.alert('Room ended', 'This session has ended.');
          return;
        }

        // The detection response carries the matched room's OWN session label, which is how an
        // attendee learns a session code it has no other way to know. Capture both together —
        // confirming a detection has to declare the pair, or the join lands under the wrong label.
        if (data.roomId && data.roomId !== 'unknown') {
          setDetectedRoom(data.roomId);
          if (data.sessionId) setDetectedSession(data.sessionId);
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

        // Range tracking for a confirmed attendee. The server is the judge: it already holds a
        // membership open for ROOM_MEMBERSHIP_GRACE_MS after a device stops reporting, so a
        // momentary BLE dropout does not reach this code. Dropping out of `members` therefore
        // means genuinely out of range, not a flicker, and no extra debounce is needed here.
        if (activePresenceRef.current?.role === 'attendee' && activePresenceRef.current.confirmed) {
          const stillInRoom = fetchedMembers.some(m => m.deviceId === effDeviceId);
          if (!stillInRoom && screenRef.current === 'attendeeConfirmed') {
            nav('attendeeOutOfRange');
          } else if (stillInRoom && screenRef.current === 'attendeeOutOfRange') {
            // Walked back in — return them without making them tap anything.
            nav('attendeeConfirmed');
          }
        }
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
      setDetectedSession('');
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
    };

    tick();
    const interval = setInterval(tick, 3000);
    return () => clearInterval(interval);
  }, [running, role, roomId, sessionId, fetchLiveRoom, deviceId, displayName]);

  // Deliberately no attendee-side room/session discovery poll here. An attendee never asserts a
  // room: detection is session-unscoped server-side, matching on BLE and ultrasonic proximity and
  // returning the room along with its OWN session label. A poll that wrote `roomId` (as the old
  // "Live Session Discovery" one did, from /api/sessions/active) picked an arbitrary first room
  // globally and silently overwrote the shared room selection, which is exactly the
  // attendee-asserts-a-stale-value shape that produced the ghost-attendee bug.

  // Admin Live Overview Polling — every active room across every session, refreshed on the same
  // 5s cadence the old single-screen admin view used. Runs whenever the admin role is selected,
  // not just while on the overview/detail screens, so switching between them doesn't restart it.
  useEffect(() => {
    if (role !== 'admin') return;
    // Confirmed non-admins are shown AdminOnlyNotice instead of these screens, so polling would
    // only collect a 403 every 5s behind a screen nobody is looking at. `null` still polls: not
    // knowing yet must not delay a real admin's first load.
    if (isAdmin === false) return;
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
    // isAdmin is a dependency so the poll starts the moment /api/me confirms admin status,
    // rather than waiting for some other state change to re-run this effect.
  }, [role, serverUrl, isAdmin]);

  // Presenter Rejoin flow (server-truth) — while a presenter is idle (not currently running),
  // keep checking whether the server already has a live room open under this signed-in user.
  // This replaces trusting the local device snapshot for "should I show a rejoin option": that
  // snapshot goes stale 45s after a force-close and can't see a room from a different device or
  // after a reinstall, while this asks the server directly every time.
  useEffect(() => {
    if (role !== 'presenter' || running) {
      setMyActiveRooms([]);
      return;
    }
    let cancelled = false;
    const fetchMyActiveRooms = async () => {
      try {
        const res = await authFetch(`${serverUrl}/api/me/active-rooms`);
        if (cancelled || !res.ok) return;
        const data = await res.json().catch(() => null);
        if (cancelled) return;
        setMyActiveRooms(Array.isArray(data?.rooms) ? data.rooms : []);
      } catch {
        // Transient network errors just mean the rejoin card doesn't show this round.
      }
    };
    void fetchMyActiveRooms();
    const interval = setInterval(fetchMyActiveRooms, 5000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [role, running, serverUrl]);

  // Attendee server-truth resume check — mirrors the presenter rejoin check above, but attendee
  // membership isn't a durable ownership claim the way a presenter's room is: it's live
  // sensor-verified presence that decays within the server's own grace window
  // (ROOM_MEMBERSHIP_GRACE_MS) once this device stops reporting. Fires as soon as you're viewing
  // as attendee and not already actively attending — including right on app launch, since `role`
  // defaults to 'attendee' — so reopening the app within the grace window resumes automatically
  // rather than requiring a visit to "My Activity" specifically. Asks the server (the same
  // /api/devices/:deviceId/live endpoint the live-polling loop uses) whether this device is still
  // within that window for some room, and either resumes properly into it (togglePresence, so it
  // behaves exactly like a normal live session from then on) or settles on "not currently
  // present" once confirmed there's nothing left to resume. One-shot rather than a repeating
  // poll: once the window has lapsed nothing will change again without the user re-detecting.
  useEffect(() => {
    if (role !== 'attendee' || running || activePresence?.role === 'attendee') return;
    // Just left (or the room ended): settle straight on "not present" instead of asking the
    // server, whose answer would still be racing the leave request.
    if (stoppedDeliberatelyRef.current) {
      setAttendeeCheckState('empty');
      return;
    }
    let cancelled = false;
    setAttendeeCheckState('checking');
    (async () => {
      try {
        const effDeviceId = deviceId || (await getOrCreateDeviceId());
        const res = await authFetch(
          `${serverUrl}/api/devices/${encodeURIComponent(effDeviceId)}/live?sessionId=${encodeURIComponent(sessionId)}`
        );
        if (cancelled) return;
        const data = res.ok ? await res.json().catch(() => null) : null;
        const stillPresent =
          data && !data.roomEnded && data.roomId && data.roomId !== 'unknown' &&
          Array.isArray(data.members) && data.members.some((m: RoomMemberInfo) => m.deviceId === effDeviceId);
        if (cancelled) return;
        if (stillPresent) {
          setDetectedRoom(data.roomId);
          if (data.sessionId) setDetectedSession(data.sessionId);
          setRoomMembers(data.members);
          // Resume under the room's own session, same reason Verify & Enter does.
          await togglePresence(true, {
            role: 'attendee',
            roomId: data.roomId,
            sessionId: data.sessionId || sessionId,
            updatedAt: Date.now(),
          });
        } else {
          setAttendeeCheckState('empty');
        }
      } catch {
        if (!cancelled) setAttendeeCheckState('empty');
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, running, serverUrl, sessionId]);

  // Outstanding check-in invites for this account. Polled slowly (30s) rather than on the 5s
  // cadence the live screens use: an invite is sent minutes or hours ahead, so it has none of the
  // urgency of presence data, and the push notification is what makes it feel immediate. The
  // poll exists so an invite still arrives for someone whose device was never registered for
  // push, or who had notifications turned off.
  useEffect(() => {
    if (!signedIn) {
      setMyInvites([]);
      return;
    }
    let cancelled = false;
    const fetchInvites = async () => {
      try {
        const res = await authFetch(`${serverUrl}/api/me/invites`);
        if (cancelled || !res.ok) return;
        const data = await res.json().catch(() => null);
        if (cancelled) return;
        setMyInvites(Array.isArray(data?.invites) ? data.invites : []);
      } catch {
        // Offline or unreachable: keep whatever we last had rather than clearing the card.
      }
    };
    void fetchInvites();
    const interval = setInterval(fetchInvites, 30000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [signedIn, serverUrl]);

  /** Returns whether the reply actually saved, so callers don't dismiss their UI on a failure —
   *  the same reason togglePresence returns a boolean rather than firing and forgetting. */
  const handleRespondToInvite = useCallback(
    async (inviteId: number, response: 'accepted' | 'declined'): Promise<boolean> => {
      let res: Response;
      try {
        res = await authFetch(`${serverUrl}/api/me/invites/respond`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ inviteId, response }),
        });
      } catch (err: any) {
        AppAlert.alert('Could not send your reply', err?.message || 'Could not reach the server.');
        return false;
      }
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        AppAlert.alert('Could not send your reply', data?.error ? String(data.error) : 'Please try again.');
        return false;
      }
      // Update in place rather than dropping it: an answered invite stops being a prompt and
      // becomes part of the reply history on Home, so it has to stay in the list. Applied
      // locally so the change is instant instead of waiting up to 30s for the next poll.
      setMyInvites(prev =>
        prev.map(i =>
          i.id === inviteId ? { ...i, status: response, respondedAt: new Date().toISOString() } : i
        )
      );
      return true;
    },
    [serverUrl]
  );

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
        AppAlert.alert('Could not end room', 'The room may have already ended on its own.');
      }
    } catch (err: any) {
      AppAlert.alert('Network error', err?.message || 'Could not reach the server.');
    }
  };

  // Ends one of the signed-in presenter's own live rooms (the server-truth rejoin card's "End
  // Room" action) — separate from handleEndAdminRoom above, which is the admin's own room-close
  // primitive and doesn't check ownership the way engine.endRoomIfOwner does.
  const handleEndMyRoom = async (room: LiveRoomState) => {
    try {
      const res = await authFetch(`${serverUrl}/api/me/rooms/end`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId: room.sessionId, roomId: room.roomId }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.ended) {
        setMyActiveRooms(prev => prev.filter(r => !(r.sessionId === room.sessionId && r.roomId === room.roomId)));
      } else {
        AppAlert.alert('Could not end room', 'The room may have already ended on its own.');
      }
    } catch (err: any) {
      AppAlert.alert('Network error', err?.message || 'Could not reach the server.');
    }
  };

  /**
   * Starts an accepted presenter assignment. Adopts the assigned room AND session wholesale
   * rather than letting the locally-selected values leak in — the point of the assignment is
   * that the presenter never retypes either, so a typo cannot split the room attendees are
   * being pointed at from the one actually being broadcast.
   */
  const handleStartAssignedRoom = async (assignedRoom: string, assignedSession: string) => {
    setRoomId(assignedRoom);
    setSessionId(assignedSession);
    const ok = await togglePresence(true, {
      role: 'presenter',
      roomId: assignedRoom,
      sessionId: assignedSession,
      updatedAt: Date.now(),
    });
    if (ok) nav('presenterDashboard');
  };

  const handleRejoinMyRoom = async (room: LiveRoomState) => {
    setRoomId(room.roomId);
    setSessionId(room.sessionId);
    const ok = await togglePresence(true, { role: 'presenter', roomId: room.roomId, sessionId: room.sessionId, updatedAt: Date.now() });
    if (ok) nav('presenterDashboard');
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

  /**
   * Signing out has to tear down the live session too, not just the token. Two orderings matter
   * here: presence is stopped BEFORE signOut(), because service.stop() fires a leave request that
   * needs a valid token to be accepted — drop the token first and the device stays counted in the
   * room until the server reaps it ~90s later. And role resets to the attendee default, since the
   * next person to sign in on this device picks their own role at login and must not inherit this
   * one's.
   */
  const handleSignOut = async () => {
    if (runningRef.current) await togglePresence(false);
    await signOut();
    setRole('attendee');
    setMyActiveRooms([]);
    setScreen('login');
  };

  // Past-session lookups for the admin History tab. Both are useCallback'd because the screen
  // runs its initial search from an effect keyed on the handler — a fresh arrow every render
  // would re-fire that search on every parent re-render (and the 5s admin poll causes plenty).
  const handleSearchHistory = useCallback(
    async (code: string) => {
      const url = code
        ? `${serverUrl}/api/admin/sessions?code=${encodeURIComponent(code)}`
        : `${serverUrl}/api/admin/sessions`;
      const res = await authFetch(url);
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(describeAdminError(res.status, data));
      }
      return (Array.isArray(data?.sessions) ? data.sessions : []) as SessionOccurrence[];
    },
    [serverUrl]
  );

  const handleOpenOccurrence = useCallback(
    async (occurrenceId: string) => {
      const res = await authFetch(`${serverUrl}/api/admin/history?roomId=${encodeURIComponent(occurrenceId)}`);
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(describeAdminError(res.status, data));
      }
      return data as HistoryDetail;
    },
    [serverUrl]
  );

  const handleSendInvites = useCallback(
    async (
      inviteSessionId: string,
      emails: string[],
      title: string,
      message: string,
      eventAt: string | null,
      inviteRole: 'attendee' | 'presenter',
      roomCode: string | null
    ): Promise<InviteSendResult> => {
      const res = await authFetch(`${serverUrl}/api/admin/invites`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId: inviteSessionId, emails, title, message, eventAt, inviteRole, roomCode }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(describeAdminError(res.status, data));
      return {
        invited: data.invited ?? 0,
        pushed: data.pushed ?? [],
        notReachableByPush: data.notReachableByPush ?? [],
        pushError: data.pushError ?? null,
      };
    },
    [serverUrl]
  );

  const handleEditInvites = useCallback(
    async (edit: {
      sessionId: string;
      newSessionId?: string;
      title?: string;
      message?: string;
      eventAt?: string | null;
      roomCode?: string;
      reAsk?: boolean;
    }): Promise<{ updated: number; sessionId: string; pushError: string | null }> => {
      const res = await authFetch(`${serverUrl}/api/admin/invites`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(edit),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(describeAdminError(res.status, data));
      return {
        updated: data.updated ?? 0,
        sessionId: data.sessionId ?? edit.sessionId,
        pushError: data.pushError ?? null,
      };
    },
    [serverUrl]
  );

  const handleFetchInvites = useCallback(
    async (inviteSessionId: string): Promise<InviteRoster> => {
      const url = inviteSessionId
        ? `${serverUrl}/api/admin/invites?sessionId=${encodeURIComponent(inviteSessionId)}`
        : `${serverUrl}/api/admin/invites`;
      const res = await authFetch(url);
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(describeAdminError(res.status, data));
      return {
        invites: data.invites ?? [],
        counts: data.counts ?? { total: 0, accepted: 0, declined: 0, pending: 0, expired: 0 },
      };
    },
    [serverUrl]
  );

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

  const renderHome = () => (
    <HomeScreen
      displayName={displayName}
      role={role}
      onNavigate={nav}
      serverConnected={serverConnected}
      serverEnv={serverEnv}
      rooms={rooms}
      selectedRoom={roomId}
      onSelectRoom={setRoomId}
      onStartPresence={() => void togglePresence(true)}
      myActiveRooms={myActiveRooms}
      onRejoinMyRoom={handleRejoinMyRoom}
      onEndMyRoom={handleEndMyRoom}
      activePresence={activePresence}
      hasDetectedRoom={Boolean(detectedRoom)}
      invites={myInvites}
      onRespondToInvite={handleRespondToInvite}
      onStartAssignedRoom={handleStartAssignedRoom}
    />
  );

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
            role={role}
            onSelectRole={setRole}
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
            role={role}
            onSelectRole={setRole}
            onNavigate={nav}
            onSuccess={() => {
              void markOnboarded();
              nav('home');
            }}
          />
        );
      case 'home':
        return renderHome();
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
            onSignOut={handleSignOut}
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
            onStartBroadcast={async (r, s) => {
              setRoomId(r);
              setSessionId(s);
              return togglePresence(true, { role: 'presenter', roomId: r, sessionId: s, updatedAt: Date.now() });
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
        // "Analysis" tab reuses this screen for two different things: a live in-progress summary
        // while actually presenting, or the frozen last-ended report otherwise. Same stat
        // computation either way, just fed from live roomMembers/elapsed-time vs. the snapshot
        // taken in togglePresence's stop-branch.
        const isLive = activePresence?.role === 'presenter';
        const members = isLive ? roomMembers : sessionEndMembers;
        const durationMsForDisplay = isLive ? Date.now() - sessionStartTime : sessionDurationMs;

        const attendeesOnly = members.filter(m => m.role === 'attendee');
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
            isLive={isLive}
            totalAttendees={attendeesOnly.length}
            durationMs={durationMsForDisplay}
            acousticMatchPercent={acousticPct}
            wifiSimilarityPercent={avgWifi}
            onNavigate={nav}
          />
        );
      }
      case 'attendeeDiscovery':
        return (
          <AttendeeDiscoveryScreen
            detectedRoom={detectedRoom}
            acousticToken={status.ultrasonicToken}
            peerCount={status.peerCount}
            wifiApCount={status.wifiApCount}
            ultrasonicState={status.ultrasonicState}
            running={running}
            onStopDetection={() => togglePresence(false)}
            onJoinDetectedRoom={r => {
              // Adopt the detected room AND the session the server said it belongs to, rather
              // than joining under whatever local sessionId this device happened to carry — that
              // local value is presenter config and has nothing to do with the room just matched.
              return togglePresence(true, {
                role: 'attendee',
                roomId: r,
                sessionId: detectedSession || sessionId,
                updatedAt: Date.now(),
              });
            }}
            onNavigate={nav}
          />
        );
      case 'attendeeConfirmed':
        // The "My Activity" tab routes here unconditionally, but this screen's dwell-time counter
        // is a pure stopwatch off sessionStartTime with no awareness of whether the room is still
        // live — sessionStartTime is only ever set when a NEW session starts, never cleared after
        // leaving or a room ending. So without this guard, tapping the tab again after the session
        // is over would re-render it counting up from a stale timestamp as if still live. The
        // effect above resolves "not attending" into either a real resumed session (if the server
        // still has this device within its grace window) or attendeeCheckState 'empty' — never
        // silently show the stale live view in between.
        // Scanning is deliberately NOT enough to show this screen: until a room is actually
        // confirmed, roomId here would fall back to whatever stale value was left in state and
        // present it as verified presence, complete with a running dwell counter.
        if (activePresence?.role !== 'attendee' || !activePresence.confirmed) {
          return (
            <NotCheckedInScreen
              state={
                activePresence?.role === 'attendee'
                  ? 'scanning'
                  : attendeeCheckState === 'checking'
                  ? 'checking'
                  : 'idle'
              }
              onNavigate={nav}
            />
          );
        }
        return (
          <AttendeeConfirmedScreen
            // No `|| roomId` fallback: that presenter-authored value is exactly what used to get
            // rendered as verified presence in a room this device was never actually in. Reaching
            // here at all means activePresence.confirmed, so it carries the real joined room.
            roomId={detectedRoom || activePresence.roomId}
            sessionId={activePresence.sessionId}
            hostName={roomMembers.find(m => m.role === 'presenter')?.displayName || 'Anchor Host'}
            confidence={roomMembers.find(m => m.deviceId === deviceId)?.confidence ?? 1.0}
            wifiSimilarity={roomMembers.find(m => m.deviceId === deviceId)?.wifiSimilarity}
            wifiApCount={status.wifiApCount}
            ultrasonicVerified={status.ultrasonicState === 'verified' || Boolean(roomMembers.find(m => m.deviceId === deviceId)?.ultrasonicVerified)}
            // The server's own figure for this device, the same one the presenter roster and the
            // persisted room_membership row are built from — so all three agree.
            dwellMs={roomMembers.find(m => m.deviceId === deviceId)?.durationMs}
            onLeaveRoom={() => void togglePresence(false)}
            onNavigate={nav}
          />
        );
      case 'attendeeOutOfRange':
        return (
          <AttendeeOutOfRangeScreen
            // The room the server actually matched, not the presenter-authored `roomId` this
            // screen used to show — an attendee's local roomId has nothing to do with the room
            // they were checked into.
            roomId={detectedRoom || activePresence?.roomId || ''}
            onLeave={() => void togglePresence(false)}
            onNavigate={nav}
          />
        );
      case 'adminOverview':
        if (isAdmin === false) {
          return (
            <AdminOnlyNotice
              feature="The live room monitor"
              userEmail={authSession?.email}
              onNavigate={nav}
            />
          );
        }
        return (
          <AdminOverviewScreen
            rooms={adminRooms}
            error={adminError}
            onSelectRoom={setSelectedAdminRoom}
            onNavigate={nav}
          />
        );
      case 'adminRoomDetail': {
        if (isAdmin === false) {
          return (
            <AdminOnlyNotice
              feature="Room details"
              userEmail={authSession?.email}
              onNavigate={nav}
            />
          );
        }
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
      case 'adminHistory':
        if (isAdmin === false) {
          return (
            <AdminOnlyNotice
              feature="Session history"
              userEmail={authSession?.email}
              onNavigate={nav}
            />
          );
        }
        return (
          <AdminHistoryScreen
            onSearch={handleSearchHistory}
            onOpenOccurrence={handleOpenOccurrence}
            onNavigate={nav}
          />
        );
      case 'adminCheckIn':
        // Guarded here as well as on Notify: Check-In is reached from that screen, so without
        // this a non-admin could still land on a form whose every request would 403.
        if (isAdmin === false) {
          return (
            <AdminOnlyNotice
              feature="Check-in invites"
              userEmail={authSession?.email}
              onNavigate={nav}
            />
          );
        }
        return (
          <AdminCheckInScreen
            defaultSessionId={sessionId}
            onFetchUsers={handleFetchUsers}
            onSendInvites={handleSendInvites}
            onFetchInvites={handleFetchInvites}
            onEditInvites={handleEditInvites}
            onNavigate={nav}
          />
        );
      case 'adminNotify':
        if (isAdmin === false) {
          return (
            <AdminOnlyNotice
              feature="Sending notifications"
              userEmail={authSession?.email}
              onNavigate={nav}
            />
          );
        }
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
      <AppAlertHost />
      <BusyOverlay visible={stopping} label="Leaving session…" />
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
