import json
from typing import Optional
from langchain_openai import ChatOpenAI
from langchain_community.llms import Ollama
from app.core.config import settings
from app.repositories.system_config import SystemConfig


def _is_real_secret(value: Optional[str]) -> bool:
    """Avoid treating masked UI placeholders as usable API keys."""
    return bool(value and "•••" not in value and value.strip())


async def _get_config_value(key: str) -> Optional[str]:
    config = await SystemConfig.find_one(SystemConfig.key == key)
    if not config:
        return None
    value = config.value.strip() if isinstance(config.value, str) else config.value
    return value or None


async def get_llm(temperature: float = 0.7):
    """Get LLM instance based on database or env configuration."""
    use_db_config = settings.LLM_CONFIG_SOURCE.lower() == "db"

    # 1. Try to get active model and custom definitions from DB
    active_model_id = None
    db_provider = None
    db_api_key = None
    db_base_url = None
    custom_models_config = None
    if use_db_config:
        try:
            active_model_id = await SystemConfig.find_one(SystemConfig.key == "llm_model")
            db_provider = await _get_config_value("llm_provider")
            db_api_key = await _get_config_value("llm_key")
            db_base_url = await _get_config_value("llm_base_url")
            custom_models_config = await SystemConfig.find_one(SystemConfig.key == "user_custom_models")
            
            if active_model_id and custom_models_config:
                custom_models = json.loads(custom_models_config.value)
                # Find the active model in custom definitions
                custom_def = next((m for m in custom_models if m["id"] == active_model_id.value), None)
                
                if custom_def:
                    print(f"[LLMConfig] Using custom model: {custom_def['name']} ({custom_def['id']})")
                    # Custom models are usually OpenAI compatible
                    return ChatOpenAI(
                        model=custom_def["id"],
                        temperature=temperature,
                        openai_api_key=custom_def["key"],
                        openai_api_base=custom_def["url"],
                    )
        except Exception as e:
            print(f"[LLMConfig] Error fetching custom LLM config: {e}")

    # 2. Fallback to default providers based on settings/active_model_id
    provider = (db_provider or settings.LLM_PROVIDER).lower()
    model_name = None
    
    if use_db_config and active_model_id:
        model_name = active_model_id.value
        if not db_provider and model_name in ["gpt-4o", "gpt-3.5-turbo"]:
            provider = "openai"
        elif not db_provider and model_name in ["deepseek-chat", "deepseek-reasoner"]:
            provider = "deepseek"
        elif not db_provider and model_name == "ollama":
            provider = "ollama"
    
    print(f"[LLMConfig] Initializing provider: {provider}, model: {model_name or 'default'}")

    if provider in ["openai", "openai_compatible", "openai-compatible", "minimax"]:
        api_key = db_api_key if use_db_config and _is_real_secret(db_api_key) else settings.OPENAI_API_KEY
        if use_db_config:
            db_key = await SystemConfig.find_one(SystemConfig.key == "llm_key")
            api_key = db_key.value if db_key and _is_real_secret(db_key.value) else api_key

        llm_kwargs = {
            "model": active_model_id.value if use_db_config and active_model_id else settings.OPENAI_MODEL,
            "temperature": temperature,
            "openai_api_key": api_key,
        }
        base_url = db_base_url if use_db_config and db_base_url else settings.OPENAI_BASE_URL
        if base_url:
            llm_kwargs["openai_api_base"] = base_url
        return ChatOpenAI(**llm_kwargs)
    elif provider == "ollama":
        return Ollama(
            model=settings.OLLAMA_MODEL,
            base_url=db_base_url if use_db_config and db_base_url else settings.OLLAMA_BASE_URL,
            temperature=temperature,
        )
    elif provider in ["deepseek", "deepseek-chat"]:
        api_key = db_api_key if use_db_config and _is_real_secret(db_api_key) else settings.DEEPSEEK_API_KEY
        if use_db_config:
            db_key = await SystemConfig.find_one(SystemConfig.key == "llm_key")
            api_key = db_key.value if db_key and _is_real_secret(db_key.value) else api_key
        return ChatOpenAI(
            model=active_model_id.value if use_db_config and active_model_id else settings.DEEPSEEK_MODEL,
            temperature=temperature,
            openai_api_key=api_key,
            openai_api_base=db_base_url if use_db_config and db_base_url else settings.DEEPSEEK_BASE_URL,
        )
    else:
        raise ValueError(f"Unsupported AI provider: {provider}")


async def get_llm_for_role(role_name: str, temperature: Optional[float] = None):
    """Get LLM instance for a specific AI role (Async)."""
    if temperature is None:
        temperature = 0.7
    return await get_llm(temperature=temperature)
