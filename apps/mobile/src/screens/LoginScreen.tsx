import { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from "react-native";
import { GoogleLogo, MicrosoftLogo } from "../components/BrandIcons";
import {
  emailSignInAvailable,
  googleSignInAvailable,
  microsoftSignInAvailable,
  sendPasswordReset,
  signInWithEmail,
  signInWithGoogle,
  signInWithMicrosoft,
  signUpWithEmail
} from "../services/auth";

export function LoginScreen() {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const run = async (action: () => Promise<{ ok: boolean; error?: string }>) => {
    setBusy(true);
    setError(null);
    setInfo(null);
    const result = await action();
    if (!result.ok && result.error) setError(result.error);
    setBusy(false);
    return result;
  };

  const submit = () => {
    if (!emailSignInAvailable) return;
    if (!email.trim() || !password) {
      setError("Enter your email and password.");
      return;
    }
    if (mode === "signup" && !name.trim()) {
      setError("Enter your name.");
      return;
    }
    void run(() => (mode === "signup" ? signUpWithEmail(name, email, password) : signInWithEmail(email, password)));
  };

  const forgotPassword = async () => {
    if (!email.trim()) {
      setError("Enter your email above first.");
      return;
    }
    const result = await run(() => sendPasswordReset(email));
    if (result.ok) setInfo("Password reset email sent. Check your inbox.");
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
        <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
          <Text style={styles.title}>XConnect</Text>
          <Text style={styles.subtitle}>Sign in to join rooms and track your attendance.</Text>

          {googleSignInAvailable && (
            <TouchableOpacity style={styles.socialButton} onPress={() => void run(signInWithGoogle)} disabled={busy} activeOpacity={0.8}>
              <View style={styles.socialButtonIcon}>
                <GoogleLogo size={18} />
              </View>
              <Text style={styles.socialButtonText}>Continue with Google</Text>
            </TouchableOpacity>
          )}
          {microsoftSignInAvailable && (
            <TouchableOpacity style={styles.socialButton} onPress={() => void run(signInWithMicrosoft)} disabled={busy} activeOpacity={0.8}>
              <View style={styles.socialButtonIcon}>
                <MicrosoftLogo size={18} />
              </View>
              <Text style={styles.socialButtonText}>Continue with Microsoft</Text>
            </TouchableOpacity>
          )}

          {emailSignInAvailable && (
            <>
              {(googleSignInAvailable || microsoftSignInAvailable) && <Text style={styles.divider}>or</Text>}

              {mode === "signup" && (
                <TextInput
                  style={styles.input}
                  value={name}
                  onChangeText={setName}
                  placeholder="Your name"
                  placeholderTextColor="#8C9BA5"
                  autoCapitalize="words"
                />
              )}
              <TextInput
                style={styles.input}
                value={email}
                onChangeText={setEmail}
                placeholder="Email"
                placeholderTextColor="#8C9BA5"
                autoCapitalize="none"
                keyboardType="email-address"
                autoCorrect={false}
              />
              <TextInput
                style={styles.input}
                value={password}
                onChangeText={setPassword}
                placeholder="Password"
                placeholderTextColor="#8C9BA5"
                secureTextEntry
                autoCapitalize="none"
                onSubmitEditing={submit}
              />

              <TouchableOpacity style={styles.button} onPress={submit} disabled={busy} activeOpacity={0.8}>
                {busy ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.buttonText}>{mode === "signup" ? "Create account" : "Sign in"}</Text>}
              </TouchableOpacity>

              {mode === "signin" && (
                <TouchableOpacity onPress={forgotPassword} disabled={busy} activeOpacity={0.7}>
                  <Text style={styles.link}>Forgot password?</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                onPress={() => {
                  setMode(mode === "signin" ? "signup" : "signin");
                  setError(null);
                  setInfo(null);
                }}
                activeOpacity={0.7}
              >
                <Text style={styles.link}>{mode === "signin" ? "New here? Create an account" : "Already have an account? Sign in"}</Text>
              </TouchableOpacity>
            </>
          )}

          {error && <Text style={styles.error}>{error}</Text>}
          {info && <Text style={styles.info}>{info}</Text>}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: "#F4F7F9" },
  container: { flexGrow: 1, justifyContent: "center", padding: 28 },
  title: { fontSize: 32, fontWeight: "800", color: "#173A63", textAlign: "center" },
  subtitle: { fontSize: 15, color: "#4A5A66", textAlign: "center", marginTop: 8, marginBottom: 28 },
  input: {
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#D5DCE1",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: "#173A63",
    marginBottom: 12
  },
  button: { backgroundColor: "#126D7A", borderRadius: 10, paddingVertical: 15, alignItems: "center", marginTop: 4 },
  buttonText: { color: "#FFFFFF", fontSize: 16, fontWeight: "700" },
  socialButton: {
    flexDirection: "row",
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#D5DCE1",
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 10
  },
  socialButtonIcon: { marginRight: 10 },
  socialButtonText: { color: "#173A63", fontSize: 16, fontWeight: "700" },
  divider: { textAlign: "center", color: "#75808A", marginVertical: 10, fontSize: 13 },
  link: { color: "#126D7A", fontSize: 14, textAlign: "center", marginTop: 16, fontWeight: "600" },
  hint: { fontSize: 13, color: "#75808A", textAlign: "center", marginTop: 14 },
  error: { fontSize: 14, color: "#B3261E", textAlign: "center", marginTop: 18 },
  info: { fontSize: 14, color: "#1B6E3C", textAlign: "center", marginTop: 18 }
});
