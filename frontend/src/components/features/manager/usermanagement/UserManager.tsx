import { useState, useEffect } from 'react'
import { adminService, User } from '../../../../services/api/admin'
import { courseService, Course } from '../../../../services/api/course'
import {
    Users,
    UserPlus,
    Search,
    Shield,
    Edit,
    Filter,
    Calendar,
    School,
    Trash2,
    X,
    Loader2,
    ChevronLeft,
    ChevronRight
} from 'lucide-react'
import { Button, Input, Badge } from '../../../ui'
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter
} from '../../../ui/dialog'
import { CheckCircle2, AlertTriangle, AlertCircle } from 'lucide-react'

export default function UserManager() {
    const [users, setUsers] = useState<User[]>([])
    const [courses, setCourses] = useState<Course[]>([])
    const [isLoading, setIsLoading] = useState(true)
    const [searchQuery, setSearchQuery] = useState('')
    const [filterRole, setFilterRole] = useState<string>('all')
    const [currentPage, setCurrentPage] = useState(1)
    const [pageSize, setPageSize] = useState(20)
    const [totalUsers, setTotalUsers] = useState(0)
    const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)
    const [isEditModalOpen, setIsEditModalOpen] = useState(false)
    const [editingUser, setEditingUser] = useState<User | null>(null)
    const [isSubmitting, setIsSubmitting] = useState(false)

    const [formData, setFormData] = useState({
        username: '',
        email: '',
        password: '',
        role: 'student' as 'student' | 'teacher' | 'admin',
        class_id: ''
    })

    const [editFormData, setEditFormData] = useState({
        username: '',
        email: '',
        role: 'student' as 'student' | 'teacher' | 'admin',
        class_id: '',
        is_active: true,
        is_banned: false
    })

    // Notice dialog state
    const [notice, setNotice] = useState<{
        isOpen: boolean;
        title: string;
        message: string;
        type: 'success' | 'error' | 'warning';
        confirmText?: string;
        onConfirm?: () => void;
        showCancel?: boolean;
    }>({
        isOpen: false,
        title: '',
        message: '',
        type: 'success'
    })

    useEffect(() => {
        fetchCourses()
    }, [])

    useEffect(() => {
        const timer = window.setTimeout(() => {
            void fetchUsers()
        }, 250)
        return () => window.clearTimeout(timer)
    }, [filterRole, currentPage, pageSize, searchQuery])

    const fetchUsers = async (page = currentPage) => {
        try {
            setIsLoading(true)
            const data = await adminService.getUsers(
                page,
                pageSize,
                filterRole === 'all' ? undefined : filterRole,
                searchQuery.trim() || undefined
            )
            if (data.items.length === 0 && data.total > 0 && page > 1) {
                setCurrentPage(page - 1)
                return
            }
            setUsers(data.items)
            setTotalUsers(data.total)
        } catch (error) {
            console.error('Failed to fetch users:', error)
        } finally {
            setIsLoading(false)
        }
    }

    const fetchCourses = async () => {
        try {
            const data = await courseService.getCourses()
            setCourses(data)
        } catch (error) {
            console.error('Failed to fetch courses:', error)
        }
    }

    const handleCreateUser = async (e: React.FormEvent) => {
        e.preventDefault()
        try {
            setIsSubmitting(true)
            const payload = {
                username: formData.username.trim(),
                email: formData.email.trim(),
                password: formData.password,
                role: formData.role,
                class_id: formData.role === 'student' && formData.class_id.trim()
                    ? formData.class_id.trim()
                    : undefined
            }
            await adminService.createUser(payload)
            setIsCreateModalOpen(false)
            setFormData({ username: '', email: '', password: '', role: 'student', class_id: '' })
            setCurrentPage(1)
            await fetchUsers(1)
            setNotice({
                isOpen: true,
                title: '账号创建成功',
                message: `已成功为 ${formData.username} 创建系统账号。`,
                type: 'success'
            })
        } catch (error: any) {
            console.error('Failed to create user:', error)
            const errorMessage = error.response?.data?.detail || '请检查账号名或邮箱是否已存在，或网络连接是否正常。'
            setNotice({
                isOpen: true,
                title: '账户创建失败',
                message: typeof errorMessage === 'string' ? errorMessage : JSON.stringify(errorMessage),
                type: 'error'
            })
        } finally {
            setIsSubmitting(false)
        }
    }

    const openEditModal = (user: User) => {
        setEditingUser(user)
        setEditFormData({
            username: user.username || '',
            email: user.email || '',
            role: user.role,
            class_id: user.role === 'student' ? user.class_id || '' : '',
            is_active: user.is_active,
            is_banned: Boolean(user.is_banned)
        })
        setIsEditModalOpen(true)
    }

    const closeEditModal = () => {
        setIsEditModalOpen(false)
        setEditingUser(null)
    }

    const handleUpdateUser = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!editingUser) return
        try {
            setIsSubmitting(true)
            await adminService.updateUser(editingUser.id, {
                username: editFormData.username.trim(),
                email: editFormData.email.trim(),
                role: editFormData.role,
                class_id: editFormData.role === 'student' && editFormData.class_id.trim()
                    ? editFormData.class_id.trim()
                    : '',
                is_active: editFormData.is_active,
                is_banned: editFormData.is_banned
            })
            closeEditModal()
            await fetchUsers()
            setNotice({
                isOpen: true,
                title: '账号修改成功',
                message: `已更新 ${editFormData.username || editFormData.email} 的账号信息。`,
                type: 'success'
            })
        } catch (error: any) {
            console.error('Failed to update user:', error)
            const errorMessage = error.response?.data?.detail || '账号修改失败，请检查邮箱是否重复或稍后再试。'
            setNotice({
                isOpen: true,
                title: '账号修改失败',
                message: typeof errorMessage === 'string' ? errorMessage : JSON.stringify(errorMessage),
                type: 'error'
            })
        } finally {
            setIsSubmitting(false)
        }
    }

    const handleStatusToggle = async (user: User) => {
        try {
            const shouldBan = !user.is_banned
            await adminService.updateUser(user.id, {
                is_banned: shouldBan,
                is_active: !shouldBan
            })
            void fetchUsers()
        } catch (error) {
            console.error('Failed to toggle status:', error)
        }
    }

    const handleDelete = (userId: string) => {
        setNotice({
            isOpen: true,
            title: '删除账号确认',
            message: '确定要永久删除该用户吗？此操作将移除该用户的所有协作记录，且不可恢复。',
            type: 'warning',
            confirmText: '确认删除',
            showCancel: true,
            onConfirm: async () => {
                try {
                    await adminService.deleteUser(userId)
                    void fetchUsers()
                    setNotice(prev => ({ ...prev, isOpen: false }))
                } catch (error) {
                    console.error('Failed to delete user:', error)
                    setNotice({
                        isOpen: true,
                        title: '删除失败',
                        message: '无法删除该用户，请稍后再试。',
                        type: 'error'
                    })
                }
            }
        })
    }

    const totalPages = Math.max(1, Math.ceil(totalUsers / pageSize))
    const pageStart = totalUsers === 0 ? 0 : (currentPage - 1) * pageSize + 1
    const pageEnd = Math.min(currentPage * pageSize, totalUsers)

    return (
        <div className="space-y-6 animate-fadeIn relative">
            {/* Header */}
            <div className="flex justify-between items-center bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
                <div>
                    <h2 className="text-2xl font-bold text-slate-800 tracking-tight flex items-center gap-2">
                        <Users className="w-6 h-6 text-indigo-600" />
                        用户管理
                    </h2>
                    <p className="text-sm text-slate-500 mt-1">系统范围内所有用户的账户管理与权限控制</p>
                </div>
                <Button
                    onClick={() => setIsCreateModalOpen(true)}
                    className="bg-indigo-600 hover:bg-indigo-700 text-white gap-2 shadow-lg shadow-indigo-100"
                >
                    <UserPlus className="w-4 h-4" />
                    创建用户
                </Button>
            </div>

            {/* Filters & Search */}
            <div className="flex flex-wrap gap-4 items-center justify-between">
                <div className="relative flex-1 max-w-md">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <Input
                        placeholder="搜索姓名、邮箱或账号..."
                        className="pl-10"
                        value={searchQuery}
                        onChange={(e) => {
                            setSearchQuery(e.target.value)
                            setCurrentPage(1)
                        }}
                    />
                </div>
                <div className="flex gap-2">
                    <select
                        className="px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm text-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all font-medium"
                        value={filterRole}
                        onChange={(e) => {
                            setFilterRole(e.target.value)
                            setCurrentPage(1)
                        }}
                    >
                        <option value="all">所有角色</option>
                        <option value="student">学生 (Student)</option>
                        <option value="teacher">教师 (Teacher)</option>
                        <option value="admin">管理员 (Admin)</option>
                    </select>
                    <Button variant="outline" className="gap-2" onClick={() => void fetchUsers()}>
                        <Filter className="w-4 h-4" />
                        刷新
                    </Button>
                </div>
            </div>

            {/* User List Table */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead className="bg-slate-50/50 border-b border-gray-100 text-slate-400">
                            <tr>
                                <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider">用户信息 (姓名/账号)</th>
                                <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider">角色</th>
                                <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider">所属班级</th>
                                <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider">最后活跃</th>
                                <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider">状态</th>
                                <th className="px-6 py-4 text-right text-xs font-bold uppercase tracking-wider">操作</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50 bg-white">
                            {isLoading ? (
                                <tr>
                                    <td colSpan={6} className="px-6 py-12 text-center text-slate-400">
                                        <div className="flex flex-col items-center gap-2 animate-pulse">
                                            <div className="w-8 h-8 rounded-full border-2 border-indigo-100 border-t-indigo-600 animate-spin" />
                                            <span>正在加载用户数据...</span>
                                        </div>
                                    </td>
                                </tr>
                            ) : users.length === 0 ? (
                                <tr>
                                    <td colSpan={6} className="px-6 py-12 text-center text-slate-400">未找到符合条件的用户</td>
                                </tr>
                            ) : users.map((user) => (
                                <tr key={user.id} className="hover:bg-slate-50/50 transition-colors group">
                                    <td className="px-6 py-4">
                                        <div className="flex items-center gap-3">
                                            <div className="w-10 h-10 bg-gradient-to-br from-indigo-50 to-slate-100 rounded-xl flex items-center justify-center text-indigo-600 font-bold border border-indigo-50 shadow-sm group-hover:scale-110 transition-transform flex-shrink-0">
                                                {(user.username || user.email).charAt(0).toUpperCase()}
                                            </div>
                                            <div className="min-w-0">
                                                <div className="text-sm font-semibold text-slate-800 truncate">{user.username || user.email.split('@')[0]}</div>
                                                <div className="text-xs text-slate-400 font-mono truncate">{user.email}</div>
                                            </div>
                                        </div>
                                    </td>
                                    <td className="px-6 py-4">
                                        <Badge variant={user.role === 'admin' ? 'default' : user.role === 'teacher' ? 'secondary' : 'outline'} className="shadow-none">
                                            {user.role}
                                        </Badge>
                                    </td>
                                    <td className="px-6 py-4">
                                        {user.role === 'student' ? (
                                            <div className="flex items-center gap-1.5 text-xs text-slate-600 font-medium">
                                                <School className="w-3.5 h-3.5 text-slate-400" />
                                                {user.course_name || '未分配'}
                                            </div>
                                        ) : (
                                            <span className="text-xs text-slate-300">-</span>
                                        )}
                                    </td>
                                    <td className="px-6 py-4">
                                        <div className="flex items-center gap-1.5 text-xs text-slate-500">
                                            <Calendar className="w-3.5 h-3.5 text-slate-400" />
                                            {user.last_active ? new Date(user.last_active).toLocaleString('zh-CN', { month: 'narrow', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '从未登录'}
                                        </div>
                                    </td>
                                    <td className="px-6 py-4">
                                        <div className="flex items-center gap-1.5 cursor-pointer" onClick={() => handleStatusToggle(user)}>
                                            {user.is_banned ? (
                                                <span className="flex items-center gap-1 px-2 py-0.5 bg-red-50 text-red-600 rounded-full text-[10px] font-bold border border-red-100">
                                                    封禁
                                                </span>
                                            ) : (
                                                <span className="flex items-center gap-1 px-2 py-0.5 bg-emerald-50 text-emerald-600 rounded-full text-[10px] font-bold border border-emerald-100">
                                                    <div className="w-1 h-1 bg-emerald-500 rounded-full animate-ping" />
                                                    正常
                                                </span>
                                            )}
                                        </div>
                                    </td>
                                    <td className="px-6 py-4 text-right">
                                        <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                            <Button variant="ghost" size="sm" className="h-8 w-8 p-0" title="修改" onClick={() => openEditModal(user)}>
                                                <Edit className="w-4 h-4 text-slate-400 hover:text-indigo-600 transition-colors" />
                                            </Button>
                                            <Button variant="ghost" size="sm" className="h-8 w-8 p-0" title="删除" onClick={() => handleDelete(user.id)}>
                                                <Trash2 className="w-4 h-4 text-slate-400 hover:text-red-600 transition-colors" />
                                            </Button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
                <div className="flex flex-col gap-3 border-t border-slate-100 bg-slate-50/60 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="text-sm text-slate-500">
                        共 <span className="font-semibold text-slate-700">{totalUsers}</span> 位用户，
                        当前显示 <span className="font-semibold text-slate-700">{pageStart}</span>
                        -<span className="font-semibold text-slate-700">{pageEnd}</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                        <label className="flex items-center gap-2 text-sm text-slate-500">
                            每页
                            <select
                                value={pageSize}
                                onChange={(e) => {
                                    setPageSize(Number(e.target.value))
                                    setCurrentPage(1)
                                }}
                                className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-sm font-semibold text-slate-700 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
                            >
                                <option value={10}>10</option>
                                <option value={20}>20</option>
                                <option value={50}>50</option>
                                <option value={100}>100</option>
                            </select>
                            条
                        </label>
                        <div className="flex items-center gap-2">
                            <Button
                                variant="outline"
                                size="sm"
                                className="h-9 gap-1"
                                disabled={currentPage <= 1 || isLoading}
                                onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
                            >
                                <ChevronLeft className="h-4 w-4" />
                                上一页
                            </Button>
                            <span className="min-w-[86px] text-center text-sm font-semibold text-slate-600">
                                {currentPage} / {totalPages}
                            </span>
                            <Button
                                variant="outline"
                                size="sm"
                                className="h-9 gap-1"
                                disabled={currentPage >= totalPages || isLoading}
                                onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
                            >
                                下一页
                                <ChevronRight className="h-4 w-4" />
                            </Button>
                        </div>
                    </div>
                </div>
            </div>

            {/* Create User Modal */}
            {isCreateModalOpen && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-slate-900/30 p-6 backdrop-blur-sm animate-fadeIn">
                    <form onSubmit={handleCreateUser} className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl">
                        <div className="px-8 py-6 border-b border-gray-100 flex items-center justify-between bg-white">
                            <div>
                                <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                                    <UserPlus className="w-5 h-5 text-indigo-600" />
                                    新增系统账号
                                </h3>
                                <p className="text-xs text-slate-400 mt-0.5">请填写以下信息以创建新的系统访问凭据</p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setIsCreateModalOpen(false)}
                                className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-slate-50 text-slate-400 transition-colors"
                            >
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        <div className="flex-1 overflow-y-auto px-8 py-7">
                            <div className="grid gap-8 xl:grid-cols-[1.1fr_0.9fr]">
                            <div className="space-y-4">
                                <h4 className="text-[10px] font-black text-slate-300 uppercase tracking-widest border-b border-slate-50 pb-2">基础信息</h4>
                                <div className="space-y-4">
                                    <div className="space-y-1.5">
                                        <label className="text-xs font-bold text-slate-600 ml-1">用户姓名</label>
                                        <Input
                                            required
                                            value={formData.username}
                                            onChange={e => setFormData({ ...formData, username: e.target.value })}
                                            placeholder="例如：张三"
                                        />
                                    </div>
                                    <div className="space-y-1.5">
                                        <label className="text-xs font-bold text-slate-600 ml-1">登录邮箱 / 账号</label>
                                        <Input
                                            required
                                            type="email"
                                            value={formData.email}
                                            onChange={e => setFormData({ ...formData, email: e.target.value })}
                                            placeholder="zhangsan@example.com"
                                        />
                                    </div>
                                    <div className="space-y-1.5">
                                        <label className="text-xs font-bold text-slate-600 ml-1">初始密码</label>
                                        <Input
                                            required
                                            type="password"
                                            value={formData.password}
                                            onChange={e => setFormData({ ...formData, password: e.target.value })}
                                            placeholder="••••••••"
                                        />
                                    </div>
                                </div>
                            </div>

                            <div className="space-y-4">
                                <h4 className="text-[10px] font-black text-slate-300 uppercase tracking-widest border-b border-slate-50 pb-2">权限与角色</h4>
                                <div className="space-y-4">
                                    <div className="space-y-1.5">
                                        <label className="text-xs font-bold text-slate-600 ml-1">系统角色</label>
                                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 lg:grid-cols-1">
                                            {(['student', 'teacher', 'admin'] as const).map((role) => (
                                                <button
                                                    key={role}
                                                    type="button"
                                                    onClick={() => setFormData({ ...formData, role })}
                                                    className={`flex items-center gap-3 rounded-xl border-2 px-4 py-4 text-left transition-all ${formData.role === role ? 'border-indigo-600 bg-indigo-50/50 text-indigo-700 shadow-sm shadow-indigo-100' : 'border-slate-100 hover:border-slate-200 text-slate-400'}`}
                                                >
                                                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${formData.role === role ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-400'}`}>
                                                        {role === 'student' && <Users className="w-4 h-4" />}
                                                        {role === 'teacher' && <School className="w-4 h-4" />}
                                                        {role === 'admin' && <Shield className="w-4 h-4" />}
                                                    </div>
                                                    <div>
                                                        <span className="block text-xs font-black uppercase tracking-wider">{role}</span>
                                                        <span className="mt-0.5 block text-[11px] font-medium text-slate-400">
                                                            {role === 'student' && '加入班级与小组项目'}
                                                            {role === 'teacher' && '管理班级、项目和数据'}
                                                            {role === 'admin' && '管理系统配置与账号'}
                                                        </span>
                                                    </div>
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                    {formData.role === 'student' && (
                                        <div className="space-y-1.5 rounded-2xl border border-slate-100 bg-slate-50/60 p-4">
                                            <label className="text-xs font-bold text-slate-600 ml-1">所属班级</label>
                                            <select
                                                value={formData.class_id}
                                                onChange={e => setFormData({ ...formData, class_id: e.target.value })}
                                                className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none transition-all focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
                                            >
                                                <option value="">暂不分配班级</option>
                                                {courses.map(course => (
                                                    <option key={course.id} value={course.id}>
                                                        {course.name} {course.semester ? `(${course.semester})` : ''}
                                                    </option>
                                                ))}
                                            </select>
                                            <p className="text-[11px] leading-relaxed text-slate-400">
                                                学生也可以后续通过班级邀请码加入；此处选择班级会直接建立学生与班级的归属关系。
                                            </p>
                                        </div>
                                    )}
                                </div>
                            </div>
                            </div>
                        </div>

                        <div className="px-8 py-5 border-t border-gray-100 bg-slate-50/80 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                            <Button type="button" variant="outline" className="h-11 w-full font-bold text-xs sm:w-40" onClick={() => setIsCreateModalOpen(false)}>取消返回</Button>
                            <Button
                                type="submit"
                                disabled={isSubmitting}
                                className="h-11 w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs shadow-lg shadow-indigo-100 sm:w-48"
                            >
                                {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : '确认创建账号'}
                            </Button>
                        </div>
                    </form>
                </div>
            )}

            {/* Edit User Modal */}
            {isEditModalOpen && editingUser && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-slate-900/30 p-6 backdrop-blur-sm animate-fadeIn">
                    <form onSubmit={handleUpdateUser} className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl">
                        <div className="flex items-center justify-between border-b border-gray-100 bg-white px-8 py-6">
                            <div>
                                <h3 className="flex items-center gap-2 text-lg font-bold text-slate-800">
                                    <Edit className="h-5 w-5 text-indigo-600" />
                                    修改用户账号
                                </h3>
                                <p className="mt-0.5 text-xs text-slate-400">调整用户基础信息、角色、班级归属和账号状态</p>
                            </div>
                            <button
                                type="button"
                                onClick={closeEditModal}
                                className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-50"
                            >
                                <X className="h-5 w-5" />
                            </button>
                        </div>

                        <div className="flex-1 overflow-y-auto px-8 py-7">
                            <div className="grid gap-5 sm:grid-cols-2">
                                <div className="space-y-1.5">
                                    <label className="ml-1 text-xs font-bold text-slate-600">用户姓名</label>
                                    <Input
                                        required
                                        value={editFormData.username}
                                        onChange={e => setEditFormData({ ...editFormData, username: e.target.value })}
                                        placeholder="例如：张三"
                                    />
                                </div>
                                <div className="space-y-1.5">
                                    <label className="ml-1 text-xs font-bold text-slate-600">登录邮箱 / 账号</label>
                                    <Input
                                        required
                                        type="email"
                                        value={editFormData.email}
                                        onChange={e => setEditFormData({ ...editFormData, email: e.target.value })}
                                        placeholder="zhangsan@example.com"
                                    />
                                </div>
                            </div>

                            <div className="mt-6 space-y-4">
                                <div className="space-y-1.5">
                                    <label className="ml-1 text-xs font-bold text-slate-600">系统角色</label>
                                    <div className="grid gap-3 sm:grid-cols-3">
                                        {(['student', 'teacher', 'admin'] as const).map((role) => (
                                            <button
                                                key={role}
                                                type="button"
                                                onClick={() => setEditFormData({
                                                    ...editFormData,
                                                    role,
                                                    class_id: role === 'student' ? editFormData.class_id : ''
                                                })}
                                                className={`rounded-xl border-2 px-4 py-3 text-left transition-all ${editFormData.role === role ? 'border-indigo-600 bg-indigo-50/50 text-indigo-700 shadow-sm shadow-indigo-100' : 'border-slate-100 text-slate-400 hover:border-slate-200'}`}
                                            >
                                                <span className="block text-xs font-black uppercase tracking-wider">{role}</span>
                                                <span className="mt-1 block text-[11px] font-medium text-slate-400">
                                                    {role === 'student' && '学生账号'}
                                                    {role === 'teacher' && '教师账号'}
                                                    {role === 'admin' && '管理员账号'}
                                                </span>
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                {editFormData.role === 'student' && (
                                    <div className="space-y-1.5 rounded-2xl border border-slate-100 bg-slate-50/60 p-4">
                                        <label className="ml-1 text-xs font-bold text-slate-600">所属班级</label>
                                        <select
                                            value={editFormData.class_id}
                                            onChange={e => setEditFormData({ ...editFormData, class_id: e.target.value })}
                                            className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none transition-all focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
                                        >
                                            <option value="">暂不分配班级</option>
                                            {courses.map(course => (
                                                <option key={course.id} value={course.id}>
                                                    {course.name} {course.semester ? `(${course.semester})` : ''}
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                )}

                                <div className="grid gap-3 rounded-2xl border border-slate-100 bg-white p-4 sm:grid-cols-2">
                                    <label className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-600">
                                        账号启用
                                        <input
                                            type="checkbox"
                                            checked={editFormData.is_active}
                                            onChange={e => setEditFormData({ ...editFormData, is_active: e.target.checked })}
                                            className="h-4 w-4 accent-indigo-600"
                                        />
                                    </label>
                                    <label className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-600">
                                        封禁账号
                                        <input
                                            type="checkbox"
                                            checked={editFormData.is_banned}
                                            onChange={e => setEditFormData({ ...editFormData, is_banned: e.target.checked })}
                                            className="h-4 w-4 accent-red-600"
                                        />
                                    </label>
                                </div>
                            </div>
                        </div>

                        <div className="flex flex-col-reverse gap-3 border-t border-gray-100 bg-slate-50/80 px-8 py-5 sm:flex-row sm:justify-end">
                            <Button type="button" variant="outline" className="h-11 w-full font-bold text-xs sm:w-40" onClick={closeEditModal}>取消返回</Button>
                            <Button
                                type="submit"
                                disabled={isSubmitting}
                                className="h-11 w-full bg-indigo-600 text-xs font-bold text-white shadow-lg shadow-indigo-100 hover:bg-indigo-700 sm:w-48"
                            >
                                {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : '保存修改'}
                            </Button>
                        </div>
                    </form>
                </div>
            )}

            {/* Global Notice Modal */}
            <Dialog open={notice.isOpen} onOpenChange={(open) => setNotice(prev => ({ ...prev, isOpen: open }))}>
                <DialogContent className="max-w-md p-0 overflow-hidden bg-white border-none shadow-2xl rounded-3xl">
                    <div className="p-8 flex flex-col items-center text-center">
                        <div className={`w-16 h-16 rounded-2xl flex items-center justify-center mb-6 shadow-xl ${notice.type === 'success' ? 'bg-emerald-500 text-white shadow-emerald-100' :
                            notice.type === 'warning' ? 'bg-amber-500 text-white shadow-amber-100' :
                                'bg-rose-500 text-white shadow-rose-100'
                            }`}>
                            {notice.type === 'success' && <CheckCircle2 className="w-8 h-8" />}
                            {notice.type === 'warning' && <AlertTriangle className="w-8 h-8" />}
                            {notice.type === 'error' && <AlertCircle className="w-8 h-8" />}
                        </div>

                        <DialogHeader className="p-0 text-center sm:text-center space-y-2">
                            <DialogTitle className="text-xl font-bold text-slate-800">
                                {notice.title}
                            </DialogTitle>
                            <DialogDescription className="text-slate-500 text-sm leading-relaxed max-w-[280px] mx-auto">
                                {notice.message}
                            </DialogDescription>
                        </DialogHeader>
                    </div>

                    <DialogFooter className="p-4 bg-slate-50/50 flex flex-row gap-3 sm:justify-center border-t border-slate-100/50">
                        {notice.showCancel && (
                            <Button
                                variant="outline"
                                className="flex-1 h-11 font-bold text-xs rounded-xl"
                                onClick={() => setNotice(prev => ({ ...prev, isOpen: false }))}
                            >
                                取消
                            </Button>
                        )}
                        <Button
                            className={`flex-1 h-11 font-bold text-xs rounded-xl shadow-lg ${notice.type === 'success' ? 'bg-indigo-600 hover:bg-indigo-700 shadow-indigo-100' :
                                notice.type === 'warning' ? 'bg-amber-600 hover:bg-amber-700 shadow-amber-100' :
                                    'bg-rose-600 hover:bg-rose-700 shadow-rose-100'
                                }`}
                            onClick={notice.onConfirm || (() => setNotice(prev => ({ ...prev, isOpen: false })))}
                        >
                            {notice.confirmText || '我知道了'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}
