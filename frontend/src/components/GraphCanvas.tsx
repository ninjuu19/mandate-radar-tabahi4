import React, { useRef, useEffect, useState } from 'react'
import { Sparkles, AlertTriangle, Layers, ZoomIn, ZoomOut, RotateCcw, X, ShieldCheck, DollarSign } from 'lucide-react'

export interface GraphNode {
  id: string
  label?: string
  name?: string
  group?: string
  type?: string
  color?: string
  val?: number
  properties?: Record<string, any>
  x?: number
  y?: number
  vx?: number
  vy?: number
}

export interface GraphEdge {
  id: string
  source: string | any
  target: string | any
  type?: string
  label?: string
  color?: string
  properties?: Record<string, any>
}

interface GraphCanvasProps {
  nodes: GraphNode[]
  edges: GraphEdge[]
  onNodeClick?: (node: GraphNode) => void
  currentMode?: string
  onModeChange?: (mode: string) => void
}

export const GraphCanvas: React.FC<GraphCanvasProps> = ({
  nodes,
  edges,
  onNodeClick,
  currentMode = 'portfolio',
  onModeChange
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null)
  const [hoveredNode, setHoveredNode] = useState<GraphNode | null>(null)
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 0.95 })
  const isDraggingRef = useRef(false)
  const dragStartRef = useRef({ x: 0, y: 0 })
  const draggedNodeRef = useRef<GraphNode | null>(null)

  const simNodesRef = useRef<GraphNode[]>([])
  const simEdgesRef = useRef<GraphEdge[]>([])
  const animFrameIdRef = useRef<number | null>(null)

  // Auto-adapt canvas scale for large multi-node datasets
  useEffect(() => {
    if (nodes && nodes.length > 15) {
      setTransform({ x: 0, y: 0, scale: 0.82 })
    } else {
      setTransform({ x: 0, y: 0, scale: 0.95 })
    }
  }, [nodes?.length, currentMode])

  // Calculate total overlap count and annual savings from active edges
  const overlapEdges = edges.filter(e => e.type === 'OVERLAPS_WITH')
  const totalOverlapSavings = overlapEdges.reduce((acc, e) => acc + (e.properties?.savings || 0), 0)

  useEffect(() => {
    const width = 1000
    const height = 540
    const cx = width / 2
    const cy = height / 2

    // Filter nodes and edges based on current cluster filter tab
    let displayNodes = nodes || []
    if (currentMode === 'overlap') {
      const overlapNodeIds = new Set<string>()
      edges.forEach(e => {
        if (e.type === 'OVERLAPS_WITH') {
          const sId = typeof e.source === 'string' ? e.source : e.source?.id
          const tId = typeof e.target === 'string' ? e.target : e.target?.id
          overlapNodeIds.add(sId)
          overlapNodeIds.add(tId)
        }
      })
      displayNodes = (nodes || []).filter(n =>
        overlapNodeIds.has(n.id) ||
        n.properties?.hasOverlap ||
        n.group === 'person' || n.type === 'person' || n.group === 'user' || n.type === 'user'
      )
    } else if (currentMode === 'alphabet') {
      const isAlphabet = (n: GraphNode) => {
        const text = `${n.label || ''} ${n.name || ''} ${n.properties?.name || ''} ${n.id || ''}`.toLowerCase()
        return text.includes('alphabet') || text.includes('google') || text.includes('youtube') || text.includes('play') || n.group === 'person' || n.type === 'person' || n.group === 'user' || n.type === 'user'
      }
      displayNodes = (nodes || []).filter(isAlphabet)
    } else if (currentMode === 'amazon') {
      const isAmazon = (n: GraphNode) => {
        const text = `${n.label || ''} ${n.name || ''} ${n.properties?.name || ''} ${n.id || ''}`.toLowerCase()
        return text.includes('amazon') || text.includes('prime') || text.includes('aws') || text.includes('audible') || n.group === 'person' || n.type === 'person' || n.group === 'user' || n.type === 'user'
      }
      displayNodes = (nodes || []).filter(isAmazon)
    } else if (currentMode === 'streaming') {
      const isStreaming = (n: GraphNode) => {
        const text = `${n.label || ''} ${n.name || ''} ${n.properties?.name || ''} ${n.id || ''} ${n.properties?.category || ''}`.toLowerCase()
        return text.includes('stream') || text.includes('netflix') || text.includes('spotify') || text.includes('youtube') || text.includes('hotstar') || text.includes('disney') || text.includes('ott') || text.includes('entertainment') || text.includes('music') || n.group === 'person' || n.type === 'person' || n.group === 'user' || n.type === 'user'
      }
      displayNodes = (nodes || []).filter(isStreaming)
    }

    const activeNodeIdSet = new Set(displayNodes.map(n => n.id))
    const displayEdges = (edges || []).filter(e => {
      const srcId = typeof e.source === 'string' ? e.source : e.source?.id
      const tgtId = typeof e.target === 'string' ? e.target : e.target?.id
      return activeNodeIdSet.has(srcId) && activeNodeIdSet.has(tgtId)
    })

    const nodeMap = new Map<string, GraphNode>()

    // Separate by tier for immaculate radial orbit distribution
    const userNodes = displayNodes.filter(n => n.group === 'person' || n.type === 'person' || n.group === 'user' || n.type === 'user')
    const merchantNodes = displayNodes.filter(n => (n.group === 'merchant' || n.type === 'merchant') && !userNodes.includes(n))
    const parentNodes = displayNodes.filter(n => (n.group === 'parent' || n.type === 'parent'))
    const railNodes = displayNodes.filter(n => (n.group === 'rail' || n.type === 'rail' || n.group === 'mechanism' || n.type === 'mechanism'))
    const otherNodes = displayNodes.filter(n => !userNodes.includes(n) && !merchantNodes.includes(n) && !parentNodes.includes(n) && !railNodes.includes(n))

    const initNodes: GraphNode[] = []

    // 1. Center User Node (Fixed at cx, cy)
    userNodes.forEach(n => {
      const cloned: GraphNode = {
        ...n,
        group: 'person',
        val: 26,
        x: cx,
        y: cy,
        vx: 0,
        vy: 0
      }
      nodeMap.set(n.id, cloned)
      initNodes.push(cloned)
    })

    // 2. Merchant Nodes (Inner Orbit: R = 210px, evenly spaced by angle)
    const mRadius = 210
    const mCount = Math.max(merchantNodes.length, 1)
    merchantNodes.forEach((n, idx) => {
      const angle = (idx / mCount) * 2 * Math.PI - Math.PI / 2
      const cloned: GraphNode = {
        ...n,
        group: 'merchant',
        val: 22,
        x: cx + Math.cos(angle) * mRadius,
        y: cy + Math.sin(angle) * mRadius,
        vx: 0,
        vy: 0
      }
      nodeMap.set(n.id, cloned)
      initNodes.push(cloned)
    })

    // 3. Parent Conglomerate Nodes (Outer Orbit: R = 340px, placed radially behind their owned merchants)
    const pRadius = 345
    const pCount = Math.max(parentNodes.length, 1)
    parentNodes.forEach((n, idx) => {
      // Find angle of owned merchant if exists, otherwise space evenly
      let angle = (idx / pCount) * 2 * Math.PI - Math.PI / 2 + 0.2
      const ownedEdge = displayEdges.find(e => {
        const tgtId = typeof e.target === 'string' ? e.target : e.target?.id
        return tgtId === n.id && (e.type === 'OWNED_BY')
      })
      if (ownedEdge) {
        const srcId = typeof ownedEdge.source === 'string' ? ownedEdge.source : ownedEdge.source?.id
        const srcNode = nodeMap.get(srcId)
        if (srcNode && srcNode.x !== undefined && srcNode.y !== undefined) {
          angle = Math.atan2(srcNode.y - cy, srcNode.x - cx)
        }
      }

      const cloned: GraphNode = {
        ...n,
        group: 'parent',
        val: 18,
        x: cx + Math.cos(angle) * pRadius,
        y: cy + Math.sin(angle) * pRadius,
        vx: 0,
        vy: 0
      }
      nodeMap.set(n.id, cloned)
      initNodes.push(cloned)
    })

    // 4. Payment Rail Nodes (Placed in dedicated lower corners so they never interfere)
    const railPositions = [
      { x: cx - 320, y: cy + 180 },
      { x: cx + 320, y: cy + 180 },
      { x: cx - 340, y: cy - 140 },
      { x: cx + 340, y: cy - 140 }
    ]
    railNodes.forEach((n, idx) => {
      const pos = railPositions[idx % railPositions.length]
      const cloned: GraphNode = {
        ...n,
        group: 'rail',
        val: 16,
        x: pos.x,
        y: pos.y,
        vx: 0,
        vy: 0
      }
      nodeMap.set(n.id, cloned)
      initNodes.push(cloned)
    })

    // 5. Any Remaining Nodes
    otherNodes.forEach((n, idx) => {
      const angle = (idx / Math.max(otherNodes.length, 1)) * 2 * Math.PI
      const cloned: GraphNode = {
        ...n,
        group: n.group || 'merchant',
        val: 18,
        x: cx + Math.cos(angle) * 280,
        y: cy + Math.sin(angle) * 280,
        vx: 0,
        vy: 0
      }
      nodeMap.set(n.id, cloned)
      initNodes.push(cloned)
    })

    const initEdges = displayEdges.map(e => ({
      ...e,
      sourceObj: nodeMap.get(typeof e.source === 'string' ? e.source : e.source?.id),
      targetObj: nodeMap.get(typeof e.target === 'string' ? e.target : e.target?.id)
    }))

    simNodesRef.current = initNodes
    simEdgesRef.current = initEdges as any

    let alpha = 1.0
    const decay = 0.985

    const runSimulation = () => {
      const currentNodes = simNodesRef.current
      const currentEdges = simEdgesRef.current as any[]

      if (alpha > 0.005) {
        // 1. Generous Collision Repulsion (Ensures minimum 145px clearance between any two nodes!)
        for (let i = 0; i < currentNodes.length; i++) {
          for (let j = i + 1; j < currentNodes.length; j++) {
            const n1 = currentNodes[i]
            const n2 = currentNodes[j]
            const dx = (n2.x || 0) - (n1.x || 0)
            const dy = (n2.y || 0) - (n1.y || 0)
            const dist = Math.sqrt(dx * dx + dy * dy) || 1
            const minAllowedDist = 145 // ample clearance so text and badges NEVER collide!

            if (dist < minAllowedDist) {
              const overlap = (minAllowedDist - dist) / dist * 0.5 * alpha
              const fx = dx * overlap
              const fy = dy * overlap
              if (n1.group !== 'person') {
                n1.vx = (n1.vx || 0) - fx
                n1.vy = (n1.vy || 0) - fy
              }
              if (n2.group !== 'person') {
                n2.vx = (n2.vx || 0) + fx
                n2.vy = (n2.vy || 0) + fy
              }
            }
          }
        }

        // 2. Link Spring Forces (Differentiates between hierarchy links and overlap arcs)
        for (const edge of currentEdges) {
          const s = edge.sourceObj
          const t = edge.targetObj
          if (s && t) {
            const dx = (t.x || 0) - (s.x || 0)
            const dy = (t.y || 0) - (s.y || 0)
            const dist = Math.sqrt(dx * dx + dy * dy) || 1
            
            // Overlap arcs don't pull nodes together tightly
            const targetDist = edge.type === 'OVERLAPS_WITH' ? 240 : edge.type === 'OWNED_BY' ? 140 : 205
            const force = (dist - targetDist) * 0.025 * alpha
            const fx = (dx / dist) * force
            const fy = (dy / dist) * force

            if (s.group !== 'person') {
              s.vx = (s.vx || 0) + fx
              s.vy = (s.vy || 0) + fy
            }
            if (t.group !== 'person') {
              t.vx = (t.vx || 0) - fx
              t.vy = (t.vy || 0) - fy
            }
          }
        }

        // 3. Gentle Orbital Ring Stabilizer
        for (const n of currentNodes) {
          if (n !== draggedNodeRef.current && n.group !== 'person') {
            const dx = (n.x || 0) - cx
            const dy = (n.y || 0) - cy
            const dist = Math.sqrt(dx * dx + dy * dy) || 1
            const desiredR = n.group === 'parent' ? 345 : n.group === 'rail' ? 310 : 210
            const rDiff = dist - desiredR
            const rForce = rDiff * 0.02 * alpha

            n.vx = ((n.vx || 0) - (dx / dist) * rForce) * 0.85
            n.vy = ((n.vy || 0) - (dy / dist) * rForce) * 0.85
            n.x = (n.x || 0) + (n.vx || 0)
            n.y = (n.y || 0) + (n.vy || 0)
          } else if (n.group === 'person') {
            n.x = cx
            n.y = cy
            n.vx = 0
            n.vy = 0
          }
        }

        alpha *= decay
      }

      drawCanvas()
      animFrameIdRef.current = requestAnimationFrame(runSimulation)
    }

    animFrameIdRef.current = requestAnimationFrame(runSimulation)

    return () => {
      if (animFrameIdRef.current) cancelAnimationFrame(animFrameIdRef.current)
    }
  }, [nodes, edges, currentMode])

  const drawCanvas = () => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.save()
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    // Sleek fintech canvas background
    ctx.fillStyle = '#080c14'
    ctx.fillRect(0, 0, canvas.width, canvas.height)

    // Subtle coordinate grid dots
    ctx.fillStyle = 'rgba(255, 255, 255, 0.03)'
    for (let gx = 20; gx < canvas.width; gx += 40) {
      for (let gy = 20; gy < canvas.height; gy += 40) {
        ctx.fillRect(gx, gy, 1.5, 1.5)
      }
    }

    // Apply pan & zoom
    ctx.translate(transform.x, transform.y)
    ctx.scale(transform.scale, transform.scale)

    const currentNodes = simNodesRef.current
    const currentEdges = simEdgesRef.current as any[]

    const activeNode = selectedNode || hoveredNode
    const connectedNodeIds = new Set<string>()
    if (activeNode) {
      connectedNodeIds.add(activeNode.id)
      for (const e of currentEdges) {
        if (e.sourceObj?.id === activeNode.id) connectedNodeIds.add(e.targetObj?.id)
        if (e.targetObj?.id === activeNode.id) connectedNodeIds.add(e.sourceObj?.id)
      }
    }

    // -------------------------------------------------------------
    // 1. Draw Edges
    // -------------------------------------------------------------
    for (const edge of currentEdges) {
      const s = edge.sourceObj
      const t = edge.targetObj
      if (s && t) {
        const isHighlighted = activeNode && (s.id === activeNode.id || t.id === activeNode.id)
        const isDimmed = activeNode && !isHighlighted
        const isOverlapEdge = edge.type === 'OVERLAPS_WITH'

        const sx = s.x || 0
        const sy = s.y || 0
        const tx = t.x || 0
        const ty = t.y || 0

        if (isOverlapEdge) {
          // --- Overlap Arc: Curved Glowing Dashed Line (Amber/Orange) ---
          const mx = (sx + tx) / 2
          const my = (sy + ty) / 2
          const dx = tx - sx
          const dy = ty - sy
          const dist = Math.sqrt(dx * dx + dy * dy) || 1
          
          // Curve outward from center
          const cx = canvas.width / 2
          const cy = canvas.height / 2
          const dirX = mx - cx
          const dirY = my - cy
          const dirDist = Math.sqrt(dirX * dirX + dirY * dirY) || 1
          const bowDistance = Math.min(60, dist * 0.3)
          const cpx = mx + (dirX / dirDist) * bowDistance
          const cpy = my + (dirY / dirDist) * bowDistance

          ctx.save()
          ctx.beginPath()
          ctx.moveTo(sx, sy)
          ctx.quadraticCurveTo(cpx, cpy, tx, ty)

          ctx.setLineDash([8, 5])
          ctx.strokeStyle = isDimmed ? 'rgba(245, 158, 11, 0.25)' : '#F59E0B'
          ctx.lineWidth = isHighlighted || currentMode === 'overlap' ? 3.0 : 2.0
          ctx.shadowColor = '#F59E0B'
          ctx.shadowBlur = isDimmed ? 0 : 8
          ctx.stroke()
          ctx.restore()

          // Overlap Badge at Midpoint Apex
          const badgeText = edge.label || 'OVERLAP'
          ctx.save()
          ctx.font = 'bold 9px JetBrains Mono'
          const badgeWidth = ctx.measureText(badgeText).width + 16
          const badgeHeight = 18

          ctx.fillStyle = '#78350F'
          ctx.strokeStyle = '#F59E0B'
          ctx.lineWidth = 1.2
          ctx.beginPath()
          ctx.roundRect(cpx - badgeWidth / 2, cpy - badgeHeight / 2, badgeWidth, badgeHeight, 9)
          ctx.fill()
          ctx.stroke()

          ctx.fillStyle = '#FEF08A'
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'
          ctx.fillText(badgeText, cpx, cpy)
          ctx.restore()

        } else if (edge.type === 'COMMITTED_TO') {
          // --- User Commitment Edge: Crisp Cyan / Emerald Line ---
          ctx.save()
          ctx.beginPath()
          ctx.moveTo(sx, sy)
          ctx.lineTo(tx, ty)

          ctx.strokeStyle = isHighlighted
            ? '#38bdf8'
            : isDimmed
            ? 'rgba(40, 60, 80, 0.2)'
            : 'rgba(56, 189, 248, 0.45)'
          ctx.lineWidth = isHighlighted ? 2.2 : 1.2
          ctx.stroke()

          // Financial Amount Pill at Midpoint (45% along line)
          if (!isDimmed && edge.label) {
            const mx = sx + (tx - sx) * 0.48
            const my = sy + (ty - sy) * 0.48
            ctx.font = 'bold 8.5px JetBrains Mono'
            const txtWidth = ctx.measureText(edge.label).width + 10
            ctx.fillStyle = '#0F1E24'
            ctx.strokeStyle = 'rgba(56, 189, 248, 0.4)'
            ctx.lineWidth = 1
            ctx.beginPath()
            ctx.roundRect(mx - txtWidth / 2, my - 7, txtWidth, 14, 7)
            ctx.fill()
            ctx.stroke()

            ctx.fillStyle = '#38BDF8'
            ctx.textAlign = 'center'
            ctx.textBaseline = 'middle'
            ctx.fillText(edge.label, mx, my)
          }
          ctx.restore()

        } else if (edge.type === 'OWNED_BY') {
          // --- Corporate Parent Ownership Edge: Subtle Violet Dotted Line ---
          ctx.save()
          ctx.beginPath()
          ctx.moveTo(sx, sy)
          ctx.lineTo(tx, ty)
          ctx.setLineDash([3, 4])
          ctx.strokeStyle = isHighlighted ? '#A78BFA' : isDimmed ? 'rgba(60, 50, 90, 0.2)' : 'rgba(139, 124, 255, 0.35)'
          ctx.lineWidth = 1.0
          ctx.stroke()
          ctx.restore()

        } else {
          // --- Payment Rail / Other Edge ---
          ctx.save()
          ctx.beginPath()
          ctx.moveTo(sx, sy)
          ctx.lineTo(tx, ty)
          ctx.strokeStyle = isHighlighted ? '#60A5FA' : isDimmed ? 'rgba(40, 50, 80, 0.15)' : 'rgba(77, 163, 255, 0.3)'
          ctx.lineWidth = 1.0
          ctx.stroke()
          ctx.restore()
        }
      }
    }

    // -------------------------------------------------------------
    // 2. Draw Nodes (Icons + Rich Glassmorphic Fintech Badges)
    // -------------------------------------------------------------
    for (const n of currentNodes) {
      const isSelected = selectedNode?.id === n.id
      const isHovered = hoveredNode?.id === n.id
      const isConnected = connectedNodeIds.has(n.id)
      const isDimmed = activeNode && !isConnected
      const grp = n.group || n.type || 'merchant'
      const isUser = grp === 'person' || grp === 'user'
      const isMerchant = grp === 'merchant'
      const isParent = grp === 'parent'
      const isRail = grp === 'rail' || grp === 'mechanism'
      const hasOverlap = !!n.properties?.hasOverlap

      const nx = n.x || 0
      const ny = n.y || 0
      const radius = isUser ? 28 : isMerchant ? 22 : isParent ? 18 : 16

      // Focus / Hover Aura
      if (isSelected || isHovered) {
        ctx.beginPath()
        ctx.arc(nx, ny, radius + 8, 0, 2 * Math.PI)
        ctx.fillStyle = isSelected ? 'rgba(56, 189, 248, 0.25)' : 'rgba(255, 255, 255, 0.12)'
        ctx.fill()
        ctx.strokeStyle = isSelected ? '#38bdf8' : '#94a3b8'
        ctx.lineWidth = 1.8
        ctx.stroke()
      }

      // If node has active overlap: pulsing warning ring
      if (hasOverlap && !isDimmed) {
        ctx.beginPath()
        ctx.arc(nx, ny, radius + 5, 0, 2 * Math.PI)
        ctx.strokeStyle = '#F59E0B'
        ctx.lineWidth = 2.0
        ctx.stroke()
      }

      // Node Body Circle
      ctx.beginPath()
      ctx.arc(nx, ny, radius, 0, 2 * Math.PI)

      let fillColor = '#1E293B'
      let strokeColor = '#475569'

      if (isUser) {
        fillColor = isDimmed ? '#142E24' : '#10B981'
        strokeColor = '#34D399'
      } else if (isMerchant) {
        fillColor = isDimmed ? '#112925' : hasOverlap ? '#B45309' : '#0F766E'
        strokeColor = hasOverlap ? '#F59E0B' : '#2DE2B5'
      } else if (isParent) {
        fillColor = isDimmed ? '#1F1B38' : '#6D28D9'
        strokeColor = '#A78BFA'
      } else if (isRail) {
        fillColor = isDimmed ? '#132338' : '#1D4ED8'
        strokeColor = '#60A5FA'
      }

      ctx.fillStyle = fillColor
      ctx.fill()
      ctx.strokeStyle = strokeColor
      ctx.lineWidth = 2.0
      ctx.stroke()

      // Node Inner Emblem / Monogram
      ctx.save()
      ctx.fillStyle = '#FFFFFF'
      ctx.font = isUser ? 'bold 12px Plus Jakarta Sans' : 'bold 10px JetBrains Mono'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      const monogram = isUser ? '👤' : (n.name || n.label || 'M').slice(0, 2).toUpperCase()
      ctx.fillText(monogram, nx, ny)
      ctx.restore()

      // -----------------------------------------------------------
      // Glassmorphic Fintech Card Attached Directly Below Node
      // -----------------------------------------------------------
      const displayName = n.name || n.properties?.name || n.label || n.id || ''
      const cost = n.properties?.cost
      const amount = n.properties?.amount
      const cadence = n.properties?.cadence
      const flag = n.properties?.flag

      let fintechSubtext = ''
      if (isMerchant) {
        const cadenceShort = cadence === 'MONTHLY' ? '/mo' : cadence === 'QUARTERLY' ? '/qtr' : cadence === 'WEEKLY' ? '/wk' : '/yr'
        if (amount && cost) {
          fintechSubtext = `₹${amount.toLocaleString('en-IN')}${cadenceShort} • ₹${cost.toLocaleString('en-IN')}/yr`
        } else if (cost) {
          fintechSubtext = `₹${cost.toLocaleString('en-IN')}/year`
        }
      } else if (isParent && cost) {
        fintechSubtext = `₹${cost.toLocaleString('en-IN')}/yr Exposure`
      } else if (isUser && cost) {
        fintechSubtext = `₹${cost.toLocaleString('en-IN')}/yr Committed`
      } else if (isRail) {
        fintechSubtext = 'Payment Mechanism'
      }

      ctx.save()
      ctx.font = 'bold 10.5px Plus Jakarta Sans'
      const nameWidth = ctx.measureText(displayName).width
      ctx.font = 'bold 9px JetBrains Mono'
      const subWidth = ctx.measureText(fintechSubtext).width
      const cardWidth = Math.max(130, Math.max(nameWidth, subWidth) + 20)
      const cardHeight = hasOverlap || flag ? 44 : 34
      const cardX = nx - cardWidth / 2
      const cardY = ny + radius + 7

      // Card Background with dark glassmorphism
      ctx.fillStyle = isDimmed ? 'rgba(15, 23, 42, 0.45)' : 'rgba(11, 17, 28, 0.94)'
      ctx.strokeStyle = isSelected ? '#38BDF8' : isDimmed ? 'rgba(255, 255, 255, 0.05)' : hasOverlap ? '#F59E0B' : 'rgba(255, 255, 255, 0.12)'
      ctx.lineWidth = hasOverlap ? 1.4 : 1.0
      ctx.beginPath()
      ctx.roundRect(cardX, cardY, cardWidth, cardHeight, 8)
      ctx.fill()
      ctx.stroke()

      // Line 1: Primary Entity Title
      ctx.fillStyle = isDimmed ? '#64748B' : isSelected || isHovered ? '#FFFFFF' : '#F1F5F9'
      ctx.font = 'bold 10px Plus Jakarta Sans'
      ctx.textAlign = 'center'
      ctx.fillText(displayName, nx, cardY + 12)

      // Line 2: Monospaced Fintech Value (Bright Emerald / Cyan)
      if (fintechSubtext) {
        ctx.fillStyle = isDimmed
          ? '#475569'
          : isUser
          ? '#34D399'
          : isMerchant
          ? '#2DE2B5'
          : isParent
          ? '#C4B5FD'
          : '#93C5FD'
        ctx.font = 'bold 9px JetBrains Mono'
        ctx.fillText(fintechSubtext, nx, cardY + 25)
      }

      // Line 3: Risk or Overlap Flag Pill (if present)
      if (!isDimmed && (hasOverlap || flag)) {
        let tagText = hasOverlap ? '⚡ OVERLAP DETECTED' : flag
        let tagBg = hasOverlap ? '#78350F' : '#3B1D22'
        let tagColor = hasOverlap ? '#FDE047' : '#F87171'

        if (flag === 'PRICE_HIKE') {
          tagText = '⚠️ PRICE HIKE'
          tagBg = '#78350F'
          tagColor = '#FDE047'
        } else if (flag === 'UNUSED_ZOMBIE') {
          tagText = '💀 ZOMBIE DORMANT'
          tagBg = '#450A0A'
          tagColor = '#FCA5A5'
        }

        ctx.font = 'bold 7.5px JetBrains Mono'
        const tagWidth = ctx.measureText(tagText).width + 8
        ctx.fillStyle = tagBg
        ctx.beginPath()
        ctx.roundRect(nx - tagWidth / 2, cardY + 31, tagWidth, 10, 5)
        ctx.fill()

        ctx.fillStyle = tagColor
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(tagText, nx, cardY + 36)
      }

      ctx.restore()
    }

    ctx.restore()
  }

  const getNodeAtPos = (clientX: number, clientY: number): GraphNode | null => {
    const canvas = canvasRef.current
    if (!canvas) return null
    const rect = canvas.getBoundingClientRect()
    const x = (clientX - rect.left - transform.x) / transform.scale
    const y = (clientY - rect.top - transform.y) / transform.scale

    for (const n of simNodesRef.current) {
      const dx = x - (n.x || 0)
      const dy = y - (n.y || 0)
      // Check hit either on circular node or on card below
      if (Math.sqrt(dx * dx + dy * dy) <= (n.val || 20) + 12 || (Math.abs(dx) <= 70 && dy >= 0 && dy <= 60)) {
        return n
      }
    }
    return null
  }

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const node = getNodeAtPos(e.clientX, e.clientY)
    if (node) {
      draggedNodeRef.current = node
      setSelectedNode(node)
      if (onNodeClick) onNodeClick(node)
    } else {
      isDraggingRef.current = true
      dragStartRef.current = { x: e.clientX - transform.x, y: e.clientY - transform.y }
    }
  }

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas) return

    if (draggedNodeRef.current) {
      const rect = canvas.getBoundingClientRect()
      draggedNodeRef.current.x = (e.clientX - rect.left - transform.x) / transform.scale
      draggedNodeRef.current.y = (e.clientY - rect.top - transform.y) / transform.scale
      drawCanvas()
    } else if (isDraggingRef.current) {
      setTransform(prev => ({
        ...prev,
        x: e.clientX - dragStartRef.current.x,
        y: e.clientY - dragStartRef.current.y
      }))
    } else {
      const node = getNodeAtPos(e.clientX, e.clientY)
      setHoveredNode(node)
      canvas.style.cursor = node ? 'pointer' : 'grab'
    }
  }

  const handleMouseUp = () => {
    draggedNodeRef.current = null
    isDraggingRef.current = false
  }

  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault()
    const zoomFactor = e.deltaY < 0 ? 1.08 : 0.92
    setTransform(prev => ({
      ...prev,
      scale: Math.max(0.4, Math.min(2.5, prev.scale * zoomFactor))
    }))
  }

  return (
    <div className="relative w-full h-[540px] bg-[#080c14] rounded-2xl border border-white/[0.08] overflow-hidden shadow-2xl">
      <canvas
        ref={canvasRef}
        width={1000}
        height={540}
        className="w-full h-full block"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
      />

      {/* Cluster & Overlap Filter Tabs Row */}
      <div className="absolute top-3 left-3 flex flex-wrap items-center gap-1.5 bg-[#0f1420]/90 backdrop-blur-md p-1 rounded-xl border border-white/[0.1] text-xs z-10">
        <button
          onClick={() => onModeChange && onModeChange('portfolio')}
          className={`px-3 py-1 rounded-lg font-medium transition cursor-pointer ${
            currentMode === 'portfolio'
              ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 font-semibold shadow-sm'
              : 'text-neutral-400 hover:text-white'
          }`}
        >
          Active Portfolio
        </button>

        {/* Dedicated Overlap & Savings Tab */}
        <button
          onClick={() => onModeChange && onModeChange('overlap')}
          className={`px-3 py-1 rounded-lg font-medium transition flex items-center gap-1.5 cursor-pointer ${
            currentMode === 'overlap'
              ? 'bg-amber-500/25 text-amber-300 border border-amber-500/60 font-semibold shadow-sm'
              : 'text-amber-400/80 hover:text-amber-300 hover:bg-amber-500/10'
          }`}
        >
          <Sparkles className="w-3.5 h-3.5 text-amber-400" />
          <span>⚡ Overlap & Savings {totalOverlapSavings > 0 ? `(₹${totalOverlapSavings.toLocaleString('en-IN')})` : ''}</span>
        </button>

        <button
          onClick={() => onModeChange && onModeChange('alphabet')}
          className={`px-3 py-1 rounded-lg font-medium transition cursor-pointer ${
            currentMode === 'alphabet'
              ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/40 font-semibold shadow-sm'
              : 'text-neutral-400 hover:text-white'
          }`}
        >
          Alphabet (Google)
        </button>
        <button
          onClick={() => onModeChange && onModeChange('amazon')}
          className={`px-3 py-1 rounded-lg font-medium transition cursor-pointer ${
            currentMode === 'amazon'
              ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 font-semibold shadow-sm'
              : 'text-neutral-400 hover:text-white'
          }`}
        >
          Amazon Footprint
        </button>
        <button
          onClick={() => onModeChange && onModeChange('streaming')}
          className={`px-3 py-1 rounded-lg font-medium transition cursor-pointer ${
            currentMode === 'streaming'
              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 font-semibold shadow-sm'
              : 'text-neutral-400 hover:text-white'
          }`}
        >
          Streaming OTT
        </button>
        <button
          onClick={() => onModeChange && onModeChange('all')}
          className={`px-3 py-1 rounded-lg font-medium transition cursor-pointer ${
            currentMode === 'all'
              ? 'bg-purple-500/20 text-purple-300 border border-purple-500/40 font-semibold shadow-sm'
              : 'text-neutral-400 hover:text-white'
          }`}
        >
          Full Catalog
        </button>
      </div>

      {/* Floating Overlap Banner when in Overlap Mode */}
      {currentMode === 'overlap' && (
        <div className="absolute top-14 left-3 right-3 flex items-center justify-between px-4 py-2.5 rounded-xl bg-amber-950/80 border border-amber-500/40 text-amber-200 text-xs shadow-xl animate-fade-in backdrop-blur-md z-10">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
            <span>
              <strong>Catalog Overlap Detected:</strong> Redundant subscriptions providing duplicate streaming/cloud services.
            </span>
          </div>
          {totalOverlapSavings > 0 && (
            <span className="font-mono font-bold bg-amber-500/20 px-2.5 py-1 rounded-md text-amber-300 border border-amber-500/30">
              Potential Savings: ₹{totalOverlapSavings.toLocaleString('en-IN')}/year
            </span>
          )}
        </div>
      )}

      {/* Floating Canvas Controls */}
      <div className="absolute bottom-3 right-3 flex items-center gap-1.5 bg-[#0f1420]/90 backdrop-blur-md px-2.5 py-1.5 rounded-xl border border-white/[0.1] text-[11px] text-neutral-400 font-mono z-10">
        <button
          onClick={() => setTransform(prev => ({ ...prev, scale: Math.min(2.5, prev.scale * 1.15) }))}
          className="px-2 py-0.5 rounded hover:bg-white/[0.08] hover:text-white transition cursor-pointer"
          title="Zoom In"
        >
          +
        </button>
        <button
          onClick={() => setTransform(prev => ({ ...prev, scale: Math.max(0.4, prev.scale * 0.85) }))}
          className="px-2 py-0.5 rounded hover:bg-white/[0.08] hover:text-white transition cursor-pointer"
          title="Zoom Out"
        >
          −
        </button>
        <button
          onClick={() => setTransform({ x: 0, y: 0, scale: 0.95 })}
          className="px-2 py-0.5 rounded hover:bg-white/[0.08] hover:text-white transition cursor-pointer"
        >
          Reset
        </button>
        <span className="text-neutral-500 pl-1">{(transform.scale * 100).toFixed(0)}%</span>
      </div>

      {/* Taxonomy & Fintech Legend */}
      <div className="absolute bottom-3 left-3 flex flex-wrap items-center gap-3 bg-[#0f1420]/90 backdrop-blur-md px-3.5 py-2 rounded-xl border border-white/[0.1] text-[11px] z-10">
        <div className="flex items-center gap-1.5 text-neutral-300">
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 shadow-sm shadow-emerald-400/50" />
          <span>User (Center)</span>
        </div>
        <div className="flex items-center gap-1.5 text-neutral-300">
          <span className="w-2.5 h-2.5 rounded-full bg-[#2DE2B5] shadow-sm shadow-[#2DE2B5]/50" />
          <span>Merchant & Mandate</span>
        </div>
        <div className="flex items-center gap-1.5 text-amber-300 font-semibold">
          <span className="w-2.5 h-2.5 rounded-full bg-amber-400 shadow-sm shadow-amber-400/50" />
          <span>⚡ Overlap Link</span>
        </div>
        <div className="flex items-center gap-1.5 text-neutral-300">
          <span className="w-2.5 h-2.5 rounded-full bg-indigo-400 shadow-sm shadow-indigo-400/50" />
          <span>Parent Conglomerate</span>
        </div>
        <div className="flex items-center gap-1.5 text-neutral-300">
          <span className="w-2.5 h-2.5 rounded-full bg-blue-400 shadow-sm shadow-blue-400/50" />
          <span>Payment Rail</span>
        </div>
      </div>

      {/* Sleek Fintech Node Inspector Flyout */}
      {selectedNode && (
        <div className="absolute top-14 right-3 w-80 bg-[#0c121e]/95 backdrop-blur-md border border-white/[0.15] p-4 rounded-2xl shadow-2xl text-xs space-y-3 animate-in fade-in duration-150 z-20">
          <div className="flex items-start justify-between">
            <div>
              <span className={`text-[10px] font-mono tracking-wide uppercase px-2 py-0.5 rounded border ${
                selectedNode.group === 'merchant'
                  ? 'bg-emerald-950/60 text-emerald-300 border-emerald-800/60'
                  : selectedNode.group === 'parent'
                  ? 'bg-indigo-950/60 text-indigo-300 border-indigo-800/60'
                  : selectedNode.group === 'person'
                  ? 'bg-cyan-950/60 text-cyan-300 border-cyan-800/60'
                  : 'bg-blue-950/60 text-blue-300 border-blue-800/60'
              }`}>
                {selectedNode.label || selectedNode.group}
              </span>
              <h4 className="font-bold text-white text-sm mt-1.5">{selectedNode.name}</h4>
            </div>
            <button
              onClick={() => setSelectedNode(null)}
              className="text-neutral-400 hover:text-white text-xs p-1 rounded-md hover:bg-white/10 transition cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Fintech Exposure Metrics Highlight */}
          <div className="p-3 rounded-xl bg-white/[0.04] border border-white/10 space-y-2">
            <div className="flex justify-between items-baseline">
              <span className="text-neutral-400 text-[11px]">Annual Committed Cost:</span>
              <span className="text-[#2DE2B5] font-mono font-bold text-sm">
                ₹{(selectedNode.properties?.cost || 0).toLocaleString('en-IN')}/yr
              </span>
            </div>
            {selectedNode.properties?.amount && (
              <div className="flex justify-between items-baseline text-[11px]">
                <span className="text-neutral-400">Charge per Cycle:</span>
                <span className="text-white font-mono font-medium">
                  ₹{selectedNode.properties.amount.toLocaleString('en-IN')} ({selectedNode.properties.cadence || 'MONTHLY'})
                </span>
              </div>
            )}
            {selectedNode.properties?.rail && (
              <div className="flex justify-between items-baseline text-[11px]">
                <span className="text-neutral-400">Routing Rail:</span>
                <span className="text-blue-300 font-mono text-[10px] truncate max-w-[150px]">
                  {selectedNode.properties.rail}
                </span>
              </div>
            )}
          </div>

          {/* Overlap & Optimization Insights */}
          {selectedNode.properties?.hasOverlap && (
            <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-200 space-y-1">
              <div className="flex items-center gap-1.5 font-semibold text-[11px] text-amber-300">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                <span>Subscription Overlap Detected</span>
              </div>
              <p className="text-[10px] text-amber-200/90 leading-relaxed">
                {selectedNode.properties.overlapReason || 'Redundant service feature catalog with another active subscription.'}
              </p>
              {selectedNode.properties.overlapSavings > 0 && (
                <div className="pt-1 text-[11px] font-mono text-amber-300 font-bold">
                  ⚡ Potential Annual Savings: ₹{selectedNode.properties.overlapSavings.toLocaleString('en-IN')}/yr
                </div>
              )}
            </div>
          )}

          {/* Node Metadata Key-Values */}
          <div className="border-t border-white/[0.08] pt-2 space-y-1 font-mono text-[11px]">
            {selectedNode.properties &&
              Object.entries(selectedNode.properties)
                .filter(([k]) => !['cost', 'amount', 'hasOverlap', 'overlapSavings', 'overlapReason'].includes(k))
                .slice(0, 5)
                .map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-2 overflow-hidden text-[10.5px]">
                    <span className="text-neutral-500 shrink-0">{k}:</span>
                    <span className="text-neutral-300 truncate font-sans">
                      {typeof v === 'object' ? JSON.stringify(v) : String(v)}
                    </span>
                  </div>
                ))}
          </div>
        </div>
      )}
    </div>
  )
}
