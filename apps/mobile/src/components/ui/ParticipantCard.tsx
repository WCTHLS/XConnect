import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { useTheme } from '../../theme/useTheme';
import { palette } from '../../theme/colors';

interface ParticipantCardProps {
  name: string;
  role: 'Host' | 'Attendee';
  dwell: string;
  ultraVerified?: boolean;
  wifiMatch?: string;
  bleActive?: boolean;
  motionFlag?: boolean;
}

export const ParticipantCard: React.FC<ParticipantCardProps> = ({
  name,
  role,
  dwell,
  ultraVerified = true,
  wifiMatch,
  bleActive = true,
  motionFlag = false,
}) => {
  const { colors, theme } = useTheme();
  const isHost = role === 'Host';
  const initials = name
    .split(' ')
    .filter(Boolean)
    .map(n => n[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
        },
      ]}
    >
      <View style={styles.header}>
        <View
          style={[
            styles.avatar,
            {
              backgroundColor: isHost
                ? 'rgba(51,209,172,0.18)'
                : 'rgba(56,189,248,0.15)',
              borderColor: isHost ? 'rgba(51,209,172,0.4)' : 'rgba(56,189,248,0.3)',
            },
          ]}
        >
          <Text
            style={[
              styles.avatarText,
              { color: isHost ? palette.mintPresence : palette.skyMesh },
            ]}
          >
            {initials || '??'}
          </Text>
        </View>

        <View style={styles.info}>
          <View style={styles.nameRow}>
            <Text style={[styles.name, { color: colors.txt }]} numberOfLines={1}>
              {name}
            </Text>
            <View
              style={[
                styles.roleBadge,
                {
                  backgroundColor: isHost
                    ? 'rgba(51,209,172,0.12)'
                    : 'rgba(100,116,139,0.12)',
                },
              ]}
            >
              <Text
                style={[
                  styles.roleText,
                  { color: isHost ? palette.mintPresence : colors.sub },
                ]}
              >
                {role}
              </Text>
            </View>
          </View>

          <View style={styles.dwellRow}>
            <Svg width={12} height={12} viewBox="0 0 24 24" fill="none">
              <Circle cx={12} cy={12} r={10} stroke={colors.muted} strokeWidth={2} />
              <Path
                d="M12 6v6l4 2"
                stroke={colors.muted}
                strokeWidth={2}
                strokeLinecap="round"
              />
            </Svg>
            <Text style={[styles.dwellText, { color: colors.muted }]}>{dwell}</Text>
          </View>
        </View>

        <View style={styles.verifiedIcon}>
          <Svg width={12} height={12} viewBox="0 0 24 24" fill="none">
            <Path
              d="M5 13l4 4L19 7"
              stroke={palette.mintPresence}
              strokeWidth={3}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </Svg>
        </View>
      </View>

      <View style={styles.pillsRow}>
        {ultraVerified && (
          <View style={[styles.pill, { backgroundColor: 'rgba(45,212,191,0.12)' }]}>
            <Text style={[styles.pillText, { color: palette.tealUltra }]}>
              🔊 Ultrasonic Verified
            </Text>
          </View>
        )}
        {wifiMatch && (
          <View style={[styles.pill, { backgroundColor: 'rgba(51,209,172,0.12)' }]}>
            <Text style={[styles.pillText, { color: palette.mintPresence }]}>
              Wi-Fi {wifiMatch}
            </Text>
          </View>
        )}
        {bleActive && (
          <View style={[styles.pill, { backgroundColor: 'rgba(56,189,248,0.12)' }]}>
            <Text style={[styles.pillText, { color: palette.skyMesh }]}>
              BLE Active
            </Text>
          </View>
        )}
        {motionFlag && (
          <View style={[styles.pill, { backgroundColor: 'rgba(245,158,11,0.15)' }]}>
            <Text style={[styles.pillText, { color: palette.amberWarn }]}>
              ⚠ Inactive
            </Text>
          </View>
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 12,
    marginBottom: 10,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  avatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  avatarText: {
    fontSize: 13,
    fontWeight: '700',
  },
  info: {
    flex: 1,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  name: {
    fontSize: 14,
    fontWeight: '600',
    flexShrink: 1,
  },
  roleBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 999,
  },
  roleText: {
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  dwellRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
    gap: 4,
  },
  dwellText: {
    fontSize: 11,
    fontWeight: '500',
  },
  verifiedIcon: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(51,209,172,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 5,
  },
  pill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  pillText: {
    fontSize: 10,
    fontWeight: '600',
  },
});
