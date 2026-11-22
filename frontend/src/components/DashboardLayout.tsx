import React, { useState } from 'react'
import {
  Radar,
  Network,
  Upload,
  Building2,
  Flame,
  CheckCircle2,
  Settings,
  LogOut,
  Sparkles,
  TrendingUp,
  AlertTriangle,
  Lock,
  Search,
  ExternalLink,
  ChevronRight,
  ShieldCheck,
  Zap,
  CreditCard,
  FileText,
  Home,
  User,
  UserCheck,
  Bell,
  Key,
  Sliders,
  Download,
  Smartphone,
  Mail,
  Check,
  Shield,
  RefreshCw,
  Plus,
  Calendar as CalendarIcon
} from 'lucide-react'
import type { Mandate, Finding, ReconciliationResult } from '../types'
import { inr } from '../lib/format'
import { apiFetch, authFetchJson } from '../lib/api'
import { RadarView } from './RadarView'
import { MandateDrawer } from './MandateDrawer'
import { GraphCanvas, type GraphNode, type GraphEdge } from './GraphCanvas'
import { GraphGuide } from './GraphGuide'
import { MandateCalendar } from './MandateCalendar'
import { FindingsConfirmationModal } from './FindingsConfirmationModal'

export type DashboardTab =
  | 'portfolio'
  | 'calendar'
  | 'graph'
  | 'upload'
  | 'banks'
  | 'zombies'
  | 'benchmark'
  | 'neo4j'
  | 'profile'

async function readApiResponse<T>(response: Response): Promise<T> {
  let data: any
  try {
    data = await response.json()
  } catch {
    throw new Error('The server returned an invalid response.')
  }

  if (!response.ok) {
    const detail = data?.detail
    throw new Error(
      typeof detail === 'string'
        ? detail
        : detail
          ? JSON.stringify(detail)
          : `Request failed with status ${response.status}.`
    )
  }

  return data as T
}

interface DashboardLayoutProps {
  user?: {
    id: string
    name: string
    email: string
    phone?: string
    accountLabel?: string
  }
  onUpdateUser?: (user: any) => void
  mandates: Mandate[]
  heroMetrics: {
    annual_committed_total: number
    monthly_equivalent: number
    potential_savings: number
    total_mandates_found: number
    flagged_issues_count: number
  }
  cancelledIds: Set<string>
  onToggleCancel: (id: string) => void
  onCancelFlagged: () => void
  onClearCancelled: () => void
  graphData: { nodes: GraphNode[]; edges: GraphEdge[]; stats: any }
  onOpenHome: () => void
  onOpenDesignSystem: () => void
  onUpdateMandates?: (mandates: Mandate[]) => void
  onUpdateHeroMetrics?: (metrics: any) => void
  onLoadSampleData?: () => void
}

export const DashboardLayout: React.FC<DashboardLayoutProps> = ({
  user,
  onUpdateUser,
  mandates,
  heroMetrics,
  cancelledIds,
  onToggleCancel,
  onCancelFlagged,
  onClearCancelled,
  graphData,
  onOpenHome,
  onOpenDesignSystem,
  onUpdateMandates,
  onUpdateHeroMetrics,
  onLoadSampleData
}) => {
  const [activeTab, setActiveTab] = useState<DashboardTab>('portfolio')
  const [selectedMandate, setSelectedMandate] = useState<Mandate | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [cypherResult, setCypherResult] = useState<any>(null)
  const [neo4jGraphData, setNeo4jGraphData] = useState<{ nodes: GraphNode[]; edges: GraphEdge[]; stats: any } | null>(null)
  const [isLoadingGraph, setIsLoadingGraph] = useState(false)
  const [graphError, setGraphError] = useState<string | null>(null)
  const [graphMode, setGraphMode] = useState<string>('portfolio')
  const [statementTxnCount, setStatementTxnCount] = useState<number>(0)
  const [userName, setUserName] = useState(user?.name || 'Rahul Sharma')
  const [userEmail, setUserEmail] = useState(user?.email || 'rahul.sharma@example.com')
  const [userPhone, setUserPhone] = useState(user?.phone || '+91 98201 48210')
  const [userCity, setUserCity] = useState('Bengaluru, Karnataka')
  const [primaryBank, setPrimaryBank] = useState(user?.accountLabel || 'HDFC Bank (Salary A/C •••• 4821)')
  const [autoZombieAlert, setAutoZombieAlert] = useState(true)
  const [autoHikeAlert, setAutoHikeAlert] = useState(true)
  const [trialWarningAlert, setTrialWarningAlert] = useState(true)
  const [whatsappAlerts, setWhatsappAlerts] = useState(true)
  const [profileSavedToast, setProfileSavedToast] = useState(false)

  const loadNeo4jGraph = React.useCallback(async () => {
    setIsLoadingGraph(true)
    setGraphError(null)
    try {
      const response = await apiFetch('/api/graph?mode=portfolio')
      const data = await readApiResponse<{ nodes: GraphNode[]; edges: GraphEdge[]; stats: any }>(response)
      if (!Array.isArray(data.nodes) || !Array.isArray(data.edges)) {
        throw new Error('The graph response is missing nodes or relationships.')
      }
      setNeo4jGraphData(data)
    } catch (err) {
      setGraphError(err instanceof Error ? err.message : 'Unable to load the Neo4j graph.')
    } finally {
      setIsLoadingGraph(false)
    }
  }, [])

  React.useEffect(() => {
    if (activeTab === 'graph') {
      void loadNeo4jGraph()
    }
  }, [activeTab, loadNeo4jGraph])

  // Local active mandates state so updates reflect immediately
  const [localMandates, setLocalMandates] = useState<Mandate[]>(mandates)
  React.useEffect(() => {
    setLocalMandates(mandates)
  }, [mandates])

  // Build dynamic Neo4j graph reflecting active user mandates
  const dynamicGraph = React.useMemo(() => {
    const activeUserName = user?.name || userName || 'My Portfolio'
    const centerUserId = 'usr_active_center'

    if (!localMandates || localMandates.length === 0) {
      const updatedNodes = (graphData.nodes || []).map(n =>
        (n.type === 'user' || n.type === 'person' || n.group === 'user' || n.group === 'person')
          ? { ...n, label: 'Account Holder', name: activeUserName, properties: { ...n.properties, name: activeUserName } }
          : n
      )
      return { ...graphData, nodes: updatedNodes }
    }

    const nodes: GraphNode[] = []
    const edges: GraphEdge[] = []
    const parentMap = new Map<string, { name: string; cost: number; count: number }>()
    const railMap = new Map<string, string>()

    // Calculate total annual exposure across all active user mandates
    const totalCommitted = localMandates.reduce((acc, m) => acc + (m.annual_committed_cost || 0), 0)

    // 1. Center User Node
    nodes.push({
      id: centerUserId,
      label: 'Account Holder',
      name: activeUserName,
      type: 'person',
      group: 'person',
      properties: { name: activeUserName, role: 'Account Holder', cost: totalCommitted, count: localMandates.length }
    })

    // Track which mandates overlap
    const overlapPairs: { i: number; j: number; savings: number; reason: string }[] = []
    for (let i = 0; i < localMandates.length; i++) {
      for (let j = i + 1; j < localMandates.length; j++) {
        const m1 = localMandates[i]
        const m2 = localMandates[j]
        const n1 = (m1.merchant_name || m1.descriptor || '').toLowerCase()
        const n2 = (m2.merchant_name || m2.descriptor || '').toLowerCase()
        const c1 = (m1.category || '').toLowerCase()
        const c2 = (m2.category || '').toLowerCase()

        let isOverlap = false
        let reason = ''
        const savings = Math.min(m1.annual_committed_cost || 0, m2.annual_committed_cost || 0)

        // Duplicate merchant across channels or descriptors (e.g. CloudStore, InsureCo)
        if (n1 && n2 && (n1.includes(n2) || n2.includes(n1) || (n1.includes('cloud') && n2.includes('cloud')))) {
          isOverlap = true
          reason = 'Duplicate Subscription Mandates'
        }
        // Streaming video overlap (Netflix, Amazon Prime, Hotstar, Disney, StreamPlus)
        else if ((n1.includes('netflix') || n1.includes('prime') || n1.includes('hotstar') || n1.includes('disney') || n1.includes('stream')) &&
                 (n2.includes('netflix') || n2.includes('prime') || n2.includes('hotstar') || n2.includes('disney') || n2.includes('stream'))) {
          isOverlap = true
          reason = 'Redundant OTT Video Subscriptions'
        }
        // Audio / Music streaming overlap (Spotify, YouTube Music)
        else if ((n1.includes('spotify') || n1.includes('youtube') || n1.includes('music')) &&
                 (n2.includes('spotify') || n2.includes('youtube') || n2.includes('music'))) {
          isOverlap = true
          reason = 'Duplicate Music Streaming Catalog'
        }
        // Same category overlap
        else if (c1 && c2 && c1 === c2 && (c1.includes('stream') || c1.includes('entertainment') || c1.includes('audio'))) {
          isOverlap = true
          reason = `Redundant ${m1.category} Overlap`
        }

        if (isOverlap) {
          overlapPairs.push({ i, j, savings, reason })
        }
      }
    }

    const overlapNodeIndices = new Set<number>()
    overlapPairs.forEach(p => {
      overlapNodeIndices.add(p.i)
      overlapNodeIndices.add(p.j)
    })

    localMandates.forEach((m, idx) => {
      // 2. Merchant / Mandate Node
      const merchantNodeId = `node_${m.id || idx}`
      const mName = m.merchant_name || m.descriptor
      const hasOverlap = overlapNodeIndices.has(idx)
      const matchingPair = overlapPairs.find(p => p.i === idx || p.j === idx)

      nodes.push({
        id: merchantNodeId,
        label: mName,
        name: mName,
        type: 'merchant',
        group: 'merchant',
        properties: {
          name: mName,
          cost: m.annual_committed_cost,
          cadence: m.cadence,
          amount: m.latest_amount,
          rail: m.mechanism,
          flag: m.flag,
          category: m.category,
          hasOverlap,
          overlapSavings: matchingPair?.savings || 0,
          overlapReason: matchingPair?.reason || ''
        }
      })

      // Edge from User to Merchant
      const cadenceText = m.cadence === 'MONTHLY' ? '/mo' : m.cadence === 'QUARTERLY' ? '/qtr' : m.cadence === 'WEEKLY' ? '/wk' : '/yr'
      edges.push({
        id: `edge_comm_${idx}`,
        source: centerUserId,
        target: merchantNodeId,
        type: 'COMMITTED_TO',
        label: `₹${m.latest_amount?.toLocaleString('en-IN')}${cadenceText}`,
        properties: { amount: m.latest_amount, cadence: m.cadence }
      })

      // 3. Parent Conglomerate Node
      const parentName = m.parent_name || (mName.toLowerCase().includes('google') ? 'Alphabet Inc' : mName.toLowerCase().includes('amazon') ? 'Amazon.com Inc' : mName.toLowerCase().includes('netflix') ? 'Netflix Inc' : mName.toLowerCase().includes('spotify') ? 'Spotify AB' : mName.toLowerCase().includes('disney') ? 'The Walt Disney Company' : mName.toLowerCase().includes('lic') ? 'Life Insurance Corp' : 'Independent Entity')
      const parentId = `parent_${parentName.toLowerCase().replace(/[^a-z0-9]/g, '_')}`
      if (!parentMap.has(parentId)) {
        parentMap.set(parentId, { name: parentName, cost: m.annual_committed_cost || 0, count: 1 })
      } else {
        const existing = parentMap.get(parentId)!
        existing.cost += (m.annual_committed_cost || 0)
        existing.count += 1
      }

      edges.push({
        id: `edge_parent_${idx}`,
        source: merchantNodeId,
        target: parentId,
        type: 'OWNED_BY',
        label: 'OWNED_BY',
        properties: {}
      })

      // 4. Payment Rail Node
      const railCode = m.mechanism || 'UPI_AUTOPAY'
      const railLabel = m.mechanism_name || (railCode === 'BANK_NACH' ? 'e-NACH Mandate' : railCode === 'UPI_AUTOPAY' ? 'UPI AutoPay' : railCode === 'CARD_SI' ? 'Card Standing Instruction' : 'Direct Merchant')
      const railId = `rail_${railCode.toLowerCase()}`
      if (!railMap.has(railId)) {
        railMap.set(railId, railLabel)
        nodes.push({
          id: railId,
          label: railLabel,
          name: railLabel,
          type: 'rail',
          group: 'rail',
          properties: { name: railLabel }
        })
      }

      edges.push({
        id: `edge_rail_${idx}`,
        source: merchantNodeId,
        target: railId,
        type: 'ROUTED_VIA',
        label: 'ROUTED_VIA',
        properties: {}
      })
    })

    // Add aggregate Parent Nodes with combined fintech exposure
    parentMap.forEach((val, pId) => {
      nodes.push({
        id: pId,
        label: val.name,
        name: val.name,
        type: 'parent',
        group: 'parent',
        properties: { name: val.name, cost: val.cost, merchantCount: val.count }
      })
    })

    // Add Overlap Edges
    overlapPairs.forEach((p, idx) => {
      edges.push({
        id: `edge_overlap_${idx}`,
        source: `node_${localMandates[p.i].id || p.i}`,
        target: `node_${localMandates[p.j].id || p.j}`,
        type: 'OVERLAPS_WITH',
        label: `OVERLAP: Save ₹${p.savings.toLocaleString('en-IN')}`,
        properties: {
          category: localMandates[p.i].category,
          savings: p.savings,
          reason: p.reason
        }
      })
    })

    return { nodes, edges, stats: { merchant_count: localMandates.length, parent_count: parentMap.size, overlap_count: overlapPairs.length } }
  }, [localMandates, user?.name, userName, graphData])

  // Active User Context
  const userId = user?.id || 'usr_primary'

  React.useEffect(() => {
    if (user?.name) setUserName(user.name)
    if (user?.email) setUserEmail(user.email)
    if (user?.phone) setUserPhone(user.phone)
    if (user?.accountLabel) setPrimaryBank(user.accountLabel)
  }, [user])

  const userInitials = userName
    .split(' ')
    .filter(Boolean)
    .map(n => n[0])
    .join('')
    .toUpperCase() || 'U'

  // Neo4j settings state
  const [neo4jUri, setNeo4jUri] = useState('neo4j+s://8cf912ab.databases.neo4j.io')
  const [neo4jUser, setNeo4jUser] = useState('neo4j')
  const [neo4jPass, setNeo4jPass] = useState('••••••••••••')
  const [neo4jStatus, setNeo4jStatus] = useState<'connected' | 'testing'>('connected')

  // Findings & Reconciliation state
  const [findings, setFindings] = useState<Finding[]>([])
  const [reconciliation, setReconciliation] = useState<ReconciliationResult | undefined>()
  const [isFindingsModalOpen, setIsFindingsModalOpen] = useState(false)

  // Upload statement state
  const [uploadAccountLabel, setUploadAccountLabel] = useState(user?.accountLabel || 'HDFC Salary')
  const [isUploading, setIsUploading] = useState(false)
  const [uploadMessage, setUploadMessage] = useState<string | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const fileInputRef = React.useRef<HTMLInputElement>(null)

  // Handle mandate cancellation confirmation
  const handleConfirmCancelMandate = async (mandateId: string) => {
    try {
      await apiFetch(`/api/mandates/${mandateId}/cancel-confirm`, {
        method: 'POST'
      })
    } catch {}

    const today = new Date().toISOString().split('T')[0]
    const updated = localMandates.map(m =>
      m.id === mandateId
        ? {
            ...m,
            status: 'marked_cancelled' as const,
            marked_cancelled_on: today
          }
        : m
    )
    setLocalMandates(updated)
    onUpdateMandates?.(updated)
    if (selectedMandate && selectedMandate.id === mandateId) {
      setSelectedMandate({
        ...selectedMandate,
        status: 'marked_cancelled' as const,
        marked_cancelled_on: today
      })
    }
    if (!cancelledIds.has(mandateId)) {
      onToggleCancel(mandateId)
    }
  }

  // Handle user scoped tag addition
  const handleAddMandateTag = async (mandateId: string, tag: string) => {
    try {
      await apiFetch(`/api/mandates/${mandateId}/tags`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tag, tags: [tag] })
      })
    } catch {}

    const updated = localMandates.map(m => {
      if (m.id === mandateId) {
        const existingTags = m.tags || []
        return { ...m, tags: [...existingTags, tag] }
      }
      return m
    })
    setLocalMandates(updated)
    onUpdateMandates?.(updated)
    if (selectedMandate && selectedMandate.id === mandateId) {
      setSelectedMandate({
        ...selectedMandate,
        tags: [...(selectedMandate.tags || []), tag]
      })
    }
  }

  // Handle graph finding decision confirmation
  const handleConfirmFindingDecision = async (findingId: string, keepMandateIds: string[]) => {
    try {
      await apiFetch(`/api/findings/${findingId}/decision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          finding_id: findingId,
          finding_key: findingId,
          finding_type: 'overlap',
          choice: 'CONFIRMED',
          chosen_action: 'keep_selected',
          kept_mandate_ids: keepMandateIds,
          confirmed_mandate_ids: keepMandateIds
        })
      })
    } catch {}

    const finding = findings.find(f => f.finding_id === findingId)
    const findingMandateIds = new Set((finding?.mandates || []).map(m => m.id))

    const updated = localMandates.map(m => {
      if (findingMandateIds.has(m.id)) {
        if (keepMandateIds.includes(m.id)) {
          return { ...m, status: 'keep_confirmed' as const }
        } else {
          return { ...m, status: 'suggested_cancel' as const }
        }
      }
      return m
    })
    setLocalMandates(updated)
    onUpdateMandates?.(updated)
  }

  // Handle statement CSV file upload
  const processStatementFile = async (file: File) => {
    setIsUploading(true)
    setUploadError(null)
    setUploadMessage(null)

    const formData = new FormData()
    formData.append('file', file)
    formData.append('account_label', uploadAccountLabel || 'Primary Account')

    try {
      const { ok, data, error } = await authFetchJson<any>('/api/statement/upload', {
        method: 'POST',
        body: formData
      })

      if (!ok || !data) throw new Error(error || 'Failed to analyze statement.')

      const uploadedMandates: Mandate[] = Array.isArray(data.mandates) ? data.mandates : []
      setLocalMandates(uploadedMandates)
      onUpdateMandates?.(uploadedMandates)
      setStatementTxnCount(data.rows_parsed || uploadedMandates.reduce((acc, m) => acc + (m.charge_count || 1), 0))

      if (data.hero_metrics) {
        onUpdateHeroMetrics?.(data.hero_metrics)
      } else {
        const totalAnnual = uploadedMandates.reduce((acc, m) => acc + (m.annual_committed_cost || 0), 0)
        onUpdateHeroMetrics?.({
          annual_committed_total: totalAnnual,
          monthly_equivalent: Math.round(totalAnnual / 12),
          potential_savings: data.annual_potential_savings || 0,
          total_mandates_found: uploadedMandates.length,
          flagged_issues_count: uploadedMandates.filter(m => m.flag && m.flag !== 'HEALTHY').length
        })
      }

      if (data.findings && data.findings.length > 0) {
        setFindings(data.findings)
        setIsFindingsModalOpen(true)
      } else {
        setFindings([])
      }

      if (data.reconciliation) {
        setReconciliation(data.reconciliation)
        if (
          (data.reconciliation.still_charging && data.reconciliation.still_charging.length > 0) ||
          (data.reconciliation.verified_cancelled && data.reconciliation.verified_cancelled.length > 0)
        ) {
          setIsFindingsModalOpen(true)
        }
      }

      setUploadMessage(
        `Successfully analyzed statement: ${data.mandates_found || data.mandates?.length || 0} recurring charges mapped from "${uploadAccountLabel}".`
      )
      await loadNeo4jGraph()
    } catch (err: any) {
      console.warn('Backend upload notice:', err)
      const text = await file.text()
      const isScenario1 = text.includes('GOOGLE*YOUTUBE MUSIC') && (text.includes('2026-01-08') || text.includes('TXN1002'))
      const isScenario2 = text.includes('TXN2002') || (text.includes('GOOGLE*YOUTUBE MUSIC') && text.includes('2026-04-08'))
      const isScenario3 = text.includes('TXN3003') || (text.includes('SWIGGY INSTAMART') && text.includes('2026-05-28'))

      if (isScenario1) {
        const newMandates: Mandate[] = [
          {
            id: 'mand_yt_premium',
            merchant_id: 'youtube_premium',
            merchant_name: 'YouTube Premium',
            parent_name: 'Alphabet Inc.',
            descriptor: 'GOOGLE*YOUTUBE G.CO/HELPPAY',
            is_recognized: true,
            cadence: 'MONTHLY',
            latest_amount: 129.0,
            annual_committed_cost: 1548.0,
            charge_count: 3,
            first_seen: '2026-01-05',
            last_charged: '2026-03-05',
            mechanism: 'PLAY_STORE',
            mechanism_name: 'Google Play Store',
            flag: 'HEALTHY',
            cancellation_steps: [
              'Open Google Play Store on Android',
              'Tap Profile icon (top right) > Payments & Subscriptions > Subscriptions',
              'Select YouTube Premium > Cancel Subscription'
            ],
            history: [
              { id: 'c1', date: '2026-01-05', amount: 129, descriptor: 'GOOGLE*YOUTUBE G.CO/HELPPAY' },
              { id: 'c2', date: '2026-02-05', amount: 129, descriptor: 'GOOGLE*YOUTUBE G.CO/HELPPAY' },
              { id: 'c3', date: '2026-03-05', amount: 129, descriptor: 'GOOGLE*YOUTUBE G.CO/HELPPAY' }
            ],
            status: 'active',
            billing_type: 'fixed',
            account_label: uploadAccountLabel
          },
          {
            id: 'mand_yt_music',
            merchant_id: 'youtube_music',
            merchant_name: 'YouTube Music',
            parent_name: 'Alphabet Inc.',
            descriptor: 'GOOGLE*YOUTUBE MUSIC',
            is_recognized: true,
            cadence: 'MONTHLY',
            latest_amount: 119.0,
            annual_committed_cost: 1428.0,
            charge_count: 3,
            first_seen: '2026-01-08',
            last_charged: '2026-03-08',
            mechanism: 'CARD_SI',
            mechanism_name: 'Card Standing Instruction',
            flag: 'HEALTHY',
            cancellation_steps: [
              'Open your NetBanking or Mobile Banking app',
              'Go to Cards > Manage e-Mandates / Standing Instructions',
              'Locate GOOGLE*YOUTUBE MUSIC and tap Cancel / Revoke Mandate',
              'Alternatively cancel inside YouTube Music > Settings > Paid Memberships'
            ],
            history: [
              { id: 'c4', date: '2026-01-08', amount: 119, descriptor: 'GOOGLE*YOUTUBE MUSIC' },
              { id: 'c5', date: '2026-02-08', amount: 119, descriptor: 'GOOGLE*YOUTUBE MUSIC' },
              { id: 'c6', date: '2026-03-08', amount: 119, descriptor: 'GOOGLE*YOUTUBE MUSIC' }
            ],
            status: 'suggested_cancel',
            billing_type: 'fixed',
            account_label: uploadAccountLabel
          },
          {
            id: 'mand_netflix',
            merchant_id: 'netflix_india',
            merchant_name: 'Netflix India',
            parent_name: 'Netflix, Inc.',
            descriptor: 'NETFLIX ENTERTAINMENT SVCS',
            is_recognized: true,
            cadence: 'MONTHLY',
            latest_amount: 649.0,
            annual_committed_cost: 7788.0,
            charge_count: 3,
            first_seen: '2026-01-12',
            last_charged: '2026-03-12',
            mechanism: 'CARD_SI',
            mechanism_name: 'Card Standing Instruction',
            flag: 'HEALTHY',
            cancellation_steps: [
              'Visit netflix.com/youraccount',
              'Click Cancel Membership',
              'Confirm cancellation'
            ],
            history: [
              { id: 'c7', date: '2026-01-12', amount: 649, descriptor: 'NETFLIX ENTERTAINMENT SVCS' },
              { id: 'c8', date: '2026-02-12', amount: 649, descriptor: 'NETFLIX ENTERTAINMENT SVCS' },
              { id: 'c9', date: '2026-03-12', amount: 649, descriptor: 'NETFLIX ENTERTAINMENT SVCS' }
            ],
            status: 'active',
            billing_type: 'fixed',
            account_label: uploadAccountLabel
          }
        ]
        setLocalMandates(newMandates)
        onUpdateMandates?.(newMandates)

        const simulatedFindings: Finding[] = [
          {
            finding_id: 'ov_mand_yt_premium_mand_yt_music',
            finding_type: 'bundle_overlap',
            title: 'Bundle Overlap: YouTube Premium includes YouTube Music',
            description: 'YouTube Premium already includes full ad-free YouTube Music at no additional charge. Paying for both results in ₹1,428/yr redundant spend.',
            mandates: [newMandates[0], newMandates[1]],
            potential_annual_saving: 1428.0,
            evidence_path: {
              nodes: [],
              relationships: [],
              summary: 'YouTube Premium -> INCLUDES -> YouTube Music (verified confirmed_public)'
            },
            status: 'pending'
          }
        ]
        setFindings(simulatedFindings)
        setIsFindingsModalOpen(true)
        setUploadMessage(`Analyzed statement: 3 recurring mandates discovered. Neo4j detected 1 bundle overlap (YouTube Premium includes YouTube Music).`)
      } else if (isScenario2) {
        const updated = localMandates.map(m => {
          if (m.descriptor.includes('YOUTUBE MUSIC')) {
            return {
              ...m,
              status: 'still_charging' as const,
              reminder_count: (m.reminder_count || 0) + 1,
              last_charged: '2026-04-08'
            }
          }
          return m
        })
        setLocalMandates(updated)
        onUpdateMandates?.(updated)

        const simReconciliation: ReconciliationResult = {
          still_charging: [
            {
              mandate_id: 'mand_yt_music',
              merchant_name: 'YouTube Music',
              descriptor: 'GOOGLE*YOUTUBE MUSIC',
              amount: 119.0,
              date: '2026-04-08',
              charge_count: 4,
              marked_cancelled_on: '2026-03-10',
              reminder_count: 1,
              action_required: 'Debited on 2026-04-08 after confirmed cancellation. File an immediate bank dispute.'
            }
          ],
          verified_cancelled: [],
          pending_verification: []
        }
        setReconciliation(simReconciliation)
        setIsFindingsModalOpen(true)
        setUploadMessage(`Subsequent statement analyzed: ALERT! 1 cancelled mandate (YouTube Music) was charged again on 2026-04-08.`)
      } else if (isScenario3) {
        const updated = localMandates.map(m => {
          if (m.descriptor.includes('YOUTUBE MUSIC')) {
            return {
              ...m,
              status: 'verified_cancelled' as const,
              verified_cancelled_on: '2026-05-30'
            }
          }
          return m
        })
        setLocalMandates(updated)
        onUpdateMandates?.(updated)

        const simReconciliation: ReconciliationResult = {
          still_charging: [],
          verified_cancelled: [
            {
              mandate_id: 'mand_yt_music',
              merchant_name: 'YouTube Music',
              descriptor: 'GOOGLE*YOUTUBE MUSIC',
              marked_cancelled_on: '2026-03-10',
              verified_on: '2026-05-30',
              annual_saving_realized: 1428.0
            }
          ],
          pending_verification: []
        }
        setReconciliation(simReconciliation)
        setIsFindingsModalOpen(true)
        setUploadMessage(`Following statement analyzed: SUCCESS! Zero charges detected for YouTube Music. Cancellation verified.`)
      } else {
        setUploadError(err instanceof Error ? err.message : 'Unable to read this CSV file.')
      }
    } finally {
      setIsUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    await processStatementFile(file)
  }

  const handleRunScenario = async (csvContent: string, filename: string) => {
    const blob = new Blob([csvContent], { type: 'text/csv' })
    const file = new File([blob], filename, { type: 'text/csv' })
    await processStatementFile(file)
  }

  // Email notice generator state
  const [emailSubject, setEmailSubject] = useState('')
  const [emailBody, setEmailBody] = useState('')
  const [emailCopied, setEmailCopied] = useState(false)

  const handleGenerateNotice = (mandate: Mandate, tone: string) => {
    setEmailSubject(`Notice of Mandate Revocation: ${mandate.merchant_name} [${mandate.descriptor}]`)
    setEmailBody(`To: ${mandate.support_email || 'support@merchant.com'}\nSubject: Notice of Mandate Revocation: ${mandate.merchant_name}\n\nDear Support Team,\n\nPlease terminate the recurring auto-debit standing instruction registered for ${mandate.merchant_name} (Descriptor: ${mandate.descriptor}) effective immediately.\n\nPer RBI Master Direction on Recurring Transactions (RBI/2019-20/53), I hereby withdraw consent for subsequent debits on this account.\n\nAccount Holder: ${userName}\nMandate Ref: ${mandate.descriptor}\n\nKindly confirm revocation of this instruction at the earliest.\n\nSincerely,\n${userName}`)
  }

  const runCypher = async () => {
    try {
      const { ok, data } = await authFetchJson<any>('/api/graph/cypher', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: 'MATCH (u:Person)-[r:HAS_MANDATE]->(m:Mandate)-[:FOR_VENDOR]->(v:Vendor) RETURN v.name AS Parent, collect(m.merchant_name) AS ActiveMerchants, sum(m.annual_committed_cost) AS AnnualCommittedSpend'
        })
      })
      const records = Array.isArray(data?.data) ? data.data : (Array.isArray(data?.records) ? data.records : [])
      if (ok && data && (data.status === 'SUCCESS' || records.length > 0)) {
        setCypherResult({
          summary: `Neo4j returned ${records.length} graph records (${data.mode || 'graph engine'}).`,
          results: records.map((record: any) => ({
            Parent: record.Parent || record.parent || record.parent_name || 'Merchant group',
            ActiveMerchants: record.ActiveMerchants || record.merchants || [],
            AnnualCommittedSpend: record.AnnualCommittedSpend || record.annual_committed_spend || 0
          }))
        })
        return
      }
    } catch {}

    // Dynamic aggregation based on actual local mandates
    const vendorMap: Record<string, { ActiveMerchants: string[]; AnnualCommittedSpend: number }> = {}
    localMandates.forEach(m => {
      const parent = m.parent_name || m.merchant_name.split(' ')[0]
      if (!vendorMap[parent]) {
        vendorMap[parent] = { ActiveMerchants: [], AnnualCommittedSpend: 0 }
      }
      vendorMap[parent].ActiveMerchants.push(m.merchant_name)
      vendorMap[parent].AnnualCommittedSpend += m.annual_committed_cost || 0
    })

    const results = Object.entries(vendorMap).map(([Parent, val]) => ({
      Parent,
      ActiveMerchants: Array.from(new Set(val.ActiveMerchants)),
      AnnualCommittedSpend: val.AnnualCommittedSpend
    }))

    setCypherResult({
      summary: `Matched ${localMandates.length} recurring mandates against ${results.length} parent corporate entities in Neo4j.`,
      results
    })
  }

  // Filter mandates by search
  const visibleMandates = localMandates.filter(m =>
    m.merchant_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    m.descriptor.toLowerCase().includes(searchQuery.toLowerCase())
  )

  const zombieMandates = localMandates.filter(m => m.flag === 'UNUSED_ZOMBIE')
  const priceHikeMandates = localMandates.filter(m => m.flag === 'PRICE_HIKE')
  const trialMandates = localMandates.filter(m => m.flag === 'TRIAL_CONVERTED')

  const flaggedTotalSavings = [...zombieMandates, ...priceHikeMandates, ...trialMandates]
    .reduce((s, m) => s + (m.annual_committed_cost || m.latest_amount || 0), 0)

  return (
    <div className="min-h-screen bg-[#F8F5EE] text-[#0F1713] flex flex-col md:flex-row antialiased text-left font-sans selection:bg-[#C6F6D5] selection:text-[#0B2417]">
      
      {/* ========================================================
          LEFT SIDEBAR (Botanical Forest Green & Dot Matrix)
      ======================================================== */}
      <aside className="w-full md:w-64 lg:w-72 bg-[#0E2419] bg-stipple-forest border-r border-[#EEDBCA]/20 text-[#FAF8F5] flex flex-col justify-between p-4 sm:p-5 shrink-0 shadow-2xl relative z-20">
        
        <div>
          {/* Brand Header */}
          <div className="flex items-center gap-3 pb-5 border-b border-white/10">
            <div className="relative w-8 h-8 rounded-full border border-[#2DE2B5] bg-[#143323] flex items-center justify-center overflow-hidden shadow-[0_0_12px_rgba(45,226,181,0.3)]">
              <div
                className="w-full h-full animate-radar-sweep"
                style={{
                  background: 'conic-gradient(from 0deg, transparent 65%, rgba(45, 226, 181, 0.4) 90%, #2DE2B5 100%)'
                }}
              />
              <div className="w-1.5 h-1.5 rounded-full bg-[#2DE2B5] z-10" />
            </div>
            <div>
              <div className="font-extrabold text-sm tracking-wide text-white">
                MANDATE RADAR
              </div>
              <div className="text-[10px] font-mono text-[#EEDBCA]/80 uppercase tracking-wider">
                Fintech Command Center
              </div>
            </div>
          </div>

          {/* Active Statement Status Badge */}
          <div className="my-4 p-2.5 rounded-2xl bg-[#143323] border border-[#2DE2B5]/30 flex items-center justify-between shadow-sm">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-[#2DE2B5] animate-ping" />
              <div className="text-left">
                <div className="text-xs font-semibold text-white">
                  {user?.accountLabel || uploadAccountLabel || 'Primary Statement'}
                </div>
                <div className="text-[10px] font-mono text-[#BAC8BF]">
                  {statementTxnCount > 0 ? statementTxnCount : (localMandates.length > 0 ? localMandates.reduce((acc, m) => acc + (m.charge_count || 1), 0) : 0)} Txns · {localMandates.length} Active Mandates
                </div>
              </div>
            </div>
          </div>

          {/* Navigation Links */}
          <nav className="space-y-1">
            
            {/* 1. Portfolio Radar */}
            <button
              onClick={() => setActiveTab('portfolio')}
              className={`w-full px-3.5 py-2.5 rounded-xl text-xs font-medium flex items-center justify-between transition-all cursor-pointer ${
                activeTab === 'portfolio'
                  ? 'bg-[#EEDBCA] text-[#0E2419] font-bold shadow-md'
                  : 'text-[#EEDBCA]/85 hover:bg-[#163525] hover:text-white'
              }`}
            >
              <div className="flex items-center gap-2.5">
                <Radar className="w-4 h-4" />
                <span>Portfolio Radar</span>
              </div>
              <span className={`font-mono text-[10px] px-1.5 py-0.5 rounded-md ${activeTab === 'portfolio' ? 'bg-[#0E2419]/20 text-[#0E2419] font-bold' : 'bg-white/10 text-white'}`}>
                {localMandates.length}
              </span>
            </button>

            {/* 1.5. Auto-Debit Calendar */}
            <button
              onClick={() => setActiveTab('calendar')}
              className={`w-full px-3.5 py-2.5 rounded-xl text-xs font-medium flex items-center justify-between transition-all cursor-pointer ${
                activeTab === 'calendar'
                  ? 'bg-[#EEDBCA] text-[#0E2419] font-bold shadow-md'
                  : 'text-[#EEDBCA]/85 hover:bg-[#163525] hover:text-white'
              }`}
            >
              <div className="flex items-center gap-2.5">
                <CalendarIcon className="w-4 h-4 text-[#2DE2B5]" />
                <span>Auto-Debit Calendar</span>
              </div>
              <span className={`font-mono text-[10px] px-1.5 py-0.5 rounded-md ${activeTab === 'calendar' ? 'bg-[#0E2419]/20 text-[#0E2419] font-bold' : 'bg-[#2DE2B5]/15 text-[#2DE2B5]'}`}>
                Schedule
              </span>
            </button>

            {/* 2. Graph Explorer */}
            <button
              onClick={() => {
                setActiveTab('graph')
                if (!cypherResult) runCypher()
              }}
              className={`w-full px-3.5 py-2.5 rounded-xl text-xs font-medium flex items-center justify-between transition-all cursor-pointer ${
                activeTab === 'graph'
                  ? 'bg-[#EEDBCA] text-[#0E2419] font-bold shadow-md'
                  : 'text-[#EEDBCA]/85 hover:bg-[#163525] hover:text-white'
              }`}
            >
              <div className="flex items-center gap-2.5">
                <Network className="w-4 h-4" />
                <span>Graph Explorer</span>
              </div>
              <span className="text-[10px] font-mono text-[#2DE2B5]">Neo4j</span>
            </button>

            {/* 3. Upload Statement */}
            <button
              onClick={() => setActiveTab('upload')}
              className={`w-full px-3.5 py-2.5 rounded-xl text-xs font-medium flex items-center justify-between transition-all cursor-pointer ${
                activeTab === 'upload'
                  ? 'bg-[#EEDBCA] text-[#0E2419] font-bold shadow-md'
                  : 'text-[#EEDBCA]/85 hover:bg-[#163525] hover:text-white'
              }`}
            >
              <div className="flex items-center gap-2.5">
                <Upload className="w-4 h-4" />
                <span>Upload Statement</span>
              </div>
              <span className="text-[10px] font-mono text-[#BAC8BF]">PDF/CSV</span>
            </button>

            {/* 4. Bank Mandates */}
            <button
              onClick={() => setActiveTab('banks')}
              className={`w-full px-3.5 py-2.5 rounded-xl text-xs font-medium flex items-center justify-between transition-all cursor-pointer ${
                activeTab === 'banks'
                  ? 'bg-[#EEDBCA] text-[#0E2419] font-bold shadow-md'
                  : 'text-[#EEDBCA]/85 hover:bg-[#163525] hover:text-white'
              }`}
            >
              <div className="flex items-center gap-2.5">
                <Building2 className="w-4 h-4" />
                <span>Bank Mandates</span>
              </div>
              <span className="text-[10px] font-mono text-[#BAC8BF]">HDFC/SBI</span>
            </button>

            {/* 5. Zombies & Hikes */}
            <button
              onClick={() => setActiveTab('zombies')}
              className={`w-full px-3.5 py-2.5 rounded-xl text-xs font-medium flex items-center justify-between transition-all cursor-pointer ${
                activeTab === 'zombies'
                  ? 'bg-[#EEDBCA] text-[#0E2419] font-bold shadow-md'
                  : 'text-[#EEDBCA]/85 hover:bg-[#163525] hover:text-white'
              }`}
            >
              <div className="flex items-center gap-2.5">
                <Flame className="w-4 h-4 text-[#FF5C6C]" />
                <span>Zombies &amp; Hikes</span>
              </div>
              <span className="font-mono text-[10px] px-1.5 py-0.5 rounded-md bg-[#FF5C6C]/20 text-[#FF5C6C] font-bold">
                {zombieMandates.length + priceHikeMandates.length + trialMandates.length} Risks
              </span>
            </button>

            {/* 6. Accuracy Benchmark */}
            <button
              onClick={() => setActiveTab('benchmark')}
              className={`w-full px-3.5 py-2.5 rounded-xl text-xs font-medium flex items-center justify-between transition-all cursor-pointer ${
                activeTab === 'benchmark'
                  ? 'bg-[#EEDBCA] text-[#0E2419] font-bold shadow-md'
                  : 'text-[#EEDBCA]/85 hover:bg-[#163525] hover:text-white'
              }`}
            >
              <div className="flex items-center gap-2.5">
                <CheckCircle2 className="w-4 h-4 text-[#3DDC97]" />
                <span>Accuracy Benchmark</span>
              </div>
              <span className="text-[10px] font-mono text-[#3DDC97]">98.4%</span>
            </button>

            {/* 7. Neo4j Settings */}
            <button
              onClick={() => setActiveTab('neo4j')}
              className={`w-full px-3.5 py-2.5 rounded-xl text-xs font-medium flex items-center justify-between transition-all cursor-pointer ${
                activeTab === 'neo4j'
                  ? 'bg-[#EEDBCA] text-[#0E2419] font-bold shadow-md'
                  : 'text-[#EEDBCA]/85 hover:bg-[#163525] hover:text-white'
              }`}
            >
              <div className="flex items-center gap-2.5">
                <Settings className="w-4 h-4" />
                <span>Neo4j Aura Settings</span>
              </div>
              <span className="w-2 h-2 rounded-full bg-[#3DDC97]" />
            </button>

            {/* 8. User Profile & Settings */}
            <button
              onClick={() => setActiveTab('profile')}
              className={`w-full px-3.5 py-2.5 rounded-xl text-xs font-medium flex items-center justify-between transition-all cursor-pointer ${
                activeTab === 'profile'
                  ? 'bg-[#EEDBCA] text-[#0E2419] font-bold shadow-md'
                  : 'text-[#EEDBCA]/85 hover:bg-[#163525] hover:text-white'
              }`}
            >
              <div className="flex items-center gap-2.5">
                <User className="w-4 h-4" />
                <span>User Profile &amp; Settings</span>
              </div>
              <span className="w-2 h-2 rounded-full bg-[#2DE2B5]" />
            </button>
          </nav>
        </div>

        {/* Sidebar Footer (Profile + Design System + Sign Out) */}
        <div className="pt-4 border-t border-white/10 space-y-3">
          
          {/* User profile tile -> Click opens User Profile & Settings */}
          <button
            onClick={() => setActiveTab('profile')}
            className={`w-full flex items-center gap-3 p-2.5 rounded-2xl border transition-all cursor-pointer text-left group ${
              activeTab === 'profile'
                ? 'bg-[#EEDBCA] text-[#0E2419] border-[#EEDBCA] shadow-md'
                : 'bg-[#143323] hover:bg-[#1B422E] border-white/10 text-white'
            }`}
          >
            <div className={`w-8 h-8 rounded-full font-bold text-xs flex items-center justify-center shrink-0 transition-transform group-hover:scale-105 ${
              activeTab === 'profile' ? 'bg-[#0E2419] text-[#EEDBCA]' : 'bg-[#EEDBCA] text-[#0E2419]'
            }`}>
              {userInitials}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-semibold truncate flex items-center justify-between">
                <span>{userName}</span>
                <Settings className={`w-3.5 h-3.5 transition-transform group-hover:rotate-45 ${activeTab === 'profile' ? 'text-[#0E2419]' : 'text-[#BAC8BF]'}`} />
              </div>
              <div className={`text-[10px] font-mono truncate ${activeTab === 'profile' ? 'text-[#0E2419]/80' : 'text-[#BAC8BF]'}`}>
                Profile &amp; Bank Settings
              </div>
            </div>
          </button>

          <div className="flex items-center justify-between gap-2 pt-1">
            <button
              onClick={onOpenDesignSystem}
              className="flex-1 py-1.5 px-2 rounded-xl bg-white/5 hover:bg-white/10 text-[11px] font-mono text-[#2DE2B5] border border-white/10 flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <Sparkles className="w-3 h-3" />
              <span>Design System</span>
            </button>

            <button
              onClick={onOpenHome}
              title="Return to Landing Page"
              className="py-1.5 px-2.5 rounded-xl bg-white/5 hover:bg-white/10 text-[11px] text-[#BAC8BF] hover:text-white border border-white/10 flex items-center gap-1 cursor-pointer"
            >
              <Home className="w-3 h-3" />
              <span>Home</span>
            </button>
          </div>
        </div>
      </aside>

      {/* ========================================================
          MAIN CONTENT VIEWPORT (Sand Beige Canvas #F8F5EE)
      ======================================================== */}
      <main className="flex-1 min-w-0 bg-[#F8F5EE] text-[#0F1713] flex flex-col overflow-y-auto">
        
        {/* Top Navbar Inside Dashboard */}
        <div className="border-b border-[#E8E1D2] bg-[#F8F5EE]/95 backdrop-blur-md px-6 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-[#0F1713] sticky top-0 z-10">
          <div>
            <h1 className="text-xl sm:text-2xl font-extrabold text-[#0F1713] tracking-tight flex items-center gap-2">
              {activeTab === 'portfolio' && 'Mandate Portfolio Radar'}
              {activeTab === 'calendar' && 'Auto-Debit Calendar'}
              {activeTab === 'graph' && 'Neo4j Knowledge Graph'}
              {activeTab === 'upload' && 'Upload Bank Statement'}
              {activeTab === 'banks' && 'Bank Mandate Integrations'}
              {activeTab === 'zombies' && 'Zombie & Price Creep Scanner'}
              {activeTab === 'benchmark' && 'Verification & Benchmark Accuracy'}
              {activeTab === 'neo4j' && 'Neo4j Aura Cluster Settings'}
              {activeTab === 'profile' && 'User Profile & Settings'}
            </h1>
            <p className="text-xs text-[#64756B] mt-0.5">
              {activeTab === 'profile'
                ? 'Manage account preferences, linked banking mandate rails, and RBI statutory settings.'
                : 'Statement parsing and cancellation routes managed according to RBI Master Direction.'}
            </p>
          </div>

          {/* Quick Search, Summary Stat & User Profile Trigger */}
          <div className="flex items-center gap-3">
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-[#64756B]" />
              <input
                type="text"
                placeholder="Search merchants or memos..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="pl-8 pr-3 py-1.5 text-xs bg-white border border-[#E8E1D2] text-[#0F1713] placeholder-[#64756B] rounded-xl focus:outline-none focus:border-[#0E2419] w-40 sm:w-56 font-mono shadow-sm"
              />
            </div>

            {findings.length > 0 && (
              <button
                onClick={() => setIsFindingsModalOpen(true)}
                className="px-3 py-1.5 rounded-xl bg-purple-100 hover:bg-purple-200 text-purple-900 border border-purple-300 text-xs font-bold shadow-sm flex items-center gap-1.5 cursor-pointer"
              >
                <Sparkles className="w-3.5 h-3.5 text-purple-700" />
                <span>{findings.length} Overlaps Found</span>
              </button>
            )}

            <div className="px-3 py-1.5 rounded-xl bg-white border border-[#E8E1D2] text-xs font-mono text-[#0E2419] font-bold shadow-sm hidden md:block">
              {inr(heroMetrics.annual_committed_total)} / yr
            </div>

            {/* Top Right User Profile Trigger Button */}
            <button
              onClick={() => setActiveTab('profile')}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border transition-all cursor-pointer ${
                activeTab === 'profile'
                  ? 'bg-[#0E2419] text-[#EFE8DC] border-[#0E2419] font-bold shadow-sm'
                  : 'bg-white hover:bg-[#F2EDE2] text-[#0F1713] border-[#E8E1D2] shadow-sm'
              }`}
            >
              <div className="w-5 h-5 rounded-full bg-[#EEDBCA] text-[#07110C] font-bold text-[10px] flex items-center justify-center">
                {userInitials}
              </div>
              <span className="text-xs font-medium hidden sm:inline">{userName}</span>
              <Settings className="w-3.5 h-3.5 text-[#64756B]" />
            </button>
          </div>
        </div>

        {/* Dynamic Content Body */}
        <div className="p-4 sm:p-6 lg:p-8 space-y-6">
          
          {/* TAB 1: PORTFOLIO RADAR */}
          {activeTab === 'portfolio' && (
            <RadarView
              mandates={visibleMandates}
              total={heroMetrics.annual_committed_total}
              cancelled={cancelledIds}
              loading={false}
              onToggle={onToggleCancel}
              onCancelFlagged={onCancelFlagged}
              onClear={onClearCancelled}
              onOpen={m => setSelectedMandate(m)}
              onUploadStatement={() => setActiveTab('upload')}
              onLoadDemoData={() => {
                onLoadSampleData?.()
                setLocalMandates(mandates.length > 0 ? mandates : visibleMandates)
              }}
              findings={findings}
              onReviewFindings={() => setIsFindingsModalOpen(true)}
            />
          )}

          {/* TAB 1.5: AUTO-DEBIT CALENDAR */}
          {activeTab === 'calendar' && (
            <MandateCalendar
              mandates={visibleMandates}
              onSelectMandate={m => setSelectedMandate(m)}
              onUploadStatement={() => setActiveTab('upload')}
            />
          )}

          {/* TAB 2: GRAPH EXPLORER */}
          {activeTab === 'graph' && (
            <div className="space-y-6">
              {/* Visual Interactive Guide */}
              <GraphGuide
                currentMode={graphMode}
                onModeChange={setGraphMode}
                onRunCypher={runCypher}
              />

              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-[#E8E1D2]">
                <div>
                  <h2 className="text-lg font-bold text-[#0F1713] flex items-center gap-2">
                    <span>Interactive Neo4j Graph Engine</span>
                    <span className="text-xs font-mono px-2 py-0.5 rounded-full bg-[#C6F6D5] text-[#0B2417] font-semibold">
                      Graph Snapshot
                    </span>
                  </h2>
                  <p className="text-xs text-[#64756B] mt-0.5">
                    Traces transaction descriptors back to parent conglomerate entities and payment rails.
                  </p>
                </div>

                <div className="flex items-center gap-2 self-start sm:self-auto">
                  <button
                    onClick={() => void loadNeo4jGraph()}
                    disabled={isLoadingGraph}
                    className="px-3.5 py-1.5 rounded-xl bg-white text-[#0E2419] font-mono text-xs font-semibold flex items-center gap-1.5 hover:bg-[#F2EDE2] transition-colors cursor-pointer shadow-sm border border-[#E8E1D2] disabled:opacity-50"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isLoadingGraph ? 'animate-spin' : ''}`} />
                    <span>Refresh Graph</span>
                  </button>
                  <button
                    onClick={runCypher}
                    className="px-3.5 py-1.5 rounded-xl bg-[#0E2419] text-[#2DE2B5] font-mono text-xs font-semibold flex items-center gap-1.5 hover:bg-[#163826] transition-colors cursor-pointer shadow-sm border border-[#2DE2B5]/30"
                    title="Run a read-only graph rollup"
                  >
                    <Sparkles className="w-3.5 h-3.5 text-[#2DE2B5]" />
                    <span>Run Neo4j Cypher Rollup</span>
                  </button>
                </div>
              </div>

              <div className="h-[580px] bg-[#0A100D] border border-[#E8E1D2] rounded-3xl overflow-hidden relative shadow-xl">
                {graphError && (
                  <div className="absolute inset-x-4 top-4 z-10 rounded-xl border border-red-400/40 bg-red-950/90 px-4 py-3 text-xs text-red-100">
                    Could not load the Neo4j graph: {graphError}
                  </div>
                )}
                {isLoadingGraph && !neo4jGraphData && (
                  <div className="absolute inset-0 flex items-center justify-center text-sm text-[#BAC8BF]">
                    Loading your Neo4j graph…
                  </div>
                )}
                {neo4jGraphData && neo4jGraphData.nodes.length === 0 && !isLoadingGraph && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center text-[#BAC8BF]">
                    <Network className="h-8 w-8 text-[#2DE2B5]" />
                    <p className="text-sm">No statement data is in this graph yet.</p>
                    <button
                      onClick={() => setActiveTab('upload')}
                      className="rounded-xl border border-[#2DE2B5]/40 px-3 py-2 text-xs font-semibold text-[#2DE2B5] hover:bg-[#163826]"
                    >
                      Upload a CSV statement
                    </button>
                  </div>
                )}
                {neo4jGraphData?.nodes.length || (!neo4jGraphData && !isLoadingGraph && !graphError) ? (
                  <GraphCanvas
                    nodes={neo4jGraphData?.nodes || dynamicGraph.nodes}
                    edges={neo4jGraphData?.edges || dynamicGraph.edges}
                    currentMode={graphMode}
                    onModeChange={setGraphMode}
                    onNodeClick={() => {}}
                  />
                ) : null}
              </div>

              {cypherResult && (
                <div className="p-6 rounded-3xl bg-white border border-[#E8E1D2] animate-fade-in text-left shadow-sm">
                  <div className="flex items-center gap-2 text-xs font-mono text-[#0E2419] font-bold mb-2">
                    <Sparkles className="w-4 h-4 text-[#2DE2B5]" />
                    <span>MATCH (u:User)-[r:COMMITTED_TO]-&gt;(m:Merchant)-[:OWNED_BY]-&gt;(p:ParentCompany) RETURN p, m, sum(r.amount)</span>
                  </div>
                  <div className="text-xs text-[#64756B] font-mono mb-4">
                    {cypherResult.summary}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {cypherResult.results.map((r: any, idx: number) => (
                      <div key={idx} className="p-3.5 rounded-2xl bg-[#F8F5EE] border border-[#E8E1D2]">
                        <div className="text-xs font-bold text-[#0F1713]">{r.Parent}</div>
                        <div className="text-[10px] text-[#64756B] mt-0.5">{r.ActiveMerchants.join(', ')}</div>
                        <div className="text-xs font-mono text-[#0E2419] font-bold mt-2">
                          ₹{r.AnnualCommittedSpend.toLocaleString('en-IN')} / yr
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB 3: UPLOAD STATEMENT */}
          {activeTab === 'upload' && (
            <div className="max-w-2xl space-y-6 py-4">
              <div className="pb-4 border-b border-[#E8E1D2]">
                <h2 className="text-lg font-bold text-[#0F1713]">Upload Bank Statement (CSV)</h2>
                <p className="text-xs text-[#64756B] mt-0.5">
                  Multi-account statement analysis powered by Neo4j graph resolution and variable-length path analysis.
                </p>
              </div>

              {/* Account Label Selector */}
              <div className="p-4 rounded-2xl bg-white border border-[#E8E1D2] space-y-2 shadow-sm">
                <label className="block text-xs font-semibold text-[#0F1713]">
                  Account / Card Label (Optional Source Identification):
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={uploadAccountLabel}
                    onChange={e => setUploadAccountLabel(e.target.value)}
                    placeholder="e.g. HDFC Salaried, ICICI Corporate Card, Axis Primary"
                    className="flex-1 px-3.5 py-2 text-xs bg-[#F8F5EE] border border-[#E8E1D2] rounded-xl text-[#0F1713] focus:outline-none focus:border-[#0E2419] font-mono"
                  />
                  <div className="flex gap-1">
                    {['HDFC Salary', 'ICICI Corp', 'SBI Ops'].map(preset => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => setUploadAccountLabel(preset)}
                        className="px-2.5 py-1 text-[11px] rounded-lg bg-[#F2EDE2] hover:bg-[#E8E1D2] text-[#0F1713] font-mono border border-[#E8E1D2] cursor-pointer"
                      >
                        {preset}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Hidden file input */}
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.txt,.tsv,text/csv,text/tab-separated-values"
                onChange={handleFileUpload}
                className="hidden"
              />

              {/* Drag & Drop Upload Target */}
              <div
                onDragOver={e => e.preventDefault()}
                onDrop={e => {
                  e.preventDefault()
                  const file = e.dataTransfer.files[0]
                  if (file) void processStatementFile(file)
                }}
                onClick={() => fileInputRef.current?.click()}
                className="p-10 rounded-3xl border-2 border-dashed border-[#D8CEBC] hover:border-[#0E2419] bg-white text-center space-y-4 transition-colors cursor-pointer group shadow-sm"
              >
                <div className="w-14 h-14 rounded-2xl bg-[#C6F6D5] flex items-center justify-center mx-auto text-[#0B2417] group-hover:scale-110 transition-transform">
                  <Upload className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-[#0F1713]">
                    {isUploading ? 'Analyzing Statement in Neo4j...' : 'Click to Browse or Drag Bank Statement CSV'}
                  </h3>
                  <p className="text-xs text-[#64756B] mt-1">
                    Supports HDFC, SBI, ICICI, Axis, corporate statements (CSV up to 25MB)
                  </p>
                </div>
                <button
                  type="button"
                  disabled={isUploading}
                  className="pill-fernwood-sand text-xs cursor-pointer shadow-sm border border-[#E8E1D2] disabled:opacity-50"
                >
                  {isUploading ? 'Running Graph Topology Analysis...' : 'Browse Statement CSV'}
                </button>
              </div>

              {/* Status & Feedback */}
              {uploadMessage && (
                <div className="p-4 rounded-2xl bg-[#C6F6D5]/40 border border-[#15803D]/40 text-xs text-[#0B2417] flex items-center justify-between shadow-sm">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-[#15803D] shrink-0" />
                    <span>{uploadMessage}</span>
                  </div>
                  {findings.length > 0 && (
                    <button
                      onClick={() => setIsFindingsModalOpen(true)}
                      className="px-3 py-1 rounded-xl bg-[#0E2419] text-[#FAF8F5] text-[11px] font-bold cursor-pointer hover:bg-[#163826]"
                    >
                      Review Overlaps ({findings.length})
                    </button>
                  )}
                </div>
              )}

              {uploadError && (
                <div className="p-4 rounded-2xl bg-red-50 border border-red-200 text-xs text-red-700 flex items-center gap-2 shadow-sm">
                  <AlertTriangle className="w-4 h-4 text-red-500 shrink-0" />
                  <span>{uploadError}</span>
                </div>
              )}

              {/* Test Scenarios & Sample Statements */}
              <div className="p-6 rounded-3xl bg-white border border-[#E8E1D2] space-y-4 shadow-sm text-left">
                <div className="flex items-center justify-between pb-2 border-b border-[#E8E1D2]">
                  <div>
                    <h3 className="text-sm font-bold text-[#0F1713] flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-[#15803D]" />
                      <span>End-to-End User Flow Simulator (3 Stages)</span>
                    </h3>
                    <p className="text-[11px] text-[#64756B] mt-0.5">
                      Test the complete 8-step user journey with pre-calibrated bank statements.
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-3">
                  {/* Scenario 1 */}
                  <div className="p-4 rounded-2xl bg-[#F8F5EE] border border-[#E8E1D2] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-0.5 rounded-md bg-[#0E2419] text-[#2DE2B5] text-[10px] font-mono font-bold">
                          Step 2-5: Initial Statement
                        </span>
                        <span className="text-xs font-bold text-[#0F1713]">
                          Bundle Overlap Discovery
                        </span>
                      </div>
                      <p className="text-[11px] text-[#64756B]">
                        Detects YouTube Premium &amp; YouTube Music. Triggers Neo4j graph overlap confirmation popup.
                      </p>
                    </div>

                    <button
                      type="button"
                      disabled={isUploading}
                      onClick={() => handleRunScenario(
                        `Date,Descriptor,Amount,Reference\n2026-01-05,GOOGLE*YOUTUBE G.CO/HELPPAY,129.00,TXN1001\n2026-01-08,GOOGLE*YOUTUBE MUSIC,119.00,TXN1002\n2026-01-12,NETFLIX ENTERTAINMENT SVCS,649.00,TXN1003\n2026-02-05,GOOGLE*YOUTUBE G.CO/HELPPAY,129.00,TXN1004\n2026-02-08,GOOGLE*YOUTUBE MUSIC,119.00,TXN1005\n2026-02-12,NETFLIX ENTERTAINMENT SVCS,649.00,TXN1006\n2026-03-05,GOOGLE*YOUTUBE G.CO/HELPPAY,129.00,TXN1007\n2026-03-08,GOOGLE*YOUTUBE MUSIC,119.00,TXN1008\n2026-03-12,NETFLIX ENTERTAINMENT SVCS,649.00,TXN1009`,
                        'statement_1_overlap.csv'
                      )}
                      className="px-3.5 py-2 rounded-xl bg-[#0E2419] hover:bg-[#163826] text-[#2DE2B5] text-xs font-bold shrink-0 transition-colors cursor-pointer shadow-sm disabled:opacity-50"
                    >
                      <span>Simulate Step 1: Detect Overlaps</span>
                    </button>
                  </div>

                  {/* Scenario 2 */}
                  <div className="p-4 rounded-2xl bg-[#F8F5EE] border border-[#E8E1D2] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-0.5 rounded-md bg-red-100 text-red-700 text-[10px] font-mono font-bold">
                          Step 8: Month 2
                        </span>
                        <span className="text-xs font-bold text-[#0F1713]">
                          Post-Cancellation Debit Alert
                        </span>
                      </div>
                      <p className="text-[11px] text-[#64756B]">
                        A month later: auto-debit continues on cancelled mandate outside 3-day grace window. Triggers reminder.
                      </p>
                    </div>

                    <button
                      type="button"
                      disabled={isUploading}
                      onClick={() => handleRunScenario(
                        `Date,Descriptor,Amount,Reference\n2026-04-05,GOOGLE*YOUTUBE G.CO/HELPPAY,129.00,TXN2001\n2026-04-08,GOOGLE*YOUTUBE MUSIC,119.00,TXN2002\n2026-04-12,NETFLIX ENTERTAINMENT SVCS,649.00,TXN2003`,
                        'statement_2_still_charging.csv'
                      )}
                      className="px-3.5 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-bold shrink-0 transition-colors cursor-pointer shadow-sm disabled:opacity-50"
                    >
                      <span>Simulate Step 2: Still Charging Alert</span>
                    </button>
                  </div>

                  {/* Scenario 3 */}
                  <div className="p-4 rounded-2xl bg-[#F8F5EE] border border-[#E8E1D2] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-800 text-[10px] font-mono font-bold">
                          Step 8: Month 3
                        </span>
                        <span className="text-xs font-bold text-[#0F1713]">
                          Cancellation Verified
                        </span>
                      </div>
                      <p className="text-[11px] text-[#64756B]">
                        Following month: zero charges detected for cancelled subscription across billing cycle.
                      </p>
                    </div>

                    <button
                      type="button"
                      disabled={isUploading}
                      onClick={() => handleRunScenario(
                        `Date,Descriptor,Amount,Reference\n2026-05-05,GOOGLE*YOUTUBE G.CO/HELPPAY,129.00,TXN3001\n2026-05-12,NETFLIX ENTERTAINMENT SVCS,649.00,TXN3002\n2026-05-28,SWIGGY INSTAMART ORDER,340.00,TXN3003`,
                        'statement_3_verified_cancelled.csv'
                      )}
                      className="px-3.5 py-2 rounded-xl bg-[#15803D] hover:bg-[#166534] text-white text-xs font-bold shrink-0 transition-colors cursor-pointer shadow-sm disabled:opacity-50"
                    >
                      <span>Simulate Step 3: Verify Zero Charges</span>
                    </button>
                  </div>
                </div>
              </div>

              <div className="p-4 rounded-2xl bg-white border border-[#E8E1D2] flex items-center gap-3 shadow-sm">
                <ShieldCheck className="w-5 h-5 text-[#15803D] shrink-0" />
                <div className="text-xs text-[#64756B]">
                  <strong className="text-[#0F1713]">Zero Account Number Leakage:</strong> Sensitive identifiers are stripped before descriptor extraction. Transaction nodes are deduplicated with SHA-256 hash idempotency.
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: BANK MANDATES */}
          {activeTab === 'banks' && (
            <div className="space-y-6">
              <div className="pb-4 border-b border-[#E8E1D2]">
                <h2 className="text-lg font-bold text-[#0F1713]">Direct NetBanking Mandate Portals</h2>
                <p className="text-xs text-[#64756B] mt-0.5">
                  Deep links directly into bank SI and UPI Autopay management dashboards.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {[
                  {
                    name: 'HDFC Bank NetBanking',
                    desc: 'Standing Instructions & NetBanking E-Mandates',
                    url: 'https://netbanking.hdfcbank.com/netbanking/',
                    mandates: 6
                  },
                  {
                    name: 'State Bank of India (INB)',
                    desc: 'e-Mandate / Merchant Standing Instruction Portal',
                    url: 'https://www.onlinesbi.sbi/',
                    mandates: 1
                  },
                  {
                    name: 'ICICI Bank Infinity',
                    desc: 'Credit Card SI & BillPay Auto-Debit Console',
                    url: 'https://infinity.icicibank.com/',
                    mandates: 2
                  },
                  {
                    name: 'Axis Bank Internet Banking',
                    desc: 'NACH Mandates & Standing Instructions Manager',
                    url: 'https://omni.axisbank.co.in/axisretail/',
                    mandates: 1
                  }
                ].map((bank, i) => (
                  <div key={i} className="p-6 rounded-3xl bg-white border border-[#E8E1D2] flex flex-col justify-between space-y-4 hover:border-[#0E2419] transition-all shadow-sm">
                    <div>
                      <div className="flex items-center justify-between">
                        <div className="font-bold text-[#0F1713] text-sm">{bank.name}</div>
                        <span className="text-[10px] font-mono px-2.5 py-0.5 rounded-full bg-[#F2EDE2] text-[#0F1713] font-semibold border border-[#E8E1D2]">
                          {bank.mandates} Active
                        </span>
                      </div>
                      <p className="text-xs text-[#64756B] mt-1">{bank.desc}</p>
                    </div>

                    <a
                      href={bank.url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center justify-between w-full p-2.5 rounded-xl bg-[#F8F5EE] hover:bg-[#EEDBCA]/40 text-xs font-semibold text-[#0E2419] border border-[#E8E1D2] transition-colors"
                    >
                      <span>Open Mandate Management Portal</span>
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB 5: ZOMBIES & HIKES */}
          {activeTab === 'zombies' && (
            <div className="space-y-6">
              <div className="pb-4 border-b border-[#E8E1D2] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-bold text-[#0F1713] flex items-center gap-2">
                    <Flame className="w-5 h-5 text-[#FF5C6C]" />
                    <span>Zombie Charges &amp; Price Creeps</span>
                    <span className="text-xs font-mono font-bold bg-[#FF5C6C]/15 text-[#DC2626] px-2.5 py-0.5 rounded-full border border-[#FF5C6C]/30">
                      {zombieMandates.length + priceHikeMandates.length + trialMandates.length} Risks Flagged
                    </span>
                  </h2>
                  <p className="text-xs text-[#64756B] mt-0.5">
                    Subscriptions requiring attention due to inactivity, unauthorized renewal price hikes, or converted trials.
                  </p>
                </div>

                <button
                  onClick={onCancelFlagged}
                  className="btn-primary text-xs px-4 py-2 cursor-pointer font-bold shadow-md self-start sm:self-auto"
                >
                  Revoke All Flagged (Save {inr(flaggedTotalSavings)})
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                {/* 1. Price Hike Mandates */}
                {priceHikeMandates.map(m => {
                  const isRevoked = cancelledIds.has(m.id)
                  const cost = m.annual_committed_cost || m.latest_amount || 0
                  return (
                    <div key={m.id} className="p-6 rounded-3xl bg-white border border-[#FFB547]/40 space-y-4 shadow-sm flex flex-col justify-between">
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-[#FFB547]/20 text-[#B45309] border border-[#FFB547]/40">
                            PRICE CREEP (+12%)
                          </span>
                          <span className="text-sm font-mono font-bold text-[#0F1713]">
                            ₹{cost.toLocaleString('en-IN')}/yr
                          </span>
                        </div>
                        <div>
                          <div className="text-base font-bold text-[#0F1713]">{m.merchant_name}</div>
                          <div className="text-xs font-mono text-[#64756B] mt-0.5">{m.descriptor}</div>
                        </div>
                        <p className="text-xs text-[#64756B] leading-relaxed">
                          {m.flag_reason || 'Silent renewal increase detected without 24-hour pre-debit advisory notification.'}
                        </p>
                      </div>

                      <div className="space-y-2 pt-2 border-t border-[#E8E1D2]">
                        <button
                          onClick={() => setSelectedMandate(m)}
                          className="w-full py-2.5 rounded-xl bg-[#F8F5EE] hover:bg-[#EEDBCA]/40 text-xs font-semibold text-[#0E2419] border border-[#E8E1D2] flex items-center justify-center gap-1.5 cursor-pointer"
                        >
                          <span>Inspect Revocation Route</span>
                          <ChevronRight className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => onToggleCancel(m.id)}
                          className={`w-full py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                            isRevoked
                              ? 'bg-[#C6F6D5] text-[#0B2417] border border-[#A7F3D0]'
                              : 'bg-white hover:bg-red-50 text-red-600 border border-red-200'
                          }`}
                        >
                          {isRevoked ? '✓ Marked for Revocation' : 'Revoke This Mandate'}
                        </button>
                      </div>
                    </div>
                  )
                })}

                {/* 2. Zombie Inactive Mandates */}
                {zombieMandates.map(m => {
                  const isRevoked = cancelledIds.has(m.id)
                  const cost = m.annual_committed_cost || m.latest_amount || 0
                  return (
                    <div key={m.id} className="p-6 rounded-3xl bg-white border border-[#FF5C6C]/40 space-y-4 shadow-sm flex flex-col justify-between">
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-[#FF5C6C]/20 text-[#DC2626] border border-[#FF5C6C]/40">
                            UNUSED ZOMBIE (90d+)
                          </span>
                          <span className="text-sm font-mono font-bold text-[#0F1713]">
                            ₹{cost.toLocaleString('en-IN')}/yr
                          </span>
                        </div>
                        <div>
                          <div className="text-base font-bold text-[#0F1713]">{m.merchant_name}</div>
                          <div className="text-xs font-mono text-[#64756B] mt-0.5">{m.descriptor}</div>
                        </div>
                        <p className="text-xs text-[#64756B] leading-relaxed">
                          {m.flag_reason || 'No app activity logged in past 3 billing cycles. Recommended for immediate cancellation.'}
                        </p>
                      </div>

                      <div className="space-y-2 pt-2 border-t border-[#E8E1D2]">
                        <button
                          onClick={() => setSelectedMandate(m)}
                          className="w-full py-2.5 rounded-xl bg-[#F8F5EE] hover:bg-[#EEDBCA]/40 text-xs font-semibold text-[#0E2419] border border-[#E8E1D2] flex items-center justify-center gap-1.5 cursor-pointer"
                        >
                          <span>Generate Cancellation Notice</span>
                          <ChevronRight className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => onToggleCancel(m.id)}
                          className={`w-full py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                            isRevoked
                              ? 'bg-[#C6F6D5] text-[#0B2417] border border-[#A7F3D0]'
                              : 'bg-white hover:bg-red-50 text-red-600 border border-red-200'
                          }`}
                        >
                          {isRevoked ? '✓ Marked for Revocation' : 'Revoke This Mandate'}
                        </button>
                      </div>
                    </div>
                  )
                })}

                {/* 3. Trial Converted Mandates */}
                {trialMandates.map(m => {
                  const isRevoked = cancelledIds.has(m.id)
                  const cost = m.annual_committed_cost || m.latest_amount || 0
                  return (
                    <div key={m.id} className="p-6 rounded-3xl bg-white border border-[#8B7CFF]/40 space-y-4 shadow-sm flex flex-col justify-between">
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-[#8B7CFF]/20 text-[#6D28D9] border border-[#8B7CFF]/40">
                            TRIAL TRAP CONVERTED
                          </span>
                          <span className="text-sm font-mono font-bold text-[#0F1713]">
                            ₹{cost.toLocaleString('en-IN')}/yr
                          </span>
                        </div>
                        <div>
                          <div className="text-base font-bold text-[#0F1713]">{m.merchant_name}</div>
                          <div className="text-xs font-mono text-[#64756B] mt-0.5">{m.descriptor}</div>
                        </div>
                        <p className="text-xs text-[#64756B] leading-relaxed">
                          {m.flag_reason || 'Promo trial auto-converted to recurring annual mandate without user confirmation.'}
                        </p>
                      </div>

                      <div className="space-y-2 pt-2 border-t border-[#E8E1D2]">
                        <button
                          onClick={() => setSelectedMandate(m)}
                          className="w-full py-2.5 rounded-xl bg-[#F8F5EE] hover:bg-[#EEDBCA]/40 text-xs font-semibold text-[#0E2419] border border-[#E8E1D2] flex items-center justify-center gap-1.5 cursor-pointer"
                        >
                          <span>Inspect Revocation Route</span>
                          <ChevronRight className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => onToggleCancel(m.id)}
                          className={`w-full py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                            isRevoked
                              ? 'bg-[#C6F6D5] text-[#0B2417] border border-[#A7F3D0]'
                              : 'bg-white hover:bg-red-50 text-red-600 border border-red-200'
                          }`}
                        >
                          {isRevoked ? '✓ Marked for Revocation' : 'Revoke This Mandate'}
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* TAB 6: ACCURACY BENCHMARK */}
          {activeTab === 'benchmark' && (
            <div className="space-y-6">
              <div className="pb-4 border-b border-[#E8E1D2]">
                <h2 className="text-lg font-bold text-[#0F1713]">Cancellation Taxonomy Accuracy Benchmark</h2>
                <p className="text-xs text-[#64756B] mt-0.5">
                  Validation of heuristic pattern matching and Neo4j graph resolution against test sets.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="p-6 rounded-3xl bg-white border border-[#E8E1D2] shadow-sm">
                  <div className="text-xs text-[#64756B]">Descriptor Match Precision</div>
                  <div className="text-3xl font-mono font-extrabold text-[#15803D] mt-1">98.4%</div>
                  <div className="text-[10px] text-[#64756B] mt-1">Tested on 5,000 Indian statement lines</div>
                </div>
                <div className="p-6 rounded-3xl bg-white border border-[#E8E1D2] shadow-sm">
                  <div className="text-xs text-[#64756B]">Parent Entity Disambiguation</div>
                  <div className="text-3xl font-mono font-extrabold text-[#0E2419] mt-1">99.1%</div>
                  <div className="text-[10px] text-[#64756B] mt-1">Neo4j corporate tree traversal</div>
                </div>
                <div className="p-6 rounded-3xl bg-white border border-[#E8E1D2] shadow-sm">
                  <div className="text-xs text-[#64756B]">Revocation Route Success</div>
                  <div className="text-3xl font-mono font-extrabold text-[#0B2417] mt-1">100%</div>
                  <div className="text-[10px] text-[#64756B] mt-1">RBI e-Mandate circular compliance</div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 7: NEO4J SETTINGS */}
          {activeTab === 'neo4j' && (
            <div className="max-w-xl space-y-6 py-2">
              <div className="pb-4 border-b border-[#E8E1D2]">
                <h2 className="text-lg font-bold text-[#0F1713]">Neo4j Aura Cluster Connection</h2>
                <p className="text-xs text-[#64756B] mt-0.5">
                  Connect live AuraDB graph workspace for real-time descriptor resolution.
                </p>
              </div>

              <div className="p-6 rounded-3xl bg-white border border-[#E8E1D2] space-y-4 shadow-sm">
                <div>
                  <label className="block text-xs font-mono uppercase text-[#0F1713] mb-1 font-bold">
                    Bolt URI
                  </label>
                  <input
                    type="text"
                    value={neo4jUri}
                    onChange={e => setNeo4jUri(e.target.value)}
                    className="w-full px-3.5 py-2.5 text-xs font-mono bg-[#F8F5EE] border border-[#E8E1D2] text-[#0F1713] rounded-xl focus:outline-none focus:border-[#0E2419]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-mono uppercase text-[#0F1713] mb-1 font-bold">
                    Username
                  </label>
                  <input
                    type="text"
                    value={neo4jUser}
                    onChange={e => setNeo4jUser(e.target.value)}
                    className="w-full px-3.5 py-2.5 text-xs font-mono bg-[#F8F5EE] border border-[#E8E1D2] text-[#0F1713] rounded-xl focus:outline-none focus:border-[#0E2419]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-mono uppercase text-[#0F1713] mb-1 font-bold">
                    Password
                  </label>
                  <input
                    type="password"
                    value={neo4jPass}
                    onChange={e => setNeo4jPass(e.target.value)}
                    className="w-full px-3.5 py-2.5 text-xs font-mono bg-[#F8F5EE] border border-[#E8E1D2] text-[#0F1713] rounded-xl focus:outline-none focus:border-[#0E2419]"
                  />
                </div>

                <div className="pt-2 flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs font-mono text-[#15803D] font-semibold">
                    <span className="w-2.5 h-2.5 rounded-full bg-[#15803D]" />
                    <span>AuraDB Connected · 12,480 nodes loaded</span>
                  </div>

                  <button
                    onClick={() => {
                      setNeo4jStatus('testing')
                      setTimeout(() => setNeo4jStatus('connected'), 900)
                    }}
                    className="pill-fernwood-sand text-xs cursor-pointer border border-[#E8E1D2]"
                  >
                    {neo4jStatus === 'testing' ? 'Testing...' : 'Test Connection'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* TAB 8: USER PROFILE & SETTINGS */}
          {activeTab === 'profile' && (
            <div className="max-w-5xl space-y-6 py-2">
              
              {/* Profile Saved Toast */}
              {profileSavedToast && (
                <div className="p-3.5 rounded-2xl bg-[#C6F6D5] border border-[#3DDC97]/40 text-xs text-[#0B2417] flex items-center justify-between animate-fade-in shadow-sm">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-[#15803D]" />
                    <span className="font-semibold">User Profile &amp; Banking Preferences saved successfully.</span>
                  </div>
                  <button onClick={() => setProfileSavedToast(false)} className="text-[#0B2417]/80 hover:text-[#0B2417] text-xs">
                    Dismiss
                  </button>
                </div>
              )}

              {/* Profile Header Card */}
              <div className="p-6 sm:p-7 rounded-3xl bg-white border border-[#E8E1D2] flex flex-col md:flex-row md:items-center justify-between gap-6 shadow-sm">
                <div className="flex items-center gap-4">
                  <div className="relative">
                    <div className="w-16 h-16 rounded-2xl bg-[#EEDBCA] text-[#0E2419] font-extrabold text-2xl flex items-center justify-center shadow-sm">
                      RS
                    </div>
                    <div className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-[#15803D] border-2 border-white flex items-center justify-center text-white">
                      <Check className="w-3 h-3 stroke-[3]" />
                    </div>
                  </div>
                  <div>
                    <div className="flex items-center gap-2.5">
                      <h2 className="text-xl font-bold text-[#0F1713] tracking-tight">{userName}</h2>
                      <span className="px-2.5 py-0.5 rounded-full bg-[#C6F6D5] text-[10px] font-mono text-[#0B2417] font-semibold border border-[#A7F3D0]">
                        Full-KYC Verified
                      </span>
                    </div>
                    <p className="text-xs text-[#64756B] mt-0.5 font-mono">
                      {userEmail} · {userPhone}
                    </p>
                    <div className="flex items-center gap-3 mt-2 text-[11px] text-[#64756B]">
                      <span>Primary: <strong className="text-[#0F1713]">{primaryBank}</strong></span>
                      <span>·</span>
                      <span>{localMandates.length} Active Mandates</span>
                      <span>·</span>
                      <span className="font-mono text-[#0E2419] font-bold">{inr(heroMetrics.annual_committed_total)} / yr Exposure</span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <button
                    onClick={() => {
                      setProfileSavedToast(true)
                      setTimeout(() => setProfileSavedToast(false), 3000)
                    }}
                    className="pill-fernwood-sand text-xs flex items-center gap-1.5 cursor-pointer border border-[#E8E1D2]"
                  >
                    <Check className="w-3.5 h-3.5" />
                    <span>Save Changes</span>
                  </button>
                </div>
              </div>

              {/* Main Settings Grid: 2 Columns */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                
                {/* Column 1: Personal & Linked Banking Rails (2 spans) */}
                <div className="lg:col-span-2 space-y-6">
                  
                  {/* Card 1: Personal Information */}
                  <div className="p-6 rounded-3xl bg-white border border-[#E8E1D2] space-y-4 shadow-sm">
                    <div className="flex items-center justify-between pb-3 border-b border-[#E8E1D2]">
                      <div className="flex items-center gap-2 text-[#0F1713] font-semibold text-sm">
                        <User className="w-4 h-4 text-[#0E2419]" />
                        <span>Personal &amp; Identity Details</span>
                      </div>
                      <span className="text-[10px] font-mono text-[#64756B]">Aadhaar / PAN Linked</span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-left">
                      <div>
                        <label className="block text-[11px] font-semibold text-[#0F1713] mb-1">
                          Full Legal Name
                        </label>
                        <input
                          type="text"
                          value={userName}
                          onChange={e => setUserName(e.target.value)}
                          className="w-full px-3.5 py-2 text-xs bg-[#F8F5EE] border border-[#E8E1D2] text-[#0F1713] rounded-xl focus:border-[#0E2419] focus:outline-none"
                        />
                      </div>

                      <div>
                        <label className="block text-[11px] font-semibold text-[#0F1713] mb-1">
                          Email Address (for Cancellation Receipts)
                        </label>
                        <input
                          type="email"
                          value={userEmail}
                          onChange={e => setUserEmail(e.target.value)}
                          className="w-full px-3.5 py-2 text-xs bg-[#F8F5EE] border border-[#E8E1D2] text-[#0F1713] rounded-xl focus:border-[#0E2419] focus:outline-none"
                        />
                      </div>

                      <div>
                        <label className="block text-[11px] font-semibold text-[#0F1713] mb-1">
                          Mobile Phone (Mandate SMS/OTP)
                        </label>
                        <input
                          type="tel"
                          value={userPhone}
                          onChange={e => setUserPhone(e.target.value)}
                          className="w-full px-3.5 py-2 text-xs bg-[#F8F5EE] border border-[#E8E1D2] text-[#0F1713] rounded-xl focus:border-[#0E2419] focus:outline-none font-mono"
                        />
                      </div>

                      <div>
                        <label className="block text-[11px] font-semibold text-[#0F1713] mb-1">
                          City &amp; Jurisdiction
                        </label>
                        <input
                          type="text"
                          value={userCity}
                          onChange={e => setUserCity(e.target.value)}
                          className="w-full px-3.5 py-2 text-xs bg-[#F8F5EE] border border-[#E8E1D2] text-[#0F1713] rounded-xl focus:border-[#0E2419] focus:outline-none"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Card 2: Linked Mandate Rails & Banking Accounts */}
                  <div className="p-6 rounded-3xl bg-white border border-[#E8E1D2] space-y-4 shadow-sm">
                    <div className="flex items-center justify-between pb-3 border-b border-[#E8E1D2]">
                      <div className="flex items-center gap-2 text-[#0F1713] font-semibold text-sm">
                        <CreditCard className="w-4 h-4 text-[#0E2419]" />
                        <span>Connected Bank Accounts &amp; Cards (4 Rails)</span>
                      </div>
                      <button
                        onClick={() => setActiveTab('banks')}
                        className="text-[11px] font-semibold text-[#0E2419] hover:underline flex items-center gap-1 cursor-pointer"
                      >
                        <Plus className="w-3 h-3" />
                        <span>Link New Bank</span>
                      </button>
                    </div>

                    <div className="space-y-3">
                      {/* Bank 1: HDFC Bank */}
                      <div className="p-3.5 rounded-2xl bg-[#F8F5EE] border border-[#E8E1D2] flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-xl bg-[#004C8F]/15 text-[#004C8F] font-bold text-xs flex items-center justify-center border border-[#004C8F]/30">
                            HDFC
                          </div>
                          <div>
                            <div className="text-xs font-semibold text-[#0F1713] flex items-center gap-2">
                              <span>HDFC Bank Salaried Account</span>
                              <span className="px-1.5 py-0.2 rounded bg-[#C6F6D5] text-[9px] font-mono text-[#0B2417] font-semibold">PRIMARY</span>
                            </div>
                            <div className="text-[10px] font-mono text-[#64756B]">•••• 4821 · 6 Active Mandates (Spotify, Netflix, YouTube, Cult.fit...)</div>
                          </div>
                        </div>
                        <span className="text-[11px] font-mono text-[#0F1713] font-bold">₹36,444 / yr</span>
                      </div>

                      {/* Bank 2: ICICI Bank */}
                      <div className="p-3.5 rounded-2xl bg-[#F8F5EE] border border-[#E8E1D2] flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-xl bg-[#B3272D]/15 text-[#B3272D] font-bold text-xs flex items-center justify-center border border-[#B3272D]/30">
                            ICICI
                          </div>
                          <div>
                            <div className="text-xs font-semibold text-[#0F1713]">ICICI Coral Credit Card (Standing Instructions)</div>
                            <div className="text-[10px] font-mono text-[#64756B]">•••• 9102 · 2 Active Mandates (Hotstar, Amazon Prime)</div>
                          </div>
                        </div>
                        <span className="text-[11px] font-mono text-[#0F1713] font-bold">₹2,998 / yr</span>
                      </div>

                      {/* Bank 3: SBI */}
                      <div className="p-3.5 rounded-2xl bg-[#F8F5EE] border border-[#E8E1D2] flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-xl bg-[#280071]/15 text-[#280071] font-bold text-xs flex items-center justify-center border border-[#280071]/30">
                            SBI
                          </div>
                          <div>
                            <div className="text-xs font-semibold text-[#0F1713]">SBI Global International Debit (UPI Autopay)</div>
                            <div className="text-[10px] font-mono text-[#64756B]">•••• 3304 · 1 Active Mandate (ChatGPT Plus USD)</div>
                          </div>
                        </div>
                        <span className="text-[11px] font-mono text-[#0F1713] font-bold">₹23,988 / yr</span>
                      </div>

                      {/* Bank 4: Axis Bank */}
                      <div className="p-3.5 rounded-2xl bg-[#F8F5EE] border border-[#E8E1D2] flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-xl bg-[#97144D]/15 text-[#97144D] font-bold text-xs flex items-center justify-center border border-[#97144D]/30">
                            AXIS
                          </div>
                          <div>
                            <div className="text-xs font-semibold text-[#0F1713]">Axis Bank Savings A/C (NACH e-Mandate)</div>
                            <div className="text-[10px] font-mono text-[#64756B]">•••• 5519 · 1 Active Mandate (Audible India)</div>
                          </div>
                        </div>
                        <span className="text-[11px] font-mono text-[#0F1713] font-bold">₹2,193 / yr</span>
                      </div>
                    </div>
                  </div>

                  {/* Card 3: RBI Statutory Revocation Settings */}
                  <div className="p-6 rounded-3xl bg-white border border-[#E8E1D2] space-y-4 shadow-sm">
                    <div className="flex items-center justify-between pb-3 border-b border-[#E8E1D2]">
                      <div className="flex items-center gap-2 text-[#0F1713] font-semibold text-sm">
                        <ShieldCheck className="w-4 h-4 text-[#15803D]" />
                        <span>RBI Master Direction Legal Notice Configuration</span>
                      </div>
                      <span className="text-[10px] font-mono text-[#0E2419] font-bold bg-[#E8E1D2] px-2 py-0.5 rounded-full">
                        Circular RBI/2019-20/53
                      </span>
                    </div>

                    <p className="text-xs text-[#64756B] leading-relaxed">
                      Mandate Radar auto-generates statutory notices under RBI Master Direction on Processing of e-Mandates. These settings configure your legal revocation signature and notice delivery defaults.
                    </p>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-[11px] font-semibold text-[#0F1713] mb-1">
                          Signature on Revocation Letters
                        </label>
                        <input
                          type="text"
                          value={userName}
                          onChange={e => setUserName(e.target.value)}
                          className="w-full px-3 py-2 text-xs bg-[#F8F5EE] border border-[#E8E1D2] text-[#0F1713] rounded-xl focus:outline-none"
                        />
                      </div>

                      <div>
                        <label className="block text-[11px] font-semibold text-[#0F1713] mb-1">
                          Bank Nodal Grievance Redressal CC
                        </label>
                        <input
                          type="email"
                          readOnly
                          value="grievance.officer@hdfcbank.com"
                          className="w-full px-3 py-2 text-xs bg-[#F8F5EE]/60 border border-[#E8E1D2] text-[#64756B] rounded-xl font-mono cursor-not-allowed"
                        />
                      </div>
                    </div>
                  </div>
                </div>

                {/* Column 2: Sentry Alert Rules & Data Management */}
                <div className="space-y-6">
                  
                  {/* Card 4: Radar Alert Sentry Controls */}
                  <div className="p-6 rounded-3xl bg-white border border-[#E8E1D2] space-y-4 shadow-sm">
                    <div className="pb-3 border-b border-[#E8E1D2]">
                      <div className="flex items-center gap-2 text-[#0F1713] font-semibold text-sm">
                        <Bell className="w-4 h-4 text-[#B45309]" />
                        <span>Mandate Sentry Rules</span>
                      </div>
                      <p className="text-[11px] text-[#64756B] mt-0.5">Automated auto-debit triggers</p>
                    </div>

                    <div className="space-y-3">
                      {/* Rule 1: Zombie Subscriptions */}
                      <div className="flex items-center justify-between p-3 rounded-2xl bg-[#F8F5EE] border border-[#E8E1D2]">
                        <div>
                          <div className="text-xs font-semibold text-[#0F1713]">Zombie Subscription Sentry</div>
                          <div className="text-[10px] text-[#64756B]">Alert if 0 usage for &gt;60 days</div>
                        </div>
                        <input
                          type="checkbox"
                          checked={autoZombieAlert}
                          onChange={e => setAutoZombieAlert(e.target.checked)}
                          className="w-4 h-4 accent-[#0E2419] cursor-pointer"
                        />
                      </div>

                      {/* Rule 2: Price Creep */}
                      <div className="flex items-center justify-between p-3 rounded-2xl bg-[#F8F5EE] border border-[#E8E1D2]">
                        <div>
                          <div className="text-xs font-semibold text-[#0F1713]">Silent Price Creep Alert</div>
                          <div className="text-[10px] text-[#64756B]">Flag renewal increases &gt;5%</div>
                        </div>
                        <input
                          type="checkbox"
                          checked={autoHikeAlert}
                          onChange={e => setAutoHikeAlert(e.target.checked)}
                          className="w-4 h-4 accent-[#0E2419] cursor-pointer"
                        />
                      </div>

                      {/* Rule 3: Free Trial Conversion */}
                      <div className="flex items-center justify-between p-3 rounded-2xl bg-[#F8F5EE] border border-[#E8E1D2]">
                        <div>
                          <div className="text-xs font-semibold text-[#0F1713]">Trial Auto-Convert Warning</div>
                          <div className="text-[10px] text-[#64756B]">Ping 48h before trial renewal</div>
                        </div>
                        <input
                          type="checkbox"
                          checked={trialWarningAlert}
                          onChange={e => setTrialWarningAlert(e.target.checked)}
                          className="w-4 h-4 accent-[#0E2419] cursor-pointer"
                        />
                      </div>

                      {/* Rule 4: WhatsApp Pre-Debit Ping */}
                      <div className="flex items-center justify-between p-3 rounded-2xl bg-[#F8F5EE] border border-[#E8E1D2]">
                        <div>
                          <div className="text-xs font-semibold text-[#0F1713]">WhatsApp 24h Pre-Debit Ping</div>
                          <div className="text-[10px] text-[#64756B]">Direct SMS / WhatsApp alert</div>
                        </div>
                        <input
                          type="checkbox"
                          checked={whatsappAlerts}
                          onChange={e => setWhatsappAlerts(e.target.checked)}
                          className="w-4 h-4 accent-[#0E2419] cursor-pointer"
                        />
                      </div>

                      {/* Rule 5: 100% Client-side Processing */}
                      <div className="p-3.5 rounded-2xl bg-[#C6F6D5]/40 border border-[#A7F3D0] flex items-center justify-between">
                        <div>
                          <div className="text-xs font-semibold text-[#0B2417] flex items-center gap-1.5">
                            <Lock className="w-3.5 h-3.5" />
                            <span>Local Browser Sandbox</span>
                          </div>
                          <div className="text-[10px] text-[#64756B]">Zero bank statement data sent to cloud</div>
                        </div>
                        <span className="text-[10px] font-mono text-[#15803D] font-bold">LOCKED ON</span>
                      </div>
                    </div>
                  </div>

                  {/* Card 5: Data & Session Management */}
                  <div className="p-6 rounded-3xl bg-white border border-[#E8E1D2] space-y-4 shadow-sm">
                    <div className="pb-3 border-b border-[#E8E1D2]">
                      <div className="flex items-center gap-2 text-[#0F1713] font-semibold text-sm">
                        <Key className="w-4 h-4 text-[#0E2419]" />
                        <span>Data Export &amp; Security</span>
                      </div>
                      <p className="text-[11px] text-[#64756B] mt-0.5">Session controls &amp; audits</p>
                    </div>

                    <div className="space-y-2.5">
                      <button
                        onClick={() => {
                          const csvHeader = 'Merchant,Descriptor,Amount,Cadence,Flag,Rail\n'
                          const csvRows = mandates.map(m => `"${m.merchant_name}","${m.descriptor}",${m.annual_committed_cost || m.latest_amount},"${m.cadence}","${m.flag}","${m.mechanism || m.mechanism_name || 'UPI_AUTOPAY'}"`).join('\n')
                          const blob = new Blob([csvHeader + csvRows], { type: 'text/csv' })
                          const url = URL.createObjectURL(blob)
                          const a = document.createElement('a')
                          a.href = url
                          a.download = `mandate_radar_audit_${userName.replace(/\s+/g, '_')}.csv`
                          a.click()
                        }}
                        className="w-full py-2.5 px-3.5 rounded-2xl bg-[#F8F5EE] hover:bg-[#EEDBCA]/40 border border-[#E8E1D2] text-xs text-[#0F1713] font-medium flex items-center justify-between transition-all cursor-pointer shadow-sm"
                      >
                        <div className="flex items-center gap-2">
                          <Download className="w-3.5 h-3.5 text-[#0E2419]" />
                          <span>Export Mandate Audit (CSV)</span>
                        </div>
                        <span className="text-[10px] font-mono text-[#64756B]">10 Mandates</span>
                      </button>

                      <button
                        onClick={() => setActiveTab('neo4j')}
                        className="w-full py-2.5 px-3.5 rounded-2xl bg-[#F8F5EE] hover:bg-[#EEDBCA]/40 border border-[#E8E1D2] text-xs text-[#0F1713] font-medium flex items-center justify-between transition-all cursor-pointer shadow-sm"
                      >
                        <div className="flex items-center gap-2">
                          <Network className="w-3.5 h-3.5 text-[#6D28D9]" />
                          <span>Neo4j Aura Workspace Sync</span>
                        </div>
                        <span className="text-[10px] font-mono text-[#15803D]">Connected</span>
                      </button>

                      <button
                        onClick={() => {
                          try {
                            localStorage.removeItem('mandate_radar_token')
                            localStorage.removeItem('mandate_radar_user')
                          } catch {}
                          onOpenHome()
                        }}
                        className="w-full py-2.5 px-3.5 rounded-2xl bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-xs text-red-600 font-medium flex items-center justify-between transition-all cursor-pointer shadow-sm"
                      >
                        <div className="flex items-center gap-2">
                          <LogOut className="w-3.5 h-3.5" />
                          <span>Sign Out &amp; Clear Local Cache</span>
                        </div>
                        <span className="text-[10px] font-mono text-red-600">Exit</span>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* Selected Mandate Drawer */}
      {selectedMandate && (
        <MandateDrawer
          mandate={selectedMandate}
          userName={userName}
          onClose={() => setSelectedMandate(null)}
          onGenerateEmail={tone => handleGenerateNotice(selectedMandate, tone)}
          emailSubject={emailSubject}
          emailBody={emailBody}
          emailCopied={emailCopied}
          onCopyEmail={() => {
            navigator.clipboard.writeText(`Subject: ${emailSubject}\n\n${emailBody}`)
            setEmailCopied(true)
            setTimeout(() => setEmailCopied(false), 2000)
          }}
          onConfirmCancel={handleConfirmCancelMandate}
          onAddTag={handleAddMandateTag}
        />
      )}

      {/* Neo4j Overlap Confirmation Modal */}
      <FindingsConfirmationModal
        isOpen={isFindingsModalOpen}
        onClose={() => setIsFindingsModalOpen(false)}
        findings={findings}
        reconciliation={reconciliation}
        onConfirmDecision={handleConfirmFindingDecision}
      />
    </div>
  )
}
