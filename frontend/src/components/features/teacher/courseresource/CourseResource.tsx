import { useState, useEffect } from 'react';
import {
    FileText,
    Download,
    Trash2,
    HardDrive,
    Upload,
    Plus,
    Loader2
} from 'lucide-react';
import { projectService } from '../../../../services/api/project';
import { storageService } from '../../../../services/api/storage';
import { Resource, Project } from '../../../../types';
import {
    Button,
    Badge,
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter
} from '../../../ui';

interface ResourceWithProject extends Resource {
    projectName: string;
    projectId: string;
}

export default function CourseResource() {
    const [resources, setResources] = useState<ResourceWithProject[]>([]);
    const [projects, setProjects] = useState<Project[]>([]);
    const [loading, setLoading] = useState(true);

    const [isUploadOpen, setIsUploadOpen] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [selectedProjectId, setSelectedProjectId] = useState<string>('');
    const [selectedFile, setSelectedFile] = useState<File | null>(null);

    const fetchAllData = async () => {
        try {
            setLoading(true);
            const projectsData = await projectService.getProjects();
            const activeProjects = projectsData.projects.filter(p => !p.is_archived);
            setProjects(activeProjects);
            if (activeProjects.length > 0 && !selectedProjectId) {
                setSelectedProjectId(activeProjects[0].id);
            }

            const allResources: ResourceWithProject[] = [];

            await Promise.all(activeProjects.map(async (project) => {
                try {
                    const resData = await storageService.getResources(project.id);
                    resData.resources.forEach(r => {
                        allResources.push({
                            ...r,
                            projectName: project.name,
                            projectId: project.id
                        });
                    });
                } catch (err) {
                    console.error(`Failed to fetch resources for project ${project.id}`, err);
                }
            }));

            // Sort by uploaded_at descending
            allResources.sort((a, b) => new Date(b.uploaded_at).getTime() - new Date(a.uploaded_at).getTime());
            setResources(allResources);
        } catch (error) {
            console.error('Failed to fetch resources:', error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchAllData();
    }, []);

    const handleFileUpload = async () => {
        if (!selectedFile || !selectedProjectId) return;

        setUploading(true);
        try {
            // 1. Get presigned URL
            const { upload_url, file_key } = await storageService.getPresignedUploadUrl(
                selectedProjectId,
                selectedFile.name,
                selectedFile.type,
                selectedFile.size
            );

            // 2. Upload to S3/MinIO
            await storageService.uploadFile(upload_url, selectedFile);

            // 3. Create Resource record
            await storageService.createResource({
                project_id: selectedProjectId,
                filename: selectedFile.name,
                file_key: file_key,
                size: selectedFile.size,
                mime_type: selectedFile.type
            });

            setIsUploadOpen(false);
            setSelectedFile(null);
            fetchAllData();
        } catch (error) {
            console.error('Upload failed:', error);
            alert('上传失败，请检查网络连接或小组设置');
        } finally {
            setUploading(false);
        }
    };

    const handleDeleteResource = async (projectId: string, resourceId: string) => {
        if (!confirm('确定要删除此资源吗？')) return;
        try {
            await storageService.deleteResource(projectId, resourceId);
            setResources(prev => prev.filter(r => r.id !== resourceId));
        } catch (error) {
            console.error('Delete failed:', error);
        }
    };

    const formatSize = (bytes: number) => {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };

    if (loading) {
        return <div className="flex items-center justify-center h-64">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
            <span className="ml-3 text-slate-500">加载资源中心...</span>
        </div>;
    }

    return (
        <div className="space-y-8 animate-fadeIn">
            <div className="flex justify-between items-end bg-white p-8 rounded-3xl border border-gray-100 shadow-sm">
                <div>
                    <h2 className="text-3xl font-bold text-gray-900 tracking-tight">课程资源中心</h2>
                    <p className="text-gray-500 mt-2 font-medium">统一管理全课程探究资料、工具手册与学生产出</p>
                </div>
                <div className="flex items-center gap-4">
                    <div className="bg-blue-50 px-4 py-2 rounded-xl border border-blue-100 flex items-center gap-3">
                        <HardDrive className="text-blue-600 w-5 h-5" />
                        <span className="text-blue-900 font-bold">文件总数: {resources.length}</span>
                    </div>
                    <Button
                        onClick={() => setIsUploadOpen(true)}
                        className="bg-indigo-600 hover:bg-indigo-700 shadow-lg shadow-indigo-100 gap-2"
                    >
                        <Plus className="w-4 h-4" /> 上传资源
                    </Button>
                </div>
            </div>

            {resources.length > 0 ? (
                <div className="bg-white rounded-3xl border border-gray-100 overflow-hidden shadow-sm">
                    <table className="w-full min-w-full">
                        <thead className="bg-gray-50/50">
                            <tr>
                                <th className="px-6 py-4 text-left text-xs font-bold text-gray-500 uppercase tracking-widest">文件名</th>
                                <th className="px-6 py-4 text-left text-xs font-bold text-gray-500 uppercase tracking-widest">关联小组</th>
                                <th className="px-6 py-4 text-left text-xs font-bold text-gray-500 uppercase tracking-widest">体积</th>
                                <th className="px-6 py-4 text-left text-xs font-bold text-gray-500 uppercase tracking-widest">发布时间</th>
                                <th className="px-6 py-4 text-right text-xs font-bold text-gray-500 uppercase tracking-widest text-nowrap">操作</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {resources.map((resource) => (
                                <tr key={resource.id} className="hover:bg-slate-50/50 transition-colors group">
                                    <td className="px-6 py-4 whitespace-nowrap">
                                        <div className="flex items-center gap-3">
                                            <div className="p-2.5 bg-indigo-50 rounded-xl">
                                                <FileText className="w-5 h-5 text-indigo-600" />
                                            </div>
                                            <span className="font-bold text-slate-800">{resource.filename}</span>
                                        </div>
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap">
                                        <Badge variant="secondary" className="bg-slate-100 text-slate-600 border-0 px-3 py-1 font-medium">
                                            {resource.projectName}
                                        </Badge>
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-slate-500">
                                        {formatSize(resource.size)}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-500 font-medium">
                                        {new Date(resource.uploaded_at).toLocaleDateString()}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-right">
                                        <div className="flex justify-end gap-2">
                                            <Button variant="ghost" size="sm" onClick={() => window.open(resource.url, '_blank')} className="h-9 w-9 p-0 hover:bg-white hover:shadow-sm">
                                                <Download className="w-4 h-4 text-slate-500" />
                                            </Button>
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                onClick={() => handleDeleteResource(resource.projectId, resource.id)}
                                                className="h-9 w-9 p-0 text-red-500 hover:text-red-600 hover:bg-red-50"
                                            >
                                                <Trash2 className="w-4 h-4" />
                                            </Button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            ) : (
                <div className="bg-white rounded-3xl border-2 border-dashed border-gray-100 p-20 text-center">
                    <div className="w-20 h-20 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-6">
                        <HardDrive className="w-10 h-10 text-slate-300" />
                    </div>
                    <h3 className="text-xl font-bold text-gray-900">暂无课程资源</h3>
                    <p className="text-gray-500 mt-2 font-medium max-w-xs mx-auto">点击右上角“上传资源”为指定小组分发学习资料或模板文档。</p>
                </div>
            )}

            {/* Upload Dialog */}
            <Dialog open={isUploadOpen} onOpenChange={setIsUploadOpen}>
                <DialogContent className="max-w-md rounded-3xl">
                    <DialogHeader>
                        <DialogTitle className="text-xl font-bold">上传课程资源</DialogTitle>
                        <DialogDescription className="text-sm text-slate-500 mt-1">
                            上传文件并将其关联到指定小组，该组成员将能即时查看并使用。
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-6 pt-4">
                        <div className="space-y-2">
                            <label className="text-sm font-bold text-slate-700">选择文件</label>
                            <label className={`
                                block border-2 border-dashed rounded-2xl p-8 text-center transition-all cursor-pointer
                                ${selectedFile ? 'border-indigo-500 bg-indigo-50/30' : 'border-gray-200 hover:border-indigo-300 hover:bg-slate-50'}
                            `}>
                                <input
                                    type="file"
                                    className="hidden"
                                    onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
                                />
                                {selectedFile ? (
                                    <div className="flex flex-col items-center">
                                        <FileText className="w-10 h-10 text-indigo-600 mb-2" />
                                        <p className="text-sm font-bold text-slate-900 truncate max-w-full px-4">{selectedFile.name}</p>
                                        <p className="text-xs text-slate-500 mt-1">{formatSize(selectedFile.size)}</p>
                                    </div>
                                ) : (
                                    <div className="flex flex-col items-center">
                                        <Upload className="w-10 h-10 text-slate-300 mb-2" />
                                        <p className="text-sm font-bold text-slate-600">点击或拖拽文件至此</p>
                                        <p className="text-xs text-slate-400 mt-1">支持常见文档、图片及压缩包</p>
                                    </div>
                                )}
                            </label>
                        </div>

                        <div className="space-y-2">
                            <label className="text-sm font-bold text-slate-700">关联小组</label>
                            <select
                                value={selectedProjectId}
                                onChange={(e) => setSelectedProjectId(e.target.value)}
                                className="w-full p-3 rounded-xl border border-gray-200 focus:ring-2 focus:ring-indigo-500 outline-none text-sm font-medium"
                            >
                                {projects.map(p => (
                                    <option key={p.id} value={p.id}>{p.name}</option>
                                ))}
                                {projects.length === 0 && <option disabled>暂无可选小组</option>}
                            </select>
                            <p className="text-[10px] text-slate-400 font-medium">资源需绑定到具体小组才能被该组成员查看。</p>
                        </div>
                    </div>

                    <DialogFooter className="mt-8 gap-3 sm:gap-0">
                        <Button variant="ghost" onClick={() => setIsUploadOpen(false)} disabled={uploading} className="rounded-xl">
                            取消
                        </Button>
                        <Button
                            className="bg-indigo-600 hover:bg-indigo-700 text-white shadow-lg shadow-indigo-100 rounded-xl"
                            disabled={!selectedFile || !selectedProjectId || uploading}
                            onClick={handleFileUpload}
                        >
                            {uploading ? (
                                <>
                                    <Loader2 className="w-4 h-4 mr-2 animate-spin" /> 上传中...
                                </>
                            ) : '确认上传'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
