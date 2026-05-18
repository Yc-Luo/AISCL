import { useEffect, useMemo, useState } from 'react'
import { CheckCircle2, ChevronDown, Loader2, Save, Search, ShieldCheck, Tags } from 'lucide-react'
import { Button, Input, Badge } from '../../../ui'
import { adminService, ConfigPermissions as PermissionSet, ConfigPermissionOptions, User } from '../../../../services/api/admin'

const EMPTY_PERMISSIONS: PermissionSet = {
    allowed_template_ids: [],
    allowed_rule_profile_ids: [],
    allowed_model_ids: [],
}

export default function ConfigPermissions() {
    const [teachers, setTeachers] = useState<User[]>([])
    const [options, setOptions] = useState<ConfigPermissionOptions>({ templates: [], rule_profiles: [], models: [], teacher_tags: [] })
    const [search, setSearch] = useState('')
    const [tagFilter, setTagFilter] = useState('')
    const [page, setPage] = useState(1)
    const [total, setTotal] = useState(0)
    const [expandedId, setExpandedId] = useState<string | null>(null)
    const [selectedIds, setSelectedIds] = useState<string[]>([])
    const [drafts, setDrafts] = useState<Record<string, { tags: string; permissions: PermissionSet | null }>>({})
    const [notice, setNotice] = useState('')
    const [isLoading, setIsLoading] = useState(true)
    const [isSaving, setIsSaving] = useState(false)

    useEffect(() => {
        void fetchOptions()
    }, [])

    useEffect(() => {
        const timer = window.setTimeout(() => void fetchTeachers(), 250)
        return () => window.clearTimeout(timer)
    }, [search, tagFilter, page])

    const fetchOptions = async () => {
        try {
            const data = await adminService.getConfigPermissionOptions()
            setOptions(data)
        } catch (error) {
            console.error('Failed to fetch permission options:', error)
        }
    }

    const fetchTeachers = async () => {
        try {
            setIsLoading(true)
            const data = await adminService.getTeacherPermissions({
                page,
                limit: 20,
                search: search.trim() || undefined,
                tag: tagFilter || undefined,
            })
            setTeachers(data.items)
            setTotal(data.total)
            const nextDrafts: Record<string, { tags: string; permissions: PermissionSet | null }> = {}
            data.items.forEach((teacher) => {
                nextDrafts[teacher.id] = {
                    tags: (teacher.teacher_tags || []).join(', '),
                    permissions: teacher.config_permissions || null,
                }
            })
            setDrafts((previous) => ({ ...previous, ...nextDrafts }))
        } catch (error) {
            console.error('Failed to fetch teacher permissions:', error)
        } finally {
            setIsLoading(false)
        }
    }

    const totalPages = Math.max(1, Math.ceil(total / 20))
    const selectedTeachers = useMemo(() => teachers.filter((teacher) => selectedIds.includes(teacher.id)), [teachers, selectedIds])

    const updateDraft = (teacherId: string, updater: (draft: { tags: string; permissions: PermissionSet | null }) => { tags: string; permissions: PermissionSet | null }) => {
        setDrafts((previous) => {
            const current = previous[teacherId] || { tags: '', permissions: null }
            return { ...previous, [teacherId]: updater(current) }
        })
    }

    const setPermissionMode = (teacherId: string, unrestricted: boolean) => {
        updateDraft(teacherId, (draft) => ({
            ...draft,
            permissions: unrestricted ? null : { ...(draft.permissions || EMPTY_PERMISSIONS) },
        }))
    }

    const togglePermission = (teacherId: string, key: keyof PermissionSet, value: string) => {
        updateDraft(teacherId, (draft) => {
            const permissions = { ...(draft.permissions || EMPTY_PERMISSIONS) }
            const currentValues = permissions[key] || []
            permissions[key] = currentValues.includes(value)
                ? currentValues.filter((item) => item !== value)
                : [...currentValues, value]
            return { ...draft, permissions }
        })
    }

    const saveTeacher = async (teacher: User) => {
        const draft = drafts[teacher.id]
        if (!draft) return
        try {
            setIsSaving(true)
            await adminService.updateTeacherPermissions(teacher.id, {
                teacher_tags: splitTags(draft.tags),
                config_permissions: draft.permissions,
            })
            setNotice(`已保存 ${teacher.username || teacher.email} 的配置权限。`)
            await Promise.all([fetchOptions(), fetchTeachers()])
        } catch (error) {
            console.error('Failed to save teacher permissions:', error)
            setNotice('保存失败，请检查管理员权限或网络状态。')
        } finally {
            setIsSaving(false)
        }
    }

    const batchApply = async () => {
        if (selectedIds.length === 0) {
            setNotice('请先勾选需要批量分配的教师。')
            return
        }
        const firstDraft = selectedTeachers[0] ? drafts[selectedTeachers[0].id] : null
        if (!firstDraft) return
        try {
            setIsSaving(true)
            await adminService.batchUpdateTeacherPermissions({
                teacher_ids: selectedIds,
                teacher_tags: splitTags(firstDraft.tags),
                config_permissions: firstDraft.permissions,
                replace_tags: true,
            })
            setNotice(`已将第一位选中教师的权限批量应用到 ${selectedIds.length} 位教师。`)
            await Promise.all([fetchOptions(), fetchTeachers()])
        } catch (error) {
            console.error('Failed to batch apply permissions:', error)
            setNotice('批量分配失败，请稍后重试。')
        } finally {
            setIsSaving(false)
        }
    }

    return (
        <div className="space-y-6 animate-fadeIn">
            <div className="flex flex-col gap-4 rounded-2xl border border-gray-100 bg-white p-6 shadow-sm xl:flex-row xl:items-start xl:justify-between">
                <div>
                    <h2 className="flex items-center gap-2 text-2xl font-bold text-slate-800">
                        <ShieldCheck className="h-6 w-6 text-indigo-600" />
                        配置权限
                    </h2>
                    <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-500">
                        将实验模板、规则集和模型池按教师分配。未设置权限的教师默认全部可用，避免影响已有实验。
                    </p>
                </div>
                <Button onClick={batchApply} disabled={isSaving || selectedIds.length === 0} className="gap-2 bg-indigo-600 text-white hover:bg-indigo-700">
                    {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                    批量应用首选教师权限
                </Button>
            </div>

            {notice ? (
                <div className="flex items-center gap-2 rounded-2xl border border-indigo-100 bg-indigo-50 px-4 py-3 text-sm font-medium text-indigo-800">
                    <CheckCircle2 className="h-4 w-4" />
                    {notice}
                </div>
            ) : null}

            <div className="flex flex-col gap-3 rounded-2xl border border-slate-100 bg-white p-4 shadow-sm lg:flex-row lg:items-center lg:justify-between">
                <div className="relative max-w-xl flex-1">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <Input className="pl-10" placeholder="搜索教师姓名或账号" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1) }} />
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <select
                        className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
                        value={tagFilter}
                        onChange={(event) => { setTagFilter(event.target.value); setPage(1) }}
                    >
                        <option value="">所有教师标签</option>
                        {options.teacher_tags.map((tag) => <option key={tag} value={tag}>{tag}</option>)}
                    </select>
                    <Badge variant="secondary" className="bg-slate-100 text-slate-600">共 {total} 位教师</Badge>
                </div>
            </div>

            <div className="overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-sm">
                <div className="grid grid-cols-[48px_1.2fr_0.8fr_0.8fr_0.8fr_96px] border-b border-slate-100 bg-slate-50 px-4 py-3 text-xs font-bold uppercase tracking-wider text-slate-400">
                    <span />
                    <span>教师</span>
                    <span>模板</span>
                    <span>规则集</span>
                    <span>模型</span>
                    <span className="text-right">操作</span>
                </div>
                {isLoading ? (
                    <div className="flex h-40 items-center justify-center text-slate-400">
                        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                        正在加载教师权限...
                    </div>
                ) : teachers.length === 0 ? (
                    <div className="py-16 text-center text-sm text-slate-400">暂无符合条件的教师</div>
                ) : teachers.map((teacher) => {
                    const draft = drafts[teacher.id] || { tags: '', permissions: teacher.config_permissions || null }
                    const permissions = draft.permissions
                    const unrestricted = !permissions
                    return (
                        <div key={teacher.id} className="border-b border-slate-50 last:border-b-0">
                            <div className="grid grid-cols-[48px_1.2fr_0.8fr_0.8fr_0.8fr_96px] items-center px-4 py-4 text-sm">
                                <input
                                    type="checkbox"
                                    checked={selectedIds.includes(teacher.id)}
                                    onChange={(event) => setSelectedIds((previous) => event.target.checked ? [...previous, teacher.id] : previous.filter((id) => id !== teacher.id))}
                                    className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                                />
                                <div className="min-w-0">
                                    <div className="font-bold text-slate-800">{teacher.username || teacher.email}</div>
                                    <div className="mt-1 truncate text-xs text-slate-400">{teacher.email}</div>
                                    <div className="mt-2 flex flex-wrap gap-1">
                                        {(teacher.teacher_tags || []).map((tag) => <Badge key={tag} variant="secondary" className="bg-indigo-50 text-indigo-700">{tag}</Badge>)}
                                    </div>
                                </div>
                                <PermissionCount unrestricted={unrestricted} selected={permissions?.allowed_template_ids?.length || 0} total={options.templates.length} />
                                <PermissionCount unrestricted={unrestricted} selected={permissions?.allowed_rule_profile_ids?.length || 0} total={options.rule_profiles.length} />
                                <PermissionCount unrestricted={unrestricted} selected={permissions?.allowed_model_ids?.length || 0} total={options.models.length} />
                                <button
                                    type="button"
                                    onClick={() => setExpandedId(expandedId === teacher.id ? null : teacher.id)}
                                    className="ml-auto flex items-center justify-end gap-1 text-xs font-bold text-indigo-600"
                                >
                                    展开
                                    <ChevronDown className={`h-4 w-4 transition ${expandedId === teacher.id ? 'rotate-180' : ''}`} />
                                </button>
                            </div>
                            {expandedId === teacher.id ? (
                                <div className="space-y-5 bg-slate-50/70 px-6 py-5">
                                    <div className="grid gap-4 lg:grid-cols-[1fr_220px]">
                                        <label className="space-y-2">
                                            <span className="flex items-center gap-2 text-sm font-semibold text-slate-700"><Tags className="h-4 w-4" />教师标签</span>
                                            <Input value={draft.tags} onChange={(event) => updateDraft(teacher.id, (current) => ({ ...current, tags: event.target.value }))} placeholder="例如：实验组, 2026春季" />
                                        </label>
                                        <label className="flex items-center gap-2 rounded-2xl border border-slate-100 bg-white px-4 py-3 text-sm font-semibold text-slate-700">
                                            <input type="checkbox" checked={unrestricted} onChange={(event) => setPermissionMode(teacher.id, event.target.checked)} />
                                            全部配置可用
                                        </label>
                                    </div>
                                    {!unrestricted ? (
                                        <div className="grid gap-4 xl:grid-cols-3">
                                            <PermissionChecklist title="实验模板" items={options.templates.map((item) => ({ id: item.key || item.id || '', label: item.label || item.key || '' }))} selected={permissions?.allowed_template_ids || []} onToggle={(id) => togglePermission(teacher.id, 'allowed_template_ids', id)} />
                                            <PermissionChecklist title="干预规则集" items={options.rule_profiles.map((item) => ({ id: item.id || '', label: item.label || item.id || '' }))} selected={permissions?.allowed_rule_profile_ids || []} onToggle={(id) => togglePermission(teacher.id, 'allowed_rule_profile_ids', id)} />
                                            <PermissionChecklist title="LLM 模型" items={options.models.map((item) => ({ id: item.id || '', label: item.name || item.id || '' }))} selected={permissions?.allowed_model_ids || []} onToggle={(id) => togglePermission(teacher.id, 'allowed_model_ids', id)} />
                                        </div>
                                    ) : (
                                        <div className="rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">当前教师未被收紧权限，可使用所有已发布模板、规则集和模型。</div>
                                    )}
                                    <div className="flex justify-end">
                                        <Button onClick={() => saveTeacher(teacher)} disabled={isSaving} className="gap-2 bg-indigo-600 text-white hover:bg-indigo-700">
                                            {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                                            保存该教师
                                        </Button>
                                    </div>
                                </div>
                            ) : null}
                        </div>
                    )
                })}
            </div>

            <div className="flex items-center justify-between rounded-2xl border border-slate-100 bg-white px-4 py-3 text-sm text-slate-500">
                <span>第 {page} / {totalPages} 页</span>
                <div className="flex gap-2">
                    <Button variant="outline" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>上一页</Button>
                    <Button variant="outline" disabled={page >= totalPages} onClick={() => setPage((value) => Math.min(totalPages, value + 1))}>下一页</Button>
                </div>
            </div>
        </div>
    )
}

function PermissionCount({ unrestricted, selected, total }: { unrestricted: boolean; selected: number; total: number }) {
    return <span className="text-sm font-semibold text-slate-600">{unrestricted ? '全部可用' : `${selected}/${total}`}</span>
}

function PermissionChecklist({
    title,
    items,
    selected,
    onToggle,
}: {
    title: string
    items: { id: string; label: string }[]
    selected: string[]
    onToggle: (id: string) => void
}) {
    return (
        <div className="rounded-2xl border border-slate-100 bg-white p-4">
            <div className="mb-3 flex items-center justify-between">
                <h3 className="font-bold text-slate-800">{title}</h3>
                <Badge variant="secondary" className="bg-slate-100 text-slate-600">{selected.length}/{items.length}</Badge>
            </div>
            <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
                {items.length === 0 ? (
                    <div className="py-6 text-center text-xs text-slate-400">暂无可选项</div>
                ) : items.map((item) => (
                    <label key={item.id} className="flex cursor-pointer items-start gap-2 rounded-xl border border-slate-100 px-3 py-2 text-sm hover:bg-slate-50">
                        <input type="checkbox" checked={selected.includes(item.id)} onChange={() => onToggle(item.id)} className="mt-0.5 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500" />
                        <span>
                            <span className="block font-semibold text-slate-700">{item.label}</span>
                            <span className="block text-xs font-mono text-slate-400">{item.id}</span>
                        </span>
                    </label>
                ))}
            </div>
        </div>
    )
}

function splitTags(value: string) {
    return value.split(/[，,]/).map((item) => item.trim()).filter(Boolean)
}
