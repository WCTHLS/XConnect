import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useTheme } from '../../theme/useTheme';
import { palette } from '../../theme/colors';
import { GoogleLogo, MicrosoftLogo } from '../../components/BrandIcons';
import {
  emailSignInAvailable,
  googleSignInAvailable,
  microsoftSignInAvailable,
  sendPasswordReset,
  signInWithEmail,
  signInWithGoogle,
  signInWithMicrosoft,
} from '../../services/auth';
import { MobileScreen } from '../../components/navigation/BottomNav';

interface LoginScreenProps {
  onNavigate: (screen: MobileScreen) => void;
  onSuccess?: () => void;
}

export const LoginScreen: React.FC<LoginScreenProps> = ({ onNavigate, onSuccess }) => {
  const { colors, theme } = useTheme();
  const isDark = theme === 'dark';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const run = async (action: () => Promise<{ ok: boolean; error?: string }>) => {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const result = await action();
      if (!result.ok && result.error) {
        setError(result.error);
      } else if (result.ok) {
        onSuccess?.();
        onNavigate('home');
      }
      return result;
    } catch (err: any) {
      setError(err?.message ?? 'Sign in failed');
    } finally {
      setBusy(false);
    }
  };

  const handleEmailSignIn = () => {
    if (!email.trim() || !password) {
      setError('Please enter email and password.');
      return;
    }
    void run(() => signInWithEmail(email.trim(), password));
  };

  const handleForgotPassword = async () => {
    if (!email.trim()) {
      setError('Enter your email above first.');
      return;
    }
    const res = await run(() => sendPasswordReset(email.trim()));
    if (res?.ok) setInfo('Password reset email sent.');
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.surf }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Header Branding */}
        <View style={styles.header}>
          <View style={styles.logoBadge}>
            <Text style={styles.logoX}>X</Text>
          </View>
          <Text style={[styles.title, { color: colors.txt }]}>Welcome to XConnect</Text>
          <Text style={[styles.subtitle, { color: colors.sub }]}>
            Sign in to join in-room sessions and verify your presence
          </Text>
        </View>

        {error ? (
          <View style={styles.errorBanner}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        {info ? (
          <View style={styles.infoBanner}>
            <Text style={styles.infoText}>{info}</Text>
          </View>
        ) : null}

        {/* OAuth Buttons */}
        <View style={styles.oauthSection}>
          {microsoftSignInAvailable && (
            <TouchableOpacity
              activeOpacity={0.8}
              style={[
                styles.oauthButton,
                {
                  backgroundColor: colors.card,
                  borderColor: colors.border,
                },
              ]}
              onPress={() => void run(signInWithMicrosoft)}
              disabled={busy}
            >
              <MicrosoftLogo size={20} />
              <Text style={[styles.oauthText, { color: colors.txt }]}>
                Continue with Microsoft
              </Text>
            </TouchableOpacity>
          )}

          {googleSignInAvailable && (
            <TouchableOpacity
              activeOpacity={0.8}
              style={[
                styles.oauthButton,
                {
                  backgroundColor: colors.card,
                  borderColor: colors.border,
                },
              ]}
              onPress={() => void run(signInWithGoogle)}
              disabled={busy}
            >
              <GoogleLogo size={20} />
              <Text style={[styles.oauthText, { color: colors.txt }]}>
                Continue with Google
              </Text>
            </TouchableOpacity>
          )}
        </View>

        <View style={styles.dividerRow}>
          <View style={[styles.dividerLine, { backgroundColor: colors.border }]} />
          <Text style={[styles.dividerText, { color: colors.muted }]}>
            or continue with email
          </Text>
          <View style={[styles.dividerLine, { backgroundColor: colors.border }]} />
        </View>

        {/* Email & Password Form */}
        <View style={styles.form}>
          <View style={styles.inputGroup}>
            <Text style={[styles.inputLabel, { color: colors.sub }]}>EMAIL ADDRESS</Text>
            <TextInput
              style={[
                styles.input,
                {
                  backgroundColor: colors.card,
                  borderColor: colors.border,
                  color: colors.txt,
                },
              ]}
              placeholder="name@company.com"
              placeholderTextColor={colors.muted}
              autoCapitalize="none"
              keyboardType="email-address"
              value={email}
              onChangeText={setEmail}
            />
          </View>

          <View style={styles.inputGroup}>
            <View style={styles.passwordLabelRow}>
              <Text style={[styles.inputLabel, { color: colors.sub }]}>PASSWORD</Text>
              <TouchableOpacity onPress={handleForgotPassword}>
                <Text style={[styles.forgotText, { color: palette.mintPresence }]}>
                  Forgot?
                </Text>
              </TouchableOpacity>
            </View>
            <TextInput
              style={[
                styles.input,
                {
                  backgroundColor: colors.card,
                  borderColor: colors.border,
                  color: colors.txt,
                },
              ]}
              placeholder="••••••••"
              placeholderTextColor={colors.muted}
              secureTextEntry
              value={password}
              onChangeText={setPassword}
            />
          </View>

          <TouchableOpacity
            activeOpacity={0.85}
            onPress={handleEmailSignIn}
            disabled={busy}
            style={styles.signInButton}
          >
            {busy ? (
              <ActivityIndicator color="#0F2F2C" />
            ) : (
              <Text style={styles.signInButtonText}>Sign In</Text>
            )}
          </TouchableOpacity>
        </View>

        <View style={styles.footer}>
          <TouchableOpacity onPress={() => onNavigate('createAccount')}>
            <Text style={[styles.footerText, { color: colors.sub }]}>
              Don't have an account?{' '}
              <Text style={{ color: palette.mintPresence, fontWeight: '700' }}>
                Create Account
              </Text>
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 24,
    paddingTop: 36,
    paddingBottom: 24,
  },
  header: {
    alignItems: 'center',
    marginBottom: 24,
  },
  logoBadge: {
    width: 60,
    height: 60,
    borderRadius: 18,
    backgroundColor: palette.mintPresence,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  logoX: {
    fontSize: 34,
    fontWeight: '900',
    color: '#060B12',
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: -0.4,
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
  },
  errorBanner: {
    backgroundColor: 'rgba(239,68,68,0.15)',
    borderWidth: 1,
    borderColor: palette.roseError,
    padding: 12,
    borderRadius: 12,
    marginBottom: 16,
  },
  errorText: {
    color: palette.roseError,
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
  },
  infoBanner: {
    backgroundColor: 'rgba(51,209,172,0.15)',
    borderWidth: 1,
    borderColor: palette.mintPresence,
    padding: 12,
    borderRadius: 12,
    marginBottom: 16,
  },
  infoText: {
    color: palette.mintPresence,
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
  },
  oauthSection: {
    gap: 12,
    marginBottom: 20,
  },
  oauthButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1.5,
    gap: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
  },
  oauthText: {
    fontSize: 14,
    fontWeight: '700',
  },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 20,
  },
  dividerLine: {
    flex: 1,
    height: 1,
  },
  dividerText: {
    fontSize: 11,
    fontWeight: '600',
  },
  form: {
    gap: 16,
  },
  inputGroup: {
    gap: 6,
  },
  passwordLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  inputLabel: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  forgotText: {
    fontSize: 11,
    fontWeight: '700',
  },
  input: {
    paddingHorizontal: 16,
    paddingVertical: 13,
    borderRadius: 14,
    borderWidth: 1.5,
    fontSize: 14,
    fontWeight: '500',
  },
  signInButton: {
    backgroundColor: palette.mintPresence,
    paddingVertical: 15,
    borderRadius: 14,
    alignItems: 'center',
    marginTop: 8,
    shadowColor: palette.mintPresence,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 3,
  },
  signInButtonText: {
    color: '#0F2F2C',
    fontSize: 15,
    fontWeight: '800',
  },
  footer: {
    alignItems: 'center',
    marginTop: 28,
  },
  footerText: {
    fontSize: 13,
  },
});
