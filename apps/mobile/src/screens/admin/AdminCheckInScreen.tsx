import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Modal,
  Platform,
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

export const AdminCheckInScreen: React.FC<AdminCheckInScreenProps> = ({
  defaultSessionId,
  onFetchUsers,
  onSendInvites,
  onNavigate,
}) => {
  const { colors } = useTheme();
  const [sessionId, setSessionId] = useState(defaultSessionId);

  // Compose state. Both sides of a session are filled in here and sent together under one code:
  // whoever is hosting, and whoever is being asked to check in.
  const [users, setUsers] = useState<NotifiableUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(true);
  const [selectedPresenters, setSelectedPresenters] = useState<Set<string>>(new Set());
  const [typedPresenters, setTypedPresenters] = useState('');
  const [selectedAttendees, setSelectedAttendees] = useState<Set<string>>(new Set());
  const [typedAttendees, setTypedAttendees] = useState('');
  const [title, setTitle] = useState('Check-in request');
  const [message, setMessage] = useState('');
  // One Date holds the whole schedule; the two pickers each edit their half of it. null means
  // the admin hasn't set a time, which is a valid invite.
  const [roomCode, setRoomCode] = useState('');
  const [eventAt, setEventAt] = useState<Date | null>(null);
  const [picking, setPicking] = useState<'date' | 'time' | null>(null);
  // Which list the account picker is currently filling, or null while it's closed — one sheet
  // serves both rather than two near-identical copies of it.
  const [pickerRole, setPickerRole] = useState<InviteRole | null>(null);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sendResult, setSendResult] = useState<InviteSendResult | null>(null);

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

  /** Case-insensitive dedupe across the picker and manual entry, so one person named both ways is
   *  one invite rather than two rows the server then has to collapse. */
  const recipientList = (selected: Set<string>, typed: string) => {
    const manual = typed
      .split(/[,\n]/)
      .map(e => e.trim())
      .filter(Boolean);
    const seen = new Set<string>();
    const out: string[] = [];
    for (const e of [...selected, ...manual]) {
      const key = e.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        out.push(e);
      }
    }
    return out;
  };

  const presenterEmails = recipientList(selectedPresenters, typedPresenters);
  const attendeeEmails = recipientList(selectedAttendees, typedAttendees);
  const recipientCount = presenterEmails.length + attendeeEmails.length;

  const handleSend = async () => {
    if (!sessionId.trim()) return setSendError('Enter the session code these invites are for.');
    if (recipientCount === 0) return setSendError('Pick at least one presenter or attendee.');
    if (presenterEmails.length > 0 && !roomCode.trim()) {
      return setSendError('Name the room the presenter is assigned to.');
    }
    // The account picker already hides each side's people from the other list, but an address
    // typed by hand can still land in both — and since an invite is keyed on (session, email),
    // the second send would silently convert the first rather than adding to it.
    const attendeeKeys = new Set(attendeeEmails.map(e => e.toLowerCase()));
    const inBoth = presenterEmails.filter(e => attendeeKeys.has(e.toLowerCase()));
    if (inBoth.length > 0) {
      return setSendError(
        `${inBoth.join(', ')} can't be both a presenter and an attendee in the same session. Remove them from one list.`
      );
    }

    setSending(true);
    setSendError(null);
    setSendResult(null);
    try {
      const code = sessionId.trim();
      const when = eventAt ? eventAt.toISOString() : null;
      const sharedTitle = title.trim() || 'Check-in request';
      // Sent as one batch per role, since a presenter invite carries a room and an attendee one
      // must not. They share the session, schedule and title, so the two halves of a session stay
      // described the same way. A blank message is left blank on purpose: the server then writes
      // each side its own wording ("you're hosting X" vs "please check in").
      const results: InviteSendResult[] = [];
      if (presenterEmails.length > 0) {
        results.push(
          await onSendInvites(code, presenterEmails, sharedTitle, message.trim(), when, 'presenter', roomCode.trim())
        );
      }
      if (attendeeEmails.length > 0) {
        results.push(
          await onSendInvites(code, attendeeEmails, sharedTitle, message.trim(), when, 'attendee', null)
        );
      }
      setSendResult({
        invited: results.reduce((n, r) => n + r.invited, 0),
        pushed: results.flatMap(r => r.pushed),
        notReachableByPush: results.flatMap(r => r.notReachableByPush),
        pushError: results.find(r => r.pushError)?.pushError ?? null,
      });
      setSelectedPresenters(new Set());
      setTypedPresenters('');
      setSelectedAttendees(new Set());
      setTypedAttendees('');
      // Date/time deliberately kept: inviting a second batch to the same event is the common
      // follow-up, and retyping the schedule each time invites a mismatch between batches.
    } catch (err: any) {
      setSendError(err?.message || 'Could not send invites.');
    } finally {
      setSending(false);
    }
  };

  const toggleUser = (email: string) => {
    const setSelected = pickerRole === 'presenter' ? setSelectedPresenters : setSelectedAttendees;
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(email)) next.delete(email);
      else next.add(email);
      return next;
    });
  };

  // Nobody can hold both roles in one session, so each picker offers only the accounts the other
  // side hasn't already claimed — including ones typed by hand into the other list.
  const takenByOtherRole = new Set(
    (pickerRole === 'presenter' ? attendeeEmails : presenterEmails).map(e => e.toLowerCase())
  );
  const pickerUsers = users.filter(u => !takenByOtherRole.has(u.email.toLowerCase()));
  const pickerSelected = pickerRole === 'presenter' ? selectedPresenters : selectedAttendees;

  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>
      <TopBar
        title="Send Check-In Invites"
        subtitle="Set up a session's presenter and attendees together"
        onBack={() => onNavigate('adminNotify')}
      />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.label, { color: colors.sub }]}>SESSION CODE</Text>
              <TextInput
                style={[styles.input, { backgroundColor: colors.bg, borderColor: colors.border, color: colors.txt }]}
                value={sessionId}
                onChangeText={setSessionId}
                placeholder="e.g. poc-session"
                placeholderTextColor={colors.muted}
                autoCapitalize="none"
              />
              <Text style={[styles.hint, { color: colors.muted }]}>
                One code covers the whole session: the presenter hosting it and the attendees
                checking in. A code can only be used once, so both go out together from here.
              </Text>

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

            <View style={[styles.card, { backgroundColor: colors.card, borderColor: palette.skyMesh }]}>
              <Text style={[styles.label, { color: palette.skyMesh }]}>PRESENTER</Text>
              <TouchableOpacity
                activeOpacity={0.8}
                onPress={() => setPickerRole('presenter')}
                style={[styles.pickerTrigger, { backgroundColor: colors.bg, borderColor: colors.border }]}
              >
                <Text
                  style={[
                    styles.pickerTriggerText,
                    { color: selectedPresenters.size > 0 ? colors.txt : colors.muted },
                  ]}
                  numberOfLines={1}
                >
                  {usersLoading
                    ? 'Loading accounts…'
                    : selectedPresenters.size > 0
                    ? `${selectedPresenters.size} selected`
                    : 'Tap to pick who is hosting'}
                </Text>
                <Svg width={14} height={14} viewBox="0 0 24 24" fill="none">
                  <Path d="M6 9l6 6 6-6" stroke={colors.muted} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
                </Svg>
              </TouchableOpacity>

              <TextInput
                style={[
                  styles.input,
                  styles.multiline,
                  { backgroundColor: colors.bg, borderColor: colors.border, color: colors.txt, marginTop: 10 },
                ]}
                value={typedPresenters}
                onChangeText={setTypedPresenters}
                placeholder="Or type addresses: dana@example.com"
                placeholderTextColor={colors.muted}
                autoCapitalize="none"
                keyboardType="email-address"
                multiline
              />

              <Text style={[styles.label, { color: colors.sub, marginTop: 16 }]}>
                ASSIGN ROOM{presenterEmails.length > 0 ? '' : ' (WITH A PRESENTER)'}
              </Text>
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
                {presenterEmails.length > 0
                  ? 'Typed, not picked from live rooms: the room does not exist until they start broadcasting it. Accepting lets them start it without retyping anything.'
                  : 'Only sent if someone is picked above. A whole session can be attendees-only, in which case leave both empty.'}
              </Text>
            </View>

            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.label, { color: colors.sub }]}>ATTENDEES</Text>
              <TouchableOpacity
                activeOpacity={0.8}
                onPress={() => setPickerRole('attendee')}
                style={[styles.pickerTrigger, { backgroundColor: colors.bg, borderColor: colors.border }]}
              >
                <Text
                  style={[
                    styles.pickerTriggerText,
                    { color: selectedAttendees.size > 0 ? colors.txt : colors.muted },
                  ]}
                  numberOfLines={1}
                >
                  {usersLoading
                    ? 'Loading accounts…'
                    : selectedAttendees.size > 0
                    ? `${selectedAttendees.size} selected`
                    : 'Tap to pick who is checking in'}
                </Text>
                <Svg width={14} height={14} viewBox="0 0 24 24" fill="none">
                  <Path d="M6 9l6 6 6-6" stroke={colors.muted} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
                </Svg>
              </TouchableOpacity>

              <TextInput
                style={[
                  styles.input,
                  styles.multiline,
                  { backgroundColor: colors.bg, borderColor: colors.border, color: colors.txt, marginTop: 10 },
                ]}
                value={typedAttendees}
                onChangeText={setTypedAttendees}
                placeholder="Or type addresses: alice@example.com, bob@example.com"
                placeholderTextColor={colors.muted}
                autoCapitalize="none"
                keyboardType="email-address"
                multiline
              />
              <Text style={[styles.hint, { color: colors.muted }]}>
                Asked to confirm they will be there. Anyone already picked as the presenter is left
                out of this list.
              </Text>
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
                placeholder="Leave empty to word each side automatically"
                placeholderTextColor={colors.muted}
                multiline
              />
              <Text style={[styles.hint, { color: colors.muted }]}>
                Left empty, the presenter is told which room they are hosting and attendees are
                asked to check in. Anything typed here is sent to both.
              </Text>

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
      </ScrollView>

      <Modal
        visible={pickerRole !== null}
        animationType="slide"
        transparent
        onRequestClose={() => setPickerRole(null)}
      >
        <TouchableOpacity activeOpacity={1} style={styles.modalBackdrop} onPress={() => setPickerRole(null)}>
          <TouchableOpacity activeOpacity={1} style={[styles.modalSheet, { backgroundColor: colors.bg }]}>
            <View style={styles.modalHeaderRow}>
              <Text style={[styles.modalTitle, { color: colors.txt }]}>
                {pickerRole === 'presenter' ? 'Who is hosting?' : 'Who is checking in?'}
              </Text>
              <TouchableOpacity activeOpacity={0.7} onPress={() => setPickerRole(null)} style={styles.modalCloseButton}>
                <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
                  <Path d="M6 6l12 12M18 6L6 18" stroke={colors.sub} strokeWidth={2} strokeLinecap="round" />
                </Svg>
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.modalScroll} showsVerticalScrollIndicator={false}>
              {pickerUsers.length === 0 ? (
                <Text style={[styles.hint, { color: colors.muted }]}>
                  {users.length === 0
                    ? 'No accounts found. Type addresses manually instead.'
                    : `Every known account is already on the ${
                        pickerRole === 'presenter' ? 'attendee' : 'presenter'
                      } list. Remove someone from it, or type an address manually.`}
                </Text>
              ) : (
                pickerUsers.map(user => {
                  const checked = pickerSelected.has(user.email);
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

            <TouchableOpacity activeOpacity={0.85} onPress={() => setPickerRole(null)} style={styles.primaryButton}>
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
});
