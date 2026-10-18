import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import Svg, { Path, Circle } from 'react-native-svg';
import type { MyInvite } from '@confpresence/shared';
import { useTheme } from '../../theme/useTheme';
import { palette } from '../../theme/colors';
import { TopBar } from '../../components/ui/TopBar';
import { MobileScreen } from '../../components/navigation/BottomNav';
import { VerifyEmailCard } from '../../components/ui/VerifyEmailCard';
import { InviteDetailSheet } from '../../components/ui/InviteDetailSheet';

function formatEventWhen(iso: string): string {
  return new Date(iso).toLocaleString([], {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

interface NotificationsScreenProps {
  invites: MyInvite[];
  onRespondToInvite: (inviteId: number, response: 'accepted' | 'declined') => Promise<boolean>;
  onNavigate: (screen: MobileScreen) => void;
}

export const NotificationsScreen: React.FC<NotificationsScreenProps> = ({
  invites,
  onRespondToInvite,
  onNavigate,
}) => {
  const { colors, theme } = useTheme();
  const isDark = theme === 'dark';

  const [activeTab, setActiveTab] = useState<'pending' | 'replies'>('pending');
  const [busyInviteId, setBusyInviteId] = useState<number | null>(null);
  const [busyAction, setBusyAction] = useState<'accepted' | 'declined' | null>(null);

  const [openInviteId, setOpenInviteId] = useState<number | null>(null);

  const pendingInvites = invites.filter(i => i.status === 'pending');
  const answeredInvites = invites.filter(i => i.status !== 'pending');
  const openInvite = answeredInvites.find(i => i.id === openInviteId) ?? null;

  const handleRespond = async (inviteId: number, response: 'accepted' | 'declined') => {
    if (busyInviteId !== null) return;
    setBusyInviteId(inviteId);
    setBusyAction(response);
    try {
      await onRespondToInvite(inviteId, response);
    } finally {
      setBusyInviteId(null);
      setBusyAction(null);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.surf }]}>
      <TopBar
        title="Notifications"
        subtitle={
          pendingInvites.length > 0
            ? `${pendingInvites.length} pending ${pendingInvites.length === 1 ? 'invite' : 'invites'}`
            : 'All caught up'
        }
        onBack={() => onNavigate('home')}
      />

      {/* Segmented Control Tabs */}
      <View style={[styles.tabsContainer, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <TouchableOpacity
          activeOpacity={0.8}
          onPress={() => setActiveTab('pending')}
          style={[
            styles.tabButton,
            activeTab === 'pending' && {
              backgroundColor: isDark ? 'rgba(51,209,172,0.18)' : 'rgba(51,209,172,0.15)',
              borderColor: palette.mintPresence,
            },
          ]}
        >
          <Text
            style={[
              styles.tabText,
              { color: activeTab === 'pending' ? palette.mintPresence : colors.sub },
            ]}
          >
            Pending ({pendingInvites.length})
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          activeOpacity={0.8}
          onPress={() => setActiveTab('replies')}
          style={[
            styles.tabButton,
            activeTab === 'replies' && {
              backgroundColor: isDark ? 'rgba(51,209,172,0.18)' : 'rgba(51,209,172,0.15)',
              borderColor: palette.mintPresence,
            },
          ]}
        >
          <Text
            style={[
              styles.tabText,
              { color: activeTab === 'replies' ? palette.mintPresence : colors.sub },
            ]}
          >
            Past Replies ({answeredInvites.length})
          </Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {activeTab === 'pending' ? (
          <>
            <VerifyEmailCard />

            {pendingInvites.length === 0 ? (
              <View style={styles.emptyBox}>
                <View style={[styles.emptyIconCircle, { backgroundColor: isDark ? '#131C2E' : '#E2E8F0' }]}>
                  <Svg width={30} height={30} viewBox="0 0 24 24" fill="none">
                    <Path
                      d="M6 8a6 6 0 0 1 12 0c0 4 1.5 5.5 2 6.5H4c.5-1 2-2.5 2-6.5z"
                      stroke={colors.muted}
                      strokeWidth={2}
                      strokeLinejoin="round"
                    />
                    <Path d="M10 18a2 2 0 0 0 4 0" stroke={colors.muted} strokeWidth={2} strokeLinecap="round" />
                  </Svg>
                </View>
                <Text style={[styles.emptyTitle, { color: colors.txt }]}>All caught up!</Text>
                <Text style={[styles.emptySubtitle, { color: colors.muted }]}>
                  You have no pending session invitations or check-in requests.
                </Text>
              </View>
            ) : (
              <View style={[styles.feedCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                {pendingInvites.map((invite, index) => {
                  const isHosting = invite.inviteRole === 'presenter';
                  const isBusy = busyInviteId === invite.id;
                  const isLast = index === pendingInvites.length - 1;

                  return (
                    <View
                      key={invite.id}
                      style={[
                        styles.feedItem,
                        !isLast && { borderBottomWidth: 1, borderBottomColor: colors.border },
                      ]}
                    >
                      {/* Header Row: Icon + Title + Room Badge */}
                      <View style={styles.itemHeaderRow}>
                        <View style={[styles.itemIconCircle, { backgroundColor: 'rgba(51,209,172,0.15)' }]}>
                          <Svg width={15} height={15} viewBox="0 0 24 24" fill="none">
                            <Path
                              d="M4 6h16v12H4zM4 7l8 6 8-6"
                              stroke={palette.mintPresence}
                              strokeWidth={2}
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </Svg>
                        </View>

                        <View style={styles.itemTitleCol}>
                          <Text style={[styles.itemTitle, { color: colors.txt }]} numberOfLines={2}>
                            {invite.title || (isHosting ? 'Room assignment' : 'Check-in request')}
                          </Text>
                          <Text style={[styles.itemSession, { color: palette.mintPresence }]} numberOfLines={1}>
                            {isHosting
                              ? `${(invite.roomCode ?? '').toUpperCase()} · ${invite.sessionId}`
                              : invite.sessionId}
                          </Text>
                        </View>
                      </View>

                      {/* Scheduled Time */}
                      {invite.eventAt ? (
                        <View style={styles.eventTimeRow}>
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
                          <Text style={[styles.eventTimeText, { color: colors.sub }]}>
                            {formatEventWhen(invite.eventAt)}
                          </Text>
                        </View>
                      ) : null}

                      {/* Message / Description */}
                      {invite.message ? (
                        <Text style={[styles.itemMessage, { color: colors.muted }]}>{invite.message}</Text>
                      ) : null}

                      {/* Action Buttons */}
                      <View style={styles.actionsRow}>
                        <TouchableOpacity
                          activeOpacity={0.8}
                          disabled={isBusy}
                          onPress={() => void handleRespond(invite.id, 'declined')}
                          style={[styles.actionBtn, styles.declineBtn, { borderColor: colors.border }]}
                        >
                          {isBusy && busyAction === 'declined' ? (
                            <ActivityIndicator size="small" color={colors.sub} />
                          ) : (
                            <Text style={[styles.declineBtnText, { color: colors.sub }]}>
                              {isHosting ? "Can't host" : "Can't make it"}
                            </Text>
                          )}
                        </TouchableOpacity>

                        <TouchableOpacity
                          activeOpacity={0.8}
                          disabled={isBusy}
                          onPress={() => void handleRespond(invite.id, 'accepted')}
                          style={[styles.actionBtn, styles.acceptBtn, isBusy && { opacity: 0.7 }]}
                        >
                          {isBusy && busyAction === 'accepted' ? (
                            <ActivityIndicator size="small" color="#0F2F2C" />
                          ) : (
                            <Text style={styles.acceptBtnText}>
                              {isHosting ? "I'll host this" : "I'll be there"}
                            </Text>
                          )}
                        </TouchableOpacity>
                      </View>

                      {/* Footnote */}
                      <Text style={[styles.itemFootnote, { color: colors.muted }]}>
                        {isHosting
                          ? 'Accepting lets you start broadcasting this room from Home without typing it in.'
                          : 'Replying helps organizers plan. Verification occurs upon entering the room.'}
                      </Text>
                    </View>
                  );
                })}
              </View>
            )}
          </>
        ) : (
          /* Past Replies Tab */
          <>
            {answeredInvites.length === 0 ? (
              <View style={styles.emptyBox}>
                <View style={[styles.emptyIconCircle, { backgroundColor: isDark ? '#131C2E' : '#E2E8F0' }]}>
                  <Svg width={30} height={30} viewBox="0 0 24 24" fill="none">
                    <Circle cx={12} cy={12} r={9} stroke={colors.muted} strokeWidth={2} />
                    <Path d="M12 7v5l3 2" stroke={colors.muted} strokeWidth={2} strokeLinecap="round" />
                  </Svg>
                </View>
                <Text style={[styles.emptyTitle, { color: colors.txt }]}>No past replies</Text>
                <Text style={[styles.emptySubtitle, { color: colors.muted }]}>
                  When you accept, decline, or let an invite expire, it will be listed here.
                </Text>
              </View>
            ) : (
              <View style={[styles.feedCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                {answeredInvites.map((invite, index) => {
                  const isHostingInvite = invite.inviteRole === 'presenter';
                  const isExpired = invite.status === 'expired';
                  const accepted = invite.status === 'accepted';
                  const tone = isExpired ? '#94A3B8' : accepted ? palette.mintPresence : palette.roseError;
                  const isLast = index === answeredInvites.length - 1;

                  const statusLabel = isExpired
                    ? 'EXPIRED'
                    : isHostingInvite
                    ? accepted
                      ? 'HOSTING'
                      : 'DECLINED'
                    : accepted
                    ? 'GOING'
                    : 'NOT GOING';

                  return (
                    <TouchableOpacity
                      key={invite.id}
                      activeOpacity={isExpired ? 1 : 0.75}
                      disabled={isExpired}
                      onPress={() => setOpenInviteId(invite.id)}
                      style={[
                        styles.replyItem,
                        !isLast && { borderBottomWidth: 1, borderBottomColor: colors.border },
                      ]}
                    >
                      <View
                        style={[
                          styles.replyIcon,
                          {
                            backgroundColor: isExpired
                              ? 'rgba(148,163,184,0.15)'
                              : accepted
                              ? 'rgba(51,209,172,0.15)'
                              : 'rgba(239,68,68,0.15)',
                          },
                        ]}
                      >
                        <Svg width={14} height={14} viewBox="0 0 24 24" fill="none">
                          {isExpired ? (
                            <>
                              <Circle cx={12} cy={12} r={9} stroke={tone} strokeWidth={2} />
                              <Path d="M12 7v5l3 2" stroke={tone} strokeWidth={2} strokeLinecap="round" />
                            </>
                          ) : (
                            <Path
                              d={accepted ? 'M5 13l4 4L19 7' : 'M6 6l12 12M18 6L6 18'}
                              stroke={tone}
                              strokeWidth={2.5}
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          )}
                        </Svg>
                      </View>

                      <View style={styles.replyBody}>
                        <Text style={[styles.replyTitle, { color: colors.txt }]} numberOfLines={1}>
                          {isHostingInvite
                            ? `${(invite.roomCode ?? '').toUpperCase()} · ${invite.sessionId}`
                            : invite.sessionId}
                        </Text>
                        <Text style={[styles.replyMeta, { color: colors.muted }]} numberOfLines={1}>
                          {invite.eventAt
                            ? formatEventWhen(invite.eventAt)
                            : invite.respondedAt
                            ? `Replied ${new Date(invite.respondedAt).toLocaleDateString()}`
                            : 'Replied'}
                        </Text>
                      </View>

                      <View style={styles.replyEnd}>
                        <View style={[styles.statusBadge, { backgroundColor: `${tone}18`, borderColor: `${tone}40` }]}>
                          <Text style={[styles.statusBadgeText, { color: tone }]}>{statusLabel}</Text>
                        </View>
                        {!isExpired && (
                          <View style={styles.editHint}>
                            <Svg width={14} height={14} viewBox="0 0 24 24" fill="none">
                              <Path
                                d="M4 20h4l10-10a2.1 2.1 0 0 0-3-3L5 17v3z"
                                stroke={colors.sub}
                                strokeWidth={2}
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                            </Svg>
                          </View>
                        )}
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}
          </>
        )}
      </ScrollView>

      {/* Sheet to modify previous RSVP answer */}
      <InviteDetailSheet
        invite={openInvite}
        onClose={() => setOpenInviteId(null)}
        onRespond={onRespondToInvite}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  tabsContainer: {
    flexDirection: 'row',
    marginHorizontal: 20,
    marginTop: 10,
    marginBottom: 8,
    borderRadius: 12,
    borderWidth: 1,
    padding: 4,
    gap: 4,
  },
  tabButton: {
    flex: 1,
    paddingVertical: 9,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  tabText: {
    fontSize: 13,
    fontWeight: '700',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 32,
  },
  emptyBox: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 48,
    paddingHorizontal: 24,
  },
  emptyIconCircle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: '800',
    marginBottom: 6,
  },
  emptySubtitle: {
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 19,
  },
  feedCard: {
    borderRadius: 16,
    borderWidth: 1,
    overflow: 'hidden',
  },
  feedItem: {
    padding: 16,
  },
  itemHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 10,
  },
  itemIconCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemTitleCol: {
    flex: 1,
  },
  itemTitle: {
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  itemSession: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.5,
    marginTop: 2,
  },
  eventTimeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
  },
  eventTimeText: {
    fontSize: 12,
    fontWeight: '600',
  },
  itemMessage: {
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 14,
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 10,
  },
  actionBtn: {
    flex: 1,
    paddingVertical: 11,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  declineBtn: {
    borderWidth: 1.5,
  },
  declineBtnText: {
    fontSize: 13,
    fontWeight: '700',
  },
  acceptBtn: {
    backgroundColor: palette.mintPresence,
  },
  acceptBtnText: {
    color: '#0F2F2C',
    fontSize: 13,
    fontWeight: '800',
  },
  itemFootnote: {
    fontSize: 11,
    lineHeight: 15,
  },
  replyItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    gap: 12,
  },
  replyIcon: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  replyBody: {
    flex: 1,
  },
  replyTitle: {
    fontSize: 14,
    fontWeight: '700',
  },
  replyMeta: {
    fontSize: 11,
    marginTop: 2,
  },
  replyEnd: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
  },
  statusBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  editHint: {
    padding: 2,
  },
});
