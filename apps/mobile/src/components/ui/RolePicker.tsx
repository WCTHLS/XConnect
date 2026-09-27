import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useTheme } from '../../theme/useTheme';
import { palette } from '../../theme/colors';
import { Role } from '../navigation/BottomNav';

interface RolePickerProps {
  value: Role;
  onChange: (role: Role) => void;
  disabled?: boolean;
}

const OPTIONS: { role: Role; label: string; blurb: string }[] = [
  { role: 'attendee', label: 'Attendee', blurb: 'Check into the room you are in' },
  { role: 'presenter', label: 'Presenter', blurb: 'Host a room and see who is present' },
  { role: 'admin', label: 'Admin', blurb: 'Monitor every room and pull reports' },
];

/**
 * Chosen at sign-in and fixed for the session — there is no in-app role switch, so this is the
 * only place it gets picked. Admin is offered to everyone because the server, not the app, is
 * what actually enforces it: picking Admin without an admin account just means the admin screens
 * report "This account is not an admin."
 */
export const RolePicker: React.FC<RolePickerProps> = ({ value, onChange, disabled }) => {
  const { colors } = useTheme();

  return (
    <View style={styles.container}>
      <Text style={[styles.label, { color: colors.sub }]}>SIGN IN AS</Text>
      <View style={styles.options}>
        {OPTIONS.map(opt => {
          const selected = opt.role === value;
          return (
            <TouchableOpacity
              key={opt.role}
              activeOpacity={0.85}
              disabled={disabled}
              onPress={() => onChange(opt.role)}
              style={[
                styles.option,
                {
                  backgroundColor: selected ? 'rgba(51,209,172,0.12)' : colors.card,
                  borderColor: selected ? palette.mintPresence : colors.border,
                  opacity: disabled ? 0.6 : 1,
                },
              ]}
            >
              <View
                style={[
                  styles.radio,
                  { borderColor: selected ? palette.mintPresence : colors.border },
                ]}
              >
                {selected && <View style={styles.radioDot} />}
              </View>
              <View style={styles.optionText}>
                <Text
                  style={[
                    styles.optionLabel,
                    { color: selected ? palette.mintPresence : colors.txt },
                  ]}
                >
                  {opt.label}
                </Text>
                <Text style={[styles.optionBlurb, { color: colors.muted }]}>{opt.blurb}</Text>
              </View>
            </TouchableOpacity>
          );
        })}
      </View>
      <Text style={[styles.note, { color: colors.muted }]}>
        You can only change this by signing out.
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    gap: 6,
  },
  label: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  options: {
    gap: 8,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 1.5,
  },
  radio: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: palette.mintPresence,
  },
  optionText: {
    flex: 1,
  },
  optionLabel: {
    fontSize: 14,
    fontWeight: '700',
  },
  optionBlurb: {
    fontSize: 11,
    marginTop: 1,
  },
  note: {
    fontSize: 11,
    marginTop: 2,
  },
});
