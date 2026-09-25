import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Modal,
} from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useTheme } from '../../theme/useTheme';
import { palette } from '../../theme/colors';
import { MobileScreen } from '../../components/navigation/BottomNav';

export interface NotifyResult {
  matchedEmails: string[];
  unmatchedEmails: string[];
}

export interface NotifiableUser {
  id: string;
  email: string;
  name: string;
}

interface AdminNotifyScreenProps {
  onSendNotification: (emails: string[], title: string, message: string) => Promise<NotifyResult>;
  onFetchUsers: () => Promise<NotifiableUser[]>;
  onNavigate: (screen: MobileScreen) => void;
}

export const AdminNotifyScreen: React.FC<AdminNotifyScreenProps> = ({
  onSendNotification,
  onFetchUsers,
  onNavigate,
}) => {
  const { colors } = useTheme();
  const [emails, setEmails] = useState('');
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<NotifyResult | null>(null);

  const [users, setUsers] = useState<NotifiableUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(true);
  const [usersError, setUsersError] = useState<string | null>(null);
  const [selectedEmails, setSelectedEmails] = useState<Set<string>>(new Set());
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    onFetchUsers()
      .then(list => {
        if (!cancelled) setUsers(list);
      })
      .catch((err: any) => {
        if (!cancelled) setUsersError(err?.message || 'Could not load the user list.');
      })
      .finally(() => {
        if (!cancelled) setUsersLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [onFetchUsers]);

  const toggleUser = (email: string) => {
    setSelectedEmails(prev => {
      const next = new Set(prev);
      if (next.has(email)) next.delete(email);
      else next.add(email);
      return next;
    });
  };

  const handleSend = async () => {
    const typedEmails = emails
      .split(/[,\n]/)
      .map(e => e.trim())
      .filter(Boolean);
    // Case-insensitive dedupe between the picker and manual entry — the same address typed as
    // "Alice@x.com" and picked as "alice@x.com" should count once, not send twice.
    const seen = new Set<string>();
    const emailList: string[] = [];
    for (const e of [...selectedEmails, ...typedEmails]) {
      const key = e.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        emailList.push(e);
      }
    }
    if (emailList.length === 0) return setError('Select or enter at least one email address.');
    if (!title.trim() || !message.trim()) return setError('Enter a title and a message.');

    setSending(true);
    setError(null);
    setResult(null);
    try {
      const data = await onSendNotification(emailList, title.trim(), message.trim());
      setResult(data);
    } catch (err: any) {
      setError(err?.message || 'Network error');
    } finally {
      setSending(false);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>
      <View style={styles.header}>
        <TouchableOpacity
          activeOpacity={0.7}
          onPress={() => onNavigate('adminOverview')}
          style={[styles.backButton, { backgroundColor: colors.card }]}
        >
          <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
            <Path
              d="M15 18l-6-6 6-6"
              stroke={colors.sub}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </Svg>
        </TouchableOpacity>
        <View style={styles.headerTitleBlock}>
          <Text style={[styles.headerTitle, { color: colors.txt }]}>Send Notification</Text>
          <Text style={[styles.headerSubtitle, { color: colors.muted }]}>
            Push a message to specific attendees
          </Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.label, { color: colors.sub }]}>SELECT RECIPIENTS</Text>
          <TouchableOpacity
            activeOpacity={0.8}
            onPress={() => setPickerOpen(true)}
            style={[styles.pickerTrigger, { backgroundColor: colors.bg, borderColor: colors.border }]}
          >
            {usersLoading ? (
              <Text style={[styles.pickerTriggerText, { color: colors.muted }]}>Loading users…</Text>
            ) : selectedEmails.size > 0 ? (
              <Text style={[styles.pickerTriggerText, { color: colors.txt }]} numberOfLines={1}>
                {selectedEmails.size} selected
              </Text>
            ) : (
              <Text style={[styles.pickerTriggerText, { color: colors.muted }]}>Tap to select recipients</Text>
            )}
            <Svg width={14} height={14} viewBox="0 0 24 24" fill="none">
              <Path d="M6 9l6 6 6-6" stroke={colors.muted} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
            </Svg>
          </TouchableOpacity>
        </View>

        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, marginTop: 12 }]}>
          <Text style={[styles.label, { color: colors.sub }]}>ADD EMAILS MANUALLY (comma or newline separated)</Text>
          <TextInput
            style={[styles.input, styles.multiline, { backgroundColor: colors.bg, borderColor: colors.border, color: colors.txt }]}
            value={emails}
            onChangeText={setEmails}
            placeholder="alice@example.com, bob@example.com"
            placeholderTextColor={colors.muted}
            autoCapitalize="none"
            keyboardType="email-address"
            multiline
          />

          <Text style={[styles.label, { color: colors.sub, marginTop: 16 }]}>TITLE</Text>
          <TextInput
            style={[styles.input, { backgroundColor: colors.bg, borderColor: colors.border, color: colors.txt }]}
            value={title}
            onChangeText={setTitle}
            placeholder="Session starting soon"
            placeholderTextColor={colors.muted}
          />

          <Text style={[styles.label, { color: colors.sub, marginTop: 16 }]}>MESSAGE</Text>
          <TextInput
            style={[styles.input, styles.multiline, { backgroundColor: colors.bg, borderColor: colors.border, color: colors.txt }]}
            value={message}
            onChangeText={setMessage}
            placeholder="Your session begins in 5 minutes."
            placeholderTextColor={colors.muted}
            multiline
          />

          <TouchableOpacity
            activeOpacity={0.85}
            onPress={() => void handleSend()}
            disabled={sending}
            style={[styles.sendButton, sending && { opacity: 0.6 }]}
          >
            <Text style={styles.sendButtonText}>{sending ? 'Sending…' : 'Send Notification'}</Text>
          </TouchableOpacity>

          {error ? <Text style={[styles.errorText, { color: palette.roseError }]}>{error}</Text> : null}

          {result ? (
            <View style={[styles.resultBox, { backgroundColor: 'rgba(51,209,172,0.12)' }]}>
              <Text style={[styles.resultText, { color: palette.mintPresence }]}>
                Sent to {result.matchedEmails.length} of {result.matchedEmails.length + result.unmatchedEmails.length} email(s)
              </Text>
              {result.unmatchedEmails.length > 0 ? (
                <Text style={[styles.resultMissing, { color: palette.amberWarn }]}>
                  No device registered: {result.unmatchedEmails.join(', ')}
                </Text>
              ) : null}
            </View>
          ) : null}
        </View>
      </ScrollView>

      <Modal
        visible={pickerOpen}
        animationType="slide"
        transparent
        onRequestClose={() => setPickerOpen(false)}
      >
        <TouchableOpacity
          activeOpacity={1}
          style={styles.modalBackdrop}
          onPress={() => setPickerOpen(false)}
        >
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
              {usersLoading ? (
                <ActivityIndicator color={palette.mintPresence} style={{ marginVertical: 20 }} />
              ) : usersError ? (
                <Text style={[styles.errorText, { color: palette.roseError, marginTop: 8 }]}>{usersError}</Text>
              ) : users.length === 0 ? (
                <Text style={[styles.emptyUsersText, { color: colors.muted }]}>
                  No accounts have signed in yet.
                </Text>
              ) : (
                users.map(u => {
                  const selected = selectedEmails.has(u.email);
                  return (
                    <TouchableOpacity
                      key={u.id}
                      activeOpacity={0.7}
                      onPress={() => toggleUser(u.email)}
                      style={[styles.userRow, { borderBottomColor: colors.border }]}
                    >
                      <View
                        style={[
                          styles.checkbox,
                          selected
                            ? { backgroundColor: palette.mintPresence, borderColor: palette.mintPresence }
                            : { borderColor: colors.border },
                        ]}
                      >
                        {selected ? <Text style={styles.checkmark}>✓</Text> : null}
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.userName, { color: colors.txt }]} numberOfLines={1}>
                          {u.name}
                        </Text>
                        <Text style={[styles.userEmail, { color: colors.muted }]} numberOfLines={1}>
                          {u.email}
                        </Text>
                      </View>
                    </TouchableOpacity>
                  );
                })
              )}
            </ScrollView>

            <TouchableOpacity
              activeOpacity={0.85}
              onPress={() => setPickerOpen(false)}
              style={styles.modalDoneButton}
            >
              <Text style={styles.modalDoneButtonText}>
                Done{selectedEmails.size > 0 ? ` (${selectedEmails.size})` : ''}
              </Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 12,
    gap: 12,
  },
  backButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitleBlock: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '800',
  },
  headerSubtitle: {
    fontSize: 12,
    marginTop: 2,
  },
  content: {
    paddingHorizontal: 16,
    paddingBottom: 28,
  },
  card: {
    padding: 16,
    borderRadius: 16,
    borderWidth: 1.5,
  },
  label: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
    marginBottom: 8,
  },
  input: {
    borderWidth: 1.5,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
  },
  multiline: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  sendButton: {
    backgroundColor: palette.mintPresence,
    paddingVertical: 15,
    borderRadius: 14,
    alignItems: 'center',
    marginTop: 20,
  },
  sendButtonText: {
    color: '#060B12',
    fontSize: 15,
    fontWeight: '800',
  },
  errorText: {
    fontSize: 13,
    textAlign: 'center',
    marginTop: 14,
  },
  resultBox: {
    marginTop: 16,
    padding: 12,
    borderRadius: 12,
  },
  resultText: {
    fontSize: 13,
    fontWeight: '700',
  },
  resultMissing: {
    fontSize: 12,
    marginTop: 6,
  },
  pickerTrigger: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1.5,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  pickerTriggerText: {
    fontSize: 14,
    fontWeight: '600',
    flex: 1,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    maxHeight: '75%',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 24,
  },
  modalHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '800',
  },
  modalCloseButton: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalScroll: {
    marginBottom: 12,
  },
  modalDoneButton: {
    backgroundColor: palette.mintPresence,
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
  },
  modalDoneButtonText: {
    color: '#060B12',
    fontSize: 15,
    fontWeight: '800',
  },
  emptyUsersText: {
    fontSize: 13,
    paddingVertical: 8,
  },
  userRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkmark: {
    color: '#060B12',
    fontSize: 14,
    fontWeight: '900',
  },
  userName: {
    fontSize: 14,
    fontWeight: '700',
  },
  userEmail: {
    fontSize: 11,
    marginTop: 1,
  },
});
