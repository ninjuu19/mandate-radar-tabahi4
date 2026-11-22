import React, { useState } from 'react'
import {
  HelpCircle,
  Network,
  ChevronDown,
  ChevronUp,
  Sparkles,
  Layers,
  Building2,
  CreditCard,
  User,
  ShieldCheck,
  Info
} from 'lucide-react'

interface GraphGuideProps {
  currentMode: string
  onModeChange: (mode: string) => void
  onRunCypher: () => void
}

export const GraphGuide: React.FC<GraphGuideProps> = ({
  currentMode,
  onModeChange,
  onRunCypher
}) => {
  const [isOpen, setIsOpen] = useState(true)
  const [activeTab, setActiveTab] = useState<'concepts' | 'how_to_read' | 'insights'>('concepts')

  return (
    <div className="rounded-3xl bg-white border border-[#E8E1D2] shadow-sm overflow-hidden text-left transition-all">
      {/* Top Bar / Header */}
      <div className="p-4 sm:p-5 flex items-center justify-between gap-4 border-b border-[#E8E1D2] bg-[#FAF8F5]">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-2xl bg-[#0E2419] text-[#2DE2B5] flex items-center justify-center shrink-0">
            <Network className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-[#0F1713] flex items-center gap-2">
              <span>Neo4j Graph Explorer &amp; Visual Guide</span>
              <span className="text-[10px] font-mono font-semibold px-2 py-0.5 rounded-full bg-[#C6F6D5] text-[#0B2417]">
                Knowledge Graph
              </span>
            </h3>
            <p className="text-[11px] text-[#64756B]">
              Demystifies corporate ownership, functional overlap, and recurring auto-debit rails.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsOpen(!isOpen)}
            className="p-1.5 rounded-xl hover:bg-[#EEDBCA]/40 text-[#0F1713] transition-colors cursor-pointer flex items-center gap-1 text-xs font-semibold"
          >
            <span>{isOpen ? 'Hide Guide' : 'Show Guide'}</span>
            {isOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {isOpen && (
        <div className="p-5 sm:p-6 space-y-5 animate-fade-in">
          {/* Sub-tabs inside guide */}
          <div className="flex p-1 bg-[#F8F5EE] border border-[#E8E1D2] rounded-xl w-fit">
            <button
              onClick={() => setActiveTab('concepts')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
                activeTab === 'concepts'
                  ? 'bg-[#0E2419] text-[#2DE2B5] shadow-sm'
                  : 'text-[#64756B] hover:text-[#0F1713]'
              }`}
            >
              Node Taxonomy (What colors mean)
            </button>
            <button
              onClick={() => setActiveTab('how_to_read')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
                activeTab === 'how_to_read'
                  ? 'bg-[#0E2419] text-[#2DE2B5] shadow-sm'
                  : 'text-[#64756B] hover:text-[#0F1713]'
              }`}
            >
              How to Read Connections
            </button>
            <button
              onClick={() => setActiveTab('insights')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
                activeTab === 'insights'
                  ? 'bg-[#0E2419] text-[#2DE2B5] shadow-sm'
                  : 'text-[#64756B] hover:text-[#0F1713]'
              }`}
            >
              Fintech Value &amp; Overlaps
            </button>
          </div>

          {/* TAB 1: Node Taxonomy */}
          {activeTab === 'concepts' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="p-3.5 rounded-2xl bg-[#F8F5EE] border border-[#E8E1D2] space-y-1.5">
                <div className="flex items-center gap-2">
                  <span className="w-3.5 h-3.5 rounded-full bg-cyan-400 border border-cyan-300" />
                  <span className="text-xs font-bold text-[#0F1713]">1. You (Account Holder)</span>
                </div>
                <p className="text-[11px] text-[#64756B] leading-relaxed">
                  The central root node. All standing instructions and auto-debits originate from your bank account or card.
                </p>
              </div>

              <div className="p-3.5 rounded-2xl bg-[#F8F5EE] border border-[#E8E1D2] space-y-1.5">
                <div className="flex items-center gap-2">
                  <span className="w-3.5 h-3.5 rounded-full bg-amber-400 border border-amber-300" />
                  <span className="text-xs font-bold text-[#0F1713]">2. Active Mandate</span>
                </div>
                <p className="text-[11px] text-[#64756B] leading-relaxed">
                  Your detected recurring payments (e.g. Netflix, YouTube Premium, Cult.fit) with cost and frequency.
                </p>
              </div>

              <div className="p-3.5 rounded-2xl bg-[#F8F5EE] border border-[#E8E1D2] space-y-1.5">
                <div className="flex items-center gap-2">
                  <span className="w-3.5 h-3.5 rounded-full bg-indigo-500 border border-indigo-400" />
                  <span className="text-xs font-bold text-[#0F1713]">3. Parent Conglomerate</span>
                </div>
                <p className="text-[11px] text-[#64756B] leading-relaxed">
                  The real corporate owner (Alphabet, Amazon, Walt Disney, Meta). Unmasks where your subscription money ultimately goes.
                </p>
              </div>

              <div className="p-3.5 rounded-2xl bg-[#F8F5EE] border border-[#E8E1D2] space-y-1.5">
                <div className="flex items-center gap-2">
                  <span className="w-3.5 h-3.5 rounded-full bg-pink-400 border border-pink-300" />
                  <span className="text-xs font-bold text-[#0F1713]">4. Payment Mechanism Rail</span>
                </div>
                <p className="text-[11px] text-[#64756B] leading-relaxed">
                  How money is pulled: NPCI UPI AutoPay, Visa/Mastercard Standing Instruction, or Bank NACH.
                </p>
              </div>
            </div>
          )}

          {/* TAB 2: How to Read Connections */}
          {activeTab === 'how_to_read' && (
            <div className="p-4 rounded-2xl bg-[#F8F5EE] border border-[#E8E1D2] space-y-3">
              <div className="text-xs font-bold text-[#0F1713] flex items-center gap-2">
                <Info className="w-4 h-4 text-[#0E2419]" />
                <span>Reading the Directed Edges in the Graph</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                <div className="p-3 rounded-xl bg-white border border-[#E8E1D2] space-y-1">
                  <span className="font-mono font-bold text-[#0E2419] text-[11px] block">COMMITTED_TO</span>
                  <p className="text-[11px] text-[#64756B]">
                    Connects <strong>(You) &rarr; (Mandate)</strong> with your contractual annual spend and charge frequency.
                  </p>
                </div>
                <div className="p-3 rounded-xl bg-white border border-[#E8E1D2] space-y-1">
                  <span className="font-mono font-bold text-[#4F46E5] text-[11px] block">OWNED_BY</span>
                  <p className="text-[11px] text-[#64756B]">
                    Connects <strong>(Mandate) &rarr; (Parent Company)</strong> to show corporate concentration and shared management portals.
                  </p>
                </div>
                <div className="p-3 rounded-xl bg-white border border-[#E8E1D2] space-y-1">
                  <span className="font-mono font-bold text-[#DB2777] text-[11px] block">ROUTED_VIA</span>
                  <p className="text-[11px] text-[#64756B]">
                    Connects <strong>(Mandate) &rarr; (Rail)</strong>. Identifies if you must cancel via BHIM/GPay, netbanking, or bank letter.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: Fintech Value & Overlaps */}
          {activeTab === 'insights' && (
            <div className="p-4 rounded-2xl bg-[#EEDBCA]/30 border border-[#EEDBCA] space-y-2 text-xs">
              <div className="font-bold text-[#0F1713] flex items-center gap-1.5">
                <Sparkles className="w-4 h-4 text-[#0E2419]" />
                <span>Why a Knowledge Graph is Better than a Simple Table:</span>
              </div>
              <ul className="list-disc list-inside space-y-1 text-[#64756B] text-[11px] leading-relaxed">
                <li>
                  <strong>Unmasking Multiple Charges to One Parent</strong>: You might subscribe to YouTube Music and Google One without realizing both debit the same Google account.
                </li>
                <li>
                  <strong>Shared Cancellation Portals</strong>: Neo4j detects that cancelling Amazon Prime automatically cancels Prime Video without needing separate steps.
                </li>
                <li>
                  <strong>Regulatory Friction Score</strong>: Tracks how many steps it takes to stop each rail under RBI guidelines.
                </li>
              </ul>
            </div>
          )}

          {/* Quick Filter Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-[#E8E1D2]">
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              <span className="text-[11px] font-mono text-[#64756B] mr-1">Topology Views:</span>
              <button
                onClick={() => onModeChange('portfolio')}
                className={`px-3 py-1 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                  currentMode === 'portfolio'
                    ? 'bg-[#0E2419] text-[#2DE2B5] shadow-sm'
                    : 'bg-[#F8F5EE] border border-[#E8E1D2] text-[#0F1713] hover:bg-[#EEDBCA]'
                }`}
              >
                My Active Mandates
              </button>
              <button
                onClick={() => onModeChange('alphabet')}
                className={`px-3 py-1 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                  currentMode === 'alphabet'
                    ? 'bg-[#0E2419] text-[#2DE2B5] shadow-sm'
                    : 'bg-[#F8F5EE] border border-[#E8E1D2] text-[#0F1713] hover:bg-[#EEDBCA]'
                }`}
              >
                Alphabet (Google) Footprint
              </button>
              <button
                onClick={() => onModeChange('amazon')}
                className={`px-3 py-1 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                  currentMode === 'amazon'
                    ? 'bg-[#0E2419] text-[#2DE2B5] shadow-sm'
                    : 'bg-[#F8F5EE] border border-[#E8E1D2] text-[#0F1713] hover:bg-[#EEDBCA]'
                }`}
              >
                Amazon.com Footprint
              </button>
              <button
                onClick={() => onModeChange('all')}
                className={`px-3 py-1 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                  currentMode === 'all'
                    ? 'bg-[#0E2419] text-[#2DE2B5] shadow-sm'
                    : 'bg-[#F8F5EE] border border-[#E8E1D2] text-[#0F1713] hover:bg-[#EEDBCA]'
                }`}
              >
                Full Catalog (80 Reference Nodes)
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
