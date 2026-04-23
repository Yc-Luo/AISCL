import React, { memo, useCallback } from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import { InquiryNodeData } from '../types';
import { MessageSquare, ShieldCheck, ShieldAlert, Reply, Link as LinkIcon } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { useInquiryActions } from './InquiryContext';

interface BaseNodeProps {
    nodeId: string;
    nodeType: string;
    children: React.ReactNode;
    title: string;
    icon: any;
    colorClass: string;
    selected?: boolean;
    sourceUrl?: string;
    sourceTitle?: string;
    imageUrl?: string;
}

const BaseNode = ({
    nodeId,
    nodeType,
    children,
    title,
    icon: Icon,
    colorClass,
    selected,
    sourceUrl,
    sourceTitle,
    imageUrl
}: BaseNodeProps) => {
    const { trackInquiryResearchEvent } = useInquiryActions();

    const handleSourceOpen = useCallback((e: React.MouseEvent<HTMLAnchorElement>) => {
        e.stopPropagation();
        trackInquiryResearchEvent('evidence_source_open', {
            node_id: nodeId,
            node_type: nodeType,
            source_title: sourceTitle || null,
            source_url_host: sourceUrl ? new URL(sourceUrl, window.location.origin).host : null,
            has_image: Boolean(imageUrl),
        });
    }, [imageUrl, nodeId, nodeType, sourceTitle, sourceUrl, trackInquiryResearchEvent]);

    return (
    <div className={cn(
        "px-4 py-3 rounded-xl border-2 bg-white/90 backdrop-blur-md shadow-lg transition-all min-w-[240px] max-w-[340px] group relative",
        colorClass,
        selected ? "ring-2 ring-offset-4 ring-indigo-500 scale-[1.02] shadow-xl" : "border-slate-200"
    )}>
        {/* 全向连接点 */}
        <Handle type="target" position={Position.Top} id="t-t" style={{ left: '30%' }} className="w-2.5 h-2.5 bg-slate-300 border-2 border-white hover:scale-150 transition-transform" />
        <Handle type="source" position={Position.Top} id="t-s" style={{ left: '70%' }} className="w-2.5 h-2.5 bg-slate-400 border-2 border-white hover:scale-150 transition-transform" />

        <Handle type="target" position={Position.Bottom} id="b-t" style={{ left: '70%' }} className="w-2.5 h-2.5 bg-slate-300 border-2 border-white hover:scale-150 transition-transform" />
        <Handle type="source" position={Position.Bottom} id="b-s" style={{ left: '30%' }} className="w-2.5 h-2.5 bg-slate-400 border-2 border-white hover:scale-150 transition-transform" />

        <Handle type="target" position={Position.Left} id="l-t" style={{ top: '30%' }} className="w-2.5 h-2.5 bg-slate-300 border-2 border-white hover:scale-150 transition-transform" />
        <Handle type="source" position={Position.Left} id="l-s" style={{ top: '70%' }} className="w-2.5 h-2.5 bg-slate-400 border-2 border-white hover:scale-150 transition-transform" />

        <Handle type="target" position={Position.Right} id="r-t" style={{ top: '70%' }} className="w-2.5 h-2.5 bg-slate-300 border-2 border-white hover:scale-150 transition-transform" />
        <Handle type="source" position={Position.Right} id="r-s" style={{ top: '30%' }} className="w-2.5 h-2.5 bg-slate-400 border-2 border-white hover:scale-150 transition-transform" />

        <div className="flex items-center justify-between mb-2 pb-2 border-b border-slate-100">
            <div className="flex items-center gap-2">
                <div className={cn("p-1.5 rounded-lg shadow-sm font-bold", colorClass.replace('border-', 'bg-').split(' ')[0] + '/20')}>
                    <Icon className={cn("w-4 h-4", colorClass.replace('border-', 'text-').split(' ')[0])} />
                </div>
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">{title}</span>
            </div>
            {selected && <div className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse" />}
        </div>

        <div className="text-sm text-slate-700 leading-relaxed break-words font-medium mb-2">
            {imageUrl ? (
                <div className="rounded-lg overflow-hidden border border-slate-100 bg-slate-50 mb-2">
                    <img src={imageUrl} alt="素材图片" className="w-full h-auto object-contain max-h-[300px]" />
                </div>
            ) : null}
            {children}
        </div>

        {sourceUrl && (
            <a
                href={sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 pt-2 border-t border-slate-50 flex items-center gap-1.5 text-[10px] text-blue-500 hover:text-blue-600 transition-colors group/link"
                onClick={handleSourceOpen}
            >
                <LinkIcon className="w-3" />
                <span className="truncate max-w-[200px]">{sourceTitle || '查看素材来源'}</span>
            </a>
        )}
    </div>
    );
};

export const ClaimNode = memo(({ id, data, selected }: NodeProps<InquiryNodeData>) => (
    <BaseNode
        nodeId={id}
        nodeType="claim"
        title="核心主张" icon={MessageSquare} colorClass="border-blue-400 bg-blue-50/50" selected={selected}
        sourceUrl={data.sourceUrl} sourceTitle={data.sourceTitle} imageUrl={data.imageUrl}
    >
        {data.content || data.label}
    </BaseNode>
));

export const EvidenceNode = memo(({ id, data, selected }: NodeProps<InquiryNodeData>) => (
    <BaseNode
        nodeId={id}
        nodeType="evidence"
        title="有力证据" icon={ShieldCheck} colorClass="border-emerald-400 bg-emerald-50/50" selected={selected}
        sourceUrl={data.sourceUrl} sourceTitle={data.sourceTitle} imageUrl={data.imageUrl}
    >
        {data.content || data.label}
    </BaseNode>
));

export const CounterNode = memo(({ id, data, selected }: NodeProps<InquiryNodeData>) => (
    <BaseNode
        nodeId={id}
        nodeType="counter-argument"
        title="相反观点" icon={ShieldAlert} colorClass="border-rose-400 bg-rose-50/50" selected={selected}
        sourceUrl={data.sourceUrl} sourceTitle={data.sourceTitle} imageUrl={data.imageUrl}
    >
        {data.content || data.label}
    </BaseNode>
));

export const RebuttalNode = memo(({ id, data, selected }: NodeProps<InquiryNodeData>) => (
    <BaseNode
        nodeId={id}
        nodeType="rebuttal"
        title="有力回击" icon={Reply} colorClass="border-amber-400 bg-amber-50/50" selected={selected}
        sourceUrl={data.sourceUrl} sourceTitle={data.sourceTitle} imageUrl={data.imageUrl}
    >
        {data.content || data.label}
    </BaseNode>
));
