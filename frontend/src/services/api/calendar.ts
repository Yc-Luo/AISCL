import api from './client'
import { CalendarEvent } from '../../types'

export interface CalendarEventListResponse {
  events: CalendarEvent[]
  total: number
}

export interface CalendarEventCreateRequest {
  title: string
  start_time: string
  end_time: string
  type: 'meeting' | 'deadline' | 'personal'
  is_private?: boolean
}

export interface CalendarEventUpdateRequest {
  title?: string
  start_time?: string
  end_time?: string
  type?: 'meeting' | 'deadline' | 'personal'
  is_private?: boolean
}

export const calendarService = {
  async getEvents(projectId: string, startDate?: string, endDate?: string): Promise<CalendarEventListResponse> {
    const params: Record<string, string> = {}
    if (startDate) params.start_date = startDate
    if (endDate) params.end_date = endDate
    const response = await api.get<CalendarEventListResponse>(
      `/calendar/projects/${projectId}`,
      { params }
    )
    return response.data
  },

  async createEvent(projectId: string, data: CalendarEventCreateRequest): Promise<CalendarEvent> {
    const response = await api.post<CalendarEvent>(
      `/calendar/projects/${projectId}`,
      data
    )
    return response.data
  },

  async updateEvent(eventId: string, data: CalendarEventUpdateRequest): Promise<CalendarEvent> {
    const response = await api.put<CalendarEvent>(
      `/calendar/${eventId}`,
      data
    )
    return response.data
  },

  async deleteEvent(eventId: string): Promise<void> {
    await api.delete(`/calendar/${eventId}`)
  },
}

