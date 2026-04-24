import React, { useEffect, useRef, useState } from 'react';
import { useInquiryStore } from '../store/useInquiryStore';
import { useInquiryActions } from './InquiryContext';
import { Button } from '../../../components/ui/button';
import { wikiService, WikiItemType } from '../../../services/api/wiki';
import {
    BookOpen,
    Trash2,
    MessageSquare,
    ShieldCheck,
    ShieldAlert,
    Reply,
    X
} from 'lucide-react';

interface NodeInspectorProps { }

export const NodeInspector: React.FC<NodeInspectorProps> = () => {
    const { nodes } = useInquiryStore();
    const { updateNode, deleteNode, trackInquiryResearchEvent, projectId } = useInquiryActions();
    const [isAddingToWiki, setIsAddingToWiki] = useState(false);

    const selectedNode = nodes.find(n => n.selected);
    const lastNodeIdRef = useRef<string | null>(null);
    const editStartContentRef = useRef('');

    useEffect(() => {
        if (!selectedNode) return;
        if (lastNodeIdRef.current !== selectedNode.id) {
            lastNodeIdRef.current = selectedNode.id;
            editStartContentRef.current = selectedNode.data.content || '';
        }
    }, [selectedNode]);

    if (!selectedNode) return null;

    const nodeTypes = [
        { type: 'claim', label: '核心主张', icon: MessageSquare, color: 'text-blue-500' },
        { type: 'evidence', label: '有力证据', icon: ShieldCheck, color: 'text-emerald-500' },
        { type: 'counter-argument', label: '相反观点', icon: ShieldAlert, color: 'text-rose-500' },
        { type: 'rebuttal', label: '有力回击', icon: Reply, color: 'text-amber-500' },
    ];

    const mapNodeTypeToWikiType = (nodeType: string): WikiItemType => {
        if (nodeType === 'evidence') return 'evidence';
        if (nodeType === 'counter-argument' || nodeType === 'rebuttal') return 'controversy';
        if (nodeType === 'claim') return 'claim';
        return 'note';
    };

    const handleAddNodeToWiki = async () => {
        const content = selectedNode.data.content || '';
        if (!content.trim()) return;

        setIsAddingToWiki(true);
        try {
            await wikiService.createItem({
                project_id: projectId,
                item_type: mapNodeTypeToWikiType(selectedNode.type || 'note'),
                title: `探究节点：${content.slice(0, 24)}`,
                content,
                summary: content.slice(0, 300),
                source_type: 'inquiry',
                source_id: selectedNode.id,
                confidence_level: 'working',
            });
            trackInquiryResearchEvent('wiki_item_quoted', {
                node_id: selectedNode.id,
                node_type: selectedNode.type,
                content_length: content.length,
                source_type: 'inquiry_node',
            }, { eventDomain: 'wiki' });
        } finally {
            setIsAddingToWiki(false);
        }
    };

    return (
        <div className="absolute right-4 top-24 z-20 w-72 bg-white/90 backdrop-blur-md rounded-2xl shadow-2xl border border-slate-200 overflow-hidden animate-in slide-in-from-right-4">
            <div className="p-4 bg-slate-50 border-b flex justify-between items-center">
                <h3 className="text-sm font-bold text-slate-700">编辑节点</h3>
                <Button variant="ghost" size="icon" className="h-6 w-6 rounded-full" onClick={() => updateNode(selectedNode.id, { selected: false })}>
                    <X className="w-4 h-4" />
                </Button>
            </div>

            <div className="p-4 space-y-4">
                {/* 类型选择 */}
                <div className="space-y-2">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">节点类型</label>
                    <div className="grid grid-cols-2 gap-2">
                        {nodeTypes.map((item) => (
                            <Button
                                key={item.type}
                                variant={selectedNode.type === item.type ? 'default' : 'outline'}
                                size="sm"
                                className="h-9 px-2 flex justify-start gap-2"
                                onClick={() => {
                                    if (selectedNode.type === item.type) return;

                                    trackInquiryResearchEvent('node_type_update', {
                                        node_id: selectedNode.id,
                                        from_type: selectedNode.type,
                                        to_type: item.type,
                                    });
                                    updateNode(selectedNode.id, { type: item.type });
                                }}
                            >
                                <item.icon className={`w-3.5 h-3.5 ${selectedNode.type === item.type ? '' : item.color}`} />
                                <span className="text-[10px] truncate">{item.label}</span>
                            </Button>
                        ))}
                    </div>
                </div>

                {/* 内容编辑 */}
                <div className="space-y-2">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">文字内容</label>
                    <textarea
                        className="w-full h-32 p-3 text-sm rounded-xl border border-slate-200 bg-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-none outline-none"
                        value={selectedNode.data.content || ''}
                        onFocus={() => {
                            editStartContentRef.current = selectedNode.data.content || '';
                        }}
                        onChange={(e) => updateNode(selectedNode.id, {
                            data: { ...selectedNode.data, content: e.target.value }
                        })}
                        onBlur={(e) => {
                            const currentContent = e.target.value || '';
                            if (currentContent === editStartContentRef.current) return;

                            trackInquiryResearchEvent('node_content_commit', {
                                node_id: selectedNode.id,
                                node_type: selectedNode.type,
                                content_length: currentContent.length,
                                previous_content_length: editStartContentRef.current.length,
                            });
                            editStartContentRef.current = currentContent;
                        }}
                    />
                </div>

                <div className="pt-2 border-t mt-4 flex justify-between items-center">
                    <Button
                        variant="outline"
                        size="sm"
                        className="gap-2 text-emerald-600 hover:bg-emerald-50"
                        onClick={handleAddNodeToWiki}
                        disabled={isAddingToWiki || !(selectedNode.data.content || '').trim()}
                    >
                        <BookOpen className="w-4 h-4" />
                        加入 Wiki
                    </Button>
                    <Button
                        variant="ghost"
                        size="sm"
                        className="text-red-500 hover:text-red-600 hover:bg-red-50 gap-2"
                        onClick={() => {
                            trackInquiryResearchEvent('node_delete', {
                                node_id: selectedNode.id,
                                node_type: selectedNode.type,
                                action_source: 'node_inspector',
                            });
                            deleteNode(selectedNode.id);
                        }}
                    >
                        <Trash2 className="w-4 h-4" />
                        删除节点
                    </Button>
                </div>
            </div>
        </div>
    );
};
