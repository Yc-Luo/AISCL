import { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
    Users,
    UserPlus,
    Search,
    Mail,
    BookOpen,
    Trash2,
    X,
    UserCheck,
    Loader2,
    Download,
    Upload,
    CheckCircle2
} from 'lucide-react';
import {
    Button,
    Input,
    Badge,
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription
} from '../../../ui';
import { courseService, Course, Student } from '../../../../services/api/course';
import { projectService } from '../../../../services/api/project';
import { userService } from '../../../../services/api/user';
import { Project, User } from '../../../../types';

export default function StudentList() {
    const [searchParams, setSearchParams] = useSearchParams();
    const courseIdParam = searchParams.get('courseId');

    const [searchQuery, setSearchQuery] = useState('');
    const [courses, setCourses] = useState<Course[]>([]);
    const [selectedCourseId, setSelectedCourseId] = useState<string | null>(courseIdParam);
    const [students, setStudents] = useState<Student[]>([]);
    const [loading, setLoading] = useState(true);
    const [fetchingStudents, setFetchingStudents] = useState(false);

    // Sidebar Detail State
    const [selectedStudent, setSelectedStudent] = useState<Student | null>(null);
    const [studentProjects, setStudentProjects] = useState<Project[]>([]);
    const [fetchingDetail, setFetchingDetail] = useState(false);

    // Import Dialog State
    const [isImportOpen, setIsImportOpen] = useState(false);
    const [importTab, setImportTab] = useState<'search' | 'bulk'>('search');
    const [allUsers, setAllUsers] = useState<User[]>([]);
    const [userSearch, setUserSearch] = useState('');
    const [fetchingUsers, setFetchingUsers] = useState(false);
    const [importingId, setImportingId] = useState<string | null>(null);

    // Bulk Import State
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [bulkFile, setBulkFile] = useState<File | null>(null);
    const [bulkStatus, setBulkStatus] = useState<'idle' | 'processing' | 'success' | 'error'>('idle');
    const [bulkProgress, setBulkProgress] = useState({ total: 0, current: 0 });
    const [bulkLogs, setBulkLogs] = useState<string[]>([]);
    const selectedCourse = courses.find(c => c.id === selectedCourseId) || null;

    const fetchInitialData = async () => {
        try {
            setLoading(true);
            const data = await courseService.getCourses();
            setCourses(data);

            if (courseIdParam) {
                setSelectedCourseId(courseIdParam);
            } else if (data.length > 0) {
                setSelectedCourseId(data[0].id);
            }
        } catch (error) {
            console.error('Failed to fetch courses:', error);
        } finally {
            setLoading(false);
        }
    };

    const fetchStudents = async () => {
        if (!selectedCourseId) return;
        try {
            setFetchingStudents(true);
            const data = await courseService.getCourseStudents(selectedCourseId);
            setStudents(data);

            if (searchParams.get('courseId') !== selectedCourseId) {
                setSearchParams({ courseId: selectedCourseId });
            }
        } catch (error) {
            console.error('Failed to fetch students:', error);
        } finally {
            setFetchingStudents(false);
        }
    };

    useEffect(() => {
        fetchInitialData();
    }, []);

    useEffect(() => {
        fetchStudents();
    }, [selectedCourseId, setSearchParams]);

    const handleViewStudent = async (student: Student) => {
        setSelectedStudent(student);
        setFetchingDetail(true);
        try {
            const allProjects = await projectService.getProjects();
            const filtered = allProjects.projects.filter(p =>
                p.members.some(m => m.user_id === student.id)
            );
            setStudentProjects(filtered);
        } catch (error) {
            console.error('Failed to fetch student details:', error);
        } finally {
            setFetchingDetail(false);
        }
    };

    const handleRemoveStudent = async (studentId: string, username: string) => {
        if (!selectedCourseId) return;
        if (window.confirm(`确定要将学生 "${username}" 从本班级移除吗？`)) {
            try {
                await courseService.removeStudent(selectedCourseId, studentId);
                setStudents(students.filter(s => s.id !== studentId));
                if (selectedStudent?.id === studentId) setSelectedStudent(null);
            } catch (error) {
                console.error('Remove student failed:', error);
                alert('移除失败，请稍后重试');
            }
        }
    };

    const handleOpenImport = async () => {
        if (!selectedCourseId) return;
        setIsImportOpen(true);
        setImportTab('search');
        setBulkFile(null);
        setBulkStatus('idle');
        setBulkLogs([]);
        try {
            setFetchingUsers(true);
            const users = await userService.searchUsers({ role: 'student' });
            setAllUsers(users);
        } catch (error) {
            console.error('Failed to fetch users:', error);
        } finally {
            setFetchingUsers(false);
        }
    };

    const handleImportOne = async (studentId: string) => {
        if (!selectedCourseId) return;
        try {
            setImportingId(studentId);
            await courseService.addStudentToCourse(selectedCourseId, studentId);
            await fetchStudents();
        } catch (error) {
            console.error('Import failed:', error);
            alert('导入失败，可能学生已在班级中');
        } finally {
            setImportingId(null);
        }
    };

    // CSV Template Download
    const downloadTemplate = () => {
        const header = "用户名,邮箱,初始密码\n";
        const content = "张三,zhangsan@example.com,123456\n李四,lisi@example.com,123456";
        const blob = new Blob(["\uFEFF" + header + content], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.setAttribute('download', '学生导入模版.csv');
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    // Bulk Import Processing
    const handleBulkImport = async () => {
        if (!bulkFile || !selectedCourseId) return;

        setBulkStatus('processing');
        setBulkLogs(['开始解析文件...']);

        try {
            const text = await bulkFile.text();
            const rows = text.split('\n').map(row => row.split(',')).filter(row => row.length >= 2 && row[0] !== '用户名');

            if (rows.length === 0) {
                setBulkStatus('error');
                setBulkLogs(prev => [...prev, '无效的文件内容：未找到学生数据']);
                return;
            }

            setBulkProgress({ total: rows.length, current: 0 });
            setBulkLogs(prev => [...prev, `共找到 ${rows.length} 条记录，开始导入...`]);

            let successCount = 0;
            for (let i = 0; i < rows.length; i++) {
                const [username, email, password] = rows[i].map(s => s?.trim());
                if (!username || !email) {
                    setBulkLogs(prev => [...prev, `第 ${i + 1} 行跳过：数据不完整`]);
                    continue;
                }

                try {
                    // Try to find if user exists
                    const existing = await userService.searchUsers({ search: email });
                    let userId = '';

                    const found = existing.find(u => u.email === email);
                    if (found) {
                        if (found.class_id && found.class_id !== selectedCourseId) {
                            setBulkLogs(prev => [...prev, `[${username}] 已属于其他班级，未导入当前班级`]);
                            setBulkProgress(prev => ({ ...prev, current: i + 1 }));
                            continue;
                        }
                        userId = found.id;
                        setBulkLogs(prev => [...prev, `[${username}] 用户已存在，直接关联到班级`]);
                    } else {
                        // Create new user
                        const newUser = await userService.createUser({
                            username,
                            email,
                            password: password || '123456',
                            role: 'student',
                            class_id: selectedCourseId
                        });
                        userId = newUser.id;
                        setBulkLogs(prev => [...prev, `[${username}] 新用户创建成功`]);
                    }

                    // Assign to course
                    await courseService.addStudentToCourse(selectedCourseId, userId);
                    successCount++;
                } catch (err) {
                    setBulkLogs(prev => [...prev, `[${username}] 导入失败：${err instanceof Error ? err.message : '未知错误'}`]);
                }
                setBulkProgress(prev => ({ ...prev, current: i + 1 }));
            }

            setBulkStatus('success');
            setBulkLogs(prev => [...prev, `导入完成！成功: ${successCount}，失败: ${rows.length - successCount}`]);
            fetchStudents();
        } catch (err) {
            setBulkStatus('error');
            setBulkLogs(prev => [...prev, '解析失败，请确保使用 UTF-8 编码的 CSV 文件']);
        }
    };

    const importFilteredUsers = allUsers.filter(u =>
        (u.username.toLowerCase().includes(userSearch.toLowerCase()) ||
            u.email.toLowerCase().includes(userSearch.toLowerCase())) &&
        (!u.class_id || u.class_id === selectedCourseId) &&
        !students.some(s => s.id === u.id)
    );

    const filteredStudents = students.filter(student =>
        student.username.toLowerCase().includes(searchQuery.toLowerCase()) ||
        student.email.toLowerCase().includes(searchQuery.toLowerCase())
    );

    if (loading && courses.length === 0) {
        return <div className="flex items-center justify-center h-64">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
            <span className="ml-3 text-slate-500 font-medium">加载中...</span>
        </div>;
    }

    return (
        <div className="relative min-h-[calc(100vh-10rem)] pb-10">
            <div className={`space-y-6 animate-fadeIn transition-all duration-300 ${selectedStudent ? 'pr-[400px]' : ''}`}>
                {/* Header */}
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">学生管理</h1>
                        <p className="text-sm text-slate-500 mt-1">按班级组织学生名单，并将学生批量导入到当前班级。</p>
                    </div>
                    <div className="flex items-center gap-3">
                        <div className="relative">
                            <BookOpen className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                            <select
                                value={selectedCourseId || ''}
                                onChange={(e) => setSelectedCourseId(e.target.value)}
                                className="pl-9 pr-10 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-medium focus:outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm appearance-none"
                            >
                                {courses.map(c => (
                                    <option key={c.id} value={c.id}>{c.name}</option>
                                ))}
                            </select>
                        </div>
                        <Button
                            onClick={handleOpenImport}
                            disabled={!selectedCourseId}
                            className="bg-indigo-600 hover:bg-indigo-700 text-white gap-2 rounded-xl shadow-md shadow-indigo-100 px-5"
                        >
                            <UserPlus className="w-4 h-4" />
                            导入学生
                        </Button>
                    </div>
                </div>

                {/* Stats Row */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div className="bg-white rounded-2xl border border-slate-100 p-5 shadow-sm hover:shadow-md transition-shadow">
                        <div className="flex items-center gap-4">
                            <div className="w-12 h-12 bg-indigo-50 rounded-2xl flex items-center justify-center">
                                <Users className="w-6 h-6 text-indigo-600" />
                            </div>
                            <div>
                                <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">本班学生数</p>
                                <p className="text-2xl font-bold text-slate-900">{students.length}</p>
                            </div>
                        </div>
                    </div>
                    <div className="bg-white rounded-2xl border border-slate-100 p-5 shadow-sm">
                        <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">当前班级</p>
                        <p className="mt-2 text-lg font-bold text-slate-900">{selectedCourse?.name || '未选择班级'}</p>
                        <div className="mt-3 flex flex-wrap gap-2 text-xs">
                            {selectedCourse?.invite_code && (
                                <Badge className="bg-slate-100 text-slate-700 border-none px-3 py-1">
                                    邀请码：{selectedCourse.invite_code}
                                </Badge>
                            )}
                            {selectedCourse?.experiment_template_key && (
                                <Badge className="bg-indigo-50 text-indigo-700 border-none px-3 py-1">
                                    模板：{selectedCourse.experiment_template_key}
                                </Badge>
                            )}
                        </div>
                    </div>
                    <div className="bg-white rounded-2xl border border-slate-100 p-5 shadow-sm">
                        <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">班级支架准备</p>
                        <div className="mt-3 space-y-2 text-sm text-slate-600">
                            <div className="flex items-center justify-between">
                                <span>实验模板</span>
                                <span className="font-semibold text-slate-900">{selectedCourse?.experiment_template_key ? '已配置' : '未配置'}</span>
                            </div>
                            <div className="flex items-center justify-between">
                                <span>项目说明文档</span>
                                <span className="font-semibold text-slate-900">{selectedCourse?.initial_task_document_title ? '已配置' : '未配置'}</span>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Search and Filters */}
                <div className="bg-white rounded-2xl border border-slate-100 p-4 shadow-sm flex items-center gap-4">
                    <div className="relative flex-1">
                            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                        <Input
                            placeholder="搜索当前班级中的学生姓名、邮箱或 ID..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="pl-9 bg-slate-50 border-none focus:bg-white focus:ring-2 focus:ring-indigo-500 transition-all rounded-xl"
                        />
                    </div>
                </div>

                {/* Students Table */}
                <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden shadow-sm">
                    {fetchingStudents ? (
                        <div className="flex flex-col items-center justify-center p-20">
                            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-indigo-600 mb-4"></div>
                            <p className="text-sm font-medium text-slate-500">正在检索学生花名册...</p>
                        </div>
                    ) : students.length > 0 ? (
                        <div className="overflow-x-auto">
                            <table className="w-full text-left">
                                <thead className="bg-slate-50/50">
                                    <tr>
                                        <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-widest">学生信息</th>
                                        <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-widest">联系邮箱</th>
                                        <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-widest">学习状态</th>
                                        <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-widest text-right">操作</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {filteredStudents.map((student) => (
                                        <tr
                                            key={student.id}
                                            className={`group hover:bg-slate-50 transition-colors cursor-pointer ${selectedStudent?.id === student.id ? 'bg-indigo-50/50' : ''}`}
                                            onClick={() => handleViewStudent(student)}
                                        >
                                            <td className="px-6 py-5">
                                                <div className="flex items-center gap-4">
                                                    <div className="w-12 h-12 bg-white border border-slate-100 rounded-xl flex items-center justify-center text-indigo-600 font-bold shadow-sm group-hover:scale-110 transition-transform">
                                                        {student.username[0].toUpperCase()}
                                                    </div>
                                                    <div>
                                                        <p className="font-bold text-slate-900">{student.username}</p>
                                                        <p className="text-xs text-slate-400 mt-0.5 font-mono">ID: {student.id.slice(-8)}</p>
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="px-6 py-5">
                                                <div className="flex items-center gap-2 text-sm text-slate-600 font-medium">
                                                    <Mail className="w-4 h-4 text-slate-400" />
                                                    {student.email}
                                                </div>
                                            </td>
                                            <td className="px-6 py-5">
                                                <div className="flex items-center gap-2">
                                                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></div>
                                                    <span className="text-sm font-bold text-emerald-600">在线</span>
                                                </div>
                                            </td>
                                            <td className="px-6 py-5 text-right">
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    className="opacity-0 group-hover:opacity-100 transition-opacity hover:bg-white hover:text-red-600"
                                                    onClick={(e) => { e.stopPropagation(); handleRemoveStudent(student.id, student.username); }}
                                                >
                                                    <Trash2 className="w-4 h-4" />
                                                </Button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    ) : (
                        <div className="flex flex-col items-center justify-center py-24 bg-slate-50/50">
                            <div className="w-20 h-20 bg-white rounded-full flex items-center justify-center shadow-sm mb-6">
                                <Users className="w-10 h-10 text-slate-200" />
                            </div>
                            <p className="text-slate-500 font-bold">本班暂无学生数据</p>
                            <p className="text-sm text-slate-400 mt-1 mb-6">点击右上角导入学生开始管理</p>
                        </div>
                    )}
                </div>
            </div>

            {/* Import Students Modal */}
            <Dialog open={isImportOpen} onOpenChange={setIsImportOpen}>
                <DialogContent className="max-w-2xl rounded-3xl p-0 overflow-hidden border-none shadow-2xl">
                    <div className="bg-gradient-to-br from-indigo-600 to-indigo-800 p-8 text-white relative">
                        <DialogHeader>
                            <DialogTitle className="text-2xl font-bold text-white flex items-center gap-3">
                                <UserPlus className="w-7 h-7" />
                                导入学生到班级
                            </DialogTitle>
                            <DialogDescription className="text-indigo-100 mt-2 font-medium">
                                当前导入目标班级：<span className="text-white font-bold">{selectedCourse?.name || '未选择班级'}</span>
                            </DialogDescription>
                        </DialogHeader>

                        {/* Tabs */}
                        <div className="flex gap-6 mt-8">
                            <button
                                onClick={() => setImportTab('search')}
                                className={`pb-2 text-sm font-bold transition-all border-b-2 ${importTab === 'search' ? 'border-white text-white' : 'border-transparent text-indigo-300 hover:text-white'}`}
                            >
                                精确查找导入
                            </button>
                            <button
                                onClick={() => setImportTab('bulk')}
                                className={`pb-2 text-sm font-bold transition-all border-b-2 ${importTab === 'bulk' ? 'border-white text-white' : 'border-transparent text-indigo-300 hover:text-white'}`}
                            >
                                模版批量导入
                            </button>
                        </div>
                    </div>

                    <div className="p-8">
                        {importTab === 'search' ? (
                            <div className="space-y-6">
                                <div className="relative">
                                    <Search className="w-5 h-5 text-slate-400 absolute left-4 top-1/2 -translate-y-1/2" />
                                    <Input
                                        placeholder="搜索全校学生姓名、邮箱..."
                                        value={userSearch}
                                        onChange={e => setUserSearch(e.target.value)}
                                        className="pl-12 h-14 bg-slate-50 border-none rounded-2xl focus:bg-white focus:ring-2 focus:ring-indigo-500 transition-all text-lg"
                                    />
                                </div>

                                <div className="max-h-[350px] overflow-y-auto pr-2 space-y-3 custom-scrollbar">
                                    {fetchingUsers ? (
                                        <div className="flex flex-col items-center justify-center py-20">
                                            <Loader2 className="w-10 h-10 text-indigo-500 animate-spin mb-4" />
                                            <p className="text-sm font-bold text-slate-400">正在检索用户池...</p>
                                        </div>
                                    ) : importFilteredUsers.length > 0 ? (
                                        importFilteredUsers.map(user => (
                                            <div key={user.id} className="flex items-center justify-between p-4 bg-white border border-slate-100 rounded-2xl hover:border-indigo-200 hover:shadow-sm transition-all group">
                                                <div className="flex items-center gap-4">
                                                    <div className="w-12 h-12 bg-slate-50 rounded-xl flex items-center justify-center text-indigo-600 font-bold border border-slate-100">
                                                        {user.username[0].toUpperCase()}
                                                    </div>
                                                    <div>
                                                        <p className="font-bold text-slate-900">{user.username}</p>
                                                        <p className="text-xs text-slate-400 font-medium">{user.email}</p>
                                                    </div>
                                                </div>
                                                <Button
                                                    size="sm"
                                                    disabled={importingId === user.id}
                                                    onClick={() => handleImportOne(user.id)}
                                                    className={`${importingId === user.id ? 'bg-slate-100' : 'bg-slate-900 hover:bg-black'} text-white rounded-xl gap-2 h-10 px-4`}
                                                >
                                                    {importingId === user.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserCheck className="w-4 h-4" />}
                                                    {importingId === user.id ? '加入中...' : '导入'}
                                                </Button>
                                            </div>
                                        ))
                                    ) : (
                                        <div className="text-center py-20 bg-slate-50/50 rounded-3xl border border-dashed border-slate-200">
                                            <Users className="w-12 h-12 text-slate-200 mx-auto mb-4" />
                                            <p className="text-slate-400 font-bold">未找到符合条件的学生</p>
                                        </div>
                                    )}
                                </div>
                            </div>
                        ) : (
                            <div className="space-y-8">
                                <div className="grid grid-cols-2 gap-4">
                                    <div
                                        onClick={downloadTemplate}
                                        className="p-6 bg-slate-50 rounded-3xl border border-slate-200 border-dashed hover:border-indigo-500 hover:bg-white transition-all cursor-pointer group"
                                    >
                                        <div className="w-12 h-12 bg-white rounded-2xl flex items-center justify-center shadow-sm group-hover:bg-indigo-50 transition-colors">
                                            <Download className="w-6 h-6 text-indigo-600" />
                                        </div>
                                        <h4 className="mt-4 font-bold text-slate-900">1. 下载模版</h4>
                                        <p className="text-xs text-slate-400 mt-1">下载 CSV 格式模版并按格式填写学生信息。</p>
                                    </div>
                                    <div
                                        onClick={() => fileInputRef.current?.click()}
                                        className={`p-6 bg-slate-50 rounded-3xl border border-slate-200 border-dashed hover:border-indigo-500 hover:bg-white transition-all cursor-pointer group ${bulkFile ? 'border-indigo-500 bg-indigo-50/20' : ''}`}
                                    >
                                        <div className="w-12 h-12 bg-white rounded-2xl flex items-center justify-center shadow-sm group-hover:bg-indigo-50 transition-colors">
                                            <Upload className={`w-6 h-6 ${bulkFile ? 'text-indigo-600' : 'text-slate-400'}`} />
                                        </div>
                                        <h4 className="mt-4 font-bold text-slate-900">2. 上传文件</h4>
                                        <p className="text-xs text-slate-400 mt-1">{bulkFile ? `已选择: ${bulkFile.name}` : '上传填写好的 CSV 文件，批量导入到当前班级。'}</p>
                                        <input
                                            type="file"
                                            ref={fileInputRef}
                                            className="hidden"
                                            accept=".csv"
                                            onChange={e => setBulkFile(e.target.files?.[0] || null)}
                                        />
                                    </div>
                                </div>

                                {bulkStatus === 'processing' && (
                                    <div className="space-y-4">
                                        <div className="flex justify-between items-end">
                                            <p className="text-sm font-bold text-indigo-600 flex items-center gap-2">
                                                <Loader2 className="w-4 h-4 animate-spin" />
                                                正在导入学生数据 ({bulkProgress.current}/{bulkProgress.total})
                                            </p>
                                            <span className="text-xs font-bold text-slate-400">{Math.round((bulkProgress.current / bulkProgress.total) * 100)}%</span>
                                        </div>
                                        <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                                            <div
                                                className="h-full bg-indigo-600 transition-all duration-300"
                                                style={{ width: `${(bulkProgress.current / (bulkProgress.total || 1)) * 100}%` }}
                                            />
                                        </div>
                                    </div>
                                )}

                                {bulkLogs.length > 0 && (
                                    <div className="bg-slate-900 rounded-2xl p-4 h-40 overflow-y-auto font-mono text-[10px] space-y-1 custom-scrollbar">
                                        {bulkLogs.map((log, i) => (
                                            <p key={i} className={log.includes('失败') ? 'text-red-400' : log.includes('成功') ? 'text-emerald-400' : 'text-slate-400'}>
                                                {`> ${log}`}
                                            </p>
                                        ))}
                                    </div>
                                )}

                                {bulkStatus !== 'processing' && (
                                    <div className="flex justify-center">
                                        <Button
                                            disabled={!bulkFile}
                                            onClick={handleBulkImport}
                                            className="w-full h-14 bg-indigo-600 hover:bg-indigo-700 text-white rounded-2xl text-lg font-bold gap-3 shadow-lg shadow-indigo-100"
                                        >
                                            <CheckCircle2 className="w-5 h-5" />
                                            执行班级批量导入
                                        </Button>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    <div className="p-6 bg-slate-50 border-t border-slate-100 flex justify-end">
                        <Button variant="ghost" onClick={() => setIsImportOpen(false)} className="rounded-xl font-bold">完成并关闭</Button>
                    </div>
                </DialogContent>
            </Dialog>

            {/* Student Detail Drawer (Same as previous) */}
            {selectedStudent && (
                <div className="fixed top-0 right-0 h-full w-[400px] bg-white shadow-2xl z-40 transform transition-transform duration-300 ease-in-out border-l border-slate-100 flex flex-col p-8 overflow-y-auto">
                    <div className="flex items-center justify-between mb-10">
                        <h2 className="text-xl font-bold text-slate-900 tracking-tight">学生成长档案</h2>
                        <Button variant="ghost" size="sm" onClick={() => setSelectedStudent(null)} className="bg-slate-50 rounded-full h-8 w-8 p-0">
                            <X className="w-4 h-4 text-slate-400" />
                        </Button>
                    </div>
                    <div className="flex flex-col items-center mb-10">
                        <div className="w-28 h-28 bg-indigo-600 rounded-3xl flex items-center justify-center text-white text-4xl font-black shadow-xl shadow-indigo-100 mb-6">
                            {selectedStudent.username[0].toUpperCase()}
                        </div>
                        <h3 className="text-2xl font-black text-slate-900">{selectedStudent.username}</h3>
                        <p className="text-sm font-medium text-slate-400 mt-1">{selectedStudent.email}</p>
                        <div className="mt-6 flex gap-2">
                            <Badge className="bg-indigo-50 text-indigo-700 border-none px-3 py-1">活跃学习者</Badge>
                            <Badge className="bg-emerald-50 text-emerald-700 border-none px-3 py-1">数据同步中</Badge>
                        </div>
                    </div>
                    <div className="space-y-10">
                        <div>
                            <h4 className="flex items-center gap-3 text-xs font-black text-slate-400 uppercase tracking-[0.2em] mb-6">
                                <BookOpen className="w-4 h-4 text-indigo-500" /> 参与的小组
                            </h4>
                            <div className="space-y-4">
                                {fetchingDetail ? (
                                    <div className="space-y-3">
                                        <div className="h-16 bg-slate-50 rounded-2xl animate-pulse"></div>
                                        <div className="h-16 bg-slate-50 rounded-2xl animate-pulse"></div>
                                    </div>
                                ) : studentProjects.length > 0 ? (
                                    studentProjects.map(p => (
                                        <div key={p.id} className="p-4 bg-slate-50 rounded-2xl border border-slate-100 hover:border-indigo-200 transition-all hover:bg-white">
                                            <p className="text-sm font-bold text-slate-800 line-clamp-1">{p.name}</p>
                                            <div className="mt-3 h-1 bg-slate-200 rounded-full overflow-hidden">
                                                <div className="h-full bg-indigo-500" style={{ width: `${p.progress}%` }}></div>
                                            </div>
                                        </div>
                                    ))
                                ) : (
                                    <p className="text-xs text-slate-400 text-center">暂无小组</p>
                                )}
                            </div>
                        </div>
                    </div>
                    <div className="mt-auto pt-10 border-t border-slate-100">
                        <Button
                            variant="outline"
                            className="w-full text-red-600 border-red-50 hover:bg-red-50 rounded-xl"
                            onClick={() => handleRemoveStudent(selectedStudent.id, selectedStudent.username)}
                        >
                            移除学生
                        </Button>
                    </div>
                </div>
            )}
        </div>
    );
}
