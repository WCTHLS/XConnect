import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  TouchableWithoutFeedback,
  StyleSheet,
  Modal,
  Animated,
  Easing,
} from 'react-native';
import { useTheme } from '../../theme/useTheme';
import { palette } from '../../theme/colors';

export type AlertButtonStyle = 'default' | 'cancel' | 'destructive';

export interface AppAlertButton {
  text: string;
  style?: AlertButtonStyle;
  onPress?: () => void;
}

interface AlertRequest {
  title: string;
  message?: string;
  buttons: AppAlertButton[];
}

// The host registers itself here on mount. Keeping the queue outside React means an alert can be
// raised from anywhere (async handlers, services) exactly like RN's Alert, without every caller
// needing a hook or a context.
let enqueue: ((request: AlertRequest) => void) | null = null;
const pending: AlertRequest[] = [];

/**
 * Drop-in replacement for react-native's `Alert.alert` that renders in the app's own theme.
 * Same call signature, so migrating a call site is just swapping the identifier.
 */
export const AppAlert = {
  alert(title: string, message?: string, buttons?: AppAlertButton[]) {
    const request: AlertRequest = {
      title,
      message,
      buttons: buttons && buttons.length > 0 ? buttons : [{ text: 'OK' }],
    };
    // Raised before the host mounted (or during a reload): hold it rather than dropping it.
    if (enqueue) enqueue(request);
    else pending.push(request);
  },
};

/** Mount once, above everything else. Renders whichever alert is at the front of the queue. */
export const AppAlertHost: React.FC = () => {
  const { colors } = useTheme();
  const [queue, setQueue] = useState<AlertRequest[]>([]);
  const fade = useRef(new Animated.Value(0)).current;
  const lift = useRef(new Animated.Value(12)).current;

  useEffect(() => {
    enqueue = request => setQueue(q => [...q, request]);
    if (pending.length > 0) {
      setQueue(q => [...q, ...pending.splice(0, pending.length)]);
    }
    return () => {
      enqueue = null;
    };
  }, []);

  const current = queue[0];

  useEffect(() => {
    if (!current) return;
    fade.setValue(0);
    lift.setValue(12);
    Animated.parallel([
      Animated.timing(fade, {
        toValue: 1,
        duration: 160,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(lift, {
        toValue: 0,
        duration: 200,
        easing: Easing.bezier(0.22, 1, 0.36, 1),
        useNativeDriver: true,
      }),
    ]).start();
  }, [current, fade, lift]);

  if (!current) return null;

  const dismiss = (button?: AppAlertButton) => {
    setQueue(q => q.slice(1));
    // After the close, so a handler that raises another alert queues behind this one instead of
    // being wiped by the slice above.
    button?.onPress?.();
  };

  const cancelButton = current.buttons.find(b => b.style === 'cancel');
  // Two buttons sit side by side; three or more stack, since they won't read cleanly in a row.
  const stacked = current.buttons.length > 2;

  const buttonColors = (style: AlertButtonStyle | undefined) => {
    if (style === 'destructive') {
      return { background: palette.roseError, border: palette.roseError, text: '#FFFFFF' };
    }
    if (style === 'cancel') {
      return { background: 'transparent', border: colors.border, text: colors.sub };
    }
    return { background: palette.mintPresence, border: palette.mintPresence, text: '#0F2F2C' };
  };

  return (
    <Modal transparent animationType="none" visible onRequestClose={() => dismiss(cancelButton)}>
      {/* Tapping outside only dismisses when there's an explicit cancel, so a decision the user
          has to make can't be silently skipped by a stray tap. */}
      <TouchableWithoutFeedback onPress={() => cancelButton && dismiss(cancelButton)}>
        <Animated.View style={[styles.backdrop, { opacity: fade }]}>
          <TouchableWithoutFeedback onPress={() => {}}>
            <Animated.View
              style={[
                styles.card,
                {
                  backgroundColor: colors.card,
                  borderColor: colors.border,
                  opacity: fade,
                  transform: [{ translateY: lift }],
                },
              ]}
            >
              <Text style={[styles.title, { color: colors.txt }]}>{current.title}</Text>
              {current.message ? (
                <Text style={[styles.message, { color: colors.muted }]}>{current.message}</Text>
              ) : null}

              <View style={[styles.buttonRow, stacked && styles.buttonColumn]}>
                {current.buttons.map((button, i) => {
                  const c = buttonColors(button.style);
                  return (
                    <TouchableOpacity
                      key={`${button.text}-${i}`}
                      activeOpacity={0.85}
                      onPress={() => dismiss(button)}
                      style={[
                        styles.button,
                        stacked ? styles.buttonStacked : styles.buttonInRow,
                        { backgroundColor: c.background, borderColor: c.border },
                      ]}
                    >
                      <Text style={[styles.buttonText, { color: c.text }]}>{button.text}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </Animated.View>
          </TouchableWithoutFeedback>
        </Animated.View>
      </TouchableWithoutFeedback>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(6,11,18,0.62)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  card: {
    width: '100%',
    maxWidth: 380,
    borderRadius: 20,
    borderWidth: 1.5,
    paddingHorizontal: 22,
    paddingTop: 22,
    paddingBottom: 18,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.28,
    shadowRadius: 20,
    elevation: 12,
  },
  title: {
    fontSize: 17,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  message: {
    fontSize: 13,
    lineHeight: 20,
    marginTop: 8,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 20,
  },
  buttonColumn: {
    // Rendered in the order the caller passed them, rather than reordered to any platform
    // convention — a custom dialog silently reshuffling buttons is how people mis-tap.
    flexDirection: 'column',
  },
  button: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 13,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonInRow: {
    flex: 1,
  },
  buttonStacked: {
    width: '100%',
  },
  buttonText: {
    fontSize: 14,
    fontWeight: '800',
  },
});
