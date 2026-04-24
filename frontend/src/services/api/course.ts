import api from './client'

export interface Course {
    id: string
    name: string
    semester: string
    teacher_id: string
    description?: string
    students: string[]
    invite_code: string
    experiment_template_key?: string
    experiment_template_label?: string
    experiment_template_release_id?: string
    experiment_template_release_note?: string
    experiment_template_source?: string
    experiment_template_bound_at?: string
    initial_task_document_title?: string
    initial_task_document_content?: string
    created_at: string
}

export interface Student {
    id: string
    username: string
    email: string
    avatar_url?: string
}

export interface StudentImportItem {
    username: string
    email: string
    password?: string
}

export interface StudentImportResult {
    row: number
    username: string
    email: string
    status: 'created' | 'linked' | 'skipped' | 'failed'
    message: string
    user_id?: string
}

export interface StudentImportResponse {
    created_count: number
    linked_count: number
    skipped_count: number
    failed_count: number
    results: StudentImportResult[]
}

export const courseService = {
    getCourses: async (): Promise<Course[]> => {
        const response = await api.get('/courses')
        return response.data.courses // Backend returns { courses: [...] }
    },

    createCourse: async (data: { name: string; semester: string; description?: string; experiment_template_key?: string; initial_task_document_title?: string; initial_task_document_content?: string }) => {
        const response = await api.post('/courses', data)
        return response.data
    },

    deleteCourse: async (courseId: string) => {
        await api.delete(`/courses/${courseId}`)
    },

    updateCourse: async (courseId: string, data: { name?: string; description?: string; experiment_template_key?: string; initial_task_document_title?: string; initial_task_document_content?: string }) => {
        const response = await api.put(`/courses/${courseId}`, data)
        return response.data
    },

    getCourseStudents: async (courseId: string): Promise<Student[]> => {
        const response = await api.get(`/courses/${courseId}/students`)
        return response.data.students
    },

    removeStudent: async (courseId: string, studentId: string) => {
        await api.delete(`/courses/${courseId}/students/${studentId}`)
    },

    addStudentToCourse: async (courseId: string, studentId: string) => {
        const response = await api.post(`/courses/${courseId}/students?student_id=${studentId}`)
        return response.data
    },

    bulkImportStudents: async (
        courseId: string,
        data: { students: StudentImportItem[]; default_password?: string }
    ): Promise<StudentImportResponse> => {
        const response = await api.post(`/courses/${courseId}/students/bulk-import`, data)
        return response.data
    },

    getStudentProgress: async (studentId: string) => {
        const response = await api.get(`/analytics/projects/student/${studentId}/progress`)
        return response.data
    }
}
