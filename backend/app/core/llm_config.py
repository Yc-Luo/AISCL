import json
from typing import Any, Dict, Optional
from langchain_openai import ChatOpenAI
from langchain_community.llms import Ollama
from app.core.config import settings
from app.repositories.system_config import SystemConfig


def _is_real_secret(value: Optional[str]) -> bool:
    """Avoid treating masked UI placeholders as usable API keys."""
    return bool(value and "•••" not in value and value.strip())


def _normalize_provider(value: Optional[str]) -> str:
    """Normalize provider names entered in the admin panel."""
    provider = (value or "").strip().lower().replace(" ", "_")
    aliases = {
        "siliconflow": "openai_compatible",
        "openrouter": "openai_compatible",
        "dashscope": "openai_compatible",
        "aliyun": "openai_compatible",
        "qwen": "openai_compatible",
        "zhipu": "openai_compatible",
        "moonshot": "openai_compatible",
        "minimax": "openai_compatible",
        "openai-compatible": "openai_compatible",
    }
    return aliases.get(provider, provider)


async def _get_config_value(key: str) -> Optional[str]:
    config = await SystemConfig.find_one(SystemConfig.key == key)
    if not config:
        return None
    value = config.value.strip() if isinstance(config.value, str) else config.value
    return value or None


DEFAULT_MODEL_ALIASES = {
    "",
    "default",
    "default_chat_model",
    "follow_system_default",
    "system",
    "system_default",
}


def _is_default_model_id(model_id: Optional[str]) -> bool:
    return (model_id or "").strip() in DEFAULT_MODEL_ALIASES


async def _get_json_config(key: str, fallback: Any) -> Any:
    value = await _get_config_value(key)
    if not value:
        return fallback
    try:
        return json.loads(value)
    except Exception:
        return fallback


async def _find_model_definition(model_id: Optional[str]) -> Optional[Dict[str, Any]]:
    """Resolve model definitions from admin custom models or research model pool."""
    if _is_default_model_id(model_id):
        return None
    target = str(model_id).strip()
    for key in ("user_custom_models", "research_model_pool"):
        items = await _get_json_config(key, [])
        if not isinstance(items, list):
            continue
        for item in items:
            if not isinstance(item, dict):
                continue
            if str(item.get("id") or "").strip() == target:
                return item
    return None


async def get_llm(temperature: float = 0.7, model_id: Optional[str] = None):
    """Get LLM instance based on database or env configuration."""
    use_db_config = settings.LLM_CONFIG_SOURCE.lower() == "db"

    # 1. Try to get active model and custom definitions from DB
    active_model_id = None
    db_provider = None
    db_api_key = None
    db_base_url = None
    runtime_model_definition = None
    if use_db_config:
        try:
            active_model_id = await SystemConfig.find_one(SystemConfig.key == "llm_model")
            db_provider = await _get_config_value("llm_provider")
            db_api_key = await _get_config_value("llm_key")
            db_base_url = await _get_config_value("llm_base_url")
            runtime_model_definition = await _find_model_definition(model_id)
        except Exception as e:
            print(f"[LLMConfig] Error fetching custom LLM config: {e}")

    # 2. Fallback to default providers based on settings/active_model_id
    provider = _normalize_provider(db_provider or settings.LLM_PROVIDER)
    model_name = None
    override_base_url = None
    override_api_key = None
    
    if runtime_model_definition:
        model_name = str(runtime_model_definition.get("id") or model_id or "").strip()
        provider = _normalize_provider(runtime_model_definition.get("provider") or provider)
        override_base_url = (
            runtime_model_definition.get("base_url")
            or runtime_model_definition.get("url")
            or runtime_model_definition.get("api_base")
        )
        override_api_key = (
            runtime_model_definition.get("key")
            or runtime_model_definition.get("api_key")
        )
        print(f"[LLMConfig] Using runtime model: {runtime_model_definition.get('name') or model_name} ({model_name})")
    elif not _is_default_model_id(model_id):
        model_name = str(model_id).strip()
    elif use_db_config and active_model_id:
        model_name = active_model_id.value
        if not db_provider and model_name in ["gpt-4o", "gpt-3.5-turbo"]:
            provider = "openai"
        elif not db_provider and model_name in ["deepseek-chat", "deepseek-reasoner"]:
            provider = "deepseek"
        elif not db_provider and model_name == "ollama":
            provider = "ollama"
    
    print(f"[LLMConfig] Initializing provider: {provider}, model: {model_name or 'default'}")

    if provider in ["openai", "openai_compatible"]:
        api_key = (
            override_api_key
            if _is_real_secret(override_api_key)
            else db_api_key if use_db_config and _is_real_secret(db_api_key)
            else settings.OPENAI_API_KEY
        )
        if use_db_config:
            db_key = await SystemConfig.find_one(SystemConfig.key == "llm_key")
            api_key = (
                api_key
                if _is_real_secret(override_api_key)
                else db_key.value if db_key and _is_real_secret(db_key.value)
                else api_key
            )

        llm_kwargs = {
            "model": model_name or settings.OPENAI_MODEL,
            "temperature": temperature,
            "openai_api_key": api_key,
            "max_tokens": settings.LLM_MAX_OUTPUT_TOKENS,
            "timeout": settings.LLM_REQUEST_TIMEOUT_SECONDS,
            "max_retries": 2,
        }
        base_url = override_base_url or (db_base_url if use_db_config and db_base_url else settings.OPENAI_BASE_URL)
        if base_url:
            llm_kwargs["openai_api_base"] = base_url
        return ChatOpenAI(**llm_kwargs)
    elif provider == "ollama":
        return Ollama(
            model=model_name or settings.OLLAMA_MODEL,
            base_url=override_base_url or (db_base_url if use_db_config and db_base_url else settings.OLLAMA_BASE_URL),
            temperature=temperature,
        )
    elif provider in ["deepseek", "deepseek-chat"]:
        api_key = (
            override_api_key
            if _is_real_secret(override_api_key)
            else db_api_key if use_db_config and _is_real_secret(db_api_key)
            else settings.DEEPSEEK_API_KEY
        )
        if use_db_config:
            db_key = await SystemConfig.find_one(SystemConfig.key == "llm_key")
            api_key = (
                api_key
                if _is_real_secret(override_api_key)
                else db_key.value if db_key and _is_real_secret(db_key.value)
                else api_key
            )
        return ChatOpenAI(
            model=model_name or settings.DEEPSEEK_MODEL,
            temperature=temperature,
            openai_api_key=api_key,
            openai_api_base=override_base_url or (db_base_url if use_db_config and db_base_url else settings.DEEPSEEK_BASE_URL),
            max_tokens=settings.LLM_MAX_OUTPUT_TOKENS,
            timeout=settings.LLM_REQUEST_TIMEOUT_SECONDS,
            max_retries=2,
        )
    else:
        raise ValueError(f"Unsupported AI provider: {provider}")


async def get_llm_for_role(role_name: str, temperature: Optional[float] = None):
    """Get LLM instance for a specific AI role (Async)."""
    if temperature is None:
        temperature = 0.7
    return await get_llm(temperature=temperature)
