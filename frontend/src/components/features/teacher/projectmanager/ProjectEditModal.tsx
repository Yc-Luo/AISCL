import { useState, useEffect } from 'react'
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
    Button,
    Input,
    Badge
} from '../../../ui'
import {
    X,
    Plus,
    Trash2,
    FileText,
    Upload,
    Search,
    Loader2,
    Users
} from 'lucide-react'
import { projectService } from '../../../../services/api/project'
import { storageService } from '../../../../services/api/storage'
import { userService } from '../../../../services/api/user'
import { Project, User, Resource } from '../../../../types'
import { cn } from '../../../../lib/utils'
import { courseService, Course } from '../../../../services/api/course'

interface ProjectEditModalProps {
    isOpen: boolean
    onClose: () => void
    project?: Project | null // if null/undefined, it's "Create" mode
    onSuccess: () => void
}

export default function ProjectEditModal({
    isOpen,
    onClose,
    project,
    onSuccess
}: ProjectEditModalProps) {
    const isEdit = !!project
    const [loading, setLoading] = useState(false)
    const [formData, setFormData] = useState({
        name: '',
        description: '',
        is_archived: false,
        course_id: '',
        inherit_course_template: true,
    })
    const [courses, setCourses] = useState<Course[]>([])

    // Members state
    const [members, setMembers] = useState<User[]>([])
    const [courseStudents, setCourseStudents] = useState<User[]>([])
    const [loadingCourseStudents, setLoadingCourseStudents] = useState(false)
    const [searchTerm, setSearchTerm] = useState('')
    const [searchResults, setSearchResults] = useState<User[]>([])
    const [searching, setSearching] = useState(false)

    // Resources state
    const [resources, setResources] = useState<Resource[]>([])
    const [uploading, setUploading] = useState(false)

    // Initialize data
    useEffect(() => {
        const fetchCourses = async () => {
            try {
                const data = await courseService.getCourses()
                setCourses(data)
            } catch (error) {
                console.error('Failed to fetch courses:', error)
            }
        }
        fetchCourses()
    }, [])

    useEffect(() => {
        if (project) {
            setFormData({
                name: project.name,
                description: project.description || '',
                is_archived: project.is_archived,
                course_id: project.course_id || '',
                inherit_course_template: true,
            })
            // Fetch resources
            fetchResources(project.id)
            // Fetch full member details
            fetchMembers(project.members.map((m) => m.user_id))
        } else {
            setFormData({
                name: '',
                description: '',
                is_archived: false,
                course_id: '',
                inherit_course_template: true,
            })
            setMembers([])
            setResources([])
        }
    }, [project, isOpen])

    useEffect(() => {
        if (!isOpen || !formData.course_id) {
            setCourseStudents([])
            return
        }

        let cancelled = false
        const fetchCourseStudents = async () => {
            setLoadingCourseStudents(true)
            try {
                const students = await courseService.getCourseStudents(formData.course_id)
                if (!cancelled) {
                    setCourseStudents(students as User[])
                }
            } catch (error) {
                console.error('Failed to fetch course students:', error)
                if (!cancelled) setCourseStudents([])
            } finally {
                if (!cancelled) setLoadingCourseStudents(false)
            }
        }

        fetchCourseStudents()
        return () => {
            cancelled = true
        }
    }, [formData.course_id, isOpen])

    const fetchResources = async (id: string) => {
        try {
            const data = await storageService.getResources(id)
            setResources(data.resources)
        } catch (error) {
            console.error('Failed to fetch resources:', error)
        }
    }

    const fetchMembers = async (ids: string[]) => {
        if (ids.length === 0) return
        try {
            const users = await userService.getUsers(ids)
            setMembers(users)
        } catch (error) {
            console.error('Failed to fetch members:', error)
        }
    }

    const handleSearchUsers = async (val: string) => {
        setSearchTerm(val)
        if (val.length < 2) {
            setSearchResults([])
            return
        }
        setSearching(true)
        try {
            const users = await userService.searchUsers({
                search: val,
                role: 'student',
                class_id: formData.course_id || undefined,
            })
            setSearchResults(users.filter(u => !members.find(m => m.id === u.id)))
        } catch (error) {
            console.error('Search failed:', error)
        } finally {
            setSearching(false)
        }
    }

    const addMember = (user: User) => {
        if (members.some((member) => member.id === user.id)) return
        setMembers([...members, user])
        setSearchTerm('')
        setSearchResults([])
    }

    const removeMember = (userId: string) => {
        setMembers(members.filter((m) => m.id !== userId))
    }

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        if (!file || !project) return

        setUploading(true)
        try {
            // 1. Get presigned URL
            const { upload_url, file_key } = await storageService.getPresignedUploadUrl(
                project.id,
                file.name,
                file.type,
                file.size
            )

            // 2. Upload to S3/MinIO
            await storageService.uploadFile(upload_url, file)

            // 3. Create Resource record
            const newRes = await storageService.createResource({
                project_id: project.id,
                filename: file.name,
                file_key: file_key,
                size: file.size,
                mime_type: file.type
            })

            setResources([...resources, newRes])
        } catch (error) {
            console.error('Upload failed:', error)
            alert('上传失败')
        } finally {
            setUploading(false)
        }
    }

    const toggleCourseStudent = (student: User) => {
        if (members.some((member) => member.id === student.id)) {
            removeMember(student.id)
            return
        }
        addMember(student)
    }

    const handleDeleteResource = async (resId: string) => {
        if (!project) return
        try {
            await storageService.deleteResource(project.id, resId)
            setResources(resources.filter(r => r.id !== resId))
        } catch (error) {
            console.error('Delete failed:', error)
        }
    }

    const handleSubmit = async () => {
        if (!formData.name.trim()) return
        setLoading(true)
        try {
            if (isEdit && project) {
                await projectService.updateProject(project.id, {
                    name: formData.name,
                    description: formData.description,
                    is_archived: formData.is_archived,
                })
                // Note: Project members update might need separate logic if backend doesn't handle list replacement
                // For now we assume we just updated the basic info.
                // If we want to sync members:
                const oldIds = project.members.map(m => m.user_id)
                const newIds = members.map(m => m.id)

                // Add new
                for (const id of newIds) {
                    if (!oldIds.includes(id)) {
                        await projectService.addMember(project.id, { userId: id, role: 'editor' })
                    }
                }
                // Remove old
                for (const id of oldIds) {
                    if (!newIds.includes(id)) {
                        await projectService.removeMember(project.id, id)
                    }
                }

            } else {
                const newProj = await projectService.createProject({
                    name: formData.name,
                    description: formData.description,
                    course_id: formData.course_id || undefined,
                    inherit_course_template: formData.inherit_course_template,
                })
                // Add members if any
                for (const m of members) {
                    await projectService.addMember(newProj.id, { userId: m.id, role: 'editor' })
                }
            }
            onSuccess()
            onClose()
        } catch (error) {
            console.error('Submit failed:', error)
            alert('操作失败，请检查输入')
        } finally {
            setLoading(false)
        }
    }

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto custom-scrollbar">
                <DialogHeader>
                    <DialogTitle>{isEdit ? '修改小组' : '创建新小组'}</DialogTitle>
                    <DialogDescription className="text-sm text-slate-500">
                        {isEdit ? '编辑小组基本信息、成员配置以及初始学习资源。' : '建立一个新的小组空间，配置基础信息并添加初始成员。'}
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-6 py-4">
                    {/* Basic Info */}
                    <div className="space-y-4">
                        <div className="space-y-2">
                            <label className="text-sm font-medium text-slate-700">小组名称</label>
                            <Input
                                placeholder="请输入小组名称"
                                value={formData.name}
                                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFormData({ ...formData, name: e.target.value })}
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium text-slate-700">小组描述</label>
                            <textarea
                                className="w-full min-h-[100px] p-3 rounded-lg border border-slate-200 text-sm focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none"
                                placeholder="请输入小组目标和描述..."
                                value={formData.description}
                                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setFormData({ ...formData, description: e.target.value })}
                            />
                        </div>
                        {!isEdit && (
                            <>
                                <div className="space-y-2">
                                    <label className="text-sm font-medium text-slate-700">所属班级（可选）</label>
                                    <select
                                        value={formData.course_id}
                                        onChange={(e) => {
                                            setFormData({ ...formData, course_id: e.target.value })
                                            setSearchTerm('')
                                            setSearchResults([])
                                            setMembers([])
                                        }}
                                        className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none"
                                    >
                                        <option value="">不绑定班级</option>
                                        {courses.map((course) => (
                                            <option key={course.id} value={course.id}>
                                                {course.name}（{course.semester}）
                                            </option>
                                        ))}
                                    </select>
                                </div>
                                {formData.course_id && (
                                    <label className="flex items-start gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-700">
                                        <input
                                            type="checkbox"
                                            className="mt-0.5"
                                            checked={formData.inherit_course_template}
                                            onChange={(e) => setFormData({ ...formData, inherit_course_template: e.target.checked })}
                                        />
                                        <span>
                                            创建小组时继承班级实验模板与初始任务文档
                                        </span>
                                    </label>
                                )}
                            </>
                        )}
                    </div>

                    {/* Member Management */}
                    <div className="space-y-3">
                        <div className="flex items-center justify-between">
                            <label className="text-sm font-medium text-slate-700">小组成员 ({members.length})</label>
                        </div>

                        {formData.course_id && (
                            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                                <div className="mb-2 flex items-center justify-between gap-3">
                                    <div className="flex items-center gap-2 text-xs font-semibold text-slate-600">
                                        <Users className="h-3.5 w-3.5 text-indigo-500" />
                                        从所选班级选择学生
                                    </div>
                                    {courseStudents.length > 0 && (
                                        <span className="text-[11px] text-slate-400">{courseStudents.length} 名学生</span>
                                    )}
                                </div>
                                {loadingCourseStudents ? (
                                    <div className="flex items-center gap-2 py-2 text-xs text-slate-400">
                                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                        正在加载班级学生...
                                    </div>
                                ) : courseStudents.length > 0 ? (
                                    <div className="max-h-44 overflow-y-auto rounded-lg bg-white p-2">
                                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                                            {courseStudents.map((student) => {
                                                const selected = members.some((member) => member.id === student.id)
                                                return (
                                                    <button
                                                        key={student.id}
                                                        type="button"
                                                        onClick={() => toggleCourseStudent(student)}
                                                        className={cn(
                                                            "flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left text-xs transition-colors",
                                                            selected
                                                                ? "border-indigo-200 bg-indigo-50 text-indigo-700"
                                                                : "border-slate-100 bg-white text-slate-600 hover:border-indigo-100 hover:bg-indigo-50/60"
                                                        )}
                                                    >
                                                        <span className="min-w-0 truncate">
                                                            {student.username}
                                                            <span className="ml-1 text-slate-400">({student.email})</span>
                                                        </span>
                                                        <span className={cn(
                                                            "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold",
                                                            selected ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-400"
                                                        )}>
                                                            {selected ? '已选' : '选择'}
                                                        </span>
                                                    </button>
                                                )
                                            })}
                                        </div>
                                    </div>
                                ) : (
                                    <div className="rounded-lg bg-white px-3 py-2 text-xs text-slate-400">
                                        当前班级暂无学生，请先通过邀请码或批量导入加入学生。
                                    </div>
                                )}
                            </div>
                        )}

                        <div className="relative">
                            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                            <Input
                                className="pl-9"
                                placeholder={formData.course_id ? "在当前班级内搜索学生..." : "搜索并添加学生..."}
                                value={searchTerm}
                                onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleSearchUsers(e.target.value)}
                            />
                            {searchTerm.length >= 2 && (
                                <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-xl z-10 max-h-48 overflow-y-auto">
                                    {searching ? (
                                        <div className="p-4 text-center text-sm text-slate-500 flex items-center justify-center gap-2">
                                            <Loader2 className="w-4 h-4 animate-spin" /> 搜索中...
                                        </div>
                                    ) : searchResults.length > 0 ? (
                                        searchResults.map(user => (
                                            <button
                                                key={user.id}
                                                className="w-full px-4 py-2 text-left hover:bg-slate-50 flex items-center justify-between text-sm"
                                                onClick={() => addMember(user)}
                                            >
                                                <div className="flex items-center gap-2">
                                                    <div className="w-6 h-6 rounded-full bg-indigo-100 flex items-center justify-center text-[10px] font-bold text-indigo-700">
                                                        {user.username[0].toUpperCase()}
                                                    </div>
                                                    <span>{user.username} ({user.email})</span>
                                                </div>
                                                <Plus className="w-4 h-4 text-slate-400" />
                                            </button>
                                        ))
                                    ) : (
                                        <div className="p-4 text-center text-sm text-slate-500">未找到相关学生</div>
                                    )}
                                </div>
                            )}
                        </div>

                        <div className="flex flex-wrap gap-2 pt-2">
                            {members.map(member => (
                                <Badge
                                    key={member.id}
                                    variant="secondary"
                                    className="pl-1 pr-1 py-1 gap-1 flex items-center bg-indigo-50 text-indigo-700 border-indigo-100"
                                >
                                    <div className="w-5 h-5 rounded-full bg-indigo-200 flex items-center justify-center text-[8px] font-bold">
                                        {member.username[0].toUpperCase()}
                                    </div>
                                    <span className="max-w-[100px] truncate">{member.username}</span>
                                    <button
                                        onClick={() => removeMember(member.id)}
                                        className="hover:bg-indigo-200 rounded-full p-0.5 transition-colors"
                                    >
                                        <X className="w-3 h-3" />
                                    </button>
                                </Badge>
                            ))}
                        </div>
                    </div>

                    {/* Resource Management */}
                    <div className="space-y-3 pt-4 border-t border-slate-100">
                        <div className="flex items-center justify-between">
                            <label className="text-sm font-medium text-slate-700 flex items-center gap-2">
                                <FileText className="w-4 h-4" /> 初始资源
                            </label>
                            {isEdit && (
                                <div className="relative">
                                    <input
                                        type="file"
                                        id="resource-upload"
                                        className="hidden"
                                        onChange={handleFileUpload}
                                        disabled={uploading}
                                    />
                                    <label
                                        htmlFor="resource-upload"
                                        className={cn(
                                            "flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-lg cursor-pointer transition-colors",
                                            uploading && "opacity-50 cursor-not-allowed"
                                        )}
                                    >
                                        {uploading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />}
                                        上传文件
                                    </label>
                                </div>
                            )}
                        </div>

                        {!isEdit ? (
                            <p className="text-xs text-slate-400 italic">创建小组后即可上传初始资源</p>
                        ) : resources.length > 0 ? (
                            <div className="grid grid-cols-2 gap-3">
                                {resources.map((res) => (
                                    <div key={res.id} className="flex items-center justify-between p-2 rounded-lg border border-slate-100 bg-slate-50 group">
                                        <div className="flex items-center gap-2 min-w-0">
                                            <FileText className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                                            <span className="text-xs text-slate-600 truncate">{res.filename}</span>
                                        </div>
                                        <button
                                            onClick={() => handleDeleteResource(res.id)}
                                            className="p-1 text-slate-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                                        >
                                            <Trash2 className="w-3 h-3" />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="text-center py-6 border-2 border-dashed border-slate-100 rounded-xl">
                                <FileText className="w-8 h-8 text-slate-100 mx-auto mb-2" />
                                <p className="text-xs text-slate-400">暂无资源文件</p>
                            </div>
                        )}
                    </div>
                </div>

                <DialogFooter className="gap-2 sm:gap-0">
                    <Button variant="ghost" onClick={onClose} disabled={loading}>
                        取消
                    </Button>
                    <Button
                        className="bg-indigo-600 hover:bg-indigo-700 text-white"
                        onClick={handleSubmit}
                        disabled={loading || !formData.name.trim() || (!isEdit && members.length === 0)}
                    >
                        {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                        {isEdit ? '保存修改' : '立即创建'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
