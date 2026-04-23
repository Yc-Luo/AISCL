"""DeepSeek LLM provider implementation."""

from typing import List, Dict, Any
import httpx
from tenacity import retry, stop_after_attempt, wait_exponential

from app.core.config import settings
from app.services.llm.base import LLMProvider


class DeepSeekProvider(LLMProvider):
    """DeepSeek implementation of LLM provider."""

    def __init__(self):
        """Initialize DeepSeek configuration."""
        self.api_key = getattr(settings, "DEEPSEEK_API_KEY", "")
        self.base_url = "https://api.deepseek.com/v1"  # Adjust as needed
        self.timeout = 60.0

    async def generate_text(self, prompt: str, **kwargs) -> str:
        """Generate text from prompt using DeepSeek."""
        messages = [{"role": "user", "content": prompt}]
        response = await self.chat_completion(messages, **kwargs)
        # Assuming standard OpenAI-compatible response format
        return response["choices"][0]["message"]["content"]

    @retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=2, max=10))
    async def generate_embedding(self, text: str) -> List[float]:
        """Generate embedding for text using DeepSeek (if supported) or fallback.
        
        Note: If DeepSeek doesn't support embeddings directly in this endpoint, 
        you typically use a different model or service. This is a placeholder 
        assuming OpenAI-compatible API structure.
        """
        # DeepSeek might not have a dedicated embedding endpoint 
        # or it might be different. If not supported, we might need a fallback.
        # For this implementation, we'll try the standard structure.
        
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            try:
                # This endpoint is hypothetical based on OpenAI compatibility provided by DeepSeek
                response = await client.post(
                    f"{self.base_url}/embeddings",
                    headers={"Authorization": f"Bearer {self.api_key}"},
                    json={
                        "input": text,
                        "model": "deepseek-embedding" # Placeholder model name
                    }
                )
                response.raise_for_status()
                data = response.json()
                return data["data"][0]["embedding"]
            except Exception as e:
                # If DeepSeek doesn't support embedding, raise or log
                print(f"Error generating embedding with DeepSeek: {e}")
                # Fallback or re-raise
                raise

    async def chat_completion(self, messages: List[Dict[str, str]], **kwargs) -> Any:
        """Generate chat completion using DeepSeek."""
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.api_key}"
        }
        
        payload = {
            "model": kwargs.get("model", "deepseek-chat"),
            "messages": messages,
            "temperature": kwargs.get("temperature", 0.7),
            "max_tokens": kwargs.get("max_tokens", 2048)
        }
        
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            response = await client.post(
                f"{self.base_url}/chat/completions",
                headers=headers,
                json=payload
            )
            response.raise_for_status()
            return response.json()
