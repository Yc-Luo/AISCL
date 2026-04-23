import api from '../api/client';
import { useAuthStore } from '../../stores/authStore';
import { useProjectStore } from '../../stores/projectStore';
import { API_ENDPOINTS } from '../../config/api';

export interface TrackEvent {
    module: 'whiteboard' | 'document' | 'chat' | 'resources' | 'browser' | 'ai' | 'task' | 'calendar' | 'dashboard' | 'analytics' | 'inquiry';
    action: string;
    resource_id?: string;
    metadata?: Record<string, any>;
    timestamp?: string; // ISO string
}

interface BehaviorData {
    project_id: string;
    user_id: string;
    module: string;
    action: string;
    resource_id?: string;
    metadata?: Record<string, any>;
    timestamp?: string;
}

export interface TrackResearchEvent {
    project_id?: string;
    experiment_version_id?: string;
    room_id?: string;
    group_id?: string;
    user_id?: string;
    actor_type: 'student' | 'teacher' | 'ai_assistant' | 'ai_tutor' | 'system';
    event_domain: 'dialogue' | 'scaffold' | 'inquiry_structure' | 'shared_record' | 'stage_transition';
    event_type: string;
    event_time?: string;
    stage_id?: string;
    sequence_index?: number;
    payload?: Record<string, any>;
}

interface ResearchEventData {
    project_id: string;
    experiment_version_id?: string;
    room_id?: string;
    group_id?: string;
    user_id?: string;
    actor_type: string;
    event_domain: string;
    event_type: string;
    event_time?: string;
    stage_id?: string;
    sequence_index?: number;
    payload?: Record<string, any>;
}

class TrackingService {
    private buffer: BehaviorData[] = [];
    private researchBuffer: ResearchEventData[] = [];
    private readonly BATCH_SIZE = 10;
    private readonly RESEARCH_BATCH_SIZE = 20;
    private readonly FLUSH_INTERVAL = 5000;
    private timer: NodeJS.Timeout | null = null;

    constructor() {
        this.startFlushTimer();
        this.setupUnloadHandler();
    }

    /**
     * Track a user behavior event
     */
    track(event: TrackEvent) {
        const user = useAuthStore.getState().user;

        // We only track if user is logged in
        if (!user) return;

        // Ensure we have a project ID or fallback
        const storeState = useProjectStore.getState();
        const project = storeState.currentProject;

        let projectId = project?.id || event.metadata?.projectId || event.metadata?.project_id || 'global';

        // If currentProject is null but we have a projectId, try to find it in the projects list
        const activeProject = project || (projectId !== 'global' ? storeState.projects.find(p => p.id === projectId) : null);

        // Enhance metadata with role information
        const projectRole = activeProject?.members?.find((m: any) => m.user_id === user.id)?.role || 'unknown';

        const enhancedMetadata = {
            ...(event.metadata || {}),
            user_role: user.role, // Global role (student/teacher)
            project_role: projectRole // Project context role
        };

        const behaviorData: BehaviorData = {
            project_id: projectId,
            user_id: user.id,
            module: event.module,
            action: event.action,
            resource_id: event.resource_id,
            metadata: enhancedMetadata,
            timestamp: event.timestamp || new Date().toISOString(),
        };

        this.buffer.push(behaviorData);

        if (this.buffer.length >= this.BATCH_SIZE) {
            this.flush();
        }
    }

    /**
     * Flush buffered events to the backend
     */
    async flush() {
        await this.flushBehavior();
        await this.flushResearch();
    }

    async flushBehavior() {
        if (this.buffer.length === 0) return;

        const batch = [...this.buffer];
        this.buffer = [];

        try {
            await api.post(API_ENDPOINTS.ANALYTICS.BATCH, { behaviors: batch });
        } catch (error) {
            console.error('[TrackingService] Failed to flush events', error);
            // Optional: Retry logic or re-add to buffer (careful with overflow)
            this.buffer = [...batch, ...this.buffer].slice(0, 500);
        }
    }

    trackResearchEvent(event: TrackResearchEvent) {
        const user = useAuthStore.getState().user;
        if (!user) return;

        const storeState = useProjectStore.getState();
        const project = storeState.currentProject;
        const projectId = event.project_id || project?.id;

        if (!projectId) return;

        const researchEvent: ResearchEventData = {
            project_id: projectId,
            experiment_version_id: event.experiment_version_id,
            room_id: event.room_id,
            group_id: event.group_id,
            user_id: event.user_id || user.id,
            actor_type: event.actor_type,
            event_domain: event.event_domain,
            event_type: event.event_type,
            event_time: event.event_time || new Date().toISOString(),
            stage_id: event.stage_id,
            sequence_index: event.sequence_index,
            payload: event.payload || {},
        };

        this.researchBuffer.push(researchEvent);

        if (this.researchBuffer.length >= this.RESEARCH_BATCH_SIZE) {
            this.flushResearch();
        }
    }

    async trackResearchEventsBatch(events: TrackResearchEvent[]) {
        events.forEach((event) => this.trackResearchEvent(event));
        if (this.researchBuffer.length > 0) {
            await this.flushResearch();
        }
    }

    async flushResearch() {
        if (this.researchBuffer.length === 0) return;

        const batch = [...this.researchBuffer];
        this.researchBuffer = [];

        try {
            await api.post(API_ENDPOINTS.ANALYTICS.RESEARCH_EVENTS_BATCH, {
                events: batch,
            });
        } catch (error) {
            console.error('[TrackingService] Failed to flush research events', error);
            this.researchBuffer = [...batch, ...this.researchBuffer].slice(0, 1000);
        }
    }

    private startFlushTimer() {
        if (this.timer) clearInterval(this.timer);
        this.timer = setInterval(() => {
            this.flush();
        }, this.FLUSH_INTERVAL);
    }

    private setupUnloadHandler() {
        window.addEventListener('beforeunload', () => {
            this.flush();
        });
    }
}

export const trackingService = new TrackingService();
