import React from 'react';
import { PanelLeftClose, Plus } from 'lucide-react';
import { Button } from '../../../components/ui/button';
import { cn } from '../../../lib/utils';

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
    aiAnalysisEnabled,
    clusteringEnabled,
    aiAnalysisDisabledReason,
    clusteringDisabledReason,
    analyzingType,
    onSave,
    isSaving,
    isConnected,
}) => {
    void onAIAnalysis;
    void onClustering;
    void aiAnalysisEnabled;
    void clusteringEnabled;
    void aiAnalysisDisabledReason;
    void clusteringDisabledReason;
    void analyzingType;
    void onSave;
    void isSaving;
    void isConnected;

    const scrapbookOpen = viewMode === 'scrapbook';

    return (
        <div className="absolute left-3 top-11 z-10">
            <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setViewMode(scrapbookOpen ? 'argumentation' : 'scrapbook')}
                className={cn(
                    'h-8 rounded-xl border border-indigo-100 bg-white/95 px-3 text-xs font-bold text-indigo-600 shadow-sm backdrop-blur transition hover:bg-indigo-50',
                    scrapbookOpen && 'bg-indigo-50'
                )}
                title={scrapbookOpen ? '收起素材栏' : '展开素材栏'}
            >
                {scrapbookOpen ? (
                    <PanelLeftClose className="mr-1.5 h-3.5 w-3.5" />
                ) : (
                    <Plus className="mr-1.5 h-3.5 w-3.5" />
                )}
                {scrapbookOpen ? '收起素材' : '素材'}
            </Button>
        </div>
    );
};
