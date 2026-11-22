import React, { useState, useEffect } from 'react'
import {
  Mail,
  Smartphone,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  ExternalLink,
  ShieldCheck,
  Key,
  Copy,
  Check,
  Send,
  Zap,
  Lock,
  ArrowRight
} from 'lucide-react'

interface IntegrationStatus {
  status: string
  channels: {
    gmail: {
      connected: boolean
      email?: string | null
      scope?: string
      last_sync?: string | null
      sync_status?: string
    }
    android_sms: {
      paired: boolean
      device_name?: string | null
      device_id?: string | null
      last_sync?: string | null
      dlt_filtering: boolean
      notification_listener_ready: boolean
    }
  }
  metrics: {
    total_emails_scanned: number
    total_sms_scanned: number
    total_transactions_ingested: number
    total_duplicates_filtered: number
    pre_debit_alerts: number
  }
}

interface ConnectionsViewProps {
  onDataIngested?: () => void
}

export function ConnectionsView({ onDataIngested }: ConnectionsViewProps) {
  const [status, setStatus] = useState<IntegrationStatus | null>(null)
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState<{ text: string; type: 'success' | 'error' | 'info' } | null>(null)

  // Pairing PIN state
  const [pairingPin, setPairingPin] = useState<string | null>(null)
  const [pinCopied, setPinCopied] = useState(false)

  // Direct SMS simulator state
  const [smsSender, setSmsSender] = useState('AX-HDFCBK')
  const [smsBody, setSmsBody] = useState(
    'Dear Customer, Your A/c **4821 is debited for Rs 649.00 on 21-Nov-26 at NETFLIX ENTERTAINMENT. Ref 429104829102. Avl Bal Rs 52,140.00'
  )

  // Custom email state for Gmail connection
  const [customEmail, setCustomEmail] = useState('')
  const [isEditingEmail, setIsEditingEmail] = useState(false)
  const [newEmailInput, setNewEmailInput] = useState('')

  const fetchStatus = async () => {
    try {
      const res = await fetch('/api/v1/integrations/status')
      if (res.ok) {
        const data = await res.json()
        setStatus(data)
      }
    } catch (e) {
      console.error('Failed to load integration status:', e)
    }
  }

  useEffect(() => {
    fetchStatus()
  }, [])

  // Gmail Actions
  const handleConnectGmail = async () => {
    setLoading(true)
    try {
      const emailParam = customEmail.trim() ? `&email=${encodeURIComponent(customEmail.trim())}` : ''
      const res = await fetch(`/api/v1/integrations/gmail/callback?code=mock_code_user_connect${emailParam}`)
      if (res.ok) {
        const data = await res.json()
        setMsg({ text: data.message || `Gmail successfully connected (${customEmail || 'user@gmail.com'})!`, type: 'success' })
        await fetchStatus()
        if (onDataIngested) onDataIngested()
      } else {
        setMsg({ text: 'OAuth connection failed.', type: 'error' })
      }
    } catch (e: any) {
      setMsg({ text: `Connection error: ${e.message}`, type: 'error' })
    } finally {
      setLoading(false)
    }
  }

  const handleUpdateEmail = async () => {
    if (!newEmailInput.trim()) return
    setLoading(true)
    try {
      const res = await fetch('/api/v1/integrations/gmail/set-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: newEmailInput.trim() })
      })
      if (res.ok) {
        const data = await res.json()
        setMsg({ text: data.message || `Updated Gmail to ${newEmailInput}`, type: 'success' })
        setIsEditingEmail(false)
        await fetchStatus()
      } else {
        const err = await res.json()
        setMsg({ text: err.detail || 'Failed to update email', type: 'error' })
      }
    } catch (e: any) {
      setMsg({ text: e.message, type: 'error' })
    } finally {
      setLoading(false)
    }
  }

  const handleSyncGmail = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/v1/integrations/gmail/sync-now', { method: 'POST' })
      if (res.ok) {
        const data = await res.json()
        setMsg({
          text: `Gmail sync complete: ${data.ingested_transactions} transactions ingested (${data.duplicates_filtered} duplicates filtered).`,
          type: 'success'
        })
        await fetchStatus()
        if (onDataIngested) onDataIngested()
      } else {
        const err = await res.json()
        setMsg({ text: err.detail || 'Gmail sync failed.', type: 'error' })
      }
    } catch (e: any) {
      setMsg({ text: `Sync error: ${e.message}`, type: 'error' })
    } finally {
      setLoading(false)
    }
  }

  const handleDisconnectGmail = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/v1/integrations/gmail/disconnect', { method: 'POST' })
      if (res.ok) {
        setMsg({ text: 'Gmail disconnected and tokens revoked.', type: 'info' })
        await fetchStatus()
      }
    } catch (e: any) {
      setMsg({ text: `Error: ${e.message}`, type: 'error' })
    } finally {
      setLoading(false)
    }
  }

  // Android Pairing Actions
  const handleGeneratePin = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/v1/integrations/sms/pair-request', { method: 'POST' })
      if (res.ok) {
        const data = await res.json()
        setPairingPin(data.pairing_pin)
        setMsg({ text: 'Pairing PIN generated (valid for 10 minutes).', type: 'info' })
      }
    } catch (e: any) {
      setMsg({ text: `PIN error: ${e.message}`, type: 'error' })
    } finally {
      setLoading(false)
    }
  }

  const handleSimulateDeviceLink = async () => {
    if (!pairingPin) return
    setLoading(true)
    try {
      const res = await fetch('/api/v1/integrations/sms/pair-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pin: pairingPin,
          device_id: 'pixel_8_pro_9912',
          device_name: 'Google Pixel 8 Pro'
        })
      })
      if (res.ok) {
        const data = await res.json()
        setMsg({ text: data.message, type: 'success' })
        setPairingPin(null)
        await fetchStatus()
      }
    } catch (e: any) {
      setMsg({ text: `Pairing failed: ${e.message}`, type: 'error' })
    } finally {
      setLoading(false)
    }
  }

  const handleDisconnectSMS = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/v1/integrations/sms/disconnect', { method: 'POST' })
      if (res.ok) {
        setMsg({ text: 'Android companion device unlinked.', type: 'info' })
        await fetchStatus()
      }
    } catch (e: any) {
      setMsg({ text: `Error: ${e.message}`, type: 'error' })
    } finally {
      setLoading(false)
    }
  }

  // Direct SMS Dispatch
  const handleSendSimulatedSMS = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/v1/integrations/sms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ sender: smsSender, body: smsBody, timestamp: new Date().toISOString() }]
        })
      })
      if (res.ok) {
        const data = await res.json()
        const s = data.summary
        setMsg({
          text: `Processed SMS: Ingested: ${s.ingested_transactions}, Alerts: ${s.pre_debit_alerts}, Duplicates: ${s.duplicates_filtered}, Discarded OTPs: ${s.discarded_otps}`,
          type: 'success'
        })
        await fetchStatus()
        if (onDataIngested) onDataIngested()
      }
    } catch (e: any) {
      setMsg({ text: `SMS Ingestion error: ${e.message}`, type: 'error' })
    } finally {
      setLoading(false)
    }
  }

  const copyPin = () => {
    if (pairingPin) {
      navigator.clipboard.writeText(pairingPin)
      setPinCopied(true)
      setTimeout(() => setPinCopied(false), 2000)
    }
  }

  const gmailConnected = status?.channels?.gmail?.connected
  const smsPaired = status?.channels?.android_sms?.paired

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Title & Overview */}
      <div className="border-b border-white/[0.08] pb-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
            <Zap className="w-5 h-5 text-cyan-400" />
            Financial Data Connections & Ingestion Feeds
          </h2>
          <p className="text-xs text-neutral-400 font-mono mt-1">
            Official Gmail OAuth 2.0 read-only invoice scanner and Android SMS/notification companion.
          </p>
        </div>
        <button
          onClick={fetchStatus}
          className="px-3 py-1.5 rounded-lg bg-[#111726] hover:bg-[#182136] border border-white/[0.08] text-xs font-mono text-neutral-300 flex items-center gap-1.5 transition"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh Status
        </button>
      </div>

      {/* Toast Notification */}
      {msg && (
        <div
          className={`p-3 rounded-xl border text-xs font-mono flex items-center justify-between ${
            msg.type === 'success'
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
              : msg.type === 'error'
              ? 'bg-rose-500/10 border-rose-500/30 text-rose-300'
              : 'bg-cyan-500/10 border-cyan-500/30 text-cyan-300'
          }`}
        >
          <span>{msg.text}</span>
          <button onClick={() => setMsg(null)} className="text-neutral-400 hover:text-white px-1">
            ✕
          </button>
        </div>
      )}

      {/* Telemetry Stats Strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="p-3.5 rounded-xl bg-[#111726] border border-white/[0.06]">
          <div className="text-[10px] font-mono uppercase text-neutral-400 tracking-wider">Emails Scanned</div>
          <div className="text-xl font-bold font-mono text-white mt-1">
            {status?.metrics?.total_emails_scanned || 0}
          </div>
        </div>
        <div className="p-3.5 rounded-xl bg-[#111726] border border-white/[0.06]">
          <div className="text-[10px] font-mono uppercase text-neutral-400 tracking-wider">SMS / Alerts Scanned</div>
          <div className="text-xl font-bold font-mono text-white mt-1">
            {status?.metrics?.total_sms_scanned || 0}
          </div>
        </div>
        <div className="p-3.5 rounded-xl bg-[#111726] border border-white/[0.06]">
          <div className="text-[10px] font-mono uppercase text-neutral-400 tracking-wider">Transactions Ingested</div>
          <div className="text-xl font-bold font-mono text-cyan-400 mt-1">
            {status?.metrics?.total_transactions_ingested || 0}
          </div>
        </div>
        <div className="p-3.5 rounded-xl bg-[#111726] border border-white/[0.06]">
          <div className="text-[10px] font-mono uppercase text-neutral-400 tracking-wider">Duplicates Filtered</div>
          <div className="text-xl font-bold font-mono text-emerald-400 mt-1">
            {status?.metrics?.total_duplicates_filtered || 0}
          </div>
        </div>
      </div>

      {/* Integration Channels (2 Column Grid) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* CARD 1: GMAIL OAUTH 2.0 */}
        <div className="p-5 rounded-2xl bg-[#0d121e] border border-white/[0.08] space-y-4 shadow-xl">
          <div className="flex items-center justify-between pb-3 border-b border-white/[0.06]">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400">
                <Mail className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-bold text-white text-sm">Gmail Financial Invoices</h3>
                <div className="text-[11px] font-mono text-neutral-400">Official Google OAuth 2.0</div>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              {gmailConnected ? (
                <span className="px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-[10px] font-mono font-bold flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3" /> CONNECTED
                </span>
              ) : (
                <span className="px-2 py-0.5 rounded-full bg-neutral-500/15 border border-neutral-500/30 text-neutral-400 text-[10px] font-mono">
                  DISCONNECTED
                </span>
              )}
            </div>
          </div>

          <p className="text-xs text-neutral-300 leading-relaxed">
            Automatically scans digital subscription invoices from Netflix, Spotify, Google, Apple, and Amazon.
          </p>

          <div className="p-3 rounded-xl bg-[#080b12] border border-white/[0.04] text-[11px] font-mono text-neutral-400 space-y-1">
            <div className="flex items-center gap-1.5 text-neutral-300 font-semibold">
              <ShieldCheck className="w-3.5 h-3.5 text-cyan-400" />
              Security & Permissions Scope
            </div>
            <div>• Strictly restricted to <span className="text-cyan-300">gmail.readonly</span></div>
            <div>• Zero email sending, deletion, or modification rights</div>
            <div>• Refresh tokens encrypted with AES-256-GCM at rest</div>
          </div>

          {gmailConnected && (
            <div className="p-3 rounded-xl bg-[#111726] border border-white/[0.08] text-xs font-mono space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-neutral-400 text-[10px] uppercase">Connected Account</div>
                {!isEditingEmail && (
                  <button
                    onClick={() => {
                      setNewEmailInput(status?.channels?.gmail?.email || '')
                      setIsEditingEmail(true)
                    }}
                    className="text-[10px] text-cyan-400 hover:text-cyan-300 font-sans cursor-pointer underline"
                  >
                    Change Email
                  </button>
                )}
              </div>

              {isEditingEmail ? (
                <div className="flex items-center gap-1.5 pt-1">
                  <input
                    type="email"
                    value={newEmailInput}
                    onChange={e => setNewEmailInput(e.target.value)}
                    placeholder="yourname@gmail.com"
                    className="flex-1 bg-[#080b12] border border-cyan-500/40 rounded-lg px-2.5 py-1.5 text-xs font-mono text-white placeholder-neutral-500 focus:outline-none"
                    autoFocus
                  />
                  <button
                    onClick={handleUpdateEmail}
                    disabled={loading || !newEmailInput.trim()}
                    className="px-2.5 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg text-[11px] font-bold transition disabled:opacity-50 cursor-pointer"
                  >
                    Save
                  </button>
                  <button
                    onClick={() => setIsEditingEmail(false)}
                    className="px-2 py-1.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-400 hover:text-white rounded-lg text-[11px] transition cursor-pointer"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <div className="text-white font-semibold">{status?.channels?.gmail?.email || 'user@gmail.com'}</div>
              )}

              <div className="text-[10px] text-neutral-400 pt-1">
                Last Synced: {status?.channels?.gmail?.last_sync || 'Just now'}
              </div>
            </div>
          )}

          {!gmailConnected && (
            <div className="space-y-1.5">
              <label className="text-[10px] font-mono uppercase text-neutral-400">Account Email Address</label>
              <input
                type="email"
                value={customEmail}
                onChange={e => setCustomEmail(e.target.value)}
                placeholder="Enter your Gmail (e.g. user@gmail.com)"
                className="w-full bg-[#111726] border border-white/[0.08] rounded-xl px-3 py-2 text-xs font-mono text-white placeholder-neutral-500 focus:outline-none focus:border-cyan-500/50"
              />
            </div>
          )}

          <div className="pt-2 flex items-center gap-2">
            {!gmailConnected ? (
              <button
                onClick={handleConnectGmail}
                disabled={loading}
                className="w-full py-2.5 px-4 rounded-xl bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-500 hover:to-rose-500 text-white font-bold text-xs transition flex items-center justify-center gap-2 shadow-lg shadow-red-950 disabled:opacity-50"
              >
                <Mail className="w-4 h-4" />
                Connect Gmail Account
              </button>
            ) : (
              <>
                <button
                  onClick={handleSyncGmail}
                  disabled={loading}
                  className="flex-1 py-2 px-3 rounded-xl bg-gradient-to-r from-indigo-600 to-cyan-600 hover:from-indigo-500 hover:to-cyan-500 text-white font-bold text-xs transition flex items-center justify-center gap-1.5 shadow-md disabled:opacity-50"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                  Sync Invoices Now
                </button>
                <button
                  onClick={handleDisconnectGmail}
                  disabled={loading}
                  className="py-2 px-3 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-neutral-300 hover:text-white text-xs font-mono transition"
                >
                  Disconnect
                </button>
              </>
            )}
          </div>
        </div>

        {/* CARD 2: ANDROID SMS & NOTIFICATION COMPANION */}
        <div className="p-5 rounded-2xl bg-[#0d121e] border border-white/[0.08] space-y-4 shadow-xl">
          <div className="flex items-center justify-between pb-3 border-b border-white/[0.06]">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-xl bg-cyan-500/10 border border-cyan-500/20 text-cyan-400">
                <Smartphone className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-bold text-white text-sm">Android Companion App</h3>
                <div className="text-[11px] font-mono text-neutral-400">SMS & Notification Listener</div>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              {smsPaired ? (
                <span className="px-2 py-0.5 rounded-full bg-cyan-500/15 border border-cyan-500/30 text-cyan-400 text-[10px] font-mono font-bold flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3" /> PAIRED
                </span>
              ) : (
                <span className="px-2 py-0.5 rounded-full bg-neutral-500/15 border border-neutral-500/30 text-neutral-400 text-[10px] font-mono">
                  NOT PAIRED
                </span>
              )}
            </div>
          </div>

          <p className="text-xs text-neutral-300 leading-relaxed">
            Captures real-time bank debit alerts, UPI AutoPay tokens (UMN), and 24-48h pre-debit notices.
          </p>

          <div className="p-3 rounded-xl bg-[#080b12] border border-white/[0.04] text-[11px] font-mono text-neutral-400 space-y-1">
            <div className="flex items-center gap-1.5 text-neutral-300 font-semibold">
              <Lock className="w-3.5 h-3.5 text-emerald-400" />
              Privacy & Google Play Policy
            </div>
            <div>• Uses NotificationListenerService (100% compliant)</div>
            <div>• Filters DLT bank headers (AX-HDFCBK, VM-SBIINB)</div>
            <div>• Strict RAM discard for OTPs and security codes</div>
          </div>

          {smsPaired && (
            <div className="p-3 rounded-xl bg-[#111726] border border-white/[0.08] text-xs font-mono space-y-1">
              <div className="text-neutral-400 text-[10px] uppercase">Paired Android Device</div>
              <div className="text-white font-semibold">{status?.channels?.android_sms?.device_name || 'Pixel Device'}</div>
              <div className="text-[10px] text-neutral-400 pt-1">
                Last Alert Received: {status?.channels?.android_sms?.last_sync || 'Recently'}
              </div>
            </div>
          )}

          {/* Pairing PIN Section */}
          {pairingPin && (
            <div className="p-3.5 rounded-xl bg-cyan-500/10 border border-cyan-500/30 space-y-2">
              <div className="text-[11px] font-mono text-cyan-300 font-semibold">Enter PIN in Android Companion App:</div>
              <div className="flex items-center justify-between">
                <span className="text-2xl font-mono font-bold tracking-widest text-white">{pairingPin}</span>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={copyPin}
                    className="p-1.5 rounded-lg bg-cyan-600/20 hover:bg-cyan-600/40 text-cyan-300 transition text-xs font-mono flex items-center gap-1"
                  >
                    {pinCopied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    {pinCopied ? 'Copied' : 'Copy'}
                  </button>
                  <button
                    onClick={handleSimulateDeviceLink}
                    className="px-2.5 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white font-mono text-xs font-bold transition"
                  >
                    Link Device
                  </button>
                </div>
              </div>
            </div>
          )}

          <div className="pt-2 flex items-center gap-2">
            {!smsPaired && !pairingPin && (
              <button
                onClick={handleGeneratePin}
                disabled={loading}
                className="w-full py-2.5 px-4 rounded-xl bg-gradient-to-r from-cyan-600 to-indigo-600 hover:from-cyan-500 hover:to-indigo-500 text-white font-bold text-xs transition flex items-center justify-center gap-2 shadow-lg shadow-cyan-950 disabled:opacity-50"
              >
                <Key className="w-4 h-4" />
                Pair Android Device (Generate PIN)
              </button>
            )}
            {smsPaired && (
              <button
                onClick={handleDisconnectSMS}
                disabled={loading}
                className="w-full py-2 px-3 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-neutral-300 hover:text-white text-xs font-mono transition"
              >
                Unlink Android Device
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Direct SMS & Alert Simulator (Interactive Browser Testing) */}
      <div className="p-5 rounded-2xl bg-[#0d121e] border border-white/[0.08] space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Send className="w-4 h-4 text-cyan-400" />
            <h3 className="font-bold text-white text-sm">Direct SMS & Pre-Debit Alert Ingest Simulator</h3>
          </div>
          <span className="text-[11px] font-mono text-neutral-400">Browser Ingest Testing</span>
        </div>
        <p className="text-xs text-neutral-400">
          Paste an SMS transaction or statutory pre-debit alert to test the deduplication and pre-debit matching engine.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div className="md:col-span-1">
            <label className="text-[10px] font-mono text-neutral-400 uppercase">Sender Header</label>
            <input
              type="text"
              value={smsSender}
              onChange={e => setSmsSender(e.target.value)}
              className="w-full mt-1 px-3 py-2 rounded-xl bg-[#080b12] border border-white/[0.1] text-xs font-mono text-white focus:outline-none focus:border-cyan-500"
            />
          </div>
          <div className="md:col-span-3">
            <label className="text-[10px] font-mono text-neutral-400 uppercase">Message Text</label>
            <input
              type="text"
              value={smsBody}
              onChange={e => setSmsBody(e.target.value)}
              className="w-full mt-1 px-3 py-2 rounded-xl bg-[#080b12] border border-white/[0.1] text-xs font-mono text-white focus:outline-none focus:border-cyan-500"
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button
            onClick={() => {
              setSmsSender('VM-SBIINB')
              setSmsBody('Pre-debit alert: UPI AutoPay mandate for Rs. 149.00 will be debited on 24-Nov-2026 for Spotify India. Mandate UMN 9b1deb4d3b7d4e899b82142a781d4512')
            }}
            className="px-2.5 py-1.5 rounded-lg bg-[#111726] hover:bg-[#182136] text-[11px] font-mono text-neutral-300 transition"
          >
            Load Pre-Debit Sample
          </button>
          <button
            onClick={() => {
              setSmsSender('AX-HDFCBK')
              setSmsBody('Your OTP is 882910 for txn of Rs 5,000. Never share your OTP.')
            }}
            className="px-2.5 py-1.5 rounded-lg bg-[#111726] hover:bg-[#182136] text-[11px] font-mono text-neutral-300 transition"
          >
            Load OTP Sample (Security Test)
          </button>
          <button
            onClick={handleSendSimulatedSMS}
            disabled={loading}
            className="py-1.5 px-4 rounded-xl bg-gradient-to-r from-cyan-600 to-indigo-600 hover:from-cyan-500 hover:to-indigo-500 text-white font-bold text-xs transition flex items-center gap-1.5 shadow-md disabled:opacity-50"
          >
            <Send className="w-3.5 h-3.5" />
            Ingest & Run Pipeline
          </button>
        </div>
      </div>
    </div>
  )
}

