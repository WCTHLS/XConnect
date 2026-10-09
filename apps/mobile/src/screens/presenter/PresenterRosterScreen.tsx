import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  FlatList,
} from 'react-native';
import { RoomMemberInfo } from '@confpresence/shared';
import { useTheme } from '../../theme/useTheme';
import { palette } from '../../theme/colors';
import { TopBar } from '../../components/ui/TopBar';
import { ParticipantCard } from '../../components/ui/ParticipantCard';
import { MobileScreen } from '../../components/navigation/BottomNav';

interface PresenterRosterScreenProps {
  roomId: string;
  roomMembers: RoomMemberInfo[];
  onNavigate: (screen: MobileScreen) => void;
}

export const PresenterRosterScreen: React.FC<PresenterRosterScreenProps> = ({
  roomId,
  roomMembers,
  onNavigate,
}) => {
  const { colors } = useTheme();
  const [search, setSearch] = useState('');

  const filtered = roomMembers.filter(m =>
    (m.displayName || '').toLowerCase().includes(search.toLowerCase())
  );

  const formatMemberDwell = (ms?: number) => {
    if (!ms || ms <= 0) return '< 1m';
    const mins = Math.floor(ms / 60000);
    const secs = Math.floor((ms % 60000) / 1000);
    return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>
      <TopBar
        title="Live In-Room Roster"
        subtitle={`${roomId.toUpperCase()} · ${roomMembers.length} Members`}
        onBack={() => onNavigate('presenterDashboard')}
      />

      <View style={styles.searchWrapper}>
        <TextInput
          style={[
            styles.searchInput,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
              color: colors.txt,
            },
          ]}
          placeholder="Search attendees..."
          placeholderTextColor={colors.muted}
          value={search}
          onChangeText={setSearch}
        />
      </View>

      {/* Virtualized: only the rows near the screen exist as native views, so a room of 800+ costs
          about the same as one of 20, and each live update only re-renders what's mounted. */}
      <FlatList
        data={filtered}
        keyExtractor={(m, idx) => m.deviceId || String(idx)}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        initialNumToRender={12}
        maxToRenderPerBatch={12}
        windowSize={5}
        removeClippedSubviews
        ListEmptyComponent={
          <View
            style={[
              styles.emptyState,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <Text style={[styles.emptyText, { color: colors.muted }]}>
              {search
                ? `No attendee found matching "${search}"`
                : 'No attendees currently detected in room.'}
            </Text>
          </View>
        }
        renderItem={({ item: m, index: idx }) => (
          <ParticipantCard
            name={m.displayName || `Attendee ${idx + 1}`}
            role={m.role === 'presenter' ? 'Host' : 'Attendee'}
            dwell={formatMemberDwell(m.durationMs)}
            joinedAt={
              m.startedAt
                ? new Date(m.startedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true })
                : undefined
            }
            ultraVerified={m.ultrasonicVerified ?? false}
            wifiMatch={
              m.wifiSimilarity ? `${Math.round(m.wifiSimilarity * 100)}%` : 'Active'
            }
            bleActive={true}
            motionFlag={m.motionAnomalyFlag ?? false}
          />
        )}
      />
    </View>
  );
};


const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  searchWrapper: {
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  searchInput: {
    paddingHorizontal: 16,
    paddingVertical: 11,
    borderRadius: 14,
    borderWidth: 1.5,
    fontSize: 14,
  },
  list: {
    paddingHorizontal: 20,
    paddingBottom: 24,
  },
  emptyState: {
    padding: 24,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
    marginTop: 20,
  },
  emptyText: {
    fontSize: 13,
  },
});
