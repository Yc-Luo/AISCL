import api from './client'
import { API_ENDPOINTS } from '../../config/api'

export interface Comment {
  id: string
  document_id: string
  content: string
  position?: {
    from: number
    to: number
  }
  created_at: string
  created_by: string
  status: 'open' | 'resolved'
  mentions?: string[]
}

export interface CommentListResponse {
  comments: Comment[]
  total: number
}

export const commentService = {
  // Get all comments for a document
  async getComments(documentId: string): Promise<CommentListResponse> {
    const response = await api.get(`${API_ENDPOINTS.DOCUMENTS.BASE}/comments/documents/${documentId}`)
    return response.data
  },

  // Create a new comment
  async createComment(
    documentId: string,
    content: string,
    position?: { from: number; to: number },
    mentions?: string[]
  ): Promise<Comment> {
    const response = await api.post(`${API_ENDPOINTS.DOCUMENTS.BASE}/comments/documents/${documentId}`, {
      content,
      position,
      mentions,
    })
    return response.data
  },

  // Update a comment
  async updateComment(
    commentId: string,
    content?: string,
    status?: 'open' | 'resolved'
  ): Promise<Comment> {
    const response = await api.put(`${API_ENDPOINTS.DOCUMENTS.BASE}/comments/${commentId}`, {
      content,
      status,
    })
    return response.data
  },

  // Delete a comment
  async deleteComment(commentId: string): Promise<void> {
    await api.delete(`${API_ENDPOINTS.DOCUMENTS.BASE}/comments/${commentId}`)
  },
}

