import { memo, useCallback } from 'react';
import { EdgeProps, getBezierPath, EdgeLabelRenderer, BaseEdge } from 'reactflow';
import { cn } from '../../../lib/utils';
import { useInquiryActions } from './InquiryContext';
import { X } from 'lucide-react';

export const ArgumentEdge = memo(({
    id,
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    style = {},
    markerEnd,
    data,
    selected
}: EdgeProps) => {
    const [edgePath, labelX, labelY] = getBezierPath({
        sourceX,
        sourceY,
        sourcePosition,
        targetPosition,
        targetX,
        targetY,
    });

    const { updateEdge, deleteEdge, trackInquiryResearchEvent } = useInquiryActions();
    const isRefutation = data?.label === 'refutes';

    const toggleType = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        const nextLabel = isRefutation ? 'supports' : 'refutes';
        trackInquiryResearchEvent('edge_relation_toggle', {
            edge_id: id,
            from_relation: data?.label || 'supports',
            to_relation: nextLabel,
            source_id: (data as any)?.sourceId,
            target_id: (data as any)?.targetId,
        });
        updateEdge(id, {
            data: { ...data, label: nextLabel }
        });
    }, [id, isRefutation, updateEdge, data, trackInquiryResearchEvent]);

    const handleDelete = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        trackInquiryResearchEvent('edge_delete', {
            edge_id: id,
            relation: data?.label || 'supports',
            source_id: (data as any)?.sourceId,
            target_id: (data as any)?.targetId,
        });
        deleteEdge(id);
    }, [id, deleteEdge, data, trackInquiryResearchEvent]);

    const edgeStyle = {
        ...style,
        strokeWidth: selected ? 4 : 3,
        stroke: isRefutation ? '#fb7185' : '#34d399',
        strokeDasharray: isRefutation ? '5,5' : 'none',
        transition: 'all 0.3s ease',
        opacity: selected ? 1 : 0.8,
    };

    return (
        <>
            <BaseEdge path={edgePath} markerEnd={markerEnd} style={edgeStyle} />
            <EdgeLabelRenderer>
                <div
                    style={{
                        position: 'absolute',
                        transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
                        pointerEvents: 'all',
                    }}
                    className="flex items-center gap-1 group"
                >
                    <div
                        className={cn(
                            "px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-tighter shadow-sm border cursor-pointer hover:scale-105 active:scale-95 transition-all select-none",
                            isRefutation
                                ? "bg-rose-50 text-rose-600 border-rose-200 hover:bg-rose-100"
                                : "bg-emerald-50 text-emerald-600 border-emerald-200 hover:bg-emerald-100"
                        )}
                        onClick={toggleType}
                        title="点击切换 支持/反驳"
                    >
                        {isRefutation ? '反驳' : '支持'}
                    </div>

                    <button
                        onClick={handleDelete}
                        className="opacity-0 group-hover:opacity-100 w-5 h-5 bg-white border border-slate-200 rounded-full flex items-center justify-center text-slate-400 hover:text-red-500 hover:border-red-200 hover:bg-red-50 transition-all shadow-sm"
                        title="删除连线"
                    >
                        <X className="w-3 h-3" />
                    </button>
                </div>
            </EdgeLabelRenderer>
        </>
    );
});
