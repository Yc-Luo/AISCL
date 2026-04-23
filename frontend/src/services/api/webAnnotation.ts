import api from './client'

export interface WebAnnotation {
    id: string
    user_id: string
    url: string
    title: string
    content: string
    tags: string[]
    created_at: string
    updated_at: string
}

export interface WebAnnotationListResponse {
    annotations: WebAnnotation[]
    total: number
}

export const webAnnotationService = {
    // Get all web annotations
    async getAnnotations(
        skip = 0,
        limit = 100
    ): Promise<WebAnnotationListResponse> {
        const params = new URLSearchParams({
            skip: skip.toString(),
            limit: limit.toString(),
        })
        const response = await api.get(`/web-annotations?${params.toString()}`)
        return response.data
    },

    // Get a single web annotation
    async getAnnotation(annotationId: string): Promise<WebAnnotation> {
        const response = await api.get(`/web-annotations/${annotationId}`)
        return response.data
    },

    // Create a new web annotation
    async createAnnotation(
        url: string,
        title: string,
        content: string,
        tags: string[] = []
    ): Promise<WebAnnotation> {
        const response = await api.post('/web-annotations', {
            url,
            title,
            content,
            tags,
        })
        return response.data
    },

    // Update a web annotation
    async updateAnnotation(
        annotationId: string,
        title?: string,
        content?: string,
        tags?: string[]
    ): Promise<WebAnnotation> {
        const response = await api.put(`/web-annotations/${annotationId}`, {
            title,
            content,
            tags,
        })
        return response.data
    },

    // Delete a web annotation
    async deleteAnnotation(annotationId: string): Promise<void> {
        await api.delete(`/web-annotations/${annotationId}`)
    },
}
