import { useRef, useEffect } from 'react'

interface Node {
    id: string;
    label: string;
    is_seed: boolean;
    group_value: number;
    personal_value: number;
    x?: number;
    y?: number;
    vx?: number;
    vy?: number;
}

interface Link {
    source: string;
    target: string;
    value: number;
}

interface KnowledgeGraphProps {
    data: {
        nodes: Node[]
        links: Link[]
    }
}

export default function KnowledgeGraph({ data }: KnowledgeGraphProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const nodesRef = useRef<Node[]>([])
    const requestRef = useRef<number>()
    const draggingRef = useRef<{ nodeId: string; offsetX: number; offsetY: number } | null>(null)

    useEffect(() => {
        if (!data || !data.nodes) return

        const canvas = canvasRef.current
        if (!canvas) return
        const ctx = canvas.getContext('2d')
        if (!ctx) return

        // HiDPI Scaling
        const dpr = window.devicePixelRatio || 1
        const rect = canvas.getBoundingClientRect()
        canvas.width = rect.width * dpr
        canvas.height = rect.height * dpr
        ctx.resetTransform() // Reset any previous scaling
        ctx.scale(dpr, dpr)
        const logicalWidth = rect.width
        const logicalHeight = rect.height

        // Initialize positions if not already set or nodes changed
        const currentNodes = data.nodes.map(node => {
            const existingNode = nodesRef.current.find(n => n.id === node.id)
            if (existingNode) return { ...node, x: existingNode.x, y: existingNode.y, vx: existingNode.vx, vy: existingNode.vy }

            // Random start or fix seed nodes
            const angle = Math.random() * Math.PI * 2
            const r = node.is_seed ? 40 : 80 + Math.random() * 40
            return {
                ...node,
                x: logicalWidth / 2 + Math.cos(angle) * r,
                y: logicalHeight / 2 + Math.sin(angle) * r,
                vx: 0,
                vy: 0
            }
        })
        nodesRef.current = currentNodes

        const handleMouseDown = (e: MouseEvent) => {
            const rect = canvas.getBoundingClientRect()
            const x = e.clientX - rect.left
            const y = e.clientY - rect.top

            const nodes = nodesRef.current
            for (let i = nodes.length - 1; i >= 0; i--) {
                const n = nodes[i]
                const dx = n.x! - x
                const dy = n.y! - y
                const dist = Math.sqrt(dx * dx + dy * dy)
                const hitRadius = Math.max(15, (n.group_value || 0) + 10)

                if (dist < hitRadius) {
                    draggingRef.current = { nodeId: n.id, offsetX: n.x! - x, offsetY: n.y! - y }
                    canvas.style.cursor = 'grabbing'
                    break
                }
            }
        }

        const handleMouseMove = (e: MouseEvent) => {
            const rect = canvas.getBoundingClientRect()
            const x = e.clientX - rect.left
            const y = e.clientY - rect.top

            if (draggingRef.current) {
                const targetNode = nodesRef.current.find(n => n.id === draggingRef.current?.nodeId)
                if (targetNode) {
                    targetNode.x = x + draggingRef.current.offsetX
                    targetNode.y = y + draggingRef.current.offsetY
                    targetNode.vx = 0
                    targetNode.vy = 0
                }
            } else {
                let hovered = false
                const nodes = nodesRef.current
                for (let i = nodes.length - 1; i >= 0; i--) {
                    const n = nodes[i]
                    const dist = Math.sqrt((n.x! - x) ** 2 + (n.y! - y) ** 2)
                    const hitRadius = Math.max(15, (n.group_value || 0) + 10)
                    if (dist < hitRadius) {
                        hovered = true
                        break
                    }
                }
                canvas.style.cursor = hovered ? 'grab' : 'default'
            }
        }

        const handleMouseUp = () => {
            draggingRef.current = null
        }

        window.addEventListener('mousemove', handleMouseMove)
        window.addEventListener('mouseup', handleMouseUp)
        canvas.addEventListener('mousedown', handleMouseDown)

        const animate = () => {
            const nodes = nodesRef.current
            const width = logicalWidth
            const height = logicalHeight
            const centerX = width / 2
            const centerY = height / 2

            // 1. Force calculation
            nodes.forEach(n1 => {
                if (draggingRef.current?.nodeId === n1.id) return
                let fx = 0
                let fy = 0

                if (n1.is_seed) {
                    const seedNodes = nodes.filter(n => n.is_seed)
                    const idx = seedNodes.indexOf(n1)
                    const count = seedNodes.length
                    const idealA = (idx / count) * Math.PI * 2
                    const idealX = centerX + Math.cos(idealA) * 65
                    const idealY = centerY + Math.sin(idealA) * 65
                    fx += (idealX - n1.x!) * 0.08
                    fy += (idealY - n1.y!) * 0.08
                } else {
                    // Discovered nodes gravitate to center smoothly
                    const dx = centerX - n1.x!
                    const dy = centerY - n1.y!
                    const dist = Math.sqrt(dx * dx + dy * dy) || 1
                    const targetDist = 110
                    const strength = (dist - targetDist) * 0.01
                    fx += (dx / dist) * strength
                    fy += (dy / dist) * strength
                }

                // Global Repulsion (with softening to prevent shivering)
                nodes.forEach(n2 => {
                    if (n1.id === n2.id) return
                    const dx = n1.x! - n2.x!
                    const dy = n1.y! - n2.y!
                    const distSq = dx * dx + dy * dy
                    const softening = 200 // Prevent overlapping nodes from exploding
                    const strength = 1800
                    const f = strength / (distSq + softening)
                    const dist = Math.sqrt(distSq) || 1
                    fx += (dx / dist) * f
                    fy += (dy / dist) * f
                })

                n1.vx = (n1.vx || 0) + fx
                n1.vy = (n1.vy || 0) + fy
            })

            // Link attraction
            data.links.forEach(link => {
                const s = nodes.find(n => n.id === link.source)
                const t = nodes.find(n => n.id === link.target)
                if (s && t) {
                    const dx = t.x! - s.x!
                    const dy = t.y! - s.y!
                    const dist = Math.sqrt(dx * dx + dy * dy) || 1
                    const targetDist = s.is_seed && t.is_seed ? 80 : 50
                    const strength = 0.04
                    const f = (dist - targetDist) * strength
                    const moveX = (dx / dist) * f
                    const moveY = (dy / dist) * f
                    s.vx! += moveX
                    s.vy! += moveY
                    t.vx! -= moveX
                    t.vy! -= moveY
                }
            })

            // Apply friction and move
            nodes.forEach(n => {
                if (draggingRef.current?.nodeId === n.id) return
                const friction = 0.6 // Stronger friction for stability
                n.vx! *= friction
                n.vy! *= friction

                // Cap max velocity
                const maxVel = 5
                const vel = Math.sqrt(n.vx! ** 2 + n.vy! ** 2)
                if (vel > maxVel) {
                    n.vx = (n.vx! / vel) * maxVel
                    n.vy = (n.vy! / vel) * maxVel
                }

                n.x! += n.vx!
                n.y! += n.vy!

                // Bounds
                n.x = Math.max(30, Math.min(width - 30, n.x!))
                n.y = Math.max(30, Math.min(height - 30, n.y!))
            })

            // 2. Rendering
            ctx.clearRect(0, 0, width, height)

            // Draw Edges first
            data.links.forEach(link => {
                const s = nodes.find(n => n.id === link.source)
                const t = nodes.find(n => n.id === link.target)
                if (s && t) {
                    ctx.beginPath()
                    // Stronger links are darker and thicker
                    const alpha = Math.min(0.8, 0.2 + (link.value * 0.12))
                    ctx.strokeStyle = `rgba(148, 163, 184, ${alpha})`
                    ctx.lineWidth = Math.max(0.8, link.value * 1.5)
                    ctx.moveTo(s.x!, s.y!)
                    ctx.lineTo(t.x!, t.y!)
                    ctx.stroke()
                }
            })

            // Draw Nodes
            nodes.forEach(node => {
                const groupSize = Math.max(5, node.group_value || 0)
                const personalSize = Math.max(0, node.personal_value || 0)
                const isDragging = draggingRef.current?.nodeId === node.id

                // Shadow for premium feel
                ctx.shadowColor = 'rgba(0,0,0,0.05)'
                ctx.shadowBlur = isDragging ? 8 : 4
                ctx.shadowOffsetY = isDragging ? 4 : 2

                // Outer ring (Group)
                ctx.beginPath()
                ctx.arc(node.x!, node.y!, groupSize + (isDragging ? 4 : 2), 0, Math.PI * 2)
                ctx.fillStyle = node.is_seed ? '#4f46e5' : '#c7d2fe'
                ctx.fill()

                ctx.shadowBlur = 0 // Remove shadow for inner parts

                // Inner core (Personal)
                if (personalSize > 0) {
                    ctx.beginPath()
                    ctx.arc(node.x!, node.y!, Math.min(groupSize + 1, personalSize + 1), 0, Math.PI * 2)
                    ctx.fillStyle = '#10b981'
                    ctx.fill()
                }

                // Label
                ctx.font = node.is_seed ? '600 11px Inter, system-ui' : '500 10px Inter, system-ui'
                ctx.fillStyle = '#334155'
                ctx.textAlign = 'center'
                ctx.fillText(node.label, node.x!, node.y! + groupSize + 15)
            })

            requestRef.current = requestAnimationFrame(animate)
        }

        requestRef.current = requestAnimationFrame(animate)
        return () => {
            if (requestRef.current) cancelAnimationFrame(requestRef.current)
            window.removeEventListener('mousemove', handleMouseMove)
            window.removeEventListener('mouseup', handleMouseUp)
            canvas.removeEventListener('mousedown', handleMouseDown)
        }
    }, [data])

    return (
        <div className="bg-white rounded-lg shadow p-6 h-full flex flex-col">
            <h3 className="text-lg font-semibold mb-4">知识图谱</h3>
            <div className="h-[260px] bg-slate-50/50 rounded-xl overflow-hidden relative border border-slate-100/50">
                <canvas
                    ref={canvasRef}
                    className="w-full h-full block"
                />
            </div>
            {/* Legend at bottom to match top charts */}
            <div className="flex justify-center gap-6 text-[10px] pt-4">
                <div className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-indigo-500"></span>
                    <span className="text-slate-500 font-medium">小组发现</span>
                </div>
                <div className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                    <span className="text-slate-500 font-medium">个人掌握</span>
                </div>
            </div>
        </div>
    )
}
