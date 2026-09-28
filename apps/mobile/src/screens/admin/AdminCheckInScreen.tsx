import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
import { TopBar } from '../../components/ui/TopBar';
import { MobileScreen } from '../../components/navigation/BottomNav';
import type { NotifiableUser } from './AdminNotifyScreen';

export interface InviteSendResult {
  invited: number;
  pushed: string[];
  notReachableByPush: string[];
  pushError: string | null;
}

export interface InviteRoster {
  invites: SessionInvite[];
  counts: { total: number; accepted: number; declined: number; pending: number; expired: number };
}

interface AdminCheckInScreenProps {
  /** Prefills the session field with whatever session the admin is currently working under. */
  defaultSessionId: string;
  onFetchUsers: () => Promise<NotifiableUser[]>;
  onSendInvites: (
    sessionId: string,
    emails: string[],
    title: string,
    message: string,
    /** ISO instant for when the event is scheduled, or null when the admin left it blank. */
    eventAt: string | null,
    inviteRole: InviteRole,
    /** Required for a presenter invite, null for an attendee one. */
    roomCode: string | null
  ) => Promise<InviteSendResult>;
  onFetchInvites: (sessionId: string) => Promise<InviteRoster>;
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
  onNavigate: (screen: MobileScreen) => void;
}

/** Where the picker starts when nothing is set yet: the next whole hour, which is nearly always
 *  closer to the intended answer than "right now, to the second". */
function defaultEventAt(): Date {
  const d = new Date();
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1);
  return d;
}

const STATUS_META: Record<SessionInvite['status'], { label: string; color: string; tint: string }> = {
  accepted: { label: 'ACCEPTED', color: palette.mintPresence, tint: 'rgba(51,209,172,0.15)' },
  declined: { label: 'DECLINED', color: palette.roseError, tint: 'rgba(239,68,68,0.15)' },
  pending: { label: 'NO REPLY', color: palette.amberWarn, tint: 'rgba(245,158,11,0.15)' },
  // Set server-side once eventAt has passed while still pending — a no-reply that came too late
  // to still act on, distinct from one the admin can still chase. A plain neutral rather than a
  // theme color: this map is a static module-level constant with no access to the theme context.
  expired: { label: 'EXPIRED', color: '#94A3B8', tint: 'rgba(148,163,184,0.15)' },
};

export const AdminCheckInScreen: React.FC<AdminCheckInScreenProps> = ({
  defaultSessionId,
  onFetchUsers,
  onSendInvites,
  onFetchInvites,
  onEditInvites,
  onNavigate,
}) => {
  const { colors } = useTheme();
  const [tab, setTab] = useState<'invite' | 'responses'>('invite');
  const [sessionId, setSessionId] = useState(defaultSessionId);

  // Compose state
  const [users, setUsers] = useState<NotifiableUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(true);
  const [selectedEmails, setSelectedEmails] = useState<Set<string>>(new Set());
  const [typedEmails, setTypedEmails] = useState('');
  const [title, setTitle] = useState('Check-in request');
  const [message, setMessage] = useState('');
  // One Date holds the whole schedule; the two pickers each edit their half of it. null means
  // the admin hasn't set a time, which is a valid invite.
  const [inviteRole, setInviteRole] = useState<InviteRole>('attendee');
  const [roomCode, setRoomCode] = useState('');
  const [eventAt, setEventAt] = useState<Date | null>(null);
  const [picking, setPicking] = useState<'date' | 'time' | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sendResult, setSendResult] = useState<InviteSendResult | null>(null);

  // Roster state. The whole roster is fetched unfiltered and narrowed on the client, so the
  // session dropdown can only ever offer codes that actually have invites behind them — deriving
  // the options from the same data being displayed means the two can't disagree.
  const [allInvites, setAllInvites] = useState<SessionInvite[] | null>(null);
  const [rosterLoading, setRosterLoading] = useState(false);
  const [rosterError, setRosterError] = useState<string | null>(null);
  // null means "every session" — a real code can never be null, so there is no sentinel to collide.
  const [responseSession, setResponseSession] = useState<string | null>(null);
  const [sessionPickerOpen, setSessionPickerOpen] = useState(false);

  // Edit-a-sent-batch state. Seeded from the roster when the sheet opens, so the form starts
  // from what was actually sent rather than from blank fields.
  const [editOpen, setEditOpen] = useState(false);
  const [editSessionId, setEditSessionId] = useState('');
  const [editTitle, setEditTitle] = useState('');
  const [editMessage, setEditMessage] = useState('');
  const [editEventAt, setEditEventAt] = useState<Date | null>(null);
  const [editPicking, setEditPicking] = useState<'date' | 'time' | null>(null);
  const [editReAsk, setEditReAsk] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    onFetchUsers()
      .then(list => {
        if (!cancelled) setUsers(list);
      })
      .catch(() => {
        // The manual-entry field still works without the directory, so a failure here is not fatal.
      })
      .finally(() => {
        if (!cancelled) setUsersLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [onFetchUsers]);

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
    if (tab === 'responses') void loadRoster();
  }, [tab, loadRoster]);

  // Distinct codes, most recently invited first — `invites` arrives newest-first from the server,
  // so first-seen order is already the order we want.
  const sessionOptions = useMemo(() => {
    const seen: string[] = [];
    for (const invite of allInvites ?? []) {
      if (!seen.includes(invite.sessionId)) seen.push(invite.sessionId);
    }
    return seen;
  }, [allInvites]);

  // If the selected code disappears (its invites were removed, or the list reloaded without it),
  // fall back to showing everything rather than an empty list under a stale label.
  useEffect(() => {
    if (responseSession === null) return;
    if (allInvites && !sessionOptions.includes(responseSession)) setResponseSession(null);
  }, [allInvites, sessionOptions, responseSession]);

  const visibleInvites = useMemo(
    () =>
      responseSession === null
        ? allInvites ?? []
        : (allInvites ?? []).filter(i => i.sessionId === responseSession),
    [allInvites, responseSession]
  );

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

  /** Seeds the edit form from the batch's first invite — every invite in a batch carries the
   *  same title/message/eventAt, so any one of them is the batch's current state. */
  const openEdit = () => {
    if (!responseSession) return;
    const sample = visibleInvites[0];
    setEditSessionId(responseSession);
    setEditTitle(sample?.title ?? '');
    setEditMessage(sample?.message ?? '');
    setEditEventAt(sample?.eventAt ? new Date(sample.eventAt) : null);
    setEditReAsk(false);
    setEditError(null);
    setEditOpen(true);
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

  const openPicker = (mode: 'date' | 'time') => {
    // Seed a value on first open so the time picker has a date to attach to (and vice versa),
    // rather than the two halves being edited against different days.
    if (!eventAt) setEventAt(defaultEventAt());
    setPicking(mode);
  };

  /**
   * Android fires this once and dismisses itself; iOS fires it continuously while the spinner
   * moves. Closing on every Android event is right, and on iOS the picker stays up until the
   * trigger is tapped again, so `picking` is only cleared on Android or a dismissal.
   */
  const handlePickerChange = (event: DateTimePickerEvent, selected?: Date) => {
    if (Platform.OS !== 'ios') setPicking(null);
    if (event.type === 'dismissed' || !selected) {
      setPicking(null);
      return;
    }
    // Merge rather than replace: the date picker must not clobber the chosen time, and the time
    // picker must not clobber the chosen day.
    const base = eventAt ?? defaultEventAt();
    const merged = new Date(base);
    if (picking === 'time') {
      merged.setHours(selected.getHours(), selected.getMinutes(), 0, 0);
    } else {
      merged.setFullYear(selected.getFullYear(), selected.getMonth(), selected.getDate());
    }
    setEventAt(merged);
  };

  const recipientList = () => {
    const typed = typedEmails
      .split(/[,\n]/)
      .map(e => e.trim())
      .filter(Boolean);
    // Case-insensitive dedupe across the picker and manual entry, so one person invited both ways
    // is one invite rather than two rows the server then has to collapse.
    const seen = new Set<string>();
    const out: string[] = [];
    for (const e of [...selectedEmails, ...typed]) {
      const key = e.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        out.push(e);
      }
    }
    return out;
  };

  const handleSend = async () => {
    const emails = recipientList();
    if (!sessionId.trim()) return setSendError('Enter the session code these invites are for.');
    if (emails.length === 0) return setSendError('Select or enter at least one email address.');
    if (inviteRole === 'presenter' && !roomCode.trim()) {
      return setSendError('Name the room this presenter is assigned to.');
    }

    setSending(true);
    setSendError(null);
    setSendResult(null);
    try {
      const result = await onSendInvites(
        sessionId.trim(),
        emails,
        title.trim() || 'Check-in request',
        message.trim() || `You've been invited to check in to ${sessionId.trim()}.`,
        eventAt ? eventAt.toISOString() : null,
        inviteRole,
        inviteRole === 'presenter' ? roomCode.trim() : null
      );
      setSendResult(result);
      setSelectedEmails(new Set());
      setTypedEmails('');
      // Date/time deliberately kept: inviting a second batch to the same event is the common
      // follow-up, and retyping the schedule each time invites a mismatch between batches.
    } catch (err: any) {
      setSendError(err?.message || 'Could not send invites.');
    } finally {
      setSending(false);
    }
  };

  const toggleUser = (email: string) => {
    setSelectedEmails(prev => {
      const next = new Set(prev);
      if (next.has(email)) next.delete(email);
      else next.add(email);
      return next;
    });
  };

  const recipientCount = recipientList().length;

  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>
      <TopBar
        title="Check-In Invites"
        subtitle="Ask attendees to confirm ahead of time"
        onBack={() => onNavigate('adminOverview')}
      />

      <View style={styles.tabRow}>
        {(['invite', 'responses'] as const).map(t => (
          <TouchableOpacity
            key={t}
            activeOpacity={0.85}
            onPress={() => setTab(t)}
            style={[
              styles.tabChip,
              {
                backgroundColor: tab === t ? 'rgba(51,209,172,0.18)' : colors.card,
                borderColor: tab === t ? palette.mintPresence : colors.border,
              },
            ]}
          >
            <Text style={[styles.tabChipText, { color: tab === t ? palette.mintPresence : colors.muted }]}>
              {t === 'invite' ? 'Send Invites' : 'Responses'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {tab === 'invite' ? (
          <>
            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.label, { color: colors.sub }]}>INVITING</Text>
              <View style={styles.roleRow}>
                {(['attendee', 'presenter'] as const).map(r => {
                  const active = inviteRole === r;
                  return (
                    <TouchableOpacity
                      key={r}
                      activeOpacity={0.85}
                      onPress={() => setInviteRole(r)}
                      style={[
                        styles.roleChip,
                        {
                          backgroundColor: active ? 'rgba(51,209,172,0.18)' : colors.bg,
                          borderColor: active ? palette.mintPresence : colors.border,
                        },
                      ]}
                    >
                      <Text
                        style={[styles.roleChipText, { color: active ? palette.mintPresence : colors.muted }]}
                      >
                        {r === 'attendee' ? 'Attendees' : 'A presenter'}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              <Text style={[styles.hint, { color: colors.muted }]}>
                {inviteRole === 'presenter'
                  ? 'A presenter invite assigns a room. Accepting lets them start broadcasting it without retyping anything.'
                  : 'An attendee invite asks them to confirm they will be there.'}
              </Text>

              <Text style={[styles.label, { color: colors.sub, marginTop: 18 }]}>SESSION CODE</Text>
              <TextInput
                style={[styles.input, { backgroundColor: colors.bg, borderColor: colors.border, color: colors.txt }]}
                value={sessionId}
                onChangeText={setSessionId}
                placeholder="e.g. poc-session"
                placeholderTextColor={colors.muted}
                autoCapitalize="none"
              />
              <Text style={[styles.hint, { color: colors.muted }]}>
                {inviteRole === 'presenter'
                  ? 'The session this room belongs to.'
                  : 'Invites are addressed to a session code, not a room. The room itself does not have to exist yet.'}
              </Text>

              {inviteRole === 'presenter' ? (
                <>
                  <Text style={[styles.label, { color: colors.sub, marginTop: 18 }]}>ASSIGN ROOM</Text>
                  <TextInput
                    style={[
                      styles.input,
                      { backgroundColor: colors.bg, borderColor: colors.border, color: colors.txt },
                    ]}
                    value={roomCode}
                    onChangeText={setRoomCode}
                    placeholder="e.g. Hall A"
                    placeholderTextColor={colors.muted}
                    autoCapitalize="words"
                  />
                  <Text style={[styles.hint, { color: colors.muted }]}>
                    Typed, not picked from live rooms: the room does not exist until they start
                    broadcasting it.
                  </Text>
                </>
              ) : null}

              <Text style={[styles.label, { color: colors.sub, marginTop: 18 }]}>
                WHEN IS IT? (OPTIONAL)
              </Text>
              <View style={styles.dateTimeRow}>
                <TouchableOpacity
                  activeOpacity={0.8}
                  onPress={() => openPicker('date')}
                  style={[
                    styles.pickerTrigger,
                    styles.dateInput,
                    { backgroundColor: colors.bg, borderColor: colors.border },
                  ]}
                >
                  <Text
                    style={[styles.pickerTriggerText, { color: eventAt ? colors.txt : colors.muted }]}
                    numberOfLines={1}
                  >
                    {eventAt ? eventAt.toLocaleDateString() : 'Pick a date'}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  activeOpacity={0.8}
                  onPress={() => openPicker('time')}
                  style={[
                    styles.pickerTrigger,
                    styles.timeInput,
                    { backgroundColor: colors.bg, borderColor: colors.border },
                  ]}
                >
                  <Text
                    style={[styles.pickerTriggerText, { color: eventAt ? colors.txt : colors.muted }]}
                    numberOfLines={1}
                  >
                    {eventAt
                      ? // hour12 pinned rather than left to the device locale, so the field always
                        // matches the 12-hour picker it opens.
                        eventAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true })
                      : 'Time'}
                  </Text>
                </TouchableOpacity>
              </View>

              {eventAt ? (
                <View style={styles.eventSummaryRow}>
                  <Text style={[styles.hint, { color: palette.mintPresence, marginTop: 0, flex: 1 }]}>
                    {eventAt.toLocaleString()}
                  </Text>
                  <TouchableOpacity activeOpacity={0.7} onPress={() => setEventAt(null)}>
                    <Text style={[styles.clearText, { color: colors.muted }]}>Clear</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <Text style={[styles.hint, { color: colors.muted }]}>
                  Leave this alone if there is no set time yet.
                </Text>
              )}

              {picking ? (
                <DateTimePicker
                  value={eventAt ?? defaultEventAt()}
                  mode={picking}
                  is24Hour={false}
                  display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                  onChange={handlePickerChange}
                />
              ) : null}
            </View>

            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.label, { color: colors.sub }]}>RECIPIENTS</Text>
              <TouchableOpacity
                activeOpacity={0.8}
                onPress={() => setPickerOpen(true)}
                style={[styles.pickerTrigger, { backgroundColor: colors.bg, borderColor: colors.border }]}
              >
                <Text
                  style={[
                    styles.pickerTriggerText,
                    { color: selectedEmails.size > 0 ? colors.txt : colors.muted },
                  ]}
                  numberOfLines={1}
                >
                  {usersLoading
                    ? 'Loading accounts…'
                    : selectedEmails.size > 0
                    ? `${selectedEmails.size} selected`
                    : 'Tap to pick from known accounts'}
                </Text>
                <Svg width={14} height={14} viewBox="0 0 24 24" fill="none">
                  <Path d="M6 9l6 6 6-6" stroke={colors.muted} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
                </Svg>
              </TouchableOpacity>

              <Text style={[styles.label, { color: colors.sub, marginTop: 16 }]}>
                OR TYPE ADDRESSES (comma or newline separated)
              </Text>
              <TextInput
                style={[
                  styles.input,
                  styles.multiline,
                  { backgroundColor: colors.bg, borderColor: colors.border, color: colors.txt },
                ]}
                value={typedEmails}
                onChangeText={setTypedEmails}
                placeholder="alice@example.com, bob@example.com"
                placeholderTextColor={colors.muted}
                autoCapitalize="none"
                keyboardType="email-address"
                multiline
              />
            </View>

            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.label, { color: colors.sub }]}>TITLE</Text>
              <TextInput
                style={[styles.input, { backgroundColor: colors.bg, borderColor: colors.border, color: colors.txt }]}
                value={title}
                onChangeText={setTitle}
                placeholder="Check-in request"
                placeholderTextColor={colors.muted}
              />

              <Text style={[styles.label, { color: colors.sub, marginTop: 16 }]}>MESSAGE</Text>
              <TextInput
                style={[
                  styles.input,
                  styles.multiline,
                  { backgroundColor: colors.bg, borderColor: colors.border, color: colors.txt },
                ]}
                value={message}
                onChangeText={setMessage}
                placeholder={`You've been invited to check in to ${sessionId.trim() || 'this session'}.`}
                placeholderTextColor={colors.muted}
                multiline
              />

              <TouchableOpacity
                activeOpacity={0.85}
                onPress={() => void handleSend()}
                disabled={sending}
                style={[styles.primaryButton, sending && { opacity: 0.6 }]}
              >
                <Text style={styles.primaryButtonText}>
                  {sending
                    ? 'Sending…'
                    : `Send ${recipientCount || ''} Invite${recipientCount === 1 ? '' : 's'}`.replace('  ', ' ')}
                </Text>
              </TouchableOpacity>

              {sendError ? (
                <Text style={[styles.errorText, { color: palette.roseError }]}>{sendError}</Text>
              ) : null}

              {sendResult ? (
                <View style={[styles.resultBox, { backgroundColor: 'rgba(51,209,172,0.12)' }]}>
                  <Text style={[styles.resultText, { color: palette.mintPresence }]}>
                    {sendResult.invited} invite{sendResult.invited === 1 ? '' : 's'} recorded.
                  </Text>
                  {sendResult.notReachableByPush.length > 0 ? (
                    <Text style={[styles.resultMissing, { color: palette.amberWarn }]}>
                      No registered device, so no push reached: {sendResult.notReachableByPush.join(', ')}. They
                      will still see the invite next time they open the app.
                    </Text>
                  ) : null}
                  {sendResult.pushError ? (
                    <Text style={[styles.resultMissing, { color: palette.amberWarn }]}>
                      Push not sent: {sendResult.pushError}. The invites are saved regardless.
                    </Text>
                  ) : null}
                </View>
              ) : null}
            </View>
          </>
        ) : (
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
          </>
        )}
      </ScrollView>

      <Modal visible={editOpen} animationType="slide" transparent onRequestClose={() => setEditOpen(false)}>
        <TouchableOpacity activeOpacity={1} style={styles.modalBackdrop} onPress={() => setEditOpen(false)}>
          <TouchableOpacity activeOpacity={1} style={[styles.modalSheet, { backgroundColor: colors.bg }]}>
            <View style={styles.modalHeaderRow}>
              <Text style={[styles.modalTitle, { color: colors.txt }]}>Edit Invite Details</Text>
              <TouchableOpacity activeOpacity={0.7} onPress={() => setEditOpen(false)} style={styles.modalCloseButton}>
                <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
                  <Path d="M6 6l12 12M18 6L6 18" stroke={colors.sub} strokeWidth={2} strokeLinecap="round" />
                </Svg>
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.modalScroll} showsVerticalScrollIndicator={false}>
              <Text style={[styles.hint, { color: colors.muted, marginTop: 0 }]}>
                Applies to all {visibleInvites.length} invite{visibleInvites.length === 1 ? '' : 's'} in
                this session.
              </Text>

              <Text style={[styles.label, { color: colors.sub, marginTop: 16 }]}>SESSION CODE</Text>
              <TextInput
                style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.txt }]}
                value={editSessionId}
                onChangeText={setEditSessionId}
                autoCapitalize="none"
              />

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
                style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.txt }]}
                value={editTitle}
                onChangeText={setEditTitle}
                placeholder="Check-in request"
                placeholderTextColor={colors.muted}
              />

              <Text style={[styles.label, { color: colors.sub, marginTop: 16 }]}>MESSAGE</Text>
              <TextInput
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
                return (
                  <TouchableOpacity
                    key={option ?? '__all__'}
                    activeOpacity={0.8}
                    onPress={() => {
                      setResponseSession(option);
                      setSessionPickerOpen(false);
                    }}
                    style={[styles.sessionOptionRow, { borderBottomColor: colors.border }]}
                  >
                    <View style={{ flex: 1 }}>
                      <Text
                        style={[
                          styles.sessionOptionText,
                          { color: selected ? palette.mintPresence : colors.txt },
                        ]}
                        numberOfLines={1}
                      >
                        {option === null ? 'All sessions' : option}
                      </Text>
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

      <Modal visible={pickerOpen} animationType="slide" transparent onRequestClose={() => setPickerOpen(false)}>
        <TouchableOpacity activeOpacity={1} style={styles.modalBackdrop} onPress={() => setPickerOpen(false)}>
          <TouchableOpacity activeOpacity={1} style={[styles.modalSheet, { backgroundColor: colors.bg }]}>
            <View style={styles.modalHeaderRow}>
              <Text style={[styles.modalTitle, { color: colors.txt }]}>Select Recipients</Text>
              <TouchableOpacity activeOpacity={0.7} onPress={() => setPickerOpen(false)} style={styles.modalCloseButton}>
                <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
                  <Path d="M6 6l12 12M18 6L6 18" stroke={colors.sub} strokeWidth={2} strokeLinecap="round" />
                </Svg>
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.modalScroll} showsVerticalScrollIndicator={false}>
              {users.length === 0 ? (
                <Text style={[styles.hint, { color: colors.muted }]}>
                  No accounts found. Type addresses manually instead.
                </Text>
              ) : (
                users.map(user => {
                  const checked = selectedEmails.has(user.email);
                  return (
                    <TouchableOpacity
                      key={user.id}
                      activeOpacity={0.8}
                      onPress={() => toggleUser(user.email)}
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
                })
              )}
            </ScrollView>

            <TouchableOpacity activeOpacity={0.85} onPress={() => setPickerOpen(false)} style={styles.primaryButton}>
              <Text style={styles.primaryButtonText}>Done</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  tabRow: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  tabChip: {
    flex: 1,
    paddingVertical: 9,
    borderRadius: 999,
    borderWidth: 1.5,
    alignItems: 'center',
  },
  tabChipText: { fontSize: 12, fontWeight: '800' },
  content: { paddingHorizontal: 20, paddingBottom: 28, gap: 12 },
  card: { borderRadius: 16, borderWidth: 1.5, padding: 16 },
  label: { fontSize: 10, fontWeight: '800', letterSpacing: 0.8, marginBottom: 6 },
  input: {
    borderWidth: 1.5,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
  },
  multiline: { minHeight: 72, textAlignVertical: 'top' },
  roleRow: { flexDirection: 'row', gap: 8 },
  roleChip: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1.5,
    alignItems: 'center',
  },
  roleChipText: { fontSize: 13, fontWeight: '800' },
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
    borderWidth: 1.5,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  pickerTriggerText: { fontSize: 14, flex: 1 },
  primaryButton: {
    backgroundColor: palette.mintPresence,
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
    marginTop: 18,
  },
  primaryButtonText: { color: '#0F2F2C', fontSize: 14, fontWeight: '800' },
  errorText: { fontSize: 12, marginTop: 10 },
  resultBox: { marginTop: 12, padding: 12, borderRadius: 12 },
  resultText: { fontSize: 13, fontWeight: '700' },
  resultMissing: { fontSize: 11, marginTop: 6, lineHeight: 16 },
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
  },
  inviteLeft: { flex: 1 },
  inviteName: { fontSize: 14, fontWeight: '700' },
  inviteEmail: { fontSize: 11, marginTop: 1 },
  inviteMeta: { fontSize: 10, marginTop: 4 },
  hostTag: { fontSize: 9, fontWeight: '800', letterSpacing: 0.5, marginTop: 3 },
  statusPill: { paddingHorizontal: 9, paddingVertical: 4, borderRadius: 999 },
  statusPillText: { fontSize: 9, fontWeight: '800', letterSpacing: 0.5 },
  footnote: { fontSize: 11, lineHeight: 17, marginTop: 4, paddingHorizontal: 2 },
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
  sessionOptionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  sessionOptionText: { fontSize: 14, fontWeight: '700' },
  sessionOptionCount: { fontSize: 11, marginTop: 2 },
});
