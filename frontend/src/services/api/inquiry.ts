import api from './client';

export interface SnapshotResponse {
    project_id: string;
    data: string; // Base64
}

export const inquiryService = {
    getSnapshot: async (projectId: string): Promise<SnapshotResponse> => {
        const response = await api.get(`/inquiry/projects/${projectId}/snapshot`);
        return response.data;
    },

    saveSnapshot: async (projectId: string, data: string): Promise<void> => {
        await api.post(`/inquiry/projects/${projectId}/snapshot`, { data });
    }
};
