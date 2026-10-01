import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Modal,
  Platform,
  Switch,
} from 'react-native';
import Svg, { Path } from 'react-native-svg';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import type { InviteRole, SessionInvite } from '@confpresence/shared';
import { useTheme } from '../../theme/useTheme';
import { palette } from '../../theme/colors';
import { useKeyboardAwareScroll } from '../../hooks/useKeyboardAwareScroll';

interface InviteResponsesPanelProps {
  onFetchInvites: (sessionId: string) => Promise<{ invites: SessionInvite[] }>;
  /** Changes who a session invites, rather than what the invite says. */
  onEditRecipients: (edit: {
    sessionId: string;
    inviteRole: InviteRole;
    add?: string[];
    remove?: string[];
    roomCode?: string;
  }) => Promise<{ added: number; removed: number; skipped: string[]; pushError: string | null }>;
  onFetchUsers: () => Promise<{ id: string; email: string; name: string }[]>;
  /** Edits a whole already-sent batch. Omitted fields are left as they are; `eventAt: null`
   *  explicitly clears the schedule, and `reAsk` clears replies and re-notifies. */
  onEditInvites: (edit: {
    sessionId: string;
    newSessionId?: string;
    title?: string;
    message?: string;
    eventAt?: string | null;
    roomCode?: string;
    reAsk?: boolean;
  }) => Promise<{ updated: number; sessionId: string; pushError: string | null }>;
}

/** Where the edit picker starts when nothing is set yet: the next whole hour. */
function defaultEventAt(): Date {
  const d = new Date();
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1);
  return d;
}

/** A session normally holds both halves — its presenter and its attendees, sent together — so
 *  "both" is the expected state here, not an anomaly worth flagging in a warning colour. */
const ROLE_META: Record<'attendee' | 'presenter' | 'mixed', { label: string; color: string }> = {
  attendee: { label: 'ATTENDEES', color: palette.mintPresence },
  presenter: { label: 'PRESENTER', color: palette.skyMesh },
  mixed: { label: 'PRESENTER + ATTENDEES', color: palette.skyMesh },
};

const STATUS_META: Record<SessionInvite['status'], { label: string; color: string; tint: string }> = {
  accepted: { label: 'ACCEPTED', color: palette.mintPresence, tint: 'rgba(51,209,172,0.15)' },
  declined: { label: 'DECLINED', color: palette.roseError, tint: 'rgba(239,68,68,0.15)' },
  pending: { label: 'NO REPLY', color: palette.amberWarn, tint: 'rgba(245,158,11,0.15)' },
  // Set server-side once eventAt has passed while still pending — a no-reply that came too late
  // to still act on, distinct from one the admin can still chase. A plain neutral rather than a
  // theme color: this map is a static module-level constant with no access to the theme context.
  expired: { label: 'EXPIRED', color: '#94A3B8', tint: 'rgba(148,163,184,0.15)' },
};

/**
 * The admin's view of who has replied to check-in invites, across every session. Shared between
 * AdminCheckInScreen's own "Responses" tab and the Notify tab, so an admin sees the same roster
 * regardless of which screen they arrived from.
 */
export const InviteResponsesPanel: React.FC<InviteResponsesPanelProps> = ({
  onFetchInvites,
  onEditInvites,
  onEditRecipients,
  onFetchUsers,
}) => {
  const { colors } = useTheme();

  const [allInvites, setAllInvites] = useState<SessionInvite[] | null>(null);
  const [rosterLoading, setRosterLoading] = useState(false);
  const [rosterError, setRosterError] = useState<string | null>(null);
  // null means "every session" — a real code can never be null, so there is no sentinel to collide.
  const [responseSession, setResponseSession] = useState<string | null>(null);
  // Tracks whether null means "nothing decided yet" (auto-pick the most recent session once
  // loaded) versus "the admin deliberately chose All sessions" (leave it alone).
  const [sessionExplicitlyAll, setSessionExplicitlyAll] = useState(false);
  const [sessionPickerOpen, setSessionPickerOpen] = useState(false);

  // Edit-a-sent-batch state. Seeded from the roster when the sheet opens, so the form starts
  // from what was actually sent rather than from blank fields.
  const [editOpen, setEditOpen] = useState(false);
  const [editSessionId, setEditSessionId] = useState('');
  const [editTitle, setEditTitle] = useState('');
  const [editMessage, setEditMessage] = useState('');
  const [editEventAt, setEditEventAt] = useState<Date | null>(null);
  const [editRoomCode, setEditRoomCode] = useState('');
  const [editPicking, setEditPicking] = useState<'date' | 'time' | null>(null);
  const [editReAsk, setEditReAsk] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  // Recipient editing: which role's list is open, who is marked for removal, and who is being
  // added. Removals are staged rather than applied on tap so one save covers a swap — taking the
  // wrong presenter out and putting the right one in is a single action, not two.
  const [peopleRole, setPeopleRole] = useState<InviteRole | null>(null);
  const [pendingRemoval, setPendingRemoval] = useState<Set<string>>(new Set());
  const [addSelected, setAddSelected] = useState<Set<string>>(new Set());
  const [addTyped, setAddTyped] = useState('');
  const [addRoomCode, setAddRoomCode] = useState('');
  const [accountPickerOpen, setAccountPickerOpen] = useState(false);
  const [accounts, setAccounts] = useState<{ id: string; email: string; name: string }[]>([]);
  const [peopleSaving, setPeopleSaving] = useState(false);
  const [peopleError, setPeopleError] = useState<string | null>(null);

  // Each modal's content scrolls independently of the others, so each gets its own instance
  // rather than sharing one scrollRef/focusedInput across modals that are never open together.
  const editKeyboard = useKeyboardAwareScroll();
  const editSessionIdRef = useRef<TextInput>(null);
  const editRoomCodeRef = useRef<TextInput>(null);
  const editTitleRef = useRef<TextInput>(null);
  const editMessageRef = useRef<TextInput>(null);

  const peopleKeyboard = useKeyboardAwareScroll();
  const addTypedRef = useRef<TextInput>(null);
  const addRoomCodeRef = useRef<TextInput>(null);

  // Deliberately fetches every session's invites rather than just the selected one: the dropdown
  // needs the full set of codes to offer, and switching between them shouldn't cost a round trip.
  const loadRoster = useCallback(async () => {
    setRosterLoading(true);
    setRosterError(null);
    try {
      const result = await onFetchInvites('');
      setAllInvites(result.invites);
    } catch (err: any) {
      setRosterError(err?.message || 'Could not load responses.');
      setAllInvites(null);
    } finally {
      setRosterLoading(false);
    }
  }, [onFetchInvites]);

  useEffect(() => {
    void loadRoster();
  }, [loadRoster]);

  // Distinct codes, most recently invited first — `invites` arrives newest-first from the server,
  // so first-seen order is already the order we want.
  const sessionOptions = useMemo(() => {
    const seen: string[] = [];
    for (const invite of allInvites ?? []) {
      if (!seen.includes(invite.sessionId)) seen.push(invite.sessionId);
    }
    return seen;
  }, [allInvites]);

  // Whether each session's invites are all one role, or a mix of both — shown next to the code so
  // "poc-session" isn't ambiguous when it holds both an attendee batch and a presenter assignment.
  const roleBySession = useMemo(() => {
    const map = new Map<string, 'attendee' | 'presenter' | 'mixed'>();
    for (const invite of allInvites ?? []) {
      const existing = map.get(invite.sessionId);
      if (!existing) map.set(invite.sessionId, invite.inviteRole);
      else if (existing !== invite.inviteRole) map.set(invite.sessionId, 'mixed');
    }
    return map;
  }, [allInvites]);

  // Defaults to the most recent session rather than "All sessions" — a mixed roster of every
  // session's replies at once is rarely what the admin actually wants to see first. Only kicks in
  // while nothing has been picked yet, or the pick just disappeared; explicitly choosing "All
  // sessions" in the picker is a real, sticky choice, not something to override.
  useEffect(() => {
    if (!allInvites) return;
    if (sessionExplicitlyAll) return;
    if (responseSession !== null && sessionOptions.includes(responseSession)) return;
    setResponseSession(sessionOptions[0] ?? null);
  }, [allInvites, sessionOptions, sessionExplicitlyAll, responseSession]);

  const visibleInvites = useMemo(
    () =>
      responseSession === null
        ? allInvites ?? []
        : (allInvites ?? []).filter(i => i.sessionId === responseSession),
    [allInvites, responseSession]
  );

  /** The room(s) this session's presenter invites assign, for the details card. Attendee invites
   *  never carry one, so an all-attendee session simply has none to show. */
  const assignedRooms = useMemo(
    () => [
      ...new Set(
        visibleInvites
          .filter(i => i.inviteRole === 'presenter' && i.roomCode)
          .map(i => i.roomCode!.toUpperCase())
      ),
    ],
    [visibleInvites]
  );

  /** The distinct messages in this session, tagged by who received them — one entry when both
   *  halves were sent the same wording, two when the server wrote each role its own. */
  const perRoleMessages = useMemo(() => {
    const out: { role: 'presenter' | 'attendee'; message: string }[] = [];
    for (const role of ['presenter', 'attendee'] as const) {
      const message = visibleInvites.find(i => i.inviteRole === role)?.message?.trim();
      if (message) out.push({ role, message });
    }
    return out.length === 2 && out[0].message === out[1].message ? [out[0]] : out;
  }, [visibleInvites]);

  const visibleCounts = useMemo(
    () => ({
      total: visibleInvites.length,
      accepted: visibleInvites.filter(i => i.status === 'accepted').length,
      declined: visibleInvites.filter(i => i.status === 'declined').length,
      pending: visibleInvites.filter(i => i.status === 'pending').length,
      expired: visibleInvites.filter(i => i.status === 'expired').length,
    }),
    [visibleInvites]
  );

  /** Seeds the edit form from the session's first invite — every invite under one code shares its
   *  title/message/eventAt, so any one of them is the session's current state. The room comes from
   *  a presenter row instead, since attendee invites never carry one. */
  const openEdit = () => {
    if (!responseSession) return;
    const sample = visibleInvites[0];
    setEditSessionId(responseSession);
    setEditTitle(sample?.title ?? '');
    setEditMessage(sample?.message ?? '');
    setEditEventAt(sample?.eventAt ? new Date(sample.eventAt) : null);
    setEditRoomCode(visibleInvites.find(i => i.inviteRole === 'presenter')?.roomCode ?? '');
    setEditReAsk(false);
    setEditError(null);
    setEditOpen(true);
  };

  const openPeople = (role: InviteRole) => {
    setPeopleRole(role);
    setPendingRemoval(new Set());
    setAddSelected(new Set());
    setAddTyped('');
    setAddRoomCode(role === 'presenter' ? assignedRooms[0] ?? '' : '');
    setPeopleError(null);
    // Loaded lazily: the roster itself doesn't need the account directory, so it's only worth
    // fetching once someone actually opens this sheet.
    if (accounts.length === 0) onFetchUsers().then(setAccounts).catch(() => {});
  };

  /** Everyone currently invited under the role being edited. */
  const peopleInRole = useMemo(
    () => (peopleRole ? visibleInvites.filter(i => i.inviteRole === peopleRole) : []),
    [visibleInvites, peopleRole]
  );

  /** Addresses being added: picked accounts plus anything typed, deduped case-insensitively. */
  const addingEmails = useMemo(() => {
    const manual = addTyped
      .split(/[,\n]/)
      .map(e => e.trim())
      .filter(Boolean);
    const seen = new Set<string>();
    const out: string[] = [];
    for (const e of [...addSelected, ...manual]) {
      const key = e.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        out.push(e);
      }
    }
    return out;
  }, [addSelected, addTyped]);

  const handleSavePeople = async () => {
    if (!responseSession || !peopleRole) return;
    const remove = [...pendingRemoval];
    if (addingEmails.length === 0 && remove.length === 0) return setPeopleRole(null);
    // Only needed for the session's FIRST presenter; after that the server inherits the room that
    // is already assigned, so the field isn't even shown.
    const needsRoom = peopleRole === 'presenter' && assignedRooms.length === 0 && addingEmails.length > 0;
    if (needsRoom && !addRoomCode.trim()) {
      return setPeopleError('Name the room this presenter is assigned to.');
    }

    setPeopleSaving(true);
    setPeopleError(null);
    try {
      const result = await onEditRecipients({
        sessionId: responseSession,
        inviteRole: peopleRole,
        add: addingEmails.length > 0 ? addingEmails : undefined,
        remove: remove.length > 0 ? remove : undefined,
        roomCode: needsRoom ? addRoomCode.trim() : undefined,
      });
      setPeopleRole(null);
      await loadRoster();
      if (result.skipped.length > 0) {
        setRosterError(`Already invited, so left as they were: ${result.skipped.join(', ')}.`);
      }
    } catch (err: any) {
      setPeopleError(err?.message || 'Could not update the list.');
    } finally {
      setPeopleSaving(false);
    }
  };

  const handleEditPickerChange = (event: DateTimePickerEvent, selected?: Date) => {
    if (Platform.OS !== 'ios') setEditPicking(null);
    if (event.type === 'dismissed' || !selected) {
      setEditPicking(null);
      return;
    }
    const base = editEventAt ?? defaultEventAt();
    const merged = new Date(base);
    if (editPicking === 'time') merged.setHours(selected.getHours(), selected.getMinutes(), 0, 0);
    else merged.setFullYear(selected.getFullYear(), selected.getMonth(), selected.getDate());
    setEditEventAt(merged);
  };

  const handleSaveEdit = async () => {
    if (!responseSession) return;
    if (!editSessionId.trim()) return setEditError('The session code cannot be empty.');

    setEditSaving(true);
    setEditError(null);
    try {
      const result = await onEditInvites({
        sessionId: responseSession,
        newSessionId: editSessionId.trim() !== responseSession ? editSessionId.trim() : undefined,
        title: editTitle.trim() || undefined,
        message: editMessage.trim() || undefined,
        // Only meaningful when this session actually assigns a room; the server applies it to the
        // presenter rows alone, never to attendee invites.
        roomCode: assignedRooms.length > 0 && editRoomCode.trim() ? editRoomCode.trim() : undefined,
        // Always sent, so clearing the schedule is expressible as an explicit null.
        eventAt: editEventAt ? editEventAt.toISOString() : null,
        reAsk: editReAsk,
      });
      setEditOpen(false);
      // Follow the batch if it was renamed, otherwise the filter would point at a code that no
      // longer exists and the list would fall back to "all sessions".
      setResponseSession(result.sessionId);
      await loadRoster();
      if (result.pushError && editReAsk) {
        setRosterError(`Details saved, but the re-ask notification failed: ${result.pushError}`);
      }
    } catch (err: any) {
      setEditError(err?.message || 'Could not save the changes.');
    } finally {
      setEditSaving(false);
    }
  };

  return (
    <>
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.label, { color: colors.sub }]}>SESSION</Text>
        <TouchableOpacity
          activeOpacity={0.8}
          disabled={sessionOptions.length === 0}
          onPress={() => setSessionPickerOpen(true)}
          style={[
            styles.pickerTrigger,
            {
              backgroundColor: colors.bg,
              borderColor: colors.border,
              opacity: sessionOptions.length === 0 ? 0.6 : 1,
            },
          ]}
        >
          <Text style={[styles.pickerTriggerText, { color: colors.txt }]} numberOfLines={1}>
            {sessionOptions.length === 0
              ? 'No sessions with invites yet'
              : responseSession === null
              ? `All sessions (${sessionOptions.length})`
              : responseSession}
          </Text>
          {responseSession !== null && roleBySession.has(responseSession) ? (
            <View
              style={[
                styles.roleBadge,
                { backgroundColor: `${ROLE_META[roleBySession.get(responseSession)!].color}26` },
              ]}
            >
              <Text style={[styles.roleBadgeText, { color: ROLE_META[roleBySession.get(responseSession)!].color }]}>
                {ROLE_META[roleBySession.get(responseSession)!].label}
              </Text>
            </View>
          ) : null}
          <Svg width={14} height={14} viewBox="0 0 24 24" fill="none">
            <Path d="M6 9l6 6 6-6" stroke={colors.muted} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
          </Svg>
        </TouchableOpacity>
      </View>

      {rosterLoading && (
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={palette.mintPresence} />
        </View>
      )}

      {rosterError ? (
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: palette.roseError }]}>
          <Text style={[styles.errorText, { color: palette.roseError, marginTop: 0 }]}>{rosterError}</Text>
        </View>
      ) : null}

      {!rosterLoading && allInvites ? (
        <>
          {/* A session's presenter and attendee invites are sent together under one code and share
              their title, message and schedule, so the first row speaks for the whole session —
              the same row "Edit details" seeds from. Only the room differs, and only presenters
              have one, so it is listed separately. */}
          {responseSession !== null && visibleInvites.length > 0 ? (
            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.label, { color: colors.sub }]}>TITLE</Text>
              <Text style={[styles.detailValue, { color: colors.txt }]}>{visibleInvites[0].title || 'Check-in request'}</Text>

              <Text style={[styles.label, { color: colors.sub, marginTop: 14 }]}>MESSAGE</Text>
              {/* An invite sent without a message gets wording written per role ("you're hosting
                  Hall A" vs "please check in"), so a session can hold two of them. Showing one as
                  if it were the session's message would misquote whoever got the other. */}
              {perRoleMessages.length > 1 ? (
                perRoleMessages.map(({ role, message }) => (
                  <View key={role} style={{ marginTop: 4 }}>
                    <Text style={[styles.messageRoleLabel, { color: colors.muted }]}>
                      {role === 'presenter' ? 'To the presenter' : 'To attendees'}
                    </Text>
                    <Text style={[styles.detailValue, { color: colors.txt, marginTop: 1 }]}>{message}</Text>
                  </View>
                ))
              ) : (
                <Text style={[styles.detailValue, { color: colors.txt }]}>
                  {perRoleMessages[0]?.message || 'No message set.'}
                </Text>
              )}

              <Text style={[styles.label, { color: colors.sub, marginTop: 14 }]}>WHEN</Text>
              <Text style={[styles.detailValue, { color: visibleInvites[0].eventAt ? colors.txt : colors.muted }]}>
                {visibleInvites[0].eventAt ? new Date(visibleInvites[0].eventAt).toLocaleString() : 'No time set'}
              </Text>

              {assignedRooms.length > 0 ? (
                <>
                  <Text style={[styles.label, { color: colors.sub, marginTop: 14 }]}>ROOM</Text>
                  <Text style={[styles.detailValue, { color: palette.skyMesh }]}>
                    {assignedRooms.join(', ')}
                  </Text>
                </>
              ) : null}
            </View>
          ) : null}

          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.countsRow}>
              <View style={styles.countBlock}>
                <Text style={[styles.countValue, { color: palette.mintPresence }]}>
                  {visibleCounts.accepted}
                </Text>
                <Text style={[styles.countLabel, { color: colors.muted }]}>ACCEPTED</Text>
              </View>
              <View style={styles.countBlock}>
                <Text style={[styles.countValue, { color: palette.roseError }]}>
                  {visibleCounts.declined}
                </Text>
                <Text style={[styles.countLabel, { color: colors.muted }]}>DECLINED</Text>
              </View>
              <View style={styles.countBlock}>
                <Text style={[styles.countValue, { color: palette.amberWarn }]}>
                  {visibleCounts.pending}
                </Text>
                <Text style={[styles.countLabel, { color: colors.muted }]}>NO REPLY</Text>
              </View>
              {visibleCounts.expired > 0 ? (
                <View style={styles.countBlock}>
                  <Text style={[styles.countValue, { color: '#94A3B8' }]}>
                    {visibleCounts.expired}
                  </Text>
                  <Text style={[styles.countLabel, { color: colors.muted }]}>EXPIRED</Text>
                </View>
              ) : null}
            </View>
            <View style={styles.rosterActions}>
              <TouchableOpacity
                activeOpacity={0.8}
                onPress={() => void loadRoster()}
                style={[styles.refreshButton, { borderColor: colors.border }]}
              >
                <Text style={[styles.refreshText, { color: colors.sub }]}>Refresh</Text>
              </TouchableOpacity>

              {/* Editing needs a single batch to act on, so it's unavailable while the
                  dropdown is showing every session at once. */}
              <TouchableOpacity
                activeOpacity={0.8}
                disabled={!responseSession}
                onPress={openEdit}
                style={[
                  styles.refreshButton,
                  {
                    borderColor: responseSession ? palette.mintPresence : colors.border,
                    opacity: responseSession ? 1 : 0.5,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.refreshText,
                    { color: responseSession ? palette.mintPresence : colors.muted },
                  ]}
                >
                  Edit details
                </Text>
              </TouchableOpacity>
            </View>

            {/* Who is invited, as opposed to what the invite says — separate because adding or
                removing someone is the one change a re-send can't make once a code is used. */}
            <View style={styles.rosterActions}>
              {(['presenter', 'attendee'] as const).map(role => (
                <TouchableOpacity
                  key={role}
                  activeOpacity={0.8}
                  disabled={!responseSession}
                  onPress={() => openPeople(role)}
                  style={[
                    styles.refreshButton,
                    {
                      borderColor: responseSession ? colors.border : colors.border,
                      opacity: responseSession ? 1 : 0.5,
                    },
                  ]}
                >
                  <Text style={[styles.refreshText, { color: responseSession ? colors.txt : colors.muted }]}>
                    {role === 'presenter' ? 'Edit presenter' : 'Edit attendees'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {visibleInvites.length === 0 ? (
            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.hint, { color: colors.muted, marginTop: 0 }]}>
                {responseSession === null
                  ? 'No invites have been sent yet.'
                  : `No invites for "${responseSession}".`}
              </Text>
            </View>
          ) : (
            visibleInvites.map(invite => {
              const meta = STATUS_META[invite.status];
              return (
                <View
                  key={invite.id}
                  style={[styles.inviteRow, { backgroundColor: colors.card, borderColor: colors.border }]}
                >
                  <View style={styles.inviteLeft}>
                    <Text style={[styles.inviteName, { color: colors.txt }]} numberOfLines={1}>
                      {invite.displayName}
                    </Text>
                    {invite.displayName !== invite.email ? (
                      <Text style={[styles.inviteEmail, { color: colors.muted }]} numberOfLines={1}>
                        {invite.email}
                      </Text>
                    ) : null}
                    {invite.inviteRole === 'presenter' ? (
                      <Text style={[styles.hostTag, { color: palette.skyMesh }]}>
                        HOSTING {(invite.roomCode ?? '').toUpperCase()}
                      </Text>
                    ) : null}
                    <Text style={[styles.inviteMeta, { color: colors.muted }]}>
                      {invite.eventAt
                        ? new Date(invite.eventAt).toLocaleString()
                        : invite.respondedAt
                        ? `Replied ${new Date(invite.respondedAt).toLocaleString()}`
                        : `Invited ${new Date(invite.createdAt).toLocaleString()}`}
                    </Text>
                  </View>
                  <View style={[styles.statusPill, { backgroundColor: meta.tint }]}>
                    <Text style={[styles.statusPillText, { color: meta.color }]}>{meta.label}</Text>
                  </View>
                </View>
              );
            })
          )}

          <Text style={[styles.footnote, { color: colors.muted }]}>
            Accepting is a reply, not attendance. Who was actually in the room still comes from
            sensor-verified presence, shown in the Monitor and History tabs.
          </Text>
        </>
      ) : null}

      <Modal visible={editOpen} animationType="slide" transparent onRequestClose={() => setEditOpen(false)}>
        <TouchableOpacity activeOpacity={1} style={styles.modalBackdrop} onPress={() => setEditOpen(false)}>
          {/* A Modal renders in its own native window on Android, which doesn't resize for the
              keyboard the way the main screen does — padding added to the ScrollView's content
              assumes the viewport shrinks to reveal it, which never happens here. Shifting the
              sheet itself up by the keyboard's own reported height works regardless, since it's
              a plain layout change inside content RN already renders, not something that depends
              on the surrounding native window resizing at all. */}
          <TouchableOpacity
            activeOpacity={1}
            style={[styles.modalSheet, { backgroundColor: colors.bg, marginBottom: editKeyboard.keyboardPadding }]}
          >
            <View style={styles.modalHeaderRow}>
              <Text style={[styles.modalTitle, { color: colors.txt }]}>Edit Invite Details</Text>
              <TouchableOpacity activeOpacity={0.7} onPress={() => setEditOpen(false)} style={styles.modalCloseButton}>
                <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
                  <Path d="M6 6l12 12M18 6L6 18" stroke={colors.sub} strokeWidth={2} strokeLinecap="round" />
                </Svg>
              </TouchableOpacity>
            </View>

            <ScrollView ref={editKeyboard.scrollRef} style={styles.modalScroll} showsVerticalScrollIndicator={false}>
              <Text style={[styles.hint, { color: colors.muted, marginTop: 0 }]}>
                Applies to all {visibleInvites.length} invite{visibleInvites.length === 1 ? '' : 's'} in
                this session.
              </Text>

              <Text style={[styles.label, { color: colors.sub, marginTop: 16 }]}>SESSION CODE</Text>
              <TextInput
                ref={editSessionIdRef}
                onFocus={editKeyboard.focusHandlerFor(editSessionIdRef)}
                style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.txt }]}
                value={editSessionId}
                onChangeText={setEditSessionId}
                autoCapitalize="none"
              />

              {assignedRooms.length > 0 ? (
                <>
                  <Text style={[styles.label, { color: colors.sub, marginTop: 16 }]}>ASSIGNED ROOM</Text>
                  <TextInput
                    ref={editRoomCodeRef}
                    onFocus={editKeyboard.focusHandlerFor(editRoomCodeRef)}
                    style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.txt }]}
                    value={editRoomCode}
                    onChangeText={setEditRoomCode}
                    placeholder="e.g. Hall A"
                    placeholderTextColor={colors.muted}
                    autoCapitalize="words"
                  />
                  <Text style={[styles.hint, { color: colors.muted }]}>
                    Applies to this session's presenter invites only. Attendees are not assigned a
                    room.
                  </Text>
                </>
              ) : null}

              <Text style={[styles.label, { color: colors.sub, marginTop: 16 }]}>WHEN IS IT?</Text>
              <View style={styles.dateTimeRow}>
                <TouchableOpacity
                  activeOpacity={0.8}
                  onPress={() => {
                    if (!editEventAt) setEditEventAt(defaultEventAt());
                    setEditPicking('date');
                  }}
                  style={[styles.pickerTrigger, styles.dateInput, { backgroundColor: colors.card, borderColor: colors.border }]}
                >
                  <Text
                    style={[styles.pickerTriggerText, { color: editEventAt ? colors.txt : colors.muted }]}
                    numberOfLines={1}
                  >
                    {editEventAt ? editEventAt.toLocaleDateString() : 'Pick a date'}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  activeOpacity={0.8}
                  onPress={() => {
                    if (!editEventAt) setEditEventAt(defaultEventAt());
                    setEditPicking('time');
                  }}
                  style={[styles.pickerTrigger, styles.timeInput, { backgroundColor: colors.card, borderColor: colors.border }]}
                >
                  <Text
                    style={[styles.pickerTriggerText, { color: editEventAt ? colors.txt : colors.muted }]}
                    numberOfLines={1}
                  >
                    {editEventAt
                      ? editEventAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true })
                      : 'Time'}
                  </Text>
                </TouchableOpacity>
              </View>
              {editEventAt ? (
                <View style={styles.eventSummaryRow}>
                  <Text style={[styles.hint, { color: palette.mintPresence, marginTop: 0, flex: 1 }]}>
                    {editEventAt.toLocaleString()}
                  </Text>
                  <TouchableOpacity activeOpacity={0.7} onPress={() => setEditEventAt(null)}>
                    <Text style={[styles.clearText, { color: colors.muted }]}>Clear</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <Text style={[styles.hint, { color: colors.muted }]}>No time set for this session.</Text>
              )}

              {editPicking ? (
                <DateTimePicker
                  value={editEventAt ?? defaultEventAt()}
                  mode={editPicking}
                  is24Hour={false}
                  display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                  onChange={handleEditPickerChange}
                />
              ) : null}

              <Text style={[styles.label, { color: colors.sub, marginTop: 16 }]}>TITLE</Text>
              <TextInput
                ref={editTitleRef}
                onFocus={editKeyboard.focusHandlerFor(editTitleRef)}
                style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.txt }]}
                value={editTitle}
                onChangeText={setEditTitle}
                placeholder="Check-in request"
                placeholderTextColor={colors.muted}
              />

              <Text style={[styles.label, { color: colors.sub, marginTop: 16 }]}>MESSAGE</Text>
              <TextInput
                ref={editMessageRef}
                onFocus={editKeyboard.focusHandlerFor(editMessageRef)}
                style={[
                  styles.input,
                  styles.multiline,
                  { backgroundColor: colors.card, borderColor: colors.border, color: colors.txt },
                ]}
                value={editMessage}
                onChangeText={setEditMessage}
                multiline
              />

              <View style={[styles.reAskRow, { borderColor: colors.border }]}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.reAskTitle, { color: colors.txt }]}>Ask everyone again</Text>
                  <Text style={[styles.reAskDesc, { color: colors.muted }]}>
                    {editReAsk
                      ? `Clears all ${visibleInvites.length} replies and re-notifies. Use this when the time moved.`
                      : 'Replies stay as they are. Use this for a correction.'}
                  </Text>
                </View>
                <Switch
                  value={editReAsk}
                  onValueChange={setEditReAsk}
                  trackColor={{ false: colors.border, true: 'rgba(51,209,172,0.4)' }}
                  thumbColor={editReAsk ? palette.mintPresence : colors.sub}
                />
              </View>

              {editError ? (
                <Text style={[styles.errorText, { color: palette.roseError }]}>{editError}</Text>
              ) : null}

              <TouchableOpacity
                activeOpacity={0.85}
                disabled={editSaving}
                onPress={() => void handleSaveEdit()}
                style={[styles.primaryButton, editSaving && { opacity: 0.6 }]}
              >
                {editSaving ? (
                  <ActivityIndicator size="small" color="#0F2F2C" />
                ) : (
                  <Text style={styles.primaryButtonText}>
                    {editReAsk ? 'Save and ask again' : 'Save changes'}
                  </Text>
                )}
              </TouchableOpacity>
            </ScrollView>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      <Modal
        visible={peopleRole !== null}
        animationType="slide"
        transparent
        onRequestClose={() => setPeopleRole(null)}
      >
        <TouchableOpacity activeOpacity={1} style={styles.modalBackdrop} onPress={() => setPeopleRole(null)}>
          <TouchableOpacity
            activeOpacity={1}
            style={[styles.modalSheet, { backgroundColor: colors.bg, marginBottom: peopleKeyboard.keyboardPadding }]}
          >
            <View style={styles.modalHeaderRow}>
              <Text style={[styles.modalTitle, { color: colors.txt }]}>
                {peopleRole === 'presenter' ? 'Presenter' : 'Attendees'}
              </Text>
              <TouchableOpacity activeOpacity={0.7} onPress={() => setPeopleRole(null)} style={styles.modalCloseButton}>
                <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
                  <Path d="M6 6l12 12M18 6L6 18" stroke={colors.sub} strokeWidth={2} strokeLinecap="round" />
                </Svg>
              </TouchableOpacity>
            </View>

            <ScrollView ref={peopleKeyboard.scrollRef} style={styles.modalScroll} showsVerticalScrollIndicator={false}>
              <Text style={[styles.hint, { color: colors.muted, marginTop: 0 }]}>
                Removing someone deletes their invite, including any reply they already gave.
                Anyone added is invited on the same terms as the rest of this session.
              </Text>

              <Text style={[styles.label, { color: colors.sub, marginTop: 16 }]}>
                CURRENTLY INVITED ({peopleInRole.length})
              </Text>
              {peopleInRole.length === 0 ? (
                <Text style={[styles.hint, { color: colors.muted, marginTop: 4 }]}>
                  {peopleRole === 'presenter'
                    ? 'Nobody is hosting this session yet.'
                    : 'Nobody has been asked to check in yet.'}
                </Text>
              ) : (
                peopleInRole.map(invite => {
                  const marked = pendingRemoval.has(invite.email);
                  const meta = STATUS_META[invite.status];
                  return (
                    <View
                      key={invite.id}
                      style={[styles.personRow, { borderBottomColor: colors.border, opacity: marked ? 0.45 : 1 }]}
                    >
                      <View style={{ flex: 1 }}>
                        <Text
                          style={[
                            styles.userName,
                            {
                              color: colors.txt,
                              textDecorationLine: marked ? 'line-through' : 'none',
                            },
                          ]}
                          numberOfLines={1}
                        >
                          {invite.displayName}
                        </Text>
                        <Text style={[styles.userEmail, { color: meta.color }]} numberOfLines={1}>
                          {meta.label}
                        </Text>
                      </View>
                      <TouchableOpacity
                        activeOpacity={0.7}
                        onPress={() =>
                          setPendingRemoval(prev => {
                            const next = new Set(prev);
                            if (next.has(invite.email)) next.delete(invite.email);
                            else next.add(invite.email);
                            return next;
                          })
                        }
                      >
                        <Text
                          style={[
                            styles.refreshText,
                            { color: marked ? palette.mintPresence : palette.roseError },
                          ]}
                        >
                          {marked ? 'Keep' : 'Remove'}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  );
                })
              )}

              <Text style={[styles.label, { color: colors.sub, marginTop: 20 }]}>ADD PEOPLE</Text>
              <TouchableOpacity
                activeOpacity={0.8}
                onPress={() => setAccountPickerOpen(true)}
                style={[styles.pickerTrigger, { backgroundColor: colors.card, borderColor: colors.border }]}
              >
                <Text
                  style={[styles.pickerTriggerText, { color: addSelected.size > 0 ? colors.txt : colors.muted }]}
                  numberOfLines={1}
                >
                  {addSelected.size > 0 ? `${addSelected.size} selected` : 'Pick from known accounts'}
                </Text>
                <Svg width={14} height={14} viewBox="0 0 24 24" fill="none">
                  <Path d="M6 9l6 6 6-6" stroke={colors.muted} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
                </Svg>
              </TouchableOpacity>
              <TextInput
                ref={addTypedRef}
                onFocus={peopleKeyboard.focusHandlerFor(addTypedRef)}
                style={[
                  styles.input,
                  styles.multiline,
                  { backgroundColor: colors.card, borderColor: colors.border, color: colors.txt, marginTop: 10 },
                ]}
                value={addTyped}
                onChangeText={setAddTyped}
                placeholder="Or type addresses: alice@example.com"
                placeholderTextColor={colors.muted}
                autoCapitalize="none"
                keyboardType="email-address"
                multiline
              />

              {peopleRole === 'presenter' && assignedRooms.length === 0 ? (
                <>
                  <Text style={[styles.label, { color: colors.sub, marginTop: 16 }]}>ASSIGN ROOM</Text>
                  <TextInput
                    ref={addRoomCodeRef}
                    onFocus={peopleKeyboard.focusHandlerFor(addRoomCodeRef)}
                    style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.txt }]}
                    value={addRoomCode}
                    onChangeText={setAddRoomCode}
                    placeholder="e.g. Hall A"
                    placeholderTextColor={colors.muted}
                    autoCapitalize="words"
                  />
                  <Text style={[styles.hint, { color: colors.muted }]}>
                    This session has no room assigned yet, so the first presenter needs one.
                  </Text>
                </>
              ) : null}

              {peopleError ? (
                <Text style={[styles.errorText, { color: palette.roseError }]}>{peopleError}</Text>
              ) : null}

              <TouchableOpacity
                activeOpacity={0.85}
                disabled={peopleSaving}
                onPress={() => void handleSavePeople()}
                style={[styles.primaryButton, peopleSaving && { opacity: 0.6 }]}
              >
                {peopleSaving ? (
                  <ActivityIndicator size="small" color="#0F2F2C" />
                ) : (
                  <Text style={styles.primaryButtonText}>
                    {addingEmails.length === 0 && pendingRemoval.size === 0
                      ? 'Done'
                      : [
                          addingEmails.length > 0 ? `Add ${addingEmails.length}` : null,
                          pendingRemoval.size > 0 ? `Remove ${pendingRemoval.size}` : null,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                  </Text>
                )}
              </TouchableOpacity>
            </ScrollView>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      <Modal
        visible={accountPickerOpen}
        animationType="slide"
        transparent
        onRequestClose={() => setAccountPickerOpen(false)}
      >
        <TouchableOpacity activeOpacity={1} style={styles.modalBackdrop} onPress={() => setAccountPickerOpen(false)}>
          <TouchableOpacity activeOpacity={1} style={[styles.modalSheet, { backgroundColor: colors.bg }]}>
            <View style={styles.modalHeaderRow}>
              <Text style={[styles.modalTitle, { color: colors.txt }]}>Add To This Session</Text>
              <TouchableOpacity
                activeOpacity={0.7}
                onPress={() => setAccountPickerOpen(false)}
                style={styles.modalCloseButton}
              >
                <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
                  <Path d="M6 6l12 12M18 6L6 18" stroke={colors.sub} strokeWidth={2} strokeLinecap="round" />
                </Svg>
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.modalScroll} showsVerticalScrollIndicator={false}>
              {(() => {
                // Anyone already in this session is left out: on their own list they are already
                // invited, and on the other one they'd be an impossible second role.
                const alreadyIn = new Set(visibleInvites.map(i => i.email.toLowerCase()));
                const offerable = accounts.filter(a => !alreadyIn.has(a.email.toLowerCase()));
                if (offerable.length === 0) {
                  return (
                    <Text style={[styles.hint, { color: colors.muted }]}>
                      {accounts.length === 0
                        ? 'No accounts found. Type addresses manually instead.'
                        : 'Everyone with an account is already invited to this session.'}
                    </Text>
                  );
                }
                return offerable.map(user => {
                  const checked = addSelected.has(user.email);
                  return (
                    <TouchableOpacity
                      key={user.id}
                      activeOpacity={0.8}
                      onPress={() =>
                        setAddSelected(prev => {
                          const next = new Set(prev);
                          if (next.has(user.email)) next.delete(user.email);
                          else next.add(user.email);
                          return next;
                        })
                      }
                      style={[styles.userRow, { borderBottomColor: colors.border }]}
                    >
                      <View
                        style={[
                          styles.checkbox,
                          {
                            borderColor: checked ? palette.mintPresence : colors.border,
                            backgroundColor: checked ? palette.mintPresence : 'transparent',
                          },
                        ]}
                      >
                        {checked && (
                          <Svg width={12} height={12} viewBox="0 0 24 24" fill="none">
                            <Path d="M5 13l4 4L19 7" stroke="#0F2F2C" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
                          </Svg>
                        )}
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.userName, { color: colors.txt }]} numberOfLines={1}>
                          {user.name}
                        </Text>
                        <Text style={[styles.userEmail, { color: colors.muted }]} numberOfLines={1}>
                          {user.email}
                        </Text>
                      </View>
                    </TouchableOpacity>
                  );
                });
              })()}
            </ScrollView>

            <TouchableOpacity
              activeOpacity={0.85}
              onPress={() => setAccountPickerOpen(false)}
              style={styles.primaryButton}
            >
              <Text style={styles.primaryButtonText}>Done</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      <Modal
        visible={sessionPickerOpen}
        animationType="slide"
        transparent
        onRequestClose={() => setSessionPickerOpen(false)}
      >
        <TouchableOpacity activeOpacity={1} style={styles.modalBackdrop} onPress={() => setSessionPickerOpen(false)}>
          <TouchableOpacity activeOpacity={1} style={[styles.modalSheet, { backgroundColor: colors.bg }]}>
            <View style={styles.modalHeaderRow}>
              <Text style={[styles.modalTitle, { color: colors.txt }]}>Show Responses For</Text>
              <TouchableOpacity
                activeOpacity={0.7}
                onPress={() => setSessionPickerOpen(false)}
                style={styles.modalCloseButton}
              >
                <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
                  <Path d="M6 6l12 12M18 6L6 18" stroke={colors.sub} strokeWidth={2} strokeLinecap="round" />
                </Svg>
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.modalScroll} showsVerticalScrollIndicator={false}>
              {[null, ...sessionOptions].map(option => {
                const selected = option === responseSession;
                const count =
                  option === null
                    ? (allInvites ?? []).length
                    : (allInvites ?? []).filter(i => i.sessionId === option).length;
                const role = option !== null ? roleBySession.get(option) : undefined;
                return (
                  <TouchableOpacity
                    key={option ?? '__all__'}
                    activeOpacity={0.8}
                    onPress={() => {
                      setResponseSession(option);
                      setSessionExplicitlyAll(option === null);
                      setSessionPickerOpen(false);
                    }}
                    style={[styles.sessionOptionRow, { borderBottomColor: colors.border }]}
                  >
                    <View style={{ flex: 1 }}>
                      <View style={styles.sessionOptionTitleRow}>
                        <Text
                          style={[
                            styles.sessionOptionText,
                            { color: selected ? palette.mintPresence : colors.txt },
                          ]}
                          numberOfLines={1}
                        >
                          {option === null ? 'All sessions' : option}
                        </Text>
                        {role ? (
                          <View style={[styles.roleBadge, { backgroundColor: `${ROLE_META[role].color}26` }]}>
                            <Text style={[styles.roleBadgeText, { color: ROLE_META[role].color }]}>
                              {ROLE_META[role].label}
                            </Text>
                          </View>
                        ) : null}
                      </View>
                      <Text style={[styles.sessionOptionCount, { color: colors.muted }]}>
                        {count} invite{count === 1 ? '' : 's'}
                      </Text>
                    </View>
                    {selected && (
                      <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
                        <Path
                          d="M5 13l4 4L19 7"
                          stroke={palette.mintPresence}
                          strokeWidth={2.5}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </Svg>
                    )}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </>
  );
};

const styles = StyleSheet.create({
  card: { borderRadius: 16, borderWidth: 1.5, padding: 16, marginBottom: 12 },
  label: { fontSize: 10, fontWeight: '800', letterSpacing: 0.8, marginBottom: 6 },
  input: {
    borderWidth: 1.5,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
  },
  multiline: { minHeight: 72, textAlignVertical: 'top' },
  dateTimeRow: { flexDirection: 'row', gap: 8 },
  dateInput: { flex: 1.4 },
  timeInput: { flex: 1 },
  eventSummaryRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8 },
  clearText: { fontSize: 11, fontWeight: '700' },
  hint: { fontSize: 11, lineHeight: 17, marginTop: 8 },
  pickerTrigger: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    borderWidth: 1.5,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  pickerTriggerText: { fontSize: 14, flex: 1 },
  detailValue: { fontSize: 14, fontWeight: '600', lineHeight: 19, marginTop: 4 },
  messageRoleLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 0.3, marginTop: 6 },
  personRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 11,
    borderBottomWidth: 1,
  },
  userRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  userName: { fontSize: 14, fontWeight: '600' },
  userEmail: { fontSize: 11, marginTop: 1 },
  primaryButton: {
    backgroundColor: palette.mintPresence,
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
    marginTop: 18,
  },
  primaryButtonText: { color: '#0F2F2C', fontSize: 14, fontWeight: '800' },
  errorText: { fontSize: 12, marginTop: 10 },
  loadingWrap: { paddingVertical: 28 },
  countsRow: { flexDirection: 'row', justifyContent: 'space-around' },
  countBlock: { alignItems: 'center', gap: 2 },
  countValue: { fontSize: 26, fontWeight: '900', letterSpacing: -0.5 },
  countLabel: { fontSize: 9, fontWeight: '800', letterSpacing: 0.8 },
  rosterActions: { flexDirection: 'row', gap: 8 },
  refreshButton: {
    flex: 1,
    marginTop: 14,
    borderWidth: 1.5,
    borderRadius: 12,
    paddingVertical: 9,
    alignItems: 'center',
  },
  reAskRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1.5,
    borderRadius: 14,
    padding: 14,
    marginTop: 18,
  },
  reAskTitle: { fontSize: 14, fontWeight: '700' },
  reAskDesc: { fontSize: 11, lineHeight: 16, marginTop: 2 },
  refreshText: { fontSize: 12, fontWeight: '700' },
  inviteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    borderRadius: 14,
    borderWidth: 1.5,
    padding: 14,
    marginBottom: 12,
  },
  inviteLeft: { flex: 1 },
  inviteName: { fontSize: 14, fontWeight: '700' },
  inviteEmail: { fontSize: 11, marginTop: 1 },
  inviteMeta: { fontSize: 10, marginTop: 4 },
  hostTag: { fontSize: 9, fontWeight: '800', letterSpacing: 0.5, marginTop: 3 },
  statusPill: { paddingHorizontal: 9, paddingVertical: 4, borderRadius: 999 },
  statusPillText: { fontSize: 9, fontWeight: '800', letterSpacing: 0.5 },
  footnote: { fontSize: 11, lineHeight: 17, marginTop: 4, marginBottom: 4, paddingHorizontal: 2 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalSheet: {
    maxHeight: '75%',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
  },
  modalHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  modalTitle: { fontSize: 16, fontWeight: '800' },
  modalCloseButton: { padding: 4 },
  modalScroll: { flexGrow: 0 },
  sessionOptionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  sessionOptionText: { fontSize: 14, fontWeight: '700' },
  sessionOptionCount: { fontSize: 11, marginTop: 2 },
  sessionOptionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  roleBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  roleBadgeText: { fontSize: 9, fontWeight: '800', letterSpacing: 0.5 },
});
