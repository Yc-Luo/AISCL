import React, { createContext, useContext, ReactNode, useCallback } from 'react';
import { useInquirySync } from '../hooks/useInquirySync';
import { trackingService } from '../../../services/tracking/TrackingService';
import { ExperimentVersion } from '../../../types';
import { useContextStore } from '../../../stores/contextStore';

type ResearchEventOptions = {
    actorType?: 'student' | 'ai_assistant' | 'ai_tutor' | 'teacher' | 'system';
    eventDomain?: 'dialogue' | 'scaffold' | 'inquiry_structure' | 'shared_record' | 'stage_transition' | 'wiki' | 'rag';
};

// 定义 Context 类型
type InquiryContextType = ReturnType<typeof useInquirySync> & {
    projectId: string;
    experimentVersion?: ExperimentVersion | null;
    trackInquiryResearchEvent: (
        eventType: string,
        payload?: Record<string, unknown>,
        options?: ResearchEventOptions
    ) => void;
};

const InquiryContext = createContext<InquiryContextType | null>(null);

interface InquiryProviderProps {
    projectId: string;
    experimentVersion?: ExperimentVersion | null;
    children: ReactNode;
}

export const InquiryProvider: React.FC<InquiryProviderProps> = ({ projectId, experimentVersion, children }) => {
    const syncActions = useInquirySync(projectId);
    const experimentVersionId = experimentVersion?.version_name || undefined;
    const currentStage = useContextStore((state) => state.currentStage);

    const trackInquiryResearchEvent = useCallback<InquiryContextType['trackInquiryResearchEvent']>(
        (eventType, payload = {}, options = {}) => {
            trackingService.trackResearchEvent({
                project_id: projectId,
                experiment_version_id: experimentVersionId,
                actor_type: options.actorType || 'student',
                event_domain: options.eventDomain || 'inquiry_structure',
                event_type: eventType,
                stage_id: currentStage || undefined,
                payload,
            });
        },
        [currentStage, experimentVersionId, projectId]
    );

    return (
        <InquiryContext.Provider value={{
            ...syncActions,
            projectId,
            experimentVersion,
            trackInquiryResearchEvent,
        }}>
            {children}
        </InquiryContext.Provider>
    );
};

export const useInquiryActions = (): InquiryContextType => {
    const context = useContext(InquiryContext);
    if (!context) {
        throw new Error('useInquiryActions must be used within an InquiryProvider');
    }
    return context;
};
