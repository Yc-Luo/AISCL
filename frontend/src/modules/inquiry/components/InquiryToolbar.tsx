import React from 'react';
import { Button } from '../../../components/ui/button';
import { cn } from '../../../lib/utils';
import {
    LayoutDashboard,
    Network,
    Sparkles,
    Shapes,
    Loader2,
    Circle,
    CloudCheck
} from 'lucide-react';

interface InquiryToolbarProps {
    viewMode: 'scrapbook' | 'argumentation';
    setViewMode: (mode: 'scrapbook' | 'argumentation') => void;
    onAIAnalysis: () => void;
    onClustering: () => void;
    aiAnalysisEnabled?: boolean;
    clusteringEnabled?: boolean;
    aiAnalysisDisabledReason?: string;
    clusteringDisabledReason?: string;
    analyzingType: 'devil_advocate' | 'clustering' | null;
    onSave: () => void;
    isSaving: boolean;
    isConnected: boolean;
}

export const InquiryToolbar: React.FC<InquiryToolbarProps> = ({
    viewMode,
    setViewMode,
    onAIAnalysis,
    onClustering,
    aiAnalysisEnabled = true,
    clusteringEnabled = true,
    aiAnalysisDisabledReason,
    clusteringDisabledReason,
    analyzingType,
    onSave,
    isSaving,
    isConnected
}) => {
    const isAnalyzingAnalysis = analyzingType === 'devil_advocate';
    const isAnalyzingClustering = analyzingType === 'clustering';
    const isAnyAnalyzing = analyzingType !== null;

    return (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1 p-0.5 bg-white/95 backdrop-blur-xl rounded-full shadow-xl border border-white/20 transition-all duration-300 ring-1 ring-slate-900/5">
            {/* View Toggle Group */}
            <div className="flex bg-slate-200/50 p-1 rounded-full relative overflow-hidden group/toggle">
                <Button
                    variant="ghost"
                    size="sm"
                    className={cn(
                        "rounded-full h-7 px-3.5 relative z-10 transition-all duration-300 text-xs",
                        viewMode === 'scrapbook'
                            ? "text-indigo-600 font-bold bg-white shadow-sm"
                            : "text-slate-600 hover:text-slate-900"
                    )}
                    onClick={() => setViewMode('scrapbook')}
                >
                    <LayoutDashboard className={cn("w-3.5 h-3.5 mr-1.5 transition-transform", viewMode === 'scrapbook' && "scale-110")} />
                    灵感墙
                </Button>
                <Button
                    variant="ghost"
                    size="sm"
                    className={cn(
                        "rounded-full h-7 px-3.5 relative z-10 transition-all duration-300 text-xs",
                        viewMode === 'argumentation'
                            ? "text-indigo-600 font-bold bg-white shadow-sm"
                            : "text-slate-600 hover:text-slate-900"
                    )}
                    onClick={() => setViewMode('argumentation')}
                >
                    <Network className={cn("w-3.5 h-3.5 mr-1.5 transition-transform", viewMode === 'argumentation' && "scale-110")} />
                    论证画布
                </Button>
            </div>

            <div className="w-px h-4 bg-slate-200 mx-0.5 shadow-sm" />

            {/* AI Actions Group */}
            <div className="flex items-center gap-2 px-1">
                <Button
                    variant="ghost"
                    size="sm"
                    className={cn(
                        "h-7 rounded-full px-2.5 transition-all duration-500 relative overflow-hidden group",
                        isAnalyzingAnalysis
                            ? "bg-purple-100 text-purple-700 w-auto ring-1 ring-purple-200"
                            : "text-purple-600 hover:bg-purple-50 w-auto"
                    )}
                    onClick={onAIAnalysis}
                    disabled={isAnyAnalyzing || !aiAnalysisEnabled}
                    title={!aiAnalysisEnabled ? aiAnalysisDisabledReason : "AI 辩难 (Devil's Advocate)"}
                >
                    {isAnalyzingAnalysis ? (
                        <>
                            <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                            <span className="text-[10px] font-bold animate-pulse">正在反思...</span>
                        </>
                    ) : (
                        <>
                            <Sparkles className="w-3.5 h-3.5 mr-1.5 group-hover:rotate-12 transition-transform" />
                            <span className="text-[11px] font-medium">AI 辩难</span>
                        </>
                    )}
                </Button>

                <Button
                    variant="ghost"
                    size="sm"
                    className={cn(
                        "h-7 rounded-full px-2.5 transition-all duration-500 relative overflow-hidden group",
                        isAnalyzingClustering
                            ? "bg-indigo-100 text-indigo-700 w-auto ring-1 ring-indigo-200"
                            : "text-indigo-600 hover:bg-indigo-50 w-auto"
                    )}
                    onClick={onClustering}
                    disabled={isAnyAnalyzing || !clusteringEnabled}
                    title={!clusteringEnabled ? clusteringDisabledReason : "智能聚类 (Clustering)"}
                >
                    {isAnalyzingClustering ? (
                        <>
                            <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                            <span className="text-[10px] font-bold animate-pulse">正在聚类...</span>
                        </>
                    ) : (
                        <>
                            <Shapes className="w-3.5 h-3.5 mr-1.5 group-hover:scale-110 transition-transform" />
                            <span className="text-[11px] font-medium">智能聚类</span>
                        </>
                    )}
                </Button>
            </div>

            <div className="w-px h-4 bg-slate-200 mx-0.5 shadow-sm" />

            {/* Persistence & Status Group */}
            <div className="flex items-center gap-1.5 px-2">
                <Button
                    variant="ghost"
                    size="sm"
                    className={cn(
                        "h-7 rounded-full px-2.5 transition-all text-slate-600 hover:bg-slate-100 group",
                        isSaving && "text-indigo-600"
                    )}
                    onClick={onSave}
                    disabled={isSaving}
                    title="保存到服务器"
                >
                    {isSaving ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                        <CloudCheck className="w-3.5 h-3.5 group-hover:scale-110 transition-transform" />
                    )}
                    <span className="text-[11px] font-medium ml-1.5">{isSaving ? '正在保存' : '保存'}</span>
                </Button>

                <div
                    className={cn(
                        "flex items-center justify-center p-1.5 rounded-full transition-colors",
                        isConnected ? "bg-green-50 text-green-500" : "bg-red-50 text-red-500"
                    )}
                    title={isConnected ? "协作已连接" : "协作已断开"}
                >
                    <Circle className={cn("w-2 h-2 fill-current", isConnected && "animate-pulse")} />
                </div>
            </div>
        </div>
    );
};
