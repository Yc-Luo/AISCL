import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Users,
    UserPlus,
    Search,
    Trash2,
    Calendar,
    BookOpen,
    GraduationCap,
    Copy,
    Settings,
    Check
} from 'lucide-react';
import {
    Button,
    Input,
    Badge,
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter
} from '../../../ui';
import { courseService, Course } from '../../../../services/api/course';

type TemplateSelectOption = {
    value: string;
    label: string;
    source?: string;
};

const EMPTY_TEMPLATE_OPTION: TemplateSelectOption = { value: '', label: '不预设模板（仅建班）' };

const FALLBACK_EXPERIMENT_TEMPLATE_OPTIONS: TemplateSelectOption[] = [
    { value: '', label: '不预设模板（仅建班）' },
    { value: 'exp-single-process-v1', label: '单AI + 过程支架' },
    { value: 'exp-multi-process-v1', label: '多智能体 + 过程支架' },
    { value: 'exp-single-process-off-v1', label: '单AI + 无过程支架' },
    { value: 'exp-multi-process-off-v1', label: '多智能体 + 无过程支架' },
];

const DEFAULT_TASK_TITLE = '项目说明';

type TaskTemplateSections = {
    background: string;
    coreQuestions: string;
    collaborationRequirements: string;
    deliverables: string;
    evaluationCriteria: string;
};

const DEFAULT_TASK_TEMPLATE_SECTIONS: TaskTemplateSections = {
    background: '请简要说明本次开放性任务的主题情境、学习目标与基本问题。',
    coreQuestions: '1. 本组需要围绕哪些关键问题展开探究与讨论？\n2. 需要回答或解决的核心挑战是什么？',
    collaborationRequirements: '1. 请结合小组讨论、资料检索、证据比较与观点协商推进任务。\n2. 在形成结论前，请说明证据来源，并对不同观点进行比较或回应。',
    deliverables: '请明确本组最终需要提交的成果形式，例如：研究报告、方案设计、论证说明、展示文稿或其他作品。',
    evaluationCriteria: '请结合任务要求说明评价关注点，例如：问题理解是否准确、证据是否充分、论证是否清晰、协作过程是否完整、成果是否具有说服力。',
};

const composeTaskTemplate = (sections: TaskTemplateSections): string => `一、任务背景
${sections.background.trim()}

二、核心问题
${sections.coreQuestions.trim()}

三、协作要求
${sections.collaborationRequirements.trim()}

四、提交成果
${sections.deliverables.trim()}

五、评价要点
${sections.evaluationCriteria.trim()}`;

const parseTaskTemplate = (content?: string | null): TaskTemplateSections => {
    if (!content?.trim()) return { ...DEFAULT_TASK_TEMPLATE_SECTIONS };

    const extract = (startLabel: string, endLabel?: string) => {
        const start = content.indexOf(startLabel);
        if (start === -1) return '';
        const from = start + startLabel.length;
        const end = endLabel ? content.indexOf(endLabel, from) : -1;
        const raw = end === -1 ? content.slice(from) : content.slice(from, end);
        return raw.trim();
    };

    const parsed: TaskTemplateSections = {
        background: extract('一、任务背景', '二、核心问题'),
        coreQuestions: extract('二、核心问题', '三、协作要求'),
        collaborationRequirements: extract('三、协作要求', '四、提交成果'),
        deliverables: extract('四、提交成果', '五、评价要点'),
        evaluationCriteria: extract('五、评价要点'),
    };

    return {
        background: parsed.background || DEFAULT_TASK_TEMPLATE_SECTIONS.background,
        coreQuestions: parsed.coreQuestions || DEFAULT_TASK_TEMPLATE_SECTIONS.coreQuestions,
        collaborationRequirements: parsed.collaborationRequirements || DEFAULT_TASK_TEMPLATE_SECTIONS.collaborationRequirements,
        deliverables: parsed.deliverables || DEFAULT_TASK_TEMPLATE_SECTIONS.deliverables,
        evaluationCriteria: parsed.evaluationCriteria || DEFAULT_TASK_TEMPLATE_SECTIONS.evaluationCriteria,
    };
};

export default function ClassManagement() {
    const navigate = useNavigate();
    const [searchQuery, setSearchQuery] = useState('');
    const [courses, setCourses] = useState<Course[]>([]);
    const [loading, setLoading] = useState(true);
    const [isCreateOpen, setIsCreateOpen] = useState(false);
    const [isEditOpen, setIsEditOpen] = useState(false);
    const [selectedCourse, setSelectedCourse] = useState<Course | null>(null);
    const [copiedId, setCopiedId] = useState<string | null>(null);
    const [experimentTemplateOptions, setExperimentTemplateOptions] = useState<TemplateSelectOption[]>(FALLBACK_EXPERIMENT_TEMPLATE_OPTIONS);

    // Form states
    const [name, setName] = useState('');
    const [semester, setSemester] = useState('2026 春季');
    const [description, setDescription] = useState('');
    const [experimentTemplateKey, setExperimentTemplateKey] = useState('');
    const [initialTaskTitle, setInitialTaskTitle] = useState(DEFAULT_TASK_TITLE);
    const [taskTemplate, setTaskTemplate] = useState<TaskTemplateSections>({ ...DEFAULT_TASK_TEMPLATE_SECTIONS });
    const [submitting, setSubmitting] = useState(false);

    const fetchCourses = async () => {
        try {
            setLoading(true);
            const data = await courseService.getCourses();
            setCourses(data);
        } catch (error) {
            console.error('Failed to fetch courses:', error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchCourses();
    }, []);

    useEffect(() => {
        let cancelled = false;
        const fetchExperimentTemplates = async () => {
            try {
                const templates = await courseService.getExperimentTemplates();
                if (cancelled) return;

                if (templates.length === 0) {
                    setExperimentTemplateOptions(FALLBACK_EXPERIMENT_TEMPLATE_OPTIONS);
                    return;
                }

                const dynamicOptions = templates.map((template) => ({
                    value: template.key,
                    label: template.label || template.key,
                    source: template.source,
                }));
                setExperimentTemplateOptions([
                    EMPTY_TEMPLATE_OPTION,
                    ...dynamicOptions,
                ]);
            } catch (error) {
                console.error('Failed to fetch experiment templates:', error);
                if (!cancelled) {
                    setExperimentTemplateOptions(FALLBACK_EXPERIMENT_TEMPLATE_OPTIONS);
                }
            }
        };

        void fetchExperimentTemplates();
        return () => {
            cancelled = true;
        };
    }, []);

    const handleCopyCode = (code: string, id: string) => {
        navigator.clipboard.writeText(code);
        setCopiedId(id);
        setTimeout(() => setCopiedId(null), 2000);
    };

    const handleCreate = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            setSubmitting(true);
            await courseService.createCourse({
                name,
                semester,
                description,
                experiment_template_key: experimentTemplateKey || undefined,
                initial_task_document_title: initialTaskTitle || undefined,
                initial_task_document_content: composeTaskTemplate(taskTemplate),
            });
            setIsCreateOpen(false);
            resetForm();
            fetchCourses();
        } catch (error) {
            console.error('Create course failed:', error);
            alert('创建失败，请稍后重试');
        } finally {
            setSubmitting(false);
        }
    };

    const handleUpdate = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedCourse) return;
        try {
            setSubmitting(true);
            await courseService.updateCourse(selectedCourse.id, {
                name,
                description,
                experiment_template_key: experimentTemplateKey || undefined,
                initial_task_document_title: initialTaskTitle || undefined,
                initial_task_document_content: composeTaskTemplate(taskTemplate),
            });
            setIsEditOpen(false);
            resetForm();
            fetchCourses();
        } catch (error) {
            console.error('Update course failed:', error);
            alert('更新失败，请稍后重试');
        } finally {
            setSubmitting(false);
        }
    };

    const handleDelete = async (id: string, name: string) => {
        if (window.confirm(`确定要删除班级 "${name}" 吗？此操作不可撤销。`)) {
            try {
                await courseService.deleteCourse(id);
                fetchCourses();
            } catch (error) {
                console.error('Delete course failed:', error);
                alert('删除失败，该班级可能仍有关联数据');
            }
        }
    };

    const resetForm = () => {
        setName('');
        setSemester('2026 春季');
        setDescription('');
        setExperimentTemplateKey('');
        setInitialTaskTitle(DEFAULT_TASK_TITLE);
        setTaskTemplate({ ...DEFAULT_TASK_TEMPLATE_SECTIONS });
        setSelectedCourse(null);
    };

    const openEdit = (course: Course) => {
        setSelectedCourse(course);
        setName(course.name);
        setSemester(course.semester);
        setDescription(course.description || '');
        setExperimentTemplateKey(course.experiment_template_key || '');
        setInitialTaskTitle(course.initial_task_document_title || DEFAULT_TASK_TITLE);
        setTaskTemplate(parseTaskTemplate(course.initial_task_document_content));
        setIsEditOpen(true);
    };

    const updateTaskTemplate = (key: keyof TaskTemplateSections, value: string) => {
        setTaskTemplate(prev => ({ ...prev, [key]: value }));
    };

    const filteredCourses = courses.filter(course =>
        course.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        course.semester.toLowerCase().includes(searchQuery.toLowerCase())
    );

    const selectableTemplateOptions = experimentTemplateKey
        && !experimentTemplateOptions.some((option) => option.value === experimentTemplateKey)
        ? [
            ...experimentTemplateOptions,
            { value: experimentTemplateKey, label: `${experimentTemplateKey}（当前已绑定）` },
        ]
        : experimentTemplateOptions;

    if (loading && courses.length === 0) {
        return <div className="flex items-center justify-center h-64">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
            <span className="ml-3 text-slate-500 font-medium">加载班级中...</span>
        </div>;
    }

    return (
        <div className="space-y-6 animate-fadeIn pb-10">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-slate-900 tracking-tight">班级管理</h1>
                    <p className="text-sm text-slate-500 mt-1">创建和维护您的教学班级，学生通过邀请码加入协作空间。</p>
                </div>
                <Button
                    onClick={() => { resetForm(); setIsCreateOpen(true); }}
                    className="bg-indigo-600 hover:bg-indigo-700 text-white gap-2 shadow-md shadow-indigo-100 rounded-xl px-5"
                >
                    <UserPlus className="w-4 h-4" />
                    创建新班级
                </Button>
            </div>

            {/* Stats Row */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="bg-white rounded-2xl border border-slate-100 p-6 shadow-sm">
                    <div className="flex items-center gap-4">
                        <div className="w-12 h-12 bg-indigo-50 rounded-2xl flex items-center justify-center">
                            <BookOpen className="w-6 h-6 text-indigo-600" />
                        </div>
                        <div>
                            <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">总班级数</p>
                            <p className="text-2xl font-bold text-slate-900">{courses.length}</p>
                        </div>
                    </div>
                </div>
                <div className="bg-white rounded-2xl border border-slate-100 p-6 shadow-sm">
                    <div className="flex items-center gap-4">
                        <div className="w-12 h-12 bg-emerald-50 rounded-2xl flex items-center justify-center">
                            <GraduationCap className="w-6 h-6 text-emerald-600" />
                        </div>
                        <div>
                            <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">学生总数</p>
                            <p className="text-2xl font-bold text-slate-900">
                                {courses.reduce((acc, c) => acc + (c.students?.length || 0), 0)}
                            </p>
                        </div>
                    </div>
                </div>
                <div className="bg-white rounded-2xl border border-slate-100 p-6 shadow-sm">
                    <div className="flex items-center gap-4">
                        <div className="w-12 h-12 bg-amber-50 rounded-2xl flex items-center justify-center">
                            <Calendar className="w-6 h-6 text-amber-600" />
                        </div>
                        <div>
                            <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">当前学期</p>
                            <p className="text-2xl font-bold text-slate-900">2026 春季</p>
                        </div>
                    </div>
                </div>
            </div>

            {/* Actions Bar */}
            <div className="bg-white rounded-2xl border border-slate-100 p-4 shadow-sm flex items-center gap-4">
                <div className="relative flex-1">
                    <label htmlFor="course-search" className="sr-only">搜索班级或学期</label>
                    <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <Input
                        id="course-search"
                        placeholder="搜索班级名称或学期..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="pl-9 bg-slate-50 border-none focus:bg-white focus:ring-2 focus:ring-indigo-500 transition-all rounded-xl"
                    />
                </div>
            </div>

            {/* Table */}
            <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden shadow-sm">
                <div className="overflow-x-auto">
                    <table className="w-full text-left">
                        <thead className="bg-slate-50/50">
                            <tr>
                                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-widest">班级信息</th>
                                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-widest">学期</th>
                                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-widest">人数</th>
                                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-widest">邀请码</th>
                                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-widest text-right">操作</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {filteredCourses.length > 0 ? filteredCourses.map((course) => (
                                <tr key={course.id} className="hover:bg-slate-50/50 transition-colors group">
                                    <td className="px-6 py-5">
                                        <div className="flex items-center gap-4">
                                            <div className="w-12 h-12 bg-white border border-slate-100 rounded-xl flex items-center justify-center shadow-sm group-hover:scale-110 transition-transform">
                                                <Users className="w-6 h-6 text-indigo-600" />
                                            </div>
                                            <div>
                                                <p className="font-bold text-slate-900">{course.name}</p>
                                                <p className="text-xs text-slate-400 mt-0.5">{course.description || '暂无描述'}</p>
                                            </div>
                                        </div>
                                    </td>
                                    <td className="px-6 py-5">
                                        <Badge variant="secondary" className="bg-slate-100 text-slate-600 border-none">
                                            {course.semester}
                                        </Badge>
                                    </td>
                                    <td className="px-6 py-5">
                                        <button
                                            onClick={() => navigate(`/teacher/student-list?courseId=${course.id}`)}
                                            className="font-bold text-indigo-600 hover:text-indigo-700 underline underline-offset-4"
                                        >
                                            {course.students?.length || 0} 名学生
                                        </button>
                                    </td>
                                    <td className="px-6 py-5">
                                        <div className="flex items-center gap-2">
                                            <code className="bg-indigo-50 px-3 py-1.5 rounded-lg text-indigo-700 font-mono text-sm font-bold tracking-tight">
                                                {course.invite_code}
                                            </code>
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                className="h-8 w-8 p-0 hover:bg-white hover:shadow-sm"
                                                onClick={() => handleCopyCode(course.invite_code, course.id)}
                                            >
                                                {copiedId === course.id ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4 text-slate-400" />}
                                            </Button>
                                        </div>
                                    </td>
                                    <td className="px-6 py-5 text-right">
                                        <div className="flex justify-end gap-2 opacity-100">
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                className="text-slate-400 hover:text-indigo-600"
                                                title="编辑班级信息"
                                                aria-label={`编辑班级 ${course.name}`}
                                                onClick={() => openEdit(course)}
                                            >
                                                <Settings className="w-5 h-5" />
                                            </Button>
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                className="text-slate-400 hover:text-red-600"
                                                title="删除班级"
                                                aria-label={`删除班级 ${course.name}`}
                                                onClick={() => handleDelete(course.id, course.name)}
                                            >
                                                <Trash2 className="w-5 h-5" />
                                            </Button>
                                        </div>
                                    </td>
                                </tr>
                            )) : (
                                <tr>
                                    <td colSpan={5} className="px-6 py-20 text-center">
                                        <div className="flex flex-col items-center">
                                            <div className="w-20 h-20 bg-slate-50 rounded-full flex items-center justify-center mb-4">
                                                <Search className="w-10 h-10 text-slate-300" />
                                            </div>
                                            <p className="text-slate-500 font-medium">未找到相关班级数据</p>
                                            <Button variant="link" className="text-indigo-600 mt-2" onClick={() => { setSearchQuery(''); fetchCourses(); }}>刷新列表</Button>
                                        </div>
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Create Modal */}
            <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
                <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto custom-scrollbar rounded-3xl p-8">
                        <DialogHeader>
                            <DialogTitle className="text-2xl font-bold">创建新班级</DialogTitle>
                            <DialogDescription className="text-slate-500 mt-2">
                            班级创建后，您将获得唯一的邀请码，学生凭此加入系统。这里填写的项目说明会自动同步到学生端的小组文档页面。
                            </DialogDescription>
                        </DialogHeader>
                    <form onSubmit={handleCreate} className="space-y-6 mt-6">
                        <div className="space-y-2">
                            <label htmlFor="create-course-name" className="text-sm font-bold text-slate-800">班级名称</label>
                            <Input
                                id="create-course-name"
                                required
                                value={name}
                                onChange={e => setName(e.target.value)}
                                placeholder="例如：2026级软件工程1班"
                                className="rounded-xl bg-slate-50 border-none"
                            />
                        </div>
                        <div className="space-y-2">
                            <label htmlFor="create-course-semester" className="text-sm font-bold text-slate-800">所属学期</label>
                            <select
                                id="create-course-semester"
                                value={semester}
                                onChange={e => setSemester(e.target.value)}
                                className="w-full px-3 py-2 bg-slate-50 border-none rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                            >
                                <option>2026 春季</option>
                                <option>2025 秋季</option>
                                <option>2025 春季</option>
                                <option>2024 秋季</option>
                            </select>
                        </div>
                        <div className="space-y-2">
                            <label htmlFor="create-course-description" className="text-sm font-bold text-slate-800">描述（可选）</label>
                            <textarea
                                id="create-course-description"
                                value={description}
                                onChange={e => setDescription(e.target.value)}
                                className="w-full px-3 py-2 bg-slate-50 border-none rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 outline-none h-24"
                                placeholder="班级简介或备注信息..."
                            />
                        </div>
                        <div className="space-y-2">
                            <label htmlFor="create-course-template" className="text-sm font-bold text-slate-800">班级默认实验模板</label>
                            <select
                                id="create-course-template"
                                value={experimentTemplateKey}
                                onChange={e => setExperimentTemplateKey(e.target.value)}
                                className="w-full px-3 py-2 bg-slate-50 border-none rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                            >
                                {selectableTemplateOptions.map((option) => (
                                    <option key={option.value} value={option.value}>{option.label}</option>
                                ))}
                            </select>
                        </div>
                        <div className="space-y-2">
                            <label htmlFor="create-task-title" className="text-sm font-bold text-slate-800">项目说明标题</label>
                            <Input
                                id="create-task-title"
                                value={initialTaskTitle}
                                onChange={e => setInitialTaskTitle(e.target.value)}
                                placeholder={`例如：${DEFAULT_TASK_TITLE}`}
                                className="rounded-xl bg-slate-50 border-none"
                            />
                        </div>
                        <div className="space-y-4">
                            <div>
                                <label htmlFor="create-task-background" className="text-sm font-bold text-slate-800">任务背景</label>
                                <textarea
                                    id="create-task-background"
                                    value={taskTemplate.background}
                                    onChange={e => updateTaskTemplate('background', e.target.value)}
                                    className="mt-2 w-full px-3 py-2 bg-slate-50 border-none rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 outline-none h-24"
                                    placeholder="说明本次任务的主题情境、学习目标与基本问题。"
                                />
                            </div>
                            <div>
                                <label htmlFor="create-task-core" className="text-sm font-bold text-slate-800">核心问题</label>
                                <textarea
                                    id="create-task-core"
                                    value={taskTemplate.coreQuestions}
                                    onChange={e => updateTaskTemplate('coreQuestions', e.target.value)}
                                    className="mt-2 w-full px-3 py-2 bg-slate-50 border-none rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 outline-none h-24"
                                    placeholder="列出本组需要重点解决或回应的开放性问题。"
                                />
                            </div>
                            <div>
                                <label htmlFor="create-task-collaboration" className="text-sm font-bold text-slate-800">协作要求</label>
                                <textarea
                                    id="create-task-collaboration"
                                    value={taskTemplate.collaborationRequirements}
                                    onChange={e => updateTaskTemplate('collaborationRequirements', e.target.value)}
                                    className="mt-2 w-full px-3 py-2 bg-slate-50 border-none rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 outline-none h-24"
                                    placeholder="说明小组如何组织讨论、资料检索、证据比较与观点协商。"
                                />
                            </div>
                            <div>
                                <label htmlFor="create-task-deliverables" className="text-sm font-bold text-slate-800">提交成果</label>
                                <textarea
                                    id="create-task-deliverables"
                                    value={taskTemplate.deliverables}
                                    onChange={e => updateTaskTemplate('deliverables', e.target.value)}
                                    className="mt-2 w-full px-3 py-2 bg-slate-50 border-none rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 outline-none h-24"
                                    placeholder="说明本组需要提交的成果形式和最低完成要求。"
                                />
                            </div>
                            <div>
                                <label htmlFor="create-task-evaluation" className="text-sm font-bold text-slate-800">评价要点</label>
                                <textarea
                                    id="create-task-evaluation"
                                    value={taskTemplate.evaluationCriteria}
                                    onChange={e => updateTaskTemplate('evaluationCriteria', e.target.value)}
                                    className="mt-2 w-full px-3 py-2 bg-slate-50 border-none rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 outline-none h-24"
                                    placeholder="说明教师或小组自评时关注的核心评价标准。"
                                />
                            </div>
                            <p className="text-xs leading-5 text-slate-500">
                                这些内容会自动组合成学生端小组文档中的“项目说明”页面，作为进入任务前的前置支架。
                            </p>
                        </div>
                        <DialogFooter className="pt-4">
                            <Button type="button" variant="ghost" onClick={() => setIsCreateOpen(false)} className="rounded-xl">取消</Button>
                            <Button type="submit" disabled={submitting} className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl px-8 shadow-lg shadow-indigo-100">
                                {submitting ? '创建中...' : '确认创建'}
                            </Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>

            {/* Edit Modal */}
            <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
                <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto custom-scrollbar rounded-3xl p-8">
                        <DialogHeader>
                            <DialogTitle className="text-2xl font-bold">修改班级信息</DialogTitle>
                            <DialogDescription className="text-slate-500 mt-2">
                            更新班级名称、实验模板以及项目说明内容。项目说明会作为学生端小组文档中的任务导入页。
                            </DialogDescription>
                        </DialogHeader>
                    <form onSubmit={handleUpdate} className="space-y-6 mt-6">
                        <div className="space-y-2">
                            <label htmlFor="edit-course-name" className="text-sm font-bold text-slate-800">班级名称</label>
                            <Input
                                id="edit-course-name"
                                required
                                value={name}
                                onChange={e => setName(e.target.value)}
                                className="rounded-xl bg-slate-50 border-none"
                            />
                        </div>
                        <div className="space-y-2">
                            <label htmlFor="edit-course-description" className="text-sm font-bold text-slate-800">描述</label>
                            <textarea
                                id="edit-course-description"
                                value={description}
                                onChange={e => setDescription(e.target.value)}
                                className="w-full px-3 py-2 bg-slate-50 border-none rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 outline-none h-24"
                            />
                        </div>
                        <div className="space-y-2">
                            <label htmlFor="edit-course-template" className="text-sm font-bold text-slate-800">班级默认实验模板</label>
                            <select
                                id="edit-course-template"
                                value={experimentTemplateKey}
                                onChange={e => setExperimentTemplateKey(e.target.value)}
                                className="w-full px-3 py-2 bg-slate-50 border-none rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                            >
                                {selectableTemplateOptions.map((option) => (
                                    <option key={option.value} value={option.value}>{option.label}</option>
                                ))}
                            </select>
                        </div>
                        <div className="space-y-2">
                            <label htmlFor="edit-task-title" className="text-sm font-bold text-slate-800">项目说明标题</label>
                            <Input
                                id="edit-task-title"
                                value={initialTaskTitle}
                                onChange={e => setInitialTaskTitle(e.target.value)}
                                placeholder={`例如：${DEFAULT_TASK_TITLE}`}
                                className="rounded-xl bg-slate-50 border-none"
                            />
                        </div>
                        <div className="space-y-4">
                            <div>
                                <label htmlFor="edit-task-background" className="text-sm font-bold text-slate-800">任务背景</label>
                                <textarea
                                    id="edit-task-background"
                                    value={taskTemplate.background}
                                    onChange={e => updateTaskTemplate('background', e.target.value)}
                                    className="mt-2 w-full px-3 py-2 bg-slate-50 border-none rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 outline-none h-24"
                                />
                            </div>
                            <div>
                                <label htmlFor="edit-task-core" className="text-sm font-bold text-slate-800">核心问题</label>
                                <textarea
                                    id="edit-task-core"
                                    value={taskTemplate.coreQuestions}
                                    onChange={e => updateTaskTemplate('coreQuestions', e.target.value)}
                                    className="mt-2 w-full px-3 py-2 bg-slate-50 border-none rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 outline-none h-24"
                                />
                            </div>
                            <div>
                                <label htmlFor="edit-task-collaboration" className="text-sm font-bold text-slate-800">协作要求</label>
                                <textarea
                                    id="edit-task-collaboration"
                                    value={taskTemplate.collaborationRequirements}
                                    onChange={e => updateTaskTemplate('collaborationRequirements', e.target.value)}
                                    className="mt-2 w-full px-3 py-2 bg-slate-50 border-none rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 outline-none h-24"
                                />
                            </div>
                            <div>
                                <label htmlFor="edit-task-deliverables" className="text-sm font-bold text-slate-800">提交成果</label>
                                <textarea
                                    id="edit-task-deliverables"
                                    value={taskTemplate.deliverables}
                                    onChange={e => updateTaskTemplate('deliverables', e.target.value)}
                                    className="mt-2 w-full px-3 py-2 bg-slate-50 border-none rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 outline-none h-24"
                                />
                            </div>
                            <div>
                                <label htmlFor="edit-task-evaluation" className="text-sm font-bold text-slate-800">评价要点</label>
                                <textarea
                                    id="edit-task-evaluation"
                                    value={taskTemplate.evaluationCriteria}
                                    onChange={e => updateTaskTemplate('evaluationCriteria', e.target.value)}
                                    className="mt-2 w-full px-3 py-2 bg-slate-50 border-none rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 outline-none h-24"
                                />
                            </div>
                            <p className="text-xs leading-5 text-slate-500">
                                这些内容会自动组合成学生端小组文档中的“项目说明”页面。
                            </p>
                        </div>
                        <DialogFooter className="pt-4">
                            <Button type="button" variant="ghost" onClick={() => setIsEditOpen(false)} className="rounded-xl">取消</Button>
                            <Button type="submit" disabled={submitting} className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl px-8 shadow-lg shadow-indigo-100">
                                {submitting ? '保存修改' : '确认修改'}
                            </Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>
        </div>
    );
}
