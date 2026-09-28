import React from 'react';
import { View, Text, StyleSheet, Modal, ActivityIndicator } from 'react-native';
import { useTheme } from '../../theme/useTheme';
import { palette } from '../../theme/colors';

interface BusyOverlayProps {
  visible: boolean;
  label: string;
}

/**
 * Blocking spinner for the short waits the app genuinely has to finish before the UI can move on,
 * such as telling the server you've left a room. Deliberately blocking: the point is to stop a
 * second tap landing mid-flight, which is what made leaving unreliable in the first place.
 * Anything that can fail silently in the background should not use this.
 */
export const BusyOverlay: React.FC<BusyOverlayProps> = ({ visible, label }) => {
  const { colors } = useTheme();
  if (!visible) return null;

  return (
    // `visible` is also gated above so the Modal is unmounted entirely when idle, rather than
    // mounted-but-hidden over every screen.
    <Modal transparent visible animationType="fade" onRequestClose={() => {}}>
      <View style={styles.backdrop}>
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <ActivityIndicator color={palette.mintPresence} />
          <Text style={[styles.label, { color: colors.txt }]}>{label}</Text>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(6,11,18,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    borderRadius: 16,
    borderWidth: 1.5,
    paddingHorizontal: 24,
    paddingVertical: 20,
  },
  label: {
    fontSize: 14,
    fontWeight: '700',
  },
});
