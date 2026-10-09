import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import Svg, { Path, Circle } from 'react-native-svg';
import { useTheme } from '../../theme/useTheme';
import { palette } from '../../theme/colors';
import { TopBar } from './TopBar';
import { MobileScreen } from '../navigation/BottomNav';

interface AdminOnlyNoticeProps {
  /** What they were trying to open, named in the copy so the refusal is specific. */
  feature: string;
  userEmail?: string;
  onNavigate: (screen: MobileScreen) => void;
}

/**
 * Shown in place of an admin screen when the signed-in account is not an admin.
 *
 * This is a UI courtesy, not the security boundary: every /api/admin route is gated server-side
 * by requireAdmin, so a non-admin reaching these screens anyway would simply get 403s. The point
 * is to say why up front rather than letting someone fill in a form that cannot succeed.
 */
export const AdminOnlyNotice: React.FC<AdminOnlyNoticeProps> = ({ feature, userEmail, onNavigate }) => {
  const { colors } = useTheme();

  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>
      <TopBar title={feature} subtitle="Admin only" onBack={() => onNavigate('home')} />

      <View style={styles.content}>
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={[styles.iconBox, { backgroundColor: 'rgba(245,158,11,0.15)' }]}>
            <Svg width={24} height={24} viewBox="0 0 24 24" fill="none">
              <Circle cx={12} cy={12} r={9} stroke={palette.amberWarn} strokeWidth={2} />
              <Path
                d="M12 8v5"
                stroke={palette.amberWarn}
                strokeWidth={2.2}
                strokeLinecap="round"
              />
              <Circle cx={12} cy={16.5} r={1.1} fill={palette.amberWarn} />
            </Svg>
          </View>

          <Text style={[styles.title, { color: colors.txt }]}>This account is not an admin</Text>
          <Text style={[styles.body, { color: colors.muted }]}>
            {feature} is only available to admin accounts.
            {userEmail ? ` You are signed in as ${userEmail}.` : ''}
          </Text>
          <Text style={[styles.body, { color: colors.muted, marginTop: 8 }]}>
            Picking Admin at sign-in selects the view, it does not grant access. Ask whoever runs
            the server to add this address to its admin list, then sign out and back in.
          </Text>

          <TouchableOpacity activeOpacity={0.85} onPress={() => onNavigate('home')} style={styles.button}>
            <Text style={styles.buttonText}>Back to Home</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { flex: 1, paddingHorizontal: 20, paddingTop: 32 },
  card: {
    borderRadius: 20,
    borderWidth: 1.5,
    padding: 24,
    alignItems: 'center',
  },
  iconBox: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 16,
    fontWeight: '800',
    marginBottom: 8,
    textAlign: 'center',
  },
  body: {
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
  },
  button: {
    backgroundColor: palette.mintPresence,
    paddingVertical: 13,
    paddingHorizontal: 28,
    borderRadius: 13,
    alignItems: 'center',
    marginTop: 22,
  },
  buttonText: {
    color: '#0F2F2C',
    fontSize: 14,
    fontWeight: '800',
  },
});
