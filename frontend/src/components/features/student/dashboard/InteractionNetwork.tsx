import { useRef, useEffect } from 'react'
import { useAuthStore } from '../../../../stores/authStore'

interface Node {
    id: string;
    label: string;
    role: string;
    x?: number;
    y?: number;
    size?: number;
    isCurrentUser?: boolean;
}

interface InteractionNetworkProps {
    data: {
        nodes: Array<{ id: string; label: string; role: string }>
        links: Array<{ source: string; target: string; weight: number }>
    }
}

export default function InteractionNetwork({ data }: InteractionNetworkProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const { user } = useAuthStore()

    useEffect(() => {
        const canvas = canvasRef.current
        if (!canvas) return
        const ctx = canvas.getContext('2d')
        if (!ctx) return

        if (!data || !data.nodes) return

        // 1. HiDPI Scaling
        const dpr = window.devicePixelRatio || 1
        const rect = canvas.getBoundingClientRect()
        canvas.width = rect.width * dpr
        canvas.height = rect.height * dpr
        ctx.resetTransform()
        ctx.scale(dpr, dpr)
        const width = rect.width
        const height = rect.height

        ctx.clearRect(0, 0, width, height)

        const cx = width / 2
        const cy = height / 2

        // 2. Calculate degrees for sizing (Node Importance)
        const nodeInteractionVolume: Record<string, number> = {}
        data.links.forEach((link) => {
            nodeInteractionVolume[link.source] = (nodeInteractionVolume[link.source] || 0) + (link.weight || 1)
            nodeInteractionVolume[link.target] = (nodeInteractionVolume[link.target] || 0) + (link.weight || 1)
        })

        // 3. Arrange nodes in a circular layout
        const nodesWithPos: Node[] = data.nodes.map((node, i) => {
            const angle = (i / data.nodes.length) * Math.PI * 2
            const orbitRadius = Math.min(width, height) * 0.35
            const volume = nodeInteractionVolume[node.id] || 0
            const isMe = !!(user && String(user.id) === String(node.id))

            return {
                ...node,
                x: cx + Math.cos(angle) * orbitRadius,
                y: cy + Math.sin(angle) * orbitRadius,
                isCurrentUser: isMe,
                // Scale size: Base 6 + Logarithmic volume bonus
                size: (node.role === 'teacher' ? 10 : 7) + Math.min(8, Math.sqrt(volume) * 1.5)
            }
        })

        // 4. Draw connections (Edge Strength)
        data.links.forEach(link => {
            const source = nodesWithPos.find(n => n.id === link.source)
            const target = nodesWithPos.find(n => n.id === link.target)
            if (source && target) {
                const weight = link.weight || 1
                ctx.beginPath()
                // Highlight edges connected to current user
                const isHighlight = source.isCurrentUser || target.isCurrentUser
                ctx.strokeStyle = isHighlight
                    ? `rgba(16, 185, 129, ${Math.min(0.6, weight * 0.1 + 0.2)})`
                    : `rgba(203, 213, 225, ${Math.min(0.5, weight * 0.1 + 0.15)})`

                ctx.lineWidth = Math.max(0.6, weight * 0.8)
                ctx.moveTo(source.x!, source.y!)
                ctx.lineTo(target.x!, target.y!)
                ctx.stroke()
            }
        })

        // 5. Draw nodes (Visual Identity)
        nodesWithPos.forEach(node => {
            // Shadow for premium feel
            ctx.shadowColor = 'rgba(0,0,0,0.1)'
            ctx.shadowBlur = 6
            ctx.shadowOffsetY = 2

            ctx.beginPath()
            ctx.arc(node.x!, node.y!, node.size!, 0, Math.PI * 2)

            if (node.isCurrentUser) {
                ctx.fillStyle = '#10b981' // Emerald for Me
            } else if (node.role === 'ai') {
                ctx.fillStyle = '#a855f7' // Violet for AI
            } else {
                ctx.fillStyle = node.role === 'teacher' ? '#6366f1' : '#94a3b8' // Indigo for Teacher, Slate for Students
            }
            ctx.fill()

            // White inner dot for current user, AI, or teacher
            if (node.isCurrentUser || node.role === 'ai' || node.role === 'teacher') {
                ctx.shadowBlur = 0
                ctx.beginPath()
                ctx.arc(node.x!, node.y!, node.size! * 0.3, 0, Math.PI * 2)
                ctx.fillStyle = 'rgba(255,255,255,0.8)'
                ctx.fill()
            }

            // Labels
            ctx.shadowBlur = 0
            ctx.font = node.isCurrentUser ? 'bold 10px Inter, system-ui' : '500 10px Inter, system-ui'
            ctx.fillStyle = node.isCurrentUser ? '#059669' : '#475569'
            ctx.textAlign = 'center'
            ctx.fillText(
                node.isCurrentUser ? `${node.label} (我)` : node.label,
                node.x!,
                node.y! + node.size! + 14
            )
        })

    }, [data, user])

    return (
        <div className="bg-white rounded-lg shadow p-6 h-full flex flex-col">
            <h3 className="text-lg font-semibold mb-4">互动网络</h3>
            <div className="h-[260px] bg-slate-50/50 rounded-xl overflow-hidden relative border border-slate-100/50">
                <canvas
                    ref={canvasRef}
                    className="w-full h-full block"
                    style={{ cursor: 'crosshair' }}
                />
            </div>
            {/* Identity Legend at bottom */}
            <div className="flex justify-center gap-6 text-[10px] pt-4 flex-wrap">
                <div className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-[#10b981]"></span>
                    <span className="text-slate-500 font-medium">我 (个人)</span>
                </div>
                <div className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-[#a855f7]"></span>
                    <span className="text-slate-500 font-medium">AI 助手</span>
                </div>
                <div className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-[#6366f1]"></span>
                    <span className="text-slate-500 font-medium">教师</span>
                </div>
                <div className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-[#94a3b8]"></span>
                    <span className="text-slate-500 font-medium">同学</span>
                </div>
            </div>
        </div>
    )
}
