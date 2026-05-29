import { useState, useEffect } from 'react';
import { ArchiveRestore, FolderPlus, Search, Eye, BarChart2, MoreVertical, Users, Clock } from 'lucide-react';
import { Button, Input, Badge, ConfirmDialog } from '../../../ui';
import { useNavigate } from 'react-router-dom';
import { projectService } from '../../../../services/api/project';
import { Project } from '../../../../types';
import ProjectEditModal from './ProjectEditModal';
import { courseService, Course } from '../../../../services/api/course';

export default function ProjectManager() {
    const navigate = useNavigate();
    const [searchQuery, setSearchQuery] = useState('');
    const [filterStatus, setFilterStatus] = useState<'all' | 'active' | 'completed'>('all');
    const [projects, setProjects] = useState<Project[]>([]);
    const [courses, setCourses] = useState<Course[]>([]);
    const [loading, setLoading] = useState(true);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingProject, setEditingProject] = useState<Project | null>(null);
    const [notice, setNotice] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
    const [pendingDeleteProject, setPendingDeleteProject] = useState<Project | null>(null);
    const [deletingProject, setDeletingProject] = useState(false);
    const [pendingUnarchiveProject, setPendingUnarchiveProject] = useState<Project | null>(null);
    const [unarchivingProject, setUnarchivingProject] = useState(false);

    const fetchProjects = async () => {
        try {
            setLoading(true);
            const [projectData, courseData] = await Promise.all([
                projectService.getProjects(),
                courseService.getCourses().catch(() => [] as Course[]),
            ]);
            setProjects(projectData.projects);
            setCourses(courseData);
        } catch (error) {
            console.error('Failed to fetch projects:', error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchProjects();
    }, []);

    const handleCreate = () => {
        setEditingProject(null);
        setIsModalOpen(true);
    };

    const handleEdit = (project: Project) => {
        setEditingProject(project);
        setIsModalOpen(true);
    };

    const confirmDeleteProject = async () => {
        if (!pendingDeleteProject) return;
        try {
            setDeletingProject(true);
            await projectService.deleteProject(pendingDeleteProject.id);
            setPendingDeleteProject(null);
            await fetchProjects();
            setNotice({ type: 'success', message: `小组“${pendingDeleteProject.name}”已删除。` });
        } catch (error) {
            console.error('Delete failed:', error);
            setNotice({ type: 'error', message: '删除失败。该小组可能仍有关联数据或当前账号没有权限。' });
        } finally {
            setDeletingProject(false);
        }
    };

    const confirmUnarchiveProject = async () => {
        if (!pendingUnarchiveProject) return;
        try {
            setUnarchivingProject(true);
            const updated = await projectService.unarchiveProject(pendingUnarchiveProject.id);
            setProjects((currentProjects) =>
                currentProjects.map((project) => project.id === updated.id ? updated : project)
            );
            setPendingUnarchiveProject(null);
            setNotice({ type: 'success', message: `小组“${updated.name}”已撤回归档，学生可继续编辑。` });
        } catch (error) {
            console.error('Unarchive failed:', error);
            setNotice({ type: 'error', message: '撤回归档失败。请确认当前账号是否有该班级的小组管理权限。' });
        } finally {
            setUnarchivingProject(false);
        }
    };

    const filteredProjects = projects.filter(project => {
        const matchesSearch = project.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            (project.description?.toLowerCase().includes(searchQuery.toLowerCase()) ?? false);

        const matchesStatus = filterStatus === 'all' ||
            (filterStatus === 'active' && !project.is_archived) ||
            (filterStatus === 'completed' && project.is_archived);

        return matchesSearch && matchesStatus;
    });
    const courseMap = new Map(courses.map(course => [course.id, course]));
    const groupedProjects = filteredProjects.reduce<Array<{ key: string; title: string; subtitle: string; projects: Project[] }>>((groups, project) => {
        const course = project.course_id ? courseMap.get(project.course_id) : undefined;
        const key = project.course_id || 'unbound';
        let group = groups.find(item => item.key === key);
        if (!group) {
            group = {
                key,
                title: course ? course.name : '未绑定班级',
                subtitle: course ? course.semester : '未指定班级的小组',
                projects: [],
            };
            groups.push(group);
        }
        group.projects.push(project);
        return groups;
    }, []);

    const getStudentMemberCount = (project: Project) => project.members.filter(member => member.user_id !== project.owner_id).length;

    if (loading) {
        return <div className="flex items-center justify-center h-64">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
            <span className="ml-3 text-slate-500">加载小组中...</span>
        </div>;
    }

    return (
        <div className="space-y-6 animate-fadeIn">
            {/* Header */}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h1 className="text-2xl font-semibold text-slate-900">小组管理</h1>
                    <p className="text-sm text-slate-600 mt-1">创建、监控和管理班级中的协作小组空间。</p>
                </div>
                <Button
                    className="w-full gap-2 bg-indigo-600 text-white hover:bg-indigo-700 sm:w-auto"
                    onClick={handleCreate}
                >
                    <FolderPlus className="w-4 h-4" />
                    创建小组
                </Button>
            </div>

            {notice && (
                <div className={`rounded-2xl border px-4 py-3 text-sm font-medium ${notice.type === 'success'
                    ? 'border-emerald-100 bg-emerald-50 text-emerald-700'
                    : 'border-rose-100 bg-rose-50 text-rose-700'
                    }`}>
                    {notice.message}
                </div>
            )}

            {/* Filters */}
            <div className="bg-white rounded-lg border border-gray-200 p-4 shadow-sm">
                <div className="flex flex-col md:flex-row gap-4 justify-between">
                    <div className="relative flex-1 max-w-md">
                        <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                        <Input
                            placeholder="搜索小组名称或描述..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="pl-9"
                        />
                    </div>
                    <div className="flex items-center gap-2">
                        <Button
                            variant={filterStatus === 'all' ? 'default' : 'ghost'}
                            onClick={() => setFilterStatus('all')}
                            size="sm"
                        >
                            全部
                        </Button>
                        <Button
                            variant={filterStatus === 'active' ? 'default' : 'ghost'}
                            onClick={() => setFilterStatus('active')}
                            size="sm"
                        >
                            进行中
                        </Button>
                        <Button
                            variant={filterStatus === 'completed' ? 'default' : 'ghost'}
                            onClick={() => setFilterStatus('completed')}
                            size="sm"
                        >
                            已完成
                        </Button>
                    </div>
                </div>
            </div>

            {/* Projects by Course */}
            <div className="space-y-6">
                {groupedProjects.map((group) => (
                    <section key={group.key} className="rounded-2xl border border-slate-200 bg-white/70 p-4 shadow-sm">
                        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                            <div>
                                <h2 className="text-base font-black text-slate-900">{group.title}</h2>
                                <p className="text-xs font-medium text-slate-400">{group.subtitle} · {group.projects.length} 个小组</p>
                            </div>
                        </div>
                        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                            {group.projects.map((project) => (
                    <div key={project.id} className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm hover:shadow-md transition-shadow">
                        <div className="p-6">
                            <div className="flex justify-between items-start mb-4">
                                <div className="flex-1 min-w-0 pr-4">
                                    <h3 className="font-semibold text-lg text-slate-900 truncate">{project.name}</h3>
                                    <p className="text-xs text-slate-500 mt-1">ID: {project.id}</p>
                                </div>
                                <Badge
                                    variant="outline"
                                    className={
                                        !project.is_archived ? 'bg-green-50 text-green-700 border-green-200' :
                                            'bg-slate-50 text-slate-700 border-slate-200'
                                    }
                                >
                                    {!project.is_archived ? '进行中' : '已归档'}
                                </Badge>
                            </div>

                            <p className="text-sm text-slate-600 mb-4 line-clamp-2 h-10">
                                {project.description || '暂无小组描述。'}
                            </p>

                            <div className="flex items-center gap-4 text-sm text-slate-500 mb-6">
                                <div className="flex items-center gap-1.5">
                                    <Users className="w-4 h-4" />
                                    <span>{getStudentMemberCount(project)} 名学生</span>
                                </div>
                                <div className="flex items-center gap-1.5">
                                    <Clock className="w-4 h-4" />
                                    <span className="text-xs">{new Date(project.updated_at).toLocaleDateString()}</span>
                                </div>
                            </div>

                            <div className="flex items-center gap-2 pt-4 border-t border-gray-100">
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="flex-1 gap-1.5"
                                    onClick={() => navigate(`/project/${project.id}`)}
                                >
                                    <Eye className="w-4 h-4" />
                                    监控
                                </Button>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="flex-1 gap-1.5"
                                    onClick={() => navigate(`/teacher/project-dashboard?project=${project.id}`)}
                                >
                                    <BarChart2 className="w-4 h-4" />
                                    仪表盘
                                </Button>
                                <div className="relative group/menu">
                                    <Button variant="ghost" size="sm" className="px-2">
                                        <MoreVertical className="w-4 h-4" />
                                    </Button>
                                    <div className="absolute right-0 bottom-full mb-2 w-32 bg-white rounded-lg border border-gray-200 shadow-xl opacity-0 invisible group-hover/menu:opacity-100 group-hover/menu:visible transition-all z-10 overflow-hidden">
                                        <button
                                            onClick={() => handleEdit(project)}
                                            className="w-full px-4 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 transition-colors"
                                        >
                                            修改小组
                                        </button>
                                        {project.is_archived && (
                                            <button
                                                onClick={() => setPendingUnarchiveProject(project)}
                                                className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-emerald-700 hover:bg-emerald-50 transition-colors"
                                            >
                                                <ArchiveRestore className="h-4 w-4" />
                                                撤回归档
                                            </button>
                                        )}
                                        <button
                                            onClick={() => setPendingDeleteProject(project)}
                                            className="w-full px-4 py-2 text-left text-sm text-red-600 hover:bg-red-50 transition-colors"
                                        >
                                            删除小组
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                            ))}
                        </div>
                    </section>
                ))}

                {filteredProjects.length === 0 && (
                    <div className="py-20 bg-white rounded-xl border-2 border-dashed border-gray-100 flex flex-col items-center justify-center text-slate-500">
                        <FolderPlus className="w-12 h-12 mb-4 opacity-20" />
                        <p className="text-lg">暂无符合条件的小组</p>
                    </div>
                )}
            </div>

            <ProjectEditModal
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                project={editingProject}
                onSuccess={fetchProjects}
            />

            <ConfirmDialog
                open={!!pendingDeleteProject}
                onOpenChange={(open) => !open && setPendingDeleteProject(null)}
                title="删除小组空间"
                description={`确定要删除小组“${pendingDeleteProject?.name || ''}”吗？此操作会影响该小组的文档、聊天、资源、探究空间和研究数据组织关系，建议仅用于清理测试小组。`}
                confirmLabel="确认删除"
                tone="danger"
                loading={deletingProject}
                onConfirm={confirmDeleteProject}
            />

            <ConfirmDialog
                open={!!pendingUnarchiveProject}
                onOpenChange={(open) => !open && setPendingUnarchiveProject(null)}
                title="撤回小组归档"
                description={`确定要撤回小组“${pendingUnarchiveProject?.name || ''}”的归档状态吗？撤回后该小组会恢复为进行中，学生可以继续编辑小组内容。`}
                confirmLabel="确认撤回"
                loading={unarchivingProject}
                onConfirm={confirmUnarchiveProject}
            />
        </div>
    );
}
