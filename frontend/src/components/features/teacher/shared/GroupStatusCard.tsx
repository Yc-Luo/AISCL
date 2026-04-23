import { Eye, Clock, MessageSquare, Sparkles } from 'lucide-react';
import { LineChart, Line, ResponsiveContainer } from 'recharts';
import { GroupData } from './mockData';
import { Button, Badge } from '../../../ui';

interface GroupStatusCardProps {
    group: GroupData;
    onViewGroup: (groupId: string) => void;
}

export function GroupStatusCard({ group, onViewGroup }: GroupStatusCardProps) {
    const statusConfig = {
        active: {
            label: 'Active',
            color: 'bg-green-500',
            borderColor: 'border-green-200',
            bgColor: 'bg-green-50',
            textColor: 'text-green-700'
        },
        silence: {
            label: 'Needs Attention',
            color: 'bg-amber-500',
            borderColor: 'border-amber-300',
            bgColor: 'bg-amber-50',
            textColor: 'text-amber-700'
        },
        conflict: {
            label: 'Monitor Closely',
            color: 'bg-red-500',
            borderColor: 'border-red-300',
            bgColor: 'bg-red-50',
            textColor: 'text-red-700'
        }
    };

    const config = statusConfig[group.status];
    const chartData = group.activityData.map((value, index) => ({ value, index }));

    return (
        <div
            className={`
        bg-white rounded-lg border-2 shadow-sm transition-all duration-200 hover:shadow-md
        ${config.borderColor}
      `}
        >
            {/* Header */}
            <div className="px-5 py-4 border-b border-gray-100">
                <div className="flex items-start justify-between mb-2">
                    <h3 className="font-semibold text-slate-900">{group.name}</h3>
                    <div className="flex items-center gap-1.5">
                        <div className={`w-2 h-2 rounded-full ${config.color} animate-pulse`}></div>
                        <Badge variant="secondary" className={`${config.bgColor} ${config.textColor} text-xs border-0`}>
                            {config.label}
                        </Badge>
                    </div>
                </div>
                <div className="flex items-center gap-4 text-xs text-slate-500">
                    <div className="flex items-center gap-1">
                        <Clock className="w-3.5 h-3.5" />
                        <span>{group.lastActive}</span>
                    </div>
                    <div className="flex items-center gap-1">
                        <MessageSquare className="w-3.5 h-3.5" />
                        <span>{group.messageCount} messages</span>
                    </div>
                </div>
            </div>

            {/* Body */}
            <div className="px-5 py-4 space-y-4">
                {/* Mini Sparkline Chart */}
                <div>
                    <p className="text-xs text-slate-500 mb-2">Activity (Last 30 min)</p>
                    <div className="h-16 -mx-1">
                        <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={chartData}>
                                <Line
                                    type="monotone"
                                    dataKey="value"
                                    stroke={group.status === 'active' ? '#22c55e' : group.status === 'silence' ? '#f59e0b' : '#ef4444'}
                                    strokeWidth={2}
                                    dot={false}
                                />
                            </LineChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                {/* AI Regulation Suggestion */}
                <div className="bg-gradient-to-br from-indigo-50/50 to-blue-50/50 rounded-xl p-3.5 border border-indigo-100/50 relative overflow-hidden group/insight">
                    <div className="absolute top-0 right-0 p-2 opacity-5">
                        <Sparkles className="w-12 h-12 text-indigo-600" />
                    </div>
                    <div className="flex items-start gap-2.5 relative z-10">
                        <div className="w-6 h-6 rounded-lg bg-indigo-600 flex items-center justify-center flex-shrink-0 mt-0.5 shadow-sm shadow-indigo-200">
                            <Sparkles className="w-3.5 h-3.5 text-white" />
                        </div>
                        <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                                <p className="text-[11px] font-bold text-indigo-900 uppercase tracking-wider">教育调控建议</p>
                                <Badge className="px-1 py-0 h-3 text-[9px] bg-indigo-100 text-indigo-600 border-0">AI 实时分析</Badge>
                            </div>
                            <p className="text-xs text-slate-700 leading-relaxed font-medium">{group.aiInsight}</p>
                        </div>
                    </div>
                </div>

                {/* Engagement Score */}
                <div>
                    <div className="flex items-center justify-between mb-1.5">
                        <span className="text-xs text-slate-600">Engagement Score</span>
                        <span className="text-sm font-semibold text-slate-900">{group.engagementScore}%</span>
                    </div>
                    <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                        <div
                            className={`h-full rounded-full transition-all duration-500 ${group.engagementScore >= 80 ? 'bg-green-500' :
                                group.engagementScore >= 60 ? 'bg-amber-500' :
                                    'bg-red-500'
                                }`}
                            style={{ width: `${group.engagementScore}%` }}
                        />
                    </div>
                </div>
            </div>

            {/* Footer Actions */}
            <div className="px-5 py-3 border-t border-gray-100 flex items-center gap-2">
                <Button
                    variant="ghost"
                    size="sm"
                    className="flex-1 gap-1.5 hover:bg-slate-50 text-slate-600 font-medium"
                    onClick={() => onViewGroup(group.id)}
                >
                    <Eye className="w-4 h-4" />
                    监控模式
                </Button>
                <Button
                    variant="ghost"
                    size="sm"
                    className="flex-1 gap-1.5 hover:bg-indigo-50 text-indigo-600 font-medium"
                    onClick={() => onViewGroup(group.id)}
                >
                    <Sparkles className="w-4 h-4" />
                    指导模式
                </Button>
            </div>
        </div>
    );
}
