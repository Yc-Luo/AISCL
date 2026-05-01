import { useState, useEffect, useRef } from 'react'
import { useParams } from 'react-router-dom'
import Sidebar from '../../components/layout/Sidebar'
import RightSidebar from '../../components/layout/RightSidebar'
import TabNavigation from '../../components/layout/TabNavigation'
import ConnectionStatusBanner from '../../components/feedback/ConnectionStatusBanner'
import ResourceLibrary from '../../components/features/student/resources/ResourceLibrary'
import ProjectWiki from '../../components/features/student/wiki/ProjectWiki'
import LearningDashboard from '../../components/features/student/dashboard/LearningDashboard'
import DocumentEditor from '../../components/features/student/document/DocumentEditor'
import { InquirySpace } from '../../modules/inquiry/components/InquirySpace'
import AITutor from '../../components/features/student/ai/AITutor'
import AIAssistant from '../../components/features/student/ai/AIAssistant'
import NotificationCenter from '../../components/feedback/NotificationCenter'
import { projectService } from '../../services/api/project'
import { documentService } from '../../services/api/document'
import { ExperimentVersion, Project } from '../../types'
import { useAuthStore } from '../../stores/authStore'
import { useSyncStore } from '../../stores/syncStore'
import Settings from '../../components/features/student/settings/Settings'
import { syncService } from '../../services/sync/SyncService'
import { useBehaviorTracking } from '../../hooks/common/useBehaviorTracking'
import { useActivityTracking } from '../../hooks/common/useActivityTracking'
import { useContextStore } from '../../stores/contextStore'
import { trackingService } from '../../services/tracking/TrackingService'
import { isProcessScaffoldActive, isTutorTabEnabled } from '../../lib/experimentScaffold'

const DEFAULT_STAGE_LABELS: Record<string, string> = {
  orientation: '任务导入',
  planning: '问题规划',
  inquiry: '证据探究',
  argumentation: '论证协商',
  revision: '反思修订',
  summary: '成果整合',
  reflection: '总结反思',
}

const formatStageLabel = (stageId: string) => {
  if (DEFAULT_STAGE_LABELS[stageId]) return DEFAULT_STAGE_LABELS[stageId]
  return stageId
    .split(/[_-]/g)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ')
}

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

const STAGE_TOOL_GUIDANCE: Record<
  string,
  {
    primaryTab: string
    recommendedTabs: string[]
    guidance: string
  }
> = {
  orientation: {
    primaryTab: 'document',
    recommendedTabs: ['document', 'resources', 'wiki', 'ai'],
    guidance: '先阅读任务说明并明确目标，必要时借助资源库和 AI 导师完成任务理解。',
  },
  planning: {
    primaryTab: 'document',
    recommendedTabs: ['document', 'resources', 'wiki', 'ai'],
    guidance: '优先形成问题清单和初步方案，文档区用于记录计划，资源库与项目 Wiki 用于补充信息。',
  },
  inquiry: {
    primaryTab: 'inquiry',
    recommendedTabs: ['inquiry', 'resources', 'wiki', 'ai', 'document'],
    guidance: '以深度探究空间为主，围绕证据收集、来源核验和材料组织展开探究。',
  },
  argumentation: {
    primaryTab: 'inquiry',
    recommendedTabs: ['inquiry', 'document', 'wiki', 'ai'],
    guidance: '重点围绕主张、证据和反驳开展论证协商，深度探究空间和文档区应协同使用。',
  },
  revision: {
    primaryTab: 'document',
    recommendedTabs: ['document', 'inquiry', 'wiki', 'ai'],
    guidance: '优先回到文档和探究记录进行修订，对照证据和反驳结果完善最终表达。',
  },
  summary: {
    primaryTab: 'document',
    recommendedTabs: ['document', 'inquiry', 'wiki', 'ai'],
    guidance: '以文档整合为主，梳理最终结论和证据链，形成阶段性成果。',
  },
  reflection: {
    primaryTab: 'document',
    recommendedTabs: ['document', 'wiki', 'ai', 'dashboard'],
    guidance: '围绕过程反思和经验总结展开记录，可借助 AI 导师回顾关键决策与修订节点。',
  },
}

const getStageToolGuidance = (stageId: string | null) => {
  if (!stageId) {
    return {
      primaryTab: 'document',
      recommendedTabs: [],
      guidance: '当前未配置任务阶段，按任务需要自主选择工具。',
    }
  }

  return STAGE_TOOL_GUIDANCE[stageId] || {
    primaryTab: 'document',
    recommendedTabs: ['document', 'inquiry', 'resources', 'wiki', 'ai'],
    guidance: '当前阶段未预设专属工具规则，建议优先使用文档与探究空间。',
  }
}

const getVisiblePrimaryTabForStage = (stageId: string | null, version: ExperimentVersion | null) => {
  const primaryTab = getStageToolGuidance(stageId).primaryTab
  if (primaryTab === 'ai' && !isTutorTabEnabled(version)) return 'document'
  return primaryTab
}

export default function Main() {
  const { projectId } = useParams<{ projectId?: string }>()
  const [currentProjectId, setCurrentProjectId] = useState<string | undefined>(projectId)
  const [activeTab, setActiveTab] = useState('document')
  const [currentStage, setCurrentStage] = useState<string | null>(null)
  const [leftSidebarOpen, setLeftSidebarOpen] = useState(true)
  const [rightSidebarOpen, setRightSidebarOpen] = useState(true)
  const [_project, setProject] = useState<Project | null>(null)
  const [experimentVersion, setExperimentVersion] = useState<ExperimentVersion | null>(null)
  const [currentDocumentId, setCurrentDocumentId] = useState<string | undefined>(undefined)
  const [workspaceLoading, setWorkspaceLoading] = useState(true)
  const [workspaceError, setWorkspaceError] = useState<string | null>(null)
  const [workspaceReloadToken, setWorkspaceReloadToken] = useState(0)
  const [documentResolving, setDocumentResolving] = useState(false)
  const [documentResolveError, setDocumentResolveError] = useState<string | null>(null)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [showStageDetails, setShowStageDetails] = useState(false)
  const [stageChanging, setStageChanging] = useState(false)
  const [stageUpdateNotice, setStageUpdateNotice] = useState<{
    stageId: string
    versionName?: string | null
    refreshReason: 'focus' | 'interval'
  } | null>(null)
  const [stageActionNotice, setStageActionNotice] = useState<string | null>(null)
  const previousStageRef = useRef<string | null>(null)
  const previousGuidedStageRef = useRef<string | null>(null)

  const { connectionStatus } = useSyncStore()
  const { user } = useAuthStore()
  const setContextProjectId = useContextStore(state => state.setProjectId)
  const setContextActiveTab = useContextStore(state => state.setActiveTab)
  const setContextCurrentStage = useContextStore(state => state.setCurrentStage)
  const setContextExperimentVersionId = useContextStore(state => state.setExperimentVersionId)
  const setContextDocumentId = useContextStore(state => state.setDocumentId)

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
    setCurrentDocumentId(undefined)
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
  }, [activeTab, currentProjectId, currentDocumentId, _project, workspaceError, workspaceLoading])

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
  const processScaffoldMode = experimentVersion?.process_scaffold_mode || 'on'
  const hasConfiguredStages = (experimentVersion?.stage_sequence?.length || 0) > 0
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

  const handleStageSelect = async (stageId: string) => {
    if (!currentProjectId || !experimentVersion || stageId === currentStage) return

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

    try {
      setStageChanging(true)
      setStageActionNotice(null)
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
    } finally {
      setStageChanging(false)
    }
  }

  return (
    <div className="h-[100dvh] min-h-0 flex flex-col bg-gray-100">
      {/* Connection Status Banner */}
      <ConnectionStatusBanner
        yjsConnected={connectionStatus === 'connected'}
        socketioConnected={connectionStatus === 'connected'}
        aggregatedState={connectionStatus === 'connected' ? 'full' : 'offline'}
        onReconnect={() => syncService.init()}
      />

      {/* Header */}
      <header className="bg-white/90 backdrop-blur-xl border-b border-indigo-100/50 px-3 sm:px-4 py-2.5 flex items-center justify-between gap-2 shadow-sm sticky top-0 z-50">
        <div className="flex min-w-0 items-center gap-2 sm:gap-4">
          <button
            onClick={() => setLeftSidebarOpen(!leftSidebarOpen)}
            className="p-2 hover:bg-indigo-50 rounded-xl text-indigo-600 transition-colors"
          >
            ☰
          </button>
          <div className="flex min-w-0 items-center gap-2">
            <h1 className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-indigo-600 to-violet-600">AISCL</h1>
            <span className="hidden rounded-full border border-indigo-100 bg-indigo-50 px-2 py-0.5 text-xs font-semibold tracking-wide text-indigo-600 sm:inline-flex">协作学习系统</span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2 sm:gap-4">
          <NotificationCenter />
          <button
            onClick={() => setRightSidebarOpen(!rightSidebarOpen)}
            className="p-2 hover:bg-indigo-50 rounded-xl text-indigo-600 transition-colors"
          >
            👥
          </button>
          <div
            className="h-8 w-8 rounded-full bg-gradient-to-tr from-indigo-500 to-purple-500 border-2 border-white shadow-md cursor-pointer hover:ring-2 hover:ring-indigo-300 transition-all overflow-hidden flex items-center justify-center text-white font-bold text-sm"
            onClick={() => setIsSettingsOpen(true)}
            title={user?.username || '用户设置'}
          >
            {user?.avatar_url ? (
              <img src={user.avatar_url} alt="User" className="h-full w-full object-cover" />
            ) : (
              (user?.username || 'U')[0].toUpperCase()
            )}
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <div className="relative flex-1 flex min-h-0 overflow-hidden">
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
            <Sidebar projectId={currentProjectId} />
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
                      {processScaffoldMode === 'off' ? '未启用过程支架' : '仅显示任务进度'}
                    </span>
                  )}
                </div>
              </div>

              <div className="mt-1.5 flex items-center gap-2 overflow-x-auto pb-0.5">
                {(experimentVersion?.stage_sequence || []).map((stageId, index) => {
                  const isActive = currentStage === stageId
                  const isStageButtonDisabled = stageChanging || isActive || !isGroupLeader
                  return (
                    <button
                      key={stageId}
                      type="button"
                      onClick={() => void handleStageSelect(stageId)}
                      disabled={isStageButtonDisabled}
                      className={`whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-medium transition-all ${isActive
                          ? 'border-indigo-500 bg-indigo-600 text-white shadow-sm'
                          : isStageButtonDisabled
                            ? 'border-slate-200 bg-slate-50 text-slate-400'
                            : 'border-slate-200 bg-white text-slate-600 hover:border-indigo-200 hover:bg-indigo-50'
                        }`}
                      title={!isGroupLeader ? '当前任务阶段由小组组长推进。' : undefined}
                    >
                      {index + 1}. {formatStageLabel(stageId)}
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
                          {tabId === 'document'
                            ? '文档'
                            : tabId === 'inquiry'
                              ? '深度探究'
                              : tabId === 'resources'
                                ? '资源库'
                                : tabId === 'wiki'
                                  ? '项目 Wiki'
                                  : tabId === 'ai'
                                    ? 'AI 导师'
                                    : '仪表盘'}
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
                      />
                    ) : documentResolving ? (
                      <div className="flex-1 flex items-center justify-center text-gray-400">
                        正在加载小组文档...
                      </div>
                    ) : documentResolveError ? (
                      <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center">
                        <div className="text-sm text-red-500">{documentResolveError}</div>
                        <button
                          type="button"
                          onClick={() => {
                            setDocumentResolveError(null)
                            setWorkspaceReloadToken((prev) => prev + 1)
                          }}
                          className="rounded-full bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700"
                        >
                          重新加载文档
                        </button>
                      </div>
                    ) : (
                      <div className="flex-1 flex items-center justify-center text-gray-400">
                        请选择或创建一个文档
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
        {rightSidebarOpen && (
          <div className="absolute inset-y-0 right-0 z-40 w-[min(28rem,92vw)] flex-shrink-0 shadow-2xl lg:relative lg:z-auto lg:w-[340px] lg:shadow-none xl:w-[380px] 2xl:w-[400px]">
            <RightSidebar projectId={currentProjectId} />
          </div>
        )}
      </div>

      <AIAssistant projectId={currentProjectId} experimentVersion={experimentVersion} />
      <Settings isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />
    </div>
  )
}
