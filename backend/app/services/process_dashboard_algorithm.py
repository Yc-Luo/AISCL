"""Student-facing process dashboard algorithm.

The algorithm intentionally treats platform actions as trace evidence, not as
direct learning quality scores. Repeated low-level behavior is first collapsed
into bounded process indicators, then mapped to the target constructs used by
the student dashboard.
"""

from __future__ import annotations

from collections import Counter
from datetime import datetime
from html import unescape
from typing import Any, Dict, Iterable, List, Optional, Sequence
import re


ALGORITHM_VERSION = "process_goal_shared_regulation_v2"
WINDOW_DAYS = 14

PROCESS_STAGES = [
    {
        "key": "problem_construction",
        "name": "问题建构",
        "description": "明确问题与任务",
    },
    {
        "key": "meaning_exploration",
        "name": "意义探索",
        "description": "收集资料与理解意义",
    },
    {
        "key": "explanation_integration",
        "name": "解释整合",
        "description": "比较观点并整合解释",
    },
    {
        "key": "application_solution",
        "name": "应用解决",
        "description": "迁移应用与方案提出",
    },
]

PROCESS_STAGE_ALIASES = {
    "orientation": "problem_construction",
    "task_import": "problem_construction",
    "planning": "problem_construction",
    "problem_planning": "problem_construction",
    "问题构建": "problem_construction",
    "问题建构": "problem_construction",
    "inquiry": "meaning_exploration",
    "evidence_exploration": "meaning_exploration",
    "证据探究": "meaning_exploration",
    "意义探索": "meaning_exploration",
    "argumentation": "explanation_integration",
    "论证协商": "explanation_integration",
    "解释整合": "explanation_integration",
    "revision": "application_solution",
    "reflection_revision": "application_solution",
    "summary": "application_solution",
    "reflection": "application_solution",
    "反思修订": "application_solution",
    "应用解决": "application_solution",
}

PROCESS_GOAL_META = {
    "problem_clarity": {
        "name": "问题建构清晰性",
        "strong": "核心问题、对象范围和判断标准已经较清楚。",
        "developing": "已提出问题，但问题边界和判断标准还需要继续明确。",
        "weak": "已有问题线索，但还需要用一句话确认共同问题。",
        "empty": "尚未形成清晰的核心问题表述。",
    },
    "evidence_reliability": {
        "name": "证据判断可靠性",
        "strong": "证据来源、核查和观点支撑关系较充分。",
        "developing": "已有证据与资料，但仍需补充来源核查和适用性说明。",
        "weak": "部分资料来源未核查，证据与观点的匹配度需要提升。",
        "empty": "尚未形成可追踪的证据来源。",
    },
    "viewpoint_comparison": {
        "name": "观点比较合理性",
        "strong": "不同观点已有比较、关联或反驳关系。",
        "developing": "出现了不同观点，但比较依据与分析还不够充分。",
        "weak": "已有观点表达，但缺少对比维度或反方观点。",
        "empty": "尚未形成可比较的观点结构。",
    },
    "explanation_revision": {
        "name": "解释修订开放性",
        "strong": "能够根据反馈和证据修订解释，表现出开放态度。",
        "developing": "已有解释或文档修订，但修订理由仍需说清。",
        "weak": "已有初步解释，但回应反馈和修订痕迹较少。",
        "empty": "尚未形成可修订的解释成果。",
    },
    "transfer_application": {
        "name": "迁移应用适切性",
        "strong": "已开始说明方案适用情境、限制或迁移应用。",
        "developing": "已有应用或成果线索，但适用条件还需补充。",
        "weak": "尚未充分说明结论的适用范围、迁移情境和限制。",
        "empty": "尚未形成迁移应用或方案落地线索。",
    },
}

BOUNDARY_TERMS = ["对象", "范围", "边界", "条件", "标准", "判断标准", "核心问题", "任务要求"]
COMPARISON_TERMS = ["相比", "不同", "优点", "缺点", "局限", "反例", "另一种", "支持", "反对", "适用"]
REVISION_TERMS = ["修改", "修订", "调整", "补充", "根据反馈", "重新", "完善", "更新"]
APPLICATION_TERMS = ["应用", "迁移", "适用", "方案", "实施", "边界", "限制", "情境", "落地"]
REASONING_TERMS = ["因为", "所以", "依据", "证据", "我认为", "但是", "如果", "可能", "为什么", "建议"]
SUPPORT_TERMS = ["可以", "同意", "赞成", "补充", "我来", "谢谢", "有道理", "一起"]
NEGATIVE_TERMS = ["不行", "没用", "算了", "不会", "烦", "错了", "离谱", "别说"]
EXPLANATION_TERMS = [
    "解释",
    "结论",
    "认为",
    "因为",
    "所以",
    "依据",
    "证据",
    "说明",
    "表明",
    "原因",
    "影响",
    "机制",
    "关系",
    "修订",
    "需要",
    "促进",
    "策略",
    "综合",
    "基于",
    "适用",
    "局限",
]
TASK_METADATA_TERMS = [
    "任务标题",
    "发布时间",
    "截止时间",
    "逾期处理",
    "允许截止",
    "任务背景",
    "协作要求",
    "提交成果",
    "评价要点",
    "教师发布",
    "待提交",
]


def build_student_process_dashboard(
    *,
    project: Any,
    events: Sequence[Dict[str, Any]],
    chat_logs: Sequence[Dict[str, Any]],
    docs: Sequence[Dict[str, Any]],
    wiki_items: Sequence[Dict[str, Any]],
    tasks: Sequence[Dict[str, Any]],
    activity_rows: Sequence[Dict[str, Any]],
    resources: Sequence[Dict[str, Any]],
    now: datetime,
) -> Dict[str, Any]:
    """Build the student process dashboard from cleaned process evidence."""

    evidence = _extract_process_evidence(
        project=project,
        events=events,
        chat_logs=chat_logs,
        docs=docs,
        wiki_items=wiki_items,
        tasks=tasks,
        activity_rows=activity_rows,
        resources=resources,
    )
    counts = evidence["counts"]
    current_stage = _infer_process_stage(project, evidence)
    stages = _build_process_stages(current_stage, evidence)
    goals = _build_process_goals(evidence)

    return {
        "dashboardTitle": "小组协作学习状态面板",
        "subtitle": "人智协同学习过程与批判性思维发展分析",
        "updatedAt": now.isoformat(),
        "algorithmVersion": ALGORITHM_VERSION,
        "currentStage": current_stage,
        "stages": stages,
        "stageTip": _stage_tip(current_stage),
        "criticalThinkingGoals": goals,
        "knowledgeStructure": _build_knowledge_structure(project, docs, wiki_items, evidence),
        "nextSuggestion": _build_next_process_suggestion(current_stage, goals, evidence),
        "collaborationTemperature": _build_collaboration_temperature(evidence),
        "metadata": {
            "windowDays": WINDOW_DAYS,
            "memberCount": counts["member_count"],
            "algorithmPrinciple": "平台行为先合并为过程证据，再映射到目标质量；重复点击和单一高频行为不直接提高核心目标得分。",
            "visibleEvidenceCounts": {
                "studentMessages": counts["student_message_count"],
                "activeMembers": counts["active_member_count"],
                "evidenceTotal": counts["evidence_total"],
                "checkedEvidence": counts["checked_evidence"],
                "claimCount": counts["claim_count"],
                "counterCount": counts["counter_count"],
                "revisionEvents": counts["revision_events"],
                "resourceContacts": counts["resource_contact_count"],
                "resourceIntegrated": counts["resource_integration_count"],
            },
        },
    }


def _extract_process_evidence(
    *,
    project: Any,
    events: Sequence[Dict[str, Any]],
    chat_logs: Sequence[Dict[str, Any]],
    docs: Sequence[Dict[str, Any]],
    wiki_items: Sequence[Dict[str, Any]],
    tasks: Sequence[Dict[str, Any]],
    activity_rows: Sequence[Dict[str, Any]],
    resources: Sequence[Dict[str, Any]],
) -> Dict[str, Any]:
    event_counts = Counter(_event_type(event) for event in events if _event_type(event))
    stage_counts: Counter[str] = Counter()
    node_type_counts: Counter[str] = Counter()
    active_member_ids: set[str] = set()
    active_day_tokens: set[str] = set()

    for event in events:
        payload = _payload(event)
        if event.get("actor_type") == "student" and event.get("user_id"):
            active_member_ids.add(str(event.get("user_id")))
        stage = _normalize_process_stage(
            event.get("stage_id") or payload.get("stage_id") or payload.get("current_stage")
        )
        if stage:
            stage_counts[stage] += 1
        node_type = payload.get("node_type") or payload.get("to_type")
        if node_type:
            node_type_counts[str(node_type)] += 1
        day_token = _date_token(event.get("event_time"))
        if day_token:
            active_day_tokens.add(day_token)

    student_chats = [
        chat
        for chat in chat_logs
        if chat.get("message_type") != "ai" and chat.get("user_id")
    ]
    for chat in student_chats:
        active_member_ids.add(str(chat.get("user_id")))
        day_token = _date_token(chat.get("created_at"))
        if day_token:
            active_day_tokens.add(day_token)

    member_count = _member_count(project)
    chat_text = "\n".join(str(chat.get("content") or "") for chat in student_chats)
    document_text = "\n".join(
        f"{doc.get('title') or ''} {doc.get('preview_text') or ''} {_strip_markup(doc.get('content'))[:1200]}"
        for doc in docs
    )
    wiki_text = "\n".join(
        f"{item.get('title') or ''} {item.get('summary') or ''} {item.get('content') or ''}"
        for item in wiki_items
    )
    all_student_text = f"{chat_text}\n{document_text}\n{wiki_text}"

    wiki_type_counts = Counter(str(item.get("item_type")) for item in wiki_items)
    verified_wiki_evidence = sum(
        1
        for item in wiki_items
        if item.get("item_type") == "evidence" and item.get("confidence_level") == "verified"
    )

    question_node_count = _unique_node_count(events, {"question"})
    claim_node_count = _unique_node_count(events, {"claim"})
    evidence_node_count = _unique_node_count(events, {"evidence"})
    counter_node_count = _unique_node_count(events, {"counter-argument", "counter_argument", "challenge"})
    rebuttal_node_count = _unique_node_count(events, {"rebuttal"})
    solution_node_count = _unique_node_count(events, {"solution"})
    idea_node_count = _unique_node_count(events, {"idea", "claim", "question", "solution"})

    source_bind_count = _unique_event_count(
        events,
        {"evidence_source_bind"},
        ["source_id", "resource_id", "url", "node_id", "target_id", "card_id"],
    )
    source_open_count = _unique_event_count(
        events,
        {"evidence_source_open"},
        ["source_id", "resource_id", "url", "node_id", "target_id", "card_id"],
    )
    citation_count = _unique_event_count(
        events,
        {"citation_attached"},
        ["citation_id", "source_id", "resource_id", "wiki_item_id", "document_id"],
    )
    material_to_evidence_count = _unique_event_count(
        events,
        {"card_to_node", "shared_record_extract_to_scrapbook", "wiki_item_quoted"},
        ["card_id", "source_id", "resource_id", "wiki_item_id", "node_id", "target_id"],
    )
    relation_count = _unique_relation_count(events)
    revision_events = _unique_event_count(
        events,
        {
            "node_content_commit",
            "shared_record_content_commit",
            "shared_record_annotation_reply",
            "shared_record_annotation_resolve",
            "wiki_item_updated",
        },
        ["node_id", "document_id", "comment_id", "wiki_item_id", "target_id"],
    )
    feedback_response_count = _unique_event_count(
        events,
        {"shared_record_annotation_reply", "shared_record_annotation_resolve", "rebuttal"},
        ["comment_id", "annotation_id", "node_id", "target_id"],
    )

    resource_contact_count = _unique_activity_count(
        activity_rows,
        modules={"resource", "resources"},
        actions={
            "view",
            "open",
            "download",
            "upload",
            "preview",
            "create",
            "resource_view",
            "resource_download",
            "resource_upload",
        },
    )
    document_commit_count = _unique_event_count(
        events,
        {"shared_record_content_commit", "shared_record_save", "shared_record_create"},
        ["document_id", "target_id"],
    )
    comment_count = _unique_event_count(
        events,
        {
            "shared_record_annotation_create",
            "shared_record_annotation_reply",
            "shared_record_annotation_resolve",
        },
        ["comment_id", "annotation_id", "target_id"],
    )
    scaffold_accepts = _unique_event_count(
        events,
        {"scaffold_rule_recommendation_accept"},
        ["rule_id", "candidate_id", "target_id"],
    )
    snapshot_count = _unique_event_count(events, {"snapshot_save"}, ["snapshot_id", "target_id"])

    evidence_total = max(
        evidence_node_count + wiki_type_counts.get("evidence", 0),
        source_bind_count + wiki_type_counts.get("evidence", 0),
        citation_count,
    )
    checked_evidence = min(evidence_total, source_bind_count + verified_wiki_evidence)
    weak_evidence_contact = min(evidence_total, source_open_count + citation_count)
    resource_integration_count = source_bind_count + material_to_evidence_count + wiki_type_counts.get("evidence", 0)

    claim_count = claim_node_count + wiki_type_counts.get("claim", 0) + wiki_type_counts.get("controversy", 0)
    counter_count = counter_node_count + wiki_type_counts.get("controversy", 0)
    rebuttal_count = rebuttal_node_count
    solution_count = solution_node_count
    completed_tasks = sum(
        1
        for task in tasks
        if task.get("column") == "done" or task.get("submission_status")
    )

    turn_taking_count = _turn_taking_count(student_chats)
    substantial_message_count = sum(
        1 for chat in student_chats if len(str(chat.get("content") or "").strip()) >= 40
    )
    reasoned_message_count = sum(
        1
        for chat in student_chats
        if len(str(chat.get("content") or "").strip()) >= 24
        and _term_hits(str(chat.get("content") or ""), REASONING_TERMS) > 0
    )
    question_signals = len(re.findall(r"[？?]", f"{chat_text}\n{document_text}")) + question_node_count
    boundary_signal_count = _term_hits(all_student_text, BOUNDARY_TERMS)
    comparison_signal_count = _term_hits(all_student_text, COMPARISON_TERMS)
    revision_signal_count = _term_hits(all_student_text, REVISION_TERMS)
    application_signal_count = _term_hits(all_student_text, APPLICATION_TERMS)
    support_hits = _term_hits(chat_text, SUPPORT_TERMS)
    negative_hits = _term_hits(chat_text, NEGATIVE_TERMS)

    active_member_ratio = len(active_member_ids) / max(member_count, 1)
    evidence_check_ratio = checked_evidence / evidence_total if evidence_total else 0.0
    evidence_link_ratio = min(1.0, relation_count / max(evidence_total, 1)) if evidence_total else 0.0
    task_progress_ratio = completed_tasks / max(len(tasks), 1) if tasks else 0.0

    counts = {
        "member_count": member_count,
        "active_member_count": len(active_member_ids),
        "active_day_count": len(active_day_tokens),
        "active_member_ratio_percent": round(active_member_ratio * 100),
        "student_message_count": len(student_chats),
        "turn_taking_count": turn_taking_count,
        "substantial_message_count": substantial_message_count,
        "reasoned_message_count": reasoned_message_count,
        "document_count": len(docs),
        "document_commit_count": document_commit_count,
        "comment_count": comment_count,
        "wiki_count": len(wiki_items),
        "resource_count": len(resources),
        "resource_contact_count": resource_contact_count,
        "resource_integration_count": resource_integration_count,
        "question_signals": question_signals,
        "boundary_signal_count": boundary_signal_count,
        "problem_stage_events": stage_counts["problem_construction"],
        "evidence_total": evidence_total,
        "supporting_evidence": evidence_node_count + wiki_type_counts.get("evidence", 0),
        "checked_evidence": checked_evidence,
        "weak_evidence_contact": weak_evidence_contact,
        "source_bind_count": source_bind_count,
        "source_open_count": source_open_count,
        "citation_count": citation_count,
        "claim_count": claim_count,
        "counter_count": counter_count,
        "rebuttal_count": rebuttal_count,
        "edge_count": relation_count,
        "comparison_signal_count": comparison_signal_count,
        "revision_events": revision_events,
        "feedback_response_count": feedback_response_count,
        "revision_signal_count": revision_signal_count,
        "application_events": stage_counts["application_solution"],
        "solution_count": solution_count,
        "stage_summary_count": wiki_type_counts.get("stage_summary", 0),
        "completed_tasks": completed_tasks,
        "task_count": len(tasks),
        "scaffold_accepts": scaffold_accepts,
        "snapshot_count": snapshot_count,
        "idea_node_count": idea_node_count,
        "application_signal_count": application_signal_count,
        "support_hits": support_hits,
        "negative_hits": negative_hits,
        "evidence_check_ratio_percent": round(evidence_check_ratio * 100),
        "evidence_link_ratio_percent": round(evidence_link_ratio * 100),
        "task_progress_ratio_percent": round(task_progress_ratio * 100),
    }

    return {
        "counts": counts,
        "event_counts": event_counts,
        "stage_counts": stage_counts,
        "node_type_counts": node_type_counts,
        "wiki_type_counts": wiki_type_counts,
        "student_chat_text": chat_text,
        "student_text": all_student_text,
        "ratios": {
            "active_member": active_member_ratio,
            "evidence_check": evidence_check_ratio,
            "evidence_link": evidence_link_ratio,
            "task_progress": task_progress_ratio,
        },
    }


def _build_process_goals(evidence: Dict[str, Any]) -> List[Dict[str, Any]]:
    counts = evidence["counts"]
    ratios = evidence["ratios"]

    problem_features = [
        (_bounded(counts["question_signals"], 3), 0.30),
        (_bounded(counts["boundary_signal_count"], 4), 0.25),
        (_bounded(counts["problem_stage_events"] + counts["document_commit_count"], 3), 0.15),
        (_bounded(counts["reasoned_message_count"], 4), 0.15),
        (min(1.0, ratios["active_member"] + _bounded(counts["turn_taking_count"], 6) * 0.4), 0.15),
    ]
    evidence_features = [
        (_bounded(counts["evidence_total"], 4), 0.20),
        (_bounded(counts["source_bind_count"], 3), 0.25),
        (ratios["evidence_check"], 0.25),
        (ratios["evidence_link"], 0.15),
        (_bounded(counts["resource_integration_count"], 3), 0.15),
    ]
    comparison_features = [
        (_bounded(counts["claim_count"], 3), 0.25),
        (_bounded(counts["counter_count"] + counts["rebuttal_count"], 2), 0.25),
        (_bounded(counts["edge_count"], 4), 0.20),
        (_bounded(counts["comparison_signal_count"] + counts["reasoned_message_count"], 5), 0.20),
        (_bounded(counts["evidence_total"], 3), 0.10),
    ]
    revision_features = [
        (_bounded(counts["document_count"] + counts["stage_summary_count"], 2), 0.20),
        (_bounded(counts["revision_events"], 4), 0.30),
        (_bounded(counts["feedback_response_count"] + counts["comment_count"], 4), 0.20),
        (_bounded(counts["checked_evidence"] + counts["rebuttal_count"], 3), 0.15),
        (_bounded(counts["revision_signal_count"], 3), 0.15),
    ]
    transfer_features = [
        (_bounded(counts["solution_count"] + counts["application_events"], 3), 0.30),
        (ratios["task_progress"], 0.20),
        (_bounded(counts["application_signal_count"], 4), 0.25),
        (_bounded(counts["stage_summary_count"] + counts["snapshot_count"], 2), 0.15),
        (_bounded(counts["reasoned_message_count"], 5), 0.10),
    ]

    scores = {
        "problem_clarity": _score_with_caps(
            _weighted_score(problem_features),
            [
                counts["question_signals"] == 0 and counts["boundary_signal_count"] == 0,
                ratios["active_member"] < 0.34,
            ],
            [35, 65],
        ),
        "evidence_reliability": _score_with_caps(
            _weighted_score(evidence_features),
            [
                counts["evidence_total"] == 0,
                counts["checked_evidence"] == 0,
                counts["resource_contact_count"] > 0 and counts["resource_integration_count"] == 0,
            ],
            [20, 55, 40],
        ),
        "viewpoint_comparison": _score_with_caps(
            _weighted_score(comparison_features),
            [
                counts["claim_count"] == 0,
                counts["claim_count"] < 2 and counts["counter_count"] == 0,
                counts["edge_count"] == 0 and counts["comparison_signal_count"] == 0,
            ],
            [20, 45, 65],
        ),
        "explanation_revision": _score_with_caps(
            _weighted_score(revision_features),
            [
                counts["document_count"] == 0 and counts["stage_summary_count"] == 0,
                counts["revision_events"] == 0,
            ],
            [25, 60],
        ),
        "transfer_application": _score_with_caps(
            _weighted_score(transfer_features),
            [
                counts["solution_count"] == 0 and counts["completed_tasks"] == 0,
                counts["application_signal_count"] == 0,
            ],
            [30, 70],
        ),
    }

    return [
        {
            "key": key,
            "name": PROCESS_GOAL_META[key]["name"],
            "level": _process_level(score),
            "score": score,
            "description": _goal_description(key, score),
        }
        for key, score in scores.items()
    ]


def _infer_process_stage(project: Any, evidence: Dict[str, Any]) -> str:
    configured = None
    experiment_version = getattr(project, "experiment_version", None) if project else None
    if isinstance(experiment_version, dict):
        configured = experiment_version.get("current_stage")
    normalized = _normalize_process_stage(configured)
    if normalized:
        return normalized

    counts = evidence["counts"]
    stage_counts = evidence["stage_counts"]
    if stage_counts:
        return stage_counts.most_common(1)[0][0]
    if counts["application_events"] or counts["completed_tasks"] or counts["solution_count"]:
        return "application_solution"
    if counts["revision_events"] or counts["counter_count"] or counts["rebuttal_count"] or counts["edge_count"]:
        return "explanation_integration"
    if counts["evidence_total"] or counts["resource_integration_count"] or counts["claim_count"]:
        return "meaning_exploration"
    return "problem_construction"


def _build_process_stages(current_stage: str, evidence: Dict[str, Any]) -> List[Dict[str, str]]:
    counts = evidence["counts"]
    stage_counts = evidence["stage_counts"]
    goals_by_key = {goal["key"]: goal for goal in _build_process_goals(evidence)}
    stage_order = [stage["key"] for stage in PROCESS_STAGES]
    current_index = stage_order.index(current_stage)
    stage_quality = {
        "problem_construction": goals_by_key["problem_clarity"]["score"],
        "meaning_exploration": goals_by_key["evidence_reliability"]["score"],
        "explanation_integration": min(
            goals_by_key["viewpoint_comparison"]["score"],
            goals_by_key["explanation_revision"]["score"],
        ),
        "application_solution": goals_by_key["transfer_application"]["score"],
    }
    stage_evidence = {
        "problem_construction": counts["question_signals"] + counts["boundary_signal_count"] + stage_counts["problem_construction"],
        "meaning_exploration": counts["evidence_total"] + counts["resource_integration_count"] + stage_counts["meaning_exploration"],
        "explanation_integration": counts["claim_count"] + counts["counter_count"] + counts["edge_count"] + counts["revision_events"],
        "application_solution": counts["application_events"] + counts["completed_tasks"] + counts["solution_count"],
    }

    stages = []
    for index, stage in enumerate(PROCESS_STAGES):
        key = stage["key"]
        evidence_count = stage_evidence.get(key, 0)
        quality = stage_quality.get(key, 0)
        if key == current_stage:
            status = "in_progress" if quality >= 35 or evidence_count else "needs_more"
        elif index < current_index:
            status = "completed" if quality >= 45 else "needs_more"
        elif evidence_count > 0:
            status = "needs_more"
        else:
            status = "pending"
        stages.append({**stage, "status": status})
    return stages


def _stage_tip(current_stage: str) -> Dict[str, str]:
    tips = {
        "problem_construction": "你们正在明确共同问题，建议先确认任务对象、关键条件和判断标准。",
        "meaning_exploration": "你们已进入“意义探索”阶段，建议继续收集并核查资料，理解信息含义，为后续观点比较与解释整合做准备。",
        "explanation_integration": "你们正在进入“解释整合”阶段，建议比较不同观点的依据、适用条件和局限，形成可辩护的解释。",
        "application_solution": "你们已进入“应用解决”阶段，建议说明方案适用情境、限制条件，并根据反馈修订最终成果。",
    }
    return {"title": "阶段提示", "content": tips.get(current_stage, tips["problem_construction"])}


def _build_knowledge_structure(
    project: Any,
    docs: Sequence[Dict[str, Any]],
    wiki_items: Sequence[Dict[str, Any]],
    evidence: Dict[str, Any],
) -> Dict[str, Any]:
    counts = evidence["counts"]
    text_sources = []
    for doc in docs[:5]:
        text_sources.append(str(doc.get("title") or ""))
        text_sources.append(str(doc.get("preview_text") or ""))
        text_sources.append(_strip_markup(doc.get("content"))[:500])
    for item in wiki_items[:10]:
        text_sources.append(str(item.get("title") or ""))
        text_sources.append(str(item.get("summary") or item.get("content") or "")[:300])

    claim_items = [
        _compact_text(str(item.get("title") or item.get("summary") or item.get("content")), 42)
        for item in wiki_items
        if item.get("item_type") in {"claim", "controversy"}
    ][:3]
    if not claim_items and counts["claim_count"]:
        claim_items = [f"已在论证空间形成 {counts['claim_count']} 个观点节点"]

    explanation_source = _pick_current_explanation(docs, wiki_items)
    explanation_status = "暂缺"
    if explanation_source and counts["revision_events"]:
        explanation_status = f"已形成（已修订 {counts['revision_events']} 次）"
    elif explanation_source:
        explanation_status = "已有草稿"

    unchecked_evidence = max(0, counts["evidence_total"] - counts["checked_evidence"])
    evidence_status = "暂缺"
    if counts["evidence_total"]:
        if counts["checked_evidence"] >= counts["evidence_total"]:
            evidence_status = "已核查"
        elif counts["checked_evidence"]:
            evidence_status = "部分核查"
        else:
            evidence_status = "待核查"

    return {
        "coreQuestion": {
            "label": "核心问题",
            "content": _find_core_question(project, text_sources),
            "status": "已形成（需聚焦）" if counts["question_signals"] else "暂缺",
        },
        "mainViewpoints": {
            "label": "主要观点",
            "content": claim_items or ["尚未形成可比较的主要观点。"],
            "status": f"已形成 {counts['claim_count']} 个观点" if counts["claim_count"] else "暂缺",
        },
        "evidence": {
            "label": "支持/反对证据",
            "content": {
                "supportingEvidence": counts["supporting_evidence"],
                "counterEvidence": counts["counter_count"],
                "uncheckedEvidence": unchecked_evidence,
            },
            "status": evidence_status,
        },
        "currentExplanation": {
            "label": "当前解释",
            "content": explanation_source or "尚未形成可展示的当前解释。",
            "status": explanation_status,
        },
        "transferApplication": {
            "label": "迁移应用",
            "content": (
                "已出现应用解决或成果提交线索，建议继续说明适用情境与限制。"
                if counts["application_events"] or counts["completed_tasks"] or counts["solution_count"]
                else "尚未说明在不同学科或学习情境中的迁移应用方案。"
            ),
            "status": (
                "已有线索"
                if counts["application_events"] or counts["completed_tasks"] or counts["solution_count"]
                else "暂缺"
            ),
        },
    }


def _pick_current_explanation(
    docs: Sequence[Dict[str, Any]],
    wiki_items: Sequence[Dict[str, Any]],
) -> str:
    for item in wiki_items:
        if item.get("item_type") != "stage_summary":
            continue
        candidate = str(item.get("summary") or item.get("content") or "")
        if _looks_like_explanation(candidate):
            return _compact_text(candidate, 90)

    for item in wiki_items:
        if item.get("item_type") not in {"claim", "controversy"}:
            continue
        candidate = str(item.get("summary") or item.get("content") or item.get("title") or "")
        if _looks_like_explanation(candidate):
            return _compact_text(candidate, 90)

    for doc in docs[:3]:
        candidate = str(
            doc.get("preview_text")
            or _strip_markup(doc.get("content"))
            or doc.get("title")
            or ""
        )
        if _looks_like_explanation(candidate):
            return _compact_text(candidate, 90)

    return ""


def _looks_like_explanation(value: Optional[str]) -> bool:
    text = _compact_text(value, 240)
    if len(text) < 16:
        return False
    explanation_hits = _term_hits(text, EXPLANATION_TERMS)
    metadata_hits = _term_hits(text, TASK_METADATA_TERMS)
    if metadata_hits and explanation_hits < 2:
        return False
    return explanation_hits > 0


def _build_next_process_suggestion(
    current_stage: str,
    goals: List[Dict[str, Any]],
    evidence: Dict[str, Any],
) -> Dict[str, Any]:
    counts = evidence["counts"]
    goal_map = {goal["key"]: goal for goal in goals}
    unchecked_evidence = max(0, counts["evidence_total"] - counts["checked_evidence"])

    emotional_risk = (
        counts["active_member_count"] <= 1
        or counts["student_message_count"] < 3
        or counts["negative_hits"] >= counts["support_hits"] + 2
    )
    if emotional_risk and goal_map["problem_clarity"]["score"] >= 35:
        return {
            "regulationType": "情绪协调",
            "currentObservation": "当前互动接续偏少，或讨论中支持性回应不足，可能影响小组持续投入。",
            "suggestedAction": "建议先把任务拆成一个容易回应的小问题，请每位成员补充一个理由、资料线索或需要帮助的地方，再共同确认下一步。",
            "basis": [
                f"近期参与成员 {counts['active_member_count']}/{counts['member_count']} 人",
                f"近期学生消息 {counts['student_message_count']} 条",
                f"支持性表达 {counts['support_hits']} 次，消极表达 {counts['negative_hits']} 次",
            ],
        }

    if goal_map["problem_clarity"]["score"] < 60:
        return {
            "regulationType": "目标调节",
            "currentObservation": "当前核心问题、边界或判断标准还不够清楚，后续资料选择和观点比较容易发散。",
            "suggestedAction": "建议小组先用一句话确认本轮要解决的核心问题，并补充研究对象、关键条件和判断标准。",
            "basis": [
                f"问题线索 {counts['question_signals']} 条",
                f"边界/标准表达 {counts['boundary_signal_count']} 次",
                f"参与成员覆盖 {counts['active_member_ratio_percent']}%",
            ],
        }

    if goal_map["evidence_reliability"]["score"] < 65 and (
        current_stage != "problem_construction" or counts["evidence_total"] > 0
    ):
        return {
            "regulationType": "过程监控",
            "currentObservation": "当前证据核查或证据与观点的连接还不充分，结论可靠性需要继续确认。",
            "suggestedAction": "请小组共同检查每条证据的来源和可信度，标记已核查/待核查，并说明证据如何支持当前观点。",
            "basis": [
                f"证据线索 {counts['evidence_total']} 条",
                f"待核查证据 {unchecked_evidence} 条",
                f"证据核查率 {counts['evidence_check_ratio_percent']}%",
            ],
        }

    if goal_map["viewpoint_comparison"]["score"] < 65 or goal_map["explanation_revision"]["score"] < 60:
        return {
            "regulationType": "策略协同",
            "currentObservation": "当前已有过程材料，但观点比较、解释整合或修订回应还需要组织成共同成果。",
            "suggestedAction": "建议小组合并相似材料，比较不同观点的依据、适用条件和局限，再把讨论结论修订到共享文档或知识沉淀中。",
            "basis": [
                f"观点 {counts['claim_count']} 个，反方/反驳 {counts['counter_count'] + counts['rebuttal_count']} 个",
                f"论证关系 {counts['edge_count']} 条",
                f"修订/反馈回应 {counts['revision_events'] + counts['feedback_response_count']} 次",
            ],
        }

    return {
        "regulationType": "策略协同",
        "currentObservation": "小组已经形成一定过程基础，下一步需要把证据、观点和解释组织成更清晰的共同成果。",
        "suggestedAction": "建议小组分工检查资料、比较观点并修订共享文档，确保结论、证据和适用条件能够相互对应。",
        "basis": [
            f"证据线索 {counts['evidence_total']} 条",
            f"观点节点 {counts['claim_count']} 个",
            f"迁移应用线索 {counts['solution_count'] + counts['completed_tasks']} 条",
        ],
    }


def _build_collaboration_temperature(evidence: Dict[str, Any]) -> Dict[str, Any]:
    counts = evidence["counts"]
    ratios = evidence["ratios"]
    chat_text = evidence["student_chat_text"]

    participation = round(
        min(100, ratios["active_member"] * 65 + _bounded(counts["student_message_count"], 10) * 20 + _bounded(counts["turn_taking_count"], 8) * 15)
    )
    diversity = round(
        min(100, _bounded(counts["claim_count"], 3) * 35 + _bounded(counts["counter_count"], 2) * 25 + _bounded(counts["evidence_total"], 4) * 25 + _bounded(counts["idea_node_count"], 4) * 15)
    )
    interaction_quality = round(
        min(100, _bounded(counts["edge_count"], 4) * 30 + _bounded(counts["comment_count"], 4) * 25 + _bounded(counts["revision_events"], 4) * 25 + _bounded(counts["reasoned_message_count"], 5) * 20)
    )
    if counts["student_message_count"] == 0:
        emotional = 50
    else:
        emotional = round(max(30, min(90, 68 + counts["support_hits"] * 4 - counts["negative_hits"] * 10)))

    score = round(
        participation * 0.30
        + diversity * 0.25
        + interaction_quality * 0.25
        + emotional * 0.20
    )
    tip = "继续积极讨论，及时回应彼此观点，有助于提升学习效果。"
    if counts["student_message_count"] < 3 or ratios["active_member"] < 0.5:
        tip = "可以先邀请每位成员补充一个理由或资料线索，帮助讨论重新接续。"
    elif counts["negative_hits"] > counts["support_hits"] + 1:
        tip = "可以先确认彼此观点中可保留的部分，再讨论需要继续查证的分歧。"

    return {
        "score": score,
        "level": _temperature_label(score),
        "indicators": [
            {"name": "讨论参与度", "value": _qualitative_level(participation)},
            {"name": "观点多样性", "value": _qualitative_level(diversity)},
            {"name": "协作互动质量", "value": _qualitative_level(interaction_quality)},
            {"name": "情绪氛围", "value": _qualitative_level(emotional)},
        ],
        "tip": tip,
    }


def _normalize_process_stage(stage_id: Optional[str]) -> Optional[str]:
    raw = (stage_id or "").strip()
    if not raw:
        return None
    if raw in PROCESS_STAGE_ALIASES:
        return PROCESS_STAGE_ALIASES[raw]
    lowered = raw.lower()
    if lowered in PROCESS_STAGE_ALIASES:
        return PROCESS_STAGE_ALIASES[lowered]
    valid_keys = {stage["key"] for stage in PROCESS_STAGES}
    return raw if raw in valid_keys else None


def _member_count(project: Any) -> int:
    member_ids: set[str] = set()
    for member in (getattr(project, "members", None) or []):
        member_id = member.get("user_id") if isinstance(member, dict) else getattr(member, "user_id", None)
        if member_id:
            member_ids.add(str(member_id))
    owner_id = getattr(project, "owner_id", None)
    if owner_id:
        member_ids.add(str(owner_id))
    return max(1, len(member_ids))


def _event_type(event: Dict[str, Any]) -> str:
    return str(event.get("event_type") or "")


def _payload(event: Dict[str, Any]) -> Dict[str, Any]:
    payload = event.get("payload") or {}
    return payload if isinstance(payload, dict) else {}


def _date_token(value: Any) -> Optional[str]:
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, str) and len(value) >= 10:
        return value[:10]
    return None


def _first_payload_value(payload: Dict[str, Any], keys: Iterable[str]) -> Optional[str]:
    for key in keys:
        value = payload.get(key)
        if value not in (None, ""):
            return str(value)
    return None


def _event_identity(event: Dict[str, Any], keys: Iterable[str]) -> str:
    payload = _payload(event)
    identity = _first_payload_value(payload, keys)
    if identity:
        return identity
    for key in ("_id", "id"):
        if event.get(key) is not None:
            return str(event.get(key))
    return f"{_event_type(event)}:{event.get('event_time')}:{hash(str(payload))}"


def _unique_event_count(
    events: Sequence[Dict[str, Any]],
    event_types: set[str],
    identity_keys: Sequence[str],
) -> int:
    seen: set[str] = set()
    for event in events:
        if _event_type(event) not in event_types:
            continue
        seen.add(f"{_event_type(event)}:{_event_identity(event, identity_keys)}")
    return len(seen)


def _unique_node_count(events: Sequence[Dict[str, Any]], node_types: set[str]) -> int:
    seen: set[str] = set()
    for event in events:
        if _event_type(event) not in {"node_add", "node_type_update", "card_to_node"}:
            continue
        payload = _payload(event)
        node_type = str(payload.get("node_type") or payload.get("to_type") or "")
        if node_type not in node_types:
            continue
        seen.add(_event_identity(event, ["node_id", "target_id", "id", "card_id"]))
    return len(seen)


def _unique_relation_count(events: Sequence[Dict[str, Any]]) -> int:
    seen: set[str] = set()
    for event in events:
        if _event_type(event) not in {"edge_add", "edge_relation_toggle"}:
            continue
        payload = _payload(event)
        edge_id = _first_payload_value(payload, ["edge_id", "id", "target_id"])
        if not edge_id:
            source = _first_payload_value(payload, ["source_id", "source", "from_node_id"])
            target = _first_payload_value(payload, ["target_id", "target", "to_node_id"])
            edge_id = f"{source}:{target}" if source or target else _event_identity(event, [])
        seen.add(edge_id)
    return len(seen)


def _unique_activity_count(
    activity_rows: Sequence[Dict[str, Any]],
    *,
    modules: set[str],
    actions: set[str],
) -> int:
    seen: set[str] = set()
    for row in activity_rows:
        module = str(row.get("module") or "")
        action = str(row.get("action") or "")
        if module not in modules or action not in actions:
            continue
        metadata = row.get("metadata") or {}
        target = (
            row.get("target_id")
            or metadata.get("resource_id")
            or metadata.get("resourceId")
            or metadata.get("file_key")
            or metadata.get("filename")
        )
        seen.add(str(target or f"{module}:{action}:{row.get('timestamp')}"))
    return len(seen)


def _turn_taking_count(student_chats: Sequence[Dict[str, Any]]) -> int:
    previous_user = None
    transitions = 0
    for chat in student_chats:
        current_user = chat.get("user_id")
        if previous_user and current_user and current_user != previous_user:
            transitions += 1
        if current_user:
            previous_user = current_user
    return transitions


def _strip_markup(value: Optional[str]) -> str:
    if not value:
        return ""
    text = re.sub(r"<[^>]+>", " ", value)
    text = unescape(text)
    return re.sub(r"\s+", " ", text).strip()


def _compact_text(value: Optional[str], max_length: int = 90) -> str:
    text = re.sub(r"\s+", " ", value or "").strip()
    if len(text) <= max_length:
        return text
    return f"{text[:max_length].rstrip()}..."


def _term_hits(text: str, terms: Sequence[str]) -> int:
    return sum(text.count(term) for term in terms)


def _bounded(value: float, threshold: float) -> float:
    if threshold <= 0:
        return 0.0
    return max(0.0, min(1.0, value / threshold))


def _weighted_score(features: Sequence[tuple[float, float]]) -> int:
    total_weight = sum(weight for _, weight in features) or 1.0
    score = sum(max(0.0, min(1.0, value)) * weight for value, weight in features)
    return int(round((score / total_weight) * 100))


def _score_with_caps(base_score: int, conditions: Sequence[bool], caps: Sequence[int]) -> int:
    score = base_score
    for condition, cap in zip(conditions, caps):
        if condition:
            score = min(score, cap)
    return max(0, min(100, int(score)))


def _process_level(score: int) -> str:
    if score >= 75:
        return "良好"
    if score >= 45:
        return "发展中"
    if score >= 20:
        return "需加强"
    return "待开始"


def _goal_description(key: str, score: int) -> str:
    meta = PROCESS_GOAL_META[key]
    if score >= 75:
        return meta["strong"]
    if score >= 45:
        return meta["developing"]
    if score >= 20:
        return meta["weak"]
    return meta["empty"]


def _find_core_question(project: Any, text_sources: List[str]) -> str:
    joined = "。".join(source for source in text_sources if source)
    match = re.search(r"[^。！？!?]{4,80}[？?]", joined)
    if match:
        return _compact_text(match.group(0), 80)
    description = getattr(project, "description", None)
    if description:
        return _compact_text(str(description), 80)
    return "尚未形成清晰的核心问题。"


def _temperature_label(score: int) -> str:
    if score >= 80:
        return "较高"
    if score >= 65:
        return "中等偏上"
    if score >= 45:
        return "中等"
    return "需关注"


def _qualitative_level(score: int) -> str:
    if score >= 75:
        return "良好"
    if score >= 55:
        return "中等"
    if score >= 35:
        return "需加强"
    return "暂弱"
