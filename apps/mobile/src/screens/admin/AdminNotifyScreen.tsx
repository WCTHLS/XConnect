import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import type { InviteRole, SessionInvite } from '@confpresence/shared';
import { useTheme } from '../../theme/useTheme';
import { palette } from '../../theme/colors';
import { MobileScreen } from '../../components/navigation/BottomNav';
import { InviteResponsesPanel } from '../../components/ui/InviteResponsesPanel';

export interface NotifiableUser {
  id: string;
  email: string;
  name: string;
}

interface AdminNotifyScreenProps {
  onFetchInvites: (sessionId: string) => Promise<{ invites: SessionInvite[] }>;
  onEditInvites: (edit: {
    sessionId: string;
    newSessionId?: string;
    title?: string;
    message?: string;
    eventAt?: string | null;
    roomCode?: string;
    reAsk?: boolean;
  }) => Promise<{ updated: number; sessionId: string; pushError: string | null }>;
  /** Changes who a session invites, rather than what it says. */
  onEditRecipients: (edit: {
    sessionId: string;
    inviteRole: InviteRole;
    add?: string[];
    remove?: string[];
    roomCode?: string;
  }) => Promise<{ added: number; removed: number; skipped: string[]; pushError: string | null }>;
  onFetchUsers: () => Promise<NotifiableUser[]>;
  onNavigate: (screen: MobileScreen) => void;
}

export const AdminNotifyScreen: React.FC<AdminNotifyScreenProps> = ({
  onFetchInvites,
  onEditInvites,
  onEditRecipients,
  onFetchUsers,
  onNavigate,
}) => {
  const { colors } = useTheme();

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
          <Text style={[styles.headerTitle, { color: colors.txt }]}>Notify</Text>
          <Text style={[styles.headerSubtitle, { color: colors.muted }]}>
            Invite people, and see who replied
          </Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Sending lives on its own screen because it's a form (session, room, recipients,
            schedule) — this one is for reading the roster it produces. */}
        <TouchableOpacity
          activeOpacity={0.8}
          onPress={() => onNavigate('adminCheckIn')}
          style={[styles.checkInLink, { backgroundColor: colors.card, borderColor: palette.mintPresence }]}
        >
          <View style={{ flex: 1 }}>
            <Text style={[styles.checkInTitle, { color: colors.txt }]}>Send check-in invites</Text>
            <Text style={[styles.checkInSub, { color: colors.muted }]}>
              Ask attendees or a presenter to confirm ahead of time
            </Text>
          </View>
          <Text style={{ color: palette.mintPresence, fontSize: 13, fontWeight: '800' }}>→</Text>
        </TouchableOpacity>

        <InviteResponsesPanel
          onFetchInvites={onFetchInvites}
          onEditInvites={onEditInvites}
          onEditRecipients={onEditRecipients}
          onFetchUsers={onFetchUsers}
        />
      </ScrollView>
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
  checkInLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 16,
    borderRadius: 16,
    borderWidth: 1.5,
    marginBottom: 12,
  },
  checkInTitle: {
    fontSize: 14,
    fontWeight: '800',
  },
  checkInSub: {
    fontSize: 11,
    lineHeight: 16,
    marginTop: 2,
  },
});
