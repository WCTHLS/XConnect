import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
} from 'react-native';
import { useTheme } from '../../theme/useTheme';
import { palette } from '../../theme/colors';
import { TopBar } from '../../components/ui/TopBar';
import { SensorPill } from '../../components/ui/SensorPill';
import { MobileScreen } from '../../components/navigation/BottomNav';

interface EdgeStateScreenProps {
  onNavigate: (screen: MobileScreen) => void;
}

export const EdgeStateScreen: React.FC<EdgeStateScreenProps> = ({ onNavigate }) => {
  const { colors } = useTheme();

  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>
      <TopBar
        title="Edge State & Resilience"
        subtitle="Offline & Anomaly Monitor"
        onBack={() => onNavigate('adminOverview')}
      />

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <View
          style={[
            styles.card,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <View style={styles.cardHeader}>
            <Text style={[styles.cardTitle, { color: colors.sub }]}>
              OFFLINE TELEMETRY QUEUE
            </Text>
            <SensorPill label="Synced" status="active" />
          </View>
          <Text style={[styles.statValue, { color: palette.mintPresence }]}>
            0 Pending
          </Text>
          <Text style={[styles.statDesc, { color: colors.muted }]}>
            All observation batches synchronized to cloud endpoint.
          </Text>
        </View>

        <View
          style={[
            styles.card,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <View style={styles.cardHeader}>
            <Text style={[styles.cardTitle, { color: colors.sub }]}>
              CLUSTER INTEGRITY
            </Text>
            <SensorPill label="Optimal" status="active" />
          </View>
          <Text style={[styles.statValue, { color: palette.skyMesh }]}>
            100% Graph Health
          </Text>
          <Text style={[styles.statDesc, { color: colors.muted }]}>
            Zero isolated nodes or spoofed tokens detected.
          </Text>
        </View>
      </ScrollView>
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
    paddingBottom: 28,
    gap: 14,
  },
  card: {
    padding: 18,
    borderRadius: 16,
    borderWidth: 1.5,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  cardTitle: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  statValue: {
    fontSize: 24,
    fontWeight: '900',
    letterSpacing: -0.5,
    marginBottom: 4,
  },
  statDesc: {
    fontSize: 12,
  },
});
