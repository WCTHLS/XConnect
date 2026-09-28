import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import type { MyInvite } from '@confpresence/shared';
import { useTheme } from '../../theme/useTheme';
import { palette } from '../../theme/colors';

interface AssignmentCardProps {
  /** A presenter invite this person has already accepted. */
  invite: MyInvite;
  /** Starts broadcasting the assigned room under the assigned session. */
  onStart: (roomCode: string, sessionId: string) => void;
}

/**
 * A room the presenter has agreed to host, on their Home screen.
 *
 * The point of it is the button: it starts the assigned room under the assigned session without
 * anyone retyping either. Typing a room name by hand is how a presenter ends up broadcasting
 * "Hall A " or "hall a" as a separate room from the one attendees are being pointed at.
 */
export const AssignmentCard: React.FC<AssignmentCardProps> = ({ invite, onStart }) => {
  const { colors } = useTheme();
  const roomCode = invite.roomCode ?? '';

  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: palette.skyMesh }]}>
      <View style={styles.headerRow}>
        <View style={[styles.iconBox, { backgroundColor: palette.skySubtle }]}>
          <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
            <Path
              d="M12 3v10m0 0l-3-3m3 3l3-3M5 17v3h14v-3"
              stroke={palette.skyMesh}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </Svg>
        </View>
        <View style={styles.headerText}>
          <Text style={[styles.label, { color: palette.skyMesh }]}>YOU'RE HOSTING</Text>
          <Text style={[styles.room, { color: colors.txt }]} numberOfLines={1}>
            {roomCode.toUpperCase()}
          </Text>
        </View>
      </View>

      <View style={[styles.metaBlock, { borderTopColor: colors.border }]}>
        <View style={styles.metaRow}>
          <Text style={[styles.metaLabel, { color: colors.muted }]}>Session</Text>
          <Text style={[styles.metaValue, { color: colors.txt }]} numberOfLines={1}>
            {invite.sessionId}
          </Text>
        </View>
        {invite.eventAt ? (
          <View style={styles.metaRow}>
            <Text style={[styles.metaLabel, { color: colors.muted }]}>Starts</Text>
            <Text style={[styles.metaValue, { color: colors.txt }]} numberOfLines={1}>
              {new Date(invite.eventAt).toLocaleString([], {
                day: 'numeric',
                month: 'short',
                hour: 'numeric',
                minute: '2-digit',
                hour12: true,
              })}
            </Text>
          </View>
        ) : null}
      </View>

      {invite.message ? (
        <Text style={[styles.message, { color: colors.muted }]}>{invite.message}</Text>
      ) : null}

      <TouchableOpacity
        activeOpacity={0.85}
        onPress={() => onStart(roomCode, invite.sessionId)}
        style={styles.startButton}
      >
        <Text style={styles.startButtonText}>Start Broadcasting in {roomCode.toUpperCase()}</Text>
      </TouchableOpacity>
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
  label: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  room: {
    fontSize: 18,
    fontWeight: '900',
    letterSpacing: -0.4,
    marginTop: 1,
  },
  metaBlock: {
    borderTopWidth: 1,
    marginTop: 12,
    paddingTop: 10,
    gap: 4,
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  metaLabel: {
    fontSize: 12,
  },
  metaValue: {
    fontSize: 12,
    fontWeight: '700',
    flexShrink: 1,
  },
  message: {
    fontSize: 12,
    lineHeight: 18,
    marginTop: 10,
  },
  startButton: {
    backgroundColor: palette.mintPresence,
    paddingVertical: 13,
    borderRadius: 13,
    alignItems: 'center',
    marginTop: 14,
  },
  startButtonText: {
    color: '#0F2F2C',
    fontSize: 14,
    fontWeight: '800',
  },
});
