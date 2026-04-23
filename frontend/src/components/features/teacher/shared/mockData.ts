// Mock data for Teacher Command Center

export type GroupStatus = 'active' | 'silence' | 'conflict';

export interface GroupData {
    id: string;
    name: string;
    status: GroupStatus;
    lastActive: string;
    messageCount: number;
    engagementScore: number;
    aiInsight: string;
    activityData: number[]; // Last 30 minutes of activity
    members: string[];
}

export interface ChatMessage {
    id: string;
    sender: string;
    message: string;
    timestamp: string;
    sentiment: 'positive' | 'neutral' | 'negative';
}

export const mockGroups: GroupData[] = [
    {
        id: 'alpha',
        name: '阿尔法小组 (Alpha)',
        status: 'active',
        lastActive: '2分钟前',
        messageCount: 45,
        engagementScore: 92,
        aiInsight: '讨论非常激烈且富有成效。在解决问题3方面展现了强大的协作能力。',
        activityData: [12, 15, 18, 22, 25, 28, 32, 35, 38, 42, 45, 48, 52, 55, 58, 62, 65, 68, 72, 75],
        members: ['Alice', 'Bob', 'Charlie', 'Diana']
    },
    {
        id: 'beta',
        name: '贝塔小组 (Beta)',
        status: 'silence',
        lastActive: '15分钟前',
        messageCount: 12,
        engagementScore: 45,
        aiInsight: '检测到活跃度较低。小组可能需要鼓励或新的提示。',
        activityData: [8, 10, 12, 14, 12, 10, 8, 6, 4, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        members: ['Emma', 'Frank', 'Grace', 'Henry']
    },
    {
        id: 'gamma',
        name: '伽马小组 (Gamma)',
        status: 'active',
        lastActive: '30秒前',
        messageCount: 67,
        engagementScore: 88,
        aiInsight: '进展顺利。学生正在提出澄清性问题，并相互完善观点。',
        activityData: [20, 22, 25, 28, 30, 35, 38, 42, 45, 50, 55, 58, 62, 65, 67, 70, 72, 75, 78, 80],
        members: ['Ivy', 'Jack', 'Kate', 'Liam']
    },
    {
        id: 'delta',
        name: '德尔塔小组 (Delta)',
        status: 'conflict',
        lastActive: '1分钟前',
        messageCount: 38,
        engagementScore: 62,
        aiInsight: '检测到可能的意见分歧。学生们正在就问题2的不同解决方法进行辩论。',
        activityData: [15, 18, 22, 28, 35, 42, 48, 52, 55, 58, 60, 58, 55, 52, 48, 45, 42, 40, 38, 38],
        members: ['Mia', 'Noah', 'Olivia', 'Parker']
    },
    {
        id: 'epsilon',
        name: '艾普西隆小组 (Epsilon)',
        status: 'active',
        lastActive: '5分钟前',
        messageCount: 29,
        engagementScore: 78,
        aiInsight: '协作稳定。小组成员正在按部就班地逐一解决问题。',
        activityData: [10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 32, 34, 36, 38, 40, 42, 44, 46, 48],
        members: ['Quinn', 'Ryan', 'Sophia', 'Tyler']
    },
    {
        id: 'zeta',
        name: '泽塔小组 (Zeta)',
        status: 'active',
        lastActive: '3分钟前',
        messageCount: 54,
        engagementScore: 85,
        aiInsight: '小组正在积极探索多种解决方案。展现了良好的批判性思维。',
        activityData: [18, 20, 24, 28, 32, 36, 40, 44, 48, 52, 56, 60, 64, 68, 72, 76, 78, 80, 82, 84],
        members: ['Uma', 'Victor', 'Wendy', 'Xavier']
    },
    {
        id: 'eta',
        name: '艾塔小组 (Eta)',
        status: 'silence',
        lastActive: '22分钟前',
        messageCount: 8,
        engagementScore: 38,
        aiInsight: '小组已进入沉默状态。最后的留言显示他们对任务要求感到困惑。',
        activityData: [6, 8, 10, 12, 10, 8, 6, 4, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        members: ['Yara', 'Zane', 'Ava', 'Blake']
    },
    {
        id: 'theta',
        name: '西塔小组 (Theta)',
        status: 'active',
        lastActive: '1分钟前',
        messageCount: 41,
        engagementScore: 82,
        aiInsight: '存在明显的同伴互助。进度较快的学生正在帮助其他同学理解概念。',
        activityData: [14, 16, 18, 20, 22, 24, 26, 28, 30, 32, 34, 36, 38, 40, 42, 44, 46, 48, 50, 52],
        members: ['Caleb', 'Daisy', 'Ethan', 'Fiona']
    }
];

export const mockChatMessages: ChatMessage[] = [
    {
        id: '1',
        sender: 'Alice',
        message: '我认为我们应该首先明确定义变量。',
        timestamp: '10:24 AM',
        sentiment: 'positive'
    },
    {
        id: '2',
        sender: 'Bob',
        message: '好主意！让我们用 x 表示时间，y 表示距离。',
        timestamp: '10:25 AM',
        sentiment: 'positive'
    },
    {
        id: '3',
        sender: 'Charlie',
        message: '等等，我们不应该也考虑加速度吗？',
        timestamp: '10:26 AM',
        sentiment: 'neutral'
    },
    {
        id: '4',
        sender: 'Diana',
        message: 'Charlie 说得对。题目提到了汽车正在加速。',
        timestamp: '10:27 AM',
        sentiment: 'positive'
    },
    {
        id: '5',
        sender: 'AI 助手',
        message: '精彩的观察！你们打算如何将加速度纳入方程中？',
        timestamp: '10:27 AM',
        sentiment: 'neutral'
    }
];

export const topStats = {
    activeGroups: 6,
    totalGroups: 8,
    avgEngagement: 71,
    alerts: 2
};

export interface StudentData {
    id: string;
    name: string;
    email: string;
    group: string;
    status: '在线' | '离线';
    lastActive: string;
}

export const mockStudents: StudentData[] = [
    { id: '1', name: 'Alice', email: 'alice@example.com', group: '阿尔法小组 (Alpha)', status: '在线', lastActive: '2分钟前' },
    { id: '2', name: 'Bob', email: 'bob@example.com', group: '阿尔法小组 (Alpha)', status: '在线', lastActive: '5分钟前' },
    { id: '3', name: 'Charlie', email: 'charlie@example.com', group: '阿尔法小组 (Alpha)', status: '离线', lastActive: '1小时前' },
    { id: '4', name: 'Diana', email: 'diana@example.com', group: '阿尔法小组 (Alpha)', status: '在线', lastActive: '1分钟前' },
    { id: '5', name: 'Emma', email: 'emma@example.com', group: '贝塔小组 (Beta)', status: '在线', lastActive: '刚刚' },
    { id: '6', name: 'Frank', email: 'frank@example.com', group: '贝塔小组 (Beta)', status: '离线', lastActive: '30分钟前' },
    { id: '7', name: 'Grace', email: 'grace@example.com', group: '贝塔小组 (Beta)', status: '在线', lastActive: '5分钟前' },
    { id: '8', name: 'Henry', email: 'henry@example.com', group: '贝塔小组 (Beta)', status: '离线', lastActive: '2天前' },
    { id: '9', name: 'Ivy', email: 'ivy@example.com', group: '伽马小组 (Gamma)', status: '在线', lastActive: '刚刚' },
    { id: '10', name: 'Jack', email: 'jack@example.com', group: '伽马小组 (Gamma)', status: '在线', lastActive: '1分钟前' },
    { id: '11', name: 'Kate', email: 'kate@example.com', group: '伽马小组 (Gamma)', status: '在线', lastActive: '3分钟前' },
    { id: '12', name: 'Liam', email: 'liam@example.com', group: '伽马小组 (Gamma)', status: '在线', lastActive: '10分钟前' },
    { id: '13', name: 'Mia', email: 'mia@example.com', group: '德尔塔小组 (Delta)', status: '在线', lastActive: '15分钟前' },
    { id: '14', name: 'Noah', email: 'noah@example.com', group: '德尔塔小组 (Delta)', status: '离线', lastActive: '4小时前' },
    { id: '15', name: 'Olivia', email: 'olivia@example.com', group: '德尔塔小组 (Delta)', status: '在线', lastActive: '25分钟前' },
    { id: '16', name: 'Parker', email: 'parker@example.com', group: '德尔塔小组 (Delta)', status: '离线', lastActive: '1天前' },
];
