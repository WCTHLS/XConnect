import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { useTheme } from '../../theme/useTheme';
import { palette } from '../../theme/colors';

export type MobileScreen =
  | 'launch'
  | 'onboarding'
  | 'permissions'
  | 'login'
  | 'createAccount'
  | 'home'
  | 'profile'
  | 'presenterSetup'
  | 'presenterDashboard'
  | 'presenterRoster'
  | 'sessionEnd'
  | 'attendeeDiscovery'
  | 'attendeeConfirmed'
  | 'attendeeOutOfRange'
  | 'adminOverview'
  | 'adminRoomDetail'
  | 'diagnostics'
  | 'edgeState';

export type Role = 'attendee' | 'presenter' | 'admin';

interface BottomNavProps {
  currentScreen: MobileScreen;
  onNavigate: (screen: MobileScreen) => void;
  role: Role;
}

interface NavTab {
  label: string;
  target: MobileScreen;
  icon: (active: boolean, color: string) => React.ReactElement;
}

export const BottomNav: React.FC<BottomNavProps> = ({
  currentScreen,
  onNavigate,
  role,
}) => {
  const { colors, theme } = useTheme();
  const isDark = theme === 'dark';
  const em = palette.mintPresence;
  const inactiveColor = isDark ? '#94A3B8' : '#0F2F2C';

  const radarIcon = (active: boolean, c: string) => (
    <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
      <Circle
        cx={12}
        cy={12}
        r={3}
        fill={active ? em : 'none'}
        stroke={active ? em : c}
        strokeWidth={2}
      />
      <Circle
        cx={12}
        cy={12}
        r={7}
        stroke={active ? em : c}
        strokeWidth={1.5}
        strokeDasharray="3 2"
        opacity={active ? 1 : 0.6}
      />
      <Circle
        cx={12}
        cy={12}
        r={11}
        stroke={active ? em : c}
        strokeWidth={1}
        strokeDasharray="2 3"
        opacity={active ? 0.6 : 0.35}
      />
    </Svg>
  );

  const clockIcon = (active: boolean, c: string) => (
    <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
      <Circle cx={12} cy={12} r={10} stroke={active ? em : c} strokeWidth={2} />
      <Path
        d="M12 6v6l4 2"
        stroke={active ? em : c}
        strokeWidth={2}
        strokeLinecap="round"
      />
    </Svg>
  );

  const profileIcon = (active: boolean, c: string) => (
    <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
      <Circle
        cx={12}
        cy={8}
        r={4}
        stroke={active ? em : c}
        strokeWidth={2}
        fill={active ? 'rgba(51,209,172,0.18)' : 'none'}
      />
      <Path
        d="M4 20c0-4 3.6-7 8-7s8 3 8 7"
        stroke={active ? em : c}
        strokeWidth={2}
        strokeLinecap="round"
      />
    </Svg>
  );

  const usersIcon = (active: boolean, c: string) => (
    <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
      <Circle cx={9} cy={7} r={3.5} stroke={active ? em : c} strokeWidth={2} />
      <Path
        d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"
        stroke={active ? em : c}
        strokeWidth={2}
        strokeLinecap="round"
      />
      <Circle cx={17} cy={7} r={2.5} stroke={active ? em : c} strokeWidth={1.5} />
      <Path
        d="M21 20c0-2.8-1.8-5-4-5"
        stroke={active ? em : c}
        strokeWidth={1.5}
        strokeLinecap="round"
      />
    </Svg>
  );

  const chartIcon = (active: boolean, c: string) => (
    <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
      <Rect
        x={3}
        y={12}
        width={4}
        height={9}
        rx={1}
        fill={active ? 'rgba(51,209,172,0.2)' : 'none'}
        stroke={active ? em : c}
        strokeWidth={2}
      />
      <Rect
        x={10}
        y={7}
        width={4}
        height={14}
        rx={1}
        fill={active ? 'rgba(51,209,172,0.2)' : 'none'}
        stroke={active ? em : c}
        strokeWidth={2}
      />
      <Rect
        x={17}
        y={3}
        width={4}
        height={18}
        rx={1}
        fill={active ? 'rgba(51,209,172,0.2)' : 'none'}
        stroke={active ? em : c}
        strokeWidth={2}
      />
    </Svg>
  );

  const monitorIcon = (active: boolean, c: string) => (
    <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
      <Path
        d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"
        stroke={active ? em : c}
        strokeWidth={2}
        strokeLinejoin="round"
        fill={active ? 'rgba(51,209,172,0.18)' : 'none'}
      />
      <Path
        d="M8 12l3 3 5-6"
        stroke={active ? em : c}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );

  const attendeeTabs: NavTab[] = [
    { label: 'Home', target: 'home', icon: radarIcon },
    { label: 'My Activity', target: 'attendeeConfirmed', icon: clockIcon },
    { label: 'Profile', target: 'profile', icon: profileIcon },
  ];

  const presenterTabs: NavTab[] = [
    { label: 'Home', target: 'home', icon: radarIcon },
    { label: 'Roster', target: 'presenterRoster', icon: usersIcon },
    { label: 'Analysis', target: 'sessionEnd', icon: chartIcon },
    { label: 'Profile', target: 'profile', icon: profileIcon },
  ];

  const adminTabs: NavTab[] = [
    { label: 'Monitor', target: 'adminOverview', icon: monitorIcon },
    { label: 'Diagnostics', target: 'diagnostics', icon: chartIcon },
    { label: 'Profile', target: 'profile', icon: profileIcon },
  ];

  const tabs =
    role === 'attendee'
      ? attendeeTabs
      : role === 'presenter'
      ? presenterTabs
      : adminTabs;

  const isTabActive = (target: MobileScreen) => {
    if (target === currentScreen) return true;
    if (
      target === 'home' &&
      (currentScreen === 'attendeeDiscovery' ||
        currentScreen === 'attendeeOutOfRange' ||
        currentScreen === 'presenterSetup' ||
        currentScreen === 'presenterDashboard')
    )
      return true;
    if (
      target === 'adminOverview' &&
      (currentScreen === 'adminRoomDetail' || currentScreen === 'edgeState')
    )
      return true;
    return false;
  };

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: colors.navBg,
          borderTopColor: colors.navBorder,
        },
      ]}
    >
      {tabs.map((tab, i) => {
        const active = isTabActive(tab.target);
        return (
          <TouchableOpacity
            key={i}
            activeOpacity={0.7}
            onPress={() => onNavigate(tab.target)}
            style={styles.tabItem}
          >
            <View
              style={[
                styles.iconWrapper,
                {
                  backgroundColor: active ? 'rgba(51,209,172,0.18)' : 'transparent',
                },
              ]}
            >
              {tab.icon(active, inactiveColor)}
            </View>
            <Text
              style={[
                styles.tabLabel,
                {
                  color: active ? em : inactiveColor,
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
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    borderTopWidth: 1,
    paddingTop: 6,
    paddingBottom: 12,
  },
  tabItem: {
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
  },
  iconWrapper: {
    paddingHorizontal: 16,
    paddingVertical: 4,
    borderRadius: 999,
  },
  tabLabel: {
    fontSize: 10,
    marginTop: 2,
  },
});
