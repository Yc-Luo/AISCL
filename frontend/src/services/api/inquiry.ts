import api from './client';

export interface SnapshotResponse {
    project_id: string;
    snapshot_id?: string;
    data: string; // Base64
    version?: number;
    updated_at?: string;
    updated_by?: string;
}

export interface SnapshotSaveResponse {
    message: string;
    snapshot_id: string;
    version?: number;
    updated_at?: string;
    updated_by?: string;
}

export const inquiryService = {
    getSnapshot: async (projectId: string): Promise<SnapshotResponse> => {
        const response = await api.get(`/inquiry/projects/${projectId}/snapshot`);
        return response.data;
    },

    saveSnapshot: async (projectId: string, data: string, baseVersion?: number): Promise<SnapshotSaveResponse> => {
        const response = await api.post(`/inquiry/projects/${projectId}/snapshot`, { data, base_version: baseVersion });
        return response.data;
    }
};
