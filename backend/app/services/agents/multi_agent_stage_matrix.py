"""Four-stage scaffold matrix and stage labels for the AISCL agents."""

KNOWLEDGE_CONSTRUCT_LABELS = {
    "problem_construction": "问题构建",
    "meaning_exploration": "意义探索",
    "explanation_integration": "解释整合",
    "application_solution": "应用解决",
}

REGULATION_CONSTRUCT_LABELS = {
    "goal_regulation": "目标调节",
    "process_monitoring": "过程监控",
    "strategy_coordination": "策略协同",
    "emotion_coordination": "情绪协调",
    "emotion_motivation_coordination": "情绪与动机协调",
}

STAGE_LABELS = {
    "task_import": "任务导入",
    "problem_planning": "问题规划",
    "evidence_exploration": "证据探究",
    "argumentation": "论证协商",
    "reflection_revision": "反思修订",
    "problem_construction": "问题构建",
    "meaning_exploration": "意义探索",
    "explanation_integration": "解释整合",
    "application_solution": "应用解决",
}

STAGE_ALIASES = {
    "task_import": "problem_construction",
    "任务导入": "problem_construction",
    "problem_planning": "problem_construction",
    "问题规划": "problem_construction",
    "problem_construction": "problem_construction",
    "问题构建": "problem_construction",
    "evidence_exploration": "meaning_exploration",
    "证据探究": "meaning_exploration",
    "meaning_exploration": "meaning_exploration",
    "意义探索": "meaning_exploration",
    "argumentation": "explanation_integration",
    "论证协商": "explanation_integration",
    "explanation_integration": "explanation_integration",
    "解释整合": "explanation_integration",
    "reflection_revision": "application_solution",
    "反思修订": "application_solution",
    "application_solution": "application_solution",
    "应用解决": "application_solution",
}

STAGE_SCAFFOLD_MATRIX = """四阶段支架重点：
- 问题构建：澄清任务、界定核心问题、识别分歧、明确判断标准。
- 意义探索：扩展资料、比较观点、判断证据质量、区分事实/观点/假设。
- 解释整合：组织证据链、形成可辩护解释、处理反驳、标出解释边界。
- 应用解决：落地方案、检验适用条件、评估风险、修订成果表达。
"""

STAGE_DEFAULTS = {
    "problem_construction": ("single", ["problem_progressor"]),
    "meaning_exploration": ("parallel", ["evidence_researcher", "viewpoint_challenger", "feedback_prompter"]),
    "explanation_integration": ("debate", ["evidence_researcher", "viewpoint_challenger", "feedback_prompter"]),
    "application_solution": ("pipeline", ["evidence_researcher", "viewpoint_challenger", "feedback_prompter", "problem_progressor"]),
}

ORCHESTRATION_MATRIX = {
    ("problem_construction", "clarify_task"): ("single", ["problem_progressor"]),
    ("problem_construction", "platform_help"): ("single", ["problem_progressor"]),
    ("problem_construction", "deep_inquiry"): ("pipeline", ["evidence_researcher", "viewpoint_challenger", "feedback_prompter", "problem_progressor"]),
    ("problem_construction", "emotion_support"): ("pipeline", ["problem_progressor", "feedback_prompter"]),
    ("problem_construction", "seek_evidence"): ("single", ["evidence_researcher"]),
    ("problem_construction", "explore_perspectives"): ("parallel", ["problem_progressor", "evidence_researcher"]),
    ("meaning_exploration", "platform_help"): ("single", ["problem_progressor"]),
    ("meaning_exploration", "clarify_task"): ("single", ["problem_progressor"]),
    ("meaning_exploration", "deep_inquiry"): ("pipeline", ["evidence_researcher", "viewpoint_challenger", "feedback_prompter", "problem_progressor"]),
    ("meaning_exploration", "emotion_support"): ("pipeline", ["problem_progressor", "evidence_researcher", "feedback_prompter"]),
    ("meaning_exploration", "seek_evidence"): ("single", ["evidence_researcher"]),
    ("meaning_exploration", "explore_perspectives"): ("parallel", ["evidence_researcher", "viewpoint_challenger", "feedback_prompter"]),
    ("meaning_exploration", "challenge_view"): ("debate", ["evidence_researcher", "viewpoint_challenger"]),
    ("meaning_exploration", "compare_views"): ("parallel", ["viewpoint_challenger", "evidence_researcher", "feedback_prompter"]),
    ("explanation_integration", "platform_help"): ("single", ["problem_progressor"]),
    ("explanation_integration", "deep_inquiry"): ("pipeline", ["evidence_researcher", "viewpoint_challenger", "feedback_prompter", "problem_progressor"]),
    ("explanation_integration", "emotion_support"): ("pipeline", ["problem_progressor", "feedback_prompter", "viewpoint_challenger"]),
    ("explanation_integration", "seek_evidence"): ("single", ["evidence_researcher"]),
    ("explanation_integration", "challenge_view"): ("debate", ["evidence_researcher", "viewpoint_challenger", "feedback_prompter"]),
    ("explanation_integration", "compare_views"): ("debate", ["evidence_researcher", "viewpoint_challenger", "feedback_prompter"]),
    ("explanation_integration", "improve_argument"): ("debate", ["evidence_researcher", "feedback_prompter", "viewpoint_challenger"]),
    ("explanation_integration", "seek_synthesis"): ("pipeline", ["evidence_researcher", "viewpoint_challenger", "feedback_prompter", "problem_progressor"]),
    ("application_solution", "platform_help"): ("single", ["problem_progressor"]),
    ("application_solution", "deep_inquiry"): ("pipeline", ["evidence_researcher", "viewpoint_challenger", "feedback_prompter", "problem_progressor"]),
    ("application_solution", "emotion_support"): ("pipeline", ["problem_progressor", "feedback_prompter"]),
    ("application_solution", "seek_evidence"): ("single", ["evidence_researcher"]),
    ("application_solution", "challenge_view"): ("debate", ["evidence_researcher", "viewpoint_challenger"]),
    ("application_solution", "seek_synthesis"): ("pipeline", ["evidence_researcher", "viewpoint_challenger", "feedback_prompter", "problem_progressor"]),
    ("application_solution", "apply_solve"): ("pipeline", ["evidence_researcher", "viewpoint_challenger", "feedback_prompter", "problem_progressor"]),
}

RULE_TO_PLAN = {
    "evidence_gap": ("single", ["evidence_researcher"], "evidence_gap"),
    "counterargument_missing": ("debate", ["evidence_researcher", "viewpoint_challenger"], "counterargument_missing"),
    "revision_stall": ("single", ["feedback_prompter"], "reasoning_or_integration_need"),
    "responsibility_risk": ("single", ["problem_progressor"], "strategy_or_action_need"),
    "emotion": ("pipeline", ["problem_progressor", "feedback_prompter"], "emotion_or_motivation_risk"),
    "silence": ("pipeline", ["problem_progressor", "feedback_prompter"], "emotion_or_motivation_risk"),
}

SUPPORT_TO_CONSTRUCTS = {
    "problem_framing": ("problem_construction", "goal_regulation"),
    "task_clarification": ("problem_construction", "goal_regulation"),
    "evidence_gap": ("meaning_exploration", "process_monitoring"),
    "criteria_or_ai_peer_comparison": ("meaning_exploration", "process_monitoring"),
    "multiple_view_generation": ("meaning_exploration", "strategy_coordination"),
    "counterargument_missing": ("explanation_integration", "process_monitoring"),
    "reasoning_or_integration_need": ("explanation_integration", "process_monitoring"),
    "deep_inquiry_scaffold": ("explanation_integration", "process_monitoring"),
    "application_boundary_check": ("application_solution", "process_monitoring"),
    "strategy_or_action_need": ("application_solution", "strategy_coordination"),
    "emotion_or_participation_risk": ("problem_construction", "emotion_coordination"),
    "emotion_or_motivation_risk": ("problem_construction", "emotion_motivation_coordination"),
    "platform_operation_help": ("problem_construction", "strategy_coordination"),
}

RULE_TYPE_LABELS = {
    "evidence_gap": "证据不足",
    "counterargument_missing": "反驳缺失",
    "revision_stall": "修订停滞",
    "responsibility_risk": "责任风险",
}

EMOTION_MOTIVATION_GUIDANCE = """情绪与动机协调：
- 如果小组成员表现出焦虑、烦躁、沉默、冲突、没动力、怕做错或觉得太难，先降低压力，再推进任务。
- 做法是：承认困难 -> 把任务切小 -> 给一个马上能完成的动作 -> 邀请同伴分担。
- 不要说教、不要灌鸡汤、不要把问题归因于成员不努力。
- 对小组冲突，应帮助其回到共同目标、证据和分工，不评判某个成员。
"""
