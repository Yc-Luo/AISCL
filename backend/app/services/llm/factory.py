"""LLM Factory to instantiate providers."""

from app.core.config import settings
from app.services.llm.base import LLMProvider
from app.services.llm.openai_provider import OpenAIProvider
from app.services.llm.deepseek_provider import DeepSeekProvider


class LLMFactory:
    """Factory for creating LLM providers."""
    
    _instances = {}

    @classmethod
    def get_provider(cls, provider_name: str = None) -> LLMProvider:
        """Get or create an LLM provider instance.
        
        Args:
            provider_name: 'openai', 'deepseek', etc.
            
        Returns:
            An instance of LLMProvider
        """
        if not provider_name:
            provider_name = getattr(settings, "LLM_PROVIDER", "openai").lower()
            
        if provider_name in cls._instances:
            return cls._instances[provider_name]
        
        if provider_name == "openai":
            instance = OpenAIProvider()
        elif provider_name == "deepseek":
            instance = DeepSeekProvider()
        else:
            raise ValueError(f"Unknown LLM provider: {provider_name}")
            
        cls._instances[provider_name] = instance
        return instance
