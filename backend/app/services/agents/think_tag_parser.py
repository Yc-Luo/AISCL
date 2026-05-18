"""Parser for model-provided processing summaries wrapped in think-like tags."""

from __future__ import annotations

from typing import Dict, List


class ThinkTagParser:
    """Split `<think>...</think>` chunks from user-visible answer chunks.

    AISCL uses this only for a short, user-facing processing summary. It must not
    expose raw chain-of-thought or hidden model reasoning.
    """

    def __init__(self, agent: str, label: str):
        self.agent = agent
        self.label = label
        self.buffer = ""
        self.in_think = False
        self.think_seen = False
        self.output_started = False

    def feed(self, chunk: str) -> List[Dict[str, str]]:
        if not chunk:
            return []
        self.buffer += chunk
        events: List[Dict[str, str]] = []

        while self.buffer:
            if not self.think_seen and not self.output_started:
                start = self.buffer.find("<think>")
                if start == -1:
                    if len(self.buffer) < len("<think>") and "<think>".startswith(self.buffer):
                        break
                    self.output_started = True
                    content = self.buffer
                    self.buffer = ""
                    events.append(self._event("output", content))
                    break
                if start > 0:
                    events.append(self._event("output", self.buffer[:start]))
                self.buffer = self.buffer[start + len("<think>"):]
                self.in_think = True
                self.think_seen = True
                events.append(self._event("thinking_start", ""))

            if self.in_think:
                end = self.buffer.find("</think>")
                if end == -1:
                    if self.buffer:
                        events.append(self._event("thinking", self.buffer))
                        self.buffer = ""
                    break
                if end > 0:
                    events.append(self._event("thinking", self.buffer[:end]))
                self.buffer = self.buffer[end + len("</think>"):]
                self.in_think = False
                self.output_started = True
                events.append(self._event("thinking_end", ""))
                continue

            if self.output_started:
                content = self.buffer
                self.buffer = ""
                events.append(self._event("output", content))
                break

        return [event for event in events if event["type"].endswith("_start") or event["type"].endswith("_end") or event.get("content")]

    def flush(self) -> List[Dict[str, str]]:
        if not self.buffer:
            return []
        event_type = "thinking" if self.in_think else "output"
        content = self.buffer
        self.buffer = ""
        events = [self._event(event_type, content)]
        if self.in_think:
            self.in_think = False
            events.append(self._event("thinking_end", ""))
        return events

    def _event(self, event_type: str, content: str) -> Dict[str, str]:
        return {
            "type": event_type,
            "agent": self.agent,
            "label": self.label,
            "content": content,
        }
