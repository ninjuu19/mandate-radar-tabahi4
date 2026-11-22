import { useEffect, useRef, useState } from 'react'
import type { Mandate, Finding } from '../types'
import { inr, issueOf, ISSUE_LABEL, type IssueKey } from '../lib/format'
import {
  ChevronRight,
  Sparkles,
  TrendingUp,
  AlertTriangle,
  Flame,
  CheckCircle2,
  Check,
  Clock,
  Activity
} from 'lucide-react'

type Props = {
  mandates: Mandate[]
  total: number
  cancelled: Set<string>
  loading: boolean
  onToggle: (id: string) => void
  onCancelFlagged: () => void
  onClear: () => void
  onOpen: (m: Mandate) => void
  onUploadStatement?: () => void
  onLoadDemoData?: () => void
  findings?: Finding[]
  onReviewFindings?: () => void
}

type ExtendedFilter = 'all' | IssueKey | 'marked_cancelled' | 'still_charging' | 'suggested_cancel'

function useTween(target: number) {
  const [v, setV] = useState(target)
  const from = useRef(target)
  useEffect(() => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setV(target)
      from.current = target
      return
    }
    const a = from.current,
      t0 = performance.now()
    let raf = 0
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / 450)
      const val = a + (target - a) * (1 - Math.pow(1 - k, 3))
      setV(val)
      from.current = val
      if (k < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [target])
  return v
}

// Brand visual avatar helper
const getBrandVisual = (name: string) => {
  const n = name.toLowerCase()
  if (n.includes('youtube')) return { icon: '▶', bg: 'bg-red-500/15 text-red-400 border-red-500/30' }
  if (n.includes('spotify')) return { icon: '♫', bg: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' }
  if (n.includes('netflix')) return { icon: 'N', bg: 'bg-rose-500/15 text-rose-400 border-rose-500/30' }
  if (n.includes('amazon') || n.includes('prime')) return { icon: 'A', bg: 'bg-amber-500/15 text-amber-400 border-amber-500/30' }
  if (n.includes('hotstar') || n.includes('disney')) return { icon: 'D+', bg: 'bg-blue-500/15 text-blue-400 border-blue-500/30' }
  if (n.includes('cult')) return { icon: '⚡', bg: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30' }
  if (n.includes('chatgpt') || n.includes('openai')) return { icon: '✦', bg: 'bg-teal-500/15 text-teal-400 border-teal-500/30' }
  if (n.includes('canva')) return { icon: 'C', bg: 'bg-sky-500/15 text-sky-400 border-sky-500/30' }
  if (n.includes('truecaller')) return { icon: 'T', bg: 'bg-indigo-500/15 text-indigo-400 border-indigo-500/30' }
  return { icon: name.charAt(0).toUpperCase(), bg: 'bg-slate-500/15 text-slate-300 border-slate-500/30' }
}

export function RadarView({
  mandates,
  total,
  cancelled,
  loading,
  onToggle,
  onCancelFlagged,
  onClear,
  onOpen,
  onUploadStatement,
  onLoadDemoData,
  findings,
  onReviewFindings
}: Props) {
  const [filter, setFilter] = useState<ExtendedFilter>('all')

  const getAnnualCost = (m: Mandate) => {
    if (m.annual_committed_cost != null && m.annual_committed_cost > 0) {
      return m.annual_committed_cost
    }
    const amt = m.latest_amount || 0
    const cad = (m.cadence || 'MONTHLY').toUpperCase()
    const mult = cad === 'ANNUAL' || cad === 'YEARLY' ? 1 : cad === 'QUARTERLY' ? 4 : cad === 'WEEKLY' ? 52 : 12
    return amt * mult
  }

  // Total exposure: Compute dynamically from mandates if total prop is 0 or uninitialized
  const computedTotal = mandates.reduce((s, m) => {
    const annual = getAnnualCost(m)
    return s + (m.billing_type === 'usage_based' ? 0 : annual)
  }, 0)

  const effectiveTotal = (total && total > 0) ? total : (computedTotal > 0 ? computedTotal : mandates.reduce((s, m) => s + getAnnualCost(m), 0))

  // Honest savings math: Exclude usage-based from fixed contractual savings
  const saved = mandates
    .filter(m => cancelled.has(m.id))
    .reduce((s, m) => {
      const annual = getAnnualCost(m)
      return s + (m.billing_type === 'usage_based' ? 0 : annual)
    }, 0)

  const usageBasedSavedCount = mandates
    .filter(m => cancelled.has(m.id) && m.billing_type === 'usage_based').length

  const keep = Math.max(0, effectiveTotal - saved)
  const shown = useTween(keep)

  const counts: Record<string, number> = { all: mandates.length }
  mandates.forEach(m => {
    const k = issueOf(m)
    counts[k] = (counts[k] || 0) + 1
    if (m.status === 'marked_cancelled') counts['marked_cancelled'] = (counts['marked_cancelled'] || 0) + 1
    if (m.status === 'still_charging') counts['still_charging'] = (counts['still_charging'] || 0) + 1
    if (m.status === 'suggested_cancel') counts['suggested_cancel'] = (counts['suggested_cancel'] || 0) + 1
  })

  const rows = mandates.filter(m => {
    if (filter === 'all') return true
    if (filter === 'marked_cancelled') return m.status === 'marked_cancelled'
    if (filter === 'still_charging') return m.status === 'still_charging'
    if (filter === 'suggested_cancel') return m.status === 'suggested_cancel'
    return issueOf(m) === filter
  })

  const chips: Array<[ExtendedFilter, string]> = [
    ['all', 'All mandates'],
    ['price', 'Price creep'],
    ['trial', 'Trial trap'],
    ['zombie', 'Unused'],
    ['unk', 'Unrecognised'],
    ['marked_cancelled', 'Cancelled'],
    ['still_charging', 'Still charging'],
    ['suggested_cancel', 'Suggested to cancel']
  ]

  return (
    <div className="w-full space-y-6 text-left">
      {/* Top Hero Cards Grid */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        
        {/* Left Big Card: Total Committed (7 cols) - Botanical Forest Green Hero */}
        <div className="lg:col-span-7 p-6 sm:p-7 rounded-3xl bg-[#0E2419] bg-stipple-forest border border-[#EEDBCA]/25 shadow-xl flex flex-col justify-between text-[#F5EEDB]">
          <div>
            <div className="flex items-center gap-2 text-xs font-mono text-[#BAC8BF] uppercase tracking-wider">
              <span className="w-2 h-2 rounded-full bg-[#2DE2B5] animate-ping" />
              ANNUAL COMMITTED EXPOSURE
            </div>
            <p className="text-xs sm:text-sm text-[#BAC8BF] mt-1">
              Committed every year across {mandates.length - cancelled.size} active mandates
            </p>
            <div className="font-mono text-4xl sm:text-5xl font-extrabold text-[#F5EEDB] mt-3 tabular-nums tracking-tight">
              {loading ? '…' : inr(shown)}
              <span className="text-base sm:text-lg font-sans font-medium text-[#BAC8BF] ml-2">/ year</span>
            </div>
          </div>

          <div className="mt-6 pt-4 border-t border-[#EEDBCA]/20">
            {/* Split Progress Meter */}
            <div className="h-2.5 rounded-full bg-white/10 overflow-hidden flex mb-3" aria-hidden="true">
              <div
                className="bg-[#2DE2B5] transition-all duration-500 shadow-[0_0_8px_rgba(45,226,181,0.5)]"
                style={{ width: total ? `${(keep / total) * 100}%` : '100%' }}
              />
              {saved > 0 && (
                <div
                  className="bg-[#FF5C6C] transition-all duration-500 opacity-90"
                  style={{ width: `${(saved / total) * 100}%` }}
                />
              )}
            </div>

            {/* Legend */}
            <div className="flex items-center justify-between text-xs font-mono">
              <span className="text-[#BAC8BF]">
                Keeping: <strong className="text-[#F5EEDB] tabular-nums">{inr(keep)}</strong>
              </span>
              <span className="text-[#BAC8BF]">
                Cancelling: <strong className="text-[#FF5C6C] tabular-nums">{inr(saved)}</strong>
              </span>
            </div>
          </div>
        </div>

        {/* Right Action Card: Savings Target (5 cols) */}
        <div className="lg:col-span-5 p-6 sm:p-7 rounded-3xl bg-gradient-to-br from-[#143325] via-[#0E241B] to-[#0A1D13] border border-[#2DE2B5]/35 shadow-xl flex flex-col justify-between text-[#F5EEDB]">
          <div>
            <h2 className="text-lg sm:text-xl font-bold tracking-tight text-[#F5EEDB] flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-[#2DE2B5]" />
              Tick the ones you don't need
            </h2>
            <p className="text-xs sm:text-sm text-[#BAC8BF] mt-1.5 leading-relaxed">
              The total updates instantly as you select. Nothing is cancelled until you follow the direct route for each one.
            </p>
          </div>

          <div className="mt-6 pt-4 border-t border-white/10">
            <span className="text-xs font-mono text-[#BAC8BF] uppercase">You would save:</span>
            <div className="font-mono text-3xl sm:text-4xl font-extrabold text-[#2DE2B5] mt-1 tabular-nums">
              {inr(saved)}
            </div>

            <div className="flex items-center gap-2.5 mt-4">
              <button
                onClick={onCancelFlagged}
                className="btn-primary text-xs px-4 py-2 cursor-pointer font-bold shadow-md"
              >
                Tick all flagged
              </button>
              {cancelled.size > 0 && (
                <button
                  onClick={onClear}
                  className="btn-secondary text-xs px-3.5 py-2 cursor-pointer"
                >
                  Clear selections
                </button>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Neo4j Overlap Analysis Banner */}
      {findings && findings.length > 0 && (
        <div className="p-5 sm:p-6 rounded-3xl bg-gradient-to-r from-[#0E2419] to-[#16382B] border border-[#2DE2B5]/40 text-[#F5EEDB] shadow-lg flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3.5">
            <div className="w-10 h-10 rounded-2xl bg-[#2DE2B5]/15 border border-[#2DE2B5]/30 flex items-center justify-center text-[#2DE2B5] shrink-0 mt-0.5">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-mono uppercase tracking-wider text-[#2DE2B5] font-bold">
                  Neo4j Graph Identified {findings.length} Overlap Group{findings.length > 1 ? 's' : ''}
                </span>
                <span className="w-2 h-2 rounded-full bg-[#2DE2B5] animate-ping" />
              </div>
              <h3 className="text-base font-bold text-white mt-0.5">
                Redundant Subscriptions &amp; Bundles Detected
              </h3>
              <p className="text-xs text-[#BAC8BF] mt-0.5 max-w-xl">
                Some subscriptions already bundle services you pay for separately (e.g. YouTube Premium includes YouTube Music, or duplicate cloud tools). Choose which to keep to optimize your spend.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0 self-end sm:self-center">
            <button
              onClick={onReviewFindings}
              className="px-5 py-2.5 rounded-xl bg-[#2DE2B5] hover:bg-[#25C49C] text-[#061A13] text-xs font-bold transition-all shadow-md flex items-center gap-2 cursor-pointer"
            >
              <Sparkles className="w-4 h-4" />
              <span>Review Overlaps &amp; Choose Which to Keep</span>
            </button>
          </div>
        </div>
      )}

      {/* Filter Chips - Sand & Forest Theme */}
      <div className="flex flex-wrap items-center gap-2 pt-2" role="group" aria-label="Filter mandates">
        {chips.map(([k, label]) => {
          const isSelected = filter === k
          return (
            <button
              key={k}
              onClick={() => setFilter(k)}
              className={`px-3.5 py-1.5 rounded-full text-xs font-medium transition-all flex items-center gap-2 border cursor-pointer ${
                isSelected
                  ? 'bg-[#0E2419] text-[#EFE8DC] border-[#0E2419] font-bold shadow-md'
                  : 'bg-white text-[#64756B] border-[#E8E1D2] hover:border-[#0E2419] hover:text-[#0F1713] shadow-sm'
              }`}
            >
              <span>{label}</span>
              <span
                className={`font-mono text-[10px] px-1.5 py-0.2 rounded-full ${
                  isSelected ? 'bg-white/20 text-white' : 'bg-[#E8E1D2] text-[#0F1713]'
                }`}
              >
                {counts[k] || 0}
              </span>
            </button>
          )
        })}
      </div>

      {/* Mandates List Table - Sand Canvas Clean Card */}
      <div className="bg-white border border-[#E8E1D2] rounded-3xl overflow-hidden shadow-sm divide-y divide-[#E8E1D2]">
        {rows.map(m => {
          const k = issueOf(m)
          const isCut = cancelled.has(m.id)
          const brand = getBrandVisual(m.merchant_name)

          return (
            <div
              key={m.id}
              onClick={() => onOpen(m)}
              className={`p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 cursor-pointer transition-colors ${
                isCut ? 'bg-[#F2EDE2]/70 opacity-60' : 'hover:bg-[#F9F7F2]'
              }`}
            >
              {/* Left: Checkbox + Brand Avatar + Name */}
              <div className="flex items-center gap-3.5 flex-1 min-w-0">
                <input
                  type="checkbox"
                  checked={isCut}
                  aria-label={`Cancel ${m.merchant_name}`}
                  onClick={e => e.stopPropagation()}
                  onChange={() => onToggle(m.id)}
                  className="w-5 h-5 rounded border-[#E8E1D2] text-[#0E2419] focus:ring-[#2DE2B5]/30 cursor-pointer accent-[#0E2419]"
                />

                <div
                  className={`w-9 h-9 rounded-xl border flex items-center justify-center font-bold text-xs shrink-0 ${brand.bg}`}
                >
                  {brand.icon}
                </div>

                <div className="min-w-0 flex-1">
                  <div
                    className={`text-sm font-semibold truncate ${
                      isCut ? 'line-through text-[#64756B]' : 'text-[#0F1713]'
                    }`}
                  >
                    {m.merchant_name}
                  </div>
                  <div className="font-mono text-[11px] text-[#64756B] truncate">
                    {m.descriptor}
                  </div>
                </div>
              </div>

              {/* Middle: Rail + Billing Type + Status / Issue Tag */}
              <div className="flex flex-wrap items-center gap-2 shrink-0 sm:justify-center">
                {m.account_label && (
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-[#F2EDE2] text-[#64756B] border border-[#E8E1D2]">
                    {m.account_label}
                  </span>
                )}

                <span className="badge-rail bg-[#F2EDE2] text-[#0F1713] border border-[#E8E1D2]">
                  {m.mechanism}
                </span>

                {m.billing_type === 'usage_based' && (
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200 font-medium">
                    usage-based
                  </span>
                )}

                {/* Status Badges */}
                {m.status === 'still_charging' && (
                  <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-red-100 text-red-700 border border-red-300 flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3 text-red-600" />
                    <span>Still charging alert</span>
                  </span>
                )}

                {m.status === 'verified_cancelled' && (
                  <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-300 flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                    <span>Verified cancelled</span>
                  </span>
                )}

                {m.status === 'marked_cancelled' && (
                  <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-800 border border-amber-300 flex items-center gap-1">
                    <Clock className="w-3 h-3 text-amber-600" />
                    <span>Cancelled</span>
                  </span>
                )}

                {m.status === 'suggested_cancel' && (
                  <div className="flex items-center gap-2">
                    <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-purple-100 text-purple-800 border border-purple-300 flex items-center gap-1">
                      <Sparkles className="w-3 h-3 text-purple-600" />
                      <span>Suggested to cancel</span>
                    </span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        onOpen(m)
                      }}
                      className="px-2.5 py-0.5 rounded-full bg-[#DC2626] hover:bg-[#B91C1C] text-white text-[10px] font-bold transition-all shadow-sm flex items-center gap-1 cursor-pointer shrink-0"
                    >
                      <AlertTriangle className="w-3 h-3" />
                      <span>Cancel this mandate</span>
                    </button>
                  </div>
                )}

                {m.status === 'keep_confirmed' && (
                  <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-teal-100 text-teal-800 border border-teal-300 flex items-center gap-1">
                    <Check className="w-3 h-3 text-teal-600" />
                    <span>Keep confirmed</span>
                  </span>
                )}

                {/* Heuristic Issue Tag */}
                {(!m.status || m.status === 'active' || m.status === 'flagged') && (
                  <span
                    className={`px-2.5 py-0.5 rounded-full text-xs font-semibold flex items-center gap-1 ${
                      k === 'price'
                        ? 'chip-hike'
                        : k === 'trial'
                        ? 'chip-trial'
                        : k === 'zombie'
                        ? 'chip-zombie'
                        : 'chip-safe'
                    }`}
                  >
                    {k === 'price' && <TrendingUp className="w-3 h-3" />}
                    {k === 'trial' && <AlertTriangle className="w-3 h-3" />}
                    {k === 'zombie' && <Flame className="w-3 h-3" />}
                    {k === 'ok' && <Check className="w-3 h-3" />}
                    <span>{ISSUE_LABEL[k]}</span>
                  </span>
                )}
              </div>

              {/* Right: Amount & Chevron */}
              <div className="flex items-center gap-3 shrink-0 justify-between sm:justify-end">
                <div className="text-right">
                  <div className="font-mono text-base font-bold text-[#0F1713] tabular-nums">
                    {inr(m.annual_committed_cost)}
                  </div>
                  <div className="text-[11px] text-[#64756B] font-mono">
                    {inr(m.latest_amount)} · {m.cadence.toLowerCase()}
                  </div>
                </div>

                <ChevronRight className="w-4 h-4 text-[#64756B] shrink-0" />
              </div>
            </div>
          )
        })}

        {!loading && rows.length === 0 && (
          <div className="py-12 px-6 rounded-3xl bg-white border border-[#E8E1D2] text-center max-w-xl mx-auto my-6 space-y-4 shadow-sm">
            <div className="w-16 h-16 rounded-2xl bg-[#EEDBCA]/40 text-[#0E2419] border border-[#EEDBCA] mx-auto flex items-center justify-center">
              <Sparkles className="w-8 h-8 text-[#0E2419]" />
            </div>
            <div>
              <h3 className="text-base font-bold text-[#0F1713]">
                {mandates.length === 0 ? 'No Mandates in this Account Yet' : 'No mandates match this filter'}
              </h3>
              <p className="text-xs text-[#64756B] max-w-md mx-auto mt-1 leading-relaxed">
                {mandates.length === 0
                  ? 'Upload your bank statement (CSV or PDF) to discover recurring auto-debits, or load our pre-configured demo portfolio to test the radar.'
                  : 'Select another filter above or reset to view all.'}
              </p>
            </div>
            {mandates.length === 0 && (
              <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
                {onUploadStatement && (
                  <button
                    onClick={onUploadStatement}
                    className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-[#0E2419] text-[#2DE2B5] font-semibold text-xs flex items-center justify-center gap-2 hover:bg-[#163826] cursor-pointer shadow-sm transition-colors"
                  >
                    <span>Upload Bank Statement</span>
                  </button>
                )}
                {onLoadDemoData && (
                  <button
                    onClick={onLoadDemoData}
                    className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-[#EEDBCA] text-[#0E2419] font-bold text-xs flex items-center justify-center gap-2 hover:bg-[#E4D1BC] cursor-pointer shadow-sm transition-colors"
                  >
                    <Sparkles className="w-3.5 h-3.5 text-[#0E2419]" />
                    <span>Load Demo Portfolio (₹65,623)</span>
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
