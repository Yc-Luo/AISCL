import { useState, useEffect } from 'react';
import { FolderPlus, Search, Eye, BarChart2, MoreVertical, Users, Clock } from 'lucide-react';
import { Button, Input, Badge } from '../../../ui';
import { useNavigate } from 'react-router-dom';
import { projectService } from '../../../../services/api/project';
import { Project } from '../../../../types';
import ProjectEditModal from './ProjectEditModal';

export default function ProjectManager() {
    const navigate = useNavigate();
    const [searchQuery, setSearchQuery] = useState('');
    const [filterStatus, setFilterStatus] = useState<'all' | 'active' | 'completed'>('all');
    const [projects, setProjects] = useState<Project[]>([]);
    const [loading, setLoading] = useState(true);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingProject, setEditingProject] = useState<Project | null>(null);

    const fetchProjects = async () => {
        try {
            setLoading(true);
            const data = await projectService.getProjects();
            setProjects(data.projects);
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

    const handleDelete = async (id: string) => {
        if (!confirm('确定要删除这个小组空间吗？所有数据都将被清除。')) return;
        try {
            await projectService.deleteProject(id);
            fetchProjects();
        } catch (error) {
            console.error('Delete failed:', error);
            alert('删除失败');
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

    if (loading) {
        return <div className="flex items-center justify-center h-64">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
            <span className="ml-3 text-slate-500">加载小组中...</span>
        </div>;
    }

    return (
        <div className="space-y-6 animate-fadeIn">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-semibold text-slate-900">小组管理</h1>
                    <p className="text-sm text-slate-600 mt-1">创建、监控和管理班级中的协作小组空间。</p>
                </div>
                <Button
                    className="bg-indigo-600 hover:bg-indigo-700 text-white gap-2"
                    onClick={handleCreate}
                >
                    <FolderPlus className="w-4 h-4" />
                    创建小组
                </Button>
            </div>

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

            {/* Projects Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {filteredProjects.map((project) => (
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
                                    <span>{project.members.length} 名成员</span>
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
                                        <button
                                            onClick={() => handleDelete(project.id)}
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

                {filteredProjects.length === 0 && (
                    <div className="col-span-full py-20 bg-white rounded-xl border-2 border-dashed border-gray-100 flex flex-col items-center justify-center text-slate-500">
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
        </div>
    );
}
