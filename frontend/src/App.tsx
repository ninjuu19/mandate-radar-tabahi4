import React, { useState, useEffect } from 'react'
export type { Mandate, MandateStatus, Finding, ReconciliationResult } from './types'
import type { Mandate, Finding, ReconciliationResult } from './types'
import { DashboardLayout } from './components/DashboardLayout'
import { MoneliqLandingPage } from './components/MoneliqLandingPage'
import { AuthModal } from './components/AuthModal'
import { DesignSystemShowcase } from './components/DesignSystemShowcase'
import { SAMPLE_MANDATES, SAMPLE_HERO_METRICS } from './lib/sampleData'
import { safeFetchJson } from './lib/api'
import type { GraphNode, GraphEdge } from './components/GraphCanvas'
import { CheckCircle2, Info } from 'lucide-react'

export const EMPTY_HERO_METRICS = {
  annual_committed_total: 0,
  monthly_equivalent: 0,
  potential_savings: 0,
  total_mandates_found: 0,
  flagged_issues_count: 0,
  bundle_overlaps_count: 0,
  bundle_overlap_savings: 0,
  still_charging_count: 0,
  verified_cancelled_count: 0
}

const isDemoAccount = (u?: { email?: string; isDemo?: boolean }) => {
  if (!u) return false
  return !!u.isDemo || u.email === 'arun.sharma@example.com' || u.email === 'rahul.sharma@example.com'
}

export default function App() {
  // Application Stage: 'opening' (Moneliq landing) or 'dashboard' (Full sidebar command center)
  const [stage, setStage] = useState<'opening' | 'dashboard'>('opening')
  const [authModalOpen, setAuthModalOpen] = useState(false)
  const [authModalMode, setAuthModalMode] = useState<'signin' | 'signup'>('signin')
  const [showDesignSystem, setShowDesignSystem] = useState(false)
  const [toastNotification, setToastNotification] = useState<string | null>(null)

  useEffect(() => {
    if (toastNotification) {
      const t = setTimeout(() => setToastNotification(null), 3500)
      return () => clearTimeout(t)
    }
  }, [toastNotification])

  // Handle 401 Unauthorized / Token Expiration: clear state, return to opening stage, and open login without infinite loop
  useEffect(() => {
    const handleUnauthorized = () => {
      setCurrentUser({
        id: 'usr_new',
        name: 'New User',
        email: '',
        phone: '',
        accountLabel: 'Primary Statement',
        isDemo: false
      })
      setMandates([])
      setHeroMetrics(EMPTY_HERO_METRICS)
      setStage('opening')
      setAuthModalMode('signin')
      setAuthModalOpen(true)
      setToastNotification('Session expired or authentication required. Please sign in.')
    }

    window.addEventListener('mandate_radar:unauthorized', handleUnauthorized)
    window.addEventListener('mandate_radar_auth_expired', handleUnauthorized)
    return () => {
      window.removeEventListener('mandate_radar:unauthorized', handleUnauthorized)
      window.removeEventListener('mandate_radar_auth_expired', handleUnauthorized)
    }
  }, [])

  // Current User Session (Persisted in localStorage, production-ready)
  const [currentUser, setCurrentUser] = useState<{
    id: string
    name: string
    email: string
    phone?: string
    accountLabel?: string
    isDemo?: boolean
  }>(() => {
    try {
      const saved = localStorage.getItem('mandate_radar_user')
      if (saved) return JSON.parse(saved)
    } catch {}
    return {
      id: 'usr_new',
      name: 'New User',
      email: '',
      phone: '',
      accountLabel: 'Primary Statement',
      isDemo: false
    }
  })

  // Core Data: Only pre-fill sample data for demo users. New users start fresh with 0.
  const [mandates, setMandates] = useState<Mandate[]>(() => {
    try {
      const savedUser = localStorage.getItem('mandate_radar_user')
      if (savedUser) {
        const u = JSON.parse(savedUser)
        if (isDemoAccount(u)) return SAMPLE_MANDATES
      }
    } catch {}
    return []
  })

  const [heroMetrics, setHeroMetrics] = useState(() => {
    try {
      const savedUser = localStorage.getItem('mandate_radar_user')
      if (savedUser) {
        const u = JSON.parse(savedUser)
        if (isDemoAccount(u)) return SAMPLE_HERO_METRICS
      }
    } catch {}
    return EMPTY_HERO_METRICS
  })

  const [cancelledIds, setCancelledIds] = useState<Set<string>>(new Set())

  // Graph Data
  const [graphData, setGraphData] = useState<{ nodes: GraphNode[]; edges: GraphEdge[]; stats: any }>({
    nodes: [],
    edges: [],
    stats: {}
  })

  useEffect(() => {
    if (isDemoAccount(currentUser)) {
      fetchInitialData(currentUser)
    }
    loadSampleGraph(currentUser?.name && currentUser.name !== 'New User' ? currentUser.name : 'Rahul Sharma')
  }, [currentUser?.name])

  const fetchInitialData = async (userToFetch = currentUser) => {
    if (!isDemoAccount(userToFetch)) {
      setMandates([])
      setHeroMetrics(EMPTY_HERO_METRICS)
      return
    }

    try {
      const token = localStorage.getItem('mandate_radar_token')
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (token) {
        headers['Authorization'] = `Bearer ${token}`
      }
      const { ok, data } = await safeFetchJson<any>('/api/analyze', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          user_name: userToFetch.name,
          user_id: userToFetch.id
        })
      })
      if (!ok || !data) throw new Error('API offline')
      if (data.mandates && data.mandates.length > 0) {
        setMandates(data.mandates)
        setHeroMetrics(data.hero_metrics || SAMPLE_HERO_METRICS)
      }
    } catch {
      setMandates(SAMPLE_MANDATES)
      setHeroMetrics(SAMPLE_HERO_METRICS)
    }
  }

  const handleAuthSuccess = (u?: { name: string; email: string; phone?: string; isDemo?: boolean }) => {
    if (u) {
      const isDemo = u.isDemo ?? (u.email === 'arun.sharma@example.com')
      const updatedUser = {
        id: u.email.replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase(),
        name: u.name,
        email: u.email,
        phone: u.phone || '+91 98201 48210',
        accountLabel: `${u.name.split(' ')[0]}'s Primary Statement`,
        isDemo
      }
      setCurrentUser(updatedUser)
      try {
        localStorage.setItem('mandate_radar_user', JSON.stringify(updatedUser))
      } catch {}

      if (isDemo) {
        setMandates(SAMPLE_MANDATES)
        setHeroMetrics(SAMPLE_HERO_METRICS)
        setToastNotification(`Welcome back, ${u.name}! Pre-seeded portfolio loaded.`)
      } else {
        // Brand new user: clear hardcoded sample mandates so they see clean state!
        setMandates([])
        setHeroMetrics(EMPTY_HERO_METRICS)
        setToastNotification(`Welcome to Mandate Radar, ${u.name}!`)
      }
    }
    setAuthModalOpen(false)
    setStage('dashboard')
  }

  const handleLoadSampleData = () => {
    setMandates(SAMPLE_MANDATES)
    setHeroMetrics(SAMPLE_HERO_METRICS)
    setToastNotification('Demo portfolio loaded (10 mandates, ₹65,623/year)')
  }

  const loadSampleGraph = (userName = (currentUser?.name && currentUser.name !== 'New User' ? currentUser.name : 'Rahul Sharma')) => {
    const sampleNodes: GraphNode[] = [
      { id: 'usr-1', label: 'Account Holder', name: userName, type: 'person', group: 'person', properties: { name: userName, role: 'Account Holder', cost: 12754, count: 4 } },
      { id: 'p-alpha', label: 'Alphabet Inc', name: 'Alphabet Inc', type: 'parent', group: 'parent', properties: { name: 'Alphabet Inc', country: 'US', cost: 2268 } },
      { id: 'p-amz', label: 'Amazon.com Inc', name: 'Amazon.com Inc', type: 'parent', group: 'parent', properties: { name: 'Amazon.com Inc', country: 'US', cost: 1499 } },
      { id: 'p-dis', label: 'The Walt Disney Co', name: 'The Walt Disney Co', type: 'parent', group: 'parent', properties: { name: 'The Walt Disney Co', country: 'US', cost: 1499 } },
      { id: 'p-sp', label: 'Spotify AB', name: 'Spotify AB', type: 'parent', group: 'parent', properties: { name: 'Spotify AB', country: 'SE', cost: 1199 } },
      { id: 'p-nf', label: 'Netflix Inc', name: 'Netflix Inc', type: 'parent', group: 'parent', properties: { name: 'Netflix Inc', country: 'US', cost: 7788 } },
      { id: 'm-yt', label: 'YouTube Premium', name: 'YouTube Premium', type: 'merchant', group: 'merchant', properties: { name: 'YouTube Premium', cost: 2268, amount: 189, cadence: 'MONTHLY', flag: 'HEALTHY', category: 'Video & Music', rail: 'PLAY_STORE', hasOverlap: true, overlapWith: 'Spotify Premium Individual', overlapSavings: 1199 } },
      { id: 'm-sp', label: 'Spotify Premium Individual', name: 'Spotify Premium Individual', type: 'merchant', group: 'merchant', properties: { name: 'Spotify Premium Individual', cost: 1199, amount: 999, cadence: 'ANNUAL', flag: 'PRICE_HIKE', category: 'Audio Streaming', rail: 'UPI_AUTOPAY', hasOverlap: true, overlapWith: 'YouTube Premium Family', overlapSavings: 1199 } },
      { id: 'm-nf', label: 'Netflix Standard (HD)', name: 'Netflix Standard (HD)', type: 'merchant', group: 'merchant', properties: { name: 'Netflix Standard (HD)', cost: 7788, amount: 649, cadence: 'MONTHLY', flag: 'UNUSED_ZOMBIE', category: 'Video Streaming', rail: 'CARD_SI', hasOverlap: true, overlapWith: 'Amazon Prime Annual', overlapSavings: 1499 } },
      { id: 'm-amz', label: 'Amazon Prime Annual', name: 'Amazon Prime Annual', type: 'merchant', group: 'merchant', properties: { name: 'Amazon Prime Annual', cost: 1499, amount: 1499, cadence: 'ANNUAL', flag: 'HEALTHY', category: 'Video & Delivery', rail: 'CARD_SI', hasOverlap: true, overlapWith: 'Netflix Standard (HD)', overlapSavings: 1499 } },
      { id: 'r-card', label: 'CARD_SI', name: 'Card Standing Instruction', type: 'rail', group: 'rail', properties: { name: 'Card Standing Instruction (ICICI Coral)' } },
      { id: 'r-upi', label: 'UPI_AUTOPAY', name: 'UPI AutoPay', type: 'rail', group: 'rail', properties: { name: 'UPI Autopay (HDFC Bank)' } }
    ]
    const sampleEdges: GraphEdge[] = [
      { id: 'e1', source: 'usr-1', target: 'm-yt', type: 'COMMITTED_TO', label: '₹189/mo', properties: { amount: 189, cadence: 'MONTHLY' } },
      { id: 'e2', source: 'usr-1', target: 'm-sp', type: 'COMMITTED_TO', label: '₹999/yr', properties: { amount: 999, cadence: 'ANNUAL' } },
      { id: 'e3', source: 'usr-1', target: 'm-nf', type: 'COMMITTED_TO', label: '₹649/mo', properties: { amount: 649, cadence: 'MONTHLY' } },
      { id: 'e10', source: 'usr-1', target: 'm-amz', type: 'COMMITTED_TO', label: '₹1,499/yr', properties: { amount: 1499, cadence: 'ANNUAL' } },
      { id: 'e4', source: 'm-yt', target: 'p-alpha', type: 'OWNED_BY', label: 'OWNED_BY', properties: {} },
      { id: 'e5', source: 'm-amz', target: 'p-amz', type: 'OWNED_BY', label: 'OWNED_BY', properties: {} },
      { id: 'e6', source: 'm-sp', target: 'p-sp', type: 'OWNED_BY', label: 'OWNED_BY', properties: {} },
      { id: 'e7', source: 'm-nf', target: 'p-nf', type: 'OWNED_BY', label: 'OWNED_BY', properties: {} },
      { id: 'e8', source: 'm-sp', target: 'r-upi', type: 'ROUTED_VIA', label: 'ROUTED_VIA', properties: {} },
      { id: 'e9', source: 'm-nf', target: 'r-card', type: 'ROUTED_VIA', label: 'ROUTED_VIA', properties: {} },
      { id: 'e-ov1', source: 'm-sp', target: 'm-yt', type: 'OVERLAPS_WITH', label: 'OVERLAP: Save ₹1,199', properties: { category: 'Music Streaming', savings: 1199, reason: 'Duplicate Music Streaming: YouTube Premium includes YouTube Music' } },
      { id: 'e-ov2', source: 'm-nf', target: 'm-amz', type: 'OVERLAPS_WITH', label: 'OVERLAP: Save ₹1,499', properties: { category: 'Video Streaming', savings: 1499, reason: 'Redundant OTT Video Subscriptions: High catalog overlap' } }
    ]
    setGraphData({ nodes: sampleNodes, edges: sampleEdges, stats: { merchant_count: 4, parent_count: 5 } })
  }

  const toggleCancel = (id: string) => {
    setCancelledIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const cancelAllFlagged = () => {
    const flaggedIds = mandates.filter(m => m.flag !== 'HEALTHY').map(m => m.id)
    setCancelledIds(new Set(flaggedIds))
  }

  return (
    <div className="min-h-screen bg-[#F8F5EE] text-[#0F1713] antialiased">
      
      {/* STAGE 1: Moneliq-Style Luxury Opening Page */}
      {stage === 'opening' && (
        <MoneliqLandingPage
          onOpenAuth={(mode) => {
            setAuthModalMode(mode)
            setAuthModalOpen(true)
          }}
          onLaunchDashboard={() => setStage('dashboard')}
          onOpenDesignSystem={() => setShowDesignSystem(true)}
        />
      )}

      {/* STAGE 2: Full Dashboard with Left Sidebar (Where user can do all stuff) */}
      {stage === 'dashboard' && (
        <DashboardLayout
          user={currentUser}
          onUpdateUser={(updated) => {
            setCurrentUser(updated)
            try {
              localStorage.setItem('mandate_radar_user', JSON.stringify(updated))
            } catch {}
          }}
          mandates={mandates}
          heroMetrics={heroMetrics}
          cancelledIds={cancelledIds}
          onToggleCancel={toggleCancel}
          onCancelFlagged={cancelAllFlagged}
          onClearCancelled={() => setCancelledIds(new Set())}
          graphData={graphData}
          onOpenHome={() => setStage('opening')}
          onOpenDesignSystem={() => setShowDesignSystem(true)}
          onUpdateMandates={(newMandates) => setMandates(newMandates)}
          onUpdateHeroMetrics={(metrics) => setHeroMetrics(metrics)}
          onLoadSampleData={handleLoadSampleData}
        />
      )}

      {/* Global Floating Toast Notification */}
      {toastNotification && (
        <div className="fixed top-5 right-5 z-[9999] flex items-center gap-2.5 px-4 py-3 rounded-2xl bg-[#0E2419] border border-[#2DE2B5] text-[#FAF8F5] shadow-2xl animate-fade-in text-xs font-medium">
          <CheckCircle2 className="w-4 h-4 text-[#2DE2B5] shrink-0" />
          <span>{toastNotification}</span>
        </div>
      )}

      {/* Unified Auth Modal (Sign In / Sign Up -> Immediately opens Dashboard) */}
      <AuthModal
        isOpen={authModalOpen}
        initialMode={authModalMode}
        onClose={() => setAuthModalOpen(false)}
        onSuccess={handleAuthSuccess}
      />

      {/* Design System Spec Showcase */}
      {showDesignSystem && (
        <DesignSystemShowcase onClose={() => setShowDesignSystem(false)} />
      )}
    </div>
  )
}
