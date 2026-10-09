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

const ROLES: { role: Role; label: string }[] = [
  { role: 'attendee', label: 'Attendee' },
  { role: 'presenter', label: 'Presenter' },
  { role: 'admin', label: 'Admin' },
];

const ROLE_BANNERS: Record<
  Role,
  { label: string; bgLight: string; bgDark: string; borderLight: string; borderDark: string; textLight: string; textDark: string }
> = {
  attendee: {
    label: 'Privacy-first · Auto-detect room presence',
    bgLight: '#E0F2FE',
    bgDark: 'rgba(2, 132, 199, 0.15)',
    borderLight: 'rgba(2, 132, 199, 0.3)',
    borderDark: 'rgba(56, 189, 248, 0.3)',
    textLight: '#0284C7',
    textDark: '#38BDF8',
  },
  presenter: {
    label: 'Full room control · Broadcast presence gate',
    bgLight: '#E6F4EA',
    bgDark: 'rgba(5, 150, 105, 0.15)',
    borderLight: 'rgba(5, 150, 105, 0.3)',
    borderDark: 'rgba(52, 211, 153, 0.3)',
    textLight: '#059669',
    textDark: '#34D399',
  },
  admin: {
    label: 'System monitoring · Enterprise administration',
    bgLight: '#F3E8FF',
    bgDark: 'rgba(124, 58, 237, 0.15)',
    borderLight: 'rgba(124, 58, 237, 0.3)',
    borderDark: 'rgba(167, 139, 250, 0.3)',
    textLight: '#7C3AED',
    textDark: '#A78BFA',
  },
};

export const RolePicker: React.FC<RolePickerProps> = ({ value, onChange, disabled }) => {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const banner = ROLE_BANNERS[value];

  return (
    <View style={styles.container}>
      {/* 3-way Segmented Pill Control */}
      <View
        style={[
          styles.segmentedContainer,
          {
            backgroundColor: isDark ? '#141D2B' : '#F1F5F9',
            borderColor: isDark ? '#1E293B' : '#E2E8F0',
          },
        ]}
      >
        {ROLES.map(tab => {
          const active = tab.role === value;
          return (
            <TouchableOpacity
              key={tab.role}
              activeOpacity={0.8}
              disabled={disabled}
              onPress={() => onChange(tab.role)}
              style={[
                styles.segmentTab,
                active && [
                  styles.segmentTabActive,
                  {
                    backgroundColor: isDark ? '#1E293B' : '#FFFFFF',
                  },
                ],
              ]}
            >
              <Text
                style={[
                  styles.segmentText,
                  {
                    color: active
                      ? isDark
                        ? '#FFFFFF'
                        : '#0F172A'
                      : isDark
                      ? '#94A3B8'
                      : '#64748B',
                    fontWeight: active ? '700' : '500',
                  },
                ]}
              >
                {tab.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Dynamic Contextual Pill Banner */}
      <View
        style={[
          styles.contextBanner,
          {
            backgroundColor: isDark ? banner.bgDark : banner.bgLight,
            borderColor: isDark ? banner.borderDark : banner.borderLight,
          },
        ]}
      >
        <Text
          style={[
            styles.contextBannerText,
            { color: isDark ? banner.textDark : banner.textLight },
          ]}
        >
          {banner.label}
        </Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    gap: 12,
  },
  segmentedContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 4,
    borderRadius: 16,
    borderWidth: 1,
  },
  segmentTab: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
  },
  segmentTabActive: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
  segmentText: {
    fontSize: 13,
  },
  contextBanner: {
    paddingVertical: 11,
    paddingHorizontal: 14,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  contextBannerText: {
    fontSize: 12,
    fontWeight: '600',
  },
});

