"""Seed G1 thesis proposal collaboration simulation data and export a package.

Run from the backend directory with a reachable local MongoDB:

  MONGODB_URI=mongodb://localhost:27017/AISCL \
  MONGODB_DB_NAME=AISCL \
  poetry run python scripts/seed_g1_thesis_proposal_simulation.py --reset --export

The seeded group uses S01-S05 learner accounts and simulates a natural online
collaboration process around thesis proposal design.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any


os.environ.setdefault("MONGODB_URI", "mongodb://localhost:27017/AISCL")
os.environ.setdefault("MONGODB_DB_NAME", "AISCL")

from app.api.v1.admin_data import _collect_course_research_package, _write_course_research_zip
from app.core.db.mongodb import mongodb
from app.repositories.activity_log import ActivityLog
from app.repositories.ai_conversation import AIConversation
from app.repositories.ai_message import AIMessage
from app.repositories.chat_log import ChatLog
from app.repositories.course import Course
from app.repositories.course_task_release import CourseTaskRelease
from app.repositories.document import Document
from app.repositories.project import Project
from app.repositories.research_event import ResearchEvent
from app.repositories.resource import Resource
from app.repositories.task import Task
from app.repositories.user import User
from app.repositories.wiki_item import WikiItem
from app.services.auth_service import get_password_hash


SIM_INVITE_CODE = "SIM-G1-THESIS"
SIM_COURSE_NAME = "第一轮平台协作模拟-G1"
SIM_PROJECT_CODE = "G1"
SIM_PROJECT_NAME = "G1-学位论文开题设计协作"
SIM_PASSWORD = "Test123456"
SIM_EXPORT_NAME = "g1_thesis_proposal_research_package.zip"

STAGES = [
    ("problem_construction", 0),
    ("meaning_exploration", 1),
    ("explanation_integration", 2),
    ("application_solution", 3),
]


@dataclass(frozen=True)
class LearnerProfile:
    code: str
    topic: str
    tendency: str


LEARNERS = [
    LearnerProfile("S01", "AI 支持项目式学习中的教师支架研究", "组织推进型，习惯先拆任务和确定提交物"),
    LearnerProfile("S02", "生成式 AI 支持课程教学设计的路径研究", "资料检索型，喜欢先找案例和文献"),
    LearnerProfile("S03", "AI 反馈对学生项目成果质量的影响", "批判追问型，关注变量、证据和因果解释"),
    LearnerProfile("S04", "AI 工具支持跨学科项目学习的协作机制", "表达整合型，愿意整理共享文档"),
    LearnerProfile("S05", "AI 支持课堂任务设计与学习投入的关系", "低频参与型，前期犹豫，后期补充细节"),
]


DIALOGUE_SCRIPT = [
    ("S01", "我先建个开题讨论的框架吧。我们是不是每个人先把自己的题目说清楚，再互相问问题？"),
    ("S02", "可以。我这边想做生成式 AI 支持课程教学设计的路径研究，但现在还没想好是看教师备课还是课堂实施。"),
    ("S03", "我想看 AI 反馈对项目成果质量的影响。问题是成果质量怎么评价，我还没找到特别合适的指标。"),
    ("S04", "我的是 AI 工具支持跨学科项目学习的协作机制。感觉题目有点大，可能要收一收。"),
    ("S05", "我先说个不成熟的，我想看 AI 支持课堂任务设计和学习投入的关系，但我不确定学习投入怎么测。"),
    ("S01", "我的方向是 AI 支持项目式学习中的教师支架研究。现在也卡在教师支架具体分哪些类型。"),
    ("S04", "我开了一个共享文档，先放每个人的题目、关键词和最卡的问题。大家先往里面补。"),
    ("S02", "我先把刚才几个人的题目复制进去，后面再慢慢改。"),
    ("S03", "先提醒一下，我们不要只写 AI 很有用，最好每个人都说清楚研究对象和研究情境。"),
    ("S01", "对。今天先完成问题构建，至少每个人有一个比较具体的研究问题。"),
    ("S05", "那我的可以写成：AI 支持的课堂任务设计如何影响学生学习投入？这样算具体吗？"),
    ("S03", "还差一点。是什么课堂、什么学生、什么任务？学习投入是行为投入、情感投入还是认知投入？"),
    ("S05", "嗯，那我先限定到初中综合实践活动里的项目任务，学习投入先考虑行为和认知两个维度。"),
    ("S04", "这个比刚才清楚多了。我帮你记到文档里。"),
    ("S02", "我找到一篇关于 AI 辅助教学设计流程的综述，等下上传。里面有分析、设计、实施、评价几个环节。"),
    ("S01", "我也想把教师支架分成任务支架、资源支架、过程支架、评价支架，不知道会不会太经验化。"),
    ("S03", "可以，但要找理论依据。比如项目式学习里教师支架有哪些经典分类，不然就是自己拍脑袋。"),
    ("S02", "我先去搜 PBL teacher scaffolding。中文也找一下项目式学习教师支架。"),
    ("S04", "我这边的问题是跨学科协作机制太虚。机制是不是要落到沟通、分工、知识整合这些行为？"),
    ("S01", "我觉得可以。你可以问：AI 工具如何影响跨学科项目小组的分工协商和知识整合？"),
    ("S04", "这个方向好一点，我先改成这个。"),
    ("ai_assistant", "大家目前已经提出 5 个方向。下一步建议每个人补一句“研究对象 + 关键变量/概念 + 可能证据”，这样题目会更容易继续修改。"),
    ("S03", "AI 提醒这个有用。我们可以按这个格式来。"),
    ("S01", "那我先来：研究对象是参加项目式学习的中学生，关键概念是教师支架，证据可能来自课堂观察和访谈。"),
    ("S02", "我的是一线教师的课程教学设计过程，关键概念是生成式 AI 支持路径，证据可能是设计文本和访谈。"),
    ("S03", "我的是学生项目成果，关键变量是 AI 反馈类型和成果质量，证据是作品评分和修订记录。"),
    ("S04", "我的是跨学科项目学习小组，关键概念是协作机制，证据是聊天记录、共享文档和成果变化。"),
    ("S05", "我的是综合实践活动中的课堂任务，关键变量是 AI 支持任务设计和学习投入，证据可能是问卷和学生任务完成情况。"),
    ("S03", "S02 的路径研究可能容易写成经验总结。你要不要考虑做成设计型研究，产出一个流程模型？"),
    ("S02", "对，我也担心太散。设计型研究是不是要有迭代？"),
    ("S01", "可以设成两轮：先分析教师用 AI 备课的痛点，再形成支持路径，最后让教师试用并反馈。"),
    ("S04", "我把 S02 的建议写到问题清单里了。"),
    ("S02", "我上传了综述摘要，大家有空帮我看一下有没有理论基础可以借。"),
    ("S05", "我看了一下，里面的 ADDIE 模型可能能用在教学设计路径里。"),
    ("S02", "谢谢，我之前忽略了这个。"),
    ("S03", "但 ADDIE 是教学设计模型，不一定能解释 AI 怎么支持。可以作为流程框架，不要直接当理论。"),
    ("S01", "S03 这个提醒好。我们文档里加一列：理论基础和方法框架分开写。"),
    ("S04", "已加。"),
    ("S01", "进入意义探索吧。每个人至少补两条文献线索或者理论依据。"),
    ("S02", "我先补：TPACK、ADDIE、教师 AI 素养。感觉我这个题可能跟教师专业发展也有关系。"),
    ("S03", "我这边可能用形成性反馈、反馈素养、项目成果评价量规。"),
    ("S05", "学习投入我查到 Fredricks 的三维投入，行为、情感、认知。"),
    ("S04", "跨学科协作我查到知识整合、协作脚本、共同调节学习。"),
    ("S01", "教师支架我先放 Wood 的 scaffolding，还有 PBL 里的过程支架。"),
    ("S03", "我们现在有点像堆理论。每个人要说明理论解决什么问题。"),
    ("S04", "我同意。比如我用共同调节学习，是为了解释小组怎么协商和调整策略。"),
    ("S02", "那 TPACK 是解释教师在技术、教学法、内容之间怎么整合？"),
    ("S03", "对，但你要写清楚生成式 AI 是技术工具，不是单独替代教师判断。"),
    ("S05", "我有点担心学习投入问卷是不是太常规，和 AI 任务设计的关系不好说。"),
    ("S01", "可以把任务设计质量作为中间环节？AI 支持教师设计更清楚的任务，学生投入可能提高。"),
    ("S03", "但这样就变成教师端和学生端都要测，工作量变大。"),
    ("S05", "那我先做小一点，只看 AI 支持的任务特征和学生投入感受，不做强因果。"),
    ("ai_assistant", "如果担心题目过大，可以把“影响”改成“关系”或“作用路径初探”，并明确数据来源。这样开题阶段会更稳。"),
    ("S05", "那我把题目改成 AI 支持课堂任务设计与学生学习投入关系研究。"),
    ("S03", "可以，比影响更谨慎。"),
    ("S04", "我这边是不是也别写机制研究，改成协作过程研究？机制太大。"),
    ("S01", "可以先写协作过程及支持策略研究，后面再看能不能提炼机制。"),
    ("S04", "我改成 AI 工具支持跨学科项目学习协作过程的研究。"),
    ("S02", "我发现我们几个题都要用平台数据，比如聊天、文档、资源。可以把方法上互相借鉴。"),
    ("S03", "是的，但每个人分析单位不一样。S04 是小组过程，S03 我是作品修订，S01 是教师支架。"),
    ("S01", "我整理一下方法：访谈、问卷、文本分析、作品评价、过程数据。大家按自己题目选，不要全都写。"),
    ("S05", "我可能用问卷加访谈，再看任务完成记录。"),
    ("S03", "S05 记得学习投入问卷要有来源，不要自己随便写。"),
    ("S05", "收到，我去找成熟量表。"),
    ("S02", "我把一个开题报告模板也传上来了，里面有研究问题、研究内容、方法和创新点。"),
    ("S04", "我在共享文档二里建了修改清单：题目是否过大、变量是否清楚、理论是否对应、方法是否能回答问题。"),
    ("S01", "很好。大家按这个清单互相检查。"),
    ("S03", "我先检查 S01。你的教师支架研究，AI 支持的是教师支架，还是 AI 本身作为支架？这个要分清。"),
    ("S01", "我想的是 AI 辅助教师提供支架，不是 AI 直接替代教师。"),
    ("S03", "那题目可以写“生成式 AI 辅助教师支架设计”更准确。"),
    ("S01", "有道理。我改成生成式 AI 辅助项目式学习教师支架设计研究。"),
    ("S02", "S03 你的 AI 反馈类型怎么分？自动评分、修改建议、追问式反馈是不是不一样？"),
    ("S03", "我初步分成评价性反馈、建议性反馈、追问式反馈。重点看学生采纳后作品质量变化。"),
    ("S04", "这个很清楚，而且能看修订痕迹。"),
    ("S05", "那是不是要有前后作品对比？"),
    ("S03", "对，所以方法可能是准实验或者设计型干预，但开题先写混合方法比较稳。"),
    ("ai_assistant", "现在讨论进入方法整合阶段。建议每位成员用一句话检查：我的数据能不能直接回答我的研究问题？如果不能，需要缩小问题或更换数据。"),
    ("S01", "我的数据：教师访谈、支架方案、课堂观察，能回答教师怎么设计和使用支架。"),
    ("S02", "我的数据：教师教学设计文本、访谈、AI 使用记录，能回答支持路径，但可能需要一个案例学校。"),
    ("S03", "我的数据：学生作品初稿终稿、AI 反馈记录、评价量规，基本能回答成果质量变化。"),
    ("S04", "我的数据：小组聊天、共享文档版本、访谈，能回答协作过程，但机制只能初步解释。"),
    ("S05", "我的数据：任务设计文本、学生问卷、访谈和完成记录，能回答关系，但不适合说因果影响。"),
    ("S03", "这轮之后每个人的表述都稳了一些。"),
    ("S04", "我把每个人的修订前后题目做成表格了，方便最后报告写共性问题。"),
    ("S02", "共性问题我看到三个：题目太大、理论堆叠、方法和问题不对应。"),
    ("S01", "再加一个：AI 角色没说清，是工具、支架还是反馈来源。"),
    ("S05", "还有证据来源容易说虚话。比如只说访谈不说访谈谁。"),
    ("S03", "很好，这些可以写进小组优化报告。"),
    ("S01", "应用解决阶段，我们今天把个人开题构想卡定稿。明天上午交小组共识总结。"),
    ("S04", "我可以负责整理小组共识总结，但每个人要把自己的最终题目和方法发我。"),
    ("S02", "我的最终题目：生成式 AI 支持教师课程教学设计的路径研究。方法：案例研究加设计型研究。"),
    ("S03", "我的：AI 追问式反馈对学生项目成果修订质量的支持研究。方法：作品评价、修订记录分析、访谈。"),
    ("S01", "我的：生成式 AI 辅助项目式学习教师支架设计研究。方法：设计型研究、课堂观察、教师访谈。"),
    ("S05", "我的：AI 支持课堂任务设计与学生学习投入关系研究。方法：问卷、访谈、任务完成记录分析。"),
    ("S04", "我的：AI 工具支持跨学科项目学习协作过程的研究。方法：过程数据分析、文档版本分析、访谈。"),
    ("S03", "S03 这个我自己再改一下，题目里“支持研究”有点怪，改成“作用研究”也不准确。"),
    ("S01", "可以写“AI 追问式反馈支持学生项目成果修订的过程研究”。"),
    ("S03", "这个更稳，我用这个。"),
    ("ai_assistant", "提交前可以重点核查三项：题目是否缩小到可研究范围；研究问题、理论和方法是否一一对应；小组共识是否说明建议来自哪些讨论证据。"),
    ("S04", "我按这个核查。"),
    ("S02", "我补了文献清单，里面标了每篇可能对应哪个题目。"),
    ("S05", "我把学习投入量表来源也加进资源说明了。"),
    ("S03", "我看了共识总结，建议把“不要写 AI 很有用”改成“避免价值判断先行，要转化为可观察变量”。"),
    ("S04", "已改，这句话更像开题建议。"),
    ("S01", "我提交前最后确认：每个人的构想卡都放进共享文档一了吗？"),
    ("S02", "放了。"),
    ("S03", "我放了最新版。"),
    ("S04", "共识总结也完成了。"),
    ("S05", "我的也补完了，谢谢大家前面帮我收题目。"),
    ("S01", "那我作为组长提交任务。"),
]


RESOURCE_SPECS = [
    ("开题报告结构模板.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "template"),
    ("项目式学习教师支架参考文献.pdf", "application/pdf", "literature"),
    ("生成式AI教学设计路径案例.pdf", "application/pdf", "case"),
    ("学习投入量表参考.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "instrument"),
    ("项目成果评价量规示例.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "rubric"),
    ("跨学科协作过程分析编码表.csv", "text/csv", "coding_scheme"),
    ("AI反馈与作品修订记录示例.txt", "text/plain", "example"),
]

MESSY_REALISTIC_TURNS = [
    ("problem_construction", "S01", "大家能看见吗，我刚进来"),
    ("problem_construction", "S05", "能"),
    ("problem_construction", "S02", "我刚才那个文档是不是没传上去"),
    ("problem_construction", "S03", "先别急，我们先把题目边界定下来，不然传什么资料都散"),
    ("meaning_exploration", "S02", "@资料研究员 "),
    ("meaning_exploration", "ai_assistant", "AISCL智能助手暂时没有成功生成回应。请稍后重试，或先把当前问题、已有依据和下一步分工写在群聊中。"),
    ("meaning_exploration", "S02", "它刚才没回，我再问一次，主要是想找教师AI素养的资料"),
    ("meaning_exploration", "S03", "@AISCL智能助手 你说的资料方向太泛了，能不能具体到开题里怎么用"),
    ("meaning_exploration", "ai_assistant", "可以先围绕研究问题、理论依据和方法路径进行整理。建议你们把相关资料放到共享文档中，并注明来源。"),
    ("meaning_exploration", "S03", "这个还是有点泛，先不用管它，我自己按反馈类型去找"),
    ("meaning_exploration", "S04", "我把资料清单先建好了，大家不要都堆在一个段落里"),
    ("explanation_integration", "S05", "我有点跟不上，你们说的变量和维度是不是一个意思"),
    ("explanation_integration", "S03", "不完全一样。变量是研究里要看的东西，维度是把一个概念拆开看"),
    ("explanation_integration", "S01", "这个解释可以放进文档，后面教师看也能知道我们怎么澄清概念的"),
    ("explanation_integration", "S04", "@AISCL智能助手 帮我把大家的建议总结一下"),
    ("explanation_integration", "ai_assistant", "你们可以从研究问题、资料证据、方法设计和成果表达四个方面进行总结，并在最后形成一份小组报告。"),
    ("explanation_integration", "S04", "它这次总结也比较模板化，我还是按我们刚才说的核心修订、证据补充、表达润色来分"),
    ("application_solution", "S04", "我最后整理的时候发现有些建议重复，我会合并"),
    ("application_solution", "S02", "收到"),
    ("application_solution", "S05", "我晚点补我的量表来源"),
    ("application_solution", "S01", "别太晚，明早我就提交"),
    ("application_solution", "S05", "@AISCL智能助手 我这个题目还有没有问题"),
    ("application_solution", "ai_assistant", "AISCL智能助手暂时没有成功生成回应。请稍后重试，或先把当前问题、已有依据和下一步分工写在群聊中。"),
    ("application_solution", "S05", "算了我先按你们刚才说的两个研究问题写"),
]

AGENT_PROFILES = {
    "problem_progressor": {
        "name": "问题推进者",
        "user_id": "auto_prompt:problem_progressor",
    },
    "evidence_researcher": {
        "name": "资料研究员",
        "user_id": "auto_prompt:evidence_researcher",
    },
    "viewpoint_challenger": {
        "name": "观点挑战者",
        "user_id": "auto_prompt:viewpoint_challenger",
    },
    "feedback_prompter": {
        "name": "反馈追问者",
        "user_id": "auto_prompt:feedback_prompter",
    },
}

AGENT_EXCHANGES = [
    (
        "problem_construction",
        "S05",
        "@问题推进者 帮我们检查一下，现在每个人的题目是不是和开题任务混在一起了？",
        "problem_progressor",
        "先把“学习任务”和“研究题目”分开：本次任务是完善开题设计；每个人的研究题目才是具体对象。建议你们用三列重写：研究对象、核心问题、可收集证据。现在 S01 和 S04 已经有对象，但 S02、S05 还需要再限定情境。",
        "S01",
        "这个区分清楚了。我们先按三列改，不急着写完整开题。",
    ),
    (
        "problem_construction",
        "S01",
        "@问题推进者 我们现在五个题目都和 AI 有关，但感觉范围还是散，能不能帮我们压成一个讨论顺序？",
        "problem_progressor",
        "可以按“先边界、再变量、再证据”的顺序推进。第一轮只处理题目边界：每个人说清研究对象和成果形式；第二轮再处理变量或核心概念；第三轮再看数据能不能支持。不要一开始就讨论创新点，否则很容易空转。",
        "S04",
        "那我先把共享文档改成这三个区块，大家不要直接往创新点那里写。",
    ),
    (
        "problem_construction",
        "S03",
        "@观点挑战者 我觉得我们现在都在默认 AI 是有帮助的，这是不是问题？",
        "viewpoint_challenger",
        "这是一个明显风险。开题里不能预设“AI 一定有帮助”，而要把它改成可检验的问题。比如不要写“AI 提高学习投入”，而写“AI 支持的任务设计与学习投入之间呈现怎样的关系”。你们可以在文档里专门加一列“避免预设结论”。",
        "S05",
        "这个提醒对我有用，我原来题目里的“影响”确实太满。",
    ),
    (
        "problem_construction",
        "S02",
        "@反馈追问者 我想让大家帮我看题目，但我不知道要问大家什么。",
        "feedback_prompter",
        "你可以把求助问题说得更具体：请大家判断我的研究对象是否明确、理论是否能解释问题、方法是否能收集到证据。比起问“题目好不好”，这种问题更容易得到有用反馈。",
        "S02",
        "明白，我后面不问泛泛的好不好了，我就让大家帮我看对象、理论、方法这三块。",
    ),
    (
        "meaning_exploration",
        "S02",
        "@资料研究员 我现在找了 TPACK 和 ADDIE，但不知道能不能都放进理论基础。",
        "evidence_researcher",
        "可以都作为线索，但用途不同。TPACK 更适合解释教师如何整合技术、教学法和内容；ADDIE 更像教学设计流程框架。建议你不要把它们并列堆砌，而是写成：TPACK 解释教师能力结构，ADDIE 帮助组织设计过程。",
        "S03",
        "这个回应能避免理论堆叠。S02 可以把 TPACK 放理论，ADDIE 放过程模型。",
    ),
    (
        "meaning_exploration",
        "S02",
        "@资料研究员 你再帮我列一下关于“教师 AI 素养”和“AI 支持教学设计”的检索词，我想补文献。",
        "evidence_researcher",
        "可以分两组检索。中文：教师人工智能素养、生成式 AI 教学设计、AI 辅助备课、智能技术支持课程设计。英文：teacher AI literacy、generative AI instructional design、AI-assisted lesson planning、teacher-AI collaboration、TPACK generative AI。检索后建议按“概念界定、应用场景、评价方法”三类整理。",
        "S02",
        "我先按这三类整理，不然资料太多会乱。",
    ),
    (
        "meaning_exploration",
        "S01",
        "@资料研究员 项目式学习里的教师支架有没有比较稳的分类？我不想自己硬分。",
        "evidence_researcher",
        "可以从两条线找依据：一是经典 scaffolding，关注诊断、提示、反馈、逐步撤离；二是 PBL 场景下的支架，常见于问题情境、资源获取、过程监控、成果评价。你的分类可以写成“基于文献整理的分析维度”，不要写成最终理论模型。",
        "S01",
        "“分析维度”这个说法更稳，我不把它写成模型了。",
    ),
    (
        "meaning_exploration",
        "S05",
        "@资料研究员 学习投入量表应该怎么找？我怕随便找一个不适合。",
        "evidence_researcher",
        "建议优先找有明确维度和信效度说明的成熟量表。关键词可以用：学习投入量表、学生投入、behavioral engagement、cognitive engagement、Fredricks engagement。你还要判断量表对象是否接近你的研究对象，不能只因为题名相似就直接使用。",
        "S03",
        "S05 这个要记下来，量表对象不匹配会影响开题可信度。",
    ),
    (
        "meaning_exploration",
        "S04",
        "@观点挑战者 我把跨学科协作写成知识整合，会不会太抽象？",
        "viewpoint_challenger",
        "会有抽象风险。你需要把知识整合落到可观察行为，例如成员解释本学科概念、引用资料支持观点、把不同观点写进共享文档、修改共同方案。否则“机制”只是一个大词。",
        "S04",
        "那我后面就从聊天和文档修订里找这些行为，不只写概念。",
    ),
    (
        "explanation_integration",
        "S03",
        "@观点挑战者 我想写 AI 反馈提升项目成果质量，但担心因果说得太满。",
        "viewpoint_challenger",
        "你的风险是把“AI 反馈出现”和“成果质量提高”直接连起来。至少有三个替代解释：学生本来能力差异、同伴建议影响、教师评价标准引导。建议把题目改成“AI 追问式反馈支持项目成果修订的过程研究”，重点看修订链条，而不是直接证明提升。",
        "S03",
        "我接受这个改法。这样我可以看初稿、反馈、修订稿之间的证据链。",
    ),
    (
        "explanation_integration",
        "S03",
        "@观点挑战者 如果我只看 AI 追问式反馈，会不会样本太窄？",
        "viewpoint_challenger",
        "样本窄不一定是问题，关键是你的问题也要相应收窄。你可以把研究目标写成解释“追问式反馈如何支持学生发现论证缺口”，而不是评价所有 AI 反馈的总体效果。窄问题反而更容易收集细证据。",
        "S03",
        "那我不再比较所有反馈类型，重点放追问式反馈和修订链条。",
    ),
    (
        "explanation_integration",
        "S02",
        "@问题推进者 我们现在理论和方法都很多，怎么判断开题是不是已经成形？",
        "problem_progressor",
        "可以用四个检查句：我研究谁；我研究什么变化或过程；我用什么数据看见它；我的理论解释哪个环节。四句话能连起来，开题雏形就基本成立。连不起来的部分先删掉或降级为背景。",
        "S01",
        "这个可以作为我们的最终自查标准。",
    ),
    (
        "explanation_integration",
        "S04",
        "@反馈追问者 我整理共识时发现大家建议很多，但不太知道哪些算关键建议。",
        "feedback_prompter",
        "关键建议通常满足两点：一是让题目边界变清楚，二是让方法更能回答问题。比如“把影响改成关系”是关键建议，“多看几篇文献”只是一般建议。你可以按修订强度分为核心修订、证据补充、表达润色三类。",
        "S04",
        "我按核心修订、证据补充、表达润色三类整理。",
    ),
    (
        "explanation_integration",
        "S05",
        "@反馈追问者 我修改题目以后还是怕说不清楚研究问题。",
        "feedback_prompter",
        "你可以把研究问题写成两个层次：第一，AI 支持的课堂任务设计呈现出哪些特征；第二，这些任务特征与学生行为/认知投入表现有什么关系。这样比一个大问题更容易展开。",
        "S05",
        "我就按两个问题写，不再只写一个大问题。",
    ),
    (
        "application_solution",
        "S01",
        "@问题推进者 我们快提交了，你帮我们看最后还应该补什么动作？",
        "problem_progressor",
        "提交前建议完成三个动作：每人确认最终题目和研究问题；共享文档保留一次“修订前后对照”；小组共识总结写清共同问题和采纳过的建议。这样教师端和导出数据里都能看到协作过程，而不是只看到最终答案。",
        "S01",
        "我来催大家把修订前后题目都补齐。",
    ),
    (
        "application_solution",
        "S04",
        "@反馈追问者 你帮我看一下小组共识总结还缺什么？",
        "feedback_prompter",
        "目前总结已经有建议，但还缺“建议来自哪里”。可以给每条建议补一个来源：来自题目修改、理论讨论、方法检查或资料上传。这样共识总结就不是泛泛建议，而是能回到小组协作证据。",
        "S04",
        "收到，我在总结里加一列“来自哪类讨论证据”。",
    ),
    (
        "application_solution",
        "S03",
        "@观点挑战者 最终总结里写“AI 能促进开题质量提升”可以吗？",
        "viewpoint_challenger",
        "不建议这样写。你们现在的数据更适合说明“AI 支架帮助小组发现题目边界、理论堆叠和方法对应问题”，还不能直接证明质量提升。可以写“为开题设计修订提供了过程性支持”。",
        "S02",
        "这个表述更严谨，我们不要把结论写大。",
    ),
    (
        "application_solution",
        "S04",
        "@反馈追问者 我最后想把每个人采纳了哪些建议写进去，有没有简洁格式？",
        "feedback_prompter",
        "可以用“原表述-同伴/AI建议-修订后表述-证据来源”四列。每个人保留两条最关键修订即可，不需要把所有聊天都搬进去。",
        "S04",
        "好，我给每个人保留两条关键修订，避免总结太长。",
    ),
    (
        "application_solution",
        "S02",
        "@资料研究员 最后文献清单要不要每个人都放很多？",
        "evidence_researcher",
        "不需要追求数量。每个人保留 3 类资料即可：一个核心理论来源，一个方法或量表来源，一个与 AI 应用场景相关的实证或案例来源。关键是说明每条资料在开题中承担什么作用。",
        "S05",
        "这样我压力小一点，我先找量表、任务设计和 AI 应用各一条。",
    ),
    (
        "problem_construction",
        "S04",
        "@问题推进者 我整理文档时发现大家题目都在变，需不需要先定一个临时版本？",
        "problem_progressor",
        "需要，但可以叫“工作版”，不要叫最终版。建议每个人保留一个当前可讨论版本，并在旁边写“还不确定的地方”。这样既能推进讨论，也不会把还没想清楚的问题过早固定。",
        "S02",
        "那我先把我的题目标成工作版，后面根据文献再改。",
    ),
    (
        "problem_construction",
        "S01",
        "@反馈追问者 我们互相给建议时经常说得很散，能不能给一个提问格式？",
        "feedback_prompter",
        "可以用三句式：你现在的研究对象是？你准备用什么证据回答？这个问题如果缩小一层会变成什么？每次同伴反馈尽量围绕这三句，不要只说“挺好”或“太大”。",
        "S05",
        "这个格式我能用，不然我不知道怎么给别人提建议。",
    ),
    (
        "meaning_exploration",
        "S03",
        "@资料研究员 我想找关于追问式反馈的文献，不一定只限 AI，有什么关键词？",
        "evidence_researcher",
        "可以从 formative feedback、prompting feedback、Socratic questioning、elaborated feedback、argumentation feedback 入手。中文可以检索追问式反馈、苏格拉底式提问、论证反馈、形成性反馈。注意区分“反馈内容”和“反馈方式”。",
        "S03",
        "好，我不只搜 AI 反馈，先把追问式反馈本身的依据补上。",
    ),
    (
        "meaning_exploration",
        "S05",
        "@观点挑战者 我如果用学习投入问卷，是不是就能说明 AI 任务设计有效？",
        "viewpoint_challenger",
        "不能直接说明。问卷只能反映学生投入状态或感受，不能自动证明 AI 任务设计有效。你还需要说明任务设计中哪些特征可能与投入有关，比如目标清晰、步骤可操作、资源支持或评价标准明确。",
        "S05",
        "明白，我把“有效”先删掉，改成看任务特征和投入之间的关系。",
    ),
    (
        "meaning_exploration",
        "S01",
        "@观点挑战者 我把教师支架分四类，会不会也有过度简化的问题？",
        "viewpoint_challenger",
        "会有，但可以通过限定用途解决。你不是在提出通用分类，而是在为本研究建立分析维度。开题里要写清楚：这四类是为了分析项目式学习设计文本和课堂实施，不声称覆盖所有教师支架。",
        "S01",
        "这句话我会写进方法部分，避免被问分类依据。",
    ),
    (
        "explanation_integration",
        "S02",
        "@反馈追问者 我的研究问题现在写了三个，会不会太多？",
        "feedback_prompter",
        "开题初稿可以有三个，但要分主次。建议一个主问题、两个子问题。主问题回答“路径是什么”，子问题分别回答“路径如何形成”和“路径如何被教师试用与修订”。",
        "S02",
        "我改成一个主问题两个子问题，不再并列三个大问题。",
    ),
    (
        "explanation_integration",
        "S03",
        "@问题推进者 我们现在一直在改题目，怎么进入最终产出？",
        "problem_progressor",
        "可以设置一个止损点：每个人只保留两个关键修订，不再无限细改。接下来转向把修订理由写清楚，包括为什么改、依据是什么、还有什么限制。",
        "S04",
        "我按每人两个关键修订来整理，不然共识总结会太长。",
    ),
    (
        "explanation_integration",
        "S05",
        "@问题推进者 我现在还没补完资料，会不会拖慢小组？",
        "problem_progressor",
        "不会，只要你明确补哪一类资料和什么时候补。建议先补一个成熟量表来源，再补一个课堂任务设计案例。不要试图一次补全所有文献。",
        "S05",
        "那我今晚只补量表和一个案例，不再乱搜。",
    ),
    (
        "application_solution",
        "S01",
        "@资料研究员 最终提交里文献来源要怎么标，才不显得只是随便列？",
        "evidence_researcher",
        "每条文献后面加一句用途即可：用于概念界定、用于理论解释、用于方法设计、用于评价指标。你们的小组总结可以不放完整综述，但要说明关键资料支撑了哪次修订。",
        "S02",
        "我来把文献清单改成“来源-用途”格式。",
    ),
    (
        "application_solution",
        "S03",
        "@反馈追问者 我最后的研究问题怎么写得不那么像口号？",
        "feedback_prompter",
        "把动词换成可观察动作。不要写“促进批判性思维”，可以写“学生如何根据 AI 追问补充证据、澄清边界和修订论证”。这样问题更具体，也更适合过程数据。",
        "S03",
        "这个表述更具体，我把最终问题改成看补证据、澄清边界和修订论证。",
    ),
    (
        "application_solution",
        "S05",
        "@观点挑战者 我想在总结里写自己从不懂到懂了，这样可以吗？",
        "viewpoint_challenger",
        "可以写，但不要只写感受。你可以写“原来把学习投入当作笼统结果，后来区分为行为投入和认知投入，并把研究问题从影响改为关系”。这样能体现具体修订。",
        "S05",
        "这个更像开题反思，我按这个写。",
    ),
]

TUTOR_DIALOGUES = {
    "S01": [
        ("我想把教师支架写清楚，但总感觉支架分类太多。", "你可以先不要追求分类完整，而是围绕你的研究场景选择可观察的支架。建议保留任务支架、资源支架、过程支架、评价支架四类，并说明它们如何在项目式学习设计中出现。"),
        ("那我的研究问题可以怎么写？", "可以写成：生成式 AI 如何辅助教师设计项目式学习中的过程支架？再分两个子问题：支架设计有哪些变化；教师如何判断这些支架是否适合学生。"),
        ("我担心教师访谈不够。", "可以加入支架方案文本分析和课堂观察记录。访谈回答“为什么这样设计”，文本和观察回答“实际设计和使用了什么”。"),
        ("我准备把题目改成生成式AI辅助项目式学习教师支架设计研究。", "这个题目更稳。下一步请补充研究对象范围，例如某学段、某学科或某类项目任务，否则开题仍会偏大。"),
        ("我作为组长还要写小组共识总结，怎么避免只写流水账？", "你可以把总结写成“共性问题-修订原则-证据来源”。例如共性问题是题目过大，修订原则是限定对象和数据，证据来源是群聊追问和共享文档修订。这样比按时间顺序描述更有分析价值。"),
    ],
    "S02": [
        ("我的路径研究会不会像经验总结？", "会有这个风险。你可以把路径研究设计成案例研究或设计型研究：先分析教师使用 AI 进行教学设计的困难，再形成支持路径，最后让教师试用并修订。"),
        ("TPACK 和 ADDIE 同时用会不会乱？", "不会，但要分工清楚。TPACK 解释教师知识整合，ADDIE 组织教学设计流程。不要把二者都写成理论基础。"),
        ("我想找教师 AI 素养相关资料。", "建议检索关键词：AI literacy for teachers、generative AI instructional design、teacher-AI collaboration、TPACK generative AI。中文可检索教师人工智能素养、智能技术支持教学设计。"),
        ("我现在题目是生成式 AI 支持教师课程教学设计的路径研究。", "建议补一个场景限定，比如某类课程或某个教学设计任务。路径研究如果没有边界，资料会很散。"),
        ("我找到很多文献，但每篇都像能用，怎么筛？", "先按开题功能筛：概念界定、理论解释、方法借鉴、实证背景。每一类最多保留 2-3 篇。不能说明用途的文献先放到备选，不要全部塞进理论基础。"),
        ("我想把教师访谈和教学设计文本都放进去，会不会太多？", "不算太多，但要说明各自作用。访谈解释教师如何理解 AI 支持，教学设计文本呈现 AI 支持后的设计变化。两个数据源可以互相印证。"),
        ("如果做设计型研究，我是不是必须真的迭代很多轮？", "不一定。开题阶段可以设计为小规模两轮迭代：初始路径形成、试用反馈、路径修订。关键是说明每轮要收集什么证据。"),
        ("我总想把题目写得大一点显得有价值。", "价值不靠题目大，而靠问题清楚。你可以在研究意义里写广一点，但研究问题必须收窄到可做的情境。"),
    ],
    "S03": [
        ("我想研究 AI 反馈对项目成果质量的影响，但怕做不出因果。", "如果无法控制同伴、教师和学生基础差异，就不要强写因果。可以改成过程研究，分析 AI 反馈如何被学生理解、采纳并体现在作品修订中。"),
        ("反馈类型怎么分比较好？", "可以先用三类：评价性反馈、建议性反馈、追问式反馈。你的重点若是批判性思维，可以突出追问式反馈如何促使学生补证据和改论证。"),
        ("成果质量指标怎么定？", "建议使用量规：问题清晰性、证据充分性、逻辑连贯性、方案可行性、反思修订质量。最好保留初稿和终稿进行对照。"),
        ("那题目改成 AI 追问式反馈支持学生项目成果修订的过程研究？", "这个题目更符合你能收集的数据，也避免过度承诺效果提升。"),
        ("追问式反馈和普通建议有什么区别？", "追问式反馈不直接给改法，而是指出缺口并要求学生补充理由、证据或边界。例如“这个结论依据是什么”“有没有反例”“这个方案适用于什么情境”。"),
        ("我需要把同伴反馈也考虑进去吗？", "需要记录，否则容易把修订都归因于 AI。可以把反馈来源分成 AI 追问、同伴建议、教师要求，再分析学生实际采纳了哪一类。"),
        ("如果学生没有采纳 AI 反馈，是不是就没有价值？", "不是。未采纳也有分析价值，可以说明学生认为反馈不适用、没有理解、或被其他建议替代。过程研究要记录采纳和未采纳。"),
        ("我想做编码，应该编码什么？", "可以编码反馈类型、反馈指向、学生回应方式、修订动作。修订动作包括补证据、改观点、改结构、删弱论点、明确边界。"),
        ("成果质量量规会不会太主观？", "量规本身会有主观性，所以要写清维度、评分标准和评分一致性处理。若条件允许，可以请两名评分者独立评分。"),
    ],
    "S04": [
        ("我负责整理文档，但自己的题目一直感觉虚。", "你的优势是能看到协作过程。题目可以从“协作机制”收缩到“协作过程”，例如 AI 工具支持跨学科项目学习协作过程的研究。"),
        ("协作过程可以看哪些证据？", "可以看聊天中的分工协商、概念解释、观点冲突、资料引用、文档修订和最终成果变化。共享文档版本是很重要的证据。"),
        ("我想写机制，但怕太大。", "开题阶段可以先写过程研究，后续在讨论中提炼机制。不要一开始就承诺揭示完整机制。"),
        ("小组共识总结怎么写得不空？", "给每条建议标注来源：哪次讨论、哪个文档修订、哪条资料线索或哪次 AI 提示。这样总结就有证据支撑。"),
        ("跨学科这个词如果没有真实学科差异，是不是不能写？", "如果你的对象只是同一专业学生讨论不同主题，就不要强写跨学科。可以改成“多主题开题协作”或“项目学习协作过程”。跨学科需要有明确学科知识差异。"),
        ("我想分析共享文档版本，但平台里的版本会不会不好解释？", "可以把版本变化转成几个可解释动作：新增观点、合并观点、删除不确定内容、补充证据、重组结构。不要只统计编辑次数。"),
        ("我在群里整理别人的观点，这算协作贡献吗？", "算，但要具体化。整理贡献可以表现为把分散讨论转成表格、把建议对应到修订、把共识写成可提交文本。"),
    ],
    "S05": [
        ("我有点不知道学习投入怎么测。", "可以先使用成熟框架，例如行为投入、情感投入、认知投入。你不必全部测，可以根据任务设计场景选择行为和认知投入。"),
        ("AI 支持任务设计和学习投入之间关系会不会太难？", "可以把题目从“影响”改成“关系研究”或“作用路径初探”，避免强因果。数据可以包括任务文本、学生问卷、访谈和完成记录。"),
        ("我担心自己的题目比别人弱。", "你的题目并不弱，只是需要限定情境。比如限定到综合实践活动或项目式任务，并说明 AI 支持体现在任务目标、步骤、资源或评价标准设计。"),
        ("我最后写 AI 支持课堂任务设计与学生学习投入关系研究，可以吗？", "可以。建议在开题构想卡中明确：学习投入采用哪些维度，任务设计质量如何描述，数据从哪些学生或任务中来。"),
        ("如果我只做问卷，会不会太单薄？", "单独问卷会偏薄。可以加少量访谈或任务完成记录，用来解释学生为什么投入或不投入。这样更适合开题设计。"),
    ],
}


def stage_for_index(index: int) -> str:
    if index < 22:
        return "problem_construction"
    if index < 52:
        return "meaning_exploration"
    if index < 82:
        return "explanation_integration"
    return "application_solution"


def parse_mentions(content: str, user_ids_by_code: dict[str, str]) -> list[str]:
    mentions = []
    for code, user_id in user_ids_by_code.items():
        if code in content or f"@{code}" in content:
            mentions.append(user_id)
    return mentions


def html_document(title: str, body: str) -> str:
    return f"""<h1>{title}</h1>
<p>{body}</p>"""


async def delete_existing_simulation() -> None:
    course = await Course.find_one(Course.invite_code == SIM_INVITE_CODE)
    project_ids: list[str] = []
    task_ids: list[str] = []
    if course:
        projects = await Project.find(Project.course_id == str(course.id)).to_list()
        project_ids = [str(project.id) for project in projects]
        tasks = await Task.find({"project_id": {"$in": project_ids}}).to_list() if project_ids else []
        task_ids = [str(task.id) for task in tasks]
        conversations = await AIConversation.find({"project_id": {"$in": project_ids}}).to_list() if project_ids else []
        conversation_ids = [str(conversation.id) for conversation in conversations]

        for model, query in [
            (ChatLog, {"project_id": {"$in": project_ids}}),
            (ResearchEvent, {"project_id": {"$in": project_ids}}),
            (ActivityLog, {"project_id": {"$in": project_ids}}),
            (Resource, {"$or": [{"project_id": {"$in": project_ids}}, {"course_id": str(course.id)}]}),
            (Document, {"project_id": {"$in": project_ids}}),
            (WikiItem, {"project_id": {"$in": project_ids}}),
            (Task, {"project_id": {"$in": project_ids}}),
            (CourseTaskRelease, {"course_id": str(course.id)}),
            (Project, {"course_id": str(course.id)}),
        ]:
            if project_ids or model in {CourseTaskRelease, Project}:
                await model.find(query).delete()
        if conversation_ids:
            await AIMessage.find({"conversation_id": {"$in": conversation_ids}}).delete()
        if project_ids:
            await AIConversation.find({"project_id": {"$in": project_ids}}).delete()

        await Course.find(Course.id == course.id).delete()

    emails = [f"aiscl.sim.g1.{profile.code.lower()}@example.test" for profile in LEARNERS]
    emails.append("aiscl.sim.g1.teacher@example.test")
    await User.find({"email": {"$in": emails}}).delete()

    db = mongodb.get_database()
    if project_ids:
        await db["behavior_stream"].delete_many({"metadata.project_id": {"$in": project_ids}})
        await db["heartbeat_stream"].delete_many({"metadata.project_id": {"$in": project_ids}})
    if task_ids:
        await db["task_submission_artifacts"].delete_many({"task_id": {"$in": task_ids}})


async def create_user(username: str, email: str, role: str, class_id: str | None = None) -> User:
    now = datetime.utcnow()
    user = User(
        username=username,
        email=email,
        password_hash=get_password_hash(SIM_PASSWORD),
        role=role,
        class_id=class_id,
        settings={"simulation": "g1_thesis_proposal"},
        created_at=now,
        updated_at=now,
    )
    await user.insert()
    return user


async def seed_simulation(export_path: Path | None) -> dict[str, Any]:
    now = datetime.utcnow()
    start = now.replace(hour=9, minute=0, second=0, microsecond=0) - timedelta(days=2)

    teacher = await create_user("T01", "aiscl.sim.g1.teacher@example.test", "teacher")
    course = Course(
        name=SIM_COURSE_NAME,
        teacher_id=str(teacher.id),
        semester="2026-Spring",
        invite_code=SIM_INVITE_CODE,
        description="第一轮本地平台模拟数据：G1 学位论文开题设计协作。",
        experiment_template_key="first_round_platform_effect",
        experiment_template_label="第一轮平台使用效果模拟",
        experiment_template_source="simulation_seed",
        experiment_template_bound_at=start,
        experiment_template_snapshot={
            "mode": "research",
            "version_name": "first_round_platform_effect",
            "stage_control_mode": "soft_guidance",
            "process_scaffold_mode": "on",
            "ai_scaffold_mode": "single_agent",
            "group_condition": "first_round_platform_use_g1",
            "stage_sequence": [stage for stage, _ in STAGES],
            "current_stage": "problem_construction",
            "template_key": "first_round_platform_effect",
            "template_label": "第一轮平台使用效果模拟",
            "template_source": "simulation_seed",
        },
        initial_task_document_title="G1-开题设计协作任务说明",
        initial_task_document_content="每名学习者形成个人开题构想卡，小组形成开题设计优化共识总结。",
        created_at=start,
        updated_at=start,
    )
    await course.insert()

    learners: list[User] = []
    for profile in LEARNERS:
        user = await create_user(profile.code, f"aiscl.sim.g1.{profile.code.lower()}@example.test", "student", str(course.id))
        learners.append(user)
    course.students = [str(user.id) for user in learners]
    await course.save()

    user_by_code = {profile.code: user for profile, user in zip(LEARNERS, learners)}
    user_ids_by_code = {code: str(user.id) for code, user in user_by_code.items()}

    project = Project(
        name=SIM_PROJECT_NAME,
        subtitle="AI 支持课程教学与项目式学习方向",
        description="G1 模拟小组：围绕学位论文开题设计开展线上小组互助完善。",
        course_id=str(course.id),
        group_code=SIM_PROJECT_CODE,
        owner_id=str(teacher.id),
        leader_id=user_ids_by_code["S01"],
        members=[
            {
                "user_id": str(user.id),
                "role": "owner" if profile.code == "S01" else "editor",
                "joined_at": start + timedelta(minutes=index * 2),
            }
            for index, (profile, user) in enumerate(zip(LEARNERS, learners))
        ],
        progress=100,
        experiment_version=course.experiment_template_snapshot,
        inherited_template_key=course.experiment_template_key,
        inherited_template_label=course.experiment_template_label,
        inherited_template_source=course.experiment_template_source,
        created_at=start,
        updated_at=start + timedelta(days=2, hours=5),
    )
    await project.insert()

    task_release = CourseTaskRelease(
        course_id=str(course.id),
        teacher_id=str(teacher.id),
        title="学位论文开题设计协作优化任务",
        task_brief_html=(
            "<p>每名学习者提出一个学位论文开题方向，小组通过追问、补证据、改题目和方法设计互相完善。</p>"
            "<p>最终提交：个人开题构想卡 + 小组开题设计优化共识总结。</p>"
        ),
        task_background="学位论文开题通常是个人研究设计，但小组协作可以帮助澄清问题意识、理论依据和方法路径。",
        core_question="如何把初步开题想法转化为可研究、可收集证据、可实施的研究设计？",
        collaboration_requirements="围绕问题构建、意义探索、解释整合、应用解决四个阶段进行互助讨论。",
        deliverable_requirements="提交个人开题构想卡和小组开题设计优化共识总结。",
        evaluation_points="题目聚焦度、理论与问题匹配度、方法可行性、证据链清晰度、同伴建议采纳情况。",
        due_at=start + timedelta(days=2, hours=8),
        target_project_ids=[str(project.id)],
        created_by=str(teacher.id),
        created_at=start - timedelta(hours=1),
        updated_at=start - timedelta(hours=1),
        published_at=start - timedelta(hours=1),
    )
    await task_release.insert()

    task = Task(
        project_id=str(project.id),
        title=task_release.title,
        column="done",
        priority="high",
        assignees=[str(user.id) for user in learners],
        description="围绕五个个人开题方向开展小组互助完善，并形成个人构想卡与小组共识总结。",
        due_date=task_release.due_at,
        source_type="course_release",
        course_task_release_id=str(task_release.id),
        submission_status="submitted",
        submitted_at=start + timedelta(days=2, hours=5, minutes=42),
        submitted_by=user_ids_by_code["S01"],
        submission_note="已提交 G1 个人开题构想卡与小组开题设计优化共识总结。",
        review_status="pending",
        created_at=start - timedelta(hours=1),
        updated_at=start + timedelta(days=2, hours=5, minutes=42),
    )
    await task.insert()
    task_release.synced_task_ids = [str(task.id)]
    await task_release.save()

    documents = await create_documents(project, task_release, task, learners, start, user_ids_by_code)
    task.artifact_document_ids = [str(document.id) for document in documents]
    task.artifact_document_id = str(documents[-1].id)
    await task.save()
    task_release.synced_document_ids = [str(document.id) for document in documents]
    await task_release.save()

    resources = await create_resources(project, course, learners, start)
    await create_chat_and_events(project, learners, resources, documents, start, user_ids_by_code)
    await create_messy_realistic_turns(project, learners, start)
    await create_agent_exchanges(project, learners, start, user_ids_by_code)
    await create_personal_tutor_conversations(project, learners, start)
    await create_navigation_behavior(project, learners, resources, documents, task, start)
    await create_document_revision_trace(project, learners, documents, start)
    await create_wiki_items(project, learners, start)

    if export_path:
        export_path.parent.mkdir(parents=True, exist_ok=True)
        package_data = await _collect_course_research_package(course, include_raw_heartbeat=False)
        _write_course_research_zip(str(export_path), course, package_data, False)

    return {
        "course_id": str(course.id),
        "project_id": str(project.id),
        "task_release_id": str(task_release.id),
        "task_id": str(task.id),
        "student_accounts": [
            {
                "username": profile.code,
                "email": f"aiscl.sim.g1.{profile.code.lower()}@example.test",
                "password": SIM_PASSWORD,
                "topic": profile.topic,
                "tendency": profile.tendency,
            }
            for profile in LEARNERS
        ],
        "teacher_account": {
            "username": "T01",
            "email": "aiscl.sim.g1.teacher@example.test",
            "password": SIM_PASSWORD,
        },
        "export_path": str(export_path) if export_path else None,
    }


async def create_documents(
    project: Project,
    task_release: CourseTaskRelease,
    task: Task,
    learners: list[User],
    start: datetime,
    user_ids_by_code: dict[str, str],
) -> list[Document]:
    docs = [
        Document(
            project_id=str(project.id),
            title="G1-个人开题构想表",
            content=html_document(
                "G1-个人开题构想表",
                "".join(
                    f"<h2>{profile.code}</h2><p><strong>方向：</strong>{profile.topic}</p>"
                    f"<p><strong>当前卡点：</strong>{profile.tendency}；需要进一步澄清研究对象、理论依据和方法证据。</p>"
                    for profile in LEARNERS
                ),
            ),
            preview_text="S01-S05 个人开题方向、研究问题、理论基础、方法路径。",
            last_modified_by=user_ids_by_code["S04"],
            source_type="course_task",
            course_task_release_id=str(task_release.id),
            sort_order=1,
            created_at=start + timedelta(minutes=8),
            updated_at=start + timedelta(days=2, hours=4),
        ),
        Document(
            project_id=str(project.id),
            title="G1-问题与方法修改清单",
            content=html_document(
                "G1-问题与方法修改清单",
                "<ul>"
                "<li>题目是否过大：需要限定对象、情境和核心概念。</li>"
                "<li>AI 角色是否清楚：工具、支架、反馈来源或协作媒介。</li>"
                "<li>理论是否解释研究问题，而不是简单堆砌。</li>"
                "<li>方法是否能直接回答研究问题。</li>"
                "<li>证据来源是否具体到文本、访谈、问卷、作品或过程记录。</li>"
                "</ul>",
            ),
            preview_text="题目聚焦、理论对应、方法可行、证据来源清单。",
            last_modified_by=user_ids_by_code["S04"],
            source_type="course_task",
            course_task_release_id=str(task_release.id),
            sort_order=2,
            created_at=start + timedelta(hours=2),
            updated_at=start + timedelta(days=2, hours=3),
        ),
        Document(
            project_id=str(project.id),
            title="G1-小组开题优化共识总结",
            content=html_document(
                "G1-小组开题优化共识总结",
                "<p>本组认为，开题设计需要避免先行判断 AI 有效，而应转化为可观察变量和可解释机制。</p>"
                "<ol>"
                "<li>从现象描述转向研究问题表达。</li>"
                "<li>区分理论基础、分析框架与方法工具。</li>"
                "<li>把 AI 的作用界定为教师设计支持、反馈支架或协作媒介。</li>"
                "<li>保证研究问题、数据来源和分析方法之间能够对应。</li>"
                "<li>在个人开题中记录同伴建议及采纳后的修订。</li>"
                "</ol>",
            ),
            preview_text="小组对开题设计优化的共识建议。",
            last_modified_by=user_ids_by_code["S04"],
            source_type="course_task",
            course_task_release_id=str(task_release.id),
            sort_order=3,
            created_at=start + timedelta(days=1, hours=4),
            updated_at=start + timedelta(days=2, hours=5, minutes=30),
        ),
    ]
    for document in docs:
        await document.insert()
    return docs


async def create_resources(project: Project, course: Course, learners: list[User], start: datetime) -> list[Resource]:
    resources: list[Resource] = []
    for index, (filename, mime_type, source_type) in enumerate(RESOURCE_SPECS):
        uploader = learners[index % len(learners)]
        resource = Resource(
            project_id=str(project.id),
            course_id=str(course.id),
            scope="project",
            filename=filename,
            file_key=f"simulation/g1/{index + 1:02d}_{filename}",
            url=f"/api/v1/storage/resources/simulation/g1/{index + 1:02d}",
            size=2048 + index * 1379,
            mime_type=mime_type,
            source_type=source_type,
            uploaded_by=str(uploader.id),
            uploaded_at=start + timedelta(hours=1, minutes=index * 18),
            parse_status="indexed" if mime_type in {"application/pdf", "text/plain", "text/csv"} else "unsupported",
            parse_provider="simulation",
            parsed_at=start + timedelta(hours=2, minutes=index * 12),
        )
        await resource.insert()
        resources.append(resource)
    return resources


async def create_chat_and_events(
    project: Project,
    learners: list[User],
    resources: list[Resource],
    documents: list[Document],
    start: datetime,
    user_ids_by_code: dict[str, str],
) -> None:
    db = mongodb.get_database()
    code_to_user = {profile.code: user for profile, user in zip(LEARNERS, learners)}
    sequence_index = 0
    current_time = start + timedelta(minutes=10)

    for index, (speaker, content) in enumerate(DIALOGUE_SCRIPT):
        current_time += timedelta(minutes=3 + (index % 4))
        stage_id = stage_for_index(index)
        is_ai = speaker == "ai_assistant"
        user_id = "ai_assistant" if is_ai else str(code_to_user[speaker].id)
        message_type = "ai" if is_ai else "text"
        metadata = {
            "simulation": "g1_thesis_proposal",
            "speaker_code": speaker,
            "stage_id": stage_id,
            "natural_dialogue": True,
        }
        if is_ai:
            metadata["trigger_reason"] = "group_progress_checkpoint"
            metadata["prompt_style"] = "basic_platform_scaffold"

        chat = ChatLog(
            project_id=str(project.id),
            user_id=user_id,
            content=content,
            message_type=message_type,
            mentions=parse_mentions(content, user_ids_by_code),
            metadata=metadata,
            created_at=current_time,
        )
        await chat.insert()

        sequence_index += 1
        await ResearchEvent(
            project_id=str(project.id),
            experiment_version_id="first_round_platform_effect",
            room_id=f"project:{project.id}",
            group_id=SIM_PROJECT_CODE,
            user_id=None if is_ai else user_id,
            actor_type="ai_assistant" if is_ai else "student",
            event_domain="scaffold" if is_ai else "dialogue",
            event_type="auto_prompt_delivered" if is_ai else "message_send",
            event_time=current_time,
            stage_id=stage_id,
            sequence_index=sequence_index,
            payload={
                "chat_log_id": str(chat.id),
                "content_length": len(content),
                "speaker_code": speaker,
                "message_type": message_type,
            },
            created_at=current_time,
        ).insert()

        if not is_ai:
            await ActivityLog(
                project_id=str(project.id),
                user_id=user_id,
                module="chat",
                action="message_send",
                target_id=str(chat.id),
                duration=15 + (index % 5) * 8,
                metadata={"stage_id": stage_id, "speaker_code": speaker},
                timestamp=current_time,
            ).insert()
            await db["behavior_stream"].insert_one(
                {
                    "timestamp": current_time,
                    "metadata": {
                        "project_id": str(project.id),
                        "user_id": user_id,
                        "module": "chat",
                        "action": "message_send",
                    },
                }
            )

    for index, resource in enumerate(resources):
        actor = learners[index % len(learners)]
        timestamp = start + timedelta(hours=1, minutes=index * 18)
        await ActivityLog(
            project_id=str(project.id),
            user_id=str(actor.id),
            module="resource",
            action="upload",
            target_id=str(resource.id),
            duration=35,
            metadata={"filename": resource.filename, "source_type": resource.source_type},
            timestamp=timestamp,
        ).insert()
        await ResearchEvent(
            project_id=str(project.id),
            experiment_version_id="first_round_platform_effect",
            room_id=f"project:{project.id}",
            group_id=SIM_PROJECT_CODE,
            user_id=str(actor.id),
            actor_type="student",
            event_domain="rag",
            event_type="resource_upload",
            event_time=timestamp,
            stage_id="meaning_exploration",
            sequence_index=200 + index,
            payload={"resource_id": str(resource.id), "filename": resource.filename},
            created_at=timestamp,
        ).insert()

    for index, document in enumerate(documents):
        actor = learners[3]
        timestamp = document.updated_at or (start + timedelta(days=1))
        await ActivityLog(
            project_id=str(project.id),
            user_id=str(actor.id),
            module="document",
            action="edit",
            target_id=str(document.id),
            duration=420 + index * 180,
            metadata={"title": document.title, "sort_order": document.sort_order},
            timestamp=timestamp,
        ).insert()
        await ResearchEvent(
            project_id=str(project.id),
            experiment_version_id="first_round_platform_effect",
            room_id=f"doc:{document.id}",
            group_id=SIM_PROJECT_CODE,
            user_id=str(actor.id),
            actor_type="student",
            event_domain="shared_record",
            event_type="document_revision",
            event_time=timestamp,
            stage_id=STAGES[min(index + 1, 3)][0],
            sequence_index=300 + index,
            payload={"document_id": str(document.id), "title": document.title},
            created_at=timestamp,
        ).insert()

    for learner_index, learner in enumerate(learners):
        for session_index in range(3):
            base = start + timedelta(hours=learner_index, days=session_index)
            for beat in range(4):
                module = ["chat", "document", "resource", "task"][(learner_index + beat) % 4]
                await db["heartbeat_stream"].insert_one(
                    {
                        "timestamp": base + timedelta(minutes=beat * 45),
                        "metadata": {
                            "project_id": str(project.id),
                            "user_id": str(learner.id),
                            "module": module,
                            "resource_id": str(resources[(learner_index + beat) % len(resources)].id) if module == "resource" else None,
                        },
                    }
                )


async def create_agent_exchanges(
    project: Project,
    learners: list[User],
    start: datetime,
    user_ids_by_code: dict[str, str],
) -> None:
    code_to_user = {profile.code: user for profile, user in zip(LEARNERS, learners)}
    base_time_by_stage = {
        "problem_construction": start + timedelta(hours=1, minutes=18),
        "meaning_exploration": start + timedelta(days=1, minutes=48),
        "explanation_integration": start + timedelta(days=1, hours=4, minutes=25),
        "application_solution": start + timedelta(days=2, hours=3, minutes=5),
    }
    offsets_by_stage = {
        "problem_construction": [0, 7, 19, 36, 58, 79],
        "meaning_exploration": [0, 9, 27, 51, 84, 126, 171, 205],
        "explanation_integration": [0, 6, 24, 39, 76, 111, 157, 188],
        "application_solution": [0, 13, 45, 69, 104, 131, 166, 214],
    }
    sequence_index = 500
    stage_counts: dict[str, int] = {}

    for exchange_index, (stage_id, student_code, question, agent_key, reply, follow_code, follow_up) in enumerate(AGENT_EXCHANGES):
        agent = AGENT_PROFILES[agent_key]
        stage_count = stage_counts.get(stage_id, 0)
        stage_counts[stage_id] = stage_count + 1
        stage_offsets = offsets_by_stage[stage_id]
        offset = stage_offsets[stage_count] if stage_count < len(stage_offsets) else stage_offsets[-1] + (stage_count - len(stage_offsets) + 1) * 23
        base_time = base_time_by_stage[stage_id] + timedelta(minutes=offset)
        student_user_id = str(code_to_user[student_code].id)
        follow_user_id = str(code_to_user[follow_code].id)

        question_log = ChatLog(
            project_id=str(project.id),
            user_id=student_user_id,
            content=question,
            message_type="text",
            mentions=["ai_assistant"],
            metadata={
                "simulation": "g1_thesis_proposal",
                "speaker_code": student_code,
                "stage_id": stage_id,
                "interaction_type": "学生@智能体",
                "mention_target": f"@{agent['name']}",
                "selected_subagent": agent_key,
            },
            created_at=base_time,
        )
        await question_log.insert()

        reply_log = ChatLog(
            project_id=str(project.id),
            user_id=agent["user_id"],
            content=reply,
            message_type="ai",
            mentions=[],
            metadata={
                "simulation": "g1_thesis_proposal",
                "speaker_code": agent["name"],
                "stage_id": stage_id,
                "interaction_type": "智能体回复学生",
                "ai_role": agent["name"],
                "selected_subagent": agent_key,
                "response_to_message_id": str(question_log.id),
                "prompt_style": "role_specific_agent_reply",
            },
            created_at=base_time + timedelta(minutes=2),
        )
        await reply_log.insert()

        follow_log = ChatLog(
            project_id=str(project.id),
            user_id=follow_user_id,
            content=follow_up,
            message_type="text",
            mentions=[],
            metadata={
                "simulation": "g1_thesis_proposal",
                "speaker_code": follow_code,
                "stage_id": stage_id,
                "interaction_type": "学生回应智能体",
                "response_to_message_id": str(reply_log.id),
            },
            created_at=base_time + timedelta(minutes=5),
        )
        await follow_log.insert()

        for offset, (chat, actor_type, event_type, user_id) in enumerate(
            [
                (question_log, "student", "agent_mention", student_user_id),
                (reply_log, "ai_assistant", "agent_role_reply", None),
                (follow_log, "student", "agent_reply_uptake", follow_user_id),
            ]
        ):
            sequence_index += 1
            await ResearchEvent(
                project_id=str(project.id),
                experiment_version_id="first_round_platform_effect",
                room_id=f"project:{project.id}",
                group_id=SIM_PROJECT_CODE,
                user_id=user_id,
                actor_type=actor_type,
                event_domain="scaffold" if actor_type == "ai_assistant" else "dialogue",
                event_type=event_type,
                event_time=chat.created_at,
                stage_id=stage_id,
                sequence_index=sequence_index,
                payload={
                    "chat_log_id": str(chat.id),
                    "content_length": len(chat.content),
                    "selected_subagent": agent_key,
                    "ai_role": agent["name"],
                    "turn_position": offset + 1,
                },
                created_at=chat.created_at,
            ).insert()

        for chat, user_id, action in [
            (question_log, student_user_id, "agent_mention"),
            (follow_log, follow_user_id, "agent_reply_uptake"),
        ]:
            await ActivityLog(
                project_id=str(project.id),
                user_id=user_id,
                module="chat",
                action=action,
                target_id=str(chat.id),
                duration=32,
                metadata={"stage_id": stage_id, "selected_subagent": agent_key},
                timestamp=chat.created_at,
            ).insert()


async def create_messy_realistic_turns(
    project: Project,
    learners: list[User],
    start: datetime,
) -> None:
    code_to_user = {profile.code: user for profile, user in zip(LEARNERS, learners)}
    base_time_by_stage = {
        "problem_construction": start + timedelta(minutes=2),
        "meaning_exploration": start + timedelta(days=1, minutes=22),
        "explanation_integration": start + timedelta(days=1, hours=4, minutes=35),
        "application_solution": start + timedelta(days=2, hours=4, minutes=15),
    }
    sequence_index = 430

    for index, (stage_id, speaker, content) in enumerate(MESSY_REALISTIC_TURNS):
        timestamp = base_time_by_stage[stage_id] + timedelta(minutes=index * 3)
        is_ai = speaker == "ai_assistant"
        user_id = "ai_assistant" if is_ai else str(code_to_user[speaker].id)
        chat = ChatLog(
            project_id=str(project.id),
            user_id=user_id,
            content=content,
            message_type="ai" if is_ai else "text",
            mentions=["ai_assistant"] if "@资料研究员" in content else [],
            metadata={
                "simulation": "g1_thesis_proposal",
                "speaker_code": speaker,
                "stage_id": stage_id,
                "interaction_type": "真实杂讯/短轮次",
                "primary_agent": "AISCL智能助手" if is_ai else None,
                "rationale_summary": "AI 服务临时异常，已给出最小可执行提示。" if is_ai else None,
                "routing_summary": ["生成失败兜底提示"] if is_ai else [],
            },
            created_at=timestamp,
        )
        await chat.insert()
        sequence_index += 1
        await ResearchEvent(
            project_id=str(project.id),
            experiment_version_id="first_round_platform_effect",
            room_id=f"project:{project.id}",
            group_id=SIM_PROJECT_CODE,
            user_id=None if is_ai else user_id,
            actor_type="ai_assistant" if is_ai else "student",
            event_domain="scaffold" if is_ai else "dialogue",
            event_type="fallback_prompt" if is_ai else "messy_short_turn",
            event_time=timestamp,
            stage_id=stage_id,
            sequence_index=sequence_index,
            payload={
                "chat_log_id": str(chat.id),
                "content_length": len(content),
                "speaker_code": speaker,
            },
            created_at=timestamp,
        ).insert()

        if not is_ai:
            await ActivityLog(
                project_id=str(project.id),
                user_id=user_id,
                module="chat",
                action="message_send",
                target_id=str(chat.id),
                duration=8 + (index % 4) * 5,
                metadata={"stage_id": stage_id, "speaker_code": speaker, "messy_turn": True},
                timestamp=timestamp,
            ).insert()


async def create_personal_tutor_conversations(
    project: Project,
    learners: list[User],
    start: datetime,
) -> None:
    code_to_user = {profile.code: user for profile, user in zip(LEARNERS, learners)}
    sequence_index = 650
    learner_time_offsets = {
        "S01": [3, 10, 19, 31, 39, 49],
        "S02": [2, 4, 9, 16, 20, 27, 33, 38, 44, 52],
        "S03": [1, 5, 8, 14, 17, 23, 28, 32, 36, 41, 47, 54],
        "S04": [3, 12, 18, 25, 30, 37, 45, 50],
        "S05": [6, 22, 35, 46, 55, 58],
    }

    for learner_index, profile in enumerate(LEARNERS):
        user = code_to_user[profile.code]
        conversation = AIConversation(
            project_id=str(project.id),
            user_id=str(user.id),
            persona_id="ai_tutor",
            title=f"{profile.code}-个人开题 AI 导师对话",
            context_config={
                "use_whiteboard": False,
                "use_docs": True,
                "use_project_context": True,
                "simulation": "g1_thesis_proposal",
            },
            category="chat",
            created_at=start + timedelta(hours=3, minutes=learner_index * 13),
            updated_at=start + timedelta(days=2, hours=2, minutes=learner_index * 11),
        )
        await conversation.insert()

        dialogue = TUTOR_DIALOGUES[profile.code]
        for turn_index, (question, answer) in enumerate(dialogue):
            hour_offset = learner_time_offsets[profile.code][turn_index]
            question_time = start + timedelta(hours=hour_offset, minutes=learner_index * 7 + (turn_index % 3) * 4)
            answer_time = question_time + timedelta(minutes=2)
            user_message = AIMessage(
                conversation_id=str(conversation.id),
                role="user",
                content=question,
                metadata={
                    "simulation": "g1_thesis_proposal",
                    "speaker_code": profile.code,
                    "tutor_turn": turn_index + 1,
                    "learner_tendency": profile.tendency,
                },
                created_at=question_time,
            )
            await user_message.insert()

            assistant_message = AIMessage(
                conversation_id=str(conversation.id),
                role="assistant",
                content=answer,
                metadata={
                    "simulation": "g1_thesis_proposal",
                    "persona_id": "ai_tutor",
                    "target_learner": profile.code,
                    "response_style": "personalized_scaffold",
                },
                created_at=answer_time,
            )
            await assistant_message.insert()

            for message, actor_type, event_type, timestamp in [
                (user_message, "student", "ai_tutor_question", question_time),
                (assistant_message, "ai_tutor", "ai_tutor_response", answer_time),
            ]:
                sequence_index += 1
                await ResearchEvent(
                    project_id=str(project.id),
                    experiment_version_id="first_round_platform_effect",
                    room_id=f"ai:{conversation.id}",
                    group_id=SIM_PROJECT_CODE,
                    user_id=str(user.id) if actor_type == "student" else None,
                    actor_type=actor_type,
                    event_domain="dialogue" if actor_type == "student" else "scaffold",
                    event_type=event_type,
                    event_time=timestamp,
                    stage_id=STAGES[min(turn_index, 3)][0],
                    sequence_index=sequence_index,
                    payload={
                        "conversation_id": str(conversation.id),
                        "message_id": str(message.id),
                        "content_length": len(message.content),
                        "speaker_code": profile.code,
                    },
                    created_at=timestamp,
                ).insert()

            await ActivityLog(
                project_id=str(project.id),
                user_id=str(user.id),
                module="ai",
                action="tutor_chat",
                target_id=str(conversation.id),
                duration=120 + turn_index * 20,
                metadata={"speaker_code": profile.code, "tutor_turn": turn_index + 1},
                timestamp=question_time,
            ).insert()


async def create_navigation_behavior(
    project: Project,
    learners: list[User],
    resources: list[Resource],
    documents: list[Document],
    task: Task,
    start: datetime,
) -> None:
    db = mongodb.get_database()
    route_profiles = {
        "S01": [
            ("dashboard", "page_view", None),
            ("task", "open_task", lambda idx: str(task.id)),
            ("chat", "open_group_chat", None),
            ("document", "open_document", lambda idx: str(documents[idx % len(documents)].id)),
            ("chat", "return_group_chat", None),
            ("task", "check_submission", lambda idx: str(task.id)),
            ("inquiry", "view_stage_board", None),
        ],
        "S02": [
            ("dashboard", "page_view", None),
            ("resource", "view_resource", lambda idx: str(resources[idx % len(resources)].id)),
            ("ai", "open_ai_tutor", None),
            ("resource", "view_resource", lambda idx: str(resources[(idx + 2) % len(resources)].id)),
            ("document", "edit_document", lambda idx: str(documents[idx % len(documents)].id)),
            ("chat", "return_group_chat", None),
            ("resource", "view_resource", lambda idx: str(resources[(idx + 4) % len(resources)].id)),
        ],
        "S03": [
            ("chat", "open_group_chat", None),
            ("ai", "open_ai_tutor", None),
            ("document", "open_document", lambda idx: str(documents[idx % len(documents)].id)),
            ("chat", "return_group_chat", None),
            ("ai", "open_ai_tutor", None),
            ("document", "edit_document", lambda idx: str(documents[(idx + 1) % len(documents)].id)),
            ("inquiry", "view_stage_board", None),
        ],
        "S04": [
            ("dashboard", "page_view", None),
            ("document", "open_document", lambda idx: str(documents[idx % len(documents)].id)),
            ("document", "edit_document", lambda idx: str(documents[(idx + 1) % len(documents)].id)),
            ("chat", "open_group_chat", None),
            ("document", "edit_document", lambda idx: str(documents[(idx + 2) % len(documents)].id)),
            ("resource", "view_resource", lambda idx: str(resources[idx % len(resources)].id)),
            ("document", "open_document", lambda idx: str(documents[idx % len(documents)].id)),
        ],
        "S05": [
            ("chat", "open_group_chat", None),
            ("task", "open_task", lambda idx: str(task.id)),
            ("chat", "return_group_chat", None),
            ("resource", "view_resource", lambda idx: str(resources[idx % len(resources)].id)),
            ("ai", "open_ai_tutor", None),
            ("document", "open_document", lambda idx: str(documents[idx % len(documents)].id)),
            ("chat", "return_group_chat", None),
        ],
    }

    for learner_index, learner in enumerate(learners):
        learner_code = f"S{learner_index + 1:02d}"
        module_routes = route_profiles[learner_code]
        for session_index in range(4):
            session_start = start + timedelta(days=session_index % 3, hours=8 + learner_index, minutes=session_index * 17)
            for step_index, (module, action, target_getter) in enumerate(module_routes):
                timestamp = session_start + timedelta(minutes=step_index * (3 + learner_index % 4) + (step_index % 2) * 2)
                target_id = target_getter(learner_index + session_index + step_index) if target_getter else None
                metadata = {
                    "simulation": "g1_thesis_proposal",
                    "speaker_code": learner_code,
                    "session_index": session_index + 1,
                    "step_index": step_index + 1,
                    "navigation_path": ">".join(route[0] for route in module_routes),
                }
                await ActivityLog(
                    project_id=str(project.id),
                    user_id=str(learner.id),
                    module=module,
                    action=action,
                    target_id=target_id,
                    duration=45 + step_index * 12,
                    metadata=metadata,
                    timestamp=timestamp,
                ).insert()
                await db["behavior_stream"].insert_one(
                    {
                        "timestamp": timestamp,
                        "metadata": {
                            "project_id": str(project.id),
                            "user_id": str(learner.id),
                            "module": module,
                            "action": action,
                            "target_id": target_id,
                            "session_index": session_index + 1,
                        },
                    }
                )
                await db["heartbeat_stream"].insert_one(
                    {
                        "timestamp": timestamp + timedelta(seconds=30),
                        "metadata": {
                            "project_id": str(project.id),
                            "user_id": str(learner.id),
                            "module": module,
                            "resource_id": target_id if module == "resource" else None,
                        },
                    }
                )


async def create_document_revision_trace(
    project: Project,
    learners: list[User],
    documents: list[Document],
    start: datetime,
) -> None:
    revision_steps = [
        ("S04", 0, "initial_topic_table", "根据 S01 的组织建议建立个人开题构想表初稿。", "problem_construction"),
        ("S02", 0, "add_literature_column", "根据资料研究员建议新增“理论/资料用途”列。", "meaning_exploration"),
        ("S03", 1, "add_risk_column", "根据观点挑战者建议新增“避免预设结论”列。", "meaning_exploration"),
        ("S04", 1, "merge_revision_rules", "把零散建议合并为核心修订、证据补充、表达润色三类。", "explanation_integration"),
        ("S05", 0, "revise_engagement_topic", "将学习投入题目从“影响”改为“关系研究”。", "explanation_integration"),
        ("S01", 2, "submission_checklist", "根据问题推进者建议补充提交前检查清单。", "application_solution"),
        ("S04", 2, "evidence_source_column", "根据反馈追问者建议补充“建议来源”说明。", "application_solution"),
        ("S02", 2, "literature_use_notes", "将文献清单改为“来源-用途”格式。", "application_solution"),
    ]
    code_to_user = {profile.code: user for profile, user in zip(LEARNERS, learners)}

    for index, (speaker_code, document_index, action, description, stage_id) in enumerate(revision_steps):
        user = code_to_user[speaker_code]
        document = documents[document_index]
        timestamp = start + timedelta(hours=5 + index * 6, minutes=(index % 3) * 11)
        await ActivityLog(
            project_id=str(project.id),
            user_id=str(user.id),
            module="document",
            action="revision_trace",
            target_id=str(document.id),
            duration=180 + index * 30,
            metadata={
                "simulation": "g1_thesis_proposal",
                "speaker_code": speaker_code,
                "revision_action": action,
                "revision_reason": description,
                "stage_id": stage_id,
            },
            timestamp=timestamp,
        ).insert()
        await ResearchEvent(
            project_id=str(project.id),
            experiment_version_id="first_round_platform_effect",
            room_id=f"doc:{document.id}",
            group_id=SIM_PROJECT_CODE,
            user_id=str(user.id),
            actor_type="student",
            event_domain="shared_record",
            event_type="document_revision_trace",
            event_time=timestamp,
            stage_id=stage_id,
            sequence_index=900 + index,
            payload={
                "document_id": str(document.id),
                "document_title": document.title,
                "revision_action": action,
                "revision_reason": description,
                "speaker_code": speaker_code,
            },
            created_at=timestamp,
        ).insert()


async def create_wiki_items(project: Project, learners: list[User], start: datetime) -> None:
    items = [
        ("问题构建阶段摘要", "五名学习者分别提出个人开题方向，并通过同伴追问缩小研究对象、关键概念和证据来源。", "stage_summary", "problem_construction"),
        ("意义探索阶段摘要", "小组围绕 TPACK、ADDIE、形成性反馈、共同调节学习、学习投入等理论线索讨论其适用边界。", "stage_summary", "meaning_exploration"),
        ("解释整合阶段摘要", "小组重点检查研究问题、理论基础、方法路径和数据来源之间是否对应。", "stage_summary", "explanation_integration"),
        ("应用解决阶段摘要", "每名学习者形成修订后的开题题目和方法路径，小组形成共识性优化建议。", "stage_summary", "application_solution"),
    ]
    for index, (title, content, item_type, stage_id) in enumerate(items):
        await WikiItem(
            project_id=str(project.id),
            group_id=SIM_PROJECT_CODE,
            stage_id=stage_id,
            item_type=item_type,
            title=title,
            content=content,
            summary=content[:120],
            source_type="manual",
            created_by=str(learners[index % len(learners)].id),
            updated_by=str(learners[index % len(learners)].id),
            visibility="group",
            confidence_level="working",
            created_at=start + timedelta(hours=index * 8),
            updated_at=start + timedelta(hours=index * 8, minutes=30),
        ).insert()


async def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--reset", action="store_true", help="Delete existing G1 simulation data before seeding.")
    parser.add_argument("--export", action="store_true", help="Export the seeded course research package.")
    parser.add_argument(
        "--output",
        default=str(Path(__file__).resolve().parents[2] / "exports" / SIM_EXPORT_NAME),
        help="Export ZIP path. Used only with --export.",
    )
    args = parser.parse_args()

    await mongodb.connect()
    try:
        if args.reset:
            await delete_existing_simulation()
        export_path = Path(args.output).resolve() if args.export else None
        summary = await seed_simulation(export_path)
        print(json.dumps(summary, ensure_ascii=False, indent=2))
        return 0
    finally:
        await mongodb.disconnect()


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
