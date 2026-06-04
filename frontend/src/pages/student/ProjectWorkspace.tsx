import { useState, useEffect, useRef } from 'react'
import { useParams } from 'react-router-dom'
import Sidebar from '../../components/layout/Sidebar'
import RightSidebar, { type RightPanel, type RightSidebarBadges } from '../../components/layout/RightSidebar'
import TabNavigation from '../../components/layout/TabNavigation'
import ConnectionStatusBanner from '../../components/feedback/ConnectionStatusBanner'
import ResourceLibrary from '../../components/features/student/resources/ResourceLibrary'
import ProjectWiki from '../../components/features/student/wiki/ProjectWiki'
import LearningDashboard from '../../components/features/student/dashboard/LearningDashboard'
import DocumentEditor from '../../components/features/student/document/DocumentEditor'
import { InquirySpace } from '../../modules/inquiry/components/InquirySpace'
import AITutor from '../../components/features/student/ai/AITutor'
import ContextualAIAssistant from '../../components/features/student/ai/ContextualAIAssistant'
import { projectService } from '../../services/api/project'
import { documentService } from '../../services/api/document'
import { ExperimentVersion, Project } from '../../types'
import { useAuthStore } from '../../stores/authStore'
import { useSyncStore } from '../../stores/syncStore'
import Settings from '../../components/features/student/settings/Settings'
import { syncService } from '../../services/sync/SyncService'
import { ChatOperation } from '../../types/sync'
import { useBehaviorTracking } from '../../hooks/common/useBehaviorTracking'
import { useActivityTracking } from '../../hooks/common/useActivityTracking'
import { useContextStore } from '../../stores/contextStore'
import { usePresenceStore } from '../../stores/presenceStore'
import { trackingService } from '../../services/tracking/TrackingService'
import { isProcessScaffoldActive, isTutorTabEnabled } from '../../lib/experimentScaffold'
import {
  CANONICAL_STAGES,
  formatStageLabel,
  getStageToolGuidance,
  getTabLabel,
  normalizeStageId,
  type CanonicalStageId,
} from '../../lib/stageModel'
import { ConfirmDialog, useToast } from '../../components/ui'
import { ClipboardList, HelpCircle, MessagesSquare, PanelLeftOpen } from 'lucide-react'

const getExperimentVersionSignature = (version: ExperimentVersion | null) => {
  if (!version) return 'null'
  return JSON.stringify({
    version_name: version.version_name,
    stage_control_mode: version.stage_control_mode,
    process_scaffold_mode: version.process_scaffold_mode,
    ai_scaffold_mode: version.ai_scaffold_mode,
    broadcast_stage_updates: version.broadcast_stage_updates,
    group_condition: version.group_condition,
    enabled_scaffold_layers: version.enabled_scaffold_layers,
    enabled_scaffold_roles: version.enabled_scaffold_roles,
    enabled_rule_set: version.enabled_rule_set,
    export_profile: version.export_profile,
    stage_sequence: version.stage_sequence,
    current_stage: version.current_stage,
    updated_at: version.updated_at,
  })
}

const ALL_NAV_TABS = ['document', 'inquiry', 'resources', 'wiki', 'ai', 'dashboard']

const STUDENT_ONBOARDING_STEPS = [
  {
    title: '任务看板',
    body: '先确认小组任务、截止时间、当前阶段和提交要求。需要提交作品时，由组长在课程任务卡片中上传文件并确认提交。',
    tips: ['左侧任务看板可展开/收起', '阶段推进通常由组长操作', '限时任务提交后仍可补充资料'],
  },
  {
    title: '共享文档',
    body: '共享文档用于共同写作、整理证据和形成阶段性成果。进入文档后，左侧文档列表会默认展开，便于切换不同文档。',
    tips: ['保存前先确认内容已同步显示', '多人同时编辑时尽量分段协作', '文档列表可用于管理不同成果版本'],
  },
  {
    title: '探究空间',
    body: '探究空间用于把问题、证据、观点和反驳组织起来，适合把零散讨论转化为结构化推理。',
    tips: ['可把 AI 建议或关键资料放入素材池', '用节点关系表达“证据支持什么观点”', '遇到分歧时先保留不同解释'],
  },
  {
    title: '资料与知识沉淀',
    body: '小组资料用于上传、预览和引用学习资源；知识沉淀用于记录小组已经确认的概念、证据和结论。',
    tips: ['资源上传后可进入 AI 检索', '资料名称尽量清楚，便于同伴查找', '重要结论建议沉淀到 Wiki'],
  },
  {
    title: '群聊与教师支持',
    body: '右侧群聊用于小组内平等讨论和互帮互助；教师支持用于低频求助，适合在小组确实卡住时提交。',
    tips: ['@同伴后可继续追问或确认', '@AISCL智能助手可请求简短支架', '教师支持不要替代小组内部讨论'],
  },
  {
    title: 'AI 使用方式',
    body: 'AI 回复是线索和支架，不是最终答案。更适合用来澄清问题、找证据线索、挑战观点和提示下一步协作。',
    tips: ['先说明小组当前卡点', '要求 AI 给出依据和可执行下一步', '最终判断仍由小组结合资料完成'],
  },
]

const getVisiblePrimaryTabForStage = (stageId: string | null, version: ExperimentVersion | null) => {
  const primaryTab = getStageToolGuidance(stageId).primaryTab
  if (primaryTab === 'ai' && !isTutorTabEnabled(version)) return 'document'
  return primaryTab
}

const getVisibleStageSteps = (stageSequence?: string[]) => {
  const firstStageByCanonical = new Map<CanonicalStageId, string>()

  ;(stageSequence || []).forEach((stageId) => {
    const canonicalStage = normalizeStageId(stageId)
    if (canonicalStage && !firstStageByCanonical.has(canonicalStage)) {
      firstStageByCanonical.set(canonicalStage, stageId)
    }
  })

  return CANONICAL_STAGES
    .filter((stageId) => firstStageByCanonical.has(stageId))
    .map((stageId) => ({
      canonicalStage: stageId,
      stageId: firstStageByCanonical.get(stageId) || stageId,
    }))
}

export default function Main() {
  const { projectId } = useParams<{ projectId?: string }>()
  const [currentProjectId, setCurrentProjectId] = useState<string | undefined>(projectId)
  const [activeTab, setActiveTab] = useState('document')
  const [currentStage, setCurrentStage] = useState<string | null>(null)
  const [isDesktopLayout, setIsDesktopLayout] = useState(() => window.matchMedia('(min-width: 1024px)').matches)
  const [leftSidebarOpen, setLeftSidebarOpen] = useState(() => window.matchMedia('(min-width: 1024px)').matches)
  const [rightSidebarOpen, setRightSidebarOpen] = useState(() => window.matchMedia('(min-width: 1024px)').matches)
  const [rightSidebarPanel, setRightSidebarPanel] = useState<RightPanel>('chat')
  const [rightSidebarBadges, setRightSidebarBadges] = useState<RightSidebarBadges>({
    chatUnread: 0,
    chatMentions: 0,
    teacherSupport: false,
  })
  const [rightSidebarWidth, setRightSidebarWidth] = useState(() => {
    const savedWidth = Number(window.localStorage.getItem('aiscl:right-sidebar-width') || 380)
    return Number.isFinite(savedWidth) ? Math.min(Math.max(savedWidth, 320), 560) : 380
  })
  const [rightSidebarResizing, setRightSidebarResizing] = useState(false)
  const [_project, setProject] = useState<Project | null>(null)
  const [experimentVersion, setExperimentVersion] = useState<ExperimentVersion | null>(null)
  const [currentDocumentId, setCurrentDocumentId] = useState<string | undefined>(undefined)
  const [documentListOpenOnEntry, setDocumentListOpenOnEntry] = useState(true)
  const [workspaceLoading, setWorkspaceLoading] = useState(true)
  const [workspaceError, setWorkspaceError] = useState<string | null>(null)
  const [workspaceReloadToken, setWorkspaceReloadToken] = useState(0)
  const [documentResolving, setDocumentResolving] = useState(false)
  const [documentResolveError, setDocumentResolveError] = useState<string | null>(null)
  const [documentRetryToken, setDocumentRetryToken] = useState(0)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [showStageDetails, setShowStageDetails] = useState(false)
  const [stageChanging, setStageChanging] = useState(false)
  const [onboardingOpen, setOnboardingOpen] = useState(false)
  const [onboardingStep, setOnboardingStep] = useState(0)
  const [stageConfirmTarget, setStageConfirmTarget] = useState<string | null>(null)
  const [stageUpdateNotice, setStageUpdateNotice] = useState<{
    stageId: string
    versionName?: string | null
    refreshReason: 'focus' | 'interval'
  } | null>(null)
  const [stageActionNotice, setStageActionNotice] = useState<string | null>(null)
  const previousStageRef = useRef<string | null>(null)
  const previousGuidedStageRef = useRef<string | null>(null)
  const rightSidebarResizeRef = useRef<{ startX: number; startWidth: number } | null>(null)
  const toast = useToast()

  const updateRightSidebarBadges = (next: Partial<RightSidebarBadges>) => {
    setRightSidebarBadges((previous) => ({ ...previous, ...next }))
  }

  const openRightPanel = (panel: RightPanel) => {
    setRightSidebarPanel(panel)
    setRightSidebarOpen(true)
    if (panel === 'chat') {
      updateRightSidebarBadges({ chatUnread: 0, chatMentions: 0 })
    }
    if (panel === 'teacher-support') {
      updateRightSidebarBadges({ teacherSupport: false })
    }
  }

  useEffect(() => {
    const dismissed = window.localStorage.getItem('aiscl:student-onboarding-dismissed')
    if (!dismissed) {
      setOnboardingOpen(true)
    }
  }, [])

  useEffect(() => {
    const mediaQuery = window.matchMedia('(min-width: 1024px)')
    const syncSidebarState = (matches: boolean) => {
      setIsDesktopLayout(matches)
      setLeftSidebarOpen(matches)
      setRightSidebarOpen(matches)
    }

    syncSidebarState(mediaQuery.matches)
    const handleChange = (event: MediaQueryListEvent) => syncSidebarState(event.matches)
    mediaQuery.addEventListener('change', handleChange)
    return () => mediaQuery.removeEventListener('change', handleChange)
  }, [])

  const { connectionStatus } = useSyncStore()
  const { user } = useAuthStore()
  const setContextProjectId = useContextStore(state => state.setProjectId)
  const setContextActiveTab = useContextStore(state => state.setActiveTab)
  const setContextCurrentStage = useContextStore(state => state.setCurrentStage)
  const setContextExperimentVersionId = useContextStore(state => state.setExperimentVersionId)
  const setContextDocumentId = useContextStore(state => state.setDocumentId)
  const markPresenceOnline = usePresenceStore(state => state.markOnline)
  const markPresenceOffline = usePresenceStore(state => state.markOffline)
  const prunePresence = usePresenceStore(state => state.pruneStale)

  const explicitLeaderId = _project?.members.find(
    (member) => member.role === 'owner' && member.user_id !== _project.owner_id
  )?.user_id
  const fallbackStudentLeaderId = _project?.members.find(
    (member) => member.user_id && member.user_id !== _project.owner_id
  )?.user_id
  const isGroupLeader = Boolean(
    user?.id && (
      user.id === _project?.owner_id
      || user.id === _project?.leader_id
      || user.id === explicitLeaderId
      || (!_project?.leader_id && !explicitLeaderId && user.id === fallbackStudentLeaderId)
    )
  )

  // Update Context Store
  useEffect(() => {
    setContextProjectId(currentProjectId || null)
  }, [currentProjectId, setContextProjectId])

  useEffect(() => {
    setContextActiveTab(activeTab)
  }, [activeTab, setContextActiveTab])

  useEffect(() => {
    setContextCurrentStage(currentStage)
  }, [currentStage, setContextCurrentStage])

  useEffect(() => {
    setContextExperimentVersionId(experimentVersion?.version_name || null)
  }, [experimentVersion, setContextExperimentVersionId])

  useEffect(() => {
    const configuredStages = experimentVersion?.stage_sequence || []
    if (configuredStages.length === 0) {
      setCurrentStage(null)
      previousStageRef.current = null
      return
    }

    setCurrentStage((prev) => {
      if (experimentVersion?.current_stage && configuredStages.includes(experimentVersion.current_stage)) {
        return experimentVersion.current_stage
      }
      if (prev && configuredStages.includes(prev)) {
        return prev
      }
      return configuredStages[0]
    })
  }, [experimentVersion])

  useEffect(() => {
    if (!currentProjectId || !currentStage) return

    const previousStage = previousStageRef.current
    const eventType = previousStage ? 'learning_stage_transition' : 'learning_stage_enter'

    trackingService.trackResearchEvent({
      project_id: currentProjectId,
      experiment_version_id: experimentVersion?.version_name,
      actor_type: 'student',
      event_domain: 'stage_transition',
      event_type: eventType,
      stage_id: currentStage,
      payload: {
        transition_basis: 'experiment_stage_bar',
        from: previousStage,
        to: currentStage,
        configured_stage_sequence: experimentVersion?.stage_sequence || [],
        active_tab: activeTab,
      }
    })

    previousStageRef.current = currentStage
  }, [activeTab, currentProjectId, currentStage, experimentVersion])

  useEffect(() => {
    if (!experimentVersion) return

    if (!isTutorTabEnabled(experimentVersion) && activeTab === 'ai') {
      setActiveTab(getVisiblePrimaryTabForStage(currentStage, experimentVersion))
    }
  }, [activeTab, currentStage, experimentVersion])

  useEffect(() => {
    if (!rightSidebarResizing) return

    const handlePointerMove = (event: PointerEvent) => {
      const start = rightSidebarResizeRef.current
      if (!start) return
      const viewportLimitedMax = Math.max(320, Math.min(560, window.innerWidth - 520))
      const nextWidth = Math.min(
        Math.max(start.startWidth + (start.startX - event.clientX), 320),
        viewportLimitedMax
      )
      setRightSidebarWidth(nextWidth)
    }

    const handlePointerUp = () => {
      setRightSidebarResizing(false)
      rightSidebarResizeRef.current = null
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [rightSidebarResizing])

  useEffect(() => {
    window.localStorage.setItem('aiscl:right-sidebar-width', String(rightSidebarWidth))
  }, [rightSidebarWidth])

  useEffect(() => {
    if (!currentStage) return
    if (!isProcessScaffoldActive(experimentVersion)) return

    const guidance = getStageToolGuidance(currentStage)
    const primaryTab = getVisiblePrimaryTabForStage(currentStage, experimentVersion)
    if (previousGuidedStageRef.current === currentStage) return

    previousGuidedStageRef.current = currentStage

    if (activeTab !== primaryTab) {
      trackingService.trackResearchEvent({
        project_id: currentProjectId,
        experiment_version_id: experimentVersion?.version_name,
        actor_type: 'system',
        event_domain: 'stage_transition',
        event_type: 'stage_tool_guidance_apply',
        stage_id: currentStage,
        payload: {
          from_tab: activeTab,
          to_tab: primaryTab,
          recommended_tabs: guidance.recommendedTabs,
          guidance_mode: 'soft_default_switch',
        }
      })
      setActiveTab(primaryTab)
    }
  }, [activeTab, currentProjectId, currentStage, experimentVersion])

  useEffect(() => {
    setContextDocumentId(currentDocumentId || null)
  }, [currentDocumentId, setContextDocumentId])

  useEffect(() => {
    if (activeTab === 'document') {
      setDocumentListOpenOnEntry(true)
    }
  }, [activeTab])

  useEffect(() => {
    setCurrentDocumentId(undefined)
    setDocumentListOpenOnEntry(true)
    setDocumentResolving(false)
    setDocumentResolveError(null)
    previousGuidedStageRef.current = null
  }, [currentProjectId])

  // Track behavior and activity
  useBehaviorTracking(currentProjectId || null, activeTab)
  useActivityTracking(currentProjectId || null, activeTab)

  // Initialize SyncService
  useEffect(() => {
    syncService.init().catch(console.error)
  }, [])

  // Handle room joining/leaving at project level
  useEffect(() => {
    if (currentProjectId) {
      const roomId = `project:${currentProjectId}`
      syncService.joinRoom(roomId, 'chat').catch(console.error)
      return () => {
        syncService.leaveRoom(roomId, 'chat')
      }
    }
  }, [currentProjectId])

  useEffect(() => {
    if (!currentProjectId || !user?.id) return

    const roomId = `project:${currentProjectId}`

    const handlePresenceOperation = (operation: ChatOperation) => {
      if (operation.type !== 'presence' || operation.roomId !== roomId) return
      const presence = operation.data.presence || {}
      const projectId = presence.projectId || currentProjectId
      markPresenceOnline(projectId, {
        userId: operation.clientId,
        username: presence.username,
        avatarUrl: presence.avatarUrl,
        role: presence.role,
        module: presence.module,
        pageSource: presence.pageSource,
        currentStage: presence.currentStage,
        lastSeenAt: presence.lastSeenAt,
      })
    }

    syncService.on('operation:chat', handlePresenceOperation)
    return () => {
      syncService.off('operation:chat', handlePresenceOperation)
    }
  }, [currentProjectId, markPresenceOnline, user?.id])

  useEffect(() => {
    if (!currentProjectId || !user?.id) return

    const roomId = `project:${currentProjectId}`

    const sendPresenceHeartbeat = () => {
      const lastSeenAt = Date.now()
      markPresenceOnline(currentProjectId, {
        userId: user.id,
        username: user.username,
        avatarUrl: user.avatar_url,
        role: user.role,
        module: activeTab,
        pageSource: activeTab,
        currentStage,
        lastSeenAt,
        isLocal: true,
      })

      syncService.sendEphemeralOperation({
        id: `presence-${user.id}-${lastSeenAt}`,
        module: 'chat',
        roomId,
        timestamp: lastSeenAt,
        clientId: user.id,
        version: 0,
        type: 'presence',
        data: {
          presence: {
            projectId: currentProjectId,
            username: user.username,
            avatarUrl: user.avatar_url,
            role: user.role,
            module: activeTab,
            pageSource: activeTab,
            currentStage,
            lastSeenAt,
          },
        },
      }).catch(console.error)

      trackingService.trackResearchEvent({
        project_id: currentProjectId,
        experiment_version_id: experimentVersion?.version_name,
        actor_type: 'student',
        event_domain: 'dialogue',
        event_type: 'presence_heartbeat',
        stage_id: currentStage || undefined,
        payload: {
          module: activeTab,
          page_source: activeTab,
          source: 'student_workspace',
        },
      })
    }

    sendPresenceHeartbeat()
    const heartbeatTimer = window.setInterval(sendPresenceHeartbeat, 20_000)
    const pruneTimer = window.setInterval(() => prunePresence(), 10_000)

    return () => {
      window.clearInterval(heartbeatTimer)
      window.clearInterval(pruneTimer)
      markPresenceOffline(currentProjectId, user.id)
    }
  }, [
    activeTab,
    currentProjectId,
    currentStage,
    experimentVersion?.version_name,
    markPresenceOffline,
    markPresenceOnline,
    prunePresence,
    user?.avatar_url,
    user?.id,
    user?.role,
    user?.username,
  ])

  useEffect(() => {
    if (!currentProjectId) return

    let cancelled = false
    let noticeTimer: number | null = null

    const syncExperimentVersion = async (reason: 'focus' | 'interval') => {
      try {
        const nextVersion = await projectService.getExperimentVersion(currentProjectId)
        if (cancelled) return

        setExperimentVersion((previousVersion) => {
          const previousSignature = getExperimentVersionSignature(previousVersion)
          const nextSignature = getExperimentVersionSignature(nextVersion)

          if (previousSignature === nextSignature) {
            return previousVersion
          }

          trackingService.trackResearchEvent({
            project_id: currentProjectId,
            experiment_version_id: nextVersion.version_name,
            actor_type: 'system',
            event_domain: 'stage_transition',
            event_type: 'experiment_version_refresh_apply',
            stage_id: nextVersion.current_stage || undefined,
            payload: {
              refresh_reason: reason,
              previous_version_name: previousVersion?.version_name,
              next_version_name: nextVersion.version_name,
              previous_current_stage: previousVersion?.current_stage || null,
              next_current_stage: nextVersion.current_stage || null,
              previous_updated_at: previousVersion?.updated_at || null,
              next_updated_at: nextVersion.updated_at || null,
            }
          })

          const nextStage = nextVersion.current_stage || null
          const previousStage = previousVersion?.current_stage || null
          if (nextStage && previousStage && nextStage !== previousStage && nextVersion.broadcast_stage_updates) {
            setStageUpdateNotice({
              stageId: nextStage,
              versionName: nextVersion.version_name,
              refreshReason: reason,
            })

            trackingService.trackResearchEvent({
              project_id: currentProjectId,
              experiment_version_id: nextVersion.version_name,
              actor_type: 'system',
              event_domain: 'stage_transition',
              event_type: 'stage_update_notice_display',
              stage_id: nextStage,
              payload: {
                refresh_reason: reason,
                previous_stage: previousStage,
                next_stage: nextStage,
              }
            })

            if (noticeTimer) {
              window.clearTimeout(noticeTimer)
            }
            noticeTimer = window.setTimeout(() => {
              setStageUpdateNotice(null)
            }, 12000)
          }

          return nextVersion
        })
      } catch (error) {
        console.error('Failed to refresh experiment version:', error)
      }
    }

    const intervalId = window.setInterval(() => {
      void syncExperimentVersion('interval')
    }, 30000)

    const handleFocusRefresh = () => {
      void syncExperimentVersion('focus')
    }

    window.addEventListener('focus', handleFocusRefresh)

    return () => {
      cancelled = true
      window.clearInterval(intervalId)
      window.removeEventListener('focus', handleFocusRefresh)
      if (noticeTimer) {
        window.clearTimeout(noticeTimer)
      }
    }
  }, [currentProjectId])

  // Get document ID when switching to document tab
  useEffect(() => {
    const getDocumentId = async () => {
      if (activeTab !== 'document' || !currentProjectId || currentDocumentId || workspaceLoading || workspaceError) {
        return
      }

      setDocumentResolving(true)
      setDocumentResolveError(null)
      try {
        if (_project?.initial_task_document_id) {
          setCurrentDocumentId(_project.initial_task_document_id)
          return
        }
        const docsResponse = await documentService.getDocuments(currentProjectId, 0, 1)
        if (docsResponse.documents && docsResponse.documents.length > 0) {
          setCurrentDocumentId(docsResponse.documents[0].id)
        } else {
          // Create a default document only after project metadata has finished loading.
          const defaultDoc = await documentService.createDocument(
            currentProjectId,
            '小组文档',
            ''
          )
          setCurrentDocumentId(defaultDoc.id)
        }
      } catch (error) {
        console.error('Failed to get/create document:', error)
        setDocumentResolveError('小组文档加载失败，请稍后重试或刷新页面。')
      } finally {
        setDocumentResolving(false)
      }
    }

    getDocumentId()
  }, [activeTab, currentProjectId, currentDocumentId, _project, workspaceError, workspaceLoading, documentRetryToken])

  const handleCreateDocumentFromWorkspace = async () => {
    if (!currentProjectId || documentResolving) return
    try {
      setDocumentResolving(true)
      setDocumentResolveError(null)
      const doc = await documentService.createDocument(currentProjectId, '新建小组文档', '')
      setCurrentDocumentId(doc.id)
    } catch (error) {
      console.error('Failed to manually create document:', error)
      setDocumentResolveError('新建文档失败，请稍后重试。')
    } finally {
      setDocumentResolving(false)
    }
  }

  useEffect(() => {
    let cancelled = false

    const loadWorkspace = async () => {
      setWorkspaceLoading(true)
      setWorkspaceError(null)

      try {
        let targetProjectId = currentProjectId
        let targetProject: Project | null = null

        if (!targetProjectId) {
          const activeProjects = await projectService.getProjects(false)
          targetProject = activeProjects.projects[0] || null

          if (!targetProject) {
            const archivedProjects = await projectService.getProjects(true)
            targetProject = archivedProjects.projects[0] || null
          }

          if (!targetProject) {
            throw new Error('当前账号暂无可进入的小组项目。')
          }

          targetProjectId = targetProject.id
        }

        const [projectResult, versionResult] = await Promise.allSettled([
          targetProject ? Promise.resolve(targetProject) : projectService.getProject(targetProjectId),
          projectService.getExperimentVersion(targetProjectId),
        ])

        if (cancelled) return

        if (projectResult.status === 'rejected') {
          throw projectResult.reason
        }

        setCurrentProjectId(targetProjectId)
        setProject(projectResult.value)

        if (versionResult.status === 'fulfilled') {
          setExperimentVersion(versionResult.value)
        } else {
          console.error('Failed to get experiment version:', versionResult.reason)
          setExperimentVersion(null)
        }
      } catch (error) {
        if (cancelled) return
        console.error('Failed to load student workspace:', error)
        setProject(null)
        setExperimentVersion(null)
        setWorkspaceError(error instanceof Error ? error.message : '学生工作台加载失败，请刷新后重试。')
      } finally {
        if (!cancelled) {
          setWorkspaceLoading(false)
        }
      }
    }

    loadWorkspace()

    return () => {
      cancelled = true
    }
  }, [currentProjectId, workspaceReloadToken])

  const stageToolGuidance = getStageToolGuidance(currentStage)
  const stageControlMode = experimentVersion?.stage_control_mode || 'soft_guidance'
  const hasConfiguredStages = (experimentVersion?.stage_sequence?.length || 0) > 0
  const visibleStageSteps = getVisibleStageSteps(experimentVersion?.stage_sequence)
  const currentCanonicalStage = normalizeStageId(currentStage)
  const showProcessGuidance = Boolean(hasConfiguredStages && currentStage && isProcessScaffoldActive(experimentVersion))
  const tutorTabEnabled = isTutorTabEnabled(experimentVersion)
  const hiddenTabs = tutorTabEnabled ? [] : ['ai']
  const filteredRecommendedTabs = showProcessGuidance
    ? stageToolGuidance.recommendedTabs.filter((tabId) => !hiddenTabs.includes(tabId))
    : []
  const disabledTabs = showProcessGuidance && stageControlMode === 'hard_constraint'
    ? ALL_NAV_TABS.filter((tabId) => tabId !== 'dashboard' && !filteredRecommendedTabs.includes(tabId) && !hiddenTabs.includes(tabId))
    : []
  const isOnRecommendedTool = showProcessGuidance && filteredRecommendedTabs.includes(activeTab)
  // Some adjacent stages share the same primary tool. Include stage in keys so panes
  // reload stage-scoped state without requiring a full page refresh.
  const stageRenderKey = `${currentProjectId || 'no-project'}:${currentStage || 'no-stage'}`

  const handleStageSelect = (stageId: string) => {
    if (
      !currentProjectId
      || !experimentVersion
      || stageId === currentStage
      || normalizeStageId(stageId) === currentCanonicalStage
    ) return

    if (!isGroupLeader) {
      setStageActionNotice('当前任务阶段由小组组长推进。请先在小组内协商后，由组长统一切换阶段。')
      trackingService.trackResearchEvent({
        project_id: currentProjectId,
        experiment_version_id: experimentVersion.version_name,
        actor_type: 'student',
        event_domain: 'stage_transition',
        event_type: 'stage_manual_change_blocked',
        stage_id: currentStage || undefined,
        payload: {
          requested_stage: stageId,
          current_stage: currentStage,
          block_reason: 'not_group_leader',
        }
      })
      return
    }

    setStageConfirmTarget(stageId)
  }

  const performStageSelect = async () => {
    const stageId = stageConfirmTarget
    if (!stageId || !currentProjectId || !experimentVersion || stageId === currentStage) return

    try {
      setStageChanging(true)
      setStageActionNotice(null)
      setStageConfirmTarget(null)
      const nextVersion = await projectService.updateExperimentVersion(currentProjectId, {
        current_stage: stageId,
      })
      const nextStage = nextVersion.current_stage || stageId
      setExperimentVersion(nextVersion)
      setCurrentStage(nextStage)

      if (isProcessScaffoldActive(nextVersion)) {
        const nextPrimaryTab = getVisiblePrimaryTabForStage(nextStage, nextVersion)
        if (activeTab !== nextPrimaryTab) {
          setActiveTab(nextPrimaryTab)
        }
      }

      trackingService.trackResearchEvent({
        project_id: currentProjectId,
        experiment_version_id: nextVersion.version_name,
        actor_type: 'student',
        event_domain: 'stage_transition',
        event_type: 'group_leader_stage_change',
        stage_id: nextStage,
        payload: {
          from: currentStage,
          to: nextStage,
          controller_role: 'group_leader',
        }
      })
    } catch (error) {
      console.error('Failed to update current stage:', error)
      setStageActionNotice('阶段切换失败。请刷新页面后重试，或联系教师确认小组组长权限。')
      toast.error('阶段切换失败，请刷新页面后重试。')
    } finally {
      setStageChanging(false)
    }
  }

  return (
    <div className="relative h-[100dvh] min-h-0 flex flex-col bg-gray-100">
      {/* Connection Status Banner */}
      <ConnectionStatusBanner
        yjsConnected={connectionStatus === 'connected'}
        socketioConnected={connectionStatus === 'connected'}
        aggregatedState={connectionStatus === 'connected' ? 'full' : 'offline'}
        onReconnect={() => void syncService.reconnect()}
      />
      <button
        type="button"
        onClick={() => {
          setOnboardingStep(0)
          setOnboardingOpen(true)
        }}
        className="fixed bottom-4 left-4 z-30 inline-flex items-center gap-2 rounded-full border border-indigo-100 bg-white/95 px-3 py-2 text-xs font-bold text-indigo-600 shadow-lg shadow-slate-200/70 backdrop-blur transition hover:bg-indigo-50"
      >
        <HelpCircle className="h-4 w-4" />
        使用指南
      </button>

      {/* Main Content Area */}
      <div className="relative flex-1 flex min-h-0 overflow-hidden">
        <div className="pointer-events-none absolute left-2 right-2 top-2 z-20 flex justify-between lg:hidden">
          <button
            type="button"
            onClick={() => setLeftSidebarOpen(true)}
            className="pointer-events-auto inline-flex items-center gap-1.5 rounded-full border border-indigo-100 bg-white/95 px-3 py-1.5 text-xs font-bold text-indigo-600 shadow-sm backdrop-blur"
          >
            <ClipboardList className="h-3.5 w-3.5" />
            任务
          </button>
          <button
            type="button"
            onClick={() => openRightPanel(rightSidebarPanel)}
            className="pointer-events-auto inline-flex items-center gap-1.5 rounded-full border border-indigo-100 bg-white/95 px-3 py-1.5 text-xs font-bold text-indigo-600 shadow-sm backdrop-blur"
          >
            <MessagesSquare className="h-3.5 w-3.5" />
            聊天/支持
          </button>
        </div>
        {leftSidebarOpen && (
          <button
            type="button"
            aria-label="关闭左侧栏"
            onClick={() => setLeftSidebarOpen(false)}
            className="absolute inset-0 z-30 bg-slate-900/20 backdrop-blur-[1px] lg:hidden"
          />
        )}
        {rightSidebarOpen && (
          <button
            type="button"
            aria-label="关闭右侧栏"
            onClick={() => setRightSidebarOpen(false)}
            className="absolute inset-0 z-30 bg-slate-900/20 backdrop-blur-[1px] lg:hidden"
          />
        )}
        {/* Left Sidebar */}
        {leftSidebarOpen && (
          <div className="absolute inset-y-0 left-0 z-40 w-[min(18rem,86vw)] flex-shrink-0 shadow-2xl transition-all duration-300 lg:relative lg:z-auto lg:w-auto lg:shadow-none">
            <Sidebar
              projectId={currentProjectId}
              canSubmitCourseTask={isGroupLeader}
              onCollapse={() => setLeftSidebarOpen(false)}
            />
          </div>
        )}
        {!leftSidebarOpen && (
          <div className="hidden w-12 shrink-0 border-r border-slate-200 bg-white lg:flex lg:flex-col lg:items-center lg:py-3">
            <button
              type="button"
              onClick={() => setLeftSidebarOpen(true)}
              className="relative rounded-xl p-2 text-indigo-600 transition hover:bg-indigo-50"
              title="展开任务看板"
            >
              <PanelLeftOpen className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* Center Content */}
        <div className="flex-1 flex min-w-0 flex-col overflow-hidden">
          {stageUpdateNotice && (
            <div className="border-b border-amber-200 bg-amber-50 px-4 py-3">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-amber-700">阶段调整提示</div>
                  <div className="mt-1 text-sm text-amber-900">
                    教师已将当前任务阶段调整为
                    <span className="mx-1 font-semibold">{formatStageLabel(stageUpdateNotice.stageId)}</span>
                    {stageUpdateNotice.versionName ? (
                      <span className="text-amber-700">（版本：{stageUpdateNotice.versionName}）</span>
                    ) : null}
                    。请根据当前任务进展安排小组协作。
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setStageUpdateNotice(null)}
                  className="rounded-lg border border-amber-200 bg-white px-3 py-1.5 text-xs font-medium text-amber-700 transition-colors hover:bg-amber-100"
                >
                  知道了
                </button>
              </div>
            </div>
          )}
          {hasConfiguredStages && (
            <div className="border-b border-indigo-100 bg-gradient-to-r from-indigo-50/70 via-white to-violet-50/70 px-4 py-1.5">
              <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-semibold uppercase tracking-wide text-indigo-500">任务阶段</span>
                    {currentStage && (
                      <span className="rounded-full bg-indigo-600 px-2.5 py-0.5 text-xs font-semibold text-white shadow-sm">
                        {formatStageLabel(currentStage)}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {showProcessGuidance && filteredRecommendedTabs.length > 0 && (
                    <div className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${isOnRecommendedTool
                        ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200'
                        : 'bg-amber-50 text-amber-700 ring-1 ring-amber-200'
                      }`}>
                      {isOnRecommendedTool ? '当前工具与阶段建议一致' : '当前工具偏离阶段建议'}
                    </div>
                  )}
                  <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium ring-1 ${isGroupLeader
                      ? 'bg-indigo-50 text-indigo-700 ring-indigo-100'
                      : 'bg-slate-50 text-slate-500 ring-slate-200'
                    }`}>
                    {isGroupLeader ? '组长可推进阶段' : '仅组长推进阶段'}
                  </span>
                  {showProcessGuidance ? (
                    <button
                      type="button"
                      onClick={() => setShowStageDetails((prev) => !prev)}
                      className="rounded-full border border-indigo-100 bg-white px-3 py-1 text-xs font-medium text-indigo-600 transition-colors hover:bg-indigo-50"
                    >
                      {showStageDetails ? '收起阶段详情' : '展开阶段详情'}
                    </button>
                  ) : (
                    <span className="rounded-full bg-slate-50 px-2.5 py-0.5 text-[11px] font-medium text-slate-500 ring-1 ring-slate-200">
                      仅显示任务进度
                    </span>
                  )}
                </div>
              </div>

              <div className="mt-1.5 flex items-center gap-2 overflow-x-auto pb-0.5">
                {visibleStageSteps.map(({ canonicalStage, stageId }, index) => {
                  const isActive = currentCanonicalStage === canonicalStage
                  const isStageButtonDisabled = stageChanging || isActive || !isGroupLeader
                  return (
                    <button
                      key={canonicalStage}
                      type="button"
                      onClick={() => handleStageSelect(stageId)}
                      disabled={isStageButtonDisabled}
                      className={`whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-medium transition-all ${isActive
                          ? 'border-indigo-500 bg-indigo-600 text-white shadow-sm'
                          : isStageButtonDisabled
                            ? 'border-slate-200 bg-slate-50 text-slate-400'
                            : 'border-slate-200 bg-white text-slate-600 hover:border-indigo-200 hover:bg-indigo-50'
                        }`}
                      title={!isGroupLeader ? '当前任务阶段由小组组长推进。' : undefined}
                    >
                      {index + 1}. {formatStageLabel(canonicalStage)}
                    </button>
                  )
                })}
              </div>

              {stageActionNotice && (
                <div className="mt-2 rounded-2xl border border-amber-100 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
                  {stageActionNotice}
                </div>
              )}

              {showStageDetails && showProcessGuidance && (
                <div className="mt-2 rounded-2xl border border-indigo-100 bg-white/85 px-4 py-3">
                  <div className="text-xs text-slate-600">
                    {stageToolGuidance.guidance}
                  </div>
                  {filteredRecommendedTabs.length > 0 && (
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <span className="text-xs font-semibold uppercase tracking-wide text-indigo-500">推荐工具</span>
                      {filteredRecommendedTabs.map((tabId) => (
                        <button
                          key={tabId}
                          type="button"
                          onClick={() => setActiveTab(tabId)}
                          className={`rounded-full px-3 py-1 text-xs font-medium transition-all ${activeTab === tabId
                              ? 'bg-indigo-600 text-white'
                              : 'bg-indigo-50 text-indigo-600 hover:bg-indigo-100'
                            }`}
                        >
                          {getTabLabel(tabId)}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
          <TabNavigation
            activeTab={activeTab}
            onTabChange={setActiveTab}
            currentStage={currentStage}
            recommendedTabs={filteredRecommendedTabs}
            disabledTabs={disabledTabs}
            hiddenTabs={hiddenTabs}
          />
          <div className="flex-1 flex flex-col min-h-0 p-2 sm:p-3 overflow-hidden">
            {workspaceLoading ? (
              <div className="flex-1 rounded-2xl border border-indigo-100 bg-white shadow-sm flex items-center justify-center p-8 text-center">
                <div>
                  <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-indigo-200 border-t-indigo-600" />
                  <div className="text-sm font-semibold text-slate-700">正在加载小组学习空间...</div>
                  <div className="mt-1 text-xs text-slate-400">正在同步项目、任务阶段与共享文档</div>
                </div>
              </div>
            ) : workspaceError ? (
              <div className="flex-1 rounded-2xl border border-red-100 bg-white shadow-sm flex items-center justify-center p-8 text-center">
                <div className="max-w-md">
                  <div className="text-base font-semibold text-red-600">学生工作台加载失败</div>
                  <div className="mt-2 text-sm text-slate-500">{workspaceError}</div>
                  <button
                    type="button"
                    onClick={() => setWorkspaceReloadToken((prev) => prev + 1)}
                    className="mt-4 rounded-full bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700"
                  >
                    重新加载
                  </button>
                </div>
              </div>
            ) : currentProjectId ? (
              <div className="flex-1 flex flex-col min-h-0 min-w-0">
                {activeTab === 'document' && (
                  <div className="flex-1 flex flex-col bg-white rounded-lg shadow overflow-hidden">
                    {currentDocumentId ? (
                      <DocumentEditor
                        key={`${currentDocumentId}:${stageRenderKey}`}
                        documentId={currentDocumentId}
                        projectId={currentProjectId}
                        experimentVersion={experimentVersion}
                        initialTaskDocumentId={_project?.initial_task_document_id}
                        onDocumentChange={setCurrentDocumentId}
                        initialDocumentListOpen={documentListOpenOnEntry}
                        onDocumentListVisibilityChange={setDocumentListOpenOnEntry}
                      />
                    ) : documentResolving ? (
                      <div className="flex-1 flex items-center justify-center text-gray-400">
                        正在加载小组文档...
                      </div>
                    ) : documentResolveError ? (
                      <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center">
                        <div className="text-sm text-red-500">{documentResolveError}</div>
                        <div className="flex flex-wrap items-center justify-center gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setCurrentDocumentId(undefined)
                              setDocumentResolveError(null)
                              setDocumentRetryToken((prev) => prev + 1)
                            }}
                            className="rounded-full bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700"
                          >
                            重新加载文档
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleCreateDocumentFromWorkspace()}
                            className="rounded-full border border-indigo-100 bg-white px-4 py-2 text-sm font-semibold text-indigo-600 transition hover:bg-indigo-50"
                          >
                            手动创建新文档
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center text-gray-400">
                        <div>请选择或创建一个文档</div>
                        <button
                          type="button"
                          onClick={() => void handleCreateDocumentFromWorkspace()}
                          className="rounded-full border border-indigo-100 bg-white px-4 py-2 text-sm font-semibold text-indigo-600 transition hover:bg-indigo-50"
                        >
                          创建小组文档
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {activeTab === 'inquiry' && (
                  <div className="flex-1 flex flex-col bg-white rounded-lg shadow overflow-hidden">
                    <InquirySpace key={`inquiry:${stageRenderKey}`} projectId={currentProjectId} experimentVersion={experimentVersion} />
                  </div>
                )}

                {activeTab === 'resources' && (
                  <div className="flex-1 flex flex-col bg-white rounded-lg shadow overflow-hidden">
                    <ResourceLibrary key={`resources:${stageRenderKey}`} projectId={currentProjectId} />
                  </div>
                )}

                {activeTab === 'wiki' && (
                  <div className="flex-1 flex flex-col bg-white rounded-lg shadow overflow-hidden">
                    <ProjectWiki key={`wiki:${stageRenderKey}`} projectId={currentProjectId} />
                  </div>
                )}

                {activeTab === 'ai' && tutorTabEnabled && (
                  <div className="flex-1 flex flex-col overflow-hidden">
                    <AITutor key={`ai:${stageRenderKey}`} projectId={currentProjectId} experimentVersion={experimentVersion} />
                  </div>
                )}
              </div>
            ) : (
              <div className="flex-1 rounded-2xl border border-slate-100 bg-white shadow-sm flex items-center justify-center p-8 text-center text-sm text-slate-400">
                当前账号暂无可进入的小组项目。
              </div>
            )}
            {!workspaceLoading && !workspaceError && activeTab === 'dashboard' && <LearningDashboard />}
          </div>
        </div>

        {/* Right Sidebar */}
        {isDesktopLayout && (
          <div
            className="relative flex-shrink-0 shadow-none"
            style={{ width: rightSidebarOpen ? rightSidebarWidth : 48 }}
          >
            {rightSidebarOpen && (
              <button
                type="button"
                aria-label="拖动调整聊天侧栏宽度"
                title="拖动调整侧栏宽度"
                onPointerDown={(event) => {
                  rightSidebarResizeRef.current = {
                    startX: event.clientX,
                    startWidth: rightSidebarWidth,
                  }
                  setRightSidebarResizing(true)
                }}
                className={`absolute left-0 top-0 z-10 h-full w-2 -translate-x-1 cursor-col-resize ${
                  rightSidebarResizing ? 'bg-indigo-300/60' : 'bg-transparent hover:bg-indigo-200/50'
                }`}
              />
            )}
            <RightSidebar
              projectId={currentProjectId}
              expanded={rightSidebarOpen}
              activePanel={rightSidebarPanel}
              badges={rightSidebarBadges}
              currentUser={user}
              onActivePanelChange={setRightSidebarPanel}
              onOpenSettings={() => setIsSettingsOpen(true)}
              onToggleExpanded={setRightSidebarOpen}
              onBadgesChange={updateRightSidebarBadges}
            />
          </div>
        )}
        {!isDesktopLayout && rightSidebarOpen && (
          <div
            className="absolute inset-y-0 right-0 z-40 flex-shrink-0 shadow-2xl"
            style={{ width: `min(${rightSidebarWidth}px, 92vw)` }}
          >
            <RightSidebar
              projectId={currentProjectId}
              expanded
              activePanel={rightSidebarPanel}
              badges={rightSidebarBadges}
              currentUser={user}
              onActivePanelChange={setRightSidebarPanel}
              onOpenSettings={() => setIsSettingsOpen(true)}
              onToggleExpanded={setRightSidebarOpen}
              onBadgesChange={updateRightSidebarBadges}
            />
          </div>
        )}
      </div>

      <Settings isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />
      {!workspaceLoading && !workspaceError && currentProjectId && tutorTabEnabled && (
        <ContextualAIAssistant
          projectId={currentProjectId}
          experimentVersion={experimentVersion}
          onOpenTutor={() => setActiveTab('ai')}
        />
      )}
      {onboardingOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-xl rounded-3xl bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between gap-4">
              <div className="text-xs font-black uppercase tracking-[0.2em] text-indigo-500">
                第 {onboardingStep + 1} 步 / {STUDENT_ONBOARDING_STEPS.length}
              </div>
              <button
                type="button"
                className="rounded-full p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
                onClick={() => {
                  window.localStorage.setItem('aiscl:student-onboarding-dismissed', 'true')
                  setOnboardingOpen(false)
                }}
                aria-label="关闭使用指南"
              >
                ×
              </button>
            </div>
            <h2 className="mt-3 text-2xl font-black text-slate-900">
              {STUDENT_ONBOARDING_STEPS[onboardingStep].title}
            </h2>
            <p className="mt-3 text-sm leading-7 text-slate-600">
              {STUDENT_ONBOARDING_STEPS[onboardingStep].body}
            </p>
            <div className="mt-4 rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3">
              <div className="text-xs font-black uppercase tracking-wide text-slate-500">使用要点</div>
              <ul className="mt-2 space-y-2 text-sm leading-6 text-slate-700">
                {STUDENT_ONBOARDING_STEPS[onboardingStep].tips.map((tip) => (
                  <li key={tip} className="flex gap-2">
                    <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-400" />
                    <span>{tip}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="mt-5 flex justify-center gap-1.5">
              {STUDENT_ONBOARDING_STEPS.map((step, index) => (
                <button
                  key={step.title}
                  type="button"
                  aria-label={`查看${step.title}`}
                  onClick={() => setOnboardingStep(index)}
                  className={`h-1.5 rounded-full transition-all ${index === onboardingStep ? 'w-8 bg-indigo-600' : 'w-2 bg-slate-200 hover:bg-slate-300'}`}
                />
              ))}
            </div>
            <div className="mt-6 flex items-center justify-between">
              <button
                type="button"
                className="text-sm font-bold text-slate-400 hover:text-slate-600"
                onClick={() => {
                  window.localStorage.setItem('aiscl:student-onboarding-dismissed', 'true')
                  setOnboardingOpen(false)
                }}
              >
                跳过
              </button>
              <div className="flex gap-2">
                {onboardingStep > 0 && (
                  <button
                    type="button"
                    className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-50"
                    onClick={() => setOnboardingStep(prev => Math.max(prev - 1, 0))}
                  >
                    上一步
                  </button>
                )}
                <button
                  type="button"
                  className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-bold text-white hover:bg-indigo-700"
                  onClick={() => {
                    if (onboardingStep >= STUDENT_ONBOARDING_STEPS.length - 1) {
                      window.localStorage.setItem('aiscl:student-onboarding-dismissed', 'true')
                      setOnboardingOpen(false)
                    } else {
                      setOnboardingStep(prev => prev + 1)
                    }
                  }}
                >
                  {onboardingStep >= STUDENT_ONBOARDING_STEPS.length - 1 ? '开始使用' : '下一步'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      <ConfirmDialog
        open={Boolean(stageConfirmTarget)}
        title="确认切换任务阶段"
        description={`确定要将小组任务阶段从「${formatStageLabel(currentStage)}」切换到「${formatStageLabel(stageConfirmTarget)}」吗？切换后全组成员都会按新阶段继续协作。`}
        confirmLabel="确认切换"
        loading={stageChanging}
        onOpenChange={(open) => {
          if (!open) setStageConfirmTarget(null)
        }}
        onConfirm={performStageSelect}
      />
    </div>
  )
}
