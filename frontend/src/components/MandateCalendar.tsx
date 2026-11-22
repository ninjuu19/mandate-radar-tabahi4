import React, { useState, useMemo } from 'react'
import {
  ChevronLeft,
  ChevronRight,
  Calendar as CalendarIcon,
  Clock,
  AlertTriangle,
  CheckCircle2,
  TrendingUp,
  CreditCard,
  ShieldAlert,
  ArrowRight,
  ExternalLink,
  Flame,
  Sparkles
} from 'lucide-react'
import type { Mandate } from '../types'
import { inr } from '../lib/format'

interface MandateCalendarProps {
  mandates: Mandate[]
  onSelectMandate?: (mandate: Mandate) => void
  onUploadStatement?: () => void
}

interface ScheduledDebit {
  mandate: Mandate
  date: Date
  dateStr: string // YYYY-MM-DD
  dayOfMonth: number
  amount: number
  cadence: string
  rail: string
  flag: string
  daysAway: number
}

export const MandateCalendar: React.FC<MandateCalendarProps> = ({
  mandates = [],
  onSelectMandate,
  onUploadStatement
}) => {
  const [currentDate, setCurrentDate] = useState(() => new Date())
  const [selectedDateStr, setSelectedDateStr] = useState<string | null>(null)
  const [filterRail, setFilterRail] = useState<string>('all')

  const year = currentDate.getFullYear()
  const month = currentDate.getMonth() // 0-indexed

  // Month navigation
  const prevMonth = () => {
    setCurrentDate(new Date(year, month - 1, 1))
    setSelectedDateStr(null)
  }
  const nextMonth = () => {
    setCurrentDate(new Date(year, month + 1, 1))
    setSelectedDateStr(null)
  }
  const goToToday = () => {
    setCurrentDate(new Date())
    setSelectedDateStr(null)
  }

  // Derive scheduled debits for this month based on mandate history and cadence
  const scheduledDebits = useMemo(() => {
    const list: ScheduledDebit[] = []
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    mandates.forEach(m => {
      // Determine recurring day of month
      let day = 15 // sensible fallback
      if (m.history && m.history.length > 0) {
        const lastTxDate = new Date(m.history[m.history.length - 1].date)
        if (!isNaN(lastTxDate.getDate())) {
          day = lastTxDate.getDate()
        }
      } else if (m.descriptor) {
        // Deterministic hash fallback
        const hash = m.descriptor.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0)
        day = (hash % 28) + 1
      }

      // Clamp day to valid days in current month
      const daysInMonth = new Date(year, month + 1, 0).getDate()
      const validDay = Math.min(day, daysInMonth)

      const debitDate = new Date(year, month, validDay)
      debitDate.setHours(0, 0, 0, 0)

      const diffTime = debitDate.getTime() - today.getTime()
      const daysAway = Math.ceil(diffTime / (1000 * 60 * 60 * 24))

      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(validDay).padStart(2, '0')}`

      list.push({
        mandate: m,
        date: debitDate,
        dateStr,
        dayOfMonth: validDay,
        amount: m.latest_amount || (m.annual_committed_cost ? Math.round(m.annual_committed_cost / 12) : 500),
        cadence: m.cadence || 'MONTHLY',
        rail: m.mechanism || 'UPI_AUTOPAY',
        flag: m.flag || 'HEALTHY',
        daysAway
      })
    })

    return list.sort((a, b) => a.dayOfMonth - b.dayOfMonth)
  }, [mandates, year, month])

  // Filter by rail if applied
  const filteredDebits = useMemo(() => {
    if (filterRail === 'all') return scheduledDebits
    return scheduledDebits.filter(d => d.rail.toLowerCase().includes(filterRail.toLowerCase()))
  }, [scheduledDebits, filterRail])

  // Map debits by date string for quick calendar cell lookup
  const debitsByDate = useMemo(() => {
    const map: Record<string, ScheduledDebit[]> = {}
    filteredDebits.forEach(d => {
      if (!map[d.dateStr]) map[d.dateStr] = []
      map[d.dateStr].push(d)
    })
    return map
  }, [filteredDebits])

  // Top summary metrics
  const totalMonthSpend = filteredDebits.reduce((acc, d) => acc + d.amount, 0)
  const upcomingDebits = filteredDebits.filter(d => d.daysAway >= 0)
  const nextDebit = upcomingDebits.length > 0 ? upcomingDebits[0] : null
  const flaggedCount = filteredDebits.filter(d => d.flag !== 'HEALTHY').length

  // Calendar Grid Calculation
  const firstDayOfMonth = new Date(year, month, 1).getDay() // 0 for Sunday
  const daysInCurrentMonth = new Date(year, month + 1, 0).getDate()
  const daysInPrevMonth = new Date(year, month, 0).getDate()

  const calendarDays = useMemo(() => {
    const days: Array<{
      dayNumber: number
      dateStr: string
      isCurrentMonth: boolean
      isToday: boolean
      debits: ScheduledDebit[]
    }> = []

    const todayStr = new Date().toISOString().slice(0, 10)

    // Previous month padding
    for (let i = firstDayOfMonth - 1; i >= 0; i--) {
      const d = daysInPrevMonth - i
      const prevMonthIdx = month === 0 ? 12 : month
      const prevYear = month === 0 ? year - 1 : year
      const dateStr = `${prevYear}-${String(prevMonthIdx).padStart(2, '0')}-${String(d).padStart(2, '0')}`
      days.push({
        dayNumber: d,
        dateStr,
        isCurrentMonth: false,
        isToday: dateStr === todayStr,
        debits: []
      })
    }

    // Current month days
    for (let d = 1; d <= daysInCurrentMonth; d++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
      days.push({
        dayNumber: d,
        dateStr,
        isCurrentMonth: true,
        isToday: dateStr === todayStr,
        debits: debitsByDate[dateStr] || []
      })
    }

    // Next month padding to complete 42 cells (6 rows) or 35 cells
    const remaining = (7 - (days.length % 7)) % 7
    for (let d = 1; d <= remaining; d++) {
      const nextMonthIdx = month === 11 ? 1 : month + 2
      const nextYear = month === 11 ? year + 1 : year
      const dateStr = `${nextYear}-${String(nextMonthIdx).padStart(2, '0')}-${String(d).padStart(2, '0')}`
      days.push({
        dayNumber: d,
        dateStr,
        isCurrentMonth: false,
        isToday: dateStr === todayStr,
        debits: []
      })
    }

    return days
  }, [year, month, firstDayOfMonth, daysInCurrentMonth, daysInPrevMonth, debitsByDate])

  const selectedDebits = selectedDateStr ? debitsByDate[selectedDateStr] || [] : []

  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ]

  return (
    <div className="space-y-6 text-left">
      {/* Header bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-[#E8E1D2]">
        <div>
          <h2 className="text-xl font-serif font-bold text-[#0F1713] flex items-center gap-2">
            <CalendarIcon className="w-5 h-5 text-[#0E2419]" />
            <span>Auto-Debit Calendar</span>
            <span className="text-xs font-mono px-2.5 py-0.5 rounded-full bg-[#EEDBCA] text-[#0E2419] font-bold">
              30-Day Predictor
            </span>
          </h2>
          <p className="text-xs text-[#64756B] mt-0.5">
            Predictive timeline of upcoming recurring debits across UPI AutoPay, Credit Card SI, and Bank NACH.
          </p>
        </div>

        {/* Month Navigation & Controls */}
        <div className="flex items-center gap-2">
          <button
            onClick={goToToday}
            className="px-3 py-1.5 text-xs font-medium rounded-xl bg-white border border-[#E8E1D2] text-[#0F1713] hover:bg-[#F8F5EE] transition-colors cursor-pointer"
          >
            Today
          </button>
          <div className="flex items-center bg-white border border-[#E8E1D2] rounded-xl overflow-hidden shadow-sm">
            <button
              onClick={prevMonth}
              className="p-1.5 hover:bg-[#F8F5EE] text-[#0F1713] transition-colors cursor-pointer"
              title="Previous Month"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="px-3 py-1 text-xs font-bold font-serif text-[#0F1713] min-w-[130px] text-center">
              {monthNames[month]} {year}
            </span>
            <button
              onClick={nextMonth}
              className="p-1.5 hover:bg-[#F8F5EE] text-[#0F1713] transition-colors cursor-pointer"
              title="Next Month"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Top 4 KPI Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Expected Monthly Outflow */}
        <div className="p-4 rounded-2xl bg-white border border-[#E8E1D2] shadow-sm flex flex-col justify-between">
          <div className="text-[11px] font-mono uppercase tracking-wider text-[#64756B] flex items-center justify-between">
            <span>Monthly Expected Debit</span>
            <CreditCard className="w-4 h-4 text-[#0E2419]" />
          </div>
          <div className="font-mono text-2xl font-bold text-[#0F1713] mt-2">
            {inr(totalMonthSpend)}
          </div>
          <div className="text-[11px] text-[#64756B] mt-1">
            Across {filteredDebits.length} recurring mandates
          </div>
        </div>

        {/* Card 2: Next Nearest Debit */}
        <div className="p-4 rounded-2xl bg-white border border-[#E8E1D2] shadow-sm flex flex-col justify-between">
          <div className="text-[11px] font-mono uppercase tracking-wider text-[#64756B] flex items-center justify-between">
            <span>Next Auto-Debit</span>
            <Clock className="w-4 h-4 text-[#2DE2B5]" />
          </div>
          {nextDebit ? (
            <div>
              <div className="text-sm font-bold text-[#0F1713] truncate mt-1">
                {nextDebit.mandate.merchant_name}
              </div>
              <div className="font-mono text-lg font-extrabold text-[#0E2419]">
                {inr(nextDebit.amount)}
                <span className="text-xs font-normal text-[#64756B] ml-1.5">
                  ({nextDebit.daysAway === 0 ? 'Today' : nextDebit.daysAway === 1 ? 'Tomorrow' : `in ${nextDebit.daysAway} days`})
                </span>
              </div>
            </div>
          ) : (
            <div className="text-xs text-[#64756B] mt-2">No more debits this month</div>
          )}
          <div className="text-[11px] font-mono text-[#64756B] mt-1">
            {nextDebit?.dateStr || 'Up to date'}
          </div>
        </div>

        {/* Card 3: Flagged at Risk */}
        <div className="p-4 rounded-2xl bg-white border border-[#E8E1D2] shadow-sm flex flex-col justify-between">
          <div className="text-[11px] font-mono uppercase tracking-wider text-[#64756B] flex items-center justify-between">
            <span>Rogue / Price Creep Debits</span>
            <AlertTriangle className="w-4 h-4 text-[#DC2626]" />
          </div>
          <div className="font-mono text-2xl font-bold text-[#DC2626] mt-2">
            {flaggedCount}
          </div>
          <div className="text-[11px] text-[#64756B] mt-1">
            {flaggedCount > 0 ? 'Unwanted or hiked renewals due' : 'All scheduled debits healthy'}
          </div>
        </div>

        {/* Card 4: RBI 24H Pre-Debit Sentry */}
        <div className="p-4 rounded-2xl bg-[#0E2419] text-[#FAF8F5] shadow-sm flex flex-col justify-between">
          <div className="text-[11px] font-mono uppercase tracking-wider text-[#2DE2B5] flex items-center justify-between">
            <span>RBI Pre-Debit Sentry</span>
            <ShieldAlert className="w-4 h-4 text-[#2DE2B5]" />
          </div>
          <div className="text-xs font-semibold text-white mt-2 leading-relaxed">
            24h Mandatory Notice Active
          </div>
          <div className="text-[10px] text-[#9BAEA2] mt-1">
            Banks must alert 24h before debit per RBI Master Direction 2019/53.
          </div>
        </div>
      </div>

      {/* Main Calendar Section */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Left: Monthly Calendar Grid (8 cols) */}
        <div className="lg:col-span-8 p-5 sm:p-6 rounded-3xl bg-white border border-[#E8E1D2] shadow-sm space-y-4">
          
          {/* Day of Week Headers */}
          <div className="grid grid-cols-7 gap-1 text-center font-mono text-[11px] font-bold text-[#64756B] uppercase pb-2 border-b border-[#E8E1D2]">
            <span>Sun</span>
            <span>Mon</span>
            <span>Tue</span>
            <span>Wed</span>
            <span>Thu</span>
            <span>Fri</span>
            <span>Sat</span>
          </div>

          {/* Day Grid */}
          <div className="grid grid-cols-7 gap-1.5 sm:gap-2">
            {calendarDays.map((cell, idx) => {
              const hasDebits = cell.debits.length > 0
              const isSelected = selectedDateStr === cell.dateStr
              const hasFlagged = cell.debits.some(d => d.flag !== 'HEALTHY')

              return (
                <div
                  key={idx}
                  onClick={() => {
                    if (cell.isCurrentMonth && hasDebits) {
                      setSelectedDateStr(cell.dateStr)
                    }
                  }}
                  className={`min-h-[75px] sm:min-h-[85px] p-1.5 sm:p-2 rounded-2xl border transition-all flex flex-col justify-between ${
                    !cell.isCurrentMonth
                      ? 'bg-[#F8F5EE]/40 border-transparent text-[#BAC8BF] cursor-default'
                      : isSelected
                      ? 'bg-[#EEDBCA]/50 border-[#0E2419] shadow-md ring-2 ring-[#0E2419]'
                      : cell.isToday
                      ? 'bg-[#2DE2B5]/10 border-[#2DE2B5] text-[#0E2419]'
                      : hasDebits
                      ? 'bg-[#F8F5EE] border-[#E8E1D2] hover:border-[#0E2419] hover:shadow-sm cursor-pointer'
                      : 'bg-white border-[#E8E1D2]/60 hover:bg-[#F8F5EE]/50 cursor-pointer'
                  }`}
                >
                  {/* Top: Day number + Today pill */}
                  <div className="flex items-center justify-between">
                    <span
                      className={`text-xs font-mono font-bold ${
                        cell.isToday
                          ? 'w-5 h-5 rounded-full bg-[#0E2419] text-[#2DE2B5] flex items-center justify-center text-[11px]'
                          : cell.isCurrentMonth
                          ? 'text-[#0F1713]'
                          : 'text-[#BAC8BF]'
                      }`}
                    >
                      {cell.dayNumber}
                    </span>

                    {hasDebits && (
                      <span
                        className={`w-2 h-2 rounded-full ${
                          hasFlagged ? 'bg-red-500 animate-pulse' : 'bg-[#2DE2B5]'
                        }`}
                        title={`${cell.debits.length} debit(s) scheduled`}
                      />
                    )}
                  </div>

                  {/* Middle / Bottom: Debits summary inside cell */}
                  {hasDebits && cell.isCurrentMonth && (
                    <div className="mt-1 space-y-1">
                      {cell.debits.slice(0, 2).map((d, dIdx) => (
                        <div
                          key={dIdx}
                          className={`text-[9px] sm:text-[10px] px-1 py-0.5 rounded truncate font-medium flex items-center justify-between ${
                            d.flag !== 'HEALTHY'
                              ? 'bg-red-100 text-red-800 border border-red-200'
                              : 'bg-white/80 border border-[#E8E1D2] text-[#0F1713]'
                          }`}
                        >
                          <span className="truncate">{d.mandate.merchant_name}</span>
                          <span className="font-mono font-bold ml-1">{inr(d.amount)}</span>
                        </div>
                      ))}
                      {cell.debits.length > 2 && (
                        <div className="text-[9px] font-mono text-[#64756B] text-center">
                          +{cell.debits.length - 2} more
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {/* Calendar Bottom Legend */}
          <div className="pt-3 border-t border-[#E8E1D2] flex flex-wrap items-center justify-between gap-3 text-xs text-[#64756B]">
            <div className="flex items-center gap-4">
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-[#2DE2B5]" />
                <span>Normal Auto-Debit</span>
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-red-500" />
                <span>Price Hike / Zombie Warning</span>
              </span>
            </div>
            <span className="font-mono text-[11px]">
              Click on any highlighted day to inspect debits
            </span>
          </div>
        </div>

        {/* Right: Date Inspector / Detailed Schedule Sidebar (4 cols) */}
        <div className="lg:col-span-4 space-y-4">
          <div className="p-5 sm:p-6 rounded-3xl bg-white border border-[#E8E1D2] shadow-sm space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-[#E8E1D2]">
              <div>
                <h3 className="text-sm font-bold text-[#0F1713]">
                  {selectedDateStr ? `Debits on ${selectedDateStr}` : 'Upcoming Debits List'}
                </h3>
                <p className="text-[11px] text-[#64756B]">
                  {selectedDateStr
                    ? `${selectedDebits.length} charge(s) scheduled on this day`
                    : 'Sorted by chronological order'}
                </p>
              </div>
              {selectedDateStr && (
                <button
                  onClick={() => setSelectedDateStr(null)}
                  className="text-[11px] text-[#0E2419] font-medium hover:underline cursor-pointer"
                >
                  View All
                </button>
              )}
            </div>

            {/* List of Debits */}
            <div className="space-y-2.5 max-h-[460px] overflow-y-auto pr-1">
              {(selectedDateStr ? selectedDebits : filteredDebits).length === 0 ? (
                <div className="py-8 text-center text-[#64756B] space-y-2">
                  <CalendarIcon className="w-8 h-8 text-[#BAC8BF] mx-auto" />
                  <p className="text-xs">No debits scheduled for this selection.</p>
                </div>
              ) : (
                (selectedDateStr ? selectedDebits : filteredDebits).map((d, idx) => (
                  <div
                    key={idx}
                    onClick={() => onSelectMandate?.(d.mandate)}
                    className="p-3.5 rounded-2xl bg-[#F8F5EE] border border-[#E8E1D2] hover:border-[#0E2419] transition-all cursor-pointer space-y-2 group"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="text-xs font-bold text-[#0F1713] group-hover:text-[#0E2419] flex items-center gap-1.5">
                          <span>{d.mandate.merchant_name}</span>
                          {d.flag !== 'HEALTHY' && (
                            <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
                          )}
                        </div>
                        <div className="text-[10px] font-mono text-[#64756B] truncate max-w-[180px]">
                          {d.mandate.descriptor}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="font-mono text-xs font-bold text-[#0F1713]">
                          {inr(d.amount)}
                        </div>
                        <div className="text-[10px] font-mono text-[#64756B]">
                          {d.cadence.toLowerCase()}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center justify-between pt-1 border-t border-[#E8E1D2]/60 text-[10px] font-mono">
                      <span className="px-1.5 py-0.5 rounded bg-white border border-[#E8E1D2] text-[#64756B]">
                        {d.rail}
                      </span>
                      <span className="font-semibold text-[#0E2419]">
                        {d.dateStr} ({d.daysAway === 0 ? 'Today' : d.daysAway > 0 ? `in ${d.daysAway}d` : `${Math.abs(d.daysAway)}d ago`})
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Empty State Helper when user has 0 mandates */}
            {mandates.length === 0 && (
              <div className="p-4 rounded-2xl bg-[#EEDBCA]/30 border border-[#EEDBCA] text-center space-y-2">
                <Sparkles className="w-5 h-5 text-[#0E2419] mx-auto" />
                <div className="text-xs font-bold text-[#0F1713]">No Mandates Found Yet</div>
                <p className="text-[11px] text-[#64756B]">
                  Upload a statement to automatically plot recurring debits on this calendar.
                </p>
                {onUploadStatement && (
                  <button
                    onClick={onUploadStatement}
                    className="mt-2 w-full py-2 px-3 rounded-xl bg-[#0E2419] text-[#2DE2B5] font-semibold text-xs cursor-pointer hover:bg-[#163826] transition-colors"
                  >
                    Upload Bank Statement
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
