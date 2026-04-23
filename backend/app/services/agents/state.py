"""Agent State Definition."""

from typing import TypedDict, Annotated, List, Union, Dict, Any
from langchain_core.messages import BaseMessage
import operator

class AgentState(TypedDict):
    """The state of the collaborative learning agent system."""
    
    # 消息历史 (The conversation history)
    # Annotated with operator.add means updates will be appended, not overwritten
    messages: Annotated[List[BaseMessage], operator.add]
    
    # 协作上下文 (Collaborative Context)
    project_id: str
    user_id: str
    phase: str  # 当前协作阶段: "onboarding", "planning", "execution", "review"
    
    # Deep Agents Planning
    # The supervisor maintains a high-level plan across multiple turns
    plan: List[str] 
    
    # Scratchpad for agents to share intermediate results (Context Quarantine buffer)
    scratchpad: Dict[str, Any]
    
    # 路由决策 (Who should act next)
    next_agent: str
