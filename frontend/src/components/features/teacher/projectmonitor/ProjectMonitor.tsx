import { useEffect, useMemo, useState, type ComponentType } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    BarChart3,
    BookOpen,
    CheckCircle2,
    Clock3,
    Eye,
    FileText,
    Inbox,
    Layers,
    MessageSquare,
    Search,
    Send,
    Sparkles,
} from 'lucide-react';
import { Button, Input, Badge } from '../../../ui';
import { courseService, Course } from '../../../../services/api/course';
import { projectService } from '../../../../services/api/project';
import { analyticsService } from '../../../../services/api/analytics';
import { chatService } from '../../../../services/api/chat';
import { Project } from '../../../../types';

type GroupStatus = 'normal' | 'attention' | 'help' | 'inactive';

type HelpRequest = {
    id: string;
    projectId: string;
    studentName: string;
    type: string;
    content: string;
    createdAt: string;
    visibility: 'private' | 'group';
    status: 'pending' | 'replied' | 'resolved';
};

type SupportHistoryItem = {
    id: string;
    projectId: string;
    supportType: string;
    content: string;
    createdAt: string;
};

const UNASSIGNED_COURSE_ID = '__unassigned__';

const SUPPORT_TEMPLATES = [
    {
        type: '任务推进',
        text: '请先对照项目说明，明确当前小组最需要解决的一个问题，并把下一步任务写入协作文档。',
    },
    {
        type: '证据补充',
        text: '建议补充至少一条可核验资料，并说明这条证据与当前观点之间的关系。',
    },
    {
        type: '观点比较',
        text: '请尝试列出一个不同观点或反例，再判断原有观点是否需要修订。',
    },
    {
        type: '阶段总结',
        text: '请把当前共识、主要分歧和下一步分工整理到协作文档中。',
    },
    {
        type: '协作分工',
        text: '建议明确每位成员接下来负责的资料、观点或文档部分，避免重复劳动。',
    },
];

const FOUR_C_LABELS: Record<string, string> = {
    communication: '沟通参与',
    collaboration: '协作推进',
    critical_thinking: '批判思维',
    creativity: '成果建构',
};

const FOUR_C_COLORS: Record<string, string> = {
    communication: 'bg-blue-500',
    collaboration: 'bg-emerald-500',
    critical_thinking: 'bg-amber-500',
    creativity: 'bg-violet-500',
};

const emptyHelpRequests: HelpRequest[] = [];

function formatDateTime(value?: string) {
    if (!value) return '暂无记录';
    return new Date(value).toLocaleString('zh-CN', {
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });
}

function getCourseLabel(course?: Course) {
    if (!course) return '未绑定班级';
    return `${course.name}${course.semester ? ` · ${course.semester}` : ''}`;
}

function getBreakdownValue(breakdown: Record<string, number>, keywords: string[]) {
    return Object.entries(breakdown).reduce((sum, [key, value]) => {
        const normalized = key.toLowerCase();
        return keywords.some((keyword) => normalized.includes(keyword))
            ? sum + Number(value || 0)
            : sum;
    }, 0);
}

function getAverageFourC(fourC: Record<string, number>) {
    const values = Object.values(fourC).filter((value) => Number.isFinite(Number(value)));
    if (!values.length) return 0;
    return Math.round(values.reduce((sum, value) => sum + Number(value), 0) / values.length);
}

function deriveGroupStatus(params: {
    hasAnalytics: boolean;
    averageScore: number;
    messageCount: number;
    pendingHelpCount: number;
    updatedAt?: string;
}): GroupStatus {
    if (params.pendingHelpCount > 0) return 'help';
    if (params.updatedAt) {
        const inactiveHours = (Date.now() - new Date(params.updatedAt).getTime()) / 36e5;
        if (inactiveHours >= 48) return 'inactive';
    }
    if (params.averageScore > 0 && params.averageScore < 60) return 'attention';
    if (params.hasAnalytics && params.messageCount === 0) return 'attention';
    return 'normal';
}

function getStatusMeta(status: GroupStatus) {
    const map = {
        normal: {
            label: '运行平稳',
            dot: 'bg-emerald-500',
            badge: 'bg-emerald-50 text-emerald-700 border-emerald-100',
        },
        attention: {
            label: '需要关注',
            dot: 'bg-amber-500',
            badge: 'bg-amber-50 text-amber-700 border-amber-100',
        },
        help: {
            label: '待回复求助',
            dot: 'bg-rose-500',
            badge: 'bg-rose-50 text-rose-700 border-rose-100',
        },
        inactive: {
            label: '近期低活跃',
            dot: 'bg-slate-400',
            badge: 'bg-slate-100 text-slate-600 border-slate-200',
        },
    };
    return map[status];
}

export default function ProjectMonitor() {
    const navigate = useNavigate();
    const [courses, setCourses] = useState<Course[]>([]);
    const [projects, setProjects] = useState<Project[]>([]);
    const [selectedCourseId, setSelectedCourseId] = useState<string>('all');
    const [selectedProjectId, setSelectedProjectId] = useState<string>('');
    const [projectAnalytics, setProjectAnalytics] = useState<Record<string, any>>({});
    const [loading, setLoading] = useState(true);
    const [analyticsLoading, setAnalyticsLoading] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [onlyNeedsAttention, setOnlyNeedsAttention] = useState(false);
    const [supportType, setSupportType] = useState(SUPPORT_TEMPLATES[0].type);
    const [supportDraft, setSupportDraft] = useState(SUPPORT_TEMPLATES[0].text);
    const [supportSending, setSupportSending] = useState(false);
    const [supportFeedback, setSupportFeedback] = useState<string | null>(null);
    const [supportHistory, setSupportHistory] = useState<Record<string, SupportHistoryItem[]>>({});

    useEffect(() => {
        const fetchOverviewData = async () => {
            try {
                setLoading(true);
                const [coursesData, projectsData] = await Promise.all([
                    courseService.getCourses(),
                    projectService.getProjects(),
                ]);
                const activeProjects = projectsData.projects.filter((project: Project) => !project.is_archived);

                setCourses(coursesData);
                setProjects(activeProjects);
                if (!selectedProjectId && activeProjects.length > 0) {
                    setSelectedProjectId(activeProjects[0].id);
                }
            } catch (error) {
                console.error('Failed to fetch monitor data:', error);
            } finally {
                setLoading(false);
            }
        };

        fetchOverviewData();
    }, []);

    useEffect(() => {
        if (!selectedProjectId || projectAnalytics[selectedProjectId]) return;

        let cancelled = false;
        const fetchSelectedAnalytics = async () => {
            try {
                setAnalyticsLoading(true);
                const data = await analyticsService.getDashboardData(selectedProjectId);
                if (!cancelled) {
                    setProjectAnalytics((previous) => ({
                        ...previous,
                        [selectedProjectId]: data,
                    }));
                }
            } catch (error) {
                console.error('Failed to fetch selected project analytics:', error);
            } finally {
                if (!cancelled) setAnalyticsLoading(false);
            }
        };

        fetchSelectedAnalytics();
        return () => {
            cancelled = true;
        };
    }, [projectAnalytics, selectedProjectId]);

    const courseById = useMemo(() => {
        return new Map(courses.map((course) => [course.id, course]));
    }, [courses]);

    const helpRequests = emptyHelpRequests;
    const pendingHelpCountByProject = useMemo(() => {
        return helpRequests.reduce<Record<string, number>>((map, request) => {
            if (request.status === 'pending') {
                map[request.projectId] = (map[request.projectId] || 0) + 1;
            }
            return map;
        }, {});
    }, [helpRequests]);

    const getProjectMetrics = (project: Project) => {
        const analytics = projectAnalytics[project.id];
        const progressScore = Math.max(0, Math.min(100, Math.round(project.progress || 0)));
        const fourC: Record<string, number> = analytics?.four_c || {
            communication: progressScore,
            collaboration: progressScore,
            critical_thinking: progressScore,
            creativity: progressScore,
        };
        const fourCAverage = getAverageFourC(fourC);
        const averageScore = analytics ? fourCAverage : fourCAverage || progressScore;
        const breakdown: Record<string, number> = analytics?.summary?.activity_breakdown || {};
        const derivedMessageCount = getBreakdownValue(breakdown, ['chat', 'message', 'peer_message']);
        const rawMessageCount = Number(analytics?.summary?.total_messages);
        const messageCount = Number.isFinite(rawMessageCount) && rawMessageCount > 0
            ? rawMessageCount
            : derivedMessageCount;
        const documentUpdates = getBreakdownValue(breakdown, ['document', 'shared_record']);
        const inquiryOperations = getBreakdownValue(breakdown, ['inquiry', 'node', 'edge']);
        const wikiActions = getBreakdownValue(breakdown, ['wiki']);
        const pendingHelpCount = pendingHelpCountByProject[project.id] || 0;
        const status = deriveGroupStatus({
            hasAnalytics: Boolean(analytics),
            averageScore,
            messageCount,
            pendingHelpCount,
            updatedAt: project.updated_at,
        });

        return {
            analytics,
            fourC,
            averageScore,
            breakdown,
            messageCount,
            documentUpdates,
            inquiryOperations,
            wikiActions,
            pendingHelpCount,
            status,
        };
    };

    const filteredProjects = useMemo(() => {
        const query = searchQuery.trim().toLowerCase();
        return projects.filter((project) => {
            const matchesCourse =
                selectedCourseId === 'all'
                || (selectedCourseId === UNASSIGNED_COURSE_ID && !project.course_id)
                || project.course_id === selectedCourseId;
            const matchesSearch =
                !query
                || project.name.toLowerCase().includes(query)
                || (project.description || '').toLowerCase().includes(query);
            const metrics = getProjectMetrics(project);
            const matchesAttention = !onlyNeedsAttention || metrics.status !== 'normal';
            return matchesCourse && matchesSearch && matchesAttention;
        });
    }, [onlyNeedsAttention, projectAnalytics, projects, searchQuery, selectedCourseId]);

    const groupedProjects = useMemo(() => {
        const groups = courses.map((course) => ({
            id: course.id,
            label: getCourseLabel(course),
            projects: filteredProjects.filter((project) => project.course_id === course.id),
        }));
        const unassigned = filteredProjects.filter((project) => !project.course_id);
        if (unassigned.length > 0) {
            groups.push({
                id: UNASSIGNED_COURSE_ID,
                label: '未绑定班级',
                projects: unassigned,
            });
        }
        return groups.filter((group) => group.projects.length > 0);
    }, [courses, filteredProjects]);

    useEffect(() => {
        if (filteredProjects.length === 0) return;
        if (!filteredProjects.some((project) => project.id === selectedProjectId)) {
            setSelectedProjectId(filteredProjects[0].id);
        }
    }, [filteredProjects, selectedProjectId]);

    useEffect(() => {
        const defaultTemplate = SUPPORT_TEMPLATES[0];
        setSupportType(defaultTemplate.type);
        setSupportDraft(defaultTemplate.text);
        setSupportFeedback(null);
    }, [selectedProjectId]);

    const selectedProject = filteredProjects.find((project) => project.id === selectedProjectId) || filteredProjects[0];
    const selectedMetrics = selectedProject ? getProjectMetrics(selectedProject) : null;
    const selectedCourse = selectedProject?.course_id ? courseById.get(selectedProject.course_id) : undefined;
    const selectedHelpRequests = selectedProject
        ? helpRequests.filter((request) => request.projectId === selectedProject.id && request.status === 'pending')
        : [];
    const selectedSupportHistory = selectedProject ? supportHistory[selectedProject.id] || [] : [];

    const totalStudents = courses.reduce((acc, course) => acc + (course.students?.length || 0), 0);
    const attentionCount = projects.filter((project) => getProjectMetrics(project).status !== 'normal').length;

    const handleTemplateSelect = (template: (typeof SUPPORT_TEMPLATES)[number]) => {
        setSupportType(template.type);
        setSupportDraft(template.text);
        setSupportFeedback(null);
    };

    const handleSendTeacherSupport = async () => {
        if (!selectedProject || !supportDraft.trim()) return;

        try {
            setSupportSending(true);
            setSupportFeedback(null);
            const message = await chatService.sendTeacherSupport(selectedProject.id, {
                content: supportDraft.trim(),
                support_type: supportType,
            });

            setSupportHistory((previous) => {
                const current = previous[selectedProject.id] || [];
                return {
                    ...previous,
                    [selectedProject.id]: [
                        {
                            id: message.id,
                            projectId: selectedProject.id,
                            supportType,
                            content: message.content,
                            createdAt: message.created_at,
                        },
                        ...current,
                    ].slice(0, 5),
                };
            });
            setSupportFeedback('已发送到小组聊天，并记录为教师支持事件。');
        } catch (error) {
            console.error('Failed to send teacher support:', error);
            setSupportFeedback('发送失败，请检查权限或网络后重试。');
        } finally {
            setSupportSending(false);
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center h-64">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
                <span className="ml-3 text-slate-500">加载小组监控数据中...</span>
            </div>
        );
    }

    return (
        <div className="min-h-screen animate-fadeIn overflow-visible lg:h-[calc(100vh-2rem)] lg:min-h-[720px] lg:overflow-hidden">
            <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-slate-900">小组监控</h1>
                    <p className="mt-1 text-sm text-slate-500">
                        低干预观察台：聚焦小组过程状态、学生求助与教师同伴式支持。
                    </p>
                </div>
                <div className="grid grid-cols-2 gap-2 text-center sm:grid-cols-4">
                    <MiniStat label="班级" value={courses.length} />
                    <MiniStat label="学生" value={totalStudents} />
                    <MiniStat label="小组" value={projects.length} />
                    <MiniStat label="需关注" value={attentionCount} tone={attentionCount > 0 ? 'warning' : 'normal'} />
                </div>
            </div>

            <div className="grid min-h-0 grid-cols-1 gap-4 lg:h-[calc(100%-5.5rem)] lg:grid-cols-[240px_minmax(0,1fr)] 2xl:grid-cols-[260px_minmax(0,1fr)_340px]">
                <aside className="flex max-h-[420px] min-h-0 flex-col rounded-2xl border border-slate-200 bg-white shadow-sm lg:max-h-none lg:row-span-2 2xl:row-span-1">
                    <div className="border-b border-slate-100 p-3">
                        <div className="flex items-center justify-between">
                            <div>
                                <h2 className="text-sm font-bold text-slate-900">班级 / 小组</h2>
                                <p className="mt-1 text-xs text-slate-500">点击小组切换观察对象</p>
                            </div>
                            <Badge className="border-indigo-100 bg-indigo-50 text-indigo-700">
                                {filteredProjects.length} 组
                            </Badge>
                        </div>
                        <div className="mt-3 space-y-2">
                            <div className="relative">
                                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                                <Input
                                    value={searchQuery}
                                    onChange={(event) => setSearchQuery(event.target.value)}
                                    placeholder="搜索小组..."
                                    className="pl-9"
                                />
                            </div>
                            <div className="space-y-2">
                                <select
                                    value={selectedCourseId}
                                    onChange={(event) => setSelectedCourseId(event.target.value)}
                                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
                                >
                                    <option value="all">全部班级</option>
                                    {courses.map((course) => (
                                        <option key={course.id} value={course.id}>{getCourseLabel(course)}</option>
                                    ))}
                                    <option value={UNASSIGNED_COURSE_ID}>未绑定班级</option>
                                </select>
                                <button
                                    type="button"
                                    onClick={() => setOnlyNeedsAttention((value) => !value)}
                                    className={`w-full rounded-lg border px-3 py-2 text-xs font-semibold transition ${onlyNeedsAttention
                                        ? 'border-amber-200 bg-amber-50 text-amber-700'
                                        : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50'
                                        }`}
                                >
                                    只看待处理
                                </button>
                            </div>
                        </div>
                    </div>

                    <div className="min-h-0 flex-1 overflow-y-auto p-3">
                        {groupedProjects.length === 0 ? (
                            <div className="rounded-xl border border-dashed border-slate-200 p-8 text-center text-sm text-slate-400">
                                暂无符合条件的小组
                            </div>
                        ) : (
                            <div className="space-y-3">
                                {groupedProjects.map((group) => (
                                    <div key={group.id} className="space-y-2">
                                        <div className="flex items-center justify-between px-1">
                                            <p className="truncate text-xs font-bold text-slate-500">{group.label}</p>
                                            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500">
                                                {group.projects.length}
                                            </span>
                                        </div>
                                        <div className="space-y-1.5">
                                            {group.projects.map((project) => {
                                                const metrics = getProjectMetrics(project);
                                                const statusMeta = getStatusMeta(metrics.status);
                                                const selected = selectedProject?.id === project.id;
                                                return (
                                                    <button
                                                        key={project.id}
                                                        type="button"
                                                        onClick={() => setSelectedProjectId(project.id)}
                                                        className={`w-full rounded-xl border px-3 py-2.5 text-left transition ${selected
                                                            ? 'border-indigo-200 bg-indigo-50 shadow-sm'
                                                            : 'border-slate-100 bg-white hover:border-slate-200 hover:bg-slate-50'
                                                            }`}
                                                    >
                                                        <div className="flex items-start justify-between gap-2">
                                                            <div className="min-w-0">
                                                                <div className="flex items-center gap-2">
                                                                    <span className={`h-2 w-2 shrink-0 rounded-full ${statusMeta.dot}`} />
                                                                    <p className="truncate text-sm font-semibold text-slate-900">{project.name}</p>
                                                                </div>
                                                                <p className="mt-1 text-xs text-slate-500">
                                                                    {project.members.length} 人 · {formatDateTime(project.updated_at)}
                                                                </p>
                                                            </div>
                                                            {metrics.pendingHelpCount > 0 ? (
                                                                <span className="rounded-full bg-rose-500 px-2 py-0.5 text-[10px] font-bold text-white">
                                                                    {metrics.pendingHelpCount}
                                                                </span>
                                                            ) : null}
                                                        </div>
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </aside>

                <main className="min-h-0 overflow-visible rounded-2xl border border-slate-200 bg-slate-50/60 p-3 sm:p-4 lg:overflow-y-auto">
                    {!selectedProject || !selectedMetrics ? (
                        <EmptyMonitorState />
                    ) : (
                        <div className="space-y-4">
                            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                                    <div>
                                        <div className="flex flex-wrap items-center gap-2">
                                            <h2 className="text-xl font-bold text-slate-900">{selectedProject.name}</h2>
                                            <Badge className={getStatusMeta(selectedMetrics.status).badge}>
                                                {getStatusMeta(selectedMetrics.status).label}
                                            </Badge>
                                        </div>
                                        <p className="mt-2 text-sm text-slate-500">
                                            {getCourseLabel(selectedCourse)} · {selectedProject.members.length} 名成员 · 最近活动 {formatDateTime(selectedProject.updated_at)}
                                        </p>
                                        <div className="mt-3 flex flex-wrap gap-2 text-xs">
                                            <Pill label={`AI形态：${selectedProject.experiment_version?.ai_scaffold_mode || '未标记'}`} />
                                            <Pill label={`过程支架：${selectedProject.experiment_version?.process_scaffold_mode || '未标记'}`} />
                                            <Pill label={`阶段：${selectedProject.experiment_version?.current_stage || '未设置'}`} />
                                        </div>
                                    </div>
                                    <div className="flex flex-wrap gap-2">
                                        <Button
                                            variant="outline"
                                            className="gap-2"
                                            onClick={() => navigate(`/project/${selectedProject.id}`)}
                                        >
                                            <Eye className="h-4 w-4" />
                                            进入观察
                                        </Button>
                                        <Button
                                            variant="outline"
                                            className="gap-2"
                                            onClick={() => navigate(`/teacher/project-dashboard?project=${selectedProject.id}`)}
                                        >
                                            <BarChart3 className="h-4 w-4" />
                                            查看数据
                                        </Button>
                                    </div>
                                </div>
                            </section>

                            <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                                <MetricCard icon={MessageSquare} label="聊天活跃" value={selectedMetrics.messageCount} hint="近 7 天群聊/消息事件" />
                                <MetricCard icon={FileText} label="文档更新" value={selectedMetrics.documentUpdates} hint="共享记录与文档操作" />
                                <MetricCard icon={Layers} label="探究操作" value={selectedMetrics.inquiryOperations} hint="节点、连线与探究事件" />
                                <MetricCard icon={BookOpen} label="Wiki沉淀" value={selectedMetrics.wikiActions} hint="项目知识卡片操作" />
                            </section>

                            <section className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_0.9fr]">
                                <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                                    <div className="mb-4 flex items-center justify-between">
                                        <div>
                                            <h3 className="text-base font-bold text-slate-900">4C 协作表现</h3>
                                            <p className="text-xs text-slate-500">基于真实协作过程数据生成</p>
                                        </div>
                                        {analyticsLoading ? (
                                            <span className="text-xs text-slate-400">更新中...</span>
                                        ) : (
                                            <span className="text-sm font-bold text-indigo-600">{selectedMetrics.averageScore}%</span>
                                        )}
                                    </div>
                                    <div className="space-y-3">
                                        {Object.entries(FOUR_C_LABELS).map(([key, label]) => {
                                            const value = Math.round(selectedMetrics.fourC[key] || 0);
                                            return (
                                                <div key={key}>
                                                    <div className="mb-1 flex items-center justify-between text-xs">
                                                        <span className="font-semibold text-slate-600">{label}</span>
                                                        <span className="font-bold text-slate-900">{value}%</span>
                                                    </div>
                                                    <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                                                        <div
                                                            className={`h-full rounded-full ${FOUR_C_COLORS[key]}`}
                                                            style={{ width: `${value}%` }}
                                                        />
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>

                                <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                                    <h3 className="text-base font-bold text-slate-900">最近活动趋势</h3>
                                    <p className="mt-1 text-xs text-slate-500">用于判断是否需要教师低频介入</p>
                                    <div className="mt-4 flex h-28 items-end gap-2">
                                        {(selectedMetrics.analytics?.activity_trend || []).slice(-7).map((item: any, index: number) => {
                                            const height = Math.max(8, Math.min(100, Number(item.activity_score || 0)));
                                            return (
                                                <div key={`${item.date || index}`} className="flex flex-1 flex-col items-center gap-2">
                                                    <div className="flex h-24 w-full items-end rounded-t-lg bg-slate-50">
                                                        <div
                                                            className="w-full rounded-t-lg bg-gradient-to-t from-indigo-500 to-sky-400"
                                                            style={{ height: `${height}%` }}
                                                        />
                                                    </div>
                                                    <span className="text-[10px] text-slate-400">{String(item.date || '').slice(5) || index + 1}</span>
                                                </div>
                                            );
                                        })}
                                        {(!selectedMetrics.analytics?.activity_trend || selectedMetrics.analytics.activity_trend.length === 0) ? (
                                            <div className="flex h-full w-full items-center justify-center rounded-xl border border-dashed border-slate-200 text-sm text-slate-400">
                                                暂无趋势数据
                                            </div>
                                        ) : null}
                                    </div>
                                </div>
                            </section>

                            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                                <div className="mb-4 flex items-center justify-between">
                                    <div>
                                        <h3 className="text-base font-bold text-slate-900">过程观察摘要</h3>
                                        <p className="text-xs text-slate-500">帮助教师先观察，再决定是否介入</p>
                                    </div>
                                    <Badge variant="secondary" className="bg-slate-100 text-slate-600">低干预</Badge>
                                </div>
                                <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
                                    <ObservationItem
                                        icon={MessageSquare}
                                        title="聊天活跃度"
                                        content={selectedMetrics.messageCount > 0 ? `已记录 ${selectedMetrics.messageCount} 条相关消息事件。` : '暂未形成明显群聊互动，建议先观察任务是否已启动。'}
                                    />
                                    <ObservationItem
                                        icon={FileText}
                                        title="文档推进"
                                        content={selectedMetrics.documentUpdates > 0 ? `共享文档/记录已有 ${selectedMetrics.documentUpdates} 次更新。` : '文档沉淀不足，可提醒学生整理阶段性结论。'}
                                    />
                                    <ObservationItem
                                        icon={Layers}
                                        title="探究结构"
                                        content={selectedMetrics.inquiryOperations > 0 ? `探究空间已有 ${selectedMetrics.inquiryOperations} 次结构操作。` : '探究节点较少，可建议补充证据或观点比较。'}
                                    />
                                </div>
                            </section>
                        </div>
                    )}
                </main>

                <aside className="flex min-h-0 flex-col rounded-2xl border border-slate-200 bg-white shadow-sm lg:col-start-2 2xl:col-start-auto">
                    <div className="border-b border-slate-100 p-4">
                        <div className="flex items-center justify-between">
                            <div>
                                <h2 className="text-sm font-bold text-slate-900">教师支持面板</h2>
                                <p className="mt-1 max-w-[220px] truncate text-xs text-slate-500">
                                    当前对象：{selectedProject?.name || '未选择小组'}
                                </p>
                            </div>
                            <Badge className={selectedHelpRequests.length > 0 ? 'bg-rose-50 text-rose-700 border-rose-100' : 'bg-slate-100 text-slate-500 border-slate-200'}>
                                {selectedHelpRequests.length} 待回复
                            </Badge>
                        </div>
                    </div>

                    <div className="min-h-0 flex-1 space-y-4 overflow-visible p-4 lg:overflow-y-auto">
                        <section>
                            <div className="mb-2 flex items-center gap-2 text-sm font-bold text-slate-800">
                                <Inbox className="h-4 w-4 text-indigo-500" />
                                待回复求助
                            </div>
                            {selectedHelpRequests.length > 0 ? (
                                <div className="space-y-2">
                                    {selectedHelpRequests.map((request) => (
                                        <div key={request.id} className="rounded-xl border border-rose-100 bg-rose-50 p-3">
                                            <p className="text-xs font-bold text-rose-700">{request.studentName} · {request.type}</p>
                                            <p className="mt-1 text-sm text-slate-700">{request.content}</p>
                                            <p className="mt-2 text-[11px] text-slate-400">{formatDateTime(request.createdAt)}</p>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
                                    当前小组暂无待回复求助。后续接入学生端“教师支持”入口后，会在这里显示具体求助线程。
                                </div>
                            )}
                        </section>

                        <section>
                            <div className="mb-2 flex items-center gap-2 text-sm font-bold text-slate-800">
                                <Sparkles className="h-4 w-4 text-indigo-500" />
                                低频支持模板
                            </div>
                            <div className="flex flex-wrap gap-2">
                                {SUPPORT_TEMPLATES.map((template) => (
                                    <button
                                        key={template.type}
                                        type="button"
                                        onClick={() => handleTemplateSelect(template)}
                                        className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${supportType === template.type
                                            ? 'border-indigo-200 bg-indigo-50 text-indigo-700'
                                            : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50'
                                            }`}
                                    >
                                        {template.type}
                                    </button>
                                ))}
                            </div>
                            <textarea
                                value={supportDraft}
                                onChange={(event) => setSupportDraft(event.target.value)}
                                disabled={!selectedProject || supportSending}
                                rows={6}
                                className="mt-3 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
                                placeholder="编辑教师支持内容..."
                            />
                            <Button
                                className="mt-3 w-full gap-2"
                                disabled={!selectedProject || supportSending || !supportDraft.trim()}
                                onClick={handleSendTeacherSupport}
                            >
                                <Send className="h-4 w-4" />
                                {supportSending ? '发送中...' : '发送到小组聊天'}
                            </Button>
                            {supportFeedback ? (
                                <p className={`mt-2 text-xs leading-relaxed ${supportFeedback.includes('失败') ? 'text-rose-600' : 'text-emerald-600'}`}>
                                    {supportFeedback}
                                </p>
                            ) : (
                                <p className="mt-2 text-xs leading-relaxed text-slate-400">
                                    消息会进入该小组群聊，不弹窗、不强制控制，并记录为教师低频支持事件。
                                </p>
                            )}
                        </section>

                        <section>
                            <div className="mb-2 flex items-center gap-2 text-sm font-bold text-slate-800">
                                <Clock3 className="h-4 w-4 text-indigo-500" />
                                教师支持记录
                            </div>
                            {selectedSupportHistory.length > 0 ? (
                                <div className="space-y-2">
                                    {selectedSupportHistory.map((item) => (
                                        <div key={item.id} className="rounded-xl border border-slate-100 bg-slate-50 p-3">
                                            <div className="flex items-center justify-between gap-2">
                                                <span className="text-xs font-bold text-indigo-700">{item.supportType}</span>
                                                <span className="text-[11px] text-slate-400">{formatDateTime(item.createdAt)}</span>
                                            </div>
                                            <p className="mt-2 text-sm leading-relaxed text-slate-600">{item.content}</p>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
                                    暂无本轮教师支持记录。发送后会在这里显示，并同步进入小组群聊。
                                </div>
                            )}
                        </section>
                    </div>
                </aside>
            </div>
        </div>
    );
}

function MiniStat({
    label,
    value,
    tone = 'normal',
}: {
    label: string;
    value: number;
    tone?: 'normal' | 'warning';
}) {
    return (
        <div className={`rounded-xl border px-4 py-2 shadow-sm ${tone === 'warning' ? 'border-amber-100 bg-amber-50' : 'border-slate-100 bg-white'}`}>
            <p className="text-[11px] font-semibold text-slate-500">{label}</p>
            <p className={`text-lg font-black ${tone === 'warning' ? 'text-amber-700' : 'text-slate-900'}`}>{value}</p>
        </div>
    );
}

function Pill({ label }: { label: string }) {
    return (
        <span className="rounded-full bg-slate-100 px-2.5 py-1 font-medium text-slate-600">
            {label}
        </span>
    );
}

function MetricCard({
    icon: Icon,
    label,
    value,
    hint,
}: {
    icon: ComponentType<{ className?: string }>;
    label: string;
    value: number;
    hint: string;
}) {
    return (
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-start justify-between">
                <div>
                    <p className="text-xs font-semibold text-slate-500">{label}</p>
                    <p className="mt-2 text-2xl font-black text-slate-900">{value}</p>
                </div>
                <div className="rounded-xl bg-indigo-50 p-2 text-indigo-600">
                    <Icon className="h-5 w-5" />
                </div>
            </div>
            <p className="mt-2 text-xs text-slate-400">{hint}</p>
        </div>
    );
}

function ObservationItem({
    icon: Icon,
    title,
    content,
}: {
    icon: ComponentType<{ className?: string }>;
    title: string;
    content: string;
}) {
    return (
        <div className="rounded-xl border border-slate-100 bg-slate-50 p-4">
            <div className="flex items-center gap-2">
                <div className="rounded-lg bg-white p-2 text-indigo-600 shadow-sm">
                    <Icon className="h-4 w-4" />
                </div>
                <h4 className="text-sm font-bold text-slate-800">{title}</h4>
            </div>
            <p className="mt-3 text-sm leading-relaxed text-slate-600">{content}</p>
        </div>
    );
}

function EmptyMonitorState() {
    return (
        <div className="flex h-full items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-white p-12 text-center">
            <div>
                <CheckCircle2 className="mx-auto h-12 w-12 text-slate-300" />
                <h3 className="mt-4 text-lg font-bold text-slate-900">暂无可监控小组</h3>
                <p className="mt-2 text-sm text-slate-500">请先在小组管理中创建并绑定班级小组。</p>
            </div>
        </div>
    );
}
