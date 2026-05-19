import { useEffect, useMemo, useState } from 'react'
import {
  AlertCircle,
  CalendarClock,
  CheckCircle2,
  Clock,
  FileText,
  Loader2,
  Send,
} from 'lucide-react'
import { Badge, Button } from '../../../ui'
import { Course, courseService } from '../../../../services/api/course'
import {
  CourseTaskRelease as CourseTaskReleaseItem,
  CourseTaskReleaseCreateRequest,
  courseTaskReleaseService,
} from '../../../../services/api/courseTaskRelease'

type ReleaseForm = {
  title: string
  task_background: string
  core_question: string
  collaboration_requirements: string
  deliverable_requirements: string
  evaluation_points: string
  due_at: string
  allow_late_submission: boolean
}

const DEFAULT_FORM: ReleaseForm = {
  title: '',
  task_background: '',
  core_question: '',
  collaboration_requirements: '',
  deliverable_requirements: '',
  evaluation_points: '',
  due_at: '',
  allow_late_submission: true,
}

const RELEASE_STEPS = [
  {
    label: '选择班级与时限',
    description: '确认发布对象、任务标题、截止时间与逾期策略。',
  },
  {
    label: '填写项目说明',
    description: '补充任务背景、核心问题、协作要求、提交成果和评价要点。',
  },
  {
    label: '预览并发布',
    description: '检查同步结果，确认后发布到班级下全部未归档小组。',
  },
]

const formatDateTime = (value?: string) => {
  if (!value) return '未设置'
  return new Date(value).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

const toApiPayload = (form: ReleaseForm): CourseTaskReleaseCreateRequest => ({
  title: form.title.trim(),
  task_background: form.task_background.trim() || undefined,
  core_question: form.core_question.trim() || undefined,
  collaboration_requirements: form.collaboration_requirements.trim() || undefined,
  deliverable_requirements: form.deliverable_requirements.trim() || undefined,
  evaluation_points: form.evaluation_points.trim() || undefined,
  due_at: form.due_at ? new Date(form.due_at).toISOString() : undefined,
  allow_late_submission: form.allow_late_submission,
})

export default function CourseTaskRelease() {
  const [courses, setCourses] = useState<Course[]>([])
  const [selectedCourseId, setSelectedCourseId] = useState('')
  const [releases, setReleases] = useState<CourseTaskReleaseItem[]>([])
  const [loadingCourses, setLoadingCourses] = useState(true)
  const [loadingReleases, setLoadingReleases] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [closingId, setClosingId] = useState<string | null>(null)
  const [form, setForm] = useState<ReleaseForm>(DEFAULT_FORM)
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const [releaseStep, setReleaseStep] = useState(0)

  const selectedCourse = useMemo(
    () => courses.find((course) => course.id === selectedCourseId) || null,
    [courses, selectedCourseId]
  )

  const openReleaseCount = useMemo(
    () => releases.filter((release) => release.status === 'open').length,
    [releases]
  )

  useEffect(() => {
    const loadCourses = async () => {
      try {
        setLoadingCourses(true)
        const data = await courseService.getCourses()
        setCourses(data)
        setSelectedCourseId((previous) => {
          if (previous && data.some((course) => course.id === previous)) return previous
          return data[0]?.id || ''
        })
      } catch (error) {
        console.error('Failed to load courses:', error)
        setNotice({ type: 'error', message: '班级列表加载失败，请稍后重试。' })
      } finally {
        setLoadingCourses(false)
      }
    }

    void loadCourses()
  }, [])

  useEffect(() => {
    if (!selectedCourseId) {
      setReleases([])
      return
    }

    const loadReleases = async () => {
      try {
        setLoadingReleases(true)
        const data = await courseTaskReleaseService.listCourseReleases(selectedCourseId)
        setReleases(data)
      } catch (error) {
        console.error('Failed to load course task releases:', error)
        setReleases([])
        setNotice({ type: 'error', message: '任务发布记录加载失败，请检查班级权限或网络连接。' })
      } finally {
        setLoadingReleases(false)
      }
    }

    void loadReleases()
  }, [selectedCourseId])

  const updateForm = (key: keyof ReleaseForm, value: string | boolean) => {
    setForm((previous) => ({ ...previous, [key]: value }))
  }

  const canGoNext = useMemo(() => {
    if (releaseStep === 0) return Boolean(selectedCourseId && form.title.trim())
    if (releaseStep === 1) {
      return Boolean(
        form.task_background.trim()
        || form.core_question.trim()
        || form.collaboration_requirements.trim()
        || form.deliverable_requirements.trim()
        || form.evaluation_points.trim()
      )
    }
    return true
  }, [form, releaseStep, selectedCourseId])

  const handleNextStep = () => {
    if (!canGoNext) {
      setNotice({
        type: 'error',
        message: releaseStep === 0
          ? '请先选择班级并填写任务标题。'
          : '请至少填写一项项目说明内容，避免学生端任务文档为空。',
      })
      return
    }
    setNotice(null)
    setReleaseStep((previous) => Math.min(previous + 1, RELEASE_STEPS.length - 1))
  }

  const handlePreviousStep = () => {
    setNotice(null)
    setReleaseStep((previous) => Math.max(previous - 1, 0))
  }

  const handleSubmit = async () => {
    if (!selectedCourseId) {
      setNotice({ type: 'error', message: '请先选择要发布任务的班级。' })
      return
    }
    if (!form.title.trim()) {
      setNotice({ type: 'error', message: '请填写任务标题。' })
      return
    }

    try {
      setSubmitting(true)
      const release = await courseTaskReleaseService.createCourseRelease(
        selectedCourseId,
        toApiPayload(form)
      )
      setReleases((previous) => [release, ...previous])
      setForm(DEFAULT_FORM)
      setReleaseStep(0)
      setNotice({
        type: 'success',
        message: `任务已发布，并同步到 ${release.synced_task_count} 个小组任务和 ${release.synced_document_count} 份共享文档。`,
      })
    } catch (error) {
      console.error('Failed to publish course task:', error)
      setNotice({ type: 'error', message: '任务发布失败，请检查班级下是否已有小组或稍后重试。' })
    } finally {
      setSubmitting(false)
    }
  }

  const handleCloseRelease = async (releaseId: string) => {
    try {
      setClosingId(releaseId)
      const updated = await courseTaskReleaseService.closeRelease(releaseId)
      setReleases((previous) =>
        previous.map((release) => (release.id === releaseId ? updated : release))
      )
      setNotice({ type: 'success', message: '任务发布记录已关闭。小组已有任务不会被删除。' })
    } catch (error) {
      console.error('Failed to close course task release:', error)
      setNotice({ type: 'error', message: '关闭失败，请稍后重试。' })
    } finally {
      setClosingId(null)
    }
  }

  if (loadingCourses) {
    return (
      <div className="flex min-h-[360px] items-center justify-center text-slate-500">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        正在加载班级任务发布页...
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <section className="rounded-3xl border border-slate-100 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-700">
              <CalendarClock className="h-4 w-4" />
              班级级发布
            </div>
            <h1 className="text-3xl font-bold text-slate-900">小组任务发布</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
              面向某个班级统一发布阶段性实践任务，系统会同步生成该班级下各小组的待办任务，便于后续查看完成情况和任务评审。
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:flex">
            <div className="rounded-2xl bg-slate-50 px-4 py-3">
              <div className="text-xs text-slate-500">当前班级</div>
              <div className="mt-1 max-w-[180px] truncate text-sm font-semibold text-slate-900">
                {selectedCourse?.name || '未选择'}
              </div>
            </div>
            <div className="rounded-2xl bg-indigo-50 px-4 py-3">
              <div className="text-xs text-indigo-500">进行中任务</div>
              <div className="mt-1 text-sm font-semibold text-indigo-700">{openReleaseCount} 个</div>
            </div>
          </div>
        </div>
      </section>

      {notice && (
        <div
          className={`flex items-start gap-2 rounded-2xl border px-4 py-3 text-sm ${
            notice.type === 'success'
              ? 'border-emerald-100 bg-emerald-50 text-emerald-700'
              : 'border-red-100 bg-red-50 text-red-700'
          }`}
        >
          {notice.type === 'success' ? (
            <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0" />
          ) : (
            <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
          )}
          <span>{notice.message}</span>
        </div>
      )}

      {courses.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-slate-200 bg-white p-12 text-center">
          <FileText className="mx-auto mb-4 h-10 w-10 text-slate-300" />
          <h2 className="text-lg font-semibold text-slate-900">暂无可管理班级</h2>
          <p className="mt-2 text-sm text-slate-500">请先在“班级管理”中创建班级，再发布小组任务。</p>
        </div>
      ) : (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(360px,0.85fr)]">
          <section className="rounded-3xl border border-slate-100 bg-white p-6 shadow-sm">
            <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2 className="text-xl font-bold text-slate-900">发布新任务</h2>
                <p className="mt-1 text-sm text-slate-500">任务会同步到所选班级下所有未归档小组。</p>
              </div>
              <label className="block min-w-[220px]">
                <span className="mb-1 block text-xs font-semibold text-slate-500">发布班级</span>
                <select
                  value={selectedCourseId}
                  onChange={(event) => setSelectedCourseId(event.target.value)}
                  className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                >
                  {courses.map((course) => (
                    <option key={course.id} value={course.id}>
                      {course.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="space-y-5">
              <div className="grid gap-3 md:grid-cols-3">
                {RELEASE_STEPS.map((step, index) => (
                  <button
                    key={step.label}
                    type="button"
                    onClick={() => setReleaseStep(index)}
                    className={`rounded-2xl border p-4 text-left transition ${
                      releaseStep === index
                        ? 'border-indigo-200 bg-indigo-50 text-indigo-900 shadow-sm'
                        : 'border-slate-100 bg-slate-50 text-slate-500 hover:border-slate-200'
                    }`}
                  >
                    <div className="mb-2 flex items-center gap-2">
                      <span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-black ${
                        releaseStep === index ? 'bg-indigo-600 text-white' : 'bg-white text-slate-500'
                      }`}>
                        {index + 1}
                      </span>
                      <span className="text-sm font-bold">{step.label}</span>
                    </div>
                    <p className="text-xs leading-5">{step.description}</p>
                  </button>
                ))}
              </div>

              {releaseStep === 0 && (
                <div className="space-y-4 rounded-3xl border border-slate-100 bg-white p-5">
                  <label className="block">
                    <span className="mb-1 block text-sm font-semibold text-slate-700">任务标题</span>
                    <input
                      value={form.title}
                      onChange={(event) => updateForm('title', event.target.value)}
                      placeholder="例如：形成小组阶段性论证方案"
                      className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                    />
                  </label>

                  <div className="grid gap-4 lg:grid-cols-2">
                    <label className="block">
                      <span className="mb-1 block text-sm font-semibold text-slate-700">截止时间</span>
                      <input
                        type="datetime-local"
                        value={form.due_at}
                        onChange={(event) => updateForm('due_at', event.target.value)}
                        className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                      />
                    </label>
                    <label className="flex items-center gap-3 rounded-2xl border border-slate-200 px-4 py-3 text-sm text-slate-600">
                      <input
                        type="checkbox"
                        checked={form.allow_late_submission}
                        onChange={(event) => updateForm('allow_late_submission', event.target.checked)}
                        className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                      />
                      允许小组在截止后继续提交或完善
                    </label>
                  </div>
                </div>
              )}

              {releaseStep === 1 && (
                <div className="space-y-4 rounded-3xl border border-slate-100 bg-white p-5">
                  <div className="grid gap-4 lg:grid-cols-2">
                    <TextAreaField
                      label="任务背景"
                      value={form.task_background}
                      placeholder="说明情境、主题和学习目标。"
                      onChange={(value) => updateForm('task_background', value)}
                    />
                    <TextAreaField
                      label="核心问题"
                      value={form.core_question}
                      placeholder="说明小组需要回答或解决的关键问题。"
                      onChange={(value) => updateForm('core_question', value)}
                    />
                    <TextAreaField
                      label="协作要求"
                      value={form.collaboration_requirements}
                      placeholder="说明问题构建、意义探索、解释整合、应用解决等协作过程要求。"
                      onChange={(value) => updateForm('collaboration_requirements', value)}
                    />
                    <TextAreaField
                      label="提交成果"
                      value={form.deliverable_requirements}
                      placeholder="说明最终需要提交的报告、方案、展示或其他成果。"
                      onChange={(value) => updateForm('deliverable_requirements', value)}
                    />
                  </div>

                  <TextAreaField
                    label="评价要点"
                    value={form.evaluation_points}
                    placeholder="说明评价关注点，例如证据质量、论证清晰度、协作完整性、成果说服力。"
                    minRows={3}
                    onChange={(value) => updateForm('evaluation_points', value)}
                  />
                </div>
              )}

              {releaseStep === 2 && (
                <div className="space-y-4 rounded-3xl border border-indigo-100 bg-indigo-50/40 p-5">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <PreviewItem label="发布班级" value={selectedCourse?.name || '未选择'} />
                    <PreviewItem label="任务标题" value={form.title || '未填写'} />
                    <PreviewItem label="截止时间" value={form.due_at ? formatDateTime(new Date(form.due_at).toISOString()) : '未设置'} />
                    <PreviewItem label="逾期策略" value={form.allow_late_submission ? '允许截止后继续提交或完善' : '截止后不再开放提交或完善'} />
                  </div>
                  <div className="rounded-2xl bg-white p-4 text-sm leading-6 text-slate-600 ring-1 ring-indigo-100">
                    <div className="mb-2 text-xs font-black uppercase tracking-wider text-indigo-500">学生端项目说明预览</div>
                    <PreviewSection title="任务背景" content={form.task_background} />
                    <PreviewSection title="核心问题" content={form.core_question} />
                    <PreviewSection title="协作要求" content={form.collaboration_requirements} />
                    <PreviewSection title="提交成果" content={form.deliverable_requirements} />
                    <PreviewSection title="评价要点" content={form.evaluation_points} />
                  </div>
                  <div className="rounded-2xl bg-white px-4 py-3 text-sm text-slate-500 ring-1 ring-indigo-100">
                    确认发布后，系统将为该班级下所有未归档小组生成任务卡、共享文档和知识沉淀任务简报。
                  </div>
                </div>
              )}

              <div className="flex flex-col gap-3 rounded-2xl bg-slate-50 p-4 text-sm text-slate-500 sm:flex-row sm:items-center sm:justify-between">
                <span>
                  {releaseStep === 2
                    ? '请确认信息无误后发布；已创建的小组将同步收到任务。'
                    : '按步骤填写可以减少学生端任务说明缺失或发布对象错误。'}
                </span>
                <div className="flex items-center justify-end gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handlePreviousStep}
                    disabled={releaseStep === 0 || submitting}
                    className="rounded-2xl"
                  >
                    上一步
                  </Button>
                  {releaseStep < RELEASE_STEPS.length - 1 ? (
                    <Button
                      type="button"
                      onClick={handleNextStep}
                      className="rounded-2xl bg-indigo-600 px-5 py-2.5 text-white hover:bg-indigo-700"
                    >
                      下一步
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      onClick={handleSubmit}
                      disabled={submitting}
                      className="rounded-2xl bg-indigo-600 px-5 py-2.5 text-white hover:bg-indigo-700"
                    >
                      {submitting ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Send className="mr-2 h-4 w-4" />
                      )}
                      发布到班级小组
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </section>

          <section className="rounded-3xl border border-slate-100 bg-white p-6 shadow-sm">
            <div className="mb-5 flex items-center justify-between">
              <div>
                <h2 className="text-xl font-bold text-slate-900">发布记录</h2>
                <p className="mt-1 text-sm text-slate-500">查看任务是否已同步到小组。</p>
              </div>
              {loadingReleases && <Loader2 className="h-5 w-5 animate-spin text-indigo-500" />}
            </div>

            <div className="space-y-3">
              {releases.length === 0 && !loadingReleases ? (
                <div className="rounded-2xl border border-dashed border-slate-200 p-8 text-center text-sm text-slate-500">
                  当前班级还没有发布过小组任务。
                </div>
              ) : (
                releases.map((release) => (
                  <article key={release.id} className="rounded-2xl border border-slate-100 bg-slate-50/60 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="truncate text-base font-semibold text-slate-900">{release.title}</h3>
                        <div className="mt-2 flex flex-wrap gap-2">
                          <Badge
                            variant={release.status === 'open' ? 'default' : 'secondary'}
                            className={release.status === 'open' ? 'bg-emerald-600 hover:bg-emerald-600' : ''}
                          >
                            {release.status === 'open' ? '进行中' : '已关闭'}
                          </Badge>
                          <Badge variant="secondary">{release.synced_task_count} 个小组任务</Badge>
                          <Badge variant="secondary">{release.synced_document_count} 份共享文档</Badge>
                          <Badge variant="secondary">
                            已提交 {release.submitted_count || 0}/{release.synced_task_count}
                          </Badge>
                        </div>
                      </div>
                      {release.status === 'open' && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={closingId === release.id}
                          onClick={() => void handleCloseRelease(release.id)}
                          className="rounded-xl"
                        >
                          {closingId === release.id ? <Loader2 className="h-4 w-4 animate-spin" /> : '关闭'}
                        </Button>
                      )}
                    </div>
                    <div className="mt-4 space-y-2 text-sm text-slate-500">
                      <div className="flex items-center gap-2">
                        <Clock className="h-4 w-4" />
                        <span>发布时间：{formatDateTime(release.published_at)}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <CalendarClock className="h-4 w-4" />
                        <span>截止时间：{formatDateTime(release.due_at)}</span>
                      </div>
                      <div className="rounded-xl bg-white px-3 py-2 text-xs text-slate-500 ring-1 ring-slate-100">
                        提交统计：正常 {release.manual_submitted_count || 0}，
                        逾期 {release.late_submitted_count || 0}，
                        自动 {release.auto_submitted_count || 0}
                      </div>
                    </div>
                  </article>
                ))
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  )
}

function TextAreaField({
  label,
  value,
  placeholder,
  onChange,
  minRows = 4,
}: {
  label: string
  value: string
  placeholder: string
  onChange: (value: string) => void
  minRows?: number
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-semibold text-slate-700">{label}</span>
      <textarea
        value={value}
        rows={minRows}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="w-full resize-y rounded-2xl border border-slate-200 px-4 py-3 text-sm leading-6 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
      />
    </label>
  )
}

function PreviewItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-white p-4 ring-1 ring-indigo-100">
      <div className="text-xs font-semibold text-slate-400">{label}</div>
      <div className="mt-1 text-sm font-bold text-slate-900">{value}</div>
    </div>
  )
}

function PreviewSection({ title, content }: { title: string; content?: string }) {
  if (!content?.trim()) return null
  return (
    <div className="border-t border-slate-100 py-3 first:border-t-0 first:pt-0 last:pb-0">
      <div className="text-xs font-bold text-slate-500">{title}</div>
      <div className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{content.trim()}</div>
    </div>
  )
}
