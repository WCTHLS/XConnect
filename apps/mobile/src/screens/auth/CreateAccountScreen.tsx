import React, { useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import Svg, { Path, Circle } from 'react-native-svg';
import { useTheme } from '../../theme/useTheme';
import { palette } from '../../theme/colors';
import { signUpWithEmail } from '../../services/auth';
import { MobileScreen, Role } from '../../components/navigation/BottomNav';
import { RolePicker } from '../../components/ui/RolePicker';
import { useKeyboardAwareScroll } from '../../hooks/useKeyboardAwareScroll';

// Named rather than read back off styles.container: StyleSheet.create's return value is an
// opaque style ID on native builds, not the object itself, so its paddingBottom isn't something
// that can be read back out at runtime to add the keyboard's height on top of it.
const CONTENT_BOTTOM_PADDING = 56;

interface CreateAccountScreenProps {
  role: Role;
  /** Applied only once the account is actually created, same as on the login screen. */
  onSelectRole: (role: Role) => void;
  onNavigate: (screen: MobileScreen) => void;
  onSuccess?: () => void;
}

export const CreateAccountScreen: React.FC<CreateAccountScreenProps> = ({
  role,
  onSelectRole,
  onNavigate,
  onSuccess,
}) => {
  const { colors } = useTheme();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pickedRole, setPickedRole] = useState<Role>(role);

  const { scrollRef, focusHandlerFor, keyboardPadding } = useKeyboardAwareScroll();
  const nameRef = useRef<TextInput>(null);
  const emailRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);
  const confirmPasswordRef = useRef<TextInput>(null);

  const handleCreate = async () => {
    if (!name.trim()) {
      setError('Please enter your full name.');
      return;
    }
    if (!email.trim() || !password) {
      setError('Please enter email and password.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const res = await signUpWithEmail(name.trim(), email.trim(), password);
      if (!res.ok && res.error) {
        setError(res.error);
      } else if (res.ok) {
        onSelectRole(pickedRole);
        onSuccess?.();
        onNavigate('home');
      }
    } catch (err: any) {
      setError(err?.message ?? 'Registration failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView
      ref={scrollRef}
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={[styles.container, { paddingBottom: CONTENT_BOTTOM_PADDING + keyboardPadding }]}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
        <View style={styles.header}>
          <View style={styles.logoBadge}>
            {/* Same glyph as LoginScreen's badge (assets/icon.svg reproduced in react-native-svg,
                since Metro has no SVG transformer configured) — one logo across both auth screens. */}
            <Svg width={38} height={38} viewBox="0 0 1024 1024">
              <Path d="M 284 284 L 512 512 L 740 740" fill="none" stroke="#FFFFFF" strokeWidth={144} strokeLinecap="round" strokeLinejoin="round" />
              <Path d="M 740 284 L 512 512 L 284 740" fill="none" stroke={palette.mintPresence} strokeWidth={144} strokeLinecap="round" strokeLinejoin="round" />
              <Circle cx={284} cy={284} r={102} fill="#FFFFFF" />
              <Circle cx={740} cy={740} r={102} fill="#FFFFFF" />
              <Circle cx={740} cy={284} r={102} fill={palette.mintPresence} />
              <Circle cx={284} cy={740} r={102} fill={palette.mintPresence} />
              <Circle cx={512} cy={512} r={64} fill="#102A2A" />
              <Circle cx={512} cy={512} r={24} fill="#FFFFFF" />
            </Svg>
          </View>
          <Text style={[styles.title, { color: colors.txt }]}>XConnect</Text>
          <Text style={[styles.subtitle, { color: colors.sub }]}>
            ENTERPRISE PRESENCE PLATFORM
          </Text>
        </View>

        {error ? (
          <View style={styles.errorBanner}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        <View style={styles.form}>
          <View style={styles.inputGroup}>
            <Text style={[styles.inputLabel, { color: colors.sub }]}>FULL NAME</Text>
            <TextInput
              ref={nameRef}
              onFocus={focusHandlerFor(nameRef)}
              style={[
                styles.input,
                {
                  backgroundColor: colors.card,
                  borderColor: colors.border,
                  color: colors.txt,
                },
              ]}
              placeholder="Enter your full name"
              placeholderTextColor={colors.muted}
              value={name}
              onChangeText={setName}
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={[styles.inputLabel, { color: colors.sub }]}>EMAIL ADDRESS</Text>
            <TextInput
              ref={emailRef}
              onFocus={focusHandlerFor(emailRef)}
              style={[
                styles.input,
                {
                  backgroundColor: colors.card,
                  borderColor: colors.border,
                  color: colors.txt,
                },
              ]}
              placeholder="Enter your email"
              placeholderTextColor={colors.muted}
              autoCapitalize="none"
              keyboardType="email-address"
              value={email}
              onChangeText={setEmail}
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={[styles.inputLabel, { color: colors.sub }]}>PASSWORD</Text>
            <TextInput
              ref={passwordRef}
              onFocus={focusHandlerFor(passwordRef)}
              style={[
                styles.input,
                {
                  backgroundColor: colors.card,
                  borderColor: colors.border,
                  color: colors.txt,
                },
              ]}
              placeholder="Enter your password"
              placeholderTextColor={colors.muted}
              secureTextEntry
              value={password}
              onChangeText={setPassword}
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={[styles.inputLabel, { color: colors.sub }]}>CONFIRM PASSWORD</Text>
            <TextInput
              ref={confirmPasswordRef}
              onFocus={focusHandlerFor(confirmPasswordRef)}
              style={[
                styles.input,
                {
                  backgroundColor: colors.card,
                  borderColor: colors.border,
                  color: colors.txt,
                },
              ]}
              placeholder="Confirm your password"
              placeholderTextColor={colors.muted}
              secureTextEntry
              value={confirmPassword}
              onChangeText={setConfirmPassword}
            />
          </View>

          <RolePicker value={pickedRole} onChange={setPickedRole} disabled={busy} />

          <TouchableOpacity
            activeOpacity={0.8}
            onPress={handleCreate}
            disabled={busy}
            style={styles.createButton}
          >
            {busy ? (
              <ActivityIndicator color="#060B12" />
            ) : (
              <Text style={styles.createButtonText}>Create Account</Text>
            )}
          </TouchableOpacity>
        </View>

        <View style={styles.footer}>
          <TouchableOpacity onPress={() => onNavigate('login')}>
            <Text style={[styles.footerText, { color: colors.sub }]}>
              Already have an account?{' '}
              <Text style={{ color: palette.mintPresence, fontWeight: '700' }}>
                Sign In
              </Text>
            </Text>
          </TouchableOpacity>
        </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 24,
    paddingTop: 36,
    paddingBottom: CONTENT_BOTTOM_PADDING,
  },
  header: {
    alignItems: 'center',
    marginBottom: 24,
  },
  logoBadge: {
    width: 60,
    height: 60,
    borderRadius: 18,
    backgroundColor: '#102A2A',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
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
  form: {
    gap: 16,
  },
  inputGroup: {
    gap: 6,
  },
  inputLabel: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  input: {
    paddingHorizontal: 16,
    paddingVertical: 13,
    borderRadius: 14,
    borderWidth: 1.5,
    fontSize: 14,
    fontWeight: '500',
  },
  createButton: {
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
  createButtonText: {
    color: '#060B12',
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
