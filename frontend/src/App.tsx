import React, { useState, useEffect, useCallback } from 'react'
import xLogoSrc from './assets/x-logo.png'
import xConnectLogoSrc from './assets/xconnect-logo.png'

// ─── Types ───────────────────────────────────────────────────────────────────

type Screen =
  | 'launch' | 'onboarding' | 'permissions' | 'login' | 'createAccount'
  | 'home' | 'profile'
  | 'presenterSetup' | 'presenterDashboard' | 'presenterRoster' | 'sessionEnd'
  | 'attendeeDiscovery' | 'attendeeConfirmed' | 'attendeeOutOfRange'
  | 'adminOverview' | 'adminRoomDetail' | 'diagnostics' | 'edgeState'

type Theme = 'dark' | 'light'
type Role = 'attendee' | 'presenter' | 'admin'

interface RoomData {
  name: string
  anchor: string
  count: number
  peak: number
  health: 'green' | 'amber'
  since: string
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const dk = '#0F2F2C'
const card = (t: Theme) => t === 'dark' ? '#131C2E' : '#FFFFFF'
const bdr = (t: Theme) => t === 'dark' ? '#22314E' : '#E2E8F0'
const txt = (t: Theme) => t === 'dark' ? '#F8FAFC' : '#0F172A'
const sub = (t: Theme) => t === 'dark' ? '#94A3B8' : '#475569'
const muted = (t: Theme) => t === 'dark' ? '#64748B' : '#94A3B8'
const surf = (t: Theme) => t === 'dark' ? dk : '#F8FAFC'

const NAV_SCREENS: Screen[] = [
  'home', 'profile', 'presenterSetup', 'presenterDashboard', 'presenterRoster',
  'sessionEnd', 'attendeeDiscovery', 'attendeeConfirmed', 'attendeeOutOfRange',
  'adminOverview', 'adminRoomDetail', 'edgeState',
]


// ─── Shared Components ───────────────────────────────────────────────────────

function LivingRadar({ theme, scanning = false, participantCount = 6 }: {
  theme: Theme; scanning?: boolean; participantCount?: number
}) {
  const nodes = [
    { x: 42, y: 28, initials: 'AK', verified: true },
    { x: 68, y: 52, initials: 'MR', verified: true },
    { x: 30, y: 62, initials: 'JP', verified: false },
    { x: 72, y: 30, initials: 'SL', verified: true },
    { x: 22, y: 42, initials: 'BC', verified: true },
    { x: 58, y: 72, initials: 'TW', verified: true },
  ].slice(0, Math.min(participantCount, 6))

  const ringColor = scanning ? '#0284C7' : '#33D1AC'
  const coreGlow = scanning
    ? 'radial-gradient(circle, rgba(2,132,199,0.5) 0%, rgba(2,132,199,0.08) 70%)'
    : 'radial-gradient(circle, rgba(51,209,172,0.5) 0%, rgba(51,209,172,0.08) 70%)'

  return (
    <div className="relative mx-auto" style={{ width: '260px', height: '260px' }}>
      {[0, 1, 2].map(i => (
        <div key={i} className="absolute inset-0 rounded-full" style={{
          border: `1.5px solid ${ringColor}`,
          opacity: 0,
          animation: `radar-pulse 2.4s ease-out ${i * 0.8}s infinite`,
        }} />
      ))}
      {[85, 60, 35].map((pct, i) => (
        <div key={i} className="absolute rounded-full" style={{
          width: `${pct}%`, height: `${pct}%`,
          top: `${(100 - pct) / 2}%`, left: `${(100 - pct) / 2}%`,
          border: `1px solid ${theme === 'dark' ? 'rgba(34,49,71,0.8)' : 'rgba(226,232,240,0.8)'}`,
        }} />
      ))}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div style={{ position: 'absolute', width: '100%', height: '1px', background: theme === 'dark' ? 'rgba(34,49,71,0.6)' : 'rgba(226,232,240,0.6)' }} />
        <div style={{ position: 'absolute', width: '1px', height: '100%', background: theme === 'dark' ? 'rgba(34,49,71,0.6)' : 'rgba(226,232,240,0.6)' }} />
      </div>
      {scanning && (
        <div className="absolute inset-0 rounded-full overflow-hidden" style={{ animation: 'spin-slow 3s linear infinite' }}>
          <div style={{
            position: 'absolute', top: '50%', left: '50%',
            width: '50%', height: '2px', transformOrigin: '0 50%',
            background: 'linear-gradient(to right, transparent, rgba(56,189,248,0.8))',
          }} />
        </div>
      )}
      {!scanning && nodes.map((node, i) => (
        <div key={i} className="absolute flex items-center justify-center rounded-full font-bold" style={{
          left: `${node.x}%`, top: `${node.y}%`,
          width: '30px', height: '30px',
          transform: 'translate(-50%, -50%)',
          background: node.verified ? 'rgba(51,209,172,0.18)' : 'rgba(56,189,248,0.18)',
          border: `1.5px solid ${node.verified ? '#33D1AC' : '#38BDF8'}`,
          color: node.verified ? '#33D1AC' : '#38BDF8',
          fontSize: '10px',
          animation: `float ${2.2 + i * 0.35}s ease-in-out infinite`,
          animationDelay: `${i * 0.2}s`,
          boxShadow: `0 0 10px ${node.verified ? 'rgba(51,209,172,0.3)' : 'rgba(56,189,248,0.3)'}`,
        }}>{node.initials}</div>
      ))}
      <div className="absolute rounded-full flex items-center justify-center" style={{
        width: '54px', height: '54px',
        top: '50%', left: '50%',
        transform: 'translate(-50%, -50%)',
        background: coreGlow,
        border: `2px solid ${ringColor}`,
        boxShadow: `0 0 24px ${scanning ? 'rgba(56,189,248,0.45)' : 'rgba(51,209,172,0.45)'}`,
      }}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="3.5" fill={ringColor} />
          <circle cx="12" cy="12" r="7" stroke={ringColor} strokeWidth="1.2" strokeDasharray="2.5 2" opacity="0.55" />
        </svg>
      </div>
      <div className="absolute left-1/2" style={{
        bottom: '-28px', transform: 'translateX(-50%)',
        background: theme === 'dark' ? 'rgba(19,28,46,0.92)' : 'rgba(255,255,255,0.92)',
        border: `1px solid ${scanning ? '#0284C7' : '#33D1AC'}`,
        color: scanning ? '#38BDF8' : '#33D1AC',
        borderRadius: '999px', padding: '4px 12px',
        fontSize: '10px', fontWeight: 700,
        letterSpacing: '0.04em', whiteSpace: 'nowrap',
        backdropFilter: 'blur(8px)',
      }}>
        {scanning ? 'Scanning Ambient Space...' : 'Acoustic Gate Verified · 99% Confidence'}
      </div>
    </div>
  )
}

function SensorPill({ label, status }: { label: string; status: 'active' | 'warn' | 'error' | 'off' }) {
  const c = status === 'active' ? '#33D1AC' : status === 'warn' ? '#F59E0B' : status === 'error' ? '#EF4444' : '#64748B'
  return (
    <div className="flex items-center gap-1 rounded-full px-2 py-0.5" style={{
      background: `${c}18`, border: `1px solid ${c}45`,
    }}>
      <div className="w-1.5 h-1.5 rounded-full" style={{ background: c }} />
      <span style={{ color: c, fontSize: '9px', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', fontFamily: "'JetBrains Mono', monospace" }}>{label}</span>
    </div>
  )
}

function LiveBadge({ label = 'LIVE IN-ROOM' }: { label?: string }) {
  return (
    <div className="inline-flex items-center gap-1.5 rounded-full px-3 py-1" style={{
      background: 'rgba(51,209,172,0.12)', border: '1px solid rgba(51,209,172,0.35)',
    }}>
      <div className="w-2 h-2 rounded-full" style={{ background: '#33D1AC', animation: 'live-dot 1.4s ease-in-out infinite' }} />
      <span style={{ color: '#33D1AC', fontSize: '10px', fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', fontFamily: "'JetBrains Mono', monospace" }}>{label}</span>
    </div>
  )
}

function PingDot({ color }: { color: string }) {
  return (
    <span className="relative inline-flex">
      <span className="absolute inline-flex w-full h-full rounded-full" style={{ background: color, opacity: 0.55, animation: 'ping 1.4s cubic-bezier(0,0,0.2,1) infinite' }} />
      <span className="relative inline-flex w-2.5 h-2.5 rounded-full" style={{ background: color }} />
    </span>
  )
}

function HeroCounter({ value, theme }: { value: number; theme: Theme }) {
  const [displayed, setDisplayed] = useState(value)
  const [rolling, setRolling] = useState(false)

  useEffect(() => {
    if (value !== displayed) {
      setRolling(true)
      const t = setTimeout(() => { setDisplayed(value); setRolling(false) }, 420)
      return () => clearTimeout(t)
    }
  }, [value, displayed])

  return (
    <div style={{ overflow: 'hidden', height: '74px', position: 'relative' }}>
      <div style={{
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: '68px', fontWeight: 700,
        color: txt(theme), lineHeight: '74px',
        letterSpacing: '-3px',
        animation: rolling ? 'counter-roll 0.42s ease-in-out' : 'none',
      }}>{displayed}</div>
    </div>
  )
}

function ParticipantCard({ theme, name, role, dwell, ultraVerified = true, wifiMatch, bleActive = true, motionFlag = false }: {
  theme: Theme; name: string; role: 'Host' | 'Attendee'; dwell: string;
  ultraVerified?: boolean; wifiMatch?: string; bleActive?: boolean; motionFlag?: boolean
}) {
  const initials = name.split(' ').map(n => n[0]).join('')
  const isHost = role === 'Host'
  return (
    <div className="rounded-xl p-3 mb-2" style={{ background: card(theme), border: `1px solid ${bdr(theme)}` }}>
      <div className="flex items-center gap-3 mb-2">
        <div className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0" style={{
          background: isHost ? 'rgba(51,209,172,0.18)' : 'rgba(56,189,248,0.15)',
          color: isHost ? '#33D1AC' : '#38BDF8',
          border: `1px solid ${isHost ? 'rgba(51,209,172,0.4)' : 'rgba(56,189,248,0.3)'}`,
        }}>{initials}</div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold truncate" style={{ color: txt(theme) }}>{name}</span>
            <span className="rounded-full px-1.5 py-0.5" style={{
              background: isHost ? 'rgba(51,209,172,0.12)' : 'rgba(100,116,139,0.12)',
              color: isHost ? '#33D1AC' : sub(theme),
              fontSize: '9px', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
            }}>{role}</span>
          </div>
          <div className="flex items-center gap-1 mt-0.5">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="#64748B" strokeWidth="2"/><path d="M12 6v6l4 2" stroke="#64748B" strokeWidth="2" strokeLinecap="round"/></svg>
            <span style={{ color: muted(theme), fontSize: '11px', fontFamily: "'JetBrains Mono', monospace" }}>{dwell}</span>
          </div>
        </div>
        <div className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(51,209,172,0.15)' }}>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none"><path d="M5 13l4 4L19 7" stroke="#33D1AC" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
        </div>
      </div>
      <div className="flex flex-wrap gap-1">
        {ultraVerified && <span className="rounded-full px-2 py-0.5" style={{ background: 'rgba(45,212,191,0.1)', color: '#2DD4BF', fontSize: '10px', fontWeight: 600 }}>🔊 Ultrasonic Verified</span>}
        {wifiMatch && <span className="rounded-full px-2 py-0.5" style={{ background: 'rgba(51,209,172,0.1)', color: '#33D1AC', fontSize: '10px', fontWeight: 600 }}>Wi-Fi {wifiMatch}</span>}
        {bleActive && <span className="rounded-full px-2 py-0.5" style={{ background: 'rgba(56,189,248,0.1)', color: '#38BDF8', fontSize: '10px', fontWeight: 600 }}>BLE Mesh Active</span>}
        {motionFlag && <span className="rounded-full px-2 py-0.5" style={{ background: 'rgba(245,158,11,0.1)', color: '#F59E0B', fontSize: '10px', fontWeight: 600 }}>⚠ Inactivity Flag</span>}
      </div>
    </div>
  )
}

function RoomChip({ label, active, theme, onClick }: { label: string; active: boolean; theme: Theme; onClick?: () => void }) {
  return (
    <button onClick={onClick} className="rounded-full px-4 py-1.5 text-sm font-semibold whitespace-nowrap flex-shrink-0 transition-all" style={{
      background: active ? 'rgba(51,209,172,0.18)' : (theme === 'dark' ? 'rgba(34,49,71,0.5)' : 'rgba(226,232,240,0.5)'),
      border: active ? '1.5px solid #33D1AC' : `1.5px solid ${bdr(theme)}`,
      color: active ? '#33D1AC' : sub(theme),
      boxShadow: active ? '0 0 12px rgba(51,209,172,0.2)' : 'none',
      fontSize: '13px',
    }}>{label}</button>
  )
}

function TopBar({ theme, title, subtitle, onBack, onSettings }: {
  theme: Theme; title: string; subtitle?: string;
  onBack?: () => void; onSettings?: () => void
}) {
  return (
    <div className="flex items-center gap-3 px-5 pt-4 pb-3 flex-shrink-0">
      {onBack && (
        <button onClick={onBack} className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: theme === 'dark' ? 'rgba(34,49,71,0.5)' : 'rgba(226,232,240,0.5)' }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M15 18l-6-6 6-6" stroke={sub(theme)} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
        </button>
      )}
      <div className="flex-1 min-w-0">
        <h2 className="font-bold truncate" style={{ color: txt(theme), fontSize: '17px', letterSpacing: '-0.3px' }}>{title}</h2>
        {subtitle && <p className="truncate" style={{ color: muted(theme), fontSize: '12px', fontFamily: "'JetBrains Mono', monospace" }}>{subtitle}</p>}
      </div>
      {onSettings && (
        <button onClick={onSettings} className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: theme === 'dark' ? 'rgba(34,49,71,0.5)' : 'rgba(226,232,240,0.5)' }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="3" stroke={sub(theme)} strokeWidth="2"/><path d="M12 2v2m0 16v2M4.22 4.22l1.42 1.42m12.72 12.72l1.42 1.42M2 12h2m16 0h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" stroke={sub(theme)} strokeWidth="2" strokeLinecap="round"/></svg>
        </button>
      )}
    </div>
  )
}

// ─── Bottom Navigation ────────────────────────────────────────────────────────

type NavTab = { label: string; target: Screen; icon: (active: boolean) => React.ReactElement }

function BottomNav({ theme, screen, nav, role }: { theme: Theme; screen: Screen; nav: (s: Screen) => void; role: Role }) {
  const em = '#33D1AC'
  const navBg = '#FFFFFF'
  const inactiveColor = '#0F2F2C'

  const radarIcon = (active: boolean) => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="3" fill={active ? em : 'none'} stroke={active ? em : inactiveColor} strokeWidth="2"/>
      <circle cx="12" cy="12" r="7" stroke={active ? em : inactiveColor} strokeWidth="1.5" strokeDasharray="3 2" opacity={active ? 1 : 0.6}/>
      <circle cx="12" cy="12" r="11" stroke={active ? em : inactiveColor} strokeWidth="1" strokeDasharray="2 3" opacity={active ? 0.6 : 0.35}/>
    </svg>
  )
  const clockIcon = (active: boolean) => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="10" stroke={active ? em : inactiveColor} strokeWidth="2"/>
      <path d="M12 6v6l4 2" stroke={active ? em : inactiveColor} strokeWidth="2" strokeLinecap="round"/>
    </svg>
  )
  const profileIcon = (active: boolean) => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="8" r="4" stroke={active ? em : inactiveColor} strokeWidth="2" fill={active ? `${em}18` : 'none'}/>
      <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" stroke={active ? em : inactiveColor} strokeWidth="2" strokeLinecap="round"/>
    </svg>
  )
  const usersIcon = (active: boolean) => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
      <circle cx="9" cy="7" r="3.5" stroke={active ? em : inactiveColor} strokeWidth="2"/>
      <path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" stroke={active ? em : inactiveColor} strokeWidth="2" strokeLinecap="round"/>
      <circle cx="17" cy="7" r="2.5" stroke={active ? em : inactiveColor} strokeWidth="1.5"/>
      <path d="M21 20c0-2.8-1.8-5-4-5" stroke={active ? em : inactiveColor} strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  )
  const chartIcon = (active: boolean) => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
      <rect x="3" y="12" width="4" height="9" rx="1" fill={active ? `${em}30` : 'none'} stroke={active ? em : inactiveColor} strokeWidth="2"/>
      <rect x="10" y="7" width="4" height="14" rx="1" fill={active ? `${em}30` : 'none'} stroke={active ? em : inactiveColor} strokeWidth="2"/>
      <rect x="17" y="3" width="4" height="18" rx="1" fill={active ? `${em}30` : 'none'} stroke={active ? em : inactiveColor} strokeWidth="2"/>
    </svg>
  )
  const monitorIcon = (active: boolean) => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" stroke={active ? em : inactiveColor} strokeWidth="2" strokeLinejoin="round" fill={active ? `${em}18` : 'none'}/>
      <path d="M8 12l3 3 5-6" stroke={active ? em : inactiveColor} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )

  const attendeeTabs: NavTab[] = [
    { label: 'Home', target: 'home', icon: radarIcon },
    { label: 'My Activity', target: 'attendeeConfirmed', icon: clockIcon },
    { label: 'Profile', target: 'profile', icon: profileIcon },
  ]
  const presenterTabs: NavTab[] = [
    { label: 'Home', target: 'home', icon: radarIcon },
    { label: 'Roster', target: 'presenterRoster', icon: usersIcon },
    { label: 'Analysis', target: 'sessionEnd', icon: chartIcon },
    { label: 'Profile', target: 'profile', icon: profileIcon },
  ]
  const adminTabs: NavTab[] = [
    { label: 'Monitor', target: 'adminOverview', icon: monitorIcon },
    { label: 'Profile', target: 'profile', icon: profileIcon },
  ]

  const tabs = role === 'attendee' ? attendeeTabs : role === 'presenter' ? presenterTabs : adminTabs

  const activeTab = tabs.findIndex(t =>
    t.target === screen
    || (screen === 'attendeeDiscovery' && t.target === 'home')
    || (screen === 'attendeeOutOfRange' && t.target === 'home')
    || (screen === 'presenterSetup' && t.target === 'home')
    || (screen === 'presenterDashboard' && t.target === 'home')
    || (screen === 'adminRoomDetail' && t.target === 'adminOverview')
    || (screen === 'edgeState' && t.target === 'adminOverview')
    || (screen === 'sessionEnd' && t.target === 'sessionEnd')
  )

  return (
    <div style={{ flexShrink: 0, background: navBg, borderTop: '1px solid #EAEAEA', display: 'flex', alignItems: 'stretch', paddingBottom: '8px' }}>
      {tabs.map((tab, i) => {
        const active = activeTab === i
        return (
          <button key={i} onClick={() => nav(tab.target)} className="flex-1 flex flex-col items-center justify-center pt-2 pb-1 gap-1 transition-all" style={{ background: 'transparent', border: 'none' }}>
            <div style={{ padding: '5px 14px', borderRadius: '999px', background: active ? 'rgba(51,209,172,0.18)' : 'transparent', transition: 'all 0.22s cubic-bezier(0.34,1.56,0.64,1)' }}>
              {tab.icon(active)}
            </div>
            <span style={{ fontSize: '10px', fontWeight: active ? 700 : 500, color: active ? em : inactiveColor, letterSpacing: '0.01em', transition: 'color 0.18s' }}>{tab.label}</span>
          </button>
        )
      })}
    </div>
  )
}

// ─── Screens ─────────────────────────────────────────────────────────────────

function LaunchScreen({ nav }: { nav: (s: Screen) => void }) {
  // phase 0 (0–200ms):    large X at exact center (initial state)
  // phase 1 (200–950ms):  X zooms out (scale 3→1) while staying perfectly centered
  // phase 2 (950–1200ms): X smoothly shifts left toward final wordmark position
  // phase 3 (1050–1400ms):  "Connect" slides in from the right
  // phase 4 (1400–1750ms): XConnect wordmark settled at center
  // phase 5 (1750–2100ms): radar waves expand from logo
  // phase 6 (2100ms+):    fade out → login
  const [phase, setPhase] = useState(0)

  const runAnimation = useCallback(() => {
    setPhase(0)
    const timers = [
      setTimeout(() => setPhase(1), 200),
      setTimeout(() => setPhase(2), 950),
      setTimeout(() => setPhase(3), 1050),
      setTimeout(() => setPhase(4), 1400),
      setTimeout(() => setPhase(5), 1750),
      setTimeout(() => setPhase(6), 2100),
      setTimeout(() => nav('login'), 2400),
    ]
    return () => timers.forEach(clearTimeout)
  }, [nav])

  useEffect(() => { return runAnimation() }, [runAnimation])

  // Layout constants — all positions relative to screen center (left:50%, top:50%)
  const iconW = 90   // final icon width/height in px
  const iconH = 90
  // "Connect" at 34px Inter 800: approximately 158px wide
  const connectW = 158
  const gap = 10
  const wordmarkW = iconW + gap + connectW // 258px
  // Icon center in final wordmark, measured from screen center:
  // wordmark left = 50% - wordmarkW/2; icon center = wordmarkLeft + iconW/2
  // offset from 50% = iconW/2 - wordmarkW/2 = 45 - 129 = -84px
  const iconFinalDx = Math.round(iconW / 2 - wordmarkW / 2) // -84
  // Connect center in final wordmark, measured from screen center:
  // connectCenter = wordmarkLeft + iconW + gap + connectW/2
  // offset from 50% = iconW + gap + connectW/2 - wordmarkW/2 = 90+10+79 - 129 = 50px
  const connectFinalDx = Math.round(iconW + gap + connectW / 2 - wordmarkW / 2) // +50

  // Icon outer wrapper: handles horizontal position only (centered → final offset)
  // Using margin to center the element so translateX is the only variable
  const iconTranslateX = phase >= 2 ? iconFinalDx : 0
  const iconOuterTransition = phase === 2
    ? 'transform 0.32s cubic-bezier(0.4,0,0.2,1)'
    : phase >= 6
    ? 'opacity 0.28s ease-out'
    : 'none'

  // Icon inner wrapper: handles scale only
  const iconScale = phase >= 1 ? 1 : 3.2
  const iconInnerTransition = phase === 1 ? 'transform 0.75s cubic-bezier(0.4,0,0.2,1)' : 'none'

  // Connect: positioned absolutely, slides from right to final
  const connectTranslateX = phase >= 3 ? connectFinalDx : connectFinalDx + 130
  const connectTransition = phase === 3
    ? 'transform 0.38s cubic-bezier(0.22,1,0.36,1), opacity 0.18s ease-out'
    : 'none'

  return (
    <div className="h-full relative overflow-hidden select-none" style={{ background: '#0F2F2C' }}>

      {/* ── X ICON ───────────────────────────────────────────────────────
          Outer div: only moves horizontally (centered → final wordmark position).
          Inner div: only scales (3.2× → 1×).
          This separation means zoom-out and repositioning are two distinct motions.
      ──────────────────────────────────────────────────────────────── */}
      <div style={{
        position: 'absolute',
        left: '50%',
        top: '50%',
        marginLeft: `-${iconW / 2}px`,  // keeps element center at 50% when translateX=0
        marginTop: `-${iconH / 2}px`,
        transform: `translateX(${iconTranslateX}px)`,
        transition: iconOuterTransition,
        opacity: phase >= 6 ? 0 : 1,
        zIndex: 2,
      }}>
        <div style={{
          width: `${iconW}px`,
          height: `${iconH}px`,
          transformOrigin: 'center center',
          transform: `scale(${iconScale})`,
          transition: iconInnerTransition,
        }}>
          <img src={xLogoSrc} width={iconW} height={iconH} style={{ display: 'block', objectFit: 'contain' }} alt="X" />
        </div>
      </div>

      {/* ── CONNECT TEXT ─────────────────────────────────────────────────
          Positioned absolutely from screen center.
          Slides in from right in phase 3.
      ──────────────────────────────────────────────────────────────── */}
      <div style={{
        position: 'absolute',
        left: '50%',
        top: '50%',
        marginLeft: `-${connectW / 2}px`,
        marginTop: '-21px',  // approx half of 34px × lineHeight 1.2
        transform: `translateX(${connectTranslateX}px)`,
        transition: connectTransition,
        opacity: phase >= 3 ? 1 : 0,
        zIndex: 2,
        overflow: 'visible',
      }}>
        <span style={{
          fontSize: '34px',
          fontWeight: 800,
          color: '#FFFFFF',
          letterSpacing: '-0.025em',
          lineHeight: 1,
          display: 'block',
          whiteSpace: 'nowrap',
        }}>Connect</span>
      </div>

      {/* ── RADAR WAVES — phase 5 ─────────────────────────────────────── */}
      {phase === 5 && [0, 1, 2].map(i => (
        <div key={i} style={{
          position: 'absolute',
          left: '50%', top: '50%',
          width: '110px', height: '110px',
          borderRadius: '50%',
          border: '1.5px solid rgba(255,255,255,0.35)',
          animation: `splash-wave 0.78s cubic-bezier(0.2,0,0.8,1) ${i * 0.23}s forwards`,
          opacity: 0,
          zIndex: 3,
        }} />
      ))}

      {/* ── SKIP BUTTON ──────────────────────────────────────────────── */}
      <button onClick={() => nav('login')} style={{
        position: 'absolute', bottom: '40px', left: 0, right: 0,
        textAlign: 'center', background: 'transparent', border: 'none',
        color: 'rgba(255,255,255,0.35)', fontSize: '12px',
        opacity: phase >= 2 ? 1 : 0,
        transition: 'opacity 0.4s',
        zIndex: 20,
      }}>tap to continue</button>
    </div>
  )
}

function OnboardingScreen({ theme, nav }: { theme: Theme; nav: (s: Screen) => void }) {
  const [slide, setSlide] = useState(0)
  const slides = [
    {
      icon: <svg width="44" height="44" viewBox="0 0 48 48" fill="none"><circle cx="16" cy="24" r="6" stroke="#38BDF8" strokeWidth="2"/><circle cx="32" cy="24" r="6" stroke="#38BDF8" strokeWidth="2"/><path d="M22 24h4" stroke="#38BDF8" strokeWidth="2" strokeDasharray="2 2"/><circle cx="16" cy="24" r="12" stroke="#38BDF8" strokeWidth="1" opacity="0.3" strokeDasharray="3 3"/><circle cx="32" cy="24" r="12" stroke="#38BDF8" strokeWidth="1" opacity="0.3" strokeDasharray="3 3"/></svg>,
      color: '#38BDF8',
      title: 'Peer-to-Peer BLE Mesh',
      body: "Your phone silently exchanges ephemeral Bluetooth tokens with nearby devices every 60 seconds, forming a real-time proximity graph — no infrastructure required.",
    },
    {
      icon: <svg width="44" height="44" viewBox="0 0 48 48" fill="none"><rect x="8" y="8" width="32" height="32" rx="4" stroke="#2DD4BF" strokeWidth="2"/><path d="M8 24h8M32 24h8M24 8v8M24 32v8" stroke="#2DD4BF" strokeWidth="2" strokeLinecap="round"/><circle cx="24" cy="24" r="6" fill="#2DD4BF" fillOpacity="0.2" stroke="#2DD4BF" strokeWidth="2"/></svg>,
      color: '#2DD4BF',
      title: 'Ultrasonic Acoustic Gate',
      body: "Inaudible 18.5–19.5 kHz tones emitted by the presenter's phone. Ultrasound cannot pass through drywall or glass — delivering 99% audit-grade in-room certainty.",
    },
    {
      icon: <svg width="44" height="44" viewBox="0 0 48 48" fill="none"><rect x="10" y="16" width="28" height="20" rx="4" stroke="#33D1AC" strokeWidth="2"/><path d="M18 16v-4a6 6 0 0112 0v4" stroke="#33D1AC" strokeWidth="2" strokeLinecap="round"/><circle cx="24" cy="26" r="3" fill="#33D1AC"/><path d="M24 29v4" stroke="#33D1AC" strokeWidth="2" strokeLinecap="round"/></svg>,
      color: '#33D1AC',
      title: 'Zero Hardware Required',
      body: "No beacons. No NFC gates. No QR codes. No GPS. XConnect fuses your phone's existing sensors into a secure, automatic, enterprise-grade attendance system.",
    },
  ]
  const s = slides[slide]

  return (
    <div className="flex flex-col h-full" style={{ background: surf(theme) }}>
      <div className="flex-1 flex flex-col items-center justify-center px-8 text-center" style={{ animation: 'scale-in 0.4s ease-out both' }}>
        <div className="w-24 h-24 rounded-3xl flex items-center justify-center mb-8" style={{
          background: `${s.color}14`, border: `1.5px solid ${s.color}40`,
        }}>{s.icon}</div>
        <h2 className="font-bold mb-4" style={{ fontSize: '24px', color: txt(theme), letterSpacing: '-0.5px' }}>{s.title}</h2>
        <p style={{ color: sub(theme), fontSize: '15px', lineHeight: '24px', maxWidth: '280px' }}>{s.body}</p>
      </div>
      <div className="flex items-center justify-between px-6 pb-10">
        <div className="flex gap-1.5">
          {slides.map((_, i) => (
            <button key={i} onClick={() => setSlide(i)} className="rounded-full transition-all" style={{
              width: i === slide ? '24px' : '8px', height: '8px',
              background: i === slide ? s.color : bdr(theme),
            }} />
          ))}
        </div>
        <button
          onClick={() => slide < slides.length - 1 ? setSlide(slide + 1) : nav('permissions')}
          className="rounded-full px-6 py-3 font-semibold text-sm transition-all active:scale-95"
          style={{ background: s.color, color: '#0B0F17' }}
        >
          {slide < slides.length - 1 ? 'Next' : "Let's Go"}
        </button>
      </div>
    </div>
  )
}

function PermissionsScreen({ theme, nav }: { theme: Theme; nav: (s: Screen) => void }) {
  const [granted, setGranted] = useState<Record<string, boolean>>({ bluetooth: false, microphone: false })

  const perms = [
    {
      key: 'bluetooth',
      icon: <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M6.5 6.5l11 11M17.5 6.5L12 12l5.5 5.5L12 23V1l5.5 5.5" stroke="#38BDF8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>,
      color: '#38BDF8',
      title: 'Nearby Devices',
      desc: 'Used to detect peer phones via Bluetooth Low Energy proximity tokens. No data is transmitted to external servers.',
    },
    {
      key: 'microphone',
      icon: <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><rect x="9" y="3" width="6" height="11" rx="3" stroke="#2DD4BF" strokeWidth="2"/><path d="M5 10a7 7 0 0014 0M12 19v3M8 22h8" stroke="#2DD4BF" strokeWidth="2" strokeLinecap="round"/></svg>,
      color: '#2DD4BF',
      title: 'Microphone',
      desc: 'Used solely to decode inaudible room sound frequencies (18.5–19.5 kHz). Your conversations are never recorded or processed.',
    },
  ]

  const allGranted = Object.values(granted).every(Boolean)

  return (
    <div className="flex flex-col h-full" style={{ background: surf(theme) }}>
      <div className="px-6 pt-14 pb-4">
        <h1 className="font-bold mb-2" style={{ fontSize: '26px', color: txt(theme), letterSpacing: '-0.5px' }}>Sensor Access</h1>
        <p style={{ color: sub(theme), fontSize: '14px', lineHeight: '22px' }}>XConnect needs two permissions to verify in-room presence. Both are used only on-device.</p>
      </div>
      <div className="flex-1 px-5 overflow-y-auto">
        {perms.map(p => (
          <div key={p.key} className="rounded-2xl p-4 mb-3" style={{ background: card(theme), border: `1px solid ${bdr(theme)}` }}>
            <div className="flex items-start gap-4">
              <div className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: `${p.color}15`, border: `1px solid ${p.color}40` }}>
                {p.icon}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-1">
                  <span className="font-semibold" style={{ color: txt(theme), fontSize: '15px' }}>{p.title}</span>
                  <button
                    onClick={() => setGranted(g => ({ ...g, [p.key]: !g[p.key] }))}
                    className="rounded-full transition-all"
                    style={{ width: '44px', height: '26px', background: granted[p.key] ? '#33D1AC' : bdr(theme), position: 'relative' }}
                  >
                    <div style={{
                      position: 'absolute', top: '3px',
                      left: granted[p.key] ? '21px' : '3px',
                      width: '20px', height: '20px',
                      borderRadius: '50%', background: '#fff',
                      transition: 'left 0.2s ease',
                      boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
                    }} />
                  </button>
                </div>
                <p style={{ color: sub(theme), fontSize: '13px', lineHeight: '19px' }}>{p.desc}</p>
              </div>
            </div>
          </div>
        ))}
        <div className="rounded-xl px-4 py-3 flex items-center gap-2" style={{ background: 'rgba(51,209,172,0.08)', border: '1px solid rgba(51,209,172,0.2)' }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" stroke="#33D1AC" strokeWidth="2" strokeLinejoin="round"/></svg>
          <p style={{ color: '#33D1AC', fontSize: '12px', lineHeight: '18px' }}>All sensor data is processed locally. Nothing leaves your device.</p>
        </div>
      </div>
      <div className="px-5 pb-10 pt-4">
        <button
          onClick={() => nav('login')}
          className="w-full rounded-2xl py-4 font-bold text-base transition-all active:scale-95"
          style={{ background: allGranted ? '#33D1AC' : bdr(theme), color: allGranted ? '#0B0F17' : muted(theme) }}
        >
          {allGranted ? 'Continue to XConnect' : 'Grant Permissions to Continue'}
        </button>
        <button onClick={() => nav('login')} className="w-full text-center mt-3" style={{ color: muted(theme), fontSize: '13px' }}>Skip for now</button>
      </div>
    </div>
  )
}

// ─── Login / SSO Screen ───────────────────────────────────────────────────────

function SSOButtons({ onLogin, theme, nav }: { onLogin: () => void; theme: Theme; nav: (s: Screen) => void }) {
  const [email, setEmail] = React.useState('')
  const [password, setPassword] = React.useState('')

  return (
    <div className="flex flex-col gap-3">
      <button onClick={onLogin} className="w-full rounded-2xl py-3.5 flex items-center justify-center gap-3 font-semibold transition-all active:scale-98" style={{ background: '#FFFFFF', border: '1.5px solid #E2E8F0', color: '#0F172A', boxShadow: '0 2px 8px rgba(0,0,0,0.08)', fontSize: '14px' }}>
        <svg width="20" height="20" viewBox="0 0 24 24">
          <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
          <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
          <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
          <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
        </svg>
        Continue with Google
      </button>
      <button onClick={onLogin} className="w-full rounded-2xl py-3.5 flex items-center justify-center gap-3 font-semibold transition-all active:scale-98" style={{ background: '#FFFFFF', border: '1.5px solid #E2E8F0', color: '#0F172A', boxShadow: '0 2px 8px rgba(0,0,0,0.08)', fontSize: '14px' }}>
        <svg width="20" height="20" viewBox="0 0 21 21"><rect x="1" y="1" width="9" height="9" fill="#F25022"/><rect x="11" y="1" width="9" height="9" fill="#7FBA00"/><rect x="1" y="11" width="9" height="9" fill="#00A4EF"/><rect x="11" y="11" width="9" height="9" fill="#FFB900"/></svg>
        Continue with Microsoft 365
      </button>
      <div className="flex items-center gap-3 my-0.5">
        <div className="flex-1 h-px" style={{ background: bdr(theme) }} />
        <span style={{ color: muted(theme), fontSize: '12px' }}>or</span>
        <div className="flex-1 h-px" style={{ background: bdr(theme) }} />
      </div>
      <input
        type="email"
        placeholder="Enter your email"
        value={email}
        onChange={e => setEmail(e.target.value)}
        className="w-full rounded-2xl px-4 py-3.5 outline-none font-medium"
        style={{ background: theme === 'dark' ? '#131C2E' : '#F8FAFC', border: `1.5px solid ${bdr(theme)}`, color: txt(theme), fontSize: '14px' }}
      />
      <input
        type="password"
        placeholder="Enter your password"
        value={password}
        onChange={e => setPassword(e.target.value)}
        className="w-full rounded-2xl px-4 py-3.5 outline-none font-medium"
        style={{ background: theme === 'dark' ? '#131C2E' : '#F8FAFC', border: `1.5px solid ${bdr(theme)}`, color: txt(theme), fontSize: '14px' }}
      />
      <div className="flex justify-end">
        <button onClick={() => {}} style={{ color: '#33D1AC', fontSize: '12px', fontWeight: 600, background: 'transparent', border: 'none' }}>Forgot password?</button>
      </div>
      <button onClick={onLogin} className="w-full rounded-2xl py-3.5 font-bold transition-all active:scale-95" style={{ background: '#33D1AC', color: '#0F2F2C', fontSize: '14px' }}>
        Sign In
      </button>
      <button onClick={() => nav('createAccount')} style={{ color: muted(theme), fontSize: '12px', textAlign: 'center', background: 'transparent', border: 'none', marginTop: '2px' }}>
        New here? <span style={{ color: '#33D1AC', fontWeight: 600 }}>Create an account</span>
      </button>
    </div>
  )
}

function LoginScreen({ theme, nav, onLogin }: { theme: Theme; nav: (s: Screen) => void; onLogin: (role: Role) => void }) {
  const [tab, setTab] = useState<'attendee' | 'presenter' | 'admin'>('attendee')

  const tabs = [
    { key: 'attendee' as const, label: 'Attendee' },
    { key: 'presenter' as const, label: 'Presenter' },
    { key: 'admin' as const, label: 'Admin' },
  ]

  const handleLogin = () => {
    onLogin(tab)
    nav(tab === 'admin' ? 'adminOverview' : 'home')
  }

  const roleHint = tab === 'attendee'
    ? { text: 'Privacy-first · Auto-detect room presence', color: '#38BDF8', bg: 'rgba(56,189,248,0.08)', border: 'rgba(56,189,248,0.25)' }
    : tab === 'presenter'
    ? { text: 'Full room control · Broadcast presence gate', color: '#33D1AC', bg: 'rgba(51,209,172,0.08)', border: 'rgba(51,209,172,0.25)' }
    : { text: 'System monitoring · Enterprise administration', color: '#A78BFA', bg: 'rgba(167,139,250,0.08)', border: 'rgba(167,139,250,0.25)' }

  return (
    <div className="flex flex-col h-full" style={{ background: surf(theme) }}>
      {/* Header */}
      <div className="flex flex-col items-center pt-8 pb-5 px-6">
        <img src={xConnectLogoSrc} width={56} height={56} style={{ display: 'block', objectFit: 'contain', marginBottom: '12px', borderRadius: '12px' }} alt="XConnect" />
        <h1 style={{ fontSize: '20px', fontWeight: 800, color: txt(theme), letterSpacing: '-0.4px', marginBottom: '2px' }}>XConnect</h1>
        <p style={{ color: muted(theme), fontSize: '11px', letterSpacing: '0.12em', textTransform: 'uppercase' }}>Enterprise Presence Platform</p>
      </div>

      {/* Role tab selector */}
      <div className="mx-4 mb-5 p-1 rounded-2xl flex" style={{ background: '#F1F5F9', border: `1px solid ${bdr(theme)}` }}>
        {tabs.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)} className="flex-1 py-2 rounded-xl font-semibold transition-all" style={{ background: tab === t.key ? '#FFFFFF' : 'transparent', color: tab === t.key ? txt(theme) : muted(theme), boxShadow: tab === t.key ? '0 1px 4px rgba(0,0,0,0.12)' : 'none', border: 'none', fontSize: '11px' }}>{t.label}</button>
        ))}
      </div>

      <div className="flex-1 px-5 flex flex-col">
        <div className="rounded-xl px-3 py-2 mb-4 flex items-center gap-2" style={{ background: roleHint.bg, border: `1px solid ${roleHint.border}` }}>
          <p style={{ color: roleHint.color, fontSize: '11px', fontWeight: 600 }}>{roleHint.text}</p>
        </div>
        <SSOButtons onLogin={handleLogin} theme={theme} nav={nav} />
        <div className="mt-auto mb-4 flex flex-col items-center gap-1">
          <div className="flex items-center gap-1.5">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" stroke="#33D1AC" strokeWidth="2" strokeLinejoin="round"/></svg>
            <span style={{ color: '#33D1AC', fontSize: '11px', fontWeight: 600 }}>SOC 2 Type II · End-to-End Encrypted</span>
          </div>
          <p style={{ color: muted(theme), fontSize: '11px', textAlign: 'center' }}>Identity verified via enterprise IdP. No passwords stored.</p>
        </div>
      </div>
    </div>
  )
}

// ─── Home Dashboard ───────────────────────────────────────────────────────────

function HomeScreen({ theme, nav, role }: { theme: Theme; nav: (s: Screen) => void; role: Role }) {
  const [activeRoom, setActiveRoom] = useState('Hall A')
  const rooms = ['Hall A', 'Workshop 1', 'Auditorium', '+ Add']

  const attendeeHistory = [
    { room: 'Hall A', date: 'Sep 11', dwell: '38m', status: 'Verified' },
    { room: 'Workshop 1', date: 'Sep 10', dwell: '52m', status: 'Verified' },
    { room: 'Auditorium', date: 'Sep 9', dwell: '1h 14m', status: 'Verified' },
    { room: 'Hall A', date: 'Sep 8', dwell: '29m', status: 'Verified' },
  ]

  return (
    <div className="flex flex-col h-full overflow-y-auto" style={{ background: surf(theme) }}>
      {/* Top bar — XConnect branding only */}
      <div className="px-5 pt-5 pb-4 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-2.5">
          <img src={xConnectLogoSrc} width={32} height={32} style={{ display: 'block', objectFit: 'contain', borderRadius: '7px' }} alt="XConnect" />
          <span className="font-bold" style={{ color: dk, fontSize: '17px', letterSpacing: '-0.3px' }}>XConnect</span>
        </div>
        <div className="flex items-center gap-1.5 rounded-full px-3 py-1.5" style={{
          background: 'rgba(51,209,172,0.1)', border: '1px solid rgba(51,209,172,0.25)',
        }}>
          <div className="w-1.5 h-1.5 rounded-full" style={{ background: '#33D1AC', animation: 'live-dot 1.6s ease-in-out infinite' }} />
          <span style={{ color: '#33D1AC', fontSize: '11px', fontWeight: 700, fontFamily: "'JetBrains Mono', monospace" }}>CONNECTED</span>
        </div>
      </div>

      {/* Presence Core orb */}
      <div className="flex flex-col items-center py-4 flex-shrink-0">
        <div className="relative" style={{ width: '130px', height: '130px' }}>
          {[1, 2].map(i => (
            <div key={i} className="absolute inset-0 rounded-full" style={{
              border: '1.5px solid rgba(51,209,172,0.3)',
              animation: `orb-ring 2.4s ease-out ${i * 0.8}s infinite`,
            }} />
          ))}
          <div className="absolute inset-0 rounded-full flex items-center justify-center" style={{
            background: 'radial-gradient(circle, rgba(51,209,172,0.35) 0%, rgba(51,209,172,0.06) 70%)',
            border: '2px solid rgba(51,209,172,0.5)',
            animation: 'pulse-orb 2.8s ease-in-out infinite',
            boxShadow: '0 0 40px rgba(51,209,172,0.25)',
          }}>
            <svg width="44" height="44" viewBox="0 0 44 44" fill="none">
              <path d="M8 8L36 36M36 8L8 36" stroke="#33D1AC" strokeWidth="5" strokeLinecap="round"/>
              <circle cx="22" cy="22" r="8" stroke="#38BDF8" strokeWidth="1.2" strokeDasharray="3 2" opacity="0.6"/>
            </svg>
          </div>
        </div>
        <p className="mt-3 font-semibold" style={{ color: '#33D1AC', fontSize: '12px', letterSpacing: '0.08em', textTransform: 'uppercase' }}>Space Ready · 18ms</p>
      </div>

      {/* Role-specific action card */}
      <div className="px-4 flex flex-col gap-3 flex-shrink-0">
        {role === 'attendee' && (
          <div className="rounded-2xl p-4" style={{ background: card(theme), border: `1px solid ${bdr(theme)}`, boxShadow: '0 2px 12px rgba(0,0,0,0.06)' }}>
            <div className="flex items-center gap-2 mb-3">
              <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: 'rgba(2,132,199,0.12)', border: '1px solid rgba(2,132,199,0.3)' }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="3" fill="#0284C7"/><circle cx="12" cy="12" r="7" stroke="#0284C7" strokeWidth="1.5" strokeDasharray="3 2" opacity="0.7"/><circle cx="12" cy="12" r="11" stroke="#38BDF8" strokeWidth="1" strokeDasharray="2 3" opacity="0.4"/></svg>
              </div>
              <div>
                <p className="font-bold" style={{ color: txt(theme), fontSize: '14px' }}>Find My Room</p>
                <p style={{ color: muted(theme), fontSize: '11px' }}>Zero-touch automatic detection</p>
              </div>
            </div>
            <div className="flex items-center gap-3 mb-3 rounded-xl px-3 py-2.5" style={{ background: '#F0F9FF' }}>
              <div className="relative flex-shrink-0" style={{ width: '36px', height: '36px' }}>
                {[0,1].map(i => (
                  <div key={i} className="absolute inset-0 rounded-full" style={{
                    border: '1px solid rgba(56,189,248,0.5)',
                    animation: `radar-pulse 2s ease-out ${i * 1}s infinite`,
                  }} />
                ))}
                <div className="absolute inset-0 rounded-full flex items-center justify-center" style={{ background: 'rgba(56,189,248,0.15)' }}>
                  <div className="w-2 h-2 rounded-full" style={{ background: '#38BDF8' }} />
                </div>
              </div>
              <div>
                <p style={{ color: '#0284C7', fontSize: '12px', fontWeight: 600 }}>Quad-sensor active</p>
                <p style={{ color: muted(theme), fontSize: '11px' }}>BLE · Ultrasonic · Wi-Fi · IMU</p>
              </div>
            </div>
            <button onClick={() => nav('attendeeDiscovery')} className="w-full rounded-xl py-3 font-bold text-sm transition-all active:scale-98" style={{ background: '#33D1AC', color: '#0F2F2C' }}>
              Begin Detection
            </button>
          </div>
        )}

        {role === 'presenter' && (
          <div className="rounded-2xl p-4" style={{ background: card(theme), border: `1px solid ${bdr(theme)}`, boxShadow: '0 2px 12px rgba(0,0,0,0.06)' }}>
            <div className="flex items-center gap-2 mb-3">
              <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: 'rgba(51,209,172,0.12)', border: '1px solid rgba(51,209,172,0.3)' }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="8" r="4" stroke="#33D1AC" strokeWidth="2"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" stroke="#33D1AC" strokeWidth="2" strokeLinecap="round"/><path d="M19 8l2 2-2 2" stroke="#33D1AC" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </div>
              <div>
                <p className="font-bold" style={{ color: txt(theme), fontSize: '14px' }}>Host / Anchor Room</p>
                <p style={{ color: muted(theme), fontSize: '11px' }}>Broadcast presence gate</p>
              </div>
            </div>
            <div className="flex gap-2 overflow-x-auto pb-1 mb-3 -mx-1 px-1">
              {rooms.map(r => (
                <button
                  key={r}
                  onClick={() => setActiveRoom(r)}
                  className="rounded-full px-3 py-1.5 text-xs font-semibold whitespace-nowrap flex-shrink-0 transition-all"
                  style={{
                    background: activeRoom === r ? 'rgba(51,209,172,0.15)' : '#F1F5F9',
                    border: activeRoom === r ? '1.5px solid #33D1AC' : `1.5px solid ${bdr(theme)}`,
                    color: activeRoom === r ? '#33D1AC' : sub(theme),
                  }}
                >{r}</button>
              ))}
            </div>
            <button onClick={() => nav('presenterSetup')} className="w-full rounded-xl py-3 font-bold text-sm transition-all active:scale-98" style={{ background: '#33D1AC', color: '#0F2F2C' }}>
              Start Broadcasting
            </button>
          </div>
        )}
      </div>

      {/* Recent Sessions (presenter) */}
      {role === 'presenter' && (
        <div className="px-5 pt-4 pb-4 flex-shrink-0">
          <p className="mb-3 font-semibold" style={{ color: sub(theme), fontSize: '12px', letterSpacing: '0.06em', textTransform: 'uppercase' }}>Recent Sessions</p>
          <div className="flex gap-3 overflow-x-auto pb-1 -mx-5 px-5">
            {[
              { room: 'Hall A', date: 'Sep 11', dwell: '38m', count: 24 },
              { room: 'Workshop 1', date: 'Sep 10', dwell: '52m', count: 12 },
              { room: 'Auditorium', date: 'Sep 9', dwell: '1h 14m', count: 85 },
              { room: 'Hall A', date: 'Sep 8', dwell: '29m', count: 19 },
            ].map((s, i) => (
              <div key={i} className="flex-shrink-0 rounded-2xl p-3" style={{
                width: '130px',
                background: card(theme), border: `1px solid ${bdr(theme)}`,
                boxShadow: '0 1px 6px rgba(0,0,0,0.05)',
                animation: `session-card-in 0.4s ease-out ${i * 0.08}s both`,
                cursor: 'pointer',
              }}>
                <div className="w-7 h-7 rounded-lg flex items-center justify-center mb-2" style={{ background: 'rgba(51,209,172,0.12)', border: '1px solid rgba(51,209,172,0.25)' }}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" stroke="#33D1AC" strokeWidth="2" strokeLinecap="round"/><circle cx="9" cy="7" r="4" stroke="#33D1AC" strokeWidth="2"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" stroke="#33D1AC" strokeWidth="2" strokeLinecap="round"/></svg>
                </div>
                <p className="font-semibold truncate" style={{ color: txt(theme), fontSize: '12px' }}>{s.room}</p>
                <p style={{ color: muted(theme), fontSize: '10px', fontFamily: "'JetBrains Mono', monospace" }}>{s.date}</p>
                <div className="flex items-center justify-between mt-2">
                  <span style={{ color: '#33D1AC', fontSize: '11px', fontWeight: 600, fontFamily: "'JetBrains Mono', monospace" }}>{s.dwell}</span>
                  <span style={{ color: '#33D1AC', fontSize: '10px', fontWeight: 700, fontFamily: "'JetBrains Mono', monospace" }}>{s.count}✓</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent Sessions (attendee only) */}
      {role === 'attendee' && (
        <div className="px-5 pt-4 pb-4 flex-shrink-0">
          <p className="mb-3 font-semibold" style={{ color: sub(theme), fontSize: '12px', letterSpacing: '0.06em', textTransform: 'uppercase' }}>Recent Sessions</p>
          <div className="flex gap-3 overflow-x-auto pb-1 -mx-5 px-5">
            {attendeeHistory.map((s, i) => (
              <div key={i} className="flex-shrink-0 rounded-2xl p-3" style={{
                width: '130px',
                background: card(theme), border: `1px solid ${bdr(theme)}`,
                boxShadow: '0 1px 6px rgba(0,0,0,0.05)',
                animation: `session-card-in 0.4s ease-out ${i * 0.08}s both`,
              }}>
                <div className="w-7 h-7 rounded-lg flex items-center justify-center mb-2" style={{ background: 'rgba(51,209,172,0.12)', border: '1px solid rgba(51,209,172,0.25)' }}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none"><rect x="3" y="9" width="18" height="13" rx="2" stroke="#33D1AC" strokeWidth="2"/><path d="M3 9l9-7 9 7" stroke="#33D1AC" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                </div>
                <p className="font-semibold truncate" style={{ color: txt(theme), fontSize: '12px' }}>{s.room}</p>
                <p style={{ color: muted(theme), fontSize: '10px', fontFamily: "'JetBrains Mono', monospace" }}>{s.date}</p>
                <div className="flex items-center justify-between mt-2">
                  <span style={{ color: '#33D1AC', fontSize: '11px', fontWeight: 600, fontFamily: "'JetBrains Mono', monospace" }}>{s.dwell}</span>
                  <span style={{ color: '#33D1AC', fontSize: '9px', fontWeight: 700 }}>✓</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Profile Screen ───────────────────────────────────────────────────────────

function ProfileScreen({ theme, nav, role }: { theme: Theme; nav: (s: Screen) => void; role: Role }) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState('Dr. Sarah Jenkins')
  const [email, setEmail] = useState('sarah.jenkins@corp.io')
  const [title, setTitle] = useState('Lead Researcher')

  return (
    <div className="flex flex-col h-full overflow-y-auto" style={{ background: surf(theme) }}>
      <div className="px-5 pt-6 pb-4 flex items-center justify-between">
        <h2 className="font-bold" style={{ color: txt(theme), fontSize: '20px', letterSpacing: '-0.4px' }}>Profile</h2>
        <button onClick={() => setEditing(e => !e)} className="rounded-full px-4 py-1.5 font-semibold text-sm transition-all" style={{ background: editing ? 'rgba(51,209,172,0.15)' : '#F1F5F9', border: `1px solid ${editing ? 'rgba(51,209,172,0.4)' : bdr(theme)}`, color: editing ? '#33D1AC' : sub(theme) }}>
          {editing ? 'Done' : 'Edit Profile'}
        </button>
      </div>

      {/* User card */}
      <div className="mx-5 rounded-2xl p-5 mb-4" style={{ background: card(theme), border: `1px solid ${bdr(theme)}`, boxShadow: '0 2px 12px rgba(0,0,0,0.06)' }}>
        <div className="flex items-center gap-4 mb-4">
          <div className="w-16 h-16 rounded-full flex items-center justify-center font-bold text-xl flex-shrink-0" style={{
            background: 'linear-gradient(135deg, rgba(51,209,172,0.2), rgba(56,189,248,0.2))',
            border: '2px solid rgba(51,209,172,0.4)',
            color: '#33D1AC',
          }}>{name.split(' ').map(n => n[0]).join('').slice(0,2)}</div>
          <div className="flex-1 min-w-0">
            {editing ? (
              <input value={name} onChange={e => setName(e.target.value)} className="w-full rounded-xl px-3 py-2 outline-none font-bold mb-1" style={{ background: '#F8FAFC', border: `1.5px solid ${bdr(theme)}`, color: txt(theme), fontSize: '15px' }} />
            ) : (
              <p className="font-bold" style={{ color: txt(theme), fontSize: '17px', letterSpacing: '-0.3px' }}>{name}</p>
            )}
            {editing ? (
              <input value={title} onChange={e => setTitle(e.target.value)} className="w-full rounded-xl px-3 py-2 outline-none" style={{ background: '#F8FAFC', border: `1.5px solid ${bdr(theme)}`, color: sub(theme), fontSize: '13px' }} />
            ) : (
              <p style={{ color: sub(theme), fontSize: '13px' }}>{title}</p>
            )}
          </div>
        </div>

        <div style={{ borderTop: `1px solid ${bdr(theme)}`, paddingTop: '16px' }}>
          <p className="mb-1" style={{ color: muted(theme), fontSize: '11px', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Email</p>
          {editing ? (
            <input value={email} onChange={e => setEmail(e.target.value)} className="w-full rounded-xl px-3 py-2 outline-none" style={{ background: '#F8FAFC', border: `1.5px solid ${bdr(theme)}`, color: txt(theme), fontSize: '14px' }} />
          ) : (
            <p style={{ color: txt(theme), fontSize: '14px' }}>{email}</p>
          )}
        </div>

        <div className="flex items-center gap-2 mt-4 pt-4" style={{ borderTop: `1px solid ${bdr(theme)}` }}>
          <div className="rounded-full px-2.5 py-1 flex items-center gap-1.5" style={{ background: 'rgba(51,209,172,0.1)', border: '1px solid rgba(51,209,172,0.25)' }}>
            <div className="w-1.5 h-1.5 rounded-full" style={{ background: '#33D1AC', animation: 'live-dot 1.4s ease-in-out infinite' }} />
            <span style={{ color: '#33D1AC', fontSize: '11px', fontWeight: 700 }}>SSO Verified · Google</span>
          </div>
          <div className="rounded-full px-2.5 py-1" style={{ background: 'rgba(15,47,44,0.08)', border: '1px solid rgba(15,47,44,0.2)' }}>
            <span style={{ color: dk, fontSize: '11px', fontWeight: 700 }}>
              {role === 'admin' ? 'Admin' : role === 'presenter' ? 'Presenter' : 'Attendee'}
            </span>
          </div>
        </div>
      </div>

      {/* Quick links */}
      <div className="mx-5 rounded-2xl overflow-hidden mb-4" style={{ background: card(theme), border: `1px solid ${bdr(theme)}` }}>
        <button onClick={() => nav(role === 'presenter' ? 'presenterRoster' : 'attendeeConfirmed')} className="w-full flex items-center gap-3 px-4 py-3.5 transition-all active:scale-98" style={{ borderBottom: `1px solid ${bdr(theme)}`, background: 'transparent', textAlign: 'left' }}>
          <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: '#F1F5F9' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke={sub(theme)} strokeWidth="2"/><path d="M12 6v6l4 2" stroke={sub(theme)} strokeWidth="2" strokeLinecap="round"/></svg>
          </div>
          <span className="flex-1 font-medium" style={{ color: txt(theme), fontSize: '14px' }}>Session History</span>
          <span style={{ color: muted(theme), fontSize: '13px' }}>14 sessions</span>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M9 18l6-6-6-6" stroke={muted(theme)} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
        </button>
        <button onClick={() => {}} className="w-full flex items-center gap-3 px-4 py-3.5 transition-all active:scale-98" style={{ background: 'transparent', textAlign: 'left' }}>
          <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: '#F1F5F9' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" stroke={sub(theme)} strokeWidth="2" strokeLinejoin="round"/></svg>
          </div>
          <span className="flex-1 font-medium" style={{ color: txt(theme), fontSize: '14px' }}>Privacy &amp; Security</span>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M9 18l6-6-6-6" stroke={muted(theme)} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
        </button>
      </div>

      <button onClick={() => nav('login')} className="mx-5 mb-8 rounded-2xl py-3.5 font-semibold text-sm" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', color: '#EF4444' }}>
        Sign Out
      </button>
    </div>
  )
}

function PresenterSetupScreen({ theme, nav }: { theme: Theme; nav: (s: Screen) => void }) {
  const [sessionCode] = useState('poc-session-241')
  const [activeRoom, setActiveRoom] = useState('Hall A')
  const [rooms, setRooms] = useState(['Hall A', 'Workshop 1', 'Auditorium', 'Room B'])
  const [showNewModal, setShowNewModal] = useState(false)
  const [newRoomInput, setNewRoomInput] = useState('')

  const addRoom = () => {
    const name = newRoomInput.trim()
    if (!name) return
    setRooms(r => [...r, name])
    setActiveRoom(name)
    setNewRoomInput('')
    setShowNewModal(false)
  }

  return (
    <div className="flex flex-col h-full relative" style={{ background: surf(theme) }}>
      <TopBar theme={theme} title="Choose Room" subtitle="Presenter Configuration" onBack={() => nav('home')} />
      <div className="flex-1 px-5 overflow-y-auto pb-4">
        {/* Room chip selector */}
        <p className="mb-2" style={{ color: sub(theme), fontSize: '11px', fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase' }}>Select Room</p>
        <div className="flex gap-2 overflow-x-auto pb-2 mb-5 -mx-5 px-5">
          {rooms.map(r => (
            <RoomChip key={r} label={r} active={activeRoom === r} theme={theme} onClick={() => setActiveRoom(r)} />
          ))}
          <button onClick={() => setShowNewModal(true)} className="rounded-full px-4 py-1.5 text-sm font-semibold whitespace-nowrap flex-shrink-0 transition-all flex items-center gap-1" style={{ background: theme === 'dark' ? 'rgba(34,49,71,0.5)' : 'rgba(226,232,240,0.5)', border: `1.5px dashed ${bdr(theme)}`, color: sub(theme), fontSize: '13px' }}>
            <span style={{ fontSize: '16px', lineHeight: 1 }}>+</span> New
          </button>
        </div>

        {/* Active room indicator */}
        <div className="rounded-xl px-4 py-3 mb-4 flex items-center gap-3" style={{ background: 'rgba(51,209,172,0.08)', border: '1px solid rgba(51,209,172,0.25)' }}>
          <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: '#33D1AC', animation: 'live-dot 1.4s ease-in-out infinite' }} />
          <div>
            <p style={{ color: '#33D1AC', fontSize: '13px', fontWeight: 700 }}>{activeRoom}</p>
            <p style={{ color: muted(theme), fontSize: '11px' }}>Selected anchor room</p>
          </div>
        </div>

        {/* Session Code (only field remaining) */}
        <div className="mb-4">
          <label className="block mb-1.5" style={{ color: sub(theme), fontSize: '12px', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Session Code</label>
          <div className="w-full rounded-xl px-4 py-3" style={{ background: card(theme), border: `1.5px solid ${bdr(theme)}`, color: txt(theme), fontFamily: "'JetBrains Mono', monospace", fontSize: '14px' }}>{sessionCode}</div>
        </div>

        <div className="rounded-xl px-4 py-3 mb-4" style={{ background: card(theme), border: `1px solid ${bdr(theme)}` }}>
          <div className="flex items-center justify-between">
            <span style={{ color: sub(theme), fontSize: '13px', fontWeight: 500 }}>Server Environment</span>
            <div className="flex items-center gap-1.5 rounded-full px-2.5 py-1" style={{ background: 'rgba(51,209,172,0.12)', border: '1px solid rgba(51,209,172,0.3)' }}>
              <div className="w-1.5 h-1.5 rounded-full" style={{ background: '#33D1AC' }} />
              <span style={{ color: '#33D1AC', fontSize: '11px', fontWeight: 700, fontFamily: "'JetBrains Mono', monospace" }}>CLOUD · 18ms</span>
            </div>
          </div>
        </div>
        <div className="rounded-xl p-4" style={{ background: card(theme), border: `1px solid ${bdr(theme)}` }}>
          <p className="mb-2" style={{ color: sub(theme), fontSize: '12px', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Sensor Readiness</p>
          <div className="flex flex-wrap gap-1.5">
            <SensorPill label="BLE Mesh" status="active" />
            <SensorPill label="Wi-Fi" status="active" />
            <SensorPill label="Ultrasonic" status="active" />
            <SensorPill label="Motion" status="active" />
          </div>
        </div>
      </div>
      <div className="px-5 pb-10 pt-3">
        <button onClick={() => nav('presenterDashboard')} className="w-full rounded-2xl py-4 font-bold text-base transition-all active:scale-95" style={{ background: '#33D1AC', color: '#0B0F17' }}>
          Start Broadcasting Presence
        </button>
      </div>

      {/* "+ New Room" modal */}
      {showNewModal && (
        <div className="absolute inset-0 flex items-end justify-center" style={{ background: 'rgba(0,0,0,0.45)', zIndex: 50 }} onClick={() => setShowNewModal(false)}>
          <div onClick={e => e.stopPropagation()} style={{ width: '100%', background: theme === 'dark' ? '#131C2E' : '#FFFFFF', borderRadius: '28px 28px 0 0', padding: '24px 20px 36px', animation: 'slide-up 0.28s ease-out', border: `1px solid ${bdr(theme)}` }}>
            <div className="w-10 h-1 rounded-full mx-auto mb-5" style={{ background: bdr(theme) }} />
            <h3 className="font-bold mb-1" style={{ color: txt(theme), fontSize: '17px', letterSpacing: '-0.3px' }}>Add New Room Anchor</h3>
            <p style={{ color: muted(theme), fontSize: '13px', marginBottom: '20px' }}>Enter the room identifier to broadcast</p>
            <input
              value={newRoomInput}
              onChange={e => setNewRoomInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addRoom()}
              placeholder="e.g., Hall C, Innovation Lab, Boardroom"
              autoFocus
              className="w-full rounded-xl px-4 py-3 outline-none mb-4"
              style={{ background: surf(theme), border: `1.5px solid ${bdr(theme)}`, color: txt(theme), fontSize: '14px' }}
            />
            <div className="flex gap-3">
              <button onClick={() => setShowNewModal(false)} className="flex-1 rounded-xl py-3 font-semibold text-sm" style={{ background: 'transparent', border: `1px solid ${bdr(theme)}`, color: sub(theme) }}>Cancel</button>
              <button onClick={addRoom} className="flex-1 rounded-xl py-3 font-semibold text-sm transition-all active:scale-95" style={{ background: '#33D1AC', color: '#0B0F17', opacity: newRoomInput.trim() ? 1 : 0.5 }}>Add &amp; Select Room</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function PresenterDashboardScreen({ theme, nav }: { theme: Theme; nav: (s: Screen) => void }) {
  const [count, setCount] = useState(24)
  const [showDiag, setShowDiag] = useState(false)

  return (
    <div className="flex flex-col h-full overflow-y-auto" style={{ background: surf(theme) }}>
      <div className="flex items-center justify-between px-5 pt-4 pb-2 flex-shrink-0">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="font-bold" style={{ color: txt(theme), fontSize: '17px', letterSpacing: '-0.3px' }}>Hall A</h2>
            <LiveBadge />
          </div>
          <p style={{ color: muted(theme), fontSize: '11px', fontFamily: "'JetBrains Mono', monospace", marginTop: '2px' }}>poc-session-241 · Started 38m ago</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowDiag(true)} className="w-9 h-9 rounded-full flex items-center justify-center" style={{ background: theme === 'dark' ? 'rgba(34,49,71,0.5)' : 'rgba(226,232,240,0.5)' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12" stroke={sub(theme)} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
          <button className="w-9 h-9 rounded-full flex items-center justify-center" style={{ background: theme === 'dark' ? 'rgba(34,49,71,0.5)' : 'rgba(226,232,240,0.5)' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="3" stroke={sub(theme)} strokeWidth="2"/><path d="M12 2v2m0 16v2M4.22 4.22l1.42 1.42m12.72 12.72l1.42 1.42M2 12h2m16 0h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" stroke={sub(theme)} strokeWidth="2" strokeLinecap="round"/></svg>
          </button>
        </div>
      </div>
      <div className="flex-shrink-0 flex justify-center py-6">
        <LivingRadar theme={theme} participantCount={6} />
      </div>
      <div className="mx-5 rounded-2xl p-5 flex-shrink-0" style={{ background: card(theme), border: `1px solid ${bdr(theme)}`, marginTop: '28px' }}>
        <div className="flex items-end justify-between mb-3">
          <div>
            <p style={{ color: muted(theme), fontSize: '11px', fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: '4px' }}>Verified Attendees</p>
            <div className="flex items-end gap-3">
              <HeroCounter value={count} theme={theme} />
              <div className="flex flex-col gap-1 mb-2">
                <button onClick={() => setCount(c => c + 1)} className="text-xs rounded-md px-2 py-0.5" style={{ background: 'rgba(51,209,172,0.15)', color: '#33D1AC' }}>+1</button>
                <button onClick={() => setCount(c => Math.max(0, c - 1))} className="text-xs rounded-md px-2 py-0.5" style={{ background: 'rgba(100,116,139,0.15)', color: muted(theme) }}>-1</button>
              </div>
            </div>
          </div>
          <div className="flex flex-col items-end gap-1">
            <span style={{ color: muted(theme), fontSize: '11px' }}>Peak: 31</span>
            <span style={{ color: muted(theme), fontSize: '11px' }}>Duration: 38m</span>
          </div>
        </div>
        <div className="flex gap-1.5 flex-wrap">
          <SensorPill label="BLE" status="active" />
          <SensorPill label="Wi-Fi" status="active" />
          <SensorPill label="Ultrasonic" status="active" />
          <SensorPill label="Motion" status="warn" />
        </div>
      </div>

      {/* Live Attendee Preview */}
      <div className="px-5 mt-4 mb-2 flex-shrink-0">
        <div className="flex items-center justify-between mb-3">
          <span style={{ color: sub(theme), fontSize: '13px', fontWeight: 600 }}>Live Attendees</span>
          <LiveBadge label={`${count} VERIFIED`} />
        </div>
        <div className="rounded-2xl overflow-hidden" style={{ background: card(theme), border: `1px solid ${bdr(theme)}` }}>
          {[
            { name: 'Dr. Alice Chen', role: 'Host' as const, dwell: '38m 12s', wifiMatch: '97%', bleActive: true, ultraVerified: true, motionFlag: false },
            { name: 'Marcus Reyes', role: 'Attendee' as const, dwell: '22m 04s', wifiMatch: '94%', bleActive: true, ultraVerified: true, motionFlag: false },
            { name: 'Jess Park', role: 'Attendee' as const, dwell: '11m 48s', wifiMatch: '91%', bleActive: true, ultraVerified: false, motionFlag: true },
            { name: 'Sam Blackwood', role: 'Attendee' as const, dwell: '9m 33s', wifiMatch: '88%', bleActive: true, ultraVerified: true, motionFlag: false },
          ].map((a, i, arr) => (
            <div key={i} style={{ borderBottom: i < arr.length - 1 ? `1px solid ${bdr(theme)}` : 'none', padding: '10px 14px' }}>
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0" style={{
                  background: a.role === 'Host' ? 'rgba(51,209,172,0.18)' : 'rgba(56,189,248,0.15)',
                  color: a.role === 'Host' ? '#33D1AC' : '#38BDF8',
                  border: `1px solid ${a.role === 'Host' ? 'rgba(51,209,172,0.4)' : 'rgba(56,189,248,0.3)'}`,
                  fontSize: '9px',
                }}>
                  {a.name.split(' ').map(n => n[0]).join('')}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="font-semibold truncate" style={{ color: txt(theme), fontSize: '13px' }}>{a.name}</span>
                    {a.role === 'Host' && <span style={{ color: '#33D1AC', fontSize: '9px', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase' }}>HOST</span>}
                    {a.motionFlag && <span style={{ color: '#F59E0B', fontSize: '9px', fontWeight: 700 }}>⚠</span>}
                  </div>
                  <span style={{ color: muted(theme), fontSize: '10px', fontFamily: "'JetBrains Mono', monospace" }}>{a.dwell} · Wi-Fi {a.wifiMatch}</span>
                </div>
                <div className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(51,209,172,0.15)' }}>
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none"><path d="M5 13l4 4L19 7" stroke="#33D1AC" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                </div>
              </div>
            </div>
          ))}
          <button onClick={() => nav('presenterRoster')} className="w-full flex items-center justify-center gap-2 py-3 transition-all active:scale-98" style={{ background: 'rgba(51,209,172,0.06)', border: 'none', borderTop: `1px solid ${bdr(theme)}` }}>
            <span style={{ color: '#33D1AC', fontSize: '13px', fontWeight: 700 }}>View Full Roster ({count})</span>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M9 18l6-6-6-6" stroke="#33D1AC" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
        </div>
      </div>

      <div className="px-5 pb-6 pt-3 flex-shrink-0">
        <button onClick={() => nav('sessionEnd')} className="w-full rounded-xl py-3 font-semibold text-sm transition-all active:scale-95" style={{
          background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#EF4444',
        }}>End Session</button>
      </div>
      {showDiag && (
        <div className="absolute inset-0 flex flex-col justify-end" style={{ background: 'rgba(0,0,0,0.5)' }} onClick={() => setShowDiag(false)}>
          <div onClick={e => e.stopPropagation()} style={{ background: theme === 'dark' ? '#0F1923' : '#F8FAFC', borderRadius: '28px 28px 0 0', animation: 'slide-up 0.3s ease-out', maxHeight: '70%', overflow: 'hidden' }}>
            <DiagnosticsContent theme={theme} onClose={() => setShowDiag(false)} />
          </div>
        </div>
      )}
    </div>
  )
}

function PresenterRosterScreen({ theme, nav }: { theme: Theme; nav: (s: Screen) => void }) {
  const [search, setSearch] = useState('')
  const [expandedSession, setExpandedSession] = useState<string | null>(null)
  const attendees = [
    { name: 'Dr. Alice Chen', role: 'Host' as const, dwell: '38m 12s', ultra: true, wifi: '97%', ble: true, motion: false },
    { name: 'Marcus Reyes', role: 'Attendee' as const, dwell: '22m 04s', ultra: true, wifi: '94%', ble: true, motion: false },
    { name: 'Jess Park', role: 'Attendee' as const, dwell: '11m 48s', ultra: false, wifi: '91%', ble: true, motion: true },
    { name: 'Sam Blackwood', role: 'Attendee' as const, dwell: '9m 33s', ultra: true, wifi: '88%', ble: true, motion: false },
    { name: 'Tariq Weston', role: 'Attendee' as const, dwell: '7m 20s', ultra: true, wifi: '95%', ble: true, motion: false },
    { name: 'Lena Kim', role: 'Attendee' as const, dwell: '5m 14s', ultra: true, wifi: '90%', ble: false, motion: false },
    { name: 'Omar Diaz', role: 'Attendee' as const, dwell: '4m 02s', ultra: true, wifi: '93%', ble: true, motion: false },
    { name: 'Priya Nair', role: 'Attendee' as const, dwell: '2m 55s', ultra: false, wifi: '85%', ble: true, motion: true },
  ]
  const filtered = attendees.filter(a => a.name.toLowerCase().includes(search.toLowerCase()))

  const pastSessions = [
    { id: 'sep10-ws1', room: 'Workshop 1', date: 'Sep 10', time: '2:15 PM', count: 12, duration: '52m', attendees: ['Marcus Reyes', 'Jess Park', 'Sam Blackwood', 'Tariq Weston', 'Lena Kim', 'Omar Diaz', 'Priya Nair', 'Ben Okafor', 'Sofia Marchetti', 'Chris Yuen', 'Amara Diallo', 'Raj Patel'] },
    { id: 'sep9-aud', room: 'Auditorium', date: 'Sep 9', time: '9:00 AM', count: 85, duration: '1h 14m', attendees: ['Marcus Reyes', 'Jess Park', 'Sam Blackwood', 'Tariq Weston', '+ 81 more'] },
    { id: 'sep8-halla', room: 'Hall A', date: 'Sep 8', time: '11:30 AM', count: 19, duration: '29m', attendees: ['Marcus Reyes', 'Jess Park', 'Sam Blackwood', 'Tariq Weston', 'Lena Kim', 'Omar Diaz', 'Priya Nair', 'Ben Okafor', 'Sofia Marchetti', '+ 10 more'] },
  ]

  return (
    <div className="flex flex-col h-full overflow-y-auto" style={{ background: surf(theme) }}>
      <div className="px-5 pt-5 pb-3 flex-shrink-0">
        <h2 className="font-bold" style={{ color: txt(theme), fontSize: '20px', letterSpacing: '-0.4px' }}>Roster</h2>
      </div>

      {/* Current Session */}
      <div className="px-5 mb-5 flex-shrink-0">
        <div className="flex items-center gap-2 mb-3">
          <LiveBadge label="CURRENT SESSION" />
        </div>
        <div className="mb-3 px-3 py-2 rounded-xl flex items-center justify-between" style={{ background: 'rgba(51,209,172,0.08)', border: '1px solid rgba(51,209,172,0.2)' }}>
          <span style={{ color: dk, fontSize: '14px', fontWeight: 600 }}>Hall A · poc-session-241</span>
          <span style={{ color: '#33D1AC', fontSize: '12px', fontWeight: 700, fontFamily: "'JetBrains Mono', monospace" }}>{attendees.length} verified</span>
        </div>
        <div className="relative mb-3">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2" width="15" height="15" viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="8" stroke={muted(theme)} strokeWidth="2"/><path d="M21 21l-4.35-4.35" stroke={muted(theme)} strokeWidth="2" strokeLinecap="round"/></svg>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search attendees..." className="w-full rounded-xl pl-9 pr-4 py-2.5 text-sm outline-none" style={{ background: card(theme), border: `1px solid ${bdr(theme)}`, color: txt(theme) }} />
        </div>
        <div className="flex flex-col gap-2">
          {filtered.map((a, i) => (
            <ParticipantCard key={i} theme={theme} name={a.name} role={a.role} dwell={a.dwell} ultraVerified={a.ultra} wifiMatch={a.wifi} bleActive={a.ble} motionFlag={a.motion} />
          ))}
        </div>
      </div>

      {/* Session History */}
      <div className="px-5 pb-6 flex-shrink-0">
        <p className="mb-3 font-semibold" style={{ color: sub(theme), fontSize: '11px', letterSpacing: '0.07em', textTransform: 'uppercase' }}>Session History</p>
        <div className="flex flex-col gap-2">
          {pastSessions.map(s => (
            <div key={s.id} className="rounded-xl overflow-hidden" style={{ background: card(theme), border: `1px solid ${bdr(theme)}`, boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}>
              <button
                onClick={() => setExpandedSession(expandedSession === s.id ? null : s.id)}
                className="w-full flex items-center justify-between px-4 py-3.5 text-left transition-all"
                style={{ background: 'transparent', border: 'none' }}
              >
                <div>
                  <p className="font-semibold" style={{ color: txt(theme), fontSize: '14px' }}>{s.room}</p>
                  <p style={{ color: muted(theme), fontSize: '11px', fontFamily: "'JetBrains Mono', monospace" }}>{s.date} · {s.time} · {s.duration}</p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className="rounded-full px-2.5 py-0.5" style={{ background: 'rgba(51,209,172,0.1)', border: '1px solid rgba(51,209,172,0.25)', color: '#33D1AC', fontSize: '11px', fontWeight: 700 }}>{s.count}</span>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" style={{ transform: expandedSession === s.id ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}><path d="M9 18l6-6-6-6" stroke={muted(theme)} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                </div>
              </button>
              {expandedSession === s.id && (
                <div style={{ borderTop: `1px solid ${bdr(theme)}`, padding: '12px 16px' }}>
                  <p className="mb-2" style={{ color: muted(theme), fontSize: '11px', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Attendees</p>
                  <div className="flex flex-col gap-1">
                    {s.attendees.map((name, i) => (
                      <div key={i} className="flex items-center gap-2 py-1">
                        {!name.startsWith('+') && (
                          <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0" style={{ background: 'rgba(51,209,172,0.12)', color: '#33D1AC', fontSize: '9px' }}>
                            {name.split(' ').map(n => n[0]).join('').slice(0,2)}
                          </div>
                        )}
                        <span style={{ color: name.startsWith('+') ? muted(theme) : txt(theme), fontSize: '13px', fontStyle: name.startsWith('+') ? 'italic' : 'normal' }}>{name}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function SessionEndScreen({ theme, nav }: { theme: Theme; nav: (s: Screen) => void }) {
  const stats = [
    { label: 'Total Unique Attendees', value: '24', color: '#33D1AC' },
    { label: 'Peak Concurrency', value: '31', color: '#38BDF8' },
    { label: 'Average Duration', value: '18m 42s', color: '#2DD4BF' },
    { label: 'Ultrasonic Coverage', value: '87%', color: '#A78BFA' },
  ]
  return (
    <div className="flex flex-col h-full" style={{ background: surf(theme) }}>
      <div className="flex-1 flex flex-col items-center px-5 pt-14 text-center">
        <div className="w-20 h-20 rounded-full flex items-center justify-center mb-6" style={{
          background: 'rgba(51,209,172,0.15)', border: '2px solid rgba(51,209,172,0.4)',
          animation: 'shield-pop 0.6s cubic-bezier(0.34, 1.56, 0.64, 1) both',
        }}>
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none"><path d="M5 13l4 4L19 7" stroke="#33D1AC" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
        </div>
        <h2 className="font-bold mb-1" style={{ fontSize: '24px', color: txt(theme), letterSpacing: '-0.5px' }}>Session Complete</h2>
        <p style={{ color: sub(theme), fontSize: '14px' }}>Hall A · poc-session-241</p>
        <p style={{ color: muted(theme), fontSize: '12px', fontFamily: "'JetBrains Mono', monospace", marginTop: '4px' }}>Duration: 38m 12s</p>
        <div className="w-full mt-8 grid grid-cols-2 gap-3">
          {stats.map(s => (
            <div key={s.label} className="rounded-2xl p-4 text-left" style={{ background: card(theme), border: `1px solid ${bdr(theme)}` }}>
              <p style={{ color: s.color, fontSize: '24px', fontWeight: 700, fontFamily: "'JetBrains Mono', monospace", letterSpacing: '-1px' }}>{s.value}</p>
              <p style={{ color: sub(theme), fontSize: '11px', marginTop: '4px' }}>{s.label}</p>
            </div>
          ))}
        </div>
      </div>
      <div className="px-5 pb-6 flex flex-col gap-3">
        <button className="w-full rounded-2xl py-4 font-bold text-base transition-all active:scale-95" style={{ background: '#33D1AC', color: '#0B0F17' }}>Export Attendance Report</button>
        <div className="flex gap-3">
          <button className="flex-1 rounded-xl py-3 font-semibold text-sm" style={{ background: card(theme), border: `1px solid ${bdr(theme)}`, color: sub(theme) }}>Share CSV</button>
          <button className="flex-1 rounded-xl py-3 font-semibold text-sm" style={{ background: card(theme), border: `1px solid ${bdr(theme)}`, color: sub(theme) }}>Save PDF</button>
        </div>
        <button onClick={() => nav('home')} style={{ color: muted(theme), fontSize: '13px', textAlign: 'center', paddingTop: '4px' }}>Return to Home</button>
      </div>
    </div>
  )
}

function AttendeeDiscoveryScreen({ theme, nav }: { theme: Theme; nav: (s: Screen) => void }) {
  const [phase, setPhase] = useState(0)
  const phases = ['Scanning BLE mesh signals...', 'Sampling Wi-Fi fingerprint...', 'Listening for acoustic gate...', 'Computing presence vector...']

  useEffect(() => {
    const t = setInterval(() => setPhase(p => (p + 1) % phases.length), 1800)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    const t = setTimeout(() => nav('attendeeConfirmed'), 7000)
    return () => clearTimeout(t)
  }, [nav])

  return (
    <div className="flex flex-col items-center justify-center h-full relative overflow-hidden" style={{ background: theme === 'dark' ? dk : '#F0F9FF' }}>
      {[1, 2, 3, 4].map(i => (
        <div key={i} className="absolute rounded-full" style={{
          width: `${i * 23}%`, height: `${i * 23}%`,
          border: `1px solid rgba(2,132,199,${0.2 - i * 0.04})`,
          animation: `radar-pulse 2.8s ease-out ${i * 0.7}s infinite`,
        }} />
      ))}
      <div className="relative z-10 flex flex-col items-center text-center px-8">
        <LivingRadar theme={theme} scanning participantCount={0} />
        <div className="mt-16">
          <h2 className="font-bold mb-2" style={{ fontSize: '22px', color: txt(theme), letterSpacing: '-0.5px' }}>Detecting Your Room</h2>
          <p key={phase} style={{ color: '#38BDF8', fontSize: '13px', fontFamily: "'JetBrains Mono', monospace", animation: 'fade-in 0.4s ease-out' }}>
            {phases[phase]}
          </p>
          <div className="flex justify-center gap-1.5 mt-6">
            {phases.map((_, i) => (
              <div key={i} className="w-1.5 h-1.5 rounded-full transition-all" style={{ background: i === phase ? '#38BDF8' : 'rgba(56,189,248,0.25)', transform: i === phase ? 'scale(1.4)' : 'scale(1)' }} />
            ))}
          </div>
        </div>
        <p style={{ color: muted(theme), fontSize: '12px', marginTop: '32px', lineHeight: '20px' }}>Keep app open and stay in the room.<br />Detection typically takes 5–10 seconds.</p>
      </div>
      <button onClick={() => nav('attendeeConfirmed')} className="absolute bottom-10" style={{ color: muted(theme), fontSize: '12px' }}>Simulate confirmed →</button>
    </div>
  )
}

function AttendeeConfirmedScreen({ theme, nav }: { theme: Theme; nav: (s: Screen) => void }) {
  const [elapsed, setElapsed] = useState(1122)
  useEffect(() => { const t = setInterval(() => setElapsed(e => e + 1), 1000); return () => clearInterval(t) }, [])
  const fmt = (s: number) => `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`

  const history = [
    { room: 'Hall A', date: 'Sep 11', time: '10:00 AM', duration: '38m 12s', status: 'Verified', anchor: 'Dr. Alice Chen' },
    { room: 'Workshop 1', date: 'Sep 10', time: '2:15 PM', duration: '52m 04s', status: 'Verified', anchor: 'Marcus Reyes' },
    { room: 'Auditorium', date: 'Sep 9', time: '9:00 AM', duration: '1h 14m', status: 'Verified', anchor: 'Sarah Oduya' },
    { room: 'Hall A', date: 'Sep 8', time: '11:30 AM', duration: '29m 00s', status: 'Verified', anchor: 'Dr. Alice Chen' },
    { room: 'Room B', date: 'Sep 7', time: '3:00 PM', duration: '18m 45s', status: 'Verified', anchor: 'Tariq Weston' },
  ]

  return (
    <div className="flex flex-col h-full overflow-y-auto" style={{ background: surf(theme) }}>
      {/* Header */}
      <div className="px-5 pt-5 pb-3 flex-shrink-0">
        <h2 className="font-bold" style={{ color: txt(theme), fontSize: '20px', letterSpacing: '-0.4px' }}>My Activity</h2>
      </div>

      {/* Live Session section */}
      <div className="px-5 mb-5">
        <p className="mb-3 font-semibold" style={{ color: sub(theme), fontSize: '11px', letterSpacing: '0.07em', textTransform: 'uppercase' }}>Current Session</p>
        <div className="rounded-2xl p-4" style={{ background: card(theme), border: '1px solid rgba(51,209,172,0.3)', boxShadow: '0 2px 12px rgba(51,209,172,0.08)' }}>
          <div className="flex flex-col items-center text-center mb-4">
            <div className="relative mb-4" style={{ animation: 'shield-pop 0.7s cubic-bezier(0.34, 1.56, 0.64, 1) both' }}>
              <div className="w-20 h-20 rounded-full flex items-center justify-center" style={{
                background: 'radial-gradient(circle, rgba(51,209,172,0.3) 0%, rgba(51,209,172,0.05) 70%)',
                border: '2px solid rgba(51,209,172,0.5)',
                boxShadow: '0 0 30px rgba(51,209,172,0.25)',
              }}>
                <svg width="36" height="36" viewBox="0 0 24 24" fill="none">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" fill="rgba(51,209,172,0.15)" stroke="#33D1AC" strokeWidth="2" strokeLinejoin="round"/>
                  <path d="M8 12l3 3 5-6" stroke="#33D1AC" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>
              {[1, 2].map(i => (
                <div key={i} className="absolute inset-0 rounded-full" style={{ border: '1.5px solid rgba(51,209,172,0.4)', animation: `radar-pulse 2s ease-out ${i * 0.5}s infinite` }} />
              ))}
            </div>
            <h3 className="font-bold mb-0.5" style={{ fontSize: '16px', color: txt(theme), letterSpacing: '-0.3px' }}>Verified in Hall A</h3>
            <p style={{ color: sub(theme), fontSize: '13px', marginBottom: '8px' }}>Anchored to Dr. Alice Chen</p>
            <div className="rounded-full px-4 py-1.5 flex items-center gap-2" style={{ background: 'rgba(51,209,172,0.1)', border: '1px solid rgba(51,209,172,0.3)' }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="#33D1AC" strokeWidth="2"/><path d="M12 6v6l4 2" stroke="#33D1AC" strokeWidth="2" strokeLinecap="round"/></svg>
              <span style={{ color: '#33D1AC', fontSize: '13px', fontWeight: 600, fontFamily: "'JetBrains Mono', monospace" }}>Present for {fmt(elapsed)}</span>
            </div>
          </div>
          <div style={{ borderTop: `1px solid ${bdr(theme)}`, paddingTop: '12px' }}>
            <p className="mb-2" style={{ color: sub(theme), fontSize: '11px', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Verification Stack</p>
            {[
              { label: '🔊 Ultrasonic Gate', value: 'Decoded 18.7 kHz token', color: '#2DD4BF' },
              { label: '📡 BLE Mesh', value: 'RSSI proximity confirmed', color: '#38BDF8' },
              { label: '📶 Wi-Fi Affinity', value: '94% cosine similarity', color: '#33D1AC' },
              { label: '📱 Motion Dynamics', value: 'Device active · held', color: '#A78BFA' },
            ].map(r => (
              <div key={r.label} className="flex items-center justify-between py-1.5" style={{ borderBottom: `1px solid ${bdr(theme)}` }}>
                <span style={{ color: sub(theme), fontSize: '12px' }}>{r.label}</span>
                <span style={{ color: r.color, fontSize: '11px', fontWeight: 600, fontFamily: "'JetBrains Mono', monospace" }}>{r.value}</span>
              </div>
            ))}
          </div>
          <button onClick={() => nav('attendeeOutOfRange')} className="w-full mt-3 rounded-xl py-2.5 font-semibold text-sm" style={{ background: 'rgba(226,232,240,0.6)', border: `1px solid ${bdr(theme)}`, color: sub(theme) }}>
            Simulate leaving room
          </button>
        </div>
      </div>

      {/* Session History */}
      <div className="px-5 pb-6">
        <p className="mb-3 font-semibold" style={{ color: sub(theme), fontSize: '11px', letterSpacing: '0.07em', textTransform: 'uppercase' }}>Session History</p>
        <div className="flex flex-col gap-2">
          {history.map((s, i) => (
            <div key={i} className="rounded-xl p-3.5" style={{ background: card(theme), border: `1px solid ${bdr(theme)}`, boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}>
              <div className="flex items-start justify-between mb-1">
                <div>
                  <p className="font-semibold" style={{ color: txt(theme), fontSize: '14px' }}>{s.room}</p>
                  <p style={{ color: muted(theme), fontSize: '11px' }}>Anchor: {s.anchor}</p>
                </div>
                <span className="rounded-full px-2.5 py-0.5 flex-shrink-0" style={{ background: 'rgba(51,209,172,0.1)', border: '1px solid rgba(51,209,172,0.25)', color: '#33D1AC', fontSize: '10px', fontWeight: 700 }}>✓ {s.status}</span>
              </div>
              <div className="flex items-center gap-3 mt-2" style={{ borderTop: `1px solid ${bdr(theme)}`, paddingTop: '8px' }}>
                <span style={{ color: muted(theme), fontSize: '11px', fontFamily: "'JetBrains Mono', monospace" }}>{s.date} · {s.time}</span>
                <span style={{ color: bdr(theme) }}>·</span>
                <span style={{ color: '#33D1AC', fontSize: '11px', fontWeight: 600, fontFamily: "'JetBrains Mono', monospace" }}>{s.duration}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function AttendeeOutOfRangeScreen({ theme, nav }: { theme: Theme; nav: (s: Screen) => void }) {
  const [grace, setGrace] = useState(32)
  useEffect(() => {
    if (grace <= 0) { nav('attendeeDiscovery'); return }
    const t = setInterval(() => setGrace(g => g - 1), 1000)
    return () => clearInterval(t)
  }, [grace, nav])

  return (
    <div className="flex flex-col items-center justify-center h-full px-6 text-center" style={{ background: surf(theme) }}>
      <div className="w-24 h-24 rounded-full flex items-center justify-center mb-6" style={{ background: 'rgba(245,158,11,0.12)', border: '2px solid rgba(245,158,11,0.45)', animation: 'amber-glow 2s ease-in-out infinite' }}>
        <svg width="44" height="44" viewBox="0 0 24 24" fill="none">
          <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" stroke="#F59E0B" strokeWidth="2" strokeLinejoin="round"/>
          <line x1="12" y1="9" x2="12" y2="13" stroke="#F59E0B" strokeWidth="2" strokeLinecap="round"/>
          <line x1="12" y1="17" x2="12.01" y2="17" stroke="#F59E0B" strokeWidth="2.5" strokeLinecap="round"/>
        </svg>
      </div>
      <h2 className="font-bold mb-2" style={{ fontSize: '22px', color: txt(theme), letterSpacing: '-0.5px' }}>Out of Room Boundary</h2>
      <p style={{ color: sub(theme), fontSize: '14px', lineHeight: '22px', marginBottom: '24px' }}>Acoustic signals lost. Presence grace period active.</p>
      <div className="w-full rounded-2xl p-6 mb-4" style={{ background: card(theme), border: `1.5px solid rgba(245,158,11,0.35)` }}>
        <p style={{ color: muted(theme), fontSize: '12px', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: '8px' }}>Grace Period Remaining</p>
        <p style={{ color: '#F59E0B', fontSize: '52px', fontWeight: 700, fontFamily: "'JetBrains Mono', monospace", letterSpacing: '-2px', lineHeight: 1 }}>{grace}s</p>
        <div className="w-full rounded-full mt-4" style={{ background: bdr(theme), height: '4px' }}>
          <div className="rounded-full h-full transition-all" style={{ width: `${(grace / 32) * 100}%`, background: '#F59E0B' }} />
        </div>
        <p className="mt-3" style={{ color: muted(theme), fontSize: '12px' }}>Return to Hall A to maintain your verified presence record.</p>
      </div>
      <button onClick={() => nav('attendeeConfirmed')} className="w-full rounded-2xl py-4 font-bold transition-all active:scale-95" style={{ background: '#F59E0B', color: '#0B0F17' }}>Re-scan for Room</button>
      <button onClick={() => nav('home')} className="mt-3" style={{ color: muted(theme), fontSize: '13px' }}>Leave session</button>
    </div>
  )
}

// ─── Admin Overview ───────────────────────────────────────────────────────────

const ROOM_DATA: RoomData[] = [
  { name: 'Hall A', anchor: 'Dr. Alice Chen', count: 24, peak: 31, health: 'green', since: '38m' },
  { name: 'Workshop 1', anchor: 'Marcus Reyes', count: 12, peak: 14, health: 'green', since: '22m' },
  { name: 'Auditorium', anchor: 'Sarah Oduya', count: 85, peak: 92, health: 'amber', since: '1h 14m' },
  { name: 'Room B', anchor: 'Tariq Weston', count: 7, peak: 9, health: 'green', since: '11m' },
]

function AdminOverviewScreen({ theme, nav, onRoomSelect }: { theme: Theme; nav: (s: Screen) => void; onRoomSelect: (r: RoomData) => void }) {
  const [pressedRoom, setPressedRoom] = useState<string | null>(null)
  const totalAttendees = ROOM_DATA.reduce((a, r) => a + r.count, 0)

  const handleRoomTap = (room: RoomData) => {
    setPressedRoom(room.name)
    setTimeout(() => {
      setPressedRoom(null)
      onRoomSelect(room)
      nav('adminRoomDetail')
    }, 220)
  }

  return (
    <div className="flex flex-col h-full" style={{ background: surf(theme) }}>
      {/* Header */}
      <div className="px-5 pt-5 pb-3 flex-shrink-0">
        <div className="flex items-center gap-3 mb-1">
          <img src={xConnectLogoSrc} width={28} height={28} style={{ display: 'block', objectFit: 'contain', borderRadius: '6px' }} alt="XConnect" />
          <span className="font-bold" style={{ color: dk, fontSize: '17px', letterSpacing: '-0.3px' }}>XConnect</span>
          <div className="ml-auto flex items-center gap-1.5 rounded-full px-2.5 py-1" style={{ background: 'rgba(167,139,250,0.1)', border: '1px solid rgba(167,139,250,0.25)' }}>
            <span style={{ color: '#A78BFA', fontSize: '10px', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', fontFamily: "'JetBrains Mono', monospace" }}>Admin</span>
          </div>
        </div>
        <h2 className="font-bold" style={{ color: txt(theme), fontSize: '20px', letterSpacing: '-0.5px' }}>Room Overview</h2>
      </div>

      {/* Summary strip */}
      <div className="mx-5 mb-4 rounded-2xl p-4 flex-shrink-0" style={{
        background: theme === 'dark' ? 'linear-gradient(135deg, #131C2E 0%, #0F1928 100%)' : '#FFFFFF',
        border: `1px solid ${bdr(theme)}`,
        boxShadow: theme === 'dark' ? 'inset 0 1px 0 rgba(255,255,255,0.04), 0 4px 24px rgba(0,0,0,0.3)' : '0 2px 12px rgba(0,0,0,0.06)',
      }}>
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: 'Active Rooms', value: '4', color: '#33D1AC', glow: 'rgba(51,209,172,0.15)' },
            { label: 'Live Attendees', value: String(totalAttendees), color: '#38BDF8', glow: 'rgba(56,189,248,0.12)' },
            { label: 'Latency', value: '18ms', color: '#818CF8', glow: 'rgba(129,140,248,0.12)' },
          ].map(s => (
            <div key={s.label} className="text-center">
              <p style={{
                color: s.color, fontSize: '22px', fontWeight: 700,
                fontFamily: "'JetBrains Mono', monospace", letterSpacing: '-1px',
                textShadow: `0 0 16px ${s.glow}`,
              }}>{s.value}</p>
              <p style={{ color: muted(theme), fontSize: '10px', marginTop: '2px' }}>{s.label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Room cards */}
      <div className="flex-1 px-5 overflow-y-auto pb-4">
        <p style={{ color: muted(theme), fontSize: '11px', fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: '10px', fontFamily: "'JetBrains Mono', monospace" }}>
          Live Sessions · Tap to Audit
        </p>
        {ROOM_DATA.map(r => {
          const isPressed = pressedRoom === r.name
          const healthColor = r.health === 'amber' ? '#F59E0B' : '#33D1AC'
          const healthLabel = r.health === 'amber' ? 'Anomaly' : 'Healthy'
          const occupancyPct = Math.round((r.count / r.peak) * 100)

          return (
            <button
              key={r.name}
              onClick={() => handleRoomTap(r)}
              className="w-full text-left mb-3 rounded-2xl transition-all"
              style={{
                background: theme === 'dark'
                  ? 'linear-gradient(135deg, #131C2E 0%, #0F1928 100%)'
                  : '#FFFFFF',
                border: `1px solid ${bdr(theme)}`,
                boxShadow: theme === 'dark'
                  ? 'inset 0 1px 0 rgba(255,255,255,0.05), 0 4px 20px rgba(0,0,0,0.35)'
                  : '0 2px 12px rgba(0,0,0,0.06)',
                transform: isPressed ? 'scale(0.975)' : 'scale(1)',
                transition: 'transform 0.18s cubic-bezier(0.34,1.56,0.64,1)',
                padding: '16px',
              }}
            >
              <div className="flex items-start justify-between mb-3">
                <div>
                  <div className="flex items-center gap-2 mb-0.5">
                    <h3 className="font-bold" style={{ color: txt(theme), fontSize: '15px', letterSpacing: '-0.2px' }}>{r.name}</h3>
                    <span className="relative inline-flex items-center gap-1 rounded-full px-2 py-0.5" style={{
                      background: r.health === 'green' ? 'rgba(51,209,172,0.12)' : 'rgba(245,158,11,0.12)',
                      border: `1px solid ${r.health === 'green' ? 'rgba(51,209,172,0.35)' : 'rgba(245,158,11,0.35)'}`,
                    }}>
                      <PingDot color={healthColor} />
                      <span style={{ color: healthColor, fontSize: '9px', fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', fontFamily: "'JetBrains Mono', monospace", marginLeft: '2px' }}>
                        {healthLabel}
                      </span>
                    </span>
                  </div>
                  <p style={{ color: muted(theme), fontSize: '11px', fontFamily: "'JetBrains Mono', monospace" }}>
                    Anchor: {r.anchor} · {r.since}
                  </p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p style={{
                    color: '#33D1AC', fontSize: '32px', fontWeight: 700,
                    fontFamily: "'JetBrains Mono', monospace", letterSpacing: '-1.5px', lineHeight: 1,
                    textShadow: '0 0 20px rgba(51,209,172,0.4)',
                  }}>{r.count}</p>
                  <p style={{ color: '#818CF8', fontSize: '10px', fontFamily: "'JetBrains Mono', monospace" }}>
                    / {r.peak} peak
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex-1 rounded-full overflow-hidden" style={{ background: theme === 'dark' ? 'rgba(34,49,71,0.6)' : '#EEF2F7', height: '4px' }}>
                  <div className="h-full rounded-full transition-all" style={{
                    width: `${occupancyPct}%`,
                    background: r.health === 'amber'
                      ? 'linear-gradient(to right, #F59E0B, #FBBF24)'
                      : 'linear-gradient(to right, #33D1AC, #33D1AC)',
                    boxShadow: `0 0 6px ${healthColor}50`,
                  }} />
                </div>
                <span style={{ color: '#38BDF8', fontSize: '10px', fontWeight: 600, fontFamily: "'JetBrains Mono', monospace", flexShrink: 0 }}>
                  {occupancyPct}%
                </span>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
                  <path d="M9 18l6-6-6-6" stroke={muted(theme)} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>
            </button>
          )
        })}

        {/* Export controls */}
        <div className="rounded-xl p-3 mt-1" style={{ background: card(theme), border: `1px solid ${bdr(theme)}` }}>
          <p style={{ color: muted(theme), fontSize: '11px', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: '10px' }}>Compliance Export</p>
          <div className="flex gap-2">
            <button className="flex-1 rounded-xl py-2.5 font-semibold text-xs transition-all active:scale-95" style={{ background: 'rgba(51,209,172,0.12)', border: '1px solid rgba(51,209,172,0.3)', color: '#33D1AC' }}>
              Export All (CSV)
            </button>
            <button className="flex-1 rounded-xl py-2.5 font-semibold text-xs transition-all active:scale-95" style={{ background: 'rgba(129,140,248,0.12)', border: '1px solid rgba(129,140,248,0.3)', color: '#818CF8' }}>
              Full Report (PDF)
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Admin Room Detail ────────────────────────────────────────────────────────

interface AttendeeRecord {
  name: string
  email: string
  role: string
  joinTime: string
  leaveTime: string | null
  duration: string
  badge: { label: string; color: string; type: 'acoustic' | 'ble' }
  inactivityFlag: boolean
}

function buildAttendees(roomName: string): AttendeeRecord[] {
  const baseData: AttendeeRecord[] = [
    { name: 'Dr. Alice Chen', email: 'a.chen@corp.io', role: 'Anchor Host', joinTime: '10:00 AM', leaveTime: null, duration: '38m 12s', badge: { label: 'Acoustic Hard Gate 99%', color: '#33D1AC', type: 'acoustic' }, inactivityFlag: false },
    { name: 'Marcus Reyes', email: 'm.reyes@corp.io', role: 'Senior Engineer', joinTime: '10:04 AM', leaveTime: null, duration: '34m 08s', badge: { label: 'Acoustic Hard Gate 97%', color: '#33D1AC', type: 'acoustic' }, inactivityFlag: false },
    { name: 'Jess Park', email: 'j.park@corp.io', role: 'Product Manager', joinTime: '10:06 AM', leaveTime: null, duration: '32m 04s', badge: { label: 'BLE Mesh 92%', color: '#38BDF8', type: 'ble' }, inactivityFlag: true },
    { name: 'Sam Blackwood', email: 's.blackwood@corp.io', role: 'Designer', joinTime: '10:09 AM', leaveTime: null, duration: '29m 02s', badge: { label: 'Acoustic Hard Gate 98%', color: '#33D1AC', type: 'acoustic' }, inactivityFlag: false },
    { name: 'Tariq Weston', email: 't.weston@corp.io', role: 'Engineering Lead', joinTime: '10:10 AM', leaveTime: null, duration: '28m 00s', badge: { label: 'BLE Mesh 94%', color: '#38BDF8', type: 'ble' }, inactivityFlag: false },
    { name: 'Lena Kim', email: 'l.kim@corp.io', role: 'Data Analyst', joinTime: '10:11 AM', leaveTime: null, duration: '27m 01s', badge: { label: 'Acoustic Hard Gate 96%', color: '#33D1AC', type: 'acoustic' }, inactivityFlag: false },
    { name: 'Omar Diaz', email: 'o.diaz@corp.io', role: 'DevOps', joinTime: '10:14 AM', leaveTime: null, duration: '24m 08s', badge: { label: 'BLE Mesh 91%', color: '#38BDF8', type: 'ble' }, inactivityFlag: false },
    { name: 'Priya Nair', email: 'p.nair@corp.io', role: 'QA Engineer', joinTime: '10:16 AM', leaveTime: null, duration: '22m 04s', badge: { label: 'Acoustic Hard Gate 95%', color: '#33D1AC', type: 'acoustic' }, inactivityFlag: true },
    { name: 'Ben Okafor', email: 'b.okafor@corp.io', role: 'Backend Engineer', joinTime: '10:18 AM', leaveTime: null, duration: '20m 02s', badge: { label: 'BLE Mesh 88%', color: '#38BDF8', type: 'ble' }, inactivityFlag: false },
    { name: 'Sofia Marchetti', email: 's.marchetti@corp.io', role: 'UX Researcher', joinTime: '10:20 AM', leaveTime: null, duration: '18m 00s', badge: { label: 'Acoustic Hard Gate 99%', color: '#33D1AC', type: 'acoustic' }, inactivityFlag: false },
    { name: 'Chris Yuen', email: 'c.yuen@corp.io', role: 'Platform Engineer', joinTime: '10:21 AM', leaveTime: null, duration: '17m 01s', badge: { label: 'BLE Mesh 93%', color: '#38BDF8', type: 'ble' }, inactivityFlag: false },
    { name: 'Amara Diallo', email: 'a.diallo@corp.io', role: 'Compliance', joinTime: '10:22 AM', leaveTime: null, duration: '16m 08s', badge: { label: 'Acoustic Hard Gate 97%', color: '#33D1AC', type: 'acoustic' }, inactivityFlag: false },
    { name: 'Raj Patel', email: 'r.patel@corp.io', role: 'Architect', joinTime: '10:05 AM', leaveTime: '10:28 AM', duration: '23m 00s', badge: { label: 'Acoustic Hard Gate 98%', color: '#33D1AC', type: 'acoustic' }, inactivityFlag: false },
    { name: 'Hannah Cole', email: 'h.cole@corp.io', role: 'Scrum Master', joinTime: '10:07 AM', leaveTime: '10:31 AM', duration: '24m 00s', badge: { label: 'BLE Mesh 90%', color: '#38BDF8', type: 'ble' }, inactivityFlag: true },
    { name: 'Felix Wagner', email: 'f.wagner@corp.io', role: 'Security', joinTime: '10:09 AM', leaveTime: '10:22 AM', duration: '13m 00s', badge: { label: 'Acoustic Hard Gate 96%', color: '#33D1AC', type: 'acoustic' }, inactivityFlag: false },
    { name: 'Nina Brooks', email: 'n.brooks@corp.io', role: 'Customer Success', joinTime: '10:14 AM', leaveTime: '10:52 AM', duration: '38m 00s', badge: { label: 'BLE Mesh 87%', color: '#38BDF8', type: 'ble' }, inactivityFlag: false },
    { name: 'Leo Tanaka', email: 'l.tanaka@corp.io', role: 'ML Engineer', joinTime: '10:16 AM', leaveTime: '10:44 AM', duration: '28m 00s', badge: { label: 'Acoustic Hard Gate 94%', color: '#33D1AC', type: 'acoustic' }, inactivityFlag: false },
    { name: 'Zara Ahmed', email: 'z.ahmed@corp.io', role: 'Product Designer', joinTime: '10:19 AM', leaveTime: '10:35 AM', duration: '16m 00s', badge: { label: 'BLE Mesh 89%', color: '#38BDF8', type: 'ble' }, inactivityFlag: true },
    { name: 'Derek Chan', email: 'd.chan@corp.io', role: 'Infrastructure', joinTime: '10:23 AM', leaveTime: '10:47 AM', duration: '24m 00s', badge: { label: 'Acoustic Hard Gate 97%', color: '#33D1AC', type: 'acoustic' }, inactivityFlag: false },
  ]

  if (roomName === 'Workshop 1') return baseData.slice(0, 14)
  if (roomName === 'Auditorium') return baseData
  if (roomName === 'Room B') return baseData.slice(0, 10)
  return baseData
}

function AdminRoomDetailScreen({ theme, nav, room }: { theme: Theme; nav: (s: Screen) => void; room: RoomData }) {
  const [filter, setFilter] = useState<'all' | 'active' | 'left'>('all')
  const allAttendees = buildAttendees(room.name)
  const active = allAttendees.filter(a => !a.leaveTime)
  const left = allAttendees.filter(a => a.leaveTime)
  const displayed = filter === 'active' ? active : filter === 'left' ? left : allAttendees

  const filterTabs = [
    { key: 'all' as const, label: `All (${allAttendees.length})` },
    { key: 'active' as const, label: `In-Room (${active.length})` },
    { key: 'left' as const, label: `Left (${left.length})` },
  ]

  return (
    <div className="flex flex-col h-full" style={{ background: surf(theme) }}>
      <div className="px-5 pt-4 pb-3 flex-shrink-0">
        <div className="flex items-center gap-3 mb-3">
          <button onClick={() => nav('adminOverview')} className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: theme === 'dark' ? 'rgba(34,49,71,0.5)' : 'rgba(226,232,240,0.5)' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M15 18l-6-6 6-6" stroke={sub(theme)} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
          <div className="flex-1 min-w-0">
            <h2 className="font-bold" style={{ color: txt(theme), fontSize: '17px', letterSpacing: '-0.3px' }}>{room.name}</h2>
            <p style={{ color: muted(theme), fontSize: '11px', fontFamily: "'JetBrains Mono', monospace" }}>Anchor: {room.anchor}</p>
          </div>
          <div className="text-right flex-shrink-0">
            <p style={{ color: '#33D1AC', fontSize: '22px', fontWeight: 700, fontFamily: "'JetBrains Mono', monospace", letterSpacing: '-1px', lineHeight: 1, textShadow: '0 0 16px rgba(51,209,172,0.35)' }}>{room.count}</p>
            <p style={{ color: '#818CF8', fontSize: '10px', fontFamily: "'JetBrains Mono', monospace" }}>peak {room.peak}</p>
          </div>
        </div>
        <div className="flex gap-1.5">
          {filterTabs.map(tab => (
            <button
              key={tab.key}
              onClick={() => setFilter(tab.key)}
              className="rounded-full px-3 py-1.5 font-semibold transition-all"
              style={{
                background: filter === tab.key ? 'rgba(51,209,172,0.15)' : (theme === 'dark' ? 'rgba(34,49,71,0.4)' : 'rgba(226,232,240,0.6)'),
                border: `1px solid ${filter === tab.key ? 'rgba(51,209,172,0.4)' : bdr(theme)}`,
                color: filter === tab.key ? '#33D1AC' : muted(theme),
                fontSize: '12px',
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>
      <div className="flex-1 px-5 overflow-y-auto pb-2">
        {displayed.map((a, i) => {
          const initials = a.name.split(' ').map(n => n[0]).join('')
          const isActive = !a.leaveTime
          return (
            <div
              key={i}
              className="rounded-xl mb-2.5"
              style={{
                background: theme === 'dark' ? 'linear-gradient(135deg, #131C2E 0%, #0F1928 100%)' : '#FFFFFF',
                border: `1px solid ${bdr(theme)}`,
                boxShadow: theme === 'dark' ? 'inset 0 1px 0 rgba(255,255,255,0.04), 0 2px 12px rgba(0,0,0,0.25)' : '0 1px 6px rgba(0,0,0,0.05)',
                padding: '12px',
                animation: `fade-in 0.3s ease-out ${i * 0.04}s both`,
              }}
            >
              <div className="flex items-start gap-2.5 mb-2">
                <div className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0" style={{
                  background: isActive ? 'rgba(51,209,172,0.15)' : 'rgba(100,116,139,0.12)',
                  color: isActive ? '#33D1AC' : sub(theme),
                  border: `1px solid ${isActive ? 'rgba(51,209,172,0.35)' : bdr(theme)}`,
                }}>{initials}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="font-semibold" style={{ color: txt(theme), fontSize: '13px' }}>{a.name}</span>
                    <span style={{ color: muted(theme), fontSize: '11px' }}>· {a.email}</span>
                  </div>
                  <p style={{ color: muted(theme), fontSize: '11px' }}>{a.role}</p>
                </div>
                {isActive ? (
                  <span className="relative inline-flex items-center gap-1 rounded-full px-2 py-0.5 flex-shrink-0" style={{ background: 'rgba(51,209,172,0.12)', border: '1px solid rgba(51,209,172,0.3)' }}>
                    <PingDot color="#33D1AC" />
                    <span style={{ color: '#33D1AC', fontSize: '9px', fontWeight: 700, letterSpacing: '0.06em', marginLeft: '2px', fontFamily: "'JetBrains Mono', monospace" }}>ACTIVE</span>
                  </span>
                ) : (
                  <span className="rounded-full px-2 py-0.5 flex-shrink-0" style={{ background: 'rgba(100,116,139,0.1)', border: `1px solid ${bdr(theme)}` }}>
                    <span style={{ color: muted(theme), fontSize: '9px', fontWeight: 700, letterSpacing: '0.06em', fontFamily: "'JetBrains Mono', monospace" }}>LEFT</span>
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3 mb-2" style={{ borderTop: `1px solid ${bdr(theme)}`, paddingTop: '8px' }}>
                <div className="flex items-center gap-1">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none"><path d="M5 12h14" stroke="#33D1AC" strokeWidth="2" strokeLinecap="round"/><path d="M5 12l4-4M5 12l4 4" stroke="#33D1AC" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  <span style={{ color: muted(theme), fontSize: '10px' }}>Joined</span>
                  <span style={{ color: txt(theme), fontSize: '10px', fontWeight: 600, fontFamily: "'JetBrains Mono', monospace" }}>{a.joinTime}</span>
                </div>
                {a.leaveTime && (
                  <>
                    <span style={{ color: bdr(theme) }}>·</span>
                    <div className="flex items-center gap-1">
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none"><path d="M19 12H5" stroke="#EF4444" strokeWidth="2" strokeLinecap="round"/><path d="M19 12l-4-4M19 12l-4 4" stroke="#EF4444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                      <span style={{ color: muted(theme), fontSize: '10px' }}>Left</span>
                      <span style={{ color: txt(theme), fontSize: '10px', fontWeight: 600, fontFamily: "'JetBrains Mono', monospace" }}>{a.leaveTime}</span>
                    </div>
                  </>
                )}
                <span style={{ color: bdr(theme) }}>·</span>
                <div className="flex items-center gap-1">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="#818CF8" strokeWidth="2"/><path d="M12 6v6l4 2" stroke="#818CF8" strokeWidth="2" strokeLinecap="round"/></svg>
                  <span style={{ color: '#818CF8', fontSize: '10px', fontWeight: 600, fontFamily: "'JetBrains Mono', monospace" }}>{a.duration}</span>
                </div>
              </div>
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="rounded-full px-2 py-0.5" style={{ background: `${a.badge.color}12`, border: `1px solid ${a.badge.color}40`, color: a.badge.color, fontSize: '10px', fontWeight: 600 }}>
                  {a.badge.type === 'acoustic' ? '🔊' : '📡'} {a.badge.label}
                </span>
                {a.inactivityFlag && (
                  <span className="rounded-full px-2 py-0.5" style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.35)', color: '#F59E0B', fontSize: '10px', fontWeight: 600 }}>
                    ⚠️ Inactivity Flag
                  </span>
                )}
              </div>
            </div>
          )
        })}
      </div>
      <div className="px-5 pb-6 pt-2 flex-shrink-0">
        <button className="w-full rounded-2xl py-3.5 font-bold text-sm transition-all active:scale-95" style={{ background: 'rgba(51,209,172,0.12)', border: '1px solid rgba(51,209,172,0.35)', color: '#33D1AC' }}>
          Export Room Attendance (CSV)
        </button>
      </div>
    </div>
  )
}

// ─── Diagnostics ──────────────────────────────────────────────────────────────

const LOG_ENTRIES = [
  { t: '14:38:04.221', cat: 'BLE', msg: 'Peer token epoch rotated · 12 active nodes', color: '#38BDF8' },
  { t: '14:38:03.887', cat: 'AUDIO', msg: 'Acoustic decode success · Hall A token 0xF4A2', color: '#2DD4BF' },
  { t: '14:38:02.510', cat: 'WIFI', msg: 'BSSID fingerprint updated · cosine 0.94', color: '#33D1AC' },
  { t: '14:38:01.998', cat: 'MOTION', msg: 'IMU variance 0.032 g² · device held', color: '#F472B6' },
  { t: '14:38:00.604', cat: 'API', msg: 'POST /presence/confirm · 200 OK · 18ms', color: '#A78BFA' },
  { t: '14:37:59.882', cat: 'BLE', msg: 'New peer enrolled · peer_id: 3f8a1c2b', color: '#38BDF8' },
  { t: '14:37:58.771', cat: 'AUDIO', msg: 'Gate scan cycle complete · SNR 38dB', color: '#2DD4BF' },
  { t: '14:37:57.330', cat: 'WIFI', msg: 'BSSID re-sampled · 14 APs detected', color: '#33D1AC' },
  { t: '14:37:56.101', cat: 'API', msg: 'GET /rooms/all · 200 OK · 22ms', color: '#A78BFA' },
  { t: '14:37:54.943', cat: 'MOTION', msg: 'IMU check: active · no abandonment flag', color: '#F472B6' },
]

function DiagnosticsContent({ theme, onClose }: { theme: Theme; onClose?: () => void }) {
  const [activeTab, setActiveTab] = useState<string | null>(null)
  const cats = ['BLE', 'WIFI', 'AUDIO', 'MOTION', 'API']
  const filtered = activeTab ? LOG_ENTRIES.filter(l => l.cat === activeTab) : LOG_ENTRIES

  return (
    <div className="flex flex-col h-full" style={{ minHeight: '400px', maxHeight: '560px' }}>
      <div className="flex items-center justify-between px-5 pt-4 pb-3">
        <div>
          <h3 className="font-bold" style={{ color: txt(theme), fontSize: '16px' }}>System Diagnostics</h3>
          <p style={{ color: muted(theme), fontSize: '11px', fontFamily: "'JetBrains Mono', monospace" }}>Live telemetry · Hall A session</p>
        </div>
        {onClose && (
          <button onClick={onClose} className="w-7 h-7 rounded-full flex items-center justify-center" style={{ background: bdr(theme) }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="M18 6L6 18M6 6l12 12" stroke={sub(theme)} strokeWidth="2" strokeLinecap="round"/></svg>
          </button>
        )}
      </div>
      <div className="flex gap-1.5 px-5 pb-2 overflow-x-auto flex-shrink-0">
        <button onClick={() => setActiveTab(null)} className="rounded-full px-3 py-1 text-xs font-semibold whitespace-nowrap" style={{ background: !activeTab ? 'rgba(51,209,172,0.2)' : bdr(theme), color: !activeTab ? '#33D1AC' : sub(theme), border: `1px solid ${!activeTab ? 'rgba(51,209,172,0.4)' : 'transparent'}` }}>All</button>
        {cats.map(c => {
          const colMap: Record<string, string> = { BLE: '#38BDF8', WIFI: '#33D1AC', AUDIO: '#2DD4BF', MOTION: '#F472B6', API: '#A78BFA' }
          const col = colMap[c]
          return (
            <button key={c} onClick={() => setActiveTab(activeTab === c ? null : c)} className="rounded-full px-3 py-1 text-xs font-semibold whitespace-nowrap" style={{
              background: activeTab === c ? `${col}25` : 'transparent',
              border: `1px solid ${activeTab === c ? col : bdr(theme)}`,
              color: activeTab === c ? col : sub(theme),
            }}>{c}</button>
          )
        })}
      </div>
      <div className="flex-1 overflow-y-auto px-4 pb-4" style={{ background: theme === 'dark' ? '#0A0F1A' : '#F1F5F9', borderRadius: '12px', margin: '0 12px', fontFamily: "'JetBrains Mono', monospace" }}>
        {filtered.map((l, i) => (
          <div key={i} className="flex items-start gap-2 py-2" style={{ borderBottom: `1px solid ${theme === 'dark' ? 'rgba(34,49,71,0.5)' : 'rgba(226,232,240,0.7)'}`, animation: `log-in 0.3s ease-out ${i * 0.04}s both` }}>
            <span style={{ color: muted(theme), fontSize: '10px', flexShrink: 0, paddingTop: '1px' }}>{l.t}</span>
            <span className="rounded px-1.5 py-0.5 flex-shrink-0" style={{ background: `${l.color}18`, color: l.color, fontSize: '9px', fontWeight: 700, letterSpacing: '0.06em' }}>{l.cat}</span>
            <span style={{ color: sub(theme), fontSize: '11px', lineHeight: '16px' }}>{l.msg}</span>
          </div>
        ))}
      </div>
      <div className="px-5 py-3">
        <button className="w-full rounded-xl py-2.5 font-semibold text-sm" style={{ background: card(theme), border: `1px solid ${bdr(theme)}`, color: sub(theme) }}>Export Log File</button>
      </div>
    </div>
  )
}

function EdgeStateScreen({ theme, nav }: { theme: Theme; nav: (s: Screen) => void }) {
  const [activeEdge, setActiveEdge] = useState(0)
  const edges = [
    {
      icon: <svg width="36" height="36" viewBox="0 0 24 24" fill="none"><path d="M6.5 6.5l11 11M17.5 6.5L12 12l5.5 5.5L12 23V1l5.5 5.5" stroke="#EF4444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/><line x1="2" y1="2" x2="22" y2="22" stroke="#EF4444" strokeWidth="2" strokeLinecap="round"/></svg>,
      color: '#EF4444', label: 'Bluetooth Disabled',
      title: 'Bluetooth Required',
      body: 'XConnect needs Bluetooth to detect nearby devices. Enable it to resume presence scanning.',
      action: 'Open Bluetooth Settings',
    },
    {
      icon: <svg width="36" height="36" viewBox="0 0 24 24" fill="none"><rect x="9" y="3" width="6" height="11" rx="3" stroke="#F59E0B" strokeWidth="2"/><path d="M5 10a7 7 0 0014 0M12 19v3M8 22h8" stroke="#F59E0B" strokeWidth="2" strokeLinecap="round"/><line x1="4" y1="20" x2="20" y2="4" stroke="#F59E0B" strokeWidth="2" strokeLinecap="round"/></svg>,
      color: '#F59E0B', label: 'Mic Permission',
      title: 'Microphone Access Required',
      body: 'Acoustic gate detection requires microphone access. Your conversations are never recorded.',
      action: 'Grant Microphone Access',
    },
    {
      icon: <svg width="36" height="36" viewBox="0 0 24 24" fill="none"><path d="M5 12.55a11 11 0 0114.08 0M1.42 9a16 16 0 0121.16 0M8.53 16.11a6 6 0 016.95 0M12 20h.01" stroke="#38BDF8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>,
      color: '#38BDF8', label: 'Reconnecting',
      title: 'Server Reconnecting',
      body: 'Connection to the XConnect relay lost. Local sensor detection continues. Attempting reconnect...',
      action: 'Retry Connection',
    },
    {
      icon: <svg width="36" height="36" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="#64748B" strokeWidth="2"/><circle cx="12" cy="12" r="4" stroke="#64748B" strokeWidth="1.5" strokeDasharray="2 2"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3" stroke="#64748B" strokeWidth="1.5" strokeLinecap="round" opacity="0.4"/></svg>,
      color: '#64748B', label: 'Empty Room',
      title: 'Waiting for Participants',
      body: "Your presence anchor is active. Share the session code poc-session-241 with attendees.",
      action: 'Share Session Code',
    },
  ]
  const e = edges[activeEdge]

  return (
    <div className="flex flex-col h-full" style={{ background: surf(theme) }}>
      <TopBar theme={theme} title="Edge States" subtitle="Recovery & Error UI" onBack={() => nav('adminOverview')} />
      <div className="flex gap-1.5 px-5 pb-4 overflow-x-auto flex-shrink-0">
        {edges.map((ed, i) => (
          <button key={i} onClick={() => setActiveEdge(i)} className="rounded-full px-3 py-1.5 text-xs font-semibold whitespace-nowrap" style={{
            background: i === activeEdge ? `${ed.color}20` : 'transparent',
            border: `1px solid ${i === activeEdge ? ed.color : bdr(theme)}`,
            color: i === activeEdge ? ed.color : sub(theme),
          }}>{ed.label}</button>
        ))}
      </div>
      <div key={activeEdge} className="flex-1 flex flex-col items-center justify-center px-6 text-center" style={{ animation: 'scale-in 0.3s ease-out' }}>
        <div className="w-24 h-24 rounded-full flex items-center justify-center mb-6" style={{ background: `${e.color}12`, border: `2px solid ${e.color}45`, boxShadow: `0 0 30px ${e.color}25` }}>{e.icon}</div>
        <h2 className="font-bold mb-3" style={{ fontSize: '22px', color: txt(theme), letterSpacing: '-0.5px' }}>{e.title}</h2>
        <p style={{ color: sub(theme), fontSize: '14px', lineHeight: '22px', marginBottom: '32px', maxWidth: '280px' }}>{e.body}</p>
        {activeEdge === 2 && (
          <div className="w-full rounded-xl px-4 py-3 flex items-center gap-3 mb-6" style={{ background: 'rgba(56,189,248,0.08)', border: '1px solid rgba(56,189,248,0.25)' }}>
            <div className="w-4 h-4 rounded-full border-2 flex-shrink-0" style={{ borderColor: '#38BDF8', borderTopColor: 'transparent', animation: 'spin-slow 1s linear infinite' }} />
            <div>
              <p style={{ color: '#38BDF8', fontSize: '12px', fontWeight: 600 }}>Attempt 3 of 5</p>
              <p style={{ color: muted(theme), fontSize: '11px' }}>Next retry in 8s · Local sensors active</p>
            </div>
          </div>
        )}
        <button className="w-full rounded-2xl py-4 font-bold text-base transition-all active:scale-95" style={{ background: e.color, color: e.color === '#64748B' ? '#F8FAFC' : '#0B0F17' }}>{e.action}</button>
        <button onClick={() => nav('home')} className="mt-3" style={{ color: muted(theme), fontSize: '13px' }}>Return to Home</button>
      </div>
    </div>
  )
}

// ─── Screen Navigator ─────────────────────────────────────────────────────────

const SCREEN_GROUPS = [
  { label: 'Onboarding', screens: [['launch','Launch'],['onboarding','Value Primer'],['permissions','Permissions'],['login','Login SSO']] as [Screen,string][] },
  { label: 'Home', screens: [['home','Dashboard'],['profile','Profile']] as [Screen,string][] },
  { label: 'Presenter', screens: [['presenterSetup','Choose Room'],['presenterDashboard','Dashboard'],['presenterRoster','Roster'],['sessionEnd','Session End']] as [Screen,string][] },
  { label: 'Attendee', screens: [['attendeeDiscovery','Discovery'],['attendeeConfirmed','Confirmed'],['attendeeOutOfRange','Out of Range']] as [Screen,string][] },
  { label: 'Admin', screens: [['adminOverview','Overview'],['adminRoomDetail','Room Detail'],['edgeState','Edge States']] as [Screen,string][] },
]

// ─── Create Account Screen ────────────────────────────────────────────────────

function CreateAccountScreen({ theme, nav, onLogin }: { theme: Theme; nav: (s: Screen) => void; onLogin: (role: Role) => void }) {
  const [name, setName] = React.useState('')
  const [email, setEmail] = React.useState('')
  const [password, setPassword] = React.useState('')
  const [confirm, setConfirm] = React.useState('')

  const handleCreate = () => {
    onLogin('attendee')
    nav('home')
  }

  return (
    <div className="flex flex-col h-full" style={{ background: surf(theme) }}>
      <div className="flex flex-col items-center pt-8 pb-5 px-6">
        <img src={xConnectLogoSrc} width={56} height={56} style={{ display: 'block', objectFit: 'contain', marginBottom: '12px', borderRadius: '12px' }} alt="XConnect" />
        <h1 style={{ fontSize: '20px', fontWeight: 800, color: txt(theme), letterSpacing: '-0.4px', marginBottom: '2px' }}>Create Account</h1>
        <p style={{ color: muted(theme), fontSize: '11px', letterSpacing: '0.12em', textTransform: 'uppercase' }}>Enterprise Presence Platform</p>
      </div>
      <div className="flex-1 px-5 flex flex-col gap-3 overflow-y-auto pb-6">
        <input
          type="text"
          placeholder="Enter your full name"
          value={name}
          onChange={e => setName(e.target.value)}
          className="w-full rounded-2xl px-4 py-3.5 outline-none font-medium"
          style={{ background: theme === 'dark' ? '#131C2E' : '#F8FAFC', border: `1.5px solid ${bdr(theme)}`, color: txt(theme), fontSize: '14px' }}
        />
        <input
          type="email"
          placeholder="Enter your email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          className="w-full rounded-2xl px-4 py-3.5 outline-none font-medium"
          style={{ background: theme === 'dark' ? '#131C2E' : '#F8FAFC', border: `1.5px solid ${bdr(theme)}`, color: txt(theme), fontSize: '14px' }}
        />
        <input
          type="password"
          placeholder="Create a password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          className="w-full rounded-2xl px-4 py-3.5 outline-none font-medium"
          style={{ background: theme === 'dark' ? '#131C2E' : '#F8FAFC', border: `1.5px solid ${bdr(theme)}`, color: txt(theme), fontSize: '14px' }}
        />
        <input
          type="password"
          placeholder="Confirm your password"
          value={confirm}
          onChange={e => setConfirm(e.target.value)}
          className="w-full rounded-2xl px-4 py-3.5 outline-none font-medium"
          style={{ background: theme === 'dark' ? '#131C2E' : '#F8FAFC', border: `1.5px solid ${bdr(theme)}`, color: txt(theme), fontSize: '14px' }}
        />
        <button onClick={handleCreate} className="w-full rounded-2xl py-3.5 font-bold transition-all active:scale-95 mt-2" style={{ background: '#33D1AC', color: '#0F2F2C', fontSize: '14px' }}>
          Create Account
        </button>
        <button onClick={() => nav('login')} style={{ color: muted(theme), fontSize: '12px', textAlign: 'center', background: 'transparent', border: 'none' }}>
          Already have an account? <span style={{ color: '#33D1AC', fontWeight: 600 }}>Sign in</span>
        </button>
      </div>
    </div>
  )
}

// ─── App ──────────────────────────────────────────────────────────────────────

export default function App() {
  const [theme, setTheme] = useState<Theme>('light')
  const [screen, setScreen] = useState<Screen>('launch')
  const [navOpen, setNavOpen] = useState(false)
  const [selectedRoom, setSelectedRoom] = useState<RoomData>(ROOM_DATA[0])
  const [role, setRole] = useState<Role>('attendee')
  const nav = useCallback((s: Screen) => { setScreen(s); setNavOpen(false) }, [])

  const showNav = NAV_SCREENS.includes(screen)

  const renderScreen = () => {
    switch (screen) {
      case 'launch': return <LaunchScreen nav={nav} />
      case 'onboarding': return <OnboardingScreen theme={theme} nav={nav} />
      case 'permissions': return <PermissionsScreen theme={theme} nav={nav} />
      case 'login': return <LoginScreen theme={theme} nav={nav} onLogin={setRole} />
      case 'createAccount': return <CreateAccountScreen theme={theme} nav={nav} onLogin={setRole} />
      case 'home': return <HomeScreen theme={theme} nav={nav} role={role} />
      case 'profile': return <ProfileScreen theme={theme} nav={nav} role={role} />
      case 'presenterSetup': return <PresenterSetupScreen theme={theme} nav={nav} />
      case 'presenterDashboard': return <PresenterDashboardScreen theme={theme} nav={nav} />
      case 'presenterRoster': return <PresenterRosterScreen theme={theme} nav={nav} />
      case 'sessionEnd': return <SessionEndScreen theme={theme} nav={nav} />
      case 'attendeeDiscovery': return <AttendeeDiscoveryScreen theme={theme} nav={nav} />
      case 'attendeeConfirmed': return <AttendeeConfirmedScreen theme={theme} nav={nav} />
      case 'attendeeOutOfRange': return <AttendeeOutOfRangeScreen theme={theme} nav={nav} />
      case 'adminOverview': return <AdminOverviewScreen theme={theme} nav={nav} onRoomSelect={setSelectedRoom} />
      case 'adminRoomDetail': return <AdminRoomDetailScreen theme={theme} nav={nav} room={selectedRoom} />
      case 'diagnostics': return (
        <div className="flex flex-col h-full" style={{ background: surf(theme) }}>
          <TopBar theme={theme} title="System Diagnostics" onBack={() => nav('presenterDashboard')} />
          <div className="flex-1 overflow-hidden"><DiagnosticsContent theme={theme} /></div>
        </div>
      )
      case 'edgeState': return <EdgeStateScreen theme={theme} nav={nav} />
    }
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4" style={{
      background: '#060B12',
      backgroundImage: 'radial-gradient(ellipse at 30% 20%, rgba(51,209,172,0.06) 0%, transparent 50%), radial-gradient(ellipse at 70% 80%, rgba(2,132,199,0.06) 0%, transparent 50%)',
      fontFamily: "'Inter', sans-serif",
    }}>
      {/* Controls */}
      <div className="flex items-center justify-between w-full max-w-sm mb-4 px-1">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full" style={{ background: '#33D1AC' }} />
          <span style={{ color: '#334155', fontSize: '12px', fontFamily: "'JetBrains Mono', monospace", letterSpacing: '0.04em' }}>XConnect · Mobile Prototype</span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => nav('launch')} className="rounded-full px-3 py-1.5 text-xs font-semibold flex items-center gap-1.5 transition-all" style={{ background: 'rgba(34,49,71,0.5)', border: '1px solid #223147', color: '#94A3B8' }}>
            ▶ Replay
          </button>
          <button onClick={() => setNavOpen(o => !o)} className="rounded-full px-3 py-1.5 text-xs font-semibold" style={{ background: 'rgba(34,49,71,0.5)', border: '1px solid #223147', color: '#94A3B8' }}>
            Screens ↓
          </button>
        </div>
      </div>

      {/* Screen selector */}
      {navOpen && (
        <div className="w-full max-w-sm mb-3 rounded-2xl overflow-hidden" style={{ background: '#0F1923', border: '1px solid #223147', animation: 'fade-in 0.2s ease-out' }}>
          {SCREEN_GROUPS.map(g => (
            <div key={g.label} className="p-3">
              <p style={{ color: '#64748B', fontSize: '10px', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '6px', paddingLeft: '8px' }}>{g.label}</p>
              <div className="flex flex-wrap gap-1.5">
                {g.screens.map(([s, label]) => (
                  <button key={s} onClick={() => nav(s)} className="rounded-lg px-2.5 py-1.5 text-xs font-medium transition-all" style={{
                    background: screen === s ? 'rgba(51,209,172,0.18)' : 'rgba(34,49,71,0.4)',
                    border: `1px solid ${screen === s ? 'rgba(51,209,172,0.4)' : 'rgba(34,49,71,0.5)'}`,
                    color: screen === s ? '#33D1AC' : '#94A3B8',
                  }}>{label}</button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Phone frame */}
      <div className="relative flex-shrink-0" style={{
        width: '390px', height: '844px', borderRadius: '44px',
        background: '#F8FAFC',
        border: '10px solid #1A1F2E',
        boxShadow: '0 0 0 1px #0A0E18, 0 40px 100px rgba(0,0,0,0.7), 0 0 80px rgba(51,209,172,0.06)',
        overflow: 'hidden', display: 'flex', flexDirection: 'column',
      }}>
        {/* Dynamic Island */}
        <div style={{ flexShrink: 0, display: 'flex', justifyContent: 'center', paddingTop: '14px', paddingBottom: '4px', zIndex: 10, position: 'relative' }}>
          <div style={{ width: '120px', height: '32px', borderRadius: '18px', background: '#080C13' }} />
        </div>

        {/* Screen + Bottom Nav */}
        <div className="flex flex-col flex-1 overflow-hidden">
          <div key={screen} className="flex-1 overflow-hidden" style={{ animation: 'scale-in 0.28s ease-out' }}>
            {renderScreen()}
          </div>
          {showNav && <BottomNav theme={theme} screen={screen} nav={nav} role={role} />}
        </div>

        {/* Home indicator */}
        {!showNav && (
          <div style={{ flexShrink: 0, display: 'flex', justifyContent: 'center', padding: '8px 0 10px' }}>
            <div style={{ width: '134px', height: '5px', borderRadius: '3px', background: '#CBD5E1' }} />
          </div>
        )}
      </div>

      <p style={{ color: '#1E2D3D', fontSize: '11px', marginTop: '16px', fontFamily: "'JetBrains Mono', monospace", letterSpacing: '0.04em' }}>
        iOS iPhone 16 Pro · 390×844 · Light — Enterprise Clean
      </p>
    </div>
  )
}
