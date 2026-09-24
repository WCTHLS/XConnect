import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Switch,
} from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';
import { useTheme } from '../../theme/useTheme';
import { palette } from '../../theme/colors';
import { MobileScreen } from '../../components/navigation/BottomNav';

interface PermissionsScreenProps {
  onNavigate: (screen: MobileScreen) => void;
  onGrantAll: () => Promise<void>;
}

export const PermissionsScreen: React.FC<PermissionsScreenProps> = ({
  onNavigate,
  onGrantAll,
}) => {
  const { colors, theme } = useTheme();
  const [granted, setGranted] = useState<Record<string, boolean>>({
    bluetooth: true,
    microphone: true,
  });

  const perms = [
    {
      key: 'bluetooth',
      icon: (
        <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
          <Path
            d="M6.5 6.5l11 11M17.5 6.5L12 12l5.5 5.5L12 23V1l5.5 5.5"
            stroke="#38BDF8"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </Svg>
      ),
      color: '#38BDF8',
      title: 'Nearby Devices',
      desc: 'Used to detect peer phones via Bluetooth Low Energy proximity tokens. No data is transmitted to external servers.',
    },
    {
      key: 'microphone',
      icon: (
        <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
          <Rect
            x={9}
            y={3}
            width={6}
            height={11}
            rx={3}
            stroke="#2DD4BF"
            strokeWidth={2}
          />
          <Path
            d="M5 10a7 7 0 0014 0M12 19v3M8 22h8"
            stroke="#2DD4BF"
            strokeWidth={2}
            strokeLinecap="round"
          />
        </Svg>
      ),
      color: '#2DD4BF',
      title: 'Microphone',
      desc: 'Used solely to decode inaudible room sound frequencies (18.5–19.5 kHz). Your conversations are never recorded or processed.',
    },
  ];

  const allGranted = Object.values(granted).every(Boolean);

  const handleContinue = async () => {
    await onGrantAll();
    onNavigate('login');
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.surf }]}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={[styles.title, { color: colors.txt }]}>Sensor Access</Text>
        <Text style={[styles.subtitle, { color: colors.sub }]}>
          XConnect needs two permissions to verify in-room presence. Both are used only on-device.
        </Text>
      </View>

      <ScrollView
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
      >
        {perms.map(p => (
          <View
            key={p.key}
            style={[
              styles.card,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
              },
            ]}
          >
            <View style={styles.cardRow}>
              <View
                style={[
                  styles.iconBox,
                  {
                    backgroundColor: `${p.color}15`,
                    borderColor: `${p.color}40`,
                  },
                ]}
              >
                {p.icon}
              </View>

              <View style={styles.cardInfo}>
                <View style={styles.titleRow}>
                  <Text style={[styles.cardTitle, { color: colors.txt }]}>
                    {p.title}
                  </Text>
                  <Switch
                    value={granted[p.key]}
                    onValueChange={val =>
                      setGranted(g => ({ ...g, [p.key]: val }))
                    }
                    trackColor={{
                      false: colors.border,
                      true: 'rgba(51,209,172,0.4)',
                    }}
                    thumbColor={
                      granted[p.key] ? palette.mintPresence : colors.sub
                    }
                  />
                </View>
                <Text style={[styles.cardDesc, { color: colors.sub }]}>
                  {p.desc}
                </Text>
              </View>
            </View>
          </View>
        ))}

        {/* Local Processing Shield Banner */}
        <View
          style={[
            styles.shieldBox,
            {
              backgroundColor: 'rgba(51,209,172,0.08)',
              borderColor: 'rgba(51,209,172,0.25)',
            },
          ]}
        >
          <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
            <Path
              d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"
              stroke="#33D1AC"
              strokeWidth={2}
              strokeLinejoin="round"
            />
          </Svg>
          <Text style={styles.shieldText}>
            All sensor data is processed locally. Nothing leaves your device.
          </Text>
        </View>
      </ScrollView>

      {/* Footer CTA */}
      <View style={styles.footer}>
        <TouchableOpacity
          activeOpacity={0.85}
          onPress={handleContinue}
          style={[
            styles.continueButton,
            {
              backgroundColor: allGranted ? palette.mintPresence : colors.border,
            },
          ]}
        >
          <Text
            style={[
              styles.continueButtonText,
              { color: allGranted ? '#0B0F17' : colors.muted },
            ]}
          >
            {allGranted ? 'Continue to XConnect' : 'Grant Permissions to Continue'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={handleContinue} style={styles.skipLink}>
          <Text style={[styles.skipLinkText, { color: colors.muted }]}>
            Skip for now
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 36,
    paddingBottom: 28,
  },
  header: {
    marginBottom: 20,
  },
  title: {
    fontSize: 26,
    fontWeight: '800',
    letterSpacing: -0.5,
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 14,
    lineHeight: 22,
  },
  list: {
    gap: 12,
  },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 1,
  },
  cardRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  iconBox: {
    width: 44,
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardInfo: {
    flex: 1,
  },
  titleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '700',
  },
  cardDesc: {
    fontSize: 13,
    lineHeight: 18,
  },
  shieldBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 4,
  },
  shieldText: {
    color: '#33D1AC',
    fontSize: 12,
    lineHeight: 17,
    flex: 1,
    fontWeight: '500',
  },
  footer: {
    paddingTop: 16,
  },
  continueButton: {
    paddingVertical: 16,
    borderRadius: 16,
    alignItems: 'center',
  },
  continueButtonText: {
    fontSize: 15,
    fontWeight: '800',
  },
  skipLink: {
    alignItems: 'center',
    marginTop: 12,
  },
  skipLinkText: {
    fontSize: 13,
  },
});
