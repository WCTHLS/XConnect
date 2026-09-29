import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Switch,
  ActivityIndicator,
} from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useTheme } from '../../theme/useTheme';
import { palette } from '../../theme/colors';
import { Role } from '../../components/navigation/BottomNav';
import { AppAlert } from '../../components/ui/AppAlert';

/** Compact enough for a stat tile: minutes below an hour, then hours to one decimal. */
function formatDwell(ms: number): string {
  if (ms < 60_000) return '0m';
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;
  return `${(minutes / 60).toFixed(1)}h`;
}

export interface MyStats {
  /** Distinct rooms this account has been sensor-verified in. */
  sessions: number;
  dwellMs: number;
  /** 0–1, or null when no membership row carried a confidence reading. */
  avgConfidence: number | null;
}

interface ProfileScreenProps {
  displayName: string;
  onSaveDisplayName: (name: string) => Promise<void>;
  /** Resolves to null when the figures can't be fetched, so the card says so rather than
   *  showing zeros that look like a real (empty) history. */
  onFetchMyStats: () => Promise<MyStats | null>;
  userEmail?: string;
  role: Role;
  deviceId: string;
  serverEnv: 'cloud' | 'local' | 'custom';
  serverUrl: string;
  onSelectServerEnv: (env: 'cloud' | 'local' | 'custom', customUrl?: string) => void;
  onSignOut: () => Promise<void>;
}

export const ProfileScreen: React.FC<ProfileScreenProps> = ({
  displayName,
  onSaveDisplayName,
  onFetchMyStats,
  userEmail,
  role,
  deviceId,
  serverEnv,
  serverUrl,
  onSelectServerEnv,
  onSignOut,
}) => {
  const { colors, theme, toggleTheme } = useTheme();
  const isDark = theme === 'dark';

  const [name, setName] = useState(displayName);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  // undefined while the request is in flight, null once it has failed.
  const [stats, setStats] = useState<MyStats | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    onFetchMyStats()
      .then(result => {
        if (!cancelled) setStats(result);
      })
      .catch(() => {
        if (!cancelled) setStats(null);
      });
    return () => {
      cancelled = true;
    };
  }, [onFetchMyStats]);

  const handleSaveName = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await onSaveDisplayName(name.trim());
      setEditing(false);
    } catch (err: any) {
      AppAlert.alert('Error', err?.message ?? 'Failed to update name');
    } finally {
      setSaving(false);
    }
  };

  // The whole teardown (stop presence, then drop the token, then reset role and navigate) is
  // owned by App.tsx — the ordering matters and only it can see the live presence state.
  const handleSignOut = () => {
    void onSignOut();
  };

  const initials = (name || displayName || 'User')
    .split(' ')
    .filter(Boolean)
    .map(n => n[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.surf }]}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      {/* Top Header */}
      <View style={styles.topHeader}>
        <Text style={[styles.headerTitle, { color: colors.txt }]}>Profile</Text>
      </View>

      {/* Profile Card */}
      <View
        style={[
          styles.profileCard,
          { backgroundColor: colors.card, borderColor: colors.border },
        ]}
      >
        <View style={styles.profileHeaderRow}>
          <View
            style={[
              styles.avatarCircle,
              {
                backgroundColor: 'rgba(51,209,172,0.18)',
                borderColor: palette.mintPresence,
              },
            ]}
          >
            <Text style={[styles.avatarText, { color: palette.mintPresence }]}>
              {initials}
            </Text>
          </View>

          <View style={styles.profileMeta}>
            {editing ? (
              <TextInput
                style={[
                  styles.nameInput,
                  {
                    color: colors.txt,
                    borderColor: colors.border,
                    backgroundColor: colors.surf,
                  },
                ]}
                value={name}
                onChangeText={setName}
                onSubmitEditing={handleSaveName}
                returnKeyType="done"
                autoFocus
              />
            ) : (
              <Text style={[styles.userName, { color: colors.txt }]} numberOfLines={1}>
                {name || displayName || 'XConnect User'}
              </Text>
            )}
            <Text style={[styles.userEmail, { color: colors.muted }]}>
              {userEmail || 'user@enterprise.io'}
            </Text>
            <View style={styles.roleTag}>
              <Text style={styles.roleTagText}>{role.toUpperCase()} ACCOUNT</Text>
            </View>
          </View>

          {/* Pinned to the card's right edge rather than sitting next to the name: the display
              name is the only editable field here, so this is the card's one action. */}
          <TouchableOpacity
            activeOpacity={0.7}
            disabled={saving}
            onPress={() => {
              if (editing) handleSaveName();
              else setEditing(true);
            }}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            style={[
              styles.nameEditButton,
              {
                backgroundColor: editing ? 'rgba(51,209,172,0.15)' : colors.cardSecondary,
                borderColor: editing ? palette.mintPresence : colors.border,
                opacity: saving ? 0.5 : 1,
              },
            ]}
          >
            {editing ? (
              <Svg width={15} height={15} viewBox="0 0 24 24" fill="none">
                <Path
                  d="M5 13l4 4L19 7"
                  stroke={palette.mintPresence}
                  strokeWidth={2.5}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </Svg>
            ) : (
              <Svg width={15} height={15} viewBox="0 0 24 24" fill="none">
                <Path
                  d="M4 20h4l10-10a2.1 2.1 0 0 0-3-3L5 17v3z"
                  stroke={colors.sub}
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </Svg>
            )}
          </TouchableOpacity>
        </View>

        {/* Stats 3-Column Row. Sensor-verified attendance from the server — never a stand-in
            figure, since a made-up number here reads exactly like a real one. */}
        <View style={[styles.statsRow, { borderTopColor: colors.border }]}>
          {stats === undefined ? (
            <ActivityIndicator color={palette.mintPresence} style={styles.statsLoading} />
          ) : stats === null ? (
            <Text style={[styles.statsUnavailable, { color: colors.muted }]}>
              Attendance totals are unavailable right now.
            </Text>
          ) : (
            <>
              <View style={styles.statCol}>
                <Text style={[styles.statValue, { color: colors.txt }]}>{stats.sessions}</Text>
                <Text style={[styles.statLabel, { color: colors.muted }]}>
                  {stats.sessions === 1 ? 'Session' : 'Sessions'}
                </Text>
              </View>
              <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
              <View style={styles.statCol}>
                <Text style={[styles.statValue, { color: palette.mintPresence }]}>
                  {formatDwell(stats.dwellMs)}
                </Text>
                <Text style={[styles.statLabel, { color: colors.muted }]}>Dwell</Text>
              </View>
              <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
              <View style={styles.statCol}>
                <Text style={[styles.statValue, { color: palette.skyMesh }]}>
                  {stats.avgConfidence === null ? '—' : `${Math.round(stats.avgConfidence * 100)}%`}
                </Text>
                <Text style={[styles.statLabel, { color: colors.muted }]}>Avg Conf</Text>
              </View>
            </>
          )}
        </View>
      </View>

      {/* Preferences Card */}
      <View
        style={[
          styles.sectionCard,
          { backgroundColor: colors.card, borderColor: colors.border },
        ]}
      >
        <Text style={[styles.sectionHeading, { color: colors.sub }]}>
          SYSTEM PREFERENCES
        </Text>

        <View style={styles.toggleRow}>
          <View>
            <Text style={[styles.toggleTitle, { color: colors.txt }]}>Dark Mode</Text>
            <Text style={[styles.toggleDesc, { color: colors.muted }]}>
              Toggle between Light and Dark interface
            </Text>
          </View>
          <Switch
            value={isDark}
            onValueChange={toggleTheme}
            trackColor={{
              false: colors.border,
              true: 'rgba(51,209,172,0.4)',
            }}
            thumbColor={isDark ? palette.mintPresence : colors.sub}
          />
        </View>
      </View>

      {/* Server Environment Card */}
      <View
        style={[
          styles.sectionCard,
          { backgroundColor: colors.card, borderColor: colors.border },
        ]}
      >
        <Text style={[styles.sectionHeading, { color: colors.sub }]}>
          BACKEND ENVIRONMENT
        </Text>

        <View style={styles.serverChipsRow}>
          {(['cloud', 'local'] as const).map(env => (
            <TouchableOpacity
              key={env}
              onPress={() => onSelectServerEnv(env)}
              style={[
                styles.serverChip,
                {
                  backgroundColor:
                    serverEnv === env
                      ? 'rgba(51,209,172,0.18)'
                      : colors.surf,
                  borderColor:
                    serverEnv === env ? palette.mintPresence : colors.border,
                },
              ]}
            >
              <Text
                style={[
                  styles.serverChipText,
                  {
                    color:
                      serverEnv === env ? palette.mintPresence : colors.sub,
                    fontWeight: serverEnv === env ? '700' : '500',
                  },
                ]}
              >
                {env === 'cloud' ? 'Cloud Server' : 'Local LAN (Dev)'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={[styles.serverUrlText, { color: colors.muted }]} numberOfLines={1}>
          {serverUrl}
        </Text>
      </View>

      {/* Sign Out Button */}
      <TouchableOpacity
        activeOpacity={0.8}
        onPress={handleSignOut}
        style={[styles.signOutButton, { borderColor: palette.roseError }]}
      >
        <Text style={[styles.signOutText, { color: palette.roseError }]}>
          Sign Out
        </Text>
      </TouchableOpacity>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 36,
  },
  topHeader: {
    marginBottom: 16,
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: -0.4,
  },
  profileCard: {
    borderRadius: 20,
    borderWidth: 1,
    padding: 16,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 1,
  },
  profileHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginBottom: 16,
  },
  avatarCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize: 22,
    fontWeight: '800',
  },
  profileMeta: {
    flex: 1,
  },
  nameInput: {
    alignSelf: 'stretch',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    fontSize: 14,
    fontWeight: '700',
  },
  userName: {
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  nameEditButton: {
    // Sits at the card's right edge, aligned with the top of the name rather than centred on the
    // whole three-line block, so it reads as acting on the name and not on the card at large.
    alignSelf: 'flex-start',
    marginTop: 2,
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  userEmail: {
    fontSize: 12,
    marginTop: 2,
  },
  roleTag: {
    backgroundColor: 'rgba(51,209,172,0.12)',
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    marginTop: 6,
  },
  roleTagText: {
    fontSize: 9,
    fontWeight: '800',
    color: palette.mintPresence,
    letterSpacing: 0.5,
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    borderTopWidth: 1,
    paddingTop: 12,
  },
  statCol: {
    alignItems: 'center',
  },
  statValue: {
    fontSize: 18,
    fontWeight: '800',
  },
  statLabel: {
    fontSize: 11,
    marginTop: 2,
  },
  statsLoading: {
    paddingVertical: 8,
  },
  statsUnavailable: {
    fontSize: 12,
    paddingVertical: 8,
    textAlign: 'center',
  },
  statDivider: {
    width: 1,
    height: 24,
  },
  sectionCard: {
    borderRadius: 18,
    borderWidth: 1,
    padding: 16,
    marginBottom: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
  },
  sectionHeading: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
    marginBottom: 12,
  },
  toggleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  toggleTitle: {
    fontSize: 14,
    fontWeight: '600',
  },
  toggleDesc: {
    fontSize: 11,
    marginTop: 2,
  },
  serverChipsRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 10,
  },
  serverChip: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1.5,
    alignItems: 'center',
  },
  serverChipText: {
    fontSize: 12,
  },
  serverUrlText: {
    fontSize: 11,
    textAlign: 'center',
  },
  signOutButton: {
    borderWidth: 1.5,
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
    marginTop: 6,
  },
  signOutText: {
    fontSize: 14,
    fontWeight: '700',
  },
});
