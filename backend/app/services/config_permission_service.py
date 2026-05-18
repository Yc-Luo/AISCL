"""Teacher-scoped research configuration permission helpers."""

from __future__ import annotations

import json
from typing import Any, Dict, Iterable, List, Optional

from app.repositories.system_config import SystemConfig
from app.repositories.user import User


class ConfigPermissionService:
    """Centralize teacher access checks for research templates and models."""

    MODEL_POOL_KEY = "research_model_pool"

    @staticmethod
    def _permissions(user: Optional[User]) -> Optional[Dict[str, Any]]:
        if not user or user.role == "admin":
            return None
        permissions = user.config_permissions
        if not permissions:
            return None
        return permissions

    @staticmethod
    def _allows(permissions: Optional[Dict[str, Any]], key: str, value: Optional[str]) -> bool:
        """Return whether value is allowed.

        Missing key means unrestricted for backward compatibility. Present empty
        list means intentionally no access.
        """
        if not permissions or not value:
            return True
        if key not in permissions:
            return True
        allowed_values = permissions.get(key)
        if not isinstance(allowed_values, list):
            return True
        return value in {str(item) for item in allowed_values}

    def template_is_allowed(self, user: Optional[User], template: Dict[str, Any]) -> bool:
        permissions = self._permissions(user)
        template_key = str(template.get("key") or template.get("id") or "").strip()
        rule_set = str(template.get("rule_set") or template.get("ruleSet") or "").strip()
        return self._allows(permissions, "allowed_template_ids", template_key) and self._allows(
            permissions, "allowed_rule_profile_ids", rule_set
        )

    def filter_templates(self, user: Optional[User], templates: Iterable[Dict[str, Any]]) -> List[Dict[str, Any]]:
        return [template for template in templates if self.template_is_allowed(user, template)]

    def validate_template(self, user: Optional[User], template: Optional[Dict[str, Any]]) -> Optional[str]:
        if not template:
            return "Experiment template key is not available in admin releases or legacy presets"
        if self.template_is_allowed(user, template):
            return None
        return "Current teacher is not allowed to use this experiment template or its rule profile"

    def model_is_allowed(self, user: Optional[User], model_id: Optional[str]) -> bool:
        permissions = self._permissions(user)
        return self._allows(permissions, "allowed_model_ids", model_id)

    async def get_model_options(self) -> List[Dict[str, Any]]:
        """Return configured model pool options for permission assignment."""
        options: List[Dict[str, Any]] = []
        seen: set[str] = set()

        async def add_from_config(key: str, parser) -> None:
            config = await SystemConfig.find_one(SystemConfig.key == key)
            if not config or not config.value:
                return
            try:
                parser(config.value)
            except Exception:
                return

        def add_model(model: Dict[str, Any]) -> None:
            model_id = str(model.get("id") or model.get("model") or "").strip()
            if not model_id or model_id in seen:
                return
            options.append(
                {
                    "id": model_id,
                    "name": str(model.get("name") or model_id),
                    "provider": str(model.get("provider") or "openai_compatible"),
                    "base_url": str(model.get("base_url") or model.get("url") or ""),
                }
            )
            seen.add(model_id)

        def parse_model_pool(value: str) -> None:
            parsed = json.loads(value)
            if isinstance(parsed, list):
                for item in parsed:
                    if isinstance(item, dict):
                        add_model(item)

        await add_from_config(self.MODEL_POOL_KEY, parse_model_pool)
        await add_from_config("user_custom_models", parse_model_pool)

        llm_model = await SystemConfig.find_one(SystemConfig.key == "llm_model")
        llm_provider = await SystemConfig.find_one(SystemConfig.key == "llm_provider")
        llm_base_url = await SystemConfig.find_one(SystemConfig.key == "llm_base_url")
        if llm_model and llm_model.value:
            add_model(
                {
                    "id": llm_model.value,
                    "name": llm_model.value,
                    "provider": llm_provider.value if llm_provider else "openai_compatible",
                    "base_url": llm_base_url.value if llm_base_url else "",
                }
            )

        if "follow_system_default" not in seen:
            options.insert(
                0,
                {
                    "id": "follow_system_default",
                    "name": "跟随系统默认模型",
                    "provider": "system",
                    "base_url": "",
                },
            )
        return options


config_permission_service = ConfigPermissionService()
