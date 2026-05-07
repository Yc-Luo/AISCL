from __future__ import annotations

import asyncio
import math
import textwrap
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Iterable

from PIL import Image, ImageDraw, ImageFont
from playwright.async_api import Locator, Page, async_playwright


BASE_URL = "http://62.234.69.204"
STUDENT_EMAIL = "nenu31@example.com"
STUDENT_PASSWORD = "Password123!"
ADMIN_EMAIL = "ycluo@nenu.edu.cn"
ADMIN_PASSWORD = "Lyc35506339"
STUDENT_PROJECT_ID = "69ecc308f15ae7dfecc48c4b"

ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "docs" / "user-guides" / "images_cloud_v2"
STUDENT_DIR = OUT_DIR / "student"
TEACHER_DIR = OUT_DIR / "teacher"


@dataclass
class Mark:
    label: str
    locator: Callable[[Page], Locator]
    nth: int = 0


def load_font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    for candidate in [
        "/System/Library/Fonts/PingFang.ttc",
        "/System/Library/Fonts/STHeiti Light.ttc",
        "/System/Library/Fonts/Supplemental/Songti.ttc",
    ]:
        try:
            return ImageFont.truetype(candidate, size=size)
        except Exception:
            continue
    return ImageFont.load_default()


FONT = load_font(18)
FONT_SMALL = load_font(15)
FONT_BOLD = load_font(20)


async def safe_box(page: Page, mark: Mark) -> tuple[float, float, float, float] | None:
    try:
        locator = mark.locator(page)
        count = await locator.count()
        if count <= mark.nth:
            return None
        target = locator.nth(mark.nth)
        if not await target.is_visible(timeout=1000):
            return None
        box = await target.bounding_box(timeout=1500)
        if not box:
            return None
        x = max(0, box["x"] - 6)
        y = max(0, box["y"] - 6)
        w = box["width"] + 12
        h = box["height"] + 12
        return (x, y, w, h)
    except Exception:
        return None


def wrap_zh(text: str, width: int = 54) -> list[str]:
    lines: list[str] = []
    for part in text.splitlines():
        if not part:
            lines.append("")
            continue
        lines.extend(textwrap.wrap(part, width=width, break_long_words=True, replace_whitespace=False))
    return lines or [text]


def draw_marker(draw: ImageDraw.ImageDraw, x: float, y: float, number: int) -> None:
    r = 15
    cx = int(max(r + 4, x))
    cy = int(max(r + 4, y))
    draw.ellipse((cx - r, cy - r, cx + r, cy + r), fill="#dc2626", outline="#ffffff", width=3)
    text = str(number)
    bbox = draw.textbbox((0, 0), text, font=FONT_SMALL)
    draw.text((cx - (bbox[2] - bbox[0]) / 2, cy - (bbox[3] - bbox[1]) / 2 - 1), text, fill="white", font=FONT_SMALL)


async def annotate(page: Page, path: Path, marks: Iterable[Mark], title: str) -> list[str]:
    path.parent.mkdir(parents=True, exist_ok=True)
    screenshot = await page.screenshot(full_page=False)
    raw_path = path.with_name(path.stem.replace("_标注", "_原图") + path.suffix)
    raw_path.write_bytes(screenshot)

    img = Image.open(raw_path).convert("RGB")
    draw = ImageDraw.Draw(img)

    resolved: list[tuple[Mark, tuple[float, float, float, float]]] = []
    for mark in marks:
        box = await safe_box(page, mark)
        if box and box[1] < img.height - 24 and box[0] < img.width - 24:
            resolved.append((mark, box))

    for index, (_, (x, y, w, h)) in enumerate(resolved, start=1):
        draw.rounded_rectangle((x, y, x + w, y + h), radius=12, outline="#dc2626", width=4)
        draw_marker(draw, x + 2, y + 2, index)

    legend_lines: list[tuple[str, str]] = []
    for index, (mark, _) in enumerate(resolved, start=1):
        legend_lines.append((str(index), mark.label))

    line_height = 28
    legend_text_lines = sum(max(1, len(wrap_zh(label))) for _, label in legend_lines)
    legend_height = max(96, 54 + line_height * legend_text_lines)
    canvas = Image.new("RGB", (img.width, img.height + legend_height), "#ffffff")
    canvas.paste(img, (0, 0))
    cdraw = ImageDraw.Draw(canvas)
    top = img.height
    cdraw.rectangle((0, top, img.width, top + legend_height), fill="#ffffff")
    cdraw.line((0, top, img.width, top), fill="#e5e7eb", width=2)
    cdraw.text((24, top + 18), f"{title}  标注说明", fill="#111827", font=FONT_BOLD)
    y = top + 52
    x0 = 28
    col_width = img.width // 2
    for idx, (num, label) in enumerate(legend_lines):
        col = idx % 2
        if col == 0 and idx > 0:
            y += line_height * max(1, len(wrap_zh(legend_lines[idx - 1][1])))
        x = x0 + col * col_width
        cdraw.ellipse((x, y + 3, x + 22, y + 25), fill="#dc2626")
        nb = cdraw.textbbox((0, 0), num, font=FONT_SMALL)
        cdraw.text((x + 11 - (nb[2] - nb[0]) / 2, y + 13 - (nb[3] - nb[1]) / 2), num, fill="white", font=FONT_SMALL)
        wrapped = wrap_zh(label, width=34)
        for line_no, line in enumerate(wrapped):
            cdraw.text((x + 32, y + line_no * line_height), line, fill="#374151", font=FONT_SMALL)

    canvas.save(path)
    return [mark.label for mark, _ in resolved]


async def goto(page: Page, url: str) -> None:
    await page.goto(url, wait_until="domcontentloaded")
    await page.wait_for_timeout(1200)


async def login(page: Page, email: str, password: str) -> None:
    await goto(page, f"{BASE_URL}/login")
    await page.get_by_placeholder("邮箱地址").fill(email)
    await page.get_by_placeholder("密码").fill(password)
    await page.get_by_role("button", name="登录").click()
    await page.wait_for_timeout(2500)


def by_text(text: str, exact: bool = False) -> Callable[[Page], Locator]:
    return lambda page: page.get_by_text(text, exact=exact)


def by_role(role: str, name: str, exact: bool = True) -> Callable[[Page], Locator]:
    return lambda page: page.get_by_role(role, name=name, exact=exact)


def by_placeholder(text: str) -> Callable[[Page], Locator]:
    return lambda page: page.get_by_placeholder(text)


def by_css(selector: str) -> Callable[[Page], Locator]:
    return lambda page: page.locator(selector)


async def click_text(page: Page, text: str, exact: bool = False, nth: int = 0) -> None:
    loc = page.get_by_text(text, exact=exact).nth(nth)
    if await loc.count():
        await loc.click(timeout=2500)
        await page.wait_for_timeout(900)


async def click_button(page: Page, name: str, exact: bool = False, nth: int = 0) -> None:
    loc = page.get_by_role("button", name=name, exact=exact).nth(nth)
    if await loc.count():
        await loc.click(timeout=3000)
        await page.wait_for_timeout(1200)


async def capture_student(page: Page, manifest: list[str]) -> None:
    await goto(page, f"{BASE_URL}/login")
    labels = await annotate(
        page,
        STUDENT_DIR / "S-01_学生登录页_标注.png",
        [
            Mark("系统入口与登录身份说明", by_text("AISCL 协作学习系统", exact=True)),
            Mark("账号输入框", by_placeholder("邮箱地址")),
            Mark("密码输入框", by_placeholder("密码")),
            Mark("登录按钮", by_role("button", "登录")),
        ],
        "S-01 学生登录页",
    )
    manifest.append(f"- S-01 学生登录页：{', '.join(labels)}")

    await login(page, STUDENT_EMAIL, STUDENT_PASSWORD)
    labels = await annotate(
        page,
        STUDENT_DIR / "S-02_我的小组_标注.png",
        [
            Mark("学生可进入的协作小组卡片", by_text("小组a", exact=False)),
            Mark("项目/小组入口区域", by_text("项目", exact=False)),
            Mark("顶部用户与通知区域", by_css("header")),
        ],
        "S-02 我的小组",
    )
    manifest.append(f"- S-02 我的小组：{', '.join(labels)}")

    await goto(page, f"{BASE_URL}/project/{STUDENT_PROJECT_ID}")
    labels = await annotate(
        page,
        STUDENT_DIR / "S-03_学生工作台总览_标注.png",
        [
            Mark("左侧项目目标与成员信息", by_text("项目目标", exact=False)),
            Mark("任务阶段与过程支架提示区", by_text("任务阶段", exact=False)),
            Mark("协作工具标签栏", by_text("文档", exact=True)),
            Mark("右侧成员/聊天/教师支持侧栏", by_text("群组聊天", exact=False)),
        ],
        "S-03 学生工作台总览",
    )
    manifest.append(f"- S-03 学生工作台总览：{', '.join(labels)}")

    labels = await annotate(
        page,
        STUDENT_DIR / "S-04_任务阶段与工具建议_标注.png",
        [
            Mark("当前任务阶段", by_text("任务阶段", exact=False)),
            Mark("阶段切换按钮", by_text("1. 任务导入", exact=False)),
            Mark("阶段工具建议", by_text("建议", exact=True)),
            Mark("当前阶段推荐工具", by_text("推荐", exact=False)),
        ],
        "S-04 任务阶段与工具建议",
    )
    manifest.append(f"- S-04 任务阶段与工具建议：{', '.join(labels)}")

    await click_button(page, "文档", exact=False)
    labels = await annotate(
        page,
        STUDENT_DIR / "S-05_协作文档_标注.png",
        [
            Mark("协作文档标题栏", by_text("小组文档", exact=False)),
            Mark("加入 Wiki 按钮", by_text("加入 Wiki", exact=False)),
            Mark("文档编辑工具栏", by_css(".ProseMirror, [contenteditable='true']")),
            Mark("文档正文协作编辑区", by_css("[contenteditable='true']")),
        ],
        "S-05 协作文档",
    )
    manifest.append(f"- S-05 协作文档：{', '.join(labels)}")

    await click_button(page, "深度探究", exact=False)
    labels = await annotate(
        page,
        STUDENT_DIR / "S-07_深度探究空间_标注.png",
        [
            Mark("探究空间主入口", by_text("深度探究", exact=True)),
            Mark("灵感墙", by_text("灵感墙", exact=False)),
            Mark("论证画布", by_text("论证画布", exact=False)),
            Mark("AI 辩难/智能聚类工具", by_text("AI 辩难", exact=False)),
        ],
        "S-07 深度探究空间",
    )
    manifest.append(f"- S-07 深度探究空间：{', '.join(labels)}")

    await click_button(page, "资源库", exact=False)
    labels = await annotate(
        page,
        STUDENT_DIR / "S-09_资源库_标注.png",
        [
            Mark("资源库页面入口", by_text("资源库", exact=True)),
            Mark("课程/项目资源列表", by_text("资源", exact=False)),
            Mark("资源上传或管理入口", by_text("上传", exact=False)),
            Mark("资源搜索或筛选区域", by_text("搜索", exact=False)),
        ],
        "S-09 资源库",
    )
    manifest.append(f"- S-09 资源库：{', '.join(labels)}")

    await click_button(page, "项目 Wiki", exact=False)
    labels = await annotate(
        page,
        STUDENT_DIR / "S-10_项目Wiki_标注.png",
        [
            Mark("项目 Wiki 页面入口", by_text("项目 Wiki", exact=True)),
            Mark("Wiki 卡片列表", by_text("Wiki", exact=False)),
            Mark("搜索与筛选区域", by_text("搜索", exact=False)),
            Mark("新建 Wiki 卡片入口", by_text("新建", exact=False)),
        ],
        "S-10 项目 Wiki",
    )
    manifest.append(f"- S-10 项目 Wiki：{', '.join(labels)}")

    await click_text(page, "群组聊天", exact=False)
    labels = await annotate(
        page,
        STUDENT_DIR / "S-12_群组聊天_标注.png",
        [
            Mark("群组聊天标签", by_text("群组聊天", exact=False)),
            Mark("聊天消息列表", by_text("小组", exact=False)),
            Mark("消息输入框", by_placeholder("Type a message...")),
            Mark("@ 智能体与附件工具入口", by_text("@", exact=False)),
        ],
        "S-12 群组聊天",
    )
    manifest.append(f"- S-12 群组聊天：{', '.join(labels)}")

    await click_button(page, "AI 导师", exact=False)
    labels = await annotate(
        page,
        STUDENT_DIR / "S-14_AI导师_标注.png",
        [
            Mark("AI 导师独立问答区", by_text("AI 智能导师", exact=False)),
            Mark("本轮主要视角/处理摘要展示", by_text("主要视角", exact=False)),
            Mark("快捷提问建议", by_text("我们", exact=False)),
            Mark("AI 导师输入框", by_placeholder("向 AI 导师提问...")),
        ],
        "S-14 AI导师",
    )
    manifest.append(f"- S-14 AI导师：{', '.join(labels)}")

    await goto(page, f"{BASE_URL}/student/settings")
    labels = await annotate(
        page,
        STUDENT_DIR / "S-18_设置中心_标注.png",
        [
            Mark("学生端设置中心", by_text("设置", exact=False)),
            Mark("个人信息区域", by_text("个人", exact=False)),
            Mark("账号与安全相关设置", by_text("账号", exact=False)),
        ],
        "S-18 设置中心",
    )
    manifest.append(f"- S-18 设置中心：{', '.join(labels)}")


async def capture_teacher(page: Page, manifest: list[str]) -> None:
    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD)

    await goto(page, f"{BASE_URL}/teacher/overview")
    labels = await annotate(
        page,
        TEACHER_DIR / "T-02_教师端整体布局_标注.png",
        [
            Mark("教师端侧边导航", by_text("概览", exact=True)),
            Mark("教师端概览数据区", by_text("概览", exact=False)),
            Mark("账号与身份区", by_text("教师账号", exact=False)),
        ],
        "T-02 教师端整体布局",
    )
    manifest.append(f"- T-02 教师端整体布局：{', '.join(labels)}")

    await goto(page, f"{BASE_URL}/teacher/class-manager")
    labels = await annotate(
        page,
        TEACHER_DIR / "T-03_班级管理列表_标注.png",
        [
            Mark("班级管理入口", by_text("班级管理", exact=False)),
            Mark("创建班级按钮", by_text("创建班级", exact=False)),
            Mark("班级卡片/班级列表", by_text("2026", exact=False)),
            Mark("邀请码与实验模板信息", by_text("邀请码", exact=False)),
        ],
        "T-03 班级管理列表",
    )
    manifest.append(f"- T-03 班级管理列表：{', '.join(labels)}")

    try:
        await click_text(page, "创建新班级", exact=False)
    except Exception:
        pass
    labels = await annotate(
        page,
        TEACHER_DIR / "T-04_创建班级与项目说明_标注.png",
        [
            Mark("班级名称输入框", by_placeholder("例如：2026级软件工程1班")),
            Mark("所属学期选择框", by_text("所属学期", exact=False)),
            Mark("项目说明结构化字段", by_text("项目说明", exact=False)),
            Mark("任务背景/核心问题/协作要求/提交成果/评价要点", by_text("任务背景", exact=False)),
        ],
        "T-04 创建班级与项目说明",
    )
    manifest.append(f"- T-04 创建班级与项目说明：{', '.join(labels)}")

    await goto(page, f"{BASE_URL}/teacher/student-list")
    labels = await annotate(
        page,
        TEACHER_DIR / "T-08_学生列表与批量导入_标注.png",
        [
            Mark("学生列表入口", by_text("学生列表", exact=False)),
            Mark("按班级筛选学生", by_text("班级", exact=False)),
            Mark("批量导入学生账号", by_text("批量", exact=False)),
            Mark("学生账号列表", by_text("nenu", exact=False)),
        ],
        "T-08 学生列表与批量导入",
    )
    manifest.append(f"- T-08 学生列表与批量导入：{', '.join(labels)}")

    await goto(page, f"{BASE_URL}/teacher/resources")
    labels = await annotate(
        page,
        TEACHER_DIR / "T-10_课程资源中心_标注.png",
        [
            Mark("课程资源中心标题", by_text("课程资源中心", exact=False)),
            Mark("班级资源范围", by_text("班级", exact=False)),
            Mark("上传资源按钮", by_text("上传资源", exact=False)),
            Mark("资源列表与数量统计", by_text("文件总数", exact=False)),
        ],
        "T-10 课程资源中心",
    )
    manifest.append(f"- T-10 课程资源中心：{', '.join(labels)}")

    await goto(page, f"{BASE_URL}/teacher/project-manager")
    try:
        await click_text(page, "创建小组", exact=False)
    except Exception:
        pass
    labels = await annotate(
        page,
        TEACHER_DIR / "T-13_创建小组与组长设置_标注.png",
        [
            Mark("创建小组入口", by_text("创建小组", exact=False)),
            Mark("选择班级", by_text("班级", exact=False)),
            Mark("选择学生成员", by_text("学生", exact=False)),
            Mark("组长/负责人设置", by_text("组长", exact=False)),
        ],
        "T-13 创建小组与组长设置",
    )
    manifest.append(f"- T-13 创建小组与组长设置：{', '.join(labels)}")

    await goto(page, f"{BASE_URL}/teacher/project-manager")
    labels = await annotate(
        page,
        TEACHER_DIR / "T-15_小组管理列表_标注.png",
        [
            Mark("小组管理入口", by_text("小组管理", exact=False)),
            Mark("小组列表", by_text("小组1", exact=False)),
            Mark("进入仪表盘/管理按钮", by_text("仪表盘", exact=False)),
            Mark("小组成员与班级信息", by_text("成员", exact=False)),
        ],
        "T-15 小组管理列表",
    )
    manifest.append(f"- T-15 小组管理列表：{', '.join(labels)}")

    await goto(page, f"{BASE_URL}/teacher/project-monitor")
    labels = await annotate(
        page,
        TEACHER_DIR / "T-17_小组监控与教师支持_标注.png",
        [
            Mark("左侧班级/小组列表", by_text("小组1", exact=False)),
            Mark("中间小组状态卡片", by_text("最近活动", exact=False)),
            Mark("4C 与协作活跃度数据", by_text("4C", exact=False)),
            Mark("右侧教师支持面板", by_text("教师支持", exact=False)),
        ],
        "T-17 小组监控与教师支持",
    )
    manifest.append(f"- T-17 小组监控与教师支持：{', '.join(labels)}")

    await goto(page, f"{BASE_URL}/teacher/project-dashboard?project={STUDENT_PROJECT_ID}")
    labels = await annotate(
        page,
        TEACHER_DIR / "T-21_小组仪表盘与数据导出_标注.png",
        [
            Mark("小组仪表盘标题", by_text("小组仪表盘", exact=False)),
            Mark("4C 协作指标", by_text("4C", exact=False)),
            Mark("过程数据/行为事件区域", by_text("行为", exact=False)),
            Mark("数据导出入口", by_text("导出", exact=False)),
        ],
        "T-21 小组仪表盘与数据导出",
    )
    manifest.append(f"- T-21 小组仪表盘与数据导出：{', '.join(labels)}")

    await goto(page, f"{BASE_URL}/teacher/settings")
    labels = await annotate(
        page,
        TEACHER_DIR / "T-25_教师设置_标注.png",
        [
            Mark("教师设置入口", by_text("设置", exact=False)),
            Mark("个人资料", by_text("个人", exact=False)),
            Mark("系统偏好设置", by_text("偏好", exact=False)),
        ],
        "T-25 教师设置",
    )
    manifest.append(f"- T-25 教师设置：{', '.join(labels)}")


async def main() -> None:
    STUDENT_DIR.mkdir(parents=True, exist_ok=True)
    TEACHER_DIR.mkdir(parents=True, exist_ok=True)
    manifest: list[str] = [
        "# AISCL 云服务器版操作说明截图清单",
        "",
        f"- 来源：{BASE_URL}",
        "- 标注方式：界面中仅使用编号红框，说明文字放在底部图例区，避免遮挡页面内容。",
        "",
    ]

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(viewport={"width": 1440, "height": 1040}, device_scale_factor=1)
        page = await context.new_page()
        await capture_student(page, manifest)
        await context.clear_cookies()
        await capture_teacher(page, manifest)
        await browser.close()

    (OUT_DIR / "截图清单.md").write_text("\n".join(manifest) + "\n", encoding="utf-8")
    make_contact_sheet()


def make_contact_sheet() -> None:
    images = sorted(STUDENT_DIR.glob("*_标注.png")) + sorted(TEACHER_DIR.glob("*_标注.png"))
    if not images:
        return
    thumbs: list[Image.Image] = []
    labels: list[str] = []
    for path in images:
        im = Image.open(path).convert("RGB")
        im.thumbnail((360, 260))
        thumbs.append(im.copy())
        labels.append(path.stem.replace("_标注", ""))
    cols = 3
    cell_w, cell_h = 410, 320
    rows = math.ceil(len(thumbs) / cols)
    sheet = Image.new("RGB", (cols * cell_w, rows * cell_h), "#f8fafc")
    draw = ImageDraw.Draw(sheet)
    for i, (thumb, label) in enumerate(zip(thumbs, labels)):
        col = i % cols
        row = i // cols
        x = col * cell_w + 24
        y = row * cell_h + 20
        sheet.paste(thumb, (x, y))
        draw.text((x, y + thumb.height + 10), label, fill="#111827", font=FONT_SMALL)
    sheet.save(OUT_DIR / "截图总览.png")


if __name__ == "__main__":
    asyncio.run(main())
