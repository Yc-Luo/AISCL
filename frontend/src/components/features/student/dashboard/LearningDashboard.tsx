import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import {
    Radar,
    RadarChart,
    PolarGrid,
    PolarAngleAxis,
    PolarRadiusAxis,
    ComposedChart,
    Line,
    Bar,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    Legend,
    ResponsiveContainer,
} from 'recharts'
import { taskService } from '../../../../services/api/task'
import { analyticsService } from '../../../../services/api/analytics'
import KnowledgeGraph from './KnowledgeGraph'
import InteractionNetwork from './InteractionNetwork'
import LearningSuggestions from './LearningSuggestions'

interface DashboardData {
    fourC: {
        communication: number
        collaboration: number
        critical_thinking: number
        creativity: number
    }
    personal_four_c?: {
        communication: number
        collaboration: number
        critical_thinking: number
        creativity: number
    }
    activityTrend: Array<{
        date: string
        active_minutes: number
        activity_score: number
        personal_active_minutes?: number
        personal_activity_score?: number
    }>
    knowledge_graph: {
        nodes: Array<{
            id: string;
            label: string;
            is_seed: boolean;
            group_value: number;
            personal_value: number
        }>
        links: Array<{ source: string; target: string; value: number }>
    }
    interaction_network: {
        nodes: Array<{ id: string; label: string; role: string }>
        links: Array<{ source: string; target: string; weight: number }>
    }
    learning_suggestions: Array<{
        id: string
        title: string
        content: string
        type: 'critical' | 'important' | 'normal' | 'info'
    }>
    stats: {
        total_tasks: number
        completed_tasks: number
        team_contributions: number
        learning_hours: number
    }
}

export default function LearningDashboard() {
    const { projectId } = useParams<{ projectId?: string }>()
    const [dashboardData, setDashboardData] = useState<DashboardData | null>(null)
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        let isMounted = true;
        const fetchDashboardData = async () => {
            if (!projectId) return

            try {
                // Only show loading state on first load
                if (!dashboardData) setLoading(true)

                // Fetch project analytics dashboard data
                const apiData = await analyticsService.getDashboardData(projectId)
                if (!isMounted) return;

                const data: DashboardData = {
                    fourC: {
                        communication: apiData.four_c?.communication ?? 0,
                        collaboration: apiData.four_c?.collaboration ?? 0,
                        critical_thinking: apiData.four_c?.critical_thinking ?? 0,
                        creativity: apiData.four_c?.creativity ?? 0,
                    },
                    activityTrend: apiData.activity_trend || [],
                    knowledge_graph: {
                        nodes: (apiData.knowledge_graph?.nodes || []).map((n: any) => ({
                            id: n.id,
                            label: n.label,
                            is_seed: !!n.is_seed,
                            group_value: n.group_value || 0,
                            personal_value: n.personal_value || 0
                        })),
                        links: apiData.knowledge_graph?.links || []
                    },
                    interaction_network: apiData.interaction_network || { nodes: [], links: [] },
                    learning_suggestions: apiData.learning_suggestions || [],
                    personal_four_c: apiData.personal_four_c ? {
                        communication: apiData.personal_four_c.communication ?? 0,
                        collaboration: apiData.personal_four_c.collaboration ?? 0,
                        critical_thinking: apiData.personal_four_c.critical_thinking ?? 0,
                        creativity: apiData.personal_four_c.creativity ?? 0,
                    } : undefined,
                    stats: {
                        total_tasks: 0,
                        completed_tasks: 0,
                        team_contributions: apiData.summary?.total_active_minutes ?? 0,
                        learning_hours: apiData.summary?.total_active_minutes ?? 0,
                    },
                }

                // Fetch task stats separately
                try {
                    const tasksData = await taskService.getTasks(projectId)
                    if (isMounted) {
                        data.stats.total_tasks = tasksData.tasks.length
                        data.stats.completed_tasks = tasksData.tasks.filter(
                            (t) => t.column === 'done'
                        ).length
                    }
                } catch (error) {
                    console.error('Failed to fetch tasks:', error)
                }

                if (isMounted) {
                    setDashboardData(data)
                }
            } catch (error) {
                console.error('Failed to fetch dashboard data:', error)
            } finally {
                if (isMounted) setLoading(false)
            }
        }

        fetchDashboardData()

        // Auto-refresh every 60 seconds
        const intervalId = setInterval(fetchDashboardData, 60000)

        return () => {
            isMounted = false;
            clearInterval(intervalId)
        }
    }, [projectId])

    if (loading) {
        return <div className="p-4">加载中...</div>
    }

    if (!dashboardData) {
        return <div className="p-4">无法加载仪表盘数据</div>
    }

    // Prepare data for radar chart
    const radarData = [
        {
            subject: '沟通',
            group: dashboardData.fourC.communication,
            personal: dashboardData.personal_four_c?.communication || 0,
            fullMark: 100
        },
        {
            subject: '协作',
            group: dashboardData.fourC.collaboration,
            personal: dashboardData.personal_four_c?.collaboration || 0,
            fullMark: 100
        },
        {
            subject: '批判性思维',
            group: dashboardData.fourC.critical_thinking,
            personal: dashboardData.personal_four_c?.critical_thinking || 0,
            fullMark: 100
        },
        {
            subject: '创造力',
            group: dashboardData.fourC.creativity,
            personal: dashboardData.personal_four_c?.creativity || 0,
            fullMark: 100
        },
    ]

    return (
        <div className="h-full overflow-y-auto p-6 space-y-6">
            <h2 className="text-2xl font-bold">学习仪表盘</h2>

            {/* Stats Cards */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="bg-white rounded-lg shadow p-4">
                    <div className="text-sm text-gray-600">总任务数</div>
                    <div className="text-2xl font-bold mt-2">
                        {dashboardData.stats.total_tasks}
                    </div>
                </div>
                <div className="bg-white rounded-lg shadow p-4">
                    <div className="text-sm text-gray-600">已完成任务</div>
                    <div className="text-2xl font-bold mt-2">
                        {dashboardData.stats.completed_tasks}
                    </div>
                </div>
                <div className="bg-white rounded-lg shadow p-4">
                    <div className="text-sm text-gray-600">团队贡献</div>
                    <div className="text-2xl font-bold mt-2">
                        {dashboardData.stats.team_contributions}
                    </div>
                </div>
                <div className="bg-white rounded-lg shadow p-4">
                    <div className="text-sm text-gray-600">学习时长</div>
                    <div className="text-2xl font-bold mt-2">
                        {Math.floor(dashboardData.stats.learning_hours / 60)} 小时
                    </div>
                </div>
            </div>

            {/* Charts Grid (2x2) */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* 4C Core Competencies Radar Chart */}
                <div className="bg-white rounded-lg shadow p-6 h-full">
                    <h3 className="text-lg font-semibold mb-4">4C 核心能力模型</h3>
                    <ResponsiveContainer width="100%" height={260}>
                        <RadarChart data={radarData}>
                            <PolarGrid stroke="#e2e8f0" />
                            <PolarAngleAxis dataKey="subject" tick={{ fontSize: 10, fill: '#64748b' }} />
                            <PolarRadiusAxis angle={90} domain={[0, 100]} tick={{ fontSize: 8 }} axisLine={false} />
                            <Radar
                                name="小组平均"
                                dataKey="group"
                                stroke="#6366f1"
                                fill="#6366f1"
                                fillOpacity={0.3}
                            />
                            <Radar
                                name="个人水平"
                                dataKey="personal"
                                stroke="#10b981"
                                fill="#10b981"
                                fillOpacity={0.5}
                            />
                            <Tooltip
                                contentStyle={{
                                    borderRadius: '8px',
                                    border: 'none',
                                    boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
                                    fontSize: '12px'
                                }}
                            />
                            <Legend wrapperStyle={{ fontSize: '10px', paddingTop: '10px' }} />
                        </RadarChart>
                    </ResponsiveContainer>
                </div>

                {/* Combined Activity Trend (Line + Bar) */}
                <div className="bg-white rounded-lg shadow p-6 h-full">
                    <h3 className="text-lg font-semibold mb-4">活跃度与时长趋势</h3>
                    <ResponsiveContainer width="100%" height={260}>
                        <ComposedChart data={dashboardData.activityTrend}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                            <XAxis
                                dataKey="date"
                                axisLine={false}
                                tickLine={false}
                                tick={{ fontSize: 10, fill: '#94a3b8' }}
                                tickMargin={10}
                            />
                            {/* Left Y-axis for Activity Score */}
                            <YAxis
                                yAxisId="left"
                                orientation="left"
                                axisLine={false}
                                tickLine={false}
                                tick={{ fontSize: 10, fill: '#94a3b8' }}
                                label={{ value: '活跃度', angle: -90, position: 'insideLeft', fontSize: 10, fill: '#94a3b8' }}
                            />
                            {/* Right Y-axis for Active Minutes */}
                            <YAxis
                                yAxisId="right"
                                orientation="right"
                                axisLine={false}
                                tickLine={false}
                                tick={{ fontSize: 10, fill: '#94a3b8' }}
                                label={{ value: '时长 (分)', angle: 90, position: 'insideRight', fontSize: 10, fill: '#94a3b8' }}
                            />
                            <Tooltip
                                contentStyle={{
                                    backgroundColor: '#fff',
                                    borderRadius: '12px',
                                    border: 'none',
                                    boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)',
                                    padding: '12px',
                                    fontSize: '11px'
                                }}
                            />
                            <Legend
                                verticalAlign="bottom"
                                height={36}
                                wrapperStyle={{
                                    fontSize: '10px',
                                    paddingTop: '10px',
                                    color: '#64748b'
                                }}
                            />

                            {/* Duration Data (Bars) - Linked to Right Axis */}
                            <Bar
                                yAxisId="right"
                                dataKey="active_minutes"
                                fill="#a5b4fc"
                                name="集体活跃时长 (分)"
                                barSize={20}
                                radius={[4, 4, 0, 0]}
                                legendType="rect"
                            />
                            <Bar
                                yAxisId="right"
                                dataKey="personal_active_minutes"
                                fill="#6ee7b7"
                                name="个人活跃时长 (分)"
                                barSize={12}
                                radius={[4, 4, 0, 0]}
                                legendType="rect"
                            />

                            {/* Activity Score Data (Lines) - Linked to Left Axis */}
                            <Line
                                yAxisId="left"
                                type="monotone"
                                dataKey="activity_score"
                                stroke="#6366f1"
                                strokeWidth={3}
                                dot={{ r: 4, fill: '#6366f1' }}
                                activeDot={{ r: 6 }}
                                name="集体活跃度"
                                legendType="line"
                            />
                            <Line
                                yAxisId="left"
                                type="monotone"
                                dataKey="personal_activity_score"
                                stroke="#10b981"
                                strokeWidth={3}
                                dot={{ r: 4, fill: '#10b981' }}
                                activeDot={{ r: 6 }}
                                name="个人活跃度"
                                legendType="line"
                            />
                        </ComposedChart>
                    </ResponsiveContainer>
                </div>

                {/* Knowledge Graph */}
                <KnowledgeGraph data={dashboardData.knowledge_graph} />

                {/* Interaction Network */}
                <InteractionNetwork data={dashboardData.interaction_network} />
            </div>

            {/* Learning Suggestions */}
            <LearningSuggestions suggestions={dashboardData.learning_suggestions} />
        </div>
    )
}
