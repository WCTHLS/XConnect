import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import type { MyInvite } from '@confpresence/shared';
import { useTheme } from '../../theme/useTheme';
import { palette } from '../../theme/colors';

interface InviteCardProps {
  invite: MyInvite;
  onRespond: (inviteId: number, response: 'accepted' | 'declined') => Promise<boolean>;
}

/**
 * An outstanding check-in invitation, answered in place. Accepting is an RSVP and nothing more:
 * it does not check anyone in, which is why the card says so rather than implying attendance is
 * now recorded. Actual presence still comes from detection once they are in the room.
 */
export const InviteCard: React.FC<InviteCardProps> = ({ invite, onRespond }) => {
  const { colors } = useTheme();
  const [busy, setBusy] = useState<'accepted' | 'declined' | null>(null);

  const respond = async (response: 'accepted' | 'declined') => {
    if (busy) return;
    setBusy(response);
    try {
      await onRespond(invite.id, response);
    } finally {
      // The parent drops this invite from its list on success, unmounting the card; on failure we
      // land back here so the buttons have to become usable again.
      setBusy(null);
    }
  };

  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: palette.mintPresence }]}>
      <View style={styles.headerRow}>
        <View style={[styles.iconBox, { backgroundColor: 'rgba(51,209,172,0.15)' }]}>
          <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
            <Path
              d="M4 6h16v12H4zM4 7l8 6 8-6"
              stroke={palette.mintPresence}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </Svg>
        </View>
        <View style={styles.headerText}>
          <Text style={[styles.title, { color: colors.txt }]} numberOfLines={2}>
            {invite.title || 'Check-in request'}
          </Text>
          <Text style={[styles.session, { color: palette.mintPresence }]} numberOfLines={1}>
            {invite.sessionId}
          </Text>
        </View>
      </View>

      {invite.eventAt ? (
        <View style={[styles.whenRow, { borderColor: colors.border }]}>
          <Svg width={13} height={13} viewBox="0 0 24 24" fill="none">
            <Path
              d="M12 7v5l3 2"
              stroke={palette.mintPresence}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <Path
              d="M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z"
              stroke={palette.mintPresence}
              strokeWidth={2}
            />
          </Svg>
          <Text style={[styles.whenText, { color: colors.txt }]}>
            {new Date(invite.eventAt).toLocaleString()}
          </Text>
        </View>
      ) : null}

      {invite.message ? (
        <Text style={[styles.message, { color: colors.muted }]}>{invite.message}</Text>
      ) : null}

      <View style={styles.actions}>
        <TouchableOpacity
          activeOpacity={0.85}
          disabled={busy !== null}
          onPress={() => void respond('declined')}
          style={[styles.button, styles.declineButton, { borderColor: colors.border }]}
        >
          {busy === 'declined' ? (
            <ActivityIndicator size="small" color={colors.sub} />
          ) : (
            <Text style={[styles.buttonText, { color: colors.sub }]}>Can't make it</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          activeOpacity={0.85}
          disabled={busy !== null}
          onPress={() => void respond('accepted')}
          style={[styles.button, styles.acceptButton, busy !== null && { opacity: 0.7 }]}
        >
          {busy === 'accepted' ? (
            <ActivityIndicator size="small" color="#0F2F2C" />
          ) : (
            <Text style={[styles.buttonText, { color: '#0F2F2C' }]}>I'll be there</Text>
          )}
        </TouchableOpacity>
      </View>

      <Text style={[styles.footnote, { color: colors.muted }]}>
        Replying just lets the organiser plan. You still check in for real when you are in the room.
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    borderWidth: 1.5,
    padding: 16,
    marginHorizontal: 20,
    marginBottom: 12,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  iconBox: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerText: {
    flex: 1,
  },
  title: {
    fontSize: 14,
    fontWeight: '800',
  },
  session: {
    fontSize: 11,
    fontWeight: '700',
    marginTop: 1,
  },
  whenRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 1,
  },
  whenText: {
    fontSize: 13,
    fontWeight: '700',
  },
  message: {
    fontSize: 12,
    lineHeight: 18,
    marginTop: 10,
  },
  actions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 14,
  },
  button: {
    flex: 1,
    paddingVertical: 11,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  declineButton: {
    borderWidth: 1.5,
  },
  acceptButton: {
    backgroundColor: palette.mintPresence,
  },
  buttonText: {
    fontSize: 13,
    fontWeight: '800',
  },
  footnote: {
    fontSize: 10,
    lineHeight: 15,
    marginTop: 10,
  },
});
