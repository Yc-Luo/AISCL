"""Abstract base class for LLM providers."""

from abc import ABC, abstractmethod
from typing import List, Optional, Dict, Any


class LLMProvider(ABC):
    """Abstract base class for LLM providers."""

    @abstractmethod
    async def generate_text(self, prompt: str, **kwargs) -> str:
        """Generate text from prompt.
        
        Args:
            prompt: The input prompt
            **kwargs: Additional model parameters
            
        Returns:
            Generated text string
        """
        pass

    @abstractmethod
    async def generate_embedding(self, text: str) -> List[float]:
        """Generate embedding for text.
        
        Args:
            text: The input text to embed
            
        Returns:
            List of floats representing the embedding vector
        """
        pass

    @abstractmethod
    async def chat_completion(self, messages: List[Dict[str, str]], **kwargs) -> Any:
        """Generate chat completion.
        
        Args:
            messages: List of message dicts with 'role' and 'content'
            **kwargs: Additional model parameters
            
        Returns:
            Completion response
        """
        pass
