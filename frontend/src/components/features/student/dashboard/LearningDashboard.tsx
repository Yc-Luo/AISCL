import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import {
    BarChart,
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

interface DashboardData {
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
    stats: {
        total_tasks: number
        completed_tasks: number
        personal_active_minutes: number
        group_active_minutes: number
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

                const activityTrend = apiData.activity_trend || []
                const personalActiveMinutes = activityTrend.reduce(
                    (sum: number, item: any) => sum + Number(item.personal_active_minutes || 0),
                    0
                )
                const groupActiveMinutes = activityTrend.reduce(
                    (sum: number, item: any) => sum + Number(item.active_minutes || 0),
                    0
                )

                const data: DashboardData = {
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
                    stats: {
                        total_tasks: 0,
                        completed_tasks: 0,
                        personal_active_minutes: personalActiveMinutes,
                        group_active_minutes: groupActiveMinutes,
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

    const formatMinutes = (minutes: number) => {
        if (minutes < 60) return `${Math.round(minutes)} 分钟`
        const hours = minutes / 60
        return `${hours.toFixed(hours >= 10 ? 0 : 1)} 小时`
    }

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
                    <div className="text-sm text-gray-600">个人活跃时长</div>
                    <div className="text-2xl font-bold mt-2">
                        {formatMinutes(dashboardData.stats.personal_active_minutes)}
                    </div>
                </div>
                <div className="bg-white rounded-lg shadow p-4">
                    <div className="text-sm text-gray-600">小组活跃时长</div>
                    <div className="text-2xl font-bold mt-2">
                        {formatMinutes(dashboardData.stats.group_active_minutes)}
                    </div>
                </div>
            </div>

            {/* Charts Grid (2x2) */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Activity Trend */}
                <div className="bg-white rounded-lg shadow p-6 h-full">
                    <h3 className="text-lg font-semibold mb-4">活跃时长趋势</h3>
                    <ResponsiveContainer width="100%" height={260}>
                        <BarChart data={dashboardData.activityTrend}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                            <XAxis
                                dataKey="date"
                                axisLine={false}
                                tickLine={false}
                                tick={{ fontSize: 10, fill: '#94a3b8' }}
                                tickMargin={10}
                            />
                            <YAxis
                                axisLine={false}
                                tickLine={false}
                                tick={{ fontSize: 10, fill: '#94a3b8' }}
                                label={{ value: '分钟', angle: -90, position: 'insideLeft', fontSize: 10, fill: '#94a3b8' }}
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
                            <Bar
                                dataKey="active_minutes"
                                fill="#a5b4fc"
                                name="小组活跃时长 (分)"
                                barSize={20}
                                radius={[4, 4, 0, 0]}
                                legendType="rect"
                            />
                            <Bar
                                dataKey="personal_active_minutes"
                                fill="#6ee7b7"
                                name="个人活跃时长 (分)"
                                barSize={12}
                                radius={[4, 4, 0, 0]}
                                legendType="rect"
                            />
                        </BarChart>
                    </ResponsiveContainer>
                </div>

                {/* Knowledge Graph */}
                <KnowledgeGraph data={dashboardData.knowledge_graph} />

                {/* Interaction Network */}
                <InteractionNetwork data={dashboardData.interaction_network} />
            </div>
        </div>
    )
}
