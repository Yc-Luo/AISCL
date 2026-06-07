"""Seed G2 thesis proposal collaboration simulation data and export a package.

Run from the backend directory:

  PYTHONPATH=. MONGODB_URI=mongodb://localhost:27017/AISCL \
  MONGODB_DB_NAME=AISCL \
  poetry run python scripts/seed_g2_thesis_proposal_simulation.py --reset --export \
  --output /private/tmp/g2_thesis_proposal_research_package.zip

G2 uses S06-S10 and focuses on AI-supported critical thinking, higher-order
thinking expression, multi-agent collaboration, questioning scaffolds, and
metacognitive reflection.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import zipfile
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


SIM_INVITE_CODE = "SIM-G2-THESIS"
SIM_COURSE_NAME = "第一轮平台协作模拟-G2"
SIM_PROJECT_CODE = "G2"
SIM_PROJECT_NAME = "G2-高阶思维开题设计协作"
SIM_PASSWORD = "Test123456"
SIM_EXPORT_NAME = "g2_thesis_proposal_research_package.zip"

STAGES = [
    "problem_construction",
    "meaning_exploration",
    "explanation_integration",
    "application_solution",
]


@dataclass(frozen=True)
class LearnerProfile:
    code: str
    topic: str
    tendency: str


LEARNERS = [
    LearnerProfile("S06", "AI 智能体支持批判性思维发展的机制研究", "理论谨慎型，常把问题拉回概念边界和研究对象"),
    LearnerProfile("S07", "提示词设计对学生高阶思维表达的影响", "高频试探型，喜欢反复问 AI、改提示词、追求可操作方案"),
    LearnerProfile("S08", "多智能体协作对问题解决能力的支持研究", "强质疑型，常指出因果、样本和替代解释问题"),
    LearnerProfile("S09", "AI 追问支架对学生论证质量的影响", "方法编码型，关注数据、量规、编码表和证据链"),
    LearnerProfile("S10", "AI 支持反思性学习与元认知发展的研究", "后发反思型，前期少说，后期集中使用 AI 和补充反思"),
]

AGENT_PROFILES = {
    "problem_progressor": ("问题推进者", "auto_prompt:problem_progressor"),
    "evidence_researcher": ("资料研究员", "auto_prompt:evidence_researcher"),
    "viewpoint_challenger": ("观点挑战者", "auto_prompt:viewpoint_challenger"),
    "feedback_prompter": ("反馈追问者", "auto_prompt:feedback_prompter"),
}

RESOURCE_SPECS = [
    ("批判性思维量表与维度整理.pdf", "application/pdf", "instrument"),
    ("高阶思维表达编码示例.csv", "text/csv", "coding_scheme"),
    ("提示词设计与学习表现研究摘录.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "literature"),
    ("多智能体协作学习案例资料.pdf", "application/pdf", "case"),
    ("论证质量评价量规.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "rubric"),
    ("元认知反思日志模板.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "template"),
    ("AI追问支架样例.txt", "text/plain", "example"),
    ("问题解决过程分析框架.pdf", "application/pdf", "method"),
]


BASE_DIALOGUE = [
    ("problem_construction", "S06", "我先说一下，我们这组主题最好不要只写 AI 很厉害，重点应该是高阶思维怎么被支持。"),
    ("problem_construction", "S07", "我想做提示词设计对高阶思维表达的影响，但我其实想试不同提示词模板。"),
    ("problem_construction", "S08", "我这边是多智能体协作对问题解决能力的支持研究，但我担心这题容易变成平台功能介绍。"),
    ("problem_construction", "S09", "我关注 AI 追问支架对论证质量的影响，想看学生回答里有没有证据、反驳和推理链。"),
    ("problem_construction", "S10", "我想看 AI 支持反思性学习和元认知发展，不过我还没想清楚元认知怎么测。"),
    ("problem_construction", "S07", "等下，我的题目是不是也要限定对象？比如研究生开题过程里的提示词？"),
    ("problem_construction", "S06", "对，不然高阶思维表达太大。我们这组可以都限定在开题设计协作过程。"),
    ("problem_construction", "S08", "我先反对一下，全部限定开题过程会不会太窄？如果研究多智能体，也许应该看问题解决过程。"),
    ("problem_construction", "S09", "窄一点没事，至少数据能拿到。聊天、AI对话、共享文档、最后开题卡都能作为证据。"),
    ("problem_construction", "S10", "我先听你们的，我这个可以看学生怎么监控自己开题想法的变化。"),
    ("problem_construction", "S06", "我建个共享文档，先列每个人题目、研究对象、核心概念、最担心的问题。"),
    ("problem_construction", "S07", "我先写：研究对象是参与开题协作的学习者，变量是提示词结构，高阶思维表达先看分析、评价、创造。"),
    ("problem_construction", "S08", "变量这个词先谨慎。你如果不是实验，就别急着说影响。"),
    ("problem_construction", "S07", "那我改成提示词设计与高阶思维表达特征的关系研究？"),
    ("problem_construction", "S09", "这个稳一点，而且能编码表达特征。"),
    ("problem_construction", "S10", "我的元认知可以看计划、监控、评价吗？"),
    ("problem_construction", "S06", "可以，但要说明是从反思日志还是聊天里识别。"),
    ("problem_construction", "S08", "我们应该加一列：证据来源。不然都是概念。"),
    ("problem_construction", "S09", "已加。我还想加一列可编码行为。"),
    ("problem_construction", "S07", "我刚才写太快了，提示词对高阶思维表达这个题我再压一下。"),
    ("meaning_exploration", "S06", "进入资料和理论吧。批判性思维我们需要先统一维度，不然后面各说各的。"),
    ("meaning_exploration", "S09", "我找到几个论证质量维度：主张清晰、证据相关、理由充分、反驳处理、结论边界。"),
    ("meaning_exploration", "S08", "这些维度能用，但别把论证质量直接等同于批判性思维。"),
    ("meaning_exploration", "S07", "高阶思维表达我想用布鲁姆：分析、评价、创造。但感觉有点老。"),
    ("meaning_exploration", "S06", "老不等于不能用，关键是能不能和你的文本编码对应。"),
    ("meaning_exploration", "S10", "元认知我查到计划、监控、调节、评价。这个和我们四阶段好像能对应。"),
    ("meaning_exploration", "S08", "对应可以，但不能因为像就说有因果。"),
    ("meaning_exploration", "S09", "我上传一个论证质量量规示例，大家看能不能借用维度。"),
    ("meaning_exploration", "S07", "我也上传一个提示词设计文献摘录，里面有角色提示、步骤提示、反思提示。"),
    ("meaning_exploration", "S06", "我们把资料用途写清楚：理论、方法、量表、案例，不要只堆文件名。"),
    ("meaning_exploration", "S10", "我现在有点明白了，反思日志可以是个人 AI 导师对话后的自我解释。"),
    ("meaning_exploration", "S08", "可以，但要防止学生只是复述 AI 的话，不是真的反思。"),
    ("meaning_exploration", "S09", "那反思质量也要编码，比如是否提到原想法、改变原因、下一步计划。"),
    ("meaning_exploration", "S07", "我感觉我们组比 G1 更偏数据编码，挺好。"),
    ("meaning_exploration", "S06", "但不要全变成编码表，开题还要讲研究意义。"),
    ("explanation_integration", "S08", "我现在最大的疑问是，多智能体协作对问题解决能力这个题怎么避免自我循环？"),
    ("explanation_integration", "S06", "自我循环是什么意思？"),
    ("explanation_integration", "S08", "就是因为用了多智能体，所以说多智能体有帮助，但证据只是学生说有帮助。"),
    ("explanation_integration", "S09", "可以看过程证据：是否识别新问题、是否补证据、是否修订方案、是否处理反例。"),
    ("explanation_integration", "S07", "那我的提示词也可以看修订前后表达是不是更具体。"),
    ("explanation_integration", "S10", "我可以看学生是否从“我不会”变成“我知道下一步要改哪里”。"),
    ("explanation_integration", "S06", "这就是元认知调节的证据，但要谨慎写。"),
    ("explanation_integration", "S08", "我题目先改成多智能体支架支持问题解决过程的机制初探。"),
    ("explanation_integration", "S09", "机制初探可以，但你要说明机制来自过程分析，不是凭感觉。"),
    ("explanation_integration", "S07", "我现在不写影响了，改成提示词结构与高阶思维表达特征关系研究。"),
    ("explanation_integration", "S06", "我的题目也改一下：AI智能体支架支持批判性思维发展的过程机制研究。"),
    ("explanation_integration", "S10", "我想保留发展这个词，但可能太大。"),
    ("explanation_integration", "S08", "可以写元认知表现或反思质量，别直接写发展。"),
    ("explanation_integration", "S10", "那改成 AI 支持反思性学习中元认知表现的过程研究。"),
    ("application_solution", "S06", "最后每个人发最终题目、两个研究问题和主要数据来源。"),
    ("application_solution", "S07", "最终题目：提示词结构与学生高阶思维表达特征的关系研究。数据：提示词、学生表达文本、AI导师对话。"),
    ("application_solution", "S08", "最终题目：多智能体支架支持问题解决过程的机制初探。数据：群聊、@智能体记录、文档修订。"),
    ("application_solution", "S09", "最终题目：AI追问支架支持学生论证质量提升的过程研究。数据：追问记录、论证文本、修订稿。"),
    ("application_solution", "S10", "最终题目：AI支持反思性学习中元认知表现的过程研究。数据：反思日志、AI导师对话、开题修订说明。"),
    ("application_solution", "S06", "我的最终题目：AI智能体支架支持批判性思维发展的过程机制研究。数据：协作对话、智能体提示、开题方案修订。"),
    ("application_solution", "S09", "共性问题我写三条：概念太大、因果太满、证据来源不清。"),
    ("application_solution", "S07", "再加一条：提示词或智能体建议不能直接当结论。"),
    ("application_solution", "S08", "对，AI 只是支架，不是证据本身。"),
    ("application_solution", "S10", "我把个人反思补到文档里了。"),
    ("application_solution", "S06", "那我来提交。"),
]


AGENT_EXCHANGES = [
    ("problem_construction", "S07", "feedback_prompter", "@反馈追问者 我这个题目是不是太像实验了？我其实只是想看提示词怎么影响表达。", "你可以把“影响”降级为“关系”或“表达特征变化”。如果没有严格控制组，就不要写强因果。建议你先写清提示词结构，再说明高阶思维表达如何编码。", "S08", "这个提醒对，先别写影响，不然会被问控制变量。"),
    ("problem_construction", "S06", "problem_progressor", "@问题推进者 我们五个题目都很抽象，怎么先推进？", "先做一个低成本动作：每个人把题目改写成“对象-支架-表现/过程”。比如“开题协作中的 AI 追问支架如何支持学生修订论证”。先让题目变成可讨论句子。", "S09", "我按这个格式把论证质量那个题先改一版。"),
    ("problem_construction", "S08", "viewpoint_challenger", "@观点挑战者 多智能体协作这个题最容易被质疑什么？", "最容易被质疑的是把平台功能当成学习机制。你需要说明多智能体分别触发了什么认知动作，例如补证据、提反例、澄清概念、推进计划，而不是只说“多个智能体参与了”。", "S08", "这个就是我担心的点，我会把认知动作写进去。"),
    ("problem_construction", "S10", "problem_progressor", "@问题推进者 我现在题目还很虚，能不能帮我拆一下反思性学习？", "可以先拆成三个可观察动作：学生是否意识到原先想法的问题；是否解释为什么要修订；是否提出下一步计划。你可以先研究这些元认知表现，而不是直接证明元认知发展。", "S10", "那我先不写发展，写元认知表现。"),
    ("meaning_exploration", "S09", "evidence_researcher", "@资料研究员 论证质量评价有没有比较常用的维度？", "可以参考主张、证据、理由、反驳、结论边界这几类。你还可以查 argumentation quality rubric、Toulmin argument model、claim evidence reasoning。开题里要说明你选择哪些维度，以及为什么适合学生开题文本。", "S09", "我先按主张、证据、理由、反驳、边界做编码表。"),
    ("meaning_exploration", "S07", "evidence_researcher", "@资料研究员 提示词结构这块我应该搜什么？", "可以搜 prompt design、prompt engineering in education、scaffolded prompts、self-explanation prompts、reflection prompts。你要把提示词分成可比较结构，比如角色提示、步骤提示、证据提示、反思提示。", "S07", "我把提示词先分四类，不再只说好提示词坏提示词。"),
    ("meaning_exploration", "S06", "viewpoint_challenger", "@观点挑战者 批判性思维发展这个词是不是太大？", "是偏大。除非你有长期追踪，否则建议写批判性思维表现或过程。比如看学生是否提出依据、比较观点、处理反例、修订结论。这样更符合你们目前的数据。", "S06", "我改成过程机制，不直接写长期发展。"),
    ("meaning_exploration", "S10", "feedback_prompter", "@反馈追问者 我怎么判断自己写的是反思，不是普通总结？", "反思至少要包含变化：原来怎么想、遇到什么问题、为什么修改、下一步如何调整。普通总结只是复述做了什么。你可以用这四点检查自己的反思日志。", "S10", "这个我能用，我把日志分成这四格。"),
    ("meaning_exploration", "S08", "evidence_researcher", "@资料研究员 问题解决能力这个概念太宽，有没有更适合过程分析的说法？", "可以用问题解决过程表现，观察问题表征、策略选择、证据整合、方案修订、结果评价。这样比笼统的问题解决能力更适合过程数据。", "S08", "我改成问题解决过程表现。"),
    ("explanation_integration", "S07", "problem_progressor", "@问题推进者 我刚才又试了好几个提示词模板，现在有点散，怎么收束？", "先不要继续扩展模板。建议只保留两个最能代表差异的版本：一个普通提示，一个带证据和反思要求的支架提示。然后比较它们引出的表达差异。", "S06", "这样收束比较好，不然你的题会变成提示词库。"),
    ("explanation_integration", "S07", "viewpoint_challenger", "@观点挑战者 如果提示词结构变了，学生表达也变了，能不能说提示词导致的？", "不能直接说导致，除非你控制了其他因素。可以说呈现关联，或在过程证据中分析提示词如何引导学生补充分析、评价或创造性表达。", "S07", "我写关系和过程，不写导致。"),
    ("explanation_integration", "S09", "feedback_prompter", "@反馈追问者 我的研究问题写“AI追问如何提升论证质量”会不会太强？", "是偏强。可以改成“AI追问如何支持学生识别并修订论证缺口”。这样数据更容易对应：追问、学生回应、文本修订。", "S09", "我改成支持识别和修订论证缺口。"),
    ("explanation_integration", "S08", "problem_progressor", "@问题推进者 我们讨论越来越细了，怎么收束？", "每个人只保留两个关键修改点，并写明修改依据。小组总结不需要覆盖所有细节，而是提炼共性：概念降级、因果降级、证据具体化。", "S06", "这三个共性很好，放进总结。"),
    ("explanation_integration", "S10", "viewpoint_challenger", "@观点挑战者 元认知表现是不是也可能只是学生事后编的？", "有这个风险。所以你不能只用最终反思，还要结合过程数据：学生在群聊或 AI 导师对话中是否真的提出计划、监控困难、调整策略。", "S10", "那我把 AI 导师对话也作为过程证据。"),
    ("explanation_integration", "S06", "feedback_prompter", "@反馈追问者 批判性思维表现怎么写成研究问题？", "可以写：AI 智能体支架如何引导学生在开题协作中提出依据、比较观点、处理反例并修订结论？这个问题把批判性思维落到了可观察动作上。", "S06", "这个表述可以作为主问题。"),
    ("application_solution", "S07", "problem_progressor", "@问题推进者 我还想再试几个提示词模板，会不会来不及？", "可以试，但不要扩散。只保留两个代表性模板：一个普通提示，一个带证据/反思要求的提示。比较它们引出的表达差异即可。", "S07", "我就保留两个模板，其他放备选。"),
    ("application_solution", "S09", "viewpoint_challenger", "@观点挑战者 最后写提升论证质量是不是还是太满？", "如果没有评分前后对比和一致性处理，就不要写提升。可以写“支持论证质量修订”，强调过程性支持。", "S09", "我把提升改成修订。"),
    ("application_solution", "S10", "feedback_prompter", "@反馈追问者 我的反思日志会不会写成流水账？怎么改得更像研究材料？", "可以用四个固定问题压住：原来怎么想、被什么问题触发、为什么这样修订、下一步准备验证什么。这样就不是记录流水，而是能看到计划、监控和调节。", "S08", "这个可以，至少能看出元认知过程，不只是感想。"),
    ("application_solution", "S10", "evidence_researcher", "@资料研究员 元认知反思日志有没有模板？", "可以用四栏：原想法、触发问题、修订理由、下一步计划。每栏保持短句即可。重点是能看到学生如何监控和调整自己的研究设计。", "S10", "我按四栏补个人反思。"),
    ("application_solution", "S06", "feedback_prompter", "@反馈追问者 最终小组总结如何写得像研究过程，不像汇报材料？", "用证据链写法：问题出现在哪里、谁提出了什么建议、如何修订、修订后解决了什么问题。每条共识建议最好对应一条聊天、AI提示或文档修订。", "S06", "我按证据链写，不写空泛口号。"),
]


MESSY_TURNS = [
    ("problem_construction", "S06", "大家到了吗"),
    ("problem_construction", "S07", "到了，我刚才在试提示词"),
    ("problem_construction", "S10", "我先看你们说"),
    ("problem_construction", "S08", "别又变成各写各的，先统一对象"),
    ("meaning_exploration", "S07", "@AISCL智能助手 帮我写一个高阶思维提示词"),
    ("meaning_exploration", "ai_assistant", "可以使用角色、任务、步骤和评价标准来构建提示词。请说明你的具体学习任务。"),
    ("meaning_exploration", "S07", "这个回答有点泛，我先自己试两个版本"),
    ("meaning_exploration", "S09", "我上传编码表了，不知道能不能打开"),
    ("meaning_exploration", "S10", "我能打开"),
    ("explanation_integration", "S08", "我觉得 AI 刚才有些建议太顺了，真实开题会被老师追问的"),
    ("explanation_integration", "S06", "对，我们自己先追问一轮"),
    ("explanation_integration", "S07", "我先承认我的题目之前写得太满"),
    ("explanation_integration", "S09", "我也是，提升这个词先不用"),
    ("application_solution", "S10", "@AISCL智能助手 我这个反思日志怎么写"),
    ("application_solution", "ai_assistant", "AISCL智能助手暂时没有成功生成回应。请稍后重试，或先把当前问题、已有依据和下一步分工写在群聊中。"),
    ("application_solution", "S10", "那我按 S06 说的四栏写"),
    ("application_solution", "S06", "可以，别忘了写修订理由"),
    ("application_solution", "S08", "最后结论别写太大"),
]


NATURAL_EXTRA_TURNS = [
    ("problem_construction", "S07", "我刚刚又把题目写成“影响”了，感觉顺手就会这样写。"),
    ("problem_construction", "S08", "这就是问题，题目顺手写大，后面方法就撑不住。"),
    ("problem_construction", "S07", "先别急着否定，我只是还没找到合适说法。"),
    ("problem_construction", "S06", "可以先保留原想法，但文档里另写一个保守版本，后面再选。"),
    ("problem_construction", "S10", "我有点跟不上，你们现在是在统一题目格式吗？"),
    ("problem_construction", "S09", "对，先把对象、支架、表现和数据来源写出来。"),
    ("problem_construction", "S06", "S10 你先不用急着定理论，先写你能收集到什么过程材料。"),
    ("meaning_exploration", "S09", "我上传的量规文件你们能看吗？我这边预览有点慢。"),
    ("meaning_exploration", "S07", "能打开，但我只看了前两页，维度有点多。"),
    ("meaning_exploration", "S08", "维度多不等于好，开题里要能解释为什么选这几个。"),
    ("meaning_exploration", "auto_prompt:evidence_researcher", "资料研究员提示：当前资料较多，建议每人只保留一条直接支撑自己题目的证据，并说明它用于理论、方法还是测量。"),
    ("meaning_exploration", "S07", "这个提示能用一半，我先删掉几个泛泛的提示词资料。"),
    ("meaning_exploration", "S09", "我不删量规，但会把维度压成五项。"),
    ("meaning_exploration", "S10", "我先只保留元认知四维度，不再加反思深度那些复杂词。"),
    ("meaning_exploration", "S06", "这样比较好，我们不是写综述，先服务开题。"),
    ("meaning_exploration", "S08", "我还是担心 AI 给的关键词会把我们带偏，资料要自己判断。"),
    ("meaning_exploration", "S07", "我承认我刚才有点依赖 AI 关键词，后面我会标注哪些是自己筛的。"),
    ("explanation_integration", "S08", "现在文档里还有“提升”“发展”这些词，建议统一查一遍。"),
    ("explanation_integration", "S06", "我查了，S09 那个题还有提升，S10 有发展。"),
    ("explanation_integration", "S09", "我改，但我想保留质量这个词，不然太弱。"),
    ("explanation_integration", "S08", "质量可以保留，提升不一定能保留。"),
    ("explanation_integration", "auto_prompt:viewpoint_challenger", "观点挑战者提示：如果小组仍使用“提升、发展、影响”等词，请补充对应证据条件；否则建议改写为“过程支持、表现变化、关系分析”。"),
    ("explanation_integration", "S09", "这个提示说得对，但也有点模板化。我的改法是保留论证质量，去掉提升。"),
    ("explanation_integration", "S10", "我把发展改成表现，但感觉题目没那么有吸引力了。"),
    ("explanation_integration", "S06", "题目稳一点比漂亮但做不了更重要。"),
    ("explanation_integration", "S07", "我现在有个问题，提示词结构和表达特征关系研究，会不会太像描述？"),
    ("explanation_integration", "S08", "描述不是问题，问题是有没有解释。你要说明不同结构怎样引导表达。"),
    ("explanation_integration", "S07", "那我把研究问题二写成不同提示词结构如何引导证据和反思表达。"),
    ("explanation_integration", "S09", "这个比只比较字数好。"),
    ("explanation_integration", "S10", "我今天晚点再补文档，下午有点事。"),
    ("explanation_integration", "S06", "可以，但至少先把你的最终题目放上去，避免最后漏掉。"),
    ("application_solution", "S06", "还有一小时左右，我们先别扩展新问题了。"),
    ("application_solution", "S07", "我还想试第三个提示词模板，但好像来不及。"),
    ("application_solution", "S08", "别试了，新增模板会让你的数据解释更乱。"),
    ("application_solution", "S07", "行，我保留两个，把第三个放到后续研究。"),
    ("application_solution", "auto_prompt:feedback_prompter", "反馈追问者提示：提交前请检查每个个人题目是否包含研究对象、AI支架、可观察表现和主要数据来源。"),
    ("application_solution", "S08", "这个检查清单有用，但别照抄进总结。"),
    ("application_solution", "S09", "我按这个清单检查了一遍，S10 的数据来源还少一个文档修订说明。"),
    ("application_solution", "S10", "我补了，写成反思日志、AI导师对话、共享文档修订。"),
    ("application_solution", "S06", "我看到文档更新了。S09 你把采纳记录也补一下。"),
    ("application_solution", "S09", "已补：AI建议不是全部采纳，有两条只采纳了降级表述。"),
    ("application_solution", "S07", "我也写了未采纳原因：第三个模板来不及验证。"),
    ("application_solution", "S10", "我现在再看群聊，发现我前期说太少了，反思里会说明这个限制。"),
    ("application_solution", "S08", "这个限制可以写，反而真实。"),
    ("application_solution", "S06", "我提交前最后看一遍标题和数据来源。"),
]


TUTOR_DIALOGUES = {
    "S06": [
        ("我想写批判性思维发展，但怕太大。", "可以改成批判性思维表现或过程机制。你目前能观察的是学生提出依据、比较观点、处理反例和修订结论。"),
        ("机制这个词会不会也大？", "机制可以保留为“过程机制初探”，但要说明它来自对对话、智能体提示和文档修订的过程分析。"),
        ("我的主问题怎么写？", "可以写：AI 智能体支架如何引导学生在开题协作中提出依据、比较观点、处理反例并修订结论？"),
        ("我还需要什么数据？", "至少需要群聊、@智能体记录、共享文档修订和个人开题卡。它们能对应不同层面的批判性思维表现。"),
        ("我担心总结写成口号。", "每条总结都对应证据来源：哪次讨论、哪个智能体提示、哪次文档修订。"),
    ],
    "S07": [
        ("我想比较不同提示词，但怕设计太复杂。", "先保留两个模板：普通提示和带证据/反思要求的提示。不要一开始比较太多类型。"),
        ("高阶思维表达怎么编码？", "可以先编码分析、评价、创造三类，再看是否有证据、条件、反例和方案生成。"),
        ("我能不能说提示词影响表达？", "如果没有控制其他因素，建议写关系或过程支持，不写强因果影响。"),
        ("提示词结构包括什么？", "可以包括角色设定、步骤要求、证据要求、反思要求和输出格式。"),
        ("我想把 AI 导师对话也作为数据。", "可以，但要区分群聊协作数据和个人 AI 使用数据，说明两者分别回答什么问题。"),
        ("如果学生只是照着 AI 写，算高阶思维吗？", "不一定。你需要看学生是否进行了解释、评价、迁移或修订，而不是只复制结果。"),
        ("我的创新点怎么写？", "谨慎写成：从提示词结构角度分析开题协作中高阶思维表达的过程特征。"),
        ("最后题目再压一下？", "可以写：提示词结构与学生高阶思维表达特征的关系研究。"),
    ],
    "S08": [
        ("多智能体协作这个题很容易像介绍系统功能。", "你要把多智能体转成学习过程中的支架动作：推进、检索、挑战、追问。研究对象不是功能本身，而是这些支架如何参与问题解决。"),
        ("问题解决能力这个词是不是也太大？", "建议改成问题解决过程表现，如问题表征、策略选择、证据整合、方案修订和结果评价。"),
        ("我担心学生觉得有帮助，但实际上只是新鲜感。", "这是重要替代解释。你可以把感受数据和过程数据分开，不把主观有用感当作机制证据。"),
        ("多智能体机制怎么分析？", "可以看不同角色提示是否触发了不同修订动作，例如资料补充、反例处理、计划推进。"),
        ("我是不是需要比较没有多智能体的组？", "第一轮迭代不一定要做严格比较，但要在研究限制里说明这是平台使用过程分析，不直接证明因果效果。"),
        ("最终题目可以写机制初探吗？", "可以，只要在方法里说明机制来自过程证据的归纳，而不是预设结论。"),
    ],
    "S09": [
        ("我想研究 AI 追问支架和论证质量。", "建议把“提升”改为“支持修订”，重点分析追问如何暴露论证缺口并引发修订。"),
        ("论证质量维度怎么定？", "可以用主张、证据、理由、反驳、边界。每个维度写清可观察文本特征。"),
        ("追问类型怎么分？", "可以分为依据追问、反例追问、边界追问、逻辑链追问和修订追问。"),
        ("我需要评分吗？", "如果写质量变化，最好有量规评分；如果写过程支持，可以重点做文本修订链分析。"),
        ("我担心编码太主观。", "可以做双人编码或至少写清编码规则，并保留争议样例。"),
        ("最终问题怎么写？", "AI 追问支架如何支持学生识别并修订开题论证中的证据、边界和推理缺口？"),
    ],
    "S10": [
        ("我不太会写元认知。", "先不要写发展，写元认知表现。可以观察计划、监控、调节和评价。"),
        ("反思日志怎么设计？", "用四栏：原想法、触发问题、修订理由、下一步计划。"),
        ("如果我前期说得少，会不会数据不够？", "你可以把后期集中反思作为一个特点，但要结合 AI 导师对话和文档修订说明。"),
        ("我能不能分析自己和 AI 的对话？", "可以，但要说明这是个人学习支持数据，不等同于小组协作数据。"),
        ("最终题目怎么写？", "AI 支持反思性学习中元认知表现的过程研究。"),
    ],
}


def stage_for_index(index: int) -> str:
    if index < 20:
        return "problem_construction"
    if index < 35:
        return "meaning_exploration"
    if index < 50:
        return "explanation_integration"
    return "application_solution"


def html_document(title: str, body: str) -> str:
    return f"<h1>{title}</h1><div>{body}</div>"


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
            await AIConversation.find({"project_id": {"$in": project_ids}}).delete()
        await Course.find(Course.id == course.id).delete()

    emails = [f"aiscl.sim.g2.{profile.code.lower()}@example.test" for profile in LEARNERS]
    emails.append("aiscl.sim.g2.teacher@example.test")
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
        settings={"simulation": "g2_thesis_proposal"},
        created_at=now,
        updated_at=now,
    )
    await user.insert()
    return user


async def add_chat(
    project: Project,
    speaker: str,
    content: str,
    created_at: datetime,
    *,
    stage_id: str,
    code_to_user: dict[str, User],
    metadata: dict[str, Any] | None = None,
    message_type: str | None = None,
) -> ChatLog:
    is_ai = speaker == "ai_assistant" or speaker.startswith("auto_prompt:")
    user_id = speaker if is_ai else str(code_to_user[speaker].id)
    chat = ChatLog(
        project_id=str(project.id),
        user_id=user_id,
        content=content,
        message_type=message_type or ("ai" if is_ai else "text"),
        mentions=["ai_assistant"] if "@" in content and ("智能体" in content or "AISCL" in content or "资料研究员" in content or "观点挑战者" in content or "反馈追问者" in content or "问题推进者" in content) else [],
        metadata={
            "simulation": "g2_thesis_proposal",
            "speaker_code": speaker,
            "stage_id": stage_id,
            **(metadata or {}),
        },
        created_at=created_at,
    )
    await chat.insert()
    return chat


async def add_research_event(
    project: Project,
    *,
    user_id: str | None,
    actor_type: str,
    event_domain: str,
    event_type: str,
    event_time: datetime,
    stage_id: str,
    sequence_index: int,
    payload: dict[str, Any],
) -> None:
    await ResearchEvent(
        project_id=str(project.id),
        experiment_version_id="first_round_platform_effect_g2",
        room_id=f"project:{project.id}",
        group_id=SIM_PROJECT_CODE,
        user_id=user_id,
        actor_type=actor_type,
        event_domain=event_domain,
        event_type=event_type,
        event_time=event_time,
        stage_id=stage_id,
        sequence_index=sequence_index,
        payload=payload,
        created_at=event_time,
    ).insert()


async def seed_simulation(export_path: Path | None) -> dict[str, Any]:
    now = datetime.utcnow()
    start = now.replace(hour=9, minute=0, second=0, microsecond=0) - timedelta(days=2)
    teacher = await create_user("T02", "aiscl.sim.g2.teacher@example.test", "teacher")
    course = Course(
        name=SIM_COURSE_NAME,
        teacher_id=str(teacher.id),
        semester="2026-Spring",
        invite_code=SIM_INVITE_CODE,
        students=[],
        description="第一轮本地平台模拟数据：G2 高阶思维开题设计协作。",
        experiment_template_key="first_round_platform_effect_g2",
        experiment_template_label="第一轮平台使用效果模拟-G2",
        experiment_template_source="simulation_seed",
        experiment_template_bound_at=start,
        experiment_template_snapshot={
            "mode": "research",
            "version_name": "first_round_platform_effect_g2",
            "stage_control_mode": "soft_guidance",
            "process_scaffold_mode": "on",
            "ai_scaffold_mode": "multi_agent",
            "group_condition": "first_round_platform_use_g2",
            "stage_sequence": STAGES,
            "current_stage": STAGES[0],
            "template_key": "first_round_platform_effect_g2",
            "template_label": "第一轮平台使用效果模拟-G2",
            "template_source": "simulation_seed",
        },
        initial_task_document_title="G2-高阶思维开题设计协作任务说明",
        initial_task_document_content="每名学习者形成个人开题构想卡，小组围绕高阶思维、批判性思维、智能体支架和元认知反思形成共识总结。",
        created_at=start,
        updated_at=start,
    )
    await course.insert()

    learners: list[User] = []
    for profile in LEARNERS:
        learners.append(await create_user(profile.code, f"aiscl.sim.g2.{profile.code.lower()}@example.test", "student", str(course.id)))
    course.students = [str(user.id) for user in learners]
    await course.save()
    code_to_user = {profile.code: user for profile, user in zip(LEARNERS, learners)}

    project = Project(
        name=SIM_PROJECT_NAME,
        subtitle="AI 支持高阶思维与批判性思维方向",
        description="G2 模拟小组：围绕 AI 智能体、提示词、追问支架与元认知反思开展开题互助。",
        course_id=str(course.id),
        group_code=SIM_PROJECT_CODE,
        owner_id=str(teacher.id),
        leader_id=str(code_to_user["S06"].id),
        members=[
            {"user_id": str(user.id), "role": "owner" if profile.code == "S06" else "editor", "joined_at": start + timedelta(minutes=index * 3)}
            for index, (profile, user) in enumerate(zip(LEARNERS, learners))
        ],
        progress=100,
        experiment_version=course.experiment_template_snapshot,
        inherited_template_key=course.experiment_template_key,
        inherited_template_label=course.experiment_template_label,
        inherited_template_source=course.experiment_template_source,
        created_at=start,
        updated_at=start + timedelta(days=2, hours=6),
    )
    await project.insert()

    release = CourseTaskRelease(
        course_id=str(course.id),
        teacher_id=str(teacher.id),
        title="学位论文开题设计协作优化任务-G2",
        task_brief_html="<p>围绕 AI 支持高阶思维、批判性思维、多智能体与元认知反思，完成个人开题构想卡与小组共识总结。</p>",
        task_background="本组聚焦 AI 支架如何参与高阶思维和研究设计修订过程。",
        core_question="如何把 AI 支持高阶思维的初步想法转化为可研究、可编码、可解释的开题设计？",
        collaboration_requirements="围绕四阶段进行互助：问题构建、意义探索、解释整合、应用解决。",
        deliverable_requirements="个人开题构想卡、智能体使用记录说明、小组开题设计共识总结。",
        evaluation_points="概念边界、证据链、方法可行性、智能体建议采纳、反思修订质量。",
        due_at=start + timedelta(days=2, hours=8),
        target_project_ids=[str(project.id)],
        created_by=str(teacher.id),
        created_at=start - timedelta(hours=1),
        updated_at=start - timedelta(hours=1),
        published_at=start - timedelta(hours=1),
    )
    await release.insert()

    task = Task(
        project_id=str(project.id),
        title=release.title,
        column="done",
        priority="high",
        assignees=[str(user.id) for user in learners],
        description="形成 S06-S10 个人开题构想卡和 G2 高阶思维开题设计共识总结。",
        due_date=release.due_at,
        source_type="course_release",
        course_task_release_id=str(release.id),
        submission_status="submitted",
        submitted_at=start + timedelta(days=2, hours=6, minutes=10),
        submitted_by=str(code_to_user["S06"].id),
        submission_note="已提交 G2 个人开题构想卡与小组共识总结。",
        review_status="pending",
        created_at=start - timedelta(hours=1),
        updated_at=start + timedelta(days=2, hours=6, minutes=10),
    )
    await task.insert()
    release.synced_task_ids = [str(task.id)]

    documents = await create_documents(project, release, code_to_user, start)
    task.artifact_document_ids = [str(document.id) for document in documents]
    task.artifact_document_id = str(documents[-1].id)
    await task.save()
    release.synced_document_ids = [str(document.id) for document in documents]
    await release.save()

    resources = await create_resources(project, course, learners, start)
    await create_chat(project, learners, start, resources, documents, task)
    await create_tutor_conversations(project, learners, start)
    await create_navigation(project, learners, resources, documents, task, start)
    await create_wiki_items(project, learners, start)

    if export_path:
        export_path.parent.mkdir(parents=True, exist_ok=True)
        package_data = await _collect_course_research_package(course, include_raw_heartbeat=False)
        _write_course_research_zip(str(export_path), course, package_data, False)
        add_speaker_mapping_to_export(export_path, course, project)

    return {
        "course_id": str(course.id),
        "project_id": str(project.id),
        "task_release_id": str(release.id),
        "task_id": str(task.id),
        "student_accounts": [
            {
                "username": profile.code,
                "email": f"aiscl.sim.g2.{profile.code.lower()}@example.test",
                "password": SIM_PASSWORD,
                "topic": profile.topic,
                "tendency": profile.tendency,
            }
            for profile in LEARNERS
        ],
        "teacher_account": {"username": "T02", "email": "aiscl.sim.g2.teacher@example.test", "password": SIM_PASSWORD},
        "export_path": str(export_path) if export_path else None,
    }


def add_speaker_mapping_to_export(export_path: Path, course: Course, project: Project) -> None:
    lines = [
        "\ufeffcourse_id,project_id,platform_username,simulation_speaker_code,topic,tendency,analysis_note",
    ]
    for profile in LEARNERS:
        lines.append(
            ",".join(
                [
                    str(course.id),
                    str(project.id),
                    profile.code,
                    profile.code,
                    profile.topic,
                    profile.tendency,
                    "导出主表会匿名化用户列；请优先使用 metadata.speaker_code 识别本轮模拟学习者。",
                ]
            )
        )
    with zipfile.ZipFile(export_path, "a", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("metadata/speaker_code_mapping.csv", "\n".join(lines) + "\n")


async def create_documents(project: Project, release: CourseTaskRelease, code_to_user: dict[str, User], start: datetime) -> list[Document]:
    docs = [
        Document(
            project_id=str(project.id),
            title="G2-个人开题构想与差异表",
            content=html_document("G2-个人开题构想与差异表", "".join(f"<h2>{p.code}</h2><p>{p.topic}</p><p>{p.tendency}</p>" for p in LEARNERS)),
            preview_text="S06-S10 个人开题方向、差异化倾向和核心问题。",
            last_modified_by=str(code_to_user["S06"].id),
            source_type="course_task",
            course_task_release_id=str(release.id),
            sort_order=1,
            created_at=start + timedelta(minutes=12),
            updated_at=start + timedelta(days=2, hours=4),
        ),
        Document(
            project_id=str(project.id),
            title="G2-高阶思维概念与编码表",
            content=html_document("G2-高阶思维概念与编码表", "<ul><li>批判性思维：依据、比较、反例、边界、修订。</li><li>高阶思维表达：分析、评价、创造。</li><li>论证质量：主张、证据、理由、反驳、边界。</li><li>元认知表现：计划、监控、调节、评价。</li></ul>"),
            preview_text="高阶思维、论证质量、元认知表现的编码维度。",
            last_modified_by=str(code_to_user["S09"].id),
            source_type="course_task",
            course_task_release_id=str(release.id),
            sort_order=2,
            created_at=start + timedelta(hours=2),
            updated_at=start + timedelta(days=1, hours=6),
        ),
        Document(
            project_id=str(project.id),
            title="G2-智能体使用与建议采纳记录",
            content=html_document("G2-智能体使用与建议采纳记录", "<p>记录学生 @ 不同智能体后的建议、采纳方式、未采纳原因和对应文档修订。</p>"),
            preview_text="智能体调用、建议采纳、未采纳与文档修订链。",
            last_modified_by=str(code_to_user["S09"].id),
            source_type="course_task",
            course_task_release_id=str(release.id),
            sort_order=3,
            created_at=start + timedelta(days=1, hours=2),
            updated_at=start + timedelta(days=2, hours=3),
        ),
        Document(
            project_id=str(project.id),
            title="G2-小组开题设计共识总结",
            content=html_document("G2-小组开题设计共识总结", "<p>共识：将“发展、影响、提升”等强结论降级为过程表现、关系研究或修订支持；每个题目都需要明确可观察行为和证据来源。</p>"),
            preview_text="G2 最终共识总结。",
            last_modified_by=str(code_to_user["S06"].id),
            source_type="course_task",
            course_task_release_id=str(release.id),
            sort_order=4,
            created_at=start + timedelta(days=2, hours=2),
            updated_at=start + timedelta(days=2, hours=6),
        ),
    ]
    for doc in docs:
        await doc.insert()
    return docs


async def create_resources(project: Project, course: Course, learners: list[User], start: datetime) -> list[Resource]:
    resources = []
    for index, (filename, mime_type, source_type) in enumerate(RESOURCE_SPECS):
        uploader = learners[(index + 1) % len(learners)]
        resource = Resource(
            project_id=str(project.id),
            course_id=str(course.id),
            scope="project",
            filename=filename,
            file_key=f"simulation/g2/{index + 1:02d}_{filename}",
            url=f"/api/v1/storage/resources/simulation/g2/{index + 1:02d}",
            size=2600 + index * 1540,
            mime_type=mime_type,
            source_type=source_type,
            uploaded_by=str(uploader.id),
            uploaded_at=start + timedelta(hours=1, minutes=index * 21),
            parse_status="indexed" if mime_type in {"application/pdf", "text/plain", "text/csv"} else "unsupported",
            parse_provider="simulation",
            parsed_at=start + timedelta(hours=2, minutes=index * 13),
        )
        await resource.insert()
        resources.append(resource)
    return resources


async def create_chat(project: Project, learners: list[User], start: datetime, resources: list[Resource], documents: list[Document], task: Task) -> None:
    db = mongodb.get_database()
    code_to_user = {profile.code: user for profile, user in zip(LEARNERS, learners)}
    sequence = 0
    stage_base = {
        "problem_construction": start + timedelta(minutes=8),
        "meaning_exploration": start + timedelta(days=1, minutes=20),
        "explanation_integration": start + timedelta(days=1, hours=4),
        "application_solution": start + timedelta(days=2, hours=3),
    }
    stage_counts = {stage: 0 for stage in STAGES}

    for index, (stage_id, speaker, content) in enumerate(BASE_DIALOGUE):
        stage_counts[stage_id] += 1
        timestamp = stage_base[stage_id] + timedelta(minutes=stage_counts[stage_id] * (3 + index % 4))
        chat = await add_chat(project, speaker, content, timestamp, stage_id=stage_id, code_to_user=code_to_user)
        sequence += 1
        await add_research_event(
            project,
            user_id=str(code_to_user[speaker].id),
            actor_type="student",
            event_domain="dialogue",
            event_type="message_send",
            event_time=timestamp,
            stage_id=stage_id,
            sequence_index=sequence,
            payload={"chat_log_id": str(chat.id), "speaker_code": speaker, "content_length": len(content)},
        )
        await ActivityLog(
            project_id=str(project.id),
            user_id=str(code_to_user[speaker].id),
            module="chat",
            action="message_send",
            target_id=str(chat.id),
            duration=12 + index % 7 * 9,
            metadata={"speaker_code": speaker, "stage_id": stage_id},
            timestamp=timestamp,
        ).insert()
        await db["behavior_stream"].insert_one({"timestamp": timestamp, "metadata": {"project_id": str(project.id), "user_id": str(code_to_user[speaker].id), "module": "chat", "action": "message_send"}})

    await create_messy_turns(project, code_to_user, start)
    await create_natural_extra_turns(project, code_to_user, start)
    await create_agent_exchanges(project, code_to_user, start)
    await create_document_revision_trace(project, code_to_user, documents, start)

    for index, resource in enumerate(resources):
        actor = learners[index % len(learners)]
        timestamp = resource.uploaded_at
        await ActivityLog(project_id=str(project.id), user_id=str(actor.id), module="resource", action="upload", target_id=str(resource.id), duration=35, metadata={"filename": resource.filename, "source_type": resource.source_type}, timestamp=timestamp).insert()
        await add_research_event(project, user_id=str(actor.id), actor_type="student", event_domain="rag", event_type="resource_upload", event_time=timestamp, stage_id="meaning_exploration", sequence_index=300 + index, payload={"resource_id": str(resource.id), "filename": resource.filename})


async def create_messy_turns(project: Project, code_to_user: dict[str, User], start: datetime) -> None:
    base = {"problem_construction": start, "meaning_exploration": start + timedelta(days=1), "explanation_integration": start + timedelta(days=1, hours=4), "application_solution": start + timedelta(days=2, hours=3)}
    for index, (stage_id, speaker, content) in enumerate(MESSY_TURNS):
        timestamp = base[stage_id] + timedelta(minutes=3 + index * 4)
        metadata = {"interaction_type": "真实杂讯/短轮次"}
        if speaker == "ai_assistant" and "暂时没有成功生成回应" in content:
            metadata.update({"rationale_summary": "AI 服务临时异常，已给出最小可执行提示。", "routing_summary": ["生成失败兜底提示"]})
        chat = await add_chat(project, speaker, content, timestamp, stage_id=stage_id, code_to_user=code_to_user, metadata=metadata)
        await add_research_event(project, user_id=None if speaker == "ai_assistant" else str(code_to_user[speaker].id), actor_type="ai_assistant" if speaker == "ai_assistant" else "student", event_domain="scaffold" if speaker == "ai_assistant" else "dialogue", event_type="fallback_prompt" if speaker == "ai_assistant" else "messy_short_turn", event_time=timestamp, stage_id=stage_id, sequence_index=400 + index, payload={"chat_log_id": str(chat.id), "speaker_code": speaker, "content_length": len(content)})


async def create_natural_extra_turns(project: Project, code_to_user: dict[str, User], start: datetime) -> None:
    base = {
        "problem_construction": start + timedelta(minutes=34),
        "meaning_exploration": start + timedelta(days=1, hours=1, minutes=15),
        "explanation_integration": start + timedelta(days=1, hours=5, minutes=18),
        "application_solution": start + timedelta(days=2, hours=4, minutes=5),
    }
    gaps = {
        "problem_construction": [0, 2, 7, 16, 31, 43, 58],
        "meaning_exploration": [0, 4, 13, 28, 39, 57, 76, 104, 126, 154],
        "explanation_integration": [0, 3, 11, 23, 46, 53, 70, 88, 109, 132, 150, 184, 217],
        "application_solution": [0, 2, 8, 19, 37, 44, 63, 71, 86, 111, 127, 149, 168, 196],
    }
    counts = {stage: 0 for stage in STAGES}
    for index, (stage_id, speaker, content) in enumerate(NATURAL_EXTRA_TURNS):
        count = counts[stage_id]
        counts[stage_id] += 1
        stage_gaps = gaps[stage_id]
        timestamp = base[stage_id] + timedelta(minutes=stage_gaps[count] if count < len(stage_gaps) else stage_gaps[-1] + 17 * (count - len(stage_gaps) + 1))
        is_ai = speaker.startswith("auto_prompt:") or speaker == "ai_assistant"
        metadata = {
            "interaction_type": "自然协作补充/半采纳链",
            "realism_tag": "emotion_coordination" if any(key in content for key in ["跟不上", "来不及", "有点", "晚点"]) else "uptake_or_negotiation",
        }
        if speaker.startswith("auto_prompt:"):
            metadata.update({"prompt_style": "low_frequency_auto_prompt", "auto_prompt_policy": "triggered_by_repeated_uncertainty"})
        chat = await add_chat(project, speaker, content, timestamp, stage_id=stage_id, code_to_user=code_to_user, metadata=metadata)
        await add_research_event(
            project,
            user_id=None if is_ai else str(code_to_user[speaker].id),
            actor_type="ai_assistant" if is_ai else "student",
            event_domain="scaffold" if is_ai else "dialogue",
            event_type="auto_prompt" if speaker.startswith("auto_prompt:") else "natural_collaboration_turn",
            event_time=timestamp,
            stage_id=stage_id,
            sequence_index=450 + index,
            payload={"chat_log_id": str(chat.id), "speaker_code": speaker, "content_length": len(content), "realism_tag": metadata["realism_tag"]},
        )
        if not is_ai:
            await ActivityLog(
                project_id=str(project.id),
                user_id=str(code_to_user[speaker].id),
                module="chat",
                action="natural_collaboration_turn",
                target_id=str(chat.id),
                duration=18 + (index % 5) * 11,
                metadata={"speaker_code": speaker, "stage_id": stage_id, "realism_tag": metadata["realism_tag"]},
                timestamp=timestamp,
            ).insert()


async def create_agent_exchanges(project: Project, code_to_user: dict[str, User], start: datetime) -> None:
    stage_base = {
        "problem_construction": start + timedelta(hours=1, minutes=10),
        "meaning_exploration": start + timedelta(days=1, minutes=50),
        "explanation_integration": start + timedelta(days=1, hours=4, minutes=45),
        "application_solution": start + timedelta(days=2, hours=3, minutes=20),
    }
    offsets = {
        "problem_construction": [0, 8, 23, 41],
        "meaning_exploration": [0, 17, 36, 61, 93],
        "explanation_integration": [0, 12, 31, 58, 87, 124],
        "application_solution": [0, 21, 49, 78, 119],
    }
    counts = {stage: 0 for stage in STAGES}
    for index, (stage_id, student_code, agent_key, question, reply, follow_code, follow) in enumerate(AGENT_EXCHANGES):
        role_name, agent_user_id = AGENT_PROFILES[agent_key]
        count = counts[stage_id]
        counts[stage_id] += 1
        timestamp = stage_base[stage_id] + timedelta(minutes=offsets[stage_id][count] if count < len(offsets[stage_id]) else offsets[stage_id][-1] + 29)
        question_log = await add_chat(
            project,
            student_code,
            question,
            timestamp,
            stage_id=stage_id,
            code_to_user=code_to_user,
            metadata={"interaction_type": "学生@智能体", "mention_target": f"@{role_name}", "selected_subagent": agent_key},
        )
        reply_log = await add_chat(
            project,
            agent_user_id,
            reply,
            timestamp + timedelta(minutes=2 + index % 3),
            stage_id=stage_id,
            code_to_user=code_to_user,
            metadata={"interaction_type": "智能体回复学生", "ai_role": role_name, "selected_subagent": agent_key, "response_to_message_id": str(question_log.id), "prompt_style": "role_specific_agent_reply"},
        )
        follow_log = await add_chat(
            project,
            follow_code,
            follow,
            timestamp + timedelta(minutes=5 + index % 4),
            stage_id=stage_id,
            code_to_user=code_to_user,
            metadata={"interaction_type": "学生回应智能体", "response_to_message_id": str(reply_log.id), "selected_subagent": agent_key},
        )
        for offset, (chat, actor_type, event_type, user_id) in enumerate(
            [
                (question_log, "student", "agent_mention", str(code_to_user[student_code].id)),
                (reply_log, "ai_assistant", "agent_role_reply", None),
                (follow_log, "student", "agent_reply_uptake", str(code_to_user[follow_code].id)),
            ]
        ):
            await add_research_event(project, user_id=user_id, actor_type=actor_type, event_domain="scaffold" if actor_type == "ai_assistant" else "dialogue", event_type=event_type, event_time=chat.created_at, stage_id=stage_id, sequence_index=500 + index * 3 + offset, payload={"chat_log_id": str(chat.id), "selected_subagent": agent_key, "ai_role": role_name, "turn_position": offset + 1})
        for chat, code, action in [(question_log, student_code, "agent_mention"), (follow_log, follow_code, "agent_reply_uptake")]:
            await ActivityLog(project_id=str(project.id), user_id=str(code_to_user[code].id), module="chat", action=action, target_id=str(chat.id), duration=30, metadata={"stage_id": stage_id, "selected_subagent": agent_key}, timestamp=chat.created_at).insert()


async def create_document_revision_trace(project: Project, code_to_user: dict[str, User], documents: list[Document], start: datetime) -> None:
    steps = [
        ("S06", 0, "topic_boundary", "将“发展”降级为“表现/过程机制”。", "problem_construction"),
        ("S07", 0, "parallel_title_versions", "保留激进题目和保守题目两个版本，等待小组选择。", "problem_construction"),
        ("S10", 0, "evidence_source_column", "补充个人可收集的数据来源，避免只写概念。", "problem_construction"),
        ("S07", 1, "prompt_structure_codes", "新增提示词结构分类：角色、步骤、证据、反思。", "meaning_exploration"),
        ("S09", 1, "argument_quality_rubric", "新增论证质量维度：主张、证据、理由、反驳、边界。", "meaning_exploration"),
        ("S08", 1, "source_quality_note", "在资料表中补充来源判断，避免直接采用 AI 关键词。", "meaning_exploration"),
        ("S10", 1, "metacognition_four_dimensions", "将元认知表现压缩为计划、监控、调节、评价四项。", "meaning_exploration"),
        ("S08", 2, "agent_action_map", "把多智能体功能转写为认知动作触发。", "explanation_integration"),
        ("S10", 0, "metacognition_revision", "把元认知发展改为元认知表现。", "explanation_integration"),
        ("S09", 2, "partial_ai_uptake", "记录 AI 建议只采纳“降级表述”，未采纳强因果判断。", "explanation_integration"),
        ("S07", 2, "unadopted_prompt_template", "写明第三个提示词模板未采纳原因：时间不足且无法验证。", "application_solution"),
        ("S06", 3, "consensus_evidence_chain", "用证据链方式整理共识总结。", "application_solution"),
        ("S09", 2, "adoption_record", "记录 AI 追问建议与文本修订对应关系。", "application_solution"),
        ("S10", 3, "late_reflection_limit", "在共识总结中说明 S10 前期发言较少，后期通过反思日志补充。", "application_solution"),
        ("S06", 3, "final_submission_check", "提交前核对每个题目是否包含对象、支架、表现和数据来源。", "application_solution"),
    ]
    for index, (code, doc_index, action, reason, stage_id) in enumerate(steps):
        timestamp = start + timedelta(hours=4 + index * 7, minutes=(index % 4) * 9)
        document = documents[doc_index]
        await ActivityLog(project_id=str(project.id), user_id=str(code_to_user[code].id), module="document", action="revision_trace", target_id=str(document.id), duration=180 + index * 25, metadata={"speaker_code": code, "revision_action": action, "revision_reason": reason, "stage_id": stage_id}, timestamp=timestamp).insert()
        await add_research_event(project, user_id=str(code_to_user[code].id), actor_type="student", event_domain="shared_record", event_type="document_revision_trace", event_time=timestamp, stage_id=stage_id, sequence_index=800 + index, payload={"document_id": str(document.id), "document_title": document.title, "revision_action": action, "revision_reason": reason, "speaker_code": code})


async def create_tutor_conversations(project: Project, learners: list[User], start: datetime) -> None:
    code_to_user = {profile.code: user for profile, user in zip(LEARNERS, learners)}
    time_offsets = {
        "S06": [3, 12, 25, 37, 49],
        "S07": [2, 5, 10, 17, 24, 31, 43, 52],
        "S08": [4, 11, 19, 28, 35, 46],
        "S09": [3, 9, 16, 27, 38, 50],
        "S10": [8, 23, 34, 45, 55],
    }
    for profile in LEARNERS:
        user = code_to_user[profile.code]
        conversation = AIConversation(project_id=str(project.id), user_id=str(user.id), persona_id="ai_tutor", title=f"{profile.code}-个人开题 AI 导师对话", context_config={"use_docs": True, "use_project_context": True, "simulation": "g2_thesis_proposal"}, category="chat", created_at=start + timedelta(hours=2), updated_at=start + timedelta(days=2, hours=5))
        await conversation.insert()
        for turn_index, (question, answer) in enumerate(TUTOR_DIALOGUES[profile.code]):
            question_time = start + timedelta(hours=time_offsets[profile.code][turn_index], minutes=turn_index * 3)
            answer_time = question_time + timedelta(minutes=2)
            user_message = AIMessage(conversation_id=str(conversation.id), role="user", content=question, metadata={"simulation": "g2_thesis_proposal", "speaker_code": profile.code, "tutor_turn": turn_index + 1, "learner_tendency": profile.tendency}, created_at=question_time)
            await user_message.insert()
            assistant_message = AIMessage(conversation_id=str(conversation.id), role="assistant", content=answer, metadata={"simulation": "g2_thesis_proposal", "persona_id": "ai_tutor", "target_learner": profile.code, "response_style": "personalized_scaffold"}, created_at=answer_time)
            await assistant_message.insert()
            await add_research_event(project, user_id=str(user.id), actor_type="student", event_domain="dialogue", event_type="ai_tutor_question", event_time=question_time, stage_id=STAGES[min(turn_index, 3)], sequence_index=1000 + turn_index, payload={"conversation_id": str(conversation.id), "message_id": str(user_message.id), "speaker_code": profile.code})
            await add_research_event(project, user_id=None, actor_type="ai_tutor", event_domain="scaffold", event_type="ai_tutor_response", event_time=answer_time, stage_id=STAGES[min(turn_index, 3)], sequence_index=1100 + turn_index, payload={"conversation_id": str(conversation.id), "message_id": str(assistant_message.id), "speaker_code": profile.code})
            await ActivityLog(project_id=str(project.id), user_id=str(user.id), module="ai", action="tutor_chat", target_id=str(conversation.id), duration=110 + turn_index * 18, metadata={"speaker_code": profile.code, "tutor_turn": turn_index + 1}, timestamp=question_time).insert()


async def create_navigation(project: Project, learners: list[User], resources: list[Resource], documents: list[Document], task: Task, start: datetime) -> None:
    db = mongodb.get_database()
    routes = {
        "S06": [("dashboard", "page_view"), ("task", "open_task"), ("chat", "open_group_chat"), ("document", "open_document"), ("inquiry", "view_stage_board"), ("chat", "return_group_chat"), ("task", "check_submission")],
        "S07": [("chat", "open_group_chat"), ("ai", "open_ai_tutor"), ("resource", "view_resource"), ("ai", "open_ai_tutor"), ("document", "edit_document"), ("chat", "return_group_chat")],
        "S08": [("chat", "open_group_chat"), ("document", "open_document"), ("ai", "open_ai_tutor"), ("chat", "return_group_chat"), ("inquiry", "view_stage_board"), ("document", "edit_document")],
        "S09": [("resource", "view_resource"), ("document", "open_document"), ("document", "edit_document"), ("chat", "return_group_chat"), ("resource", "view_resource"), ("document", "edit_document")],
        "S10": [("chat", "open_group_chat"), ("task", "open_task"), ("chat", "return_group_chat"), ("ai", "open_ai_tutor"), ("document", "open_document"), ("chat", "return_group_chat")],
    }
    for learner_index, user in enumerate(learners):
        code = f"S{learner_index + 6:02d}"
        route = routes[code]
        for session_index in range(4):
            base = start + timedelta(days=session_index % 3, hours=8 + learner_index, minutes=session_index * 19)
            for step_index, (module, action) in enumerate(route):
                timestamp = base + timedelta(minutes=step_index * (4 + learner_index % 3) + (step_index % 2) * 3)
                target_id = None
                if module == "resource":
                    target_id = str(resources[(learner_index + step_index + session_index) % len(resources)].id)
                elif module == "document":
                    target_id = str(documents[(learner_index + step_index + session_index) % len(documents)].id)
                elif module == "task":
                    target_id = str(task.id)
                metadata = {"simulation": "g2_thesis_proposal", "speaker_code": code, "session_index": session_index + 1, "step_index": step_index + 1, "navigation_path": ">".join(item[0] for item in route)}
                await ActivityLog(project_id=str(project.id), user_id=str(user.id), module=module, action=action, target_id=target_id, duration=50 + step_index * 15, metadata=metadata, timestamp=timestamp).insert()
                await db["behavior_stream"].insert_one({"timestamp": timestamp, "metadata": {"project_id": str(project.id), "user_id": str(user.id), "module": module, "action": action, "target_id": target_id, "session_index": session_index + 1}})
                await db["heartbeat_stream"].insert_one({"timestamp": timestamp + timedelta(seconds=30), "metadata": {"project_id": str(project.id), "user_id": str(user.id), "module": module, "resource_id": target_id if module == "resource" else None}})
        for beat in range(5):
            await db["heartbeat_stream"].insert_one({"timestamp": start + timedelta(days=beat % 3, hours=learner_index + beat * 2), "metadata": {"project_id": str(project.id), "user_id": str(user.id), "module": ["chat", "document", "resource", "ai", "task"][beat % 5], "resource_id": str(resources[beat % len(resources)].id) if beat % 5 == 2 else None}})


async def create_wiki_items(project: Project, learners: list[User], start: datetime) -> None:
    summaries = [
        ("问题构建阶段摘要", "G2 将抽象的高阶思维主题压缩为对象、支架、表现/过程三个要素。", "problem_construction"),
        ("意义探索阶段摘要", "小组整理批判性思维、高阶思维表达、论证质量和元认知表现的资料与编码维度。", "meaning_exploration"),
        ("解释整合阶段摘要", "小组集中处理因果过强、概念过大、证据来源不清等问题。", "explanation_integration"),
        ("应用解决阶段摘要", "S06-S10 形成差异化个人开题题目，并完成智能体建议采纳说明。", "application_solution"),
    ]
    for index, (title, content, stage_id) in enumerate(summaries):
        await WikiItem(project_id=str(project.id), group_id=SIM_PROJECT_CODE, stage_id=stage_id, item_type="stage_summary", title=title, content=content, summary=content, source_type="manual", created_by=str(learners[index % len(learners)].id), updated_by=str(learners[index % len(learners)].id), visibility="group", confidence_level="working", created_at=start + timedelta(hours=index * 9), updated_at=start + timedelta(hours=index * 9, minutes=40)).insert()


async def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--reset", action="store_true", help="Delete existing G2 simulation data before seeding.")
    parser.add_argument("--export", action="store_true", help="Export the seeded course research package.")
    parser.add_argument("--output", default=str(Path(__file__).resolve().parents[2] / "exports" / SIM_EXPORT_NAME), help="Export ZIP path. Used only with --export.")
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
