import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Dimensions } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { useTheme } from '../../theme/useTheme';
import { palette } from '../../theme/colors';
import { MobileScreen } from '../../components/navigation/BottomNav';

interface OnboardingScreenProps {
  onNavigate: (screen: MobileScreen) => void;
}

const SLIDES = [
  {
    icon: (color: string) => (
      <Svg width={44} height={44} viewBox="0 0 48 48" fill="none">
        <Circle cx={16} cy={24} r={6} stroke="#38BDF8" strokeWidth={2} />
        <Circle cx={32} cy={24} r={6} stroke="#38BDF8" strokeWidth={2} />
        <Path d="M22 24h4" stroke="#38BDF8" strokeWidth={2} strokeDasharray="2 2" />
        <Circle cx={16} cy={24} r={12} stroke="#38BDF8" strokeWidth={1} opacity={0.3} strokeDasharray="3 3" />
        <Circle cx={32} cy={24} r={12} stroke="#38BDF8" strokeWidth={1} opacity={0.3} strokeDasharray="3 3" />
      </Svg>
    ),
    color: '#38BDF8',
    title: 'Peer-to-Peer BLE Mesh',
    body: 'Your phone silently exchanges ephemeral Bluetooth tokens with nearby devices every 60 seconds, forming a real-time proximity graph — no infrastructure required.',
  },
  {
    icon: (color: string) => (
      <Svg width={44} height={44} viewBox="0 0 48 48" fill="none">
        <Rect x={8} y={8} width={32} height={32} rx={4} stroke="#2DD4BF" strokeWidth={2} />
        <Path d="M8 24h8M32 24h8M24 8v8M24 32v8" stroke="#2DD4BF" strokeWidth={2} strokeLinecap="round" />
        <Circle cx={24} cy={24} r={6} fill="#2DD4BF" fillOpacity={0.2} stroke="#2DD4BF" strokeWidth={2} />
      </Svg>
    ),
    color: '#2DD4BF',
    title: 'Ultrasonic Acoustic Gate',
    body: "Inaudible 18.5–19.5 kHz tones emitted by the presenter's phone. Ultrasound cannot pass through drywall or glass — delivering 99% audit-grade in-room certainty.",
  },
  {
    icon: (color: string) => (
      <Svg width={44} height={44} viewBox="0 0 48 48" fill="none">
        <Rect x={10} y={16} width={28} height={20} rx={4} stroke="#33D1AC" strokeWidth={2} />
        <Path d="M18 16v-4a6 6 0 0112 0v4" stroke="#33D1AC" strokeWidth={2} strokeLinecap="round" />
        <Circle cx={24} cy={26} r={3} fill="#33D1AC" />
        <Path d="M24 29v4" stroke="#33D1AC" strokeWidth={2} strokeLinecap="round" />
      </Svg>
    ),
    color: '#33D1AC',
    title: 'Zero Hardware Required',
    body: "No beacons. No NFC gates. No QR codes. No GPS. XConnect fuses your phone's existing sensors into a secure, automatic, enterprise-grade attendance system.",
  },
];

export const OnboardingScreen: React.FC<OnboardingScreenProps> = ({ onNavigate }) => {
  const { colors } = useTheme();
  const [slide, setSlide] = useState(0);

  const current = SLIDES[slide];

  const handleNext = () => {
    if (slide < SLIDES.length - 1) {
      setSlide(s => s + 1);
    } else {
      onNavigate('permissions');
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.surf }]}>
      {/* Center Slide Content */}
      <View style={styles.centerContent}>
        <View
          style={[
            styles.iconWrapper,
            {
              backgroundColor: `${current.color}14`,
              borderColor: `${current.color}40`,
            },
          ]}
        >
          {current.icon(current.color)}
        </View>

        <Text style={[styles.title, { color: colors.txt }]}>
          {current.title}
        </Text>
        <Text style={[styles.body, { color: colors.sub }]}>
          {current.body}
        </Text>
      </View>

      {/* Bottom Controls */}
      <View style={styles.footer}>
        <View style={styles.dotsRow}>
          {SLIDES.map((s, i) => (
            <TouchableOpacity
              key={i}
              onPress={() => setSlide(i)}
              style={[
                styles.dot,
                {
                  width: i === slide ? 24 : 8,
                  backgroundColor: i === slide ? s.color : colors.border,
                },
              ]}
            />
          ))}
        </View>

        <TouchableOpacity
          activeOpacity={0.85}
          onPress={handleNext}
          style={[styles.nextButton, { backgroundColor: current.color }]}
        >
          <Text style={styles.nextButtonText}>
            {slide < SLIDES.length - 1 ? 'Next' : "Let's Go"}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'space-between',
    paddingHorizontal: 28,
    paddingTop: 40,
    paddingBottom: 44,
  },
  centerContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  iconWrapper: {
    width: 96,
    height: 96,
    borderRadius: 24,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 32,
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    letterSpacing: -0.5,
    textAlign: 'center',
    marginBottom: 14,
  },
  body: {
    fontSize: 15,
    lineHeight: 24,
    textAlign: 'center',
    maxWidth: 290,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  dotsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  dot: {
    height: 8,
    borderRadius: 4,
  },
  nextButton: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 999,
  },
  nextButtonText: {
    color: '#0B0F17',
    fontSize: 14,
    fontWeight: '700',
  },
});
