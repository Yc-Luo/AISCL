import React, { useState, useCallback, useRef } from 'react';
import ReactFlow, {
    Background,
    Controls,
    MiniMap,
    ReactFlowProvider,
    NodeChange,
    Connection
} from 'reactflow';
import 'reactflow/dist/style.css';

import { useInquiryStore } from '../store/useInquiryStore';
import { ScrapbookSidebar } from './ScrapbookSidebar';
import { InquiryToolbar } from './InquiryToolbar';
import { NodeInspector } from './NodeInspector';
import {
    ClaimNode,
    EvidenceNode,
    CounterNode,
    RebuttalNode
} from './ArgumentNodes';
import { ArgumentEdge } from './ArgumentEdge';
import { aiService } from '../../../services/api/ai';
import { InquiryProvider, useInquiryActions } from './InquiryContext';
import { storageService } from '../../../services/api/storage';
import { Toast } from '../../../components/ui/Toast';
import { useBehaviorTracking } from '../../../hooks/common/useBehaviorTracking';
import { trackingService } from '../../../services/tracking/TrackingService';
import { ExperimentVersion } from '../../../types';
import { isAssistantActionEnabled } from '../../../lib/experimentScaffold';

interface InquirySpaceProps {
    projectId: string;
    experimentVersion?: ExperimentVersion | null;
}

const nodeTypes = {
    claim: ClaimNode,
    evidence: EvidenceNode,
    'counter-argument': CounterNode,
    rebuttal: RebuttalNode,
};

const edgeTypes = {
    argument: ArgumentEdge,
};

const InquirySpaceInner: React.FC<InquirySpaceProps> = ({ projectId, experimentVersion }) => {
    const reactFlowWrapper = useRef<HTMLDivElement>(null);
    const [reactFlowInstance, setReactFlowInstance] = useState<any>(null);
    const [analyzingType, setAnalyzingType] = useState<'devil_advocate' | 'clustering' | null>(null);
    const [isSaving, setIsSaving] = useState(false);
    const [toast, setToast] = useState<{ message: string; visible: boolean }>({ message: '', visible: false });

    // Track behavior
    const { trackBehavior } = useBehaviorTracking(projectId, 'inquiry');
    const [viewMode, setViewMode] = useState<'scrapbook' | 'argumentation'>('argumentation');

    // Use individual selectors to ensure proper re-renders
    const nodes = useInquiryStore((state) => state.nodes);
    const edges = useInquiryStore((state) => state.edges);
    const scrapbook = useInquiryStore((state) => state.scrapbook);

    // Debug: Log when nodes change
    console.log('[InquirySpace] Rendering with nodes:', nodes.length, 'firstNodePos:', nodes[0]?.position);

    const {
        onNodesChange,
        onEdgesChange,
        onConnect,
        addCard,
        convertCardToNode,
        saveToBackend,
        isConnected,
        isHydrated,
        trackInquiryResearchEvent
    } = useInquiryActions();
    const experimentVersionId = experimentVersion?.version_name || undefined;
    const devilAdvocateEnabled = isAssistantActionEnabled(experimentVersion, 'viewpoint_challenge');
    const clusteringEnabled = isAssistantActionEnabled(experimentVersion, 'cognitive_support');

    const handleAIAnalysis = useCallback(async () => {
        if (!devilAdvocateEnabled) {
            setToast({ message: "当前实验配置未启用观点挑战角色", visible: true });
            return;
        }
        if (nodes.length === 0) {
            setToast({ message: "画布上还没有任何论证内容", visible: true });
            return;
        }

        setAnalyzingType('devil_advocate');
        trackBehavior('ai', 'devil_advocate_start');
        trackingService.trackResearchEvent({
            project_id: projectId,
            experiment_version_id: experimentVersionId,
            actor_type: 'student',
            event_domain: 'scaffold',
            event_type: 'scaffold_request',
            payload: {
                scaffold_layer: 'multi_agent_scaffold',
                scaffold_role: 'viewpoint_challenge',
                trigger_source: 'manual_call',
                trigger_reason: 'devil_advocate',
                node_count: nodes.length,
                edge_count: edges.length,
            }
        });
        try {
            const argumentSummary = nodes.map(n =>
                `[${n.type}] ${n.data.content || n.data.label}`
            ).join('\n');

            const relations = edges.map(e => {
                const source = nodes.find(n => n.id === e.source);
                const target = nodes.find(n => n.id === e.target);
                return `${source?.data.label} -> ${e.data?.label === 'refutes' ? '反驳' : '支持'} -> ${target?.data.label}`;
            }).join('\n');

            const prompt = `目前的论证结构如下：\n内容：\n${argumentSummary}\n关系：\n${relations}\n\n请作为"恶魔代言人"，分析逻辑漏洞并给出 2-3 个对立观点。`;

            const response = await aiService.performAction({
                project_id: projectId,
                action_type: 'devil_advocate',
                context_type: 'whiteboard',
                content: prompt
            });

            if (response?.message) {
                addCard(response.message, 'ai_response');
                setToast({ message: "AI 分析完成，建议已加入灵感墙", visible: true });
                trackBehavior('ai', 'devil_advocate_success');
                trackingService.trackResearchEvent({
                    project_id: projectId,
                    experiment_version_id: experimentVersionId,
                    actor_type: 'ai_assistant',
                    event_domain: 'scaffold',
                    event_type: 'assistant_scaffold_response',
                    payload: {
                        scaffold_layer: 'multi_agent_scaffold',
                        scaffold_role: 'viewpoint_challenge',
                        trigger_source: 'manual_call',
                        trigger_reason: 'devil_advocate',
                        response_mode: 'challenge',
                    }
                });
                setViewMode('scrapbook');
            }
        } catch (e) {
            setToast({ message: "AI 分析失败", visible: true });
        } finally {
            setAnalyzingType(null);
        }
    }, [nodes, edges, projectId, addCard, experimentVersionId, trackBehavior, devilAdvocateEnabled]);

    const handleClustering = useCallback(async () => {
        if (!clusteringEnabled) {
            setToast({ message: "当前实验配置未启用认知支持角色", visible: true });
            return;
        }
        if (nodes.length < 2) {
            setToast({ message: "节点数量较少，请添加更多内容后再进行聚类分析", visible: true });
            return;
        }

        setAnalyzingType('clustering');
        trackBehavior('ai', 'clustering_start');
        trackingService.trackResearchEvent({
            project_id: projectId,
            experiment_version_id: experimentVersionId,
            actor_type: 'student',
            event_domain: 'scaffold',
            event_type: 'scaffold_request',
            payload: {
                scaffold_layer: 'multi_agent_scaffold',
                scaffold_role: 'cognitive_support',
                trigger_source: 'manual_call',
                trigger_reason: 'inquiry_clustering',
                node_count: nodes.length,
            }
        });
        try {
            const content = nodes.map(n => n.data.content || '').filter(Boolean).join('\n--- \n');
            const response = await aiService.performAction({
                project_id: projectId,
                action_type: 'inquiry_clustering',
                context_type: 'whiteboard',
                content: content
            });

            if (response?.message) {
                addCard(response.message, 'ai_response');
                setToast({ message: "智能聚类分析完成，已生成逻辑模块卡片", visible: true });
                trackBehavior('ai', 'clustering_success');
                trackingService.trackResearchEvent({
                    project_id: projectId,
                    experiment_version_id: experimentVersionId,
                    actor_type: 'ai_assistant',
                    event_domain: 'scaffold',
                    event_type: 'assistant_scaffold_response',
                    payload: {
                        scaffold_layer: 'multi_agent_scaffold',
                        scaffold_role: 'cognitive_support',
                        trigger_source: 'manual_call',
                        trigger_reason: 'inquiry_clustering',
                        response_mode: 'summary',
                    }
                });
                setViewMode('scrapbook');
            }
        } catch (e) {
            setToast({ message: "聚类分析失败", visible: true });
        } finally {
            setAnalyzingType(null);
        }
    }, [nodes, projectId, addCard, experimentVersionId, trackBehavior, clusteringEnabled]);

    const handleNodesChange = useCallback((changes: NodeChange[]) => {
        onNodesChange(changes);

        changes.forEach((change) => {
            if (change.type === 'add') {
                trackInquiryResearchEvent('node_add', {
                    node_id: change.item.id,
                    node_type: change.item.type || 'unknown',
                    view_mode: viewMode,
                });
            } else if (change.type === 'remove') {
                trackInquiryResearchEvent('node_remove', {
                    node_id: change.id,
                    view_mode: viewMode,
                });
            } else if (change.type === 'position' && !('dragging' in change && change.dragging)) {
                trackInquiryResearchEvent('node_position_commit', {
                    node_id: change.id,
                    view_mode: viewMode,
                });
            }
        });
    }, [onNodesChange, trackInquiryResearchEvent]);

    const handleConnect = useCallback((params: Connection) => {
        onConnect(params);
        trackInquiryResearchEvent('edge_add', {
            source_id: params.source,
            target_id: params.target,
            source_handle: params.sourceHandle,
            target_handle: params.targetHandle,
            view_mode: viewMode,
        });
    }, [onConnect, trackInquiryResearchEvent]);

    const onDragOver = useCallback((event: React.DragEvent) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
    }, []);

    const onDrop = useCallback(
        (event: React.DragEvent) => {
            event.preventDefault();
            const cardId = event.dataTransfer.getData('application/reactflow');
            if (!cardId) return;

            if (reactFlowWrapper.current && reactFlowInstance) {
                const reactFlowBounds = reactFlowWrapper.current.getBoundingClientRect();
                const position = reactFlowInstance.project({
                    x: event.clientX - reactFlowBounds.left,
                    y: event.clientY - reactFlowBounds.top,
                });
                const card = scrapbook.find((item) => item.id === cardId);

                convertCardToNode(cardId, position, 'evidence');
                trackBehavior('node', 'canvas_drop', cardId);
                trackInquiryResearchEvent('card_to_node', {
                    card_id: cardId,
                    node_type: 'evidence',
                    x: Math.round(position.x),
                    y: Math.round(position.y),
                    view_mode: viewMode,
                });
                if (card?.sourceUrl || card?.sourceTitle) {
                    trackInquiryResearchEvent('evidence_source_bind', {
                        card_id: cardId,
                        source_ref: card?.id || null,
                        source_title: card?.sourceTitle || null,
                        source_url_host: card?.sourceUrl ? new URL(card.sourceUrl, window.location.origin).host : null,
                        node_type: 'evidence',
                        has_image: Boolean(card?.imageUrl),
                        view_mode: viewMode,
                    });
                }
            }
        },
        [reactFlowInstance, convertCardToNode, scrapbook, trackBehavior, trackInquiryResearchEvent, viewMode]
    );

    const onPaste = useCallback(async (event: React.ClipboardEvent) => {
        const items = event.clipboardData?.items;
        if (!items) return;

        for (const item of items) {
            if (item.type.indexOf('image') !== -1) {
                const file = item.getAsFile();
                if (!file) continue;

                setToast({ message: '正在上传图片...', visible: true });
                try {
                    // 1. Get presigned URL
                    const filename = `paste-${Date.now()}-${file.name || 'image.png'}`;
                    const presigned = await storageService.getPresignedUploadUrl(
                        projectId,
                        filename,
                        file.type,
                        file.size
                    );

                    // 2. Upload to MinIO/S3
                    await storageService.uploadFile(presigned.upload_url, file);

                    // 3. Create resource record in DB
                    const resource = await storageService.createResource({
                        file_key: presigned.file_key,
                        filename: filename,
                        size: file.size,
                        project_id: projectId,
                        mime_type: file.type,
                        source_type: 'inquiry_material',
                    });

                    // 4. Add to scrapbook (The resource URL is needed here, assuming storage handles standard paths or we have an endpoint)
                    const imageUrl = storageService.getResourceViewUrl(resource.id);

                    addCard('[粘贴的图片]', 'image', undefined, '剪贴板导入', imageUrl);
                    setToast({ message: '图片已存入灵感池', visible: true });
                    trackBehavior('resource', 'paste_image', resource.id);
                    trackInquiryResearchEvent('scrapbook_image_add', {
                        resource_id: resource.id,
                        source: 'clipboard',
                        view_mode: viewMode,
                    });
                } catch (error) {
                    console.error('Failed to upload pasted image:', error);
                    setToast({ message: '图片上传失败', visible: true });
                }
                break; // Only process one image per paste
            }
        }
    }, [projectId, addCard, trackBehavior, trackInquiryResearchEvent]);

    const handleSave = useCallback(async () => {
        setIsSaving(true);
        try {
            await saveToBackend();
            setToast({ message: '深度探究进度已同步至云端', visible: true });
            trackBehavior('persistence', 'save_success');
            trackInquiryResearchEvent('snapshot_save', {
                node_count: nodes.length,
                edge_count: edges.length,
                view_mode: viewMode,
            });
        } catch (error) {
            setToast({ message: '保存失败，请检查网络连接', visible: true });
            trackBehavior('persistence', 'save_error');
        } finally {
            setIsSaving(false);
        }
    }, [saveToBackend, trackBehavior, trackInquiryResearchEvent, nodes.length, edges.length]);

    // Loading state - MUST be after all hooks
    if (!isHydrated) {
        return (
            <div className="flex items-center justify-center h-full bg-slate-50">
                <div className="flex flex-col items-center gap-4">
                    <div className="w-10 h-10 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
                    <p className="text-slate-500 font-medium">正在同步协作空间...</p>
                </div>
            </div>
        );
    }

    return (
        <div
            className="flex flex-1 min-h-0 min-w-0 overflow-hidden bg-white rounded-lg shadow-inner outline-none"
            onPaste={onPaste}
            tabIndex={0}
        >
            <ScrapbookSidebar isVisible={viewMode === 'scrapbook'} />

            <div className="relative flex-1 flex flex-col min-h-0" ref={reactFlowWrapper}>
                <InquiryToolbar
                    viewMode={viewMode}
                    setViewMode={(mode) => {
                        setViewMode(mode);
                        trackBehavior('view', `switch_${mode}`);
                        trackInquiryResearchEvent('view_mode_switch', {
                            from: viewMode,
                            to: mode,
                            view_mode: mode,
                        });
                    }}
                    onAIAnalysis={handleAIAnalysis}
                    onClustering={handleClustering}
                    aiAnalysisEnabled={devilAdvocateEnabled}
                    clusteringEnabled={clusteringEnabled}
                    aiAnalysisDisabledReason="当前实验配置未启用观点挑战角色。"
                    clusteringDisabledReason="当前实验配置未启用认知支持角色。"
                    analyzingType={analyzingType}
                    onSave={handleSave}
                    isSaving={isSaving}
                    isConnected={isConnected}
                />
                <NodeInspector />

                <ReactFlow
                    nodes={nodes}
                    edges={edges}
                    onNodesChange={handleNodesChange}
                    onEdgesChange={onEdgesChange}
                    onConnect={handleConnect}
                    onInit={setReactFlowInstance}
                    onDrop={onDrop}
                    onDragOver={onDragOver}
                    nodeTypes={nodeTypes}
                    edgeTypes={edgeTypes}
                    defaultEdgeOptions={{ type: 'argument' }}
                    proOptions={{ hideAttribution: true }}
                    fitView
                    className="bg-slate-50"
                    style={{ width: '100%', height: '100%' }}
                >
                    <Background color="#cbd5e1" gap={20} />
                    <Controls />
                    <MiniMap />
                </ReactFlow>
            </div>
            {toast.visible && (
                <Toast message={toast.message} onClose={() => setToast(prev => ({ ...prev, visible: false }))} />
            )}
        </div>
    );
};

export const InquirySpace: React.FC<InquirySpaceProps> = (props) => (
    <InquiryProvider projectId={props.projectId} experimentVersion={props.experimentVersion}>
        <ReactFlowProvider>
            <InquirySpaceInner {...props} />
        </ReactFlowProvider>
    </InquiryProvider>
);
