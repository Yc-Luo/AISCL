import api from './client'
import { API_ENDPOINTS } from '../../config/api'
import { Resource } from '../../types'

export interface ResourceListResponse {
  resources: Resource[]
  total: number
}

export interface PresignedUploadUrlResponse {
  upload_url: string
  file_key: string
  expires_in: number
}

export const storageService = {
  async getResources(projectId: string): Promise<ResourceListResponse> {
    const response = await api.get<ResourceListResponse>(
      `${API_ENDPOINTS.RESOURCES}/resources/${projectId}`
    )
    return response.data
  },

  async getPresignedUploadUrl(
    projectId: string,
    filename: string,
    mimeType: string,
    size: number
  ): Promise<PresignedUploadUrlResponse> {
    const response = await api.post<PresignedUploadUrlResponse>(
      `${API_ENDPOINTS.RESOURCES}/presigned-url`,
      null,
      {
        params: {
          filename,
          file_type: mimeType,
          size,
          project_id: projectId,
        },
      }
    )
    return response.data
  },

  async uploadFile(
    uploadUrl: string,
    file: File,
    onProgress?: (progress: number) => void
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest()

      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable && onProgress) {
          const progress = (e.loaded / e.total) * 100
          onProgress(progress)
        }
      })

      xhr.addEventListener('load', () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve()
        } else {
          reject(new Error(`Upload failed with status ${xhr.status}`))
        }
      })

      xhr.addEventListener('error', () => {
        reject(new Error('Upload failed'))
      })

      xhr.open('PUT', uploadUrl)
      xhr.setRequestHeader('Content-Type', file.type)
      xhr.send(file)
    })
  },

  async createResource(data: {
    file_key: string
    filename: string
    size: number
    project_id: string
    mime_type: string
  }): Promise<Resource> {
    const response = await api.post<Resource>(
      `${API_ENDPOINTS.RESOURCES}/resources`,
      data
    )
    return response.data
  },

  async deleteResource(_projectId: string, resourceId: string): Promise<void> {
    await api.delete(`${API_ENDPOINTS.RESOURCES}/resources/${resourceId}`)
  },

  async downloadResource(resourceId: string): Promise<Blob> {
    const response = await api.get(`${API_ENDPOINTS.RESOURCES}/resources/${resourceId}/download`, {
      responseType: 'blob',
    })
    return response.data
  },
}

