import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Switch,
  Alert,
} from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { useTheme } from '../../theme/useTheme';
import { palette } from '../../theme/colors';
import { signOut } from '../../services/auth';
import { MobileScreen, Role } from '../../components/navigation/BottomNav';

interface ProfileScreenProps {
  displayName: string;
  onSaveDisplayName: (name: string) => Promise<void>;
  userEmail?: string;
  role: Role;
  deviceId: string;
  serverEnv: 'cloud' | 'local' | 'custom';
  serverUrl: string;
  onSelectServerEnv: (env: 'cloud' | 'local' | 'custom', customUrl?: string) => void;
  onNavigate: (screen: MobileScreen) => void;
  onSignOut: () => void;
}

export const ProfileScreen: React.FC<ProfileScreenProps> = ({
  displayName,
  onSaveDisplayName,
  userEmail,
  role,
  deviceId,
  serverEnv,
  serverUrl,
  onSelectServerEnv,
  onNavigate,
  onSignOut,
}) => {
  const { colors, theme, toggleTheme } = useTheme();
  const isDark = theme === 'dark';

  const [name, setName] = useState(displayName);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleSaveName = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await onSaveDisplayName(name.trim());
      setEditing(false);
    } catch (err: any) {
      Alert.alert('Error', err?.message ?? 'Failed to update name');
    } finally {
      setSaving(false);
    }
  };

  const handleSignOut = async () => {
    await signOut();
    onSignOut();
    onNavigate('login');
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
        <TouchableOpacity
          onPress={() => {
            if (editing) handleSaveName();
            else setEditing(true);
          }}
          style={[
            styles.editPill,
            {
              backgroundColor: editing ? 'rgba(51,209,172,0.15)' : colors.cardSecondary,
              borderColor: editing ? palette.mintPresence : colors.border,
            },
          ]}
        >
          <Text
            style={[
              styles.editPillText,
              { color: editing ? palette.mintPresence : colors.sub },
            ]}
          >
            {editing ? 'Done' : 'Edit Profile'}
          </Text>
        </TouchableOpacity>
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
                autoFocus
              />
            ) : (
              <Text style={[styles.userName, { color: colors.txt }]}>
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
        </View>

        {/* Stats 3-Column Row */}
        <View style={[styles.statsRow, { borderTopColor: colors.border }]}>
          <View style={styles.statCol}>
            <Text style={[styles.statValue, { color: colors.txt }]}>24</Text>
            <Text style={[styles.statLabel, { color: colors.muted }]}>Sessions</Text>
          </View>
          <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
          <View style={styles.statCol}>
            <Text style={[styles.statValue, { color: palette.mintPresence }]}>18.4h</Text>
            <Text style={[styles.statLabel, { color: colors.muted }]}>Dwell</Text>
          </View>
          <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
          <View style={styles.statCol}>
            <Text style={[styles.statValue, { color: palette.skyMesh }]}>99%</Text>
            <Text style={[styles.statLabel, { color: colors.muted }]}>Avg Conf</Text>
          </View>
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
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: -0.4,
  },
  editPill: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
  },
  editPillText: {
    fontSize: 13,
    fontWeight: '700',
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
