import { useEffect, useMemo, useState } from 'react';
import {
    Users,
    Layers,
    CheckCircle2,
    FileText,
    Clock,
    Plus,
    Upload,
    Bell,
    ExternalLink,
    AlertTriangle
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { ROUTES } from '../../../../config/routes';
import { courseService, Course } from '../../../../services/api/course';
import { projectService } from '../../../../services/api/project';
import { taskService } from '../../../../services/api/task';
import { storageService } from '../../../../services/api/storage';
import { useAuthStore } from '../../../../stores/authStore';
import { Project, Task } from '../../../../types';
import { Button } from '../../../ui';

interface OverviewStats {
    classCount: number;
    activeProjects: number;
    unfinishedTasks: number;
    completedTasks: number;
    resourceCount: number;
}

interface ProjectActivity {
    id: string;
    name: string;
    updatedAt: string;
    memberCount: number;
}

export default function DashboardOverview() {
    const navigate = useNavigate();
    const { user } = useAuthStore();
    const [courses, setCourses] = useState<Course[]>([]);
    const [projects, setProjects] = useState<Project[]>([]);
    const [stats, setStats] = useState<OverviewStats>({
        classCount: 0,
        activeProjects: 0,
        unfinishedTasks: 0,
        completedTasks: 0,
        resourceCount: 0
    });
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchStats = async () => {
            try {
                setLoading(true);
                const [coursesData, projectsData] = await Promise.all([
                    courseService.getCourses(),
                    projectService.getProjects()
                ]);
                const activeProjects = projectsData.projects.filter(p => !p.is_archived);

                const perProject = await Promise.allSettled(
                    activeProjects.map(async (project) => {
                        const [tasksData, resourcesData] = await Promise.all([
                            taskService.getTasks(project.id).catch(() => ({ tasks: [] as Task[], total: 0 })),
                            storageService.getResources(project.id).catch(() => ({ resources: [], total: 0 }))
                        ]);
                        const unfinishedTasks = tasksData.tasks.filter(task => task.column !== 'done').length;
                        const completedTasks = tasksData.tasks.filter(task => task.column === 'done').length;
                        return {
                            unfinishedTasks,
                            completedTasks,
                            resources: resourcesData.resources.length
                        };
                    })
                );

                const totals = perProject.reduce(
                    (acc, result) => {
                        if (result.status === 'fulfilled') {
                            acc.unfinishedTasks += result.value.unfinishedTasks;
                            acc.completedTasks += result.value.completedTasks;
                            acc.resourceCount += result.value.resources;
                        }
                        return acc;
                    },
                    { unfinishedTasks: 0, completedTasks: 0, resourceCount: 0 }
                );

                setCourses(coursesData);
                setProjects(activeProjects);
                setStats({
                    classCount: coursesData.length,
                    activeProjects: activeProjects.length,
                    unfinishedTasks: totals.unfinishedTasks,
                    completedTasks: totals.completedTasks,
                    resourceCount: totals.resourceCount
                });
            } catch (error) {
                console.error('Failed to fetch teacher overview:', error);
            } finally {
                setLoading(false);
            }
        };

        fetchStats();
    }, []);

    const recentProjects: ProjectActivity[] = useMemo(() => (
        [...projects]
            .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
            .slice(0, 5)
            .map(project => ({
                id: project.id,
                name: project.name,
                updatedAt: project.updated_at,
                memberCount: project.members?.length || 0
            }))
    ), [projects]);

    const classesWithoutTaskDoc = courses.filter(course => !course.initial_task_document_content?.trim()).length;
    const classesWithoutProjects = courses.filter(course => !projects.some(project => project.course_id === course.id)).length;

    const statCards = [
        { label: '班级数量', value: stats.classCount, icon: Users, color: 'text-blue-600', bg: 'bg-blue-50' },
        { label: '运行小组', value: stats.activeProjects, icon: Layers, color: 'text-indigo-600', bg: 'bg-indigo-50' },
        { label: '未完成任务', value: stats.unfinishedTasks, icon: CheckCircle2, color: 'text-green-600', bg: 'bg-green-50' },
        { label: '资源总数', value: stats.resourceCount, icon: FileText, color: 'text-orange-600', bg: 'bg-orange-50' },
    ];

    if (loading) {
        return (
            <div className="flex h-[60vh] items-center justify-center">
                <div className="h-10 w-10 animate-spin rounded-full border-b-2 border-indigo-600" />
            </div>
        );
    }

    return (
        <div className="space-y-10 animate-fadeIn">
            <div className="flex flex-col justify-between gap-6 rounded-3xl border border-gray-100 bg-white p-8 shadow-sm md:flex-row md:items-center">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight text-slate-900">
                        教学工作台
                    </h1>
                    <p className="mt-2 font-medium text-slate-500">
                        {user?.username || '教师'}，当前概览基于真实班级、小组、任务和资源数据生成。
                    </p>
                </div>
                <div className="flex flex-wrap gap-3">
                    <Button onClick={() => navigate(ROUTES.TEACHER.PROJECT_MANAGER)} className="gap-2 bg-indigo-600 shadow-lg shadow-indigo-100 hover:bg-indigo-700">
                        <Plus className="h-4 w-4" /> 创建小组
                    </Button>
                    <Button variant="outline" onClick={() => navigate(ROUTES.TEACHER.COURSE_RESOURCES)} className="gap-2 border-slate-200">
                        <Upload className="h-4 w-4" /> 上传资源
                    </Button>
                </div>
            </div>

            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
                {statCards.map((card) => (
                    <div key={card.label} className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm transition-all duration-300 hover:shadow-md">
                        <div className="flex items-start justify-between">
                            <div className={`${card.bg} rounded-xl p-3`}>
                                <card.icon className={`h-6 w-6 ${card.color}`} />
                            </div>
                            <span className="rounded-full bg-slate-50 px-2 py-1 text-xs font-bold text-slate-400">实时</span>
                        </div>
                        <div className="mt-5">
                            <p className="text-sm font-medium text-slate-500">{card.label}</p>
                            <h3 className="mt-1 text-3xl font-bold text-slate-900">{card.value}</h3>
                        </div>
                    </div>
                ))}
            </div>

            <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
                <div className="overflow-hidden rounded-3xl border border-gray-100 bg-white text-slate-900 shadow-sm lg:col-span-2">
                    <div className="flex items-center justify-between border-b border-gray-50 p-6">
                        <h2 className="flex items-center gap-2 text-xl font-bold">
                            <Clock className="h-5 w-5 text-indigo-500" />
                            小组最近更新
                        </h2>
                        <Button variant="ghost" size="sm" className="font-semibold text-indigo-600" onClick={() => navigate(ROUTES.TEACHER.PROJECT_MONITOR)}>
                            查看全部 <ExternalLink className="ml-1 h-4 w-4" />
                        </Button>
                    </div>
                    <div className="divide-y divide-gray-50">
                        {recentProjects.length > 0 ? recentProjects.map((project) => (
                            <div key={project.id} className="flex gap-4 p-5 transition-colors hover:bg-slate-50/50">
                                <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-slate-100 font-bold text-slate-500">
                                    组
                                </div>
                                <div className="flex-1">
                                    <p className="text-sm font-medium">
                                        <span className="text-indigo-600">{project.name}</span> 更新了小组空间
                                    </p>
                                    <p className="mt-1 text-xs text-slate-400">
                                        {new Date(project.updatedAt).toLocaleString('zh-CN')} · {project.memberCount} 名成员
                                    </p>
                                </div>
                                <Button variant="ghost" size="sm" className="text-slate-400 hover:text-indigo-600" onClick={() => navigate(ROUTES.TEACHER.PROJECT_MONITOR)}>
                                    查看
                                </Button>
                            </div>
                        )) : (
                            <div className="p-10 text-center text-sm text-slate-400">
                                暂无小组更新。创建班级和小组后，这里会显示真实协作动态。
                            </div>
                        )}
                    </div>
                </div>

                <div className="overflow-hidden rounded-3xl border border-gray-100 bg-white text-slate-900 shadow-sm">
                    <div className="flex items-center justify-between border-b border-gray-50 p-6">
                        <h2 className="flex items-center gap-2 text-xl font-bold">
                            <Bell className="h-5 w-5 text-orange-500" />
                            教学备忘
                        </h2>
                    </div>
                    <div className="space-y-4 p-6">
                        <div className="rounded-2xl border border-indigo-100 bg-indigo-50 p-4">
                            <p className="text-sm font-bold text-indigo-900">任务完成情况</p>
                            <p className="mt-1 text-xs text-indigo-700">
                                已完成 {stats.completedTasks} 项，未完成 {stats.unfinishedTasks} 项。
                            </p>
                        </div>
                        <div className="rounded-2xl border border-orange-100 bg-orange-50 p-4">
                            <p className="flex items-center gap-2 text-sm font-bold text-orange-900">
                                <AlertTriangle className="h-4 w-4" />
                                配置提醒
                            </p>
                            <p className="mt-1 text-xs text-orange-700">
                                {classesWithoutTaskDoc} 个班级尚未配置项目说明，{classesWithoutProjects} 个班级尚未创建小组。
                            </p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
