import api from './client'

export type WikiItemType =
  | 'task_brief'
  | 'concept'
  | 'evidence'
  | 'claim'
  | 'controversy'
  | 'stage_summary'
  | 'note'

export interface WikiItem {
  id: string
  project_id: string
  group_id?: string | null
  stage_id?: string | null
  item_type: WikiItemType
  title: string
  content: string
  summary?: string | null
  source_type: string
  source_id?: string | null
  visibility: 'project' | 'group'
  confidence_level: 'unverified' | 'working' | 'verified'
  created_at: string
  updated_at: string
}

export interface WikiItemListResponse {
  items: WikiItem[]
  total: number
}

export const wikiService = {
  async listItems(projectId: string, params?: {
    item_type?: WikiItemType
    stage_id?: string
    limit?: number
  }): Promise<WikiItemListResponse> {
    const response = await api.get<WikiItemListResponse>(`/wiki/projects/${projectId}/items`, {
      params,
    })
    return response.data
  },

  async searchItems(projectId: string, query: string, params?: {
    item_type?: WikiItemType
    stage_id?: string
    limit?: number
  }): Promise<WikiItemListResponse & { query: string }> {
    const response = await api.get<WikiItemListResponse & { query: string }>(
      `/wiki/projects/${projectId}/search`,
      {
        params: {
          query,
          ...(params || {}),
        },
      }
    )
    return response.data
  },

  async createItem(data: {
    project_id: string
    item_type: WikiItemType
    title: string
    content: string
    summary?: string
    source_type?: string
    source_id?: string
    stage_id?: string
    visibility?: 'project' | 'group'
    confidence_level?: 'unverified' | 'working' | 'verified'
  }): Promise<WikiItem> {
    const response = await api.post<WikiItem>('/wiki/items', data)
    return response.data
  },
}
