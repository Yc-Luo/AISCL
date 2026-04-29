export interface Project {
    id: string
    name: string
    subtitle?: string
    description?: string
    course_id?: string
    owner_id: string
    leader_id?: string | null
    members: ProjectMember[]
    progress: number
    is_template: boolean
    is_archived: boolean
    inherited_template_key?: string
    inherited_template_label?: string
    inherited_template_release_id?: string
    inherited_template_source?: string
    initial_task_document_id?: string
    created_at: string
    updated_at: string
    experiment_version?: ExperimentVersion
}

export interface ProjectMember {
    user_id: string
    role: 'owner' | 'editor' | 'viewer'
    joined_at: string
}

export interface CreateProjectData {
    name: string
    subtitle?: string
    description?: string
    course_id?: string
    inherit_course_template?: boolean
    members?: string[]
    is_template?: boolean
}

export interface UpdateProjectData {
    name?: string
    subtitle?: string
    description?: string
    progress?: number
    is_archived?: boolean
    leader_id?: string | null
}

export interface ExperimentVersion {
    project_id: string
    mode: 'default' | 'research'
    version_name: string
    stage_control_mode: 'soft_guidance' | 'hard_constraint'
    process_scaffold_mode: 'on' | 'off'
    ai_scaffold_mode: 'single_agent' | 'multi_agent'
    broadcast_stage_updates: boolean
    group_condition?: string | null
    enabled_scaffold_layers: string[]
    enabled_scaffold_roles: string[]
    enabled_rule_set?: string | null
    export_profile?: string | null
    stage_sequence: string[]
    current_stage?: string | null
    template_key?: string | null
    template_label?: string | null
    template_release_id?: string | null
    template_release_note?: string | null
    template_source?: string | null
    graph_version?: string | null
    source_course_id?: string | null
    template_bound_at?: string | null
    updated_at?: string | null
}
