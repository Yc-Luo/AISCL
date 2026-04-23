"""OpenAI LLM provider implementation."""

from typing import List, Dict, Any
import openai

from app.core.config import settings
from app.services.llm.base import LLMProvider


class OpenAIProvider(LLMProvider):
    """OpenAI implementation of LLM provider."""

    def __init__(self):
        """Initialize OpenAI client."""
        # Note: In newer openai versions, client instantiation might differ
        # This assumes compatibility with v1.x+ or usage of global config if older
        if hasattr(settings, "OPENAI_API_KEY") and settings.OPENAI_API_KEY:
            self.client = openai.AsyncOpenAI(api_key=settings.OPENAI_API_KEY)
        else:
            self.client = None

    async def generate_text(self, prompt: str, **kwargs) -> str:
        """Generate text from prompt using OpenAI."""
        if not self.client:
            raise ValueError("OpenAI client not initialized")
            
        model = kwargs.get("model", "gpt-3.5-turbo")
        
        response = await self.client.chat.completions.create(
            model=model,
            messages=[{"role": "user", "content": prompt}],
            **kwargs
        )
        
        return response.choices[0].message.content

    async def generate_embedding(self, text: str) -> List[float]:
        """Generate embedding for text using OpenAI."""
        if not self.client:
            raise ValueError("OpenAI client not initialized")
            
        # Default to text-embedding-3-small or as configured
        model = getattr(settings, "OPENAI_EMBEDDING_MODEL", "text-embedding-3-small")
        
        response = await self.client.embeddings.create(
            input=text,
            model=model
        )
        
        return response.data[0].embedding

    async def chat_completion(self, messages: List[Dict[str, str]], **kwargs) -> Any:
        """Generate chat completion using OpenAI."""
        if not self.client:
            raise ValueError("OpenAI client not initialized")

        model = kwargs.get("model", "gpt-4")
        
        return await self.client.chat.completions.create(
            model=model,
            messages=messages,
            **kwargs
        )
