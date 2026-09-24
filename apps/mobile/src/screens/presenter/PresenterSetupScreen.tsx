import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
} from 'react-native';
import Svg, { Path, Circle } from 'react-native-svg';
import { getAcousticTokenForRoom } from '@confpresence/shared';
import { useTheme } from '../../theme/useTheme';
import { palette } from '../../theme/colors';
import { RoomChip } from '../../components/ui/RoomChip';
import { TopBar } from '../../components/ui/TopBar';
import { MobileScreen } from '../../components/navigation/BottomNav';

interface PresenterSetupScreenProps {
  rooms: string[];
  selectedRoom: string;
  onSelectRoom: (room: string) => void;
  sessionId: string;
  onSetSessionId: (id: string) => void;
  onStartBroadcast: (roomId: string, sessionId: string) => void;
  onNavigate: (screen: MobileScreen) => void;
}

export const PresenterSetupScreen: React.FC<PresenterSetupScreenProps> = ({
  rooms,
  selectedRoom,
  onSelectRoom,
  sessionId,
  onSetSessionId,
  onStartBroadcast,
  onNavigate,
}) => {
  const { colors, theme } = useTheme();
  const [customRoom, setCustomRoom] = useState('');
  const [showCustom, setShowCustom] = useState(false);

  const effectiveRoom = showCustom && customRoom.trim() ? customRoom.trim() : selectedRoom;
  const acousticToken = getAcousticTokenForRoom(effectiveRoom);

  const handleStart = () => {
    onStartBroadcast(effectiveRoom, sessionId);
    onNavigate('presenterDashboard');
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>
      <TopBar
        title="Presenter Setup"
        subtitle="Host Session"
        onBack={() => onNavigate('home')}
      />

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* Acoustic Token Preview Card */}
        <View
          style={[
            styles.acousticCard,
            {
              backgroundColor: colors.card,
              borderColor: palette.skyMesh,
            },
          ]}
        >
          <View style={styles.acousticHeader}>
            <View style={styles.speakerIconBadge}>
              <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
                <Path
                  d="M11 5L6 9H2v6h4l5 4V5z"
                  stroke={palette.skyMesh}
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <Path
                  d="M15.54 8.46a5 5 0 0 1 0 7.07"
                  stroke={palette.skyMesh}
                  strokeWidth={2}
                  strokeLinecap="round"
                />
              </Svg>
            </View>
            <View>
              <Text style={[styles.acousticLabel, { color: colors.sub }]}>
                ACOUSTIC ROOM TOKEN
              </Text>
              <Text style={[styles.tokenText, { color: palette.skyMesh }]}>
                {acousticToken}
              </Text>
            </View>
          </View>
          <Text style={[styles.acousticDesc, { color: colors.muted }]}>
            Emits 19kHz inaudible ultrasonic chirp on broadcast to verify attendees inside {effectiveRoom}.
          </Text>
        </View>

        {/* Room Selection */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.sub }]}>
            SELECT MEETING ROOM
          </Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chipsScroll}
          >
            {rooms.map(r => (
              <RoomChip
                key={r}
                label={r.toUpperCase()}
                active={!showCustom && selectedRoom === r}
                onPress={() => {
                  setShowCustom(false);
                  onSelectRoom(r);
                }}
              />
            ))}
            <RoomChip
              label="+ CUSTOM"
              active={showCustom}
              onPress={() => setShowCustom(true)}
            />
          </ScrollView>

          {showCustom && (
            <View style={styles.customInputWrapper}>
              <TextInput
                style={[
                  styles.customInput,
                  {
                    backgroundColor: colors.card,
                    borderColor: colors.border,
                    color: colors.txt,
                  },
                ]}
                placeholder="Enter custom room name..."
                placeholderTextColor={colors.muted}
                value={customRoom}
                onChangeText={setCustomRoom}
                autoFocus
              />
            </View>
          )}
        </View>

        {/* Session ID */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.sub }]}>
            SESSION IDENTIFIER
          </Text>
          <TextInput
            style={[
              styles.input,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
                color: colors.txt,
              },
            ]}
            value={sessionId}
            onChangeText={onSetSessionId}
            placeholder="poc-session"
            placeholderTextColor={colors.muted}
          />
        </View>
      </ScrollView>

      {/* Start Broadcast CTA */}
      <View style={styles.footer}>
        <TouchableOpacity
          activeOpacity={0.8}
          onPress={handleStart}
          style={styles.broadcastButton}
        >
          <Text style={styles.broadcastButtonText}>
            Start In-Room Broadcast
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 24,
  },
  acousticCard: {
    borderRadius: 16,
    borderWidth: 1.5,
    padding: 16,
    marginBottom: 20,
  },
  acousticHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  speakerIconBadge: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(56,189,248,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  acousticLabel: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  tokenText: {
    fontSize: 22,
    fontWeight: '900',
    letterSpacing: 1,
  },
  acousticDesc: {
    fontSize: 12,
    lineHeight: 16,
  },
  section: {
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
    marginBottom: 10,
  },
  chipsScroll: {
    paddingVertical: 2,
  },
  customInputWrapper: {
    marginTop: 10,
  },
  customInput: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1.5,
    fontSize: 14,
  },
  input: {
    paddingHorizontal: 16,
    paddingVertical: 13,
    borderRadius: 14,
    borderWidth: 1.5,
    fontSize: 14,
    fontWeight: '600',
  },
  footer: {
    paddingHorizontal: 20,
    paddingBottom: 24,
  },
  broadcastButton: {
    backgroundColor: palette.mintPresence,
    paddingVertical: 16,
    borderRadius: 16,
    alignItems: 'center',
    shadowColor: palette.mintPresence,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 4,
  },
  broadcastButtonText: {
    color: '#060B12',
    fontSize: 16,
    fontWeight: '800',
  },
});
