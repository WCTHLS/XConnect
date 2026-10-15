import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { useTheme } from '../../theme/useTheme';
import { palette } from '../../theme/colors';
import { checkEmailVerified, sendVerificationEmail, useAuthSession } from '../../services/auth';

interface VerifyEmailCardProps {
  /** Extra line of context, for example why verifying matters on this screen. */
  note?: string;
  /** Called after a check finds the address verified, so the caller can reload what depends on it. */
  onVerified?: () => void;
}

/**
 * Asks an email/password account to confirm its address. Renders nothing for Google and Microsoft
 * accounts, or once verified, so it can be dropped on any screen without a condition.
 */
export const VerifyEmailCard: React.FC<VerifyEmailCardProps> = ({ note, onVerified }) => {
  const { colors } = useTheme();
  const { session } = useAuthSession();
  const [busy, setBusy] = useState<'send' | 'check' | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  if (session?.provider !== 'firebase' || session.emailVerified !== false) return null;

  const resend = async () => {
    setBusy('send');
    setMessage(null);
    const res = await sendVerificationEmail();
    setMessage(res.ok ? `We sent a link to ${session.email ?? 'your email'}. Open it, then come back.` : res.error ?? 'Could not send. Try again.');
    setBusy(null);
  };

  const check = async () => {
    setBusy('check');
    setMessage(null);
    const res = await checkEmailVerified();
    if (res.ok && res.verified) onVerified?.();
    else setMessage(res.ok ? 'Not verified yet. Open the link in the email first.' : res.error ?? 'Could not check. Try again.');
    setBusy(null);
  };

  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: palette.amberWarn }]}>
      <Text style={[styles.title, { color: colors.txt }]}>Verify your email</Text>
      <Text style={[styles.body, { color: colors.muted }]}>
        Confirm {session.email ?? 'your address'} to prove it is yours.
        {note ? ` ${note}` : ''}
      </Text>
      {message ? <Text style={[styles.message, { color: colors.txt }]}>{message}</Text> : null}
      <View style={styles.row}>
        <TouchableOpacity
          activeOpacity={0.85}
          disabled={busy !== null}
          onPress={check}
          style={[styles.primary, { opacity: busy ? 0.6 : 1 }]}
        >
          {busy === 'check' ? (
            <ActivityIndicator color="#0F2F2C" />
          ) : (
            <Text style={styles.primaryText}>I've verified</Text>
          )}
        </TouchableOpacity>
        <TouchableOpacity
          activeOpacity={0.85}
          disabled={busy !== null}
          onPress={resend}
          style={[styles.secondary, { borderColor: colors.border, opacity: busy ? 0.6 : 1 }]}
        >
          {busy === 'send' ? (
            <ActivityIndicator color={colors.txt} />
          ) : (
            <Text style={[styles.secondaryText, { color: colors.txt }]}>Resend email</Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  card: { borderRadius: 16, borderWidth: 1.5, padding: 16, marginBottom: 16 },
  title: { fontSize: 15, fontWeight: '800', marginBottom: 6 },
  body: { fontSize: 13, lineHeight: 19 },
  message: { fontSize: 13, lineHeight: 19, marginTop: 10 },
  row: { flexDirection: 'row', gap: 10, marginTop: 14 },
  primary: {
    flex: 1,
    backgroundColor: palette.mintPresence,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryText: { color: '#0F2F2C', fontSize: 13, fontWeight: '800' },
  secondary: {
    flex: 1,
    borderWidth: 1.5,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryText: { fontSize: 13, fontWeight: '700' },
});
