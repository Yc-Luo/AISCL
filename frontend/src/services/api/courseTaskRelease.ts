import api from './client'

export interface CourseTaskRelease {
  id: string
  course_id: string
  course_name?: string
  teacher_id: string
  title: string
  task_brief_html?: string
  task_background?: string
  core_question?: string
  collaboration_requirements?: string
  deliverable_requirements?: string
  evaluation_points?: string
  due_at?: string
  allow_late_submission: boolean
  status: 'open' | 'closed'
  target_project_ids: string[]
  target_project_count: number
  synced_task_ids: string[]
  synced_task_count: number
  synced_document_ids: string[]
  synced_document_count: number
  submitted_count: number
  manual_submitted_count: number
  late_submitted_count: number
  auto_submitted_count: number
  created_by: string
  created_at: string
  updated_at: string
  published_at: string
  closed_at?: string
}

export interface CourseTaskReleaseCreateRequest {
  title: string
  task_brief_html?: string
  task_background?: string
  core_question?: string
  collaboration_requirements?: string
  deliverable_requirements?: string
  evaluation_points?: string
  due_at?: string
  allow_late_submission: boolean
}

export const courseTaskReleaseService = {
  async listCourseReleases(courseId: string): Promise<CourseTaskRelease[]> {
    const response = await api.get<{ releases: CourseTaskRelease[] }>(
      `/course-task-releases/courses/${courseId}`
    )
    return response.data.releases
  },

  async createCourseRelease(
    courseId: string,
    data: CourseTaskReleaseCreateRequest
  ): Promise<CourseTaskRelease> {
    const response = await api.post<CourseTaskRelease>(
      `/course-task-releases/courses/${courseId}`,
      data
    )
    return response.data
  },

  async closeRelease(releaseId: string): Promise<CourseTaskRelease> {
    const response = await api.post<CourseTaskRelease>(
      `/course-task-releases/${releaseId}/close`
    )
    return response.data
  },
}
