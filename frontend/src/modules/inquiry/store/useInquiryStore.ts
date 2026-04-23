/**
 * Inquiry Store - Y.js 状态的只读镜像
 * 
 * 设计原则：
 * 1. 此 Store 是 Y.js 共享状态的只读缓存
 * 2. 只有 useInquirySync 可以写入此 Store
 * 3. UI 组件只能读取，不能直接修改
 */
import { create } from 'zustand';
import { Node, Edge } from 'reactflow';
import { InquiryCard, InquiryNodeData, InquiryEdgeData } from '../types';

interface InquiryStore {
    // 状态（只读镜像）
    nodes: Node<InquiryNodeData>[];
    edges: Edge<InquiryEdgeData>[];
    scrapbook: InquiryCard[];
    projectId: string | null;

    // 批量更新（仅供 sync hook 调用）
    setFullState: (
        nodes: Node<InquiryNodeData>[],
        edges: Edge<InquiryEdgeData>[],
        scrapbook: InquiryCard[],
        projectId?: string
    ) => void;

    // 清空（用于项目切换）
    clearAll: () => void;
}

export const useInquiryStore = create<InquiryStore>((set) => ({
    nodes: [],
    edges: [],
    scrapbook: [],
    projectId: null,

    setFullState: (nodes, edges, scrapbook, projectId) => {
        console.log('[InquiryStore] setFullState called:', {
            nodesCount: nodes.length,
            edgesCount: edges.length,
            projectId
        });
        set((state) => ({
            nodes,
            edges,
            scrapbook,
            projectId: projectId !== undefined ? projectId : state.projectId
        }));
    },

    clearAll: () => {
        set({ nodes: [], edges: [], scrapbook: [], projectId: null });
    }
}));
