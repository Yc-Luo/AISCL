import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { TrendingUp, Download, Users, Clock, Target, FolderOpen, Brain, FlaskConical, Save, ChevronsLeft, ChevronsRight, RefreshCcw, ShieldCheck } from 'lucide-react';
import { Button, Badge } from '../../../ui';
import {
    BarChart,
    Bar,
    Cell,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
    Area,
    AreaChart
} from 'recharts';
import { projectService } from '../../../../services/api/project';
import { ResearchProjectHealth, analyticsService } from '../../../../services/api/analytics';
import { ExperimentVersion, Project } from '../../../../types';
import { trackingService } from '../../../../services/tracking/TrackingService';
import { buildReadableResearchEventRow, getResearchEventCodebook } from '../../../../lib/researchEventLabels';

const parseCsvList = (value: string): string[] =>
    Array.from(
        new Set(
            value
                .split(',')
                .map((item) => item.trim())
                .filter(Boolean)
        )
    );

const RULE_SET_OPTIONS = [
    {
        value: 'research-default',
        label: '默认影子模式',
        hint: '只记录 shadow_prompt_candidate，不向群聊真实发提示。',
    },
    {
        value: 'research-default+group-chat-live',
        label: '低频群聊提示试点',
        hint: '满足冷却与连续窗口条件后，群聊会真实收到 1 条短提示。',
    },
    {
        value: 'evidence-focus',
        label: '证据聚焦',
        hint: '优先启用证据不足相关规则与提示表达。',
    },
    {
        value: 'argumentation-focus',
        label: '论证聚焦',
        hint: '优先启用反驳生成与观点比较相关规则。',
    },
    {
        value: 'revision-focus',
        label: '修订聚焦',
        hint: '优先启用修订推进与修改理由相关规则。',
    },
];

const toFileSafeName = (value: string | null | undefined): string =>
    (value || 'unknown')
        .replace(/[^\w\u4e00-\u9fa5-]+/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_|_$/g, '') || 'unknown';

const serializeCell = (value: unknown): string => {
    if (value === null || value === undefined) return '';
    if (value instanceof Date) return value.toISOString();
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
};

const rowsToCsv = (rows: Record<string, unknown>[]): string => {
    if (rows.length === 0) return '';
    const headers = Array.from(
        rows.reduce((set, row) => {
            Object.keys(row).forEach((key) => set.add(key));
            return set;
        }, new Set<string>())
    );
    const escapeCell = (value: unknown): string => {
        const text = serializeCell(value);
        if (/[",\n\r]/.test(text)) {
            return `"${text.replace(/"/g, '""')}"`;
        }
        return text;
    };
    return [
        headers.join(','),
        ...rows.map((row) => headers.map((header) => escapeCell(row[header])).join(',')),
    ].join('\n');
};

const downloadTextFile = (filename: string, content: string, mimeType: string) => {
    const blob = new Blob([content], { type: mimeType });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
};

export default function ProjectDashboard() {
    const [searchParams] = useSearchParams();
    const projectIdFromQuery = searchParams.get('project');

    // Basic States
    const [projects, setProjects] = useState<Project[]>([]);
    const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
    const [analyticsData, setAnalyticsData] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [fetchingAnalytics, setFetchingAnalytics] = useState(false);

    // Feature States
    const [activeTab, setActiveTab] = useState<'dashboard' | 'behavior'>('dashboard');
    const [behaviorLogs, setBehaviorLogs] = useState<any[]>([]);
    const [fetchingLogs, setFetchingLogs] = useState(false);
    const [experimentVersion, setExperimentVersion] = useState<ExperimentVersion | null>(null);
    const [experimentDraft, setExperimentDraft] = useState<ExperimentVersion | null>(null);
    const [fetchingExperiment, setFetchingExperiment] = useState(false);
    const [savingExperiment, setSavingExperiment] = useState(false);
    const [experimentMessage, setExperimentMessage] = useState<string | null>(null);
    const [researchHealth, setResearchHealth] = useState<ResearchProjectHealth | null>(null);
    const [fetchingResearchHealth, setFetchingResearchHealth] = useState(false);
    const [exportingResearch, setExportingResearch] = useState<string | null>(null);
    const [researchExportMessage, setResearchExportMessage] = useState<string | null>(null);

    useEffect(() => {
        const fetchProjects = async () => {
            try {
                setLoading(true);
                const data = await projectService.getProjects();
                setProjects(data.projects);
                if (data.projects.length > 0) {
                    const matchedProject = projectIdFromQuery
                        ? data.projects.find((project) => project.id === projectIdFromQuery)
                        : null;
                    setSelectedProjectId(matchedProject?.id || data.projects[0].id);
                }
            } catch (error) {
                console.error('Failed to fetch projects for analytics:', error);
            } finally {
                setLoading(false);
            }
        };
        fetchProjects();
    }, [projectIdFromQuery]);

    useEffect(() => {
        const fetchAnalytics = async () => {
            if (!selectedProjectId) return;
            try {
                setFetchingAnalytics(true);
                const data = await analyticsService.getDashboardData(selectedProjectId);
                setAnalyticsData(data);
            } catch (error) {
                console.error('Failed to fetch analytics data:', error);
            } finally {
                setFetchingAnalytics(false);
            }
        };

        if (activeTab === 'dashboard' && selectedProjectId) {
            fetchAnalytics();
        }
    }, [selectedProjectId, activeTab]);

    useEffect(() => {
        const fetchExperimentVersion = async () => {
            if (!selectedProjectId) return;
            try {
                setFetchingExperiment(true);
                setExperimentMessage(null);
                const data = await projectService.getExperimentVersion(selectedProjectId);
                setExperimentVersion(data);
                setExperimentDraft(data);
            } catch (error) {
                console.error('Failed to fetch experiment version:', error);
                setExperimentVersion(null);
                setExperimentDraft(null);
                setExperimentMessage('实验版本读取失败，请稍后重试。');
            } finally {
                setFetchingExperiment(false);
            }
        };

        fetchExperimentVersion();
    }, [selectedProjectId]);

    useEffect(() => {
        const fetchLogs = async () => {
            if (!selectedProjectId) return;
            try {
                setFetchingLogs(true);
                const data = await analyticsService.getActivityLogs(selectedProjectId);
                setBehaviorLogs(data);
            } catch (error) {
                console.error('Failed to fetch behavior logs:', error);
            } finally {
                setFetchingLogs(false);
            }
        };

        if (activeTab === 'behavior' && selectedProjectId) {
            fetchLogs();
        }
    }, [selectedProjectId, activeTab]);

    const fetchResearchHealth = async (projectId: string) => {
        try {
            setFetchingResearchHealth(true);
            const data = await analyticsService.getResearchHealth(projectId);
            setResearchHealth(data);
        } catch (error) {
            console.error('Failed to fetch research health:', error);
            setResearchHealth(null);
        } finally {
            setFetchingResearchHealth(false);
        }
    };

    useEffect(() => {
        if (!selectedProjectId) return;
        fetchResearchHealth(selectedProjectId);
    }, [selectedProjectId]);

    const handleDraftChange = <K extends keyof ExperimentVersion>(field: K, value: ExperimentVersion[K]) => {
        setExperimentDraft((prev) => {
            if (!prev) return prev;
            return {
                ...prev,
                [field]: value,
            };
        });
    };

    const persistExperimentDraft = async (
        draft: ExperimentVersion,
        options?: {
            successMessage?: string
            updateSource?: 'manual_save' | 'quick_advance_stage' | 'quick_rewind_stage'
        }
    ) => {
        if (!selectedProjectId) return;

        const normalizedStageSequence = draft.stage_sequence.filter(Boolean);
        const normalizedCurrentStage = normalizedStageSequence.includes(draft.current_stage || '')
            ? draft.current_stage
            : (normalizedStageSequence[0] || null);

        try {
            setSavingExperiment(true);
            setExperimentMessage(null);
            const payload: Partial<ExperimentVersion> = {
                mode: draft.mode,
                version_name: draft.version_name.trim() || 'default',
                stage_control_mode: draft.stage_control_mode,
                process_scaffold_mode: draft.process_scaffold_mode,
                ai_scaffold_mode: draft.ai_scaffold_mode,
                broadcast_stage_updates: draft.broadcast_stage_updates,
                group_condition: draft.group_condition?.trim() || null,
                enabled_scaffold_layers: draft.enabled_scaffold_layers,
                enabled_scaffold_roles: draft.enabled_scaffold_roles,
                enabled_rule_set: draft.enabled_rule_set?.trim() || null,
                export_profile: draft.export_profile?.trim() || null,
                stage_sequence: normalizedStageSequence,
                current_stage: normalizedCurrentStage,
            };
            const saved = await projectService.updateExperimentVersion(selectedProjectId, payload);
            const previousVersion = experimentVersion;
            const changedFields = [
                previousVersion?.version_name !== saved.version_name ? 'version_name' : null,
                previousVersion?.stage_control_mode !== saved.stage_control_mode ? 'stage_control_mode' : null,
                previousVersion?.process_scaffold_mode !== saved.process_scaffold_mode ? 'process_scaffold_mode' : null,
                previousVersion?.ai_scaffold_mode !== saved.ai_scaffold_mode ? 'ai_scaffold_mode' : null,
                previousVersion?.broadcast_stage_updates !== saved.broadcast_stage_updates ? 'broadcast_stage_updates' : null,
                previousVersion?.group_condition !== saved.group_condition ? 'group_condition' : null,
                JSON.stringify(previousVersion?.enabled_scaffold_layers || []) !== JSON.stringify(saved.enabled_scaffold_layers || []) ? 'enabled_scaffold_layers' : null,
                JSON.stringify(previousVersion?.enabled_scaffold_roles || []) !== JSON.stringify(saved.enabled_scaffold_roles || []) ? 'enabled_scaffold_roles' : null,
                previousVersion?.enabled_rule_set !== saved.enabled_rule_set ? 'enabled_rule_set' : null,
                previousVersion?.export_profile !== saved.export_profile ? 'export_profile' : null,
                JSON.stringify(previousVersion?.stage_sequence || []) !== JSON.stringify(saved.stage_sequence || []) ? 'stage_sequence' : null,
                previousVersion?.current_stage !== saved.current_stage ? 'current_stage' : null,
            ].filter(Boolean);

            trackingService.trackResearchEvent({
                project_id: selectedProjectId,
                experiment_version_id: saved.version_name,
                actor_type: 'teacher',
                event_domain: 'stage_transition',
                event_type: 'teacher_experiment_config_update',
                stage_id: saved.current_stage || undefined,
                payload: {
                    changed_fields: changedFields,
                    version_name: saved.version_name,
                    stage_control_mode: saved.stage_control_mode,
                    process_scaffold_mode: saved.process_scaffold_mode,
                    ai_scaffold_mode: saved.ai_scaffold_mode,
                    broadcast_stage_updates: saved.broadcast_stage_updates,
                    group_condition: saved.group_condition,
                    enabled_scaffold_layers: saved.enabled_scaffold_layers,
                    enabled_scaffold_roles: saved.enabled_scaffold_roles,
                    enabled_rule_set: saved.enabled_rule_set,
                    export_profile: saved.export_profile,
                    stage_sequence: saved.stage_sequence,
                    current_stage: saved.current_stage,
                    update_source: options?.updateSource || 'manual_save',
                }
            });
            setExperimentVersion(saved);
            setExperimentDraft(saved);
            setExperimentMessage(options?.successMessage || '实验配置已保存。');
        } catch (error) {
            console.error('Failed to update experiment version:', error);
            setExperimentMessage('实验配置保存失败，请稍后重试。');
        } finally {
            setSavingExperiment(false);
        }
    };

    const handleExperimentSave = async () => {
        if (!experimentDraft) return;
        await persistExperimentDraft(experimentDraft, {
            successMessage: '实验配置已保存。',
            updateSource: 'manual_save',
        });
    };

    const handleAdvanceToNextStage = async () => {
        if (!experimentDraft) return;

        const stages = experimentDraft.stage_sequence.filter(Boolean);
        if (stages.length === 0) {
            setExperimentMessage('当前还没有配置阶段序列，无法推进阶段。');
            return;
        }

        const currentIndex = experimentDraft.current_stage ? stages.indexOf(experimentDraft.current_stage) : -1;
        const nextIndex = currentIndex < 0 ? 0 : currentIndex + 1;

        if (nextIndex >= stages.length) {
            setExperimentMessage('当前已经处于最后一个阶段。');
            return;
        }

        const nextDraft: ExperimentVersion = {
            ...experimentDraft,
            current_stage: stages[nextIndex],
        };

        await persistExperimentDraft(nextDraft, {
            successMessage: `已推进到下一阶段：${stages[nextIndex]}`,
            updateSource: 'quick_advance_stage',
        });
    };

    const handleRewindToPreviousStage = async () => {
        if (!experimentDraft) return;

        const stages = experimentDraft.stage_sequence.filter(Boolean);
        if (stages.length === 0) {
            setExperimentMessage('当前还没有配置阶段序列，无法回退阶段。');
            return;
        }

        const currentIndex = experimentDraft.current_stage ? stages.indexOf(experimentDraft.current_stage) : -1;
        if (currentIndex <= 0) {
            setExperimentMessage('当前已经处于第一个阶段。');
            return;
        }

        const nextDraft: ExperimentVersion = {
            ...experimentDraft,
            current_stage: stages[currentIndex - 1],
        };

        await persistExperimentDraft(nextDraft, {
            successMessage: `已回退到上一阶段：${stages[currentIndex - 1]}`,
            updateSource: 'quick_rewind_stage',
        });
    };

    const handleExport = async (format: 'csv' | 'json') => {
        if (!selectedProjectId) return;
        try {
            const data = await analyticsService.exportData(selectedProjectId, format);
            const projectSlug = toFileSafeName(selectedProject?.name || selectedProjectId);
            if (format === 'json') {
                downloadTextFile(
                    `analytics_${projectSlug}.json`,
                    JSON.stringify(data, null, 2),
                    'application/json;charset=utf-8'
                );
            } else {
                const rows = [
                    {
                        project_id: data.project_id,
                        exported_at: data.exported_at,
                        dashboard: data.data?.dashboard,
                        activity_logs: data.data?.activity_logs,
                        behavior_stream: data.data?.behavior_stream,
                    }
                ];
                downloadTextFile(
                    `analytics_${projectSlug}.csv`,
                    rowsToCsv(rows),
                    'text/csv;charset=utf-8'
                );
            }
        } catch (error) {
            console.error('Export failed:', error);
        }
    };

    const handleResearchExport = async (
        kind: 'research-events' | 'group-stage-features' | 'lsa-ready' | 'group-chat-transcripts' | 'ai-tutor-transcripts' | 'bundle',
        format: 'csv' | 'json'
    ) => {
        if (!selectedProjectId) return;
        const exportKey = `${kind}-${format}`;
        setExportingResearch(exportKey);
        setResearchExportMessage(null);
        try {
            const projectSlug = toFileSafeName(selectedProject?.name || selectedProjectId);
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

            if (kind === 'research-events') {
                const data = await analyticsService.getResearchEvents(selectedProjectId, { limit: 10000 });
                const rows = data.events.map(buildReadableResearchEventRow);
                if (format === 'json') {
                    downloadTextFile(
                        `research_events_${projectSlug}_${timestamp}.json`,
                        JSON.stringify(
                            {
                                ...data,
                                event_codebook: getResearchEventCodebook(),
                                readable_events: rows,
                            },
                            null,
                            2
                        ),
                        'application/json;charset=utf-8'
                    );
                } else {
                    downloadTextFile(
                        `research_events_${projectSlug}_${timestamp}.csv`,
                        rowsToCsv(rows),
                        'text/csv;charset=utf-8'
                    );
                }
                setResearchExportMessage(`已导出原始研究事件 ${data.total} 条，CSV 已包含中文说明与分析标签列。`);
                return;
            }

            if (kind === 'group-stage-features') {
                const data = await analyticsService.getGroupStageFeatures(selectedProjectId);
                if (format === 'json') {
                    downloadTextFile(
                        `group_stage_features_${projectSlug}_${timestamp}.json`,
                        JSON.stringify(data, null, 2),
                        'application/json;charset=utf-8'
                    );
                } else {
                    downloadTextFile(
                        `group_stage_features_${projectSlug}_${timestamp}.csv`,
                        rowsToCsv(data.features as unknown as Record<string, unknown>[]),
                        'text/csv;charset=utf-8'
                    );
                }
                setResearchExportMessage(`已导出组-阶段特征 ${data.total} 行。`);
                return;
            }

            if (kind === 'lsa-ready') {
                const data = await analyticsService.getLSAReady(selectedProjectId);
                if (format === 'json') {
                    downloadTextFile(
                        `lsa_ready_${projectSlug}_${timestamp}.json`,
                        JSON.stringify(data, null, 2),
                        'application/json;charset=utf-8'
                    );
                } else {
                    downloadTextFile(
                        `lsa_ready_${projectSlug}_${timestamp}.csv`,
                        rowsToCsv(data.sequences as unknown as Record<string, unknown>[]),
                        'text/csv;charset=utf-8'
                    );
                }
                setResearchExportMessage(`已导出 LSA/HMM 序列 ${data.total} 行。`);
                return;
            }

            if (kind === 'group-chat-transcripts') {
                const data = await analyticsService.getGroupChatTranscripts(selectedProjectId);
                if (format === 'json') {
                    downloadTextFile(
                        `group_chat_transcripts_${projectSlug}_${timestamp}.json`,
                        JSON.stringify(data, null, 2),
                        'application/json;charset=utf-8'
                    );
                } else {
                    downloadTextFile(
                        `group_chat_transcripts_${projectSlug}_${timestamp}.csv`,
                        rowsToCsv(data.messages as unknown as Record<string, unknown>[]),
                        'text/csv;charset=utf-8'
                    );
                }
                setResearchExportMessage(`已导出小组聊天全文 ${data.total} 条。`);
                return;
            }

            if (kind === 'ai-tutor-transcripts') {
                const data = await analyticsService.getAITutorTranscripts(selectedProjectId);
                if (format === 'json') {
                    downloadTextFile(
                        `ai_tutor_transcripts_${projectSlug}_${timestamp}.json`,
                        JSON.stringify(data, null, 2),
                        'application/json;charset=utf-8'
                    );
                } else {
                    downloadTextFile(
                        `ai_tutor_transcripts_${projectSlug}_${timestamp}.csv`,
                        rowsToCsv(data.messages as unknown as Record<string, unknown>[]),
                        'text/csv;charset=utf-8'
                    );
                }
                setResearchExportMessage(`已导出 AI导师个人对话全文 ${data.total} 条。`);
                return;
            }

            const [health, events, features, lsa, groupChat, aiTutor] = await Promise.all([
                analyticsService.getResearchHealth(selectedProjectId),
                analyticsService.getResearchEvents(selectedProjectId, { limit: 10000 }),
                analyticsService.getGroupStageFeatures(selectedProjectId),
                analyticsService.getLSAReady(selectedProjectId),
                analyticsService.getGroupChatTranscripts(selectedProjectId),
                analyticsService.getAITutorTranscripts(selectedProjectId),
            ]);
            const readableEvents = events.events.map(buildReadableResearchEventRow);
            const bundle = {
                project_id: selectedProjectId,
                project_name: selectedProject?.name,
                exported_at: new Date().toISOString(),
                research_event_codebook: getResearchEventCodebook(),
                health,
                research_events: events,
                research_events_readable: {
                    events: readableEvents,
                    total: events.total,
                },
                group_stage_features: features,
                lsa_ready: lsa,
                group_chat_transcripts: groupChat,
                ai_tutor_transcripts: aiTutor,
            };
            downloadTextFile(
                `research_bundle_${projectSlug}_${timestamp}.json`,
                JSON.stringify(bundle, null, 2),
                'application/json;charset=utf-8'
            );
            setResearchExportMessage('已导出研究数据包。');
        } catch (error) {
            console.error('Research export failed:', error);
            setResearchExportMessage('研究数据导出失败，请检查网络或稍后重试。');
        } finally {
            setExportingResearch(null);
        }
    };

    const researchHealthChecks = researchHealth ? [
        { label: '支架事件', passed: researchHealth.has_scaffold_events },
        { label: '探究事件', passed: researchHealth.has_inquiry_events },
        { label: '共享记录事件', passed: researchHealth.has_shared_record_events },
        { label: '阶段事件', passed: researchHealth.has_stage_events },
        { label: '推荐采纳事件', passed: researchHealth.has_rule_accept_events },
    ] : [];

    const researchReadinessPassed = researchHealthChecks.length > 0 && researchHealthChecks.every((item) => item.passed);

    if (loading) {
        return <div className="flex items-center justify-center h-64">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
            <span className="ml-3 text-slate-500">加载中...</span>
        </div>;
    }

    // Data Transformation for Charts
    const fourCData = analyticsData ? [
        { name: '沟通', value: analyticsData.four_c.communication, color: '#3b82f6' },
        { name: '协作', value: analyticsData.four_c.collaboration, color: '#22c55e' },
        { name: '批判思维', value: analyticsData.four_c.critical_thinking, color: '#f59e0b' },
        { name: '创造力', value: analyticsData.four_c.creativity, color: '#a855f7' },
    ] : [];

    const activityTrend = analyticsData?.activity_trend?.map((item: any) => ({
        date: new Date(item.date).toLocaleDateString(),
        score: item.activity_score,
        minutes: item.active_minutes
    })) || [];
    const selectedProject = projects.find((project) => project.id === selectedProjectId) || null;
    const stageSequenceInput = experimentDraft?.stage_sequence.join(', ') || '';
    const scaffoldLayersInput = experimentDraft?.enabled_scaffold_layers.join(', ') || '';
    const scaffoldRolesInput = experimentDraft?.enabled_scaffold_roles.join(', ') || '';

    return (
        <div className="space-y-6 animate-fadeIn">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-gray-100 pb-6">
                <div>
                    <h1 className="text-2xl font-bold text-slate-800">小组仪表盘</h1>
                    <p className="text-sm text-slate-500 mt-1">可视化监控小组进度、协作表现与原始行为日志</p>
                </div>
                <div className="flex items-center gap-3">
                    <div className="relative">
                        <FolderOpen className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                        <select
                            value={selectedProjectId || ''}
                            onChange={(e) => setSelectedProjectId(e.target.value)}
                            className="pl-9 pr-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm font-medium focus:ring-2 focus:ring-indigo-500 shadow-sm"
                        >
                            {projects.map(p => (
                                <option key={p.id} value={p.id}>{p.name}</option>
                            ))}
                        </select>
                    </div>
                </div>
            </div>

            {/* Tabs Navigation */}
            <div className="flex gap-1 p-1 bg-gray-100 rounded-xl w-fit">
                <button
                    onClick={() => setActiveTab('dashboard')}
                    className={`px-6 py-2 rounded-lg text-sm font-medium transition-all ${activeTab === 'dashboard' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                >
                    学情分析看板
                </button>
                <button
                    onClick={() => setActiveTab('behavior')}
                    className={`px-6 py-2 rounded-lg text-sm font-medium transition-all ${activeTab === 'behavior' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                >
                    行为流记录 (Logs)
                </button>
            </div>

            <div className="bg-white rounded-2xl border border-indigo-100 shadow-sm p-6">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                        <div className="flex items-center gap-2">
                            <FlaskConical className="w-5 h-5 text-indigo-600" />
                            <h2 className="text-lg font-bold text-slate-800">实验控制面板</h2>
                        </div>
                        <p className="mt-1 text-sm text-slate-500">
                            用于快速核对当前小组的实验版本、组别条件、阶段序列与支架开放范围。
                        </p>
                        {selectedProject && (
                            <div className="mt-2 text-xs text-slate-400">
                                当前小组：<span className="font-medium text-slate-600">{selectedProject.name}</span>
                            </div>
                        )}
                    </div>
                    <div className="flex items-center gap-2">
                        {experimentVersion?.updated_at && (
                            <span className="text-xs text-slate-400">
                                最近更新：{new Date(experimentVersion.updated_at).toLocaleString()}
                            </span>
                        )}
                        <Button
                            size="sm"
                            onClick={handleExperimentSave}
                            disabled={!experimentDraft || savingExperiment}
                            className="gap-2 rounded-lg"
                        >
                            <Save className="w-4 h-4" />
                            {savingExperiment ? '保存中...' : '保存实验配置'}
                        </Button>
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={handleRewindToPreviousStage}
                            disabled={!experimentDraft || savingExperiment || experimentDraft.stage_sequence.filter(Boolean).length === 0}
                            className="gap-2 rounded-lg"
                        >
                            <ChevronsLeft className="w-4 h-4" />
                            回退到上一阶段
                        </Button>
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={handleAdvanceToNextStage}
                            disabled={!experimentDraft || savingExperiment || experimentDraft.stage_sequence.filter(Boolean).length === 0}
                            className="gap-2 rounded-lg"
                        >
                            <ChevronsRight className="w-4 h-4" />
                            推进到下一阶段
                        </Button>
                    </div>
                </div>

                {experimentMessage && (
                    <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                        {experimentMessage}
                    </div>
                )}

                {fetchingExperiment ? (
                    <div className="mt-6 flex items-center gap-3 text-sm text-slate-500">
                        <div className="h-5 w-5 animate-spin rounded-full border-b-2 border-indigo-600"></div>
                        正在读取实验版本...
                    </div>
                ) : experimentDraft ? (
                    <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-2">
                        <div className="space-y-4">
                            <div>
                                <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-500">实验版本名称</label>
                                <input
                                    value={experimentDraft.version_name}
                                    onChange={(e) => handleDraftChange('version_name', e.target.value)}
                                    className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm focus:ring-2 focus:ring-indigo-500"
                                    placeholder="例如：research-v1"
                                />
                            </div>
                            <div>
                                <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-500">组别条件</label>
                                <input
                                    value={experimentDraft.group_condition || ''}
                                    onChange={(e) => handleDraftChange('group_condition', e.target.value || null)}
                                    className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm focus:ring-2 focus:ring-indigo-500"
                                    placeholder="例如：dual-scaffold"
                                />
                            </div>
                            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                                <div>
                                    <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-500">阶段控制方式</label>
                                    <select
                                        value={experimentDraft.stage_control_mode}
                                        onChange={(e) => handleDraftChange('stage_control_mode', e.target.value as ExperimentVersion['stage_control_mode'])}
                                        className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm focus:ring-2 focus:ring-indigo-500"
                                    >
                                        <option value="soft_guidance">软引导</option>
                                        <option value="hard_constraint">硬约束</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-500">协作过程支架</label>
                                    <select
                                        value={experimentDraft.process_scaffold_mode}
                                        onChange={(e) => handleDraftChange('process_scaffold_mode', e.target.value as ExperimentVersion['process_scaffold_mode'])}
                                        className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm focus:ring-2 focus:ring-indigo-500"
                                    >
                                        <option value="on">开启</option>
                                        <option value="off">关闭</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-500">AI支架形态</label>
                                    <select
                                        value={experimentDraft.ai_scaffold_mode}
                                        onChange={(e) => handleDraftChange('ai_scaffold_mode', e.target.value as ExperimentVersion['ai_scaffold_mode'])}
                                        className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm focus:ring-2 focus:ring-indigo-500"
                                    >
                                        <option value="multi_agent">多智能体支架</option>
                                        <option value="single_agent">单AI支架</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-500">阶段广播提示</label>
                                    <select
                                        value={experimentDraft.broadcast_stage_updates ? 'on' : 'off'}
                                        onChange={(e) => handleDraftChange('broadcast_stage_updates', e.target.value === 'on')}
                                        className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm focus:ring-2 focus:ring-indigo-500"
                                    >
                                        <option value="on">开启</option>
                                        <option value="off">关闭</option>
                                    </select>
                                </div>
                            </div>
                            <div>
                                <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-500">阶段序列（逗号分隔）</label>
                                <input
                                    value={stageSequenceInput}
                                    onChange={(e) => {
                                        const nextStages = parseCsvList(e.target.value);
                                        const nextCurrentStage = nextStages.includes(experimentDraft.current_stage || '')
                                            ? experimentDraft.current_stage
                                            : (nextStages[0] || null);
                                        setExperimentDraft({
                                            ...experimentDraft,
                                            stage_sequence: nextStages,
                                            current_stage: nextCurrentStage,
                                        });
                                    }}
                                    className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm focus:ring-2 focus:ring-indigo-500"
                                    placeholder="orientation, planning, inquiry, argumentation, revision"
                                />
                            </div>
                            <div>
                                <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-500">当前阶段</label>
                                <select
                                    value={experimentDraft.current_stage || ''}
                                    onChange={(e) => handleDraftChange('current_stage', e.target.value || null)}
                                    className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm focus:ring-2 focus:ring-indigo-500"
                                >
                                    <option value="">未指定</option>
                                    {experimentDraft.stage_sequence.map((stage) => (
                                        <option key={stage} value={stage}>{stage}</option>
                                    ))}
                                </select>
                            </div>
                        </div>

                        <div className="space-y-4">
                            <div>
                                <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-500">开放支架层（逗号分隔）</label>
                                <input
                                    value={scaffoldLayersInput}
                                    onChange={(e) => handleDraftChange('enabled_scaffold_layers', parseCsvList(e.target.value))}
                                    className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm focus:ring-2 focus:ring-indigo-500"
                                    placeholder="multi_agent_scaffold, process_scaffold"
                                />
                                <div className="mt-2 flex flex-wrap gap-2">
                                    {experimentDraft.enabled_scaffold_layers.length > 0 ? experimentDraft.enabled_scaffold_layers.map((layer) => (
                                        <Badge key={layer} variant="secondary" className="bg-indigo-50 text-indigo-700 border-0">{layer}</Badge>
                                    )) : <span className="text-xs text-slate-400">当前未限制支架层。</span>}
                                </div>
                                <p className="mt-2 text-xs text-slate-400">
                                    高层实验配置优先决定是否开放协作过程支架；此处用于更细粒度的研究型控制。
                                </p>
                            </div>
                            <div>
                                <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-500">开放支架角色（逗号分隔）</label>
                                <input
                                    value={scaffoldRolesInput}
                                    onChange={(e) => handleDraftChange('enabled_scaffold_roles', parseCsvList(e.target.value))}
                                    className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm focus:ring-2 focus:ring-indigo-500"
                                    placeholder="cognitive_support, viewpoint_challenge, feedback_prompting, problem_progression"
                                />
                                <div className="mt-2 flex flex-wrap gap-2">
                                    {experimentDraft.enabled_scaffold_roles.length > 0 ? experimentDraft.enabled_scaffold_roles.map((role) => (
                                        <Badge key={role} variant="secondary" className="bg-violet-50 text-violet-700 border-0">{role}</Badge>
                                    )) : <span className="text-xs text-slate-400">当前未限制支架角色。</span>}
                                </div>
                                <p className="mt-2 text-xs text-slate-400">
                                    当 AI 支架形态为“单AI支架”时，系统默认隐藏 AI 导师页签，仅保留浮动 AI 助手。
                                </p>
                            </div>
                            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                                <div>
                                    <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-500">规则集</label>
                                    <input
                                        list="experiment-rule-set-options"
                                        value={experimentDraft.enabled_rule_set || ''}
                                        onChange={(e) => handleDraftChange('enabled_rule_set', e.target.value || null)}
                                        className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm focus:ring-2 focus:ring-indigo-500"
                                        placeholder="research-default"
                                    />
                                    <datalist id="experiment-rule-set-options">
                                        {RULE_SET_OPTIONS.map((option) => (
                                            <option key={option.value} value={option.value} />
                                        ))}
                                    </datalist>
                                    <div className="mt-2 flex flex-wrap gap-2">
                                        {RULE_SET_OPTIONS.map((option) => (
                                            <button
                                                key={option.value}
                                                type="button"
                                                onClick={() => handleDraftChange('enabled_rule_set', option.value)}
                                                className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                                                    experimentDraft.enabled_rule_set === option.value
                                                        ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                                                        : 'border-slate-200 bg-white text-slate-600 hover:border-indigo-200 hover:bg-indigo-50'
                                                }`}
                                            >
                                                {option.label}
                                            </button>
                                        ))}
                                    </div>
                                    <div className="mt-3 rounded-xl border border-amber-100 bg-amber-50/70 px-3 py-2 text-xs text-amber-800">
                                        <div className="font-semibold">当前启用说明</div>
                                        <div className="mt-1 leading-5">
                                            {RULE_SET_OPTIONS.find((option) => option.value === experimentDraft.enabled_rule_set)?.hint
                                                || '可直接输入规则集名称；如需开启群聊自动短提示，请使用 research-default+group-chat-live。'}
                                        </div>
                                        <div className="mt-1 text-[11px] text-amber-700">
                                            推荐先用 <span className="font-semibold">research-default</span> 进入影子模式观察频率；
                                            需要试点真实群聊提示时，再切到 <span className="font-semibold">research-default+group-chat-live</span>。
                                        </div>
                                    </div>
                                </div>
                                <div>
                                    <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-500">导出配置</label>
                                    <input
                                        value={experimentDraft.export_profile || ''}
                                        onChange={(e) => handleDraftChange('export_profile', e.target.value || null)}
                                        className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm focus:ring-2 focus:ring-indigo-500"
                                        placeholder="group-stage-features"
                                    />
                                </div>
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="mt-6 rounded-xl border border-dashed border-gray-200 px-4 py-8 text-center text-sm text-slate-400">
                        请选择小组后加载实验版本配置。
                    </div>
                )}
            </div>

            <div className="bg-white rounded-2xl border border-emerald-100 shadow-sm p-6">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                        <div className="flex items-center gap-2">
                            <ShieldCheck className="w-5 h-5 text-emerald-600" />
                            <h2 className="text-lg font-bold text-slate-800">研究数据健康检查</h2>
                            {researchHealth && (
                                <Badge
                                    variant="secondary"
                                    className={`border-0 ${researchReadinessPassed ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}
                                >
                                    {researchReadinessPassed ? '可进入实验记录' : '需补关键事件'}
                                </Badge>
                            )}
                        </div>
                        <p className="mt-1 text-sm text-slate-500">
                            用于核查当前小组是否已经稳定记录支架、探究、共享记录与阶段事件，避免正式实验开始后才发现数据链缺口。
                        </p>
                    </div>
                    <div className="flex items-center gap-2">
                        {researchHealth?.last_event_time && (
                            <span className="text-xs text-slate-400">
                                最近事件：{new Date(researchHealth.last_event_time).toLocaleString()}
                            </span>
                        )}
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => selectedProjectId && fetchResearchHealth(selectedProjectId)}
                            disabled={!selectedProjectId || fetchingResearchHealth}
                            className="gap-2 rounded-lg"
                        >
                            <RefreshCcw className={`w-4 h-4 ${fetchingResearchHealth ? 'animate-spin' : ''}`} />
                            {fetchingResearchHealth ? '检查中...' : '刷新健康状态'}
                        </Button>
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleResearchExport('bundle', 'json')}
                            disabled={!selectedProjectId || !!exportingResearch}
                            className="gap-2 rounded-lg"
                        >
                            <Download className="w-4 h-4" />
                            {exportingResearch === 'bundle-json' ? '导出中...' : '导出研究数据包'}
                        </Button>
                    </div>
                </div>

                {fetchingResearchHealth ? (
                    <div className="mt-6 flex items-center gap-3 text-sm text-slate-500">
                        <div className="h-5 w-5 animate-spin rounded-full border-b-2 border-emerald-600"></div>
                        正在检查研究数据记录情况...
                    </div>
                ) : researchHealth ? (
                    <div className="mt-6 space-y-4">
                        <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
                            <div className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
                                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">研究事件总量</div>
                                <div className="mt-2 text-2xl font-bold text-slate-800">{researchHealth.research_event_count}</div>
                            </div>
                            <div className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
                                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">阶段数</div>
                                <div className="mt-2 text-2xl font-bold text-slate-800">{researchHealth.stage_count}</div>
                            </div>
                            <div className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
                                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">实验版本数</div>
                                <div className="mt-2 text-2xl font-bold text-slate-800">{researchHealth.experiment_version_count}</div>
                            </div>
                            <div className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
                                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">规则采纳事件</div>
                                <div className="mt-2 text-2xl font-bold text-slate-800">{researchHealth.key_event_counts.scaffold_rule_recommendation_accept || 0}</div>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                            <div className="rounded-xl border border-slate-100 bg-white px-4 py-4">
                                <div className="text-sm font-semibold text-slate-700">关键事件链覆盖</div>
                                <div className="mt-3 flex flex-wrap gap-2">
                                    {researchHealthChecks.map((item) => (
                                        <Badge
                                            key={item.label}
                                            variant="secondary"
                                            className={`border-0 ${item.passed ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}
                                        >
                                            {item.label} · {item.passed ? '已记录' : '缺失'}
                                        </Badge>
                                    ))}
                                </div>
                            </div>
                            <div className="rounded-xl border border-slate-100 bg-white px-4 py-4">
                                <div className="text-sm font-semibold text-slate-700">事件域分布</div>
                                <div className="mt-3 grid grid-cols-2 gap-2 text-sm text-slate-600">
                                    {Object.entries(researchHealth.event_domain_counts).map(([domain, count]) => (
                                        <div key={domain} className="rounded-lg bg-slate-50 px-3 py-2">
                                            <span className="font-medium text-slate-700">{domain}</span>
                                            <span className="ml-2 text-slate-500">{count}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                        <div className="rounded-xl border border-indigo-100 bg-indigo-50/40 px-4 py-4">
                            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                                <div>
                                    <div className="text-sm font-semibold text-slate-800">研究数据导出</div>
                                    <p className="mt-1 text-xs leading-5 text-slate-500">
                                        用于正式实验留档与第六章过程分析。建议每次课堂结束后至少导出一次研究数据包。
                                    </p>
                                    {researchExportMessage && (
                                        <div className="mt-2 text-xs text-indigo-700">{researchExportMessage}</div>
                                    )}
                                </div>
                                <div className="flex flex-wrap gap-2">
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => handleResearchExport('research-events', 'csv')}
                                        disabled={!selectedProjectId || !!exportingResearch}
                                        className="rounded-lg"
                                    >
                                        原始事件 CSV
                                    </Button>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => handleResearchExport('group-stage-features', 'csv')}
                                        disabled={!selectedProjectId || !!exportingResearch}
                                        className="rounded-lg"
                                    >
                                        组-阶段特征 CSV
                                    </Button>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => handleResearchExport('lsa-ready', 'csv')}
                                        disabled={!selectedProjectId || !!exportingResearch}
                                        className="rounded-lg"
                                    >
                                        LSA/HMM 序列 CSV
                                    </Button>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => handleResearchExport('group-chat-transcripts', 'csv')}
                                        disabled={!selectedProjectId || !!exportingResearch}
                                        className="rounded-lg"
                                    >
                                        小组聊天全文 CSV
                                    </Button>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => handleResearchExport('ai-tutor-transcripts', 'csv')}
                                        disabled={!selectedProjectId || !!exportingResearch}
                                        className="rounded-lg"
                                    >
                                        AI导师对话 CSV
                                    </Button>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => handleResearchExport('bundle', 'json')}
                                        disabled={!selectedProjectId || !!exportingResearch}
                                        className="rounded-lg"
                                    >
                                        完整包 JSON
                                    </Button>
                                </div>
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="mt-6 rounded-xl border border-dashed border-gray-200 px-4 py-8 text-center text-sm text-slate-400">
                        请选择小组后检查研究数据健康状态。
                    </div>
                )}
            </div>

            {activeTab === 'dashboard' ? (
                fetchingAnalytics ? (
                    <div className="flex items-center justify-center h-96 bg-white rounded-2xl border border-gray-100">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
                    </div>
                ) : analyticsData ? (
                    <>
                        {/* Summary Section */}
                        <div className="flex items-center justify-between mb-2">
                            <h2 className="text-lg font-bold text-slate-800">核心指标摘要</h2>
                            <div className="flex gap-2">
                                <Button variant="outline" size="sm" onClick={() => handleExport('csv')} className="gap-2 rounded-lg">
                                    <Download className="w-4 h-4" /> 导出 CSV
                                </Button>
                                <Button variant="outline" size="sm" onClick={() => handleExport('json')} className="gap-2 rounded-lg">
                                    <Download className="w-4 h-4" /> 导出 JSON
                                </Button>
                            </div>
                        </div>

                        {/* Stats Cards */}
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                            {[
                                { label: '综合能力评分', value: `${((Object.values(analyticsData.four_c).reduce((a: any, b: any) => a + b, 0) as number) / 4).toFixed(1)}%`, icon: Target, color: 'blue' },
                                { label: '学习时长累计', value: `${analyticsData.summary.total_active_minutes} min`, icon: Clock, color: 'green' },
                                { label: '活跃度指数', value: analyticsData.summary.total_activity_score.toFixed(0), icon: TrendingUp, color: 'purple' },
                                { label: '团队成员参与', value: `${analyticsData.summary.member_count} 人`, icon: Users, color: 'amber' }
                            ].map((stat, idx) => (
                                <div key={idx} className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm hover:shadow-md transition-shadow">
                                    <div className={`w-12 h-12 bg-${stat.color}-50 rounded-xl flex items-center justify-center mb-4`}>
                                        <stat.icon className={`w-6 h-6 text-${stat.color}-600`} />
                                    </div>
                                    <p className="text-3xl font-bold text-slate-800">{stat.value}</p>
                                    <p className="text-sm text-slate-500 mt-1">{stat.label}</p>
                                </div>
                            ))}
                        </div>

                        {/* Charts Area */}
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
                            <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm">
                                <div className="flex items-center justify-between mb-6">
                                    <h3 className="font-bold text-slate-800">4C 能力雷达/分布</h3>
                                    <Badge variant="secondary" className="bg-indigo-50 text-indigo-600 border-0">能力基准</Badge>
                                </div>
                                <ResponsiveContainer width="100%" height={260}>
                                    <BarChart data={fourCData}>
                                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                                        <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 12 }} dy={10} />
                                        <YAxis axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 12 }} />
                                        <Tooltip cursor={{ fill: '#f8fafc' }} contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }} />
                                        <Bar dataKey="value" radius={[6, 6, 0, 0]} barSize={40}>
                                            {fourCData.map((e, i) => <Cell key={i} fill={e.color} />)}
                                        </Bar>
                                    </BarChart>
                                </ResponsiveContainer>
                            </div>

                            <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm">
                                <div className="flex items-center justify-between mb-6">
                                    <h3 className="font-bold text-slate-800">团队活跃趋势</h3>
                                    <Badge variant="secondary" className="bg-green-50 text-green-600 border-0">实时更新</Badge>
                                </div>
                                <ResponsiveContainer width="100%" height={260}>
                                    <AreaChart data={activityTrend}>
                                        <defs>
                                            <linearGradient id="trendGradient" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="5%" stopColor="#6366f1" stopOpacity={0.1} />
                                                <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                                            </linearGradient>
                                        </defs>
                                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                                        <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 10 }} dy={10} />
                                        <YAxis axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 12 }} />
                                        <Tooltip contentStyle={{ borderRadius: '12px', border: 'none' }} />
                                        <Area type="monotone" dataKey="score" stroke="#6366f1" strokeWidth={3} fill="url(#trendGradient)" dot={{ r: 4, fill: '#6366f1' }} activeDot={{ r: 6 }} />
                                    </AreaChart>
                                </ResponsiveContainer>
                            </div>
                        </div>

                        {/* AI Insights */}
                        <div className="bg-white p-8 rounded-2xl border border-indigo-100 mt-6 shadow-sm">
                            <h3 className="text-lg font-bold text-slate-800 mb-6 flex items-center gap-2">
                                <Brain className="w-5 h-5 text-indigo-600" />
                                学习行为分析建议
                            </h3>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                {analyticsData.learning_suggestions.map((s: any) => (
                                    <div key={s.id} className="p-5 rounded-xl border border-slate-100 bg-slate-50/50 hover:bg-white transition-colors border-l-4 border-l-indigo-500">
                                        <div className="flex items-center gap-2 mb-2">
                                            <Badge variant="outline" className={s.type === 'critical' ? 'bg-red-50 text-red-600 border-red-100' : 'bg-blue-50 text-blue-600 border-blue-100'}>
                                                {s.type === 'critical' ? '紧急干预' : '教学建议'}
                                            </Badge>
                                            <h4 className="font-bold text-slate-800">{s.title}</h4>
                                        </div>
                                        <p className="text-sm text-slate-600 leading-relaxed">{s.content}</p>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </>
                ) : (
                    <div className="p-20 text-center bg-white rounded-2xl border border-dashed border-gray-200">
                        <p className="text-slate-400">选择一个小组开始分析</p>
                    </div>
                )
            ) : (
                <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden shadow-sm">
                    <div className="p-6 border-b border-gray-100 flex items-center justify-between">
                        <h2 className="font-bold text-slate-800">详细行为流记录</h2>
                        <span className="text-xs text-slate-400">实时捕捉小组成员的每一项关键操作</span>
                    </div>
                    {fetchingLogs ? (
                        <div className="p-20 flex justify-center"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div></div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full">
                                <thead className="bg-slate-50/50">
                                    <tr>
                                        <th className="px-6 py-4 text-left text-xs font-bold text-slate-500 uppercase tracking-widest">用户</th>
                                        <th className="px-6 py-4 text-left text-xs font-bold text-slate-500 uppercase tracking-widest">操作时间</th>
                                        <th className="px-6 py-4 text-left text-xs font-bold text-slate-500 uppercase tracking-widest">操作内容</th>
                                        <th className="px-6 py-4 text-left text-xs font-bold text-slate-500 uppercase tracking-widest">所属模块</th>
                                        <th className="px-6 py-4 text-left text-xs font-bold text-slate-500 uppercase tracking-widest">持续时长</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100 text-sm">
                                    {behaviorLogs.length > 0 ? behaviorLogs.map((log, i) => (
                                        <tr key={i} className="hover:bg-slate-50/50 transition-colors">
                                            <td className="px-6 py-4 font-medium text-indigo-600">User_{log.user_id.slice(-4)}</td>
                                            <td className="px-6 py-4 text-slate-500 font-mono text-xs">{new Date(log.timestamp).toLocaleString()}</td>
                                            <td className="px-6 py-4">
                                                <Badge variant="secondary" className="rounded-md font-medium px-2 py-0.5">{log.action}</Badge>
                                            </td>
                                            <td className="px-6 py-4 text-slate-600">{log.module} <span className="text-slate-300 mx-1">/</span> {log.resource_id ? <span className="text-xs opacity-70 italic">{log.resource_id.slice(-8)}</span> : '-'}</td>
                                            <td className="px-6 py-4">
                                                {log.duration ? (
                                                    <div className="flex items-center gap-1.5 text-slate-500 font-medium">
                                                        <Clock className="w-3.5 h-3.5" />
                                                        {log.duration}s
                                                    </div>
                                                ) : '-'}
                                            </td>
                                        </tr>
                                    )) : (
                                        <tr><td colSpan={5} className="px-6 py-24 text-center text-slate-400 font-medium">暂无行为轨迹数据</td></tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
