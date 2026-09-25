import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { MobileScreen, Role } from './BottomNav';

const ROLES: Role[] = ['attendee', 'presenter', 'admin'];

interface DevScreenSwitcherProps {
  currentRole: Role;
  onSelectRole: (role: Role) => void;
  onNavigate: (screen: MobileScreen) => void;
}

// Dev-only: jumps straight to Home under a given role, skipping the real sign-in/onboarding flow.
// Gated by __DEV__ at the App.tsx call site, so this never renders (or ships) in a release build.
// Deliberately just the three roles, not a full screen list — most other screens expect state
// (selected room, fetched members, etc.) that only a real navigation flow sets up, so jumping
// straight to them renders broken/empty. Role + Home is the one jump that's always safe.
export const DevScreenSwitcher: React.FC<DevScreenSwitcherProps> = ({ currentRole, onSelectRole, onNavigate }) => {
  return (
    <View style={styles.bar}>
      {ROLES.map(r => {
        const active = r === currentRole;
        return (
          <TouchableOpacity
            key={r}
            onPress={() => {
              onSelectRole(r);
              onNavigate('home');
            }}
            style={[styles.chip, active && styles.chipActive]}
          >
            <Text style={[styles.chipText, active && styles.chipTextActive]}>{r}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
};

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    justifyContent: 'center',
    backgroundColor: '#111827',
    paddingVertical: 5,
    gap: 6,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 6,
  },
  chipActive: {
    backgroundColor: '#33D1AC',
  },
  chipText: {
    fontSize: 11,
    color: '#94A3B8',
    fontWeight: '600',
  },
  chipTextActive: {
    color: '#0F2F2C',
  },
});
