import api from './client';
import { API_ENDPOINTS } from '../../config/api';

export interface CollaborationSnapshot {
    project_id: string;
    snapshot: {
        data: string; // Base64 string
    };
    updated_at: string;
}

export const collaborationService = {
    /**
     * Get the latest snapshot for a project or document.
     */
    async getSnapshot(id: string, type: 'whiteboard' | 'document' | 'inquiry' = 'whiteboard'): Promise<{ data: string } | null> {
        try {
            const response = await api.get(API_ENDPOINTS.COLLABORATION.SNAPSHOT(id), {
                params: {
                    type: type
                }
            });

            // The backend returns { project_id, snapshot: { data: ... }, updated_at }
            if (response.data && response.data.snapshot) {
                return response.data.snapshot;
            }
            return null;
        } catch (error) {
            console.error('Failed to get snapshot:', error);
            return null;
        }
    },

    /**
     * Save a snapshot.
     */
    async saveSnapshot(id: string, data: string, type: 'whiteboard' | 'document' | 'inquiry' = 'whiteboard'): Promise<void> {
        // data should be base64 string or whatever the backend expects inside the dict
        await api.post(API_ENDPOINTS.COLLABORATION.SNAPSHOT(id), {
            data: data, // Wrapping in 'data' key as expected by backend WhiteboardSnapshot model usage
            type: type
        });
    }
};
