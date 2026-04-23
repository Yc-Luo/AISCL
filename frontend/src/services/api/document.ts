import api from './client'
import { API_ENDPOINTS } from '../../config/api'

export interface Document {
  id: string
  project_id: string
  title: string
  content?: string
  created_at: string
  updated_at: string
  created_by: string
}

export interface DocumentVersion {
  id: string
  document_id: string
  version: number
  content: string
  created_at: string
  created_by: string
}

export interface DocumentListResponse {
  documents: Document[]
  total: number
}

export interface DocumentVersionListResponse {
  versions: DocumentVersion[]
  total: number
}

export const documentService = {
  // Get document snapshot
  async getSnapshot(documentId: string): Promise<Uint8Array | null> {
    try {
      const response = await api.get(
        `${API_ENDPOINTS.COLLABORATION.SNAPSHOT(documentId)}?type=document`
      )
      // response.data.snapshot.data is base64 string
      const base64Data = response.data.snapshot?.data
      if (!base64Data) return null

      const binaryString = atob(base64Data)
      const bytes = new Uint8Array(binaryString.length)
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i)
      }
      return bytes
    } catch (error: any) {
      if (error.response?.status === 404) {
        return null
      }
      throw error
    }
  },

  // Save document snapshot
  async saveSnapshot(documentId: string, data: Uint8Array): Promise<void> {
    // Convert Uint8Array to base64 for transmission
    const base64Data = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => {
        const result = reader.result as string
        resolve(result.split(',')[1])
      }
      reader.onerror = error => reject(error)
      reader.readAsDataURL(new Blob([data as any]))
    })

    await api.post(
      API_ENDPOINTS.COLLABORATION.SNAPSHOT(documentId),
      {
        type: 'document',
        data: base64Data,
      }
    )
  },

  // Get all documents for a project
  async getDocuments(
    projectId: string,
    skip = 0,
    limit = 100,
    archived?: boolean
  ): Promise<DocumentListResponse> {
    const params = new URLSearchParams({
      skip: skip.toString(),
      limit: limit.toString(),
    })
    if (archived !== undefined) {
      params.append('archived', archived.toString())
    }
    const response = await api.get(
      `${API_ENDPOINTS.DOCUMENTS.BY_PROJECT(projectId)}?${params.toString()}`
    )
    return response.data
  },

  // Get a single document
  async getDocument(documentId: string): Promise<Document> {
    const response = await api.get(`${API_ENDPOINTS.DOCUMENTS.BASE}/${documentId}`)
    return response.data
  },

  // Create a new document
  async createDocument(
    projectId: string,
    title: string,
    content?: string
  ): Promise<Document> {
    const response = await api.post(API_ENDPOINTS.DOCUMENTS.BY_PROJECT(projectId), {
      title,
      content,
    })
    return response.data
  },

  // Update a document
  async updateDocument(
    documentId: string,
    title?: string,
    content?: string
  ): Promise<Document> {
    const response = await api.put(`${API_ENDPOINTS.DOCUMENTS.BASE}/${documentId}`, {
      title,
      content,
    })
    return response.data
  },

  // Delete a document
  async deleteDocument(documentId: string): Promise<void> {
    await api.delete(`${API_ENDPOINTS.DOCUMENTS.BASE}/${documentId}`)
  },

  // Get document versions
  async getDocumentVersions(
    documentId: string,
    skip = 0,
    limit = 50
  ): Promise<DocumentVersionListResponse> {
    const params = new URLSearchParams({
      skip: skip.toString(),
      limit: limit.toString(),
    })
    const response = await api.get(
      `${API_ENDPOINTS.DOCUMENTS.VERSIONS(documentId)}?${params.toString()}`
    )
    return response.data
  },

  // Restore a document version
  async restoreVersion(documentId: string, versionId: string): Promise<Document> {
    const response = await api.post(
      API_ENDPOINTS.DOCUMENTS.RESTORE(documentId, versionId)
    )
    return response.data
  },
}

