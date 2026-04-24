import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Users, Activity, AlertTriangle, Book } from 'lucide-react';
import { StatsCard } from '../shared/StatsCard';
import { GroupData, GroupStatusCard } from '../shared/GroupStatusCard';
import { courseService, Course } from '../../../../services/api/course';
import { projectService } from '../../../../services/api/project';
import { analyticsService } from '../../../../services/api/analytics';
import { Project } from '../../../../types';

export default function ProjectMonitor() {
    const navigate = useNavigate();
    const [courses, setCourses] = useState<Course[]>([]);
    const [projects, setProjects] = useState<Project[]>([]);
    const [projectAnalytics, setProjectAnalytics] = useState<Record<string, any>>({});
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchOverviewData = async () => {
            try {
                setLoading(true);
                const [coursesData, projectsData] = await Promise.all([
                    courseService.getCourses(),
                    projectService.getProjects()
                ]);
                setCourses(coursesData);
                const active = projectsData.projects.filter((p: Project) => !p.is_archived);
                setProjects(active);

                // Fetch analytics for top active projects
                const topProjects = active.slice(0, 4);
                const analyticsResults = await Promise.all(
                    topProjects.map(p => analyticsService.getDashboardData(p.id).catch(() => null))
                );

                const analyticsMap: Record<string, any> = {};
                topProjects.forEach((p, index) => {
                    if (analyticsResults[index]) {
                        analyticsMap[p.id] = analyticsResults[index];
                    }
                });
                setProjectAnalytics(analyticsMap);

            } catch (error) {
                console.error('Failed to fetch overview data:', error);
            } finally {
                setLoading(false);
            }
        };

        fetchOverviewData();
    }, []);

    const handleViewGroup = (groupId: string) => {
        navigate(`/teacher/projects?group=${groupId}`);
    };

    // Calculate dynamic stats
    const totalStudents = courses.reduce((acc, c) => acc + (c.students?.length || 0), 0);
    const activeProjectsCount = projects.length;

    // Transform Project to GroupData for UI
    const groupItems: GroupData[] = projects.slice(0, 8).map(p => {
        const analytics = projectAnalytics[p.id];
        const fourC: Record<string, number> = analytics?.four_c || {};
        const scores = Object.values(fourC);
        const avgScore = scores.length > 0
            ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
            : Math.max(0, Math.min(100, Math.round(p.progress || 0)));

        let status: 'active' | 'silence' | 'conflict' = 'active';
        let aiInsight = '';
        const totalMessages = analytics?.summary?.total_messages ?? 0;

        if (avgScore < 60) {
            status = 'silence';
            aiInsight = '该小组当前参与度偏低。建议教师查看小组文档、探究空间和聊天记录后，再进行低频引导。';
        } else if (totalMessages > 100 && avgScore < 70) {
            status = 'conflict';
            aiInsight = '该小组对话频率较高但综合表现偏低。建议关注是否存在争议未收束或任务分工不清。';
        } else if (avgScore >= 90) {
            status = 'active';
            aiInsight = '该小组协作表现较好。建议提供更高阶的追问，推动证据比较和阶段性成果整理。';
        } else {
            status = 'active';
            aiInsight = '该小组运行状态平稳。建议关注成员参与是否均衡，并鼓励将讨论沉淀到文档或 Wiki。';
        }

        const finalInsight = analytics?.learning_suggestions?.[0]?.content || aiInsight;
        const activityData = analytics?.activity_trend?.map((t: any) => t.activity_score);

        return {
            id: p.id,
            name: p.name,
            status: status,
            lastActive: p.updated_at ? new Date(p.updated_at).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '暂无记录',
            messageCount: totalMessages,
            engagementScore: avgScore,
            aiInsight: finalInsight,
            activityData: Array.isArray(activityData) && activityData.length > 0 ? activityData : [0, 0, 0, 0, 0],
            members: p.members.map(m => m.user_id)
        };
    });

    if (loading) {
        return <div className="flex items-center justify-center h-64">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
            <span className="ml-3 text-slate-500">加载数据中...</span>
        </div>;
    }

    return (
        <div className="space-y-6 animate-fadeIn">
            {/* Top Stats Row */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mt-4">
                <StatsCard
                    title="课程班级"
                    value={courses.length}
                    subtitle="本学期"
                    icon={Book}
                    color="blue"
                />
                <StatsCard
                    title="学生总数"
                    value={totalStudents}
                    subtitle="全部学生"
                    icon={Users}
                    color="green"
                />
                <StatsCard
                    title="活跃小组"
                    value={activeProjectsCount}
                    subtitle="当前正在协作"
                    icon={Activity}
                    color="blue"
                />
                <StatsCard
                    title="预警提醒"
                    value="0"
                    subtitle="需要关注的小组"
                    icon={AlertTriangle}
                    color="amber"
                />
            </div>

            {/* Groups Grid */}
            <div>
                <h2 className="text-lg font-semibold text-slate-900 mb-4">小组概览</h2>
                {groupItems.length > 0 ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
                        {groupItems.map((group) => (
                            <GroupStatusCard
                                key={group.id}
                                group={group}
                                onViewGroup={handleViewGroup}
                            />
                        ))}
                    </div>
                ) : (
                    <div className="bg-white rounded-lg border-2 border-dashed border-gray-200 p-12 text-center">
                        <Users className="w-12 h-12 text-slate-300 mx-auto mb-4" />
                        <h3 className="text-lg font-medium text-slate-900">暂无活跃小组</h3>
                        <p className="text-slate-500 mt-1">目前没有正在运行的小组。</p>
                    </div>
                )}
            </div>
        </div>
    );
}
