import { useState, useEffect } from 'react';
import { Clock, User, ArrowRight, ClipboardCheck } from 'lucide-react';
import { projectService } from '../../../../services/api/project';
import { taskService } from '../../../../services/api/task';
import { Task } from '../../../../types';
import { Button, Badge } from '../../../ui';

interface Submission extends Task {
    projectName: string;
}

export default function AssignmentReview() {
    const [submissions, setSubmissions] = useState<Submission[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchSubmissions = async () => {
            try {
                setLoading(true);
                const projectsData = await projectService.getProjects();
                const activeProjects = projectsData.projects.filter(p => !p.is_archived);

                const allSubmissions: Submission[] = [];

                // Fetch tasks for each active project and filter for 'done'
                await Promise.all(activeProjects.map(async (project) => {
                    try {
                        const tasksData = await taskService.getTasks(project.id);
                        const doneTasks = tasksData.tasks.filter(t => t.column === 'done');
                        doneTasks.forEach(task => {
                            allSubmissions.push({
                                ...task,
                                projectName: project.name
                            });
                        });
                    } catch (err) {
                        console.error(`Failed to fetch tasks for project ${project.id}`, err);
                    }
                }));

                // Sort by updated_at descending
                allSubmissions.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
                setSubmissions(allSubmissions);
            } catch (error) {
                console.error('Failed to fetch submissions:', error);
            } finally {
                setLoading(false);
            }
        };

        fetchSubmissions();
    }, []);

    if (loading) {
        return <div className="flex items-center justify-center h-64">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
            <span className="ml-3 text-slate-500">加载提交内容中...</span>
        </div>;
    }

    return (
        <div className="space-y-8 animate-fadeIn">
            <div className="flex justify-between items-end">
                <div>
                    <h2 className="text-3xl font-bold text-gray-900 tracking-tight">作业与任务评审</h2>
                    <p className="text-gray-500 mt-2">查看各小组已完成的任务并进行反馈</p>
                </div>
                <div className="bg-indigo-50 px-4 py-2 rounded-lg border border-indigo-100 flex items-center gap-3">
                    <ClipboardCheck className="text-indigo-600 w-5 h-5" />
                    <span className="text-indigo-900 font-medium">代评审: {submissions.length}</span>
                </div>
            </div>

            {submissions.length > 0 ? (
                <div className="grid gap-4">
                    {submissions.map((submission) => (
                        <div key={submission.id} className="bg-white rounded-xl border border-gray-200 shadow-sm hover:shadow-md transition-shadow p-5">
                            <div className="flex justify-between items-start">
                                <div className="space-y-1">
                                    <div className="flex items-center gap-2">
                                        <Badge variant="secondary" className="bg-green-100 text-green-700 border-green-200">
                                            已完成
                                        </Badge>
                                        <span className="text-sm text-slate-400">来自小组：</span>
                                        <span className="text-sm font-medium text-indigo-600">{submission.projectName}</span>
                                    </div>
                                    <h3 className="text-lg font-bold text-slate-900">{submission.title}</h3>
                                </div>
                                <Button size="sm" variant="outline" className="gap-2">
                                    评审反馈 <ArrowRight className="w-4 h-4" />
                                </Button>
                            </div>

                            <div className="mt-4 flex items-center gap-6 text-sm text-slate-500">
                                <div className="flex items-center gap-2">
                                    <User className="w-4 h-4" />
                                    <span>负责人: {submission.assignees.join(', ') || '全体成员'}</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <Clock className="w-4 h-4" />
                                    <span>提交时间: {new Date(submission.updated_at).toLocaleString()}</span>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            ) : (
                <div className="bg-white rounded-2xl border border-dashed border-gray-300 p-12 text-center">
                    <div className="text-6xl mb-4 opacity-50">📝</div>
                    <h3 className="text-xl font-medium text-gray-900">暂无待批改作业</h3>
                    <p className="text-gray-500 mt-2">当小组完成任务并将其移至“已完成”列后，将在此处显示</p>
                </div>
            )}
        </div>
    );
}
