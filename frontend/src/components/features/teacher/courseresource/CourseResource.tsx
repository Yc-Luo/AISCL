import { useEffect, useMemo, useState } from 'react';
import {
    BookOpen,
    Download,
    FileText,
    HardDrive,
    Loader2,
    Plus,
    Trash2,
    Upload,
    CheckCircle2,
    Clock3,
    AlertTriangle,
    MinusCircle,
} from 'lucide-react';
import { courseService, Course } from '../../../../services/api/course';
import { storageService } from '../../../../services/api/storage';
import { Resource } from '../../../../types';
import {
    Button,
    Badge,
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
    ConfirmDialog,
} from '../../../ui';

const formatSize = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
};

const getParseStatus = (resource: Resource) => {
    const status = resource.parse_status || 'pending';
    if (status === 'indexed') {
        return { title: '已完成解析并进入 AI 检索', icon: <CheckCircle2 className="h-4 w-4" />, className: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100' };
    }
    if (status === 'parsing') {
        return { title: '资源正在解析入库', icon: <Loader2 className="h-4 w-4 animate-spin" />, className: 'bg-indigo-50 text-indigo-700 ring-1 ring-indigo-100' };
    }
    if (status === 'failed') {
        return { title: resource.parse_error || '解析失败，可稍后重试', icon: <AlertTriangle className="h-4 w-4" />, className: 'bg-rose-50 text-rose-700 ring-1 ring-rose-100' };
    }
    if (status === 'unsupported') {
        return { title: '该资源仅作为文件保存，暂未进入 AI 检索', icon: <MinusCircle className="h-4 w-4" />, className: 'bg-slate-50 text-slate-500 ring-1 ring-slate-100' };
    }
    return { title: '等待解析入库', icon: <Clock3 className="h-4 w-4" />, className: 'bg-amber-50 text-amber-700 ring-1 ring-amber-100' };
};

export default function CourseResource() {
    const [courses, setCourses] = useState<Course[]>([]);
    const [selectedCourseId, setSelectedCourseId] = useState('');
    const [resources, setResources] = useState<Resource[]>([]);
    const [loading, setLoading] = useState(true);
    const [resourceLoading, setResourceLoading] = useState(false);

    const [isUploadOpen, setIsUploadOpen] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [notice, setNotice] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
    const [pendingDeleteResource, setPendingDeleteResource] = useState<Resource | null>(null);
    const [deletingResource, setDeletingResource] = useState(false);

    const selectedCourse = useMemo(
        () => courses.find((course) => course.id === selectedCourseId) || null,
        [courses, selectedCourseId]
    );

    const fetchCourses = async () => {
        try {
            setLoading(true);
            const nextCourses = await courseService.getCourses();
            setCourses(nextCourses);
            setSelectedCourseId((previous) => {
                if (previous && nextCourses.some((course) => course.id === previous)) return previous;
                return nextCourses[0]?.id || '';
            });
        } catch (error) {
            console.error('Failed to fetch courses:', error);
        } finally {
            setLoading(false);
        }
    };

    const fetchCourseResources = async (courseId: string) => {
        if (!courseId) {
            setResources([]);
            return;
        }
        try {
            setResourceLoading(true);
            const data = await storageService.getCourseResources(courseId);
            setResources(
                [...data.resources].sort(
                    (a, b) => new Date(b.uploaded_at).getTime() - new Date(a.uploaded_at).getTime()
                )
            );
        } catch (error) {
            console.error('Failed to fetch course resources:', error);
            setResources([]);
        } finally {
            setResourceLoading(false);
        }
    };

    useEffect(() => {
        void fetchCourses();
    }, []);

    useEffect(() => {
        void fetchCourseResources(selectedCourseId);
    }, [selectedCourseId]);

    useEffect(() => {
        const hasUnfinishedParsing = resources.some((resource) =>
            ['pending', 'parsing'].includes(resource.parse_status || 'pending')
        );
        if (!selectedCourseId || !hasUnfinishedParsing) return;
        const timer = window.setInterval(() => {
            void fetchCourseResources(selectedCourseId);
        }, 10000);
        return () => window.clearInterval(timer);
    }, [resources, selectedCourseId]);

    const handleFileUpload = async () => {
        if (!selectedFile || !selectedCourseId) return;

        setUploading(true);
        try {
            await storageService.uploadResourceFile({
                course_id: selectedCourseId,
                file: selectedFile,
                source_type: 'library',
            });

            setIsUploadOpen(false);
            setSelectedFile(null);
            await fetchCourseResources(selectedCourseId);
            setNotice({ type: 'success', message: '班级资源已上传，系统将自动解析并写入 AI 检索库。' });
        } catch (error) {
            console.error('Upload failed:', error);
            setNotice({ type: 'error', message: '上传失败，请检查网络连接、文件类型或班级权限。' });
        } finally {
            setUploading(false);
        }
    };

    const confirmDeleteResource = async () => {
        if (!pendingDeleteResource) return;
        try {
            setDeletingResource(true);
            await storageService.deleteResource('', pendingDeleteResource.id);
            setResources((previous) => previous.filter((resource) => resource.id !== pendingDeleteResource.id));
            setNotice({ type: 'success', message: `班级资源“${pendingDeleteResource.filename}”已删除。` });
            setPendingDeleteResource(null);
        } catch (error) {
            console.error('Delete failed:', error);
            setNotice({ type: 'error', message: '删除失败，请确认您是否有该班级资源的管理权限。' });
        } finally {
            setDeletingResource(false);
        }
    };

    if (loading) {
        return (
            <div className="flex h-64 items-center justify-center">
                <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-indigo-600" />
                <span className="ml-3 text-slate-500">加载资源中心...</span>
            </div>
        );
    }

    return (
        <div className="space-y-6 animate-fadeIn">
            <div className="rounded-3xl border border-gray-100 bg-white p-6 shadow-sm lg:p-8">
                <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
                    <div>
                        <h2 className="text-3xl font-bold tracking-tight text-gray-900">课程资源中心</h2>
                        <p className="mt-2 text-sm font-medium text-gray-500">
                            按班级统一管理教师提供的探究资料、工具手册与任务材料，班级内所有小组共享可见。
                        </p>
                    </div>
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                        <div className="flex items-center gap-3 rounded-xl border border-blue-100 bg-blue-50 px-4 py-2">
                            <HardDrive className="h-5 w-5 text-blue-600" />
                            <span className="font-bold text-blue-900">文件总数: {resources.length}</span>
                        </div>
                        <Button
                            onClick={() => setIsUploadOpen(true)}
                            disabled={!selectedCourseId}
                            className="gap-2 bg-indigo-600 text-white shadow-lg shadow-indigo-100 hover:bg-indigo-700"
                        >
                            <Plus className="h-4 w-4" /> 上传班级资源
                        </Button>
                    </div>
                </div>

                <div className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,24rem)]">
                    <div className="rounded-2xl border border-slate-100 bg-slate-50/70 p-4">
                        <label className="text-xs font-bold uppercase tracking-widest text-slate-400">
                            当前班级
                        </label>
                        <select
                            value={selectedCourseId}
                            onChange={(event) => setSelectedCourseId(event.target.value)}
                            className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
                        >
                            {courses.map((course) => (
                                <option key={course.id} value={course.id}>
                                    {course.name}（{course.semester}）
                                </option>
                            ))}
                            {courses.length === 0 && <option value="">暂无班级</option>}
                        </select>
                        <p className="mt-2 text-xs leading-5 text-slate-500">
                            教师资源只上传到班级一次，不再逐个小组重复上传；学生端资源库会自动合并显示“教师提供资源”和“小组自建资源”。
                        </p>
                    </div>
                    <div className="rounded-2xl border border-emerald-100 bg-emerald-50/70 p-4">
                        <div className="flex items-center gap-2 text-sm font-bold text-emerald-800">
                            <BookOpen className="h-4 w-4" />
                            上传与分发已分离
                        </div>
                        <p className="mt-2 text-xs leading-5 text-emerald-700">
                            上传形成班级资源对象；分发范围为当前班级全部小组。学生访问、下载、加入 Wiki 等行为仍会按具体小组和阶段记录。
                        </p>
                    </div>
                </div>
            </div>

            {notice && (
                <div className={`rounded-2xl border px-4 py-3 text-sm font-medium ${notice.type === 'success'
                    ? 'border-emerald-100 bg-emerald-50 text-emerald-700'
                    : 'border-rose-100 bg-rose-50 text-rose-700'
                    }`}>
                    {notice.message}
                </div>
            )}

            {selectedCourse && resourceLoading ? (
                <div className="flex h-48 items-center justify-center rounded-3xl border border-gray-100 bg-white">
                    <Loader2 className="mr-2 h-5 w-5 animate-spin text-indigo-500" />
                    <span className="text-sm text-slate-500">正在加载班级资源...</span>
                </div>
            ) : resources.length > 0 ? (
                <div className="overflow-x-auto rounded-3xl border border-gray-100 bg-white shadow-sm">
                    <table className="w-full min-w-[980px] table-fixed">
                        <colgroup>
                            <col className="w-[43%]" />
                            <col className="w-[12%]" />
                            <col className="w-[12%]" />
                            <col className="w-[8%]" />
                            <col className="w-[9%]" />
                            <col className="w-[11%]" />
                            <col className="w-[8%]" />
                        </colgroup>
                        <thead className="bg-gray-50/70">
                            <tr>
                                <th className="px-6 py-4 text-left text-xs font-bold uppercase tracking-widest text-gray-500">文件名</th>
                                <th className="px-6 py-4 text-left text-xs font-bold uppercase tracking-widest text-gray-500">所属班级</th>
                                <th className="px-6 py-4 text-left text-xs font-bold uppercase tracking-widest text-gray-500">分发范围</th>
                                <th className="px-6 py-4 text-left text-xs font-bold uppercase tracking-widest text-gray-500">入库</th>
                                <th className="px-6 py-4 text-left text-xs font-bold uppercase tracking-widest text-gray-500">体积</th>
                                <th className="px-6 py-4 text-left text-xs font-bold uppercase tracking-widest text-gray-500">上传时间</th>
                                <th className="px-6 py-4 text-right text-xs font-bold uppercase tracking-widest text-gray-500">操作</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {resources.map((resource) => (
                                <tr key={resource.id} className="group transition-colors hover:bg-slate-50/70">
                                    <td className="px-6 py-4">
                                        <div className="flex min-w-0 items-center gap-3">
                                            <div className="shrink-0 rounded-xl bg-indigo-50 p-2.5">
                                                <FileText className="h-5 w-5 text-indigo-600" />
                                            </div>
                                            <div className="min-w-0">
                                                <div className="max-w-full truncate font-bold text-slate-800" title={resource.filename}>
                                                    {resource.filename}
                                                </div>
                                                <div className="mt-0.5 truncate text-xs text-slate-400">{resource.mime_type}</div>
                                            </div>
                                        </div>
                                    </td>
                                    <td className="whitespace-nowrap px-6 py-4">
                                        <Badge variant="secondary" className="border-0 bg-slate-100 px-3 py-1 font-medium text-slate-600">
                                            {selectedCourse?.name || '当前班级'}
                                        </Badge>
                                    </td>
                                    <td className="whitespace-nowrap px-6 py-4">
                                        <Badge variant="secondary" className="border-0 bg-emerald-50 px-3 py-1 font-medium text-emerald-700">
                                            全班小组共享
                                        </Badge>
                                    </td>
                                    <td className="whitespace-nowrap px-6 py-4">
                                        {(() => {
                                            const parse = getParseStatus(resource);
                                            return (
                                                <span
                                                    className={`inline-flex h-7 w-7 items-center justify-center rounded-full ${parse.className}`}
                                                    title={parse.title}
                                                >
                                                    {parse.icon}
                                                </span>
                                            );
                                        })()}
                                    </td>
                                    <td className="whitespace-nowrap px-6 py-4 text-sm font-medium text-slate-500">
                                        {formatSize(resource.size)}
                                    </td>
                                    <td className="whitespace-nowrap px-6 py-4 text-sm font-medium text-slate-500">
                                        {new Date(resource.uploaded_at).toLocaleDateString()}
                                    </td>
                                    <td className="sticky right-0 whitespace-nowrap bg-white px-6 py-4 text-right shadow-[-8px_0_16px_-16px_rgba(15,23,42,0.45)] transition-colors group-hover:bg-slate-50">
                                        <div className="flex justify-end gap-2">
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                onClick={() => window.open(resource.url, '_blank')}
                                                className="h-9 w-9 p-0 hover:bg-white hover:shadow-sm"
                                                title="打开资源"
                                            >
                                                <Download className="h-4 w-4 text-slate-500" />
                                            </Button>
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                onClick={() => setPendingDeleteResource(resource)}
                                                className="h-9 w-9 p-0 text-red-500 hover:bg-red-50 hover:text-red-600"
                                                title="删除资源"
                                            >
                                                <Trash2 className="h-4 w-4" />
                                            </Button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            ) : (
                <div className="rounded-3xl border-2 border-dashed border-gray-100 bg-white p-16 text-center">
                    <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-slate-50">
                        <HardDrive className="h-10 w-10 text-slate-300" />
                    </div>
                    <h3 className="text-xl font-bold text-gray-900">暂无班级资源</h3>
                    <p className="mx-auto mt-2 max-w-md text-sm font-medium leading-6 text-gray-500">
                        请选择班级后上传资源。资源会直接分发给该班级下所有小组，避免重复上传和版本不一致。
                    </p>
                </div>
            )}

            <Dialog open={isUploadOpen} onOpenChange={setIsUploadOpen}>
                <DialogContent className="max-h-[90vh] w-[calc(100vw-2rem)] max-w-xl overflow-y-auto rounded-3xl p-5 sm:p-6">
                    <DialogHeader>
                        <DialogTitle className="text-xl font-bold">上传班级资源</DialogTitle>
                        <DialogDescription className="mt-1 text-sm text-slate-500">
                            文件将绑定到当前班级，班级内所有小组在学生端资源库中都能看到。
                        </DialogDescription>
                    </DialogHeader>

                    <div className="min-w-0 space-y-5 pt-4">
                        <div className="min-w-0 rounded-xl border border-indigo-100 bg-indigo-50 px-3 py-2 text-sm text-indigo-700">
                            当前班级：<span className="font-bold">{selectedCourse?.name || '未选择班级'}</span>
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-bold text-slate-700">选择文件</label>
                            <label className={`
                                block min-w-0 cursor-pointer rounded-2xl border-2 border-dashed p-5 text-center transition-all sm:p-8
                                ${selectedFile ? 'border-indigo-500 bg-indigo-50/30' : 'border-gray-200 hover:border-indigo-300 hover:bg-slate-50'}
                            `}>
                                <input
                                    type="file"
                                    className="hidden"
                                    onChange={(event) => setSelectedFile(event.target.files?.[0] || null)}
                                />
                                {selectedFile ? (
                                    <div className="flex min-w-0 flex-col items-center">
                                        <FileText className="mb-2 h-10 w-10 text-indigo-600" />
                                        <p className="w-full max-w-full truncate px-2 text-sm font-bold text-slate-900 sm:px-4">{selectedFile.name}</p>
                                        <p className="mt-1 text-xs text-slate-500">{formatSize(selectedFile.size)}</p>
                                    </div>
                                ) : (
                                    <div className="flex flex-col items-center">
                                        <Upload className="mb-2 h-10 w-10 text-slate-300" />
                                        <p className="text-sm font-bold text-slate-600">点击选择文件</p>
                                        <p className="mt-1 text-xs text-slate-400">支持常见文档、图片和表格材料</p>
                                    </div>
                                )}
                            </label>
                        </div>
                    </div>

                    <DialogFooter className="mt-8 gap-3 sm:gap-0">
                        <Button variant="ghost" onClick={() => setIsUploadOpen(false)} disabled={uploading} className="rounded-xl">
                            取消
                        </Button>
                        <Button
                            className="rounded-xl bg-indigo-600 text-white shadow-lg shadow-indigo-100 hover:bg-indigo-700"
                            disabled={!selectedFile || !selectedCourseId || uploading}
                            onClick={handleFileUpload}
                        >
                            {uploading ? (
                                <>
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> 上传中...
                                </>
                            ) : '确认上传'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <ConfirmDialog
                open={!!pendingDeleteResource}
                onOpenChange={(open) => !open && setPendingDeleteResource(null)}
                title="删除班级资源"
                description={`确定要删除“${pendingDeleteResource?.filename || ''}”吗？删除后，该班级下所有小组将不再看到此资源，但既有研究事件记录不会被删除。`}
                confirmLabel="确认删除"
                tone="danger"
                loading={deletingResource}
                onConfirm={confirmDeleteResource}
            />
        </div>
    );
}
