import React, { useState } from 'react';
import { useInquiryStore } from '../store/useInquiryStore';
import { Card, CardContent } from '../../../components/ui/card';
import { ScrollArea } from '../../../components/ui/scroll-area';
import { Button } from '../../../components/ui/button';
import { Plus, Trash2, X, Check } from 'lucide-react';
import { useInquiryActions } from './InquiryContext';

interface ScrapbookSidebarProps {
    isVisible: boolean;
}

export const ScrapbookSidebar: React.FC<ScrapbookSidebarProps> = ({ isVisible }) => {
    const { scrapbook } = useInquiryStore();
    const { addCard, deleteCard } = useInquiryActions();
    const [isAdding, setIsAdding] = useState(false);
    const [newContent, setNewContent] = useState('');

    if (!isVisible) return null;

    const handleAdd = () => {
        if (newContent.trim()) {
            addCard(newContent.trim(), 'text');
            setNewContent('');
            setIsAdding(false);
        }
    };

    return (
        <div className="w-80 h-full border-r bg-slate-50 flex flex-col">
            <div className="p-4 border-b bg-white flex justify-between items-center">
                <h3 className="font-semibold text-slate-800">灵感素材池</h3>
                <Button
                    size="icon"
                    variant={isAdding ? "default" : "ghost"}
                    onClick={() => setIsAdding(!isAdding)}
                    className={isAdding ? "bg-red-500 hover:bg-red-600 text-white" : ""}
                >
                    {isAdding ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
                </Button>
            </div>

            <ScrollArea className="flex-1 p-4">
                <div className="space-y-4">
                    {/* 添加素材输入框 */}
                    {isAdding && (
                        <Card className="border-indigo-200 shadow-md ring-2 ring-indigo-500/20">
                            <CardContent className="p-3 space-y-3">
                                <textarea
                                    autoFocus
                                    placeholder="输入新的灵感、问题或素材内容..."
                                    className="w-full h-24 p-2 text-sm bg-slate-50 border-none focus:ring-0 resize-none outline-none"
                                    value={newContent}
                                    onChange={(e) => setNewContent(e.target.value)}
                                />
                                <div className="flex justify-end gap-2">
                                    <Button size="sm" variant="ghost" onClick={() => setIsAdding(false)}>取消</Button>
                                    <Button size="sm" className="bg-indigo-600 hover:bg-indigo-700 text-white" onClick={handleAdd}>
                                        <Check className="w-4 h-4 mr-1" />
                                        添加
                                    </Button>
                                </div>
                            </CardContent>
                        </Card>
                    )}

                    {scrapbook.length === 0 && !isAdding ? (
                        <div className="text-center py-8 text-slate-400 text-sm">
                            还没有收集到素材，点击上方 + 号手动添加，或去资源库发现精彩内容。
                        </div>
                    ) : (
                        scrapbook.map((card) => (
                            <Card
                                key={card.id}
                                className="group relative cursor-move hover:shadow-md transition-shadow bg-white/80 backdrop-blur-sm border-slate-200"
                                draggable
                                onDragStart={(e: React.DragEvent) => {
                                    e.dataTransfer.setData('application/reactflow', card.id);
                                    e.dataTransfer.effectAllowed = 'move';
                                }}
                            >
                                <CardContent className="p-3 text-sm">
                                    <div className="flex justify-between items-start mb-2">
                                        <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wider ${card.type === 'ai_response' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'
                                            }`}>
                                            {card.type === 'ai_response' ? 'AI 建议' : (card.type === 'image' ? '图片素材' : '文本素材')}
                                        </span>
                                        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                            <Button size="icon" variant="ghost" className="h-6 w-6 rounded-full hover:bg-red-50" onClick={() => deleteCard(card.id)}>
                                                <Trash2 className="w-3 h-3 text-red-500" />
                                            </Button>
                                        </div>
                                    </div>
                                    {card.imageUrl && (
                                        <div className="mb-2 rounded-lg overflow-hidden border border-slate-100 bg-slate-50">
                                            <img src={card.imageUrl} alt="预览" className="w-full h-auto object-cover max-h-32" />
                                        </div>
                                    )}
                                    <p className="line-clamp-6 text-slate-700 leading-relaxed">{card.content}</p>

                                    {card.sourceTitle && (
                                        <div className="mt-2 text-[10px] text-indigo-500 font-medium truncate italic" title={card.sourceTitle}>
                                            📍 {card.sourceTitle}
                                        </div>
                                    )}

                                    <div className="mt-2 pt-2 border-t border-slate-50 text-[10px] text-slate-400 flex justify-between items-center">
                                        <span className="font-medium text-slate-500">{card.authorName}</span>
                                        <span>{new Date(card.createdAt).toLocaleDateString()}</span>
                                    </div>
                                </CardContent>
                            </Card>
                        ))
                    )}
                </div>
            </ScrollArea>
        </div>
    );
};
