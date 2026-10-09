import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  TouchableWithoutFeedback,
  StyleSheet,
  Modal,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import Svg, { Path } from 'react-native-svg';
import type { MyInvite } from '@confpresence/shared';
import { useTheme } from '../../theme/useTheme';
import { palette } from '../../theme/colors';

interface InviteDetailSheetProps {
  /** The invite being inspected, or null when the sheet is closed. */
  invite: MyInvite | null;
  onClose: () => void;
  /** Resolves false when the reply could not be saved; the sheet then stays open. */
  onRespond: (inviteId: number, response: 'accepted' | 'declined') => Promise<boolean>;
}

/**
 * Bottom sheet for one already-answered invite: what it was, what they said, and a single action
 * to flip that answer. Deliberately offers only the opposite of the current reply — there are
 * exactly two states, so a picker would be two buttons where one of them is a no-op.
 */
export const InviteDetailSheet: React.FC<InviteDetailSheetProps> = ({ invite, onClose, onRespond }) => {
  const { colors } = useTheme();
  const [busy, setBusy] = useState(false);

  if (!invite) return null;

  const accepted = invite.status === 'accepted';
  const tone = accepted ? palette.mintPresence : palette.roseError;
  const nextResponse: 'accepted' | 'declined' = accepted ? 'declined' : 'accepted';

  const handleChange = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (await onRespond(invite.id, nextResponse)) onClose();
    } finally {
      // On failure the sheet stays open (the parent surfaces the error), so the button has to
      // become usable again rather than staying stuck in its spinner.
      setBusy(false);
    }
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={styles.backdrop}>
          <TouchableWithoutFeedback onPress={() => {}}>
            <View style={[styles.sheet, { backgroundColor: colors.bg, borderColor: colors.border }]}>
              <View style={[styles.grabber, { backgroundColor: colors.border }]} />

              <ScrollView showsVerticalScrollIndicator={false}>
                <Text style={[styles.label, { color: colors.sub }]}>SESSION</Text>
                <Text style={[styles.session, { color: colors.txt }]}>{invite.sessionId}</Text>

                {invite.eventAt ? (
                  <>
                    <Text style={[styles.label, { color: colors.sub, marginTop: 18 }]}>WHEN</Text>
                    <Text style={[styles.when, { color: colors.txt }]}>
                      {new Date(invite.eventAt).toLocaleString()}
                    </Text>
                  </>
                ) : null}

                {invite.title ? (
                  <>
                    <Text style={[styles.label, { color: colors.sub, marginTop: 18 }]}>INVITE</Text>
                    <Text style={[styles.title, { color: colors.txt }]}>{invite.title}</Text>
                  </>
                ) : null}

                {invite.message ? (
                  <Text style={[styles.message, { color: colors.muted }]}>{invite.message}</Text>
                ) : null}

                <Text style={[styles.label, { color: colors.sub, marginTop: 18 }]}>YOUR REPLY</Text>
                <View style={styles.replyRow}>
                  <View
                    style={[
                      styles.replyIcon,
                      { backgroundColor: accepted ? 'rgba(51,209,172,0.15)' : 'rgba(239,68,68,0.15)' },
                    ]}
                  >
                    <Svg width={14} height={14} viewBox="0 0 24 24" fill="none">
                      <Path
                        d={accepted ? 'M5 13l4 4L19 7' : 'M6 6l12 12M18 6L6 18'}
                        stroke={tone}
                        strokeWidth={2.5}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </Svg>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.replyText, { color: tone }]}>
                      {accepted ? "You said you'll be there" : "You said you can't make it"}
                    </Text>
                    {invite.respondedAt ? (
                      <Text style={[styles.replyMeta, { color: colors.muted }]}>
                        Replied {new Date(invite.respondedAt).toLocaleString()}
                      </Text>
                    ) : null}
                  </View>
                </View>

                <TouchableOpacity
                  activeOpacity={0.85}
                  disabled={busy}
                  onPress={() => void handleChange()}
                  style={[
                    styles.changeButton,
                    accepted
                      ? { backgroundColor: 'transparent', borderColor: palette.roseError }
                      : { backgroundColor: palette.mintPresence, borderColor: palette.mintPresence },
                    busy && { opacity: 0.6 },
                  ]}
                >
                  {busy ? (
                    <ActivityIndicator size="small" color={accepted ? palette.roseError : '#0F2F2C'} />
                  ) : (
                    <Text
                      style={[
                        styles.changeButtonText,
                        { color: accepted ? palette.roseError : '#0F2F2C' },
                      ]}
                    >
                      {accepted ? "Change to: can't make it" : "Change to: I'll be there"}
                    </Text>
                  )}
                </TouchableOpacity>

                <TouchableOpacity activeOpacity={0.7} onPress={onClose} style={styles.closeButton}>
                  <Text style={[styles.closeButtonText, { color: colors.sub }]}>Keep my reply</Text>
                </TouchableOpacity>

                <Text style={[styles.footnote, { color: colors.muted }]}>
                  Either way this only tells the organiser what to expect. Being counted as present
                  still happens when you are actually in the room.
                </Text>
              </ScrollView>
            </View>
          </TouchableWithoutFeedback>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(6,11,18,0.6)',
    justifyContent: 'flex-end',
  },
  sheet: {
    maxHeight: '80%',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderWidth: 1.5,
    borderBottomWidth: 0,
    paddingHorizontal: 22,
    paddingTop: 10,
    paddingBottom: 28,
  },
  grabber: {
    width: 38,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 18,
  },
  label: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.8,
    marginBottom: 4,
  },
  session: {
    fontSize: 20,
    fontWeight: '900',
    letterSpacing: -0.4,
  },
  when: {
    fontSize: 15,
    fontWeight: '700',
  },
  title: {
    fontSize: 15,
    fontWeight: '700',
  },
  message: {
    fontSize: 13,
    lineHeight: 19,
    marginTop: 6,
  },
  replyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 4,
  },
  replyIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  replyText: {
    fontSize: 14,
    fontWeight: '800',
  },
  replyMeta: {
    fontSize: 11,
    marginTop: 1,
  },
  changeButton: {
    marginTop: 22,
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  changeButtonText: {
    fontSize: 14,
    fontWeight: '800',
  },
  closeButton: {
    marginTop: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  closeButtonText: {
    fontSize: 13,
    fontWeight: '700',
  },
  footnote: {
    fontSize: 11,
    lineHeight: 16,
    textAlign: 'center',
    marginTop: 12,
  },
});
