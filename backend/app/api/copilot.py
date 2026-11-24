"""Scenario Copilot endpoints (Phase 7B). They only TRANSLATE text into a simulation request;
the UI then posts the (possibly edited) JSON to the normal POST /api/simulate."""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from .. import copilot
from ..config import COPILOT_MAX_PROMPT_CHARS

router = APIRouter(prefix="/api/copilot", tags=["copilot"])


class ParseRequest(BaseModel):
    prompt: str = Field(..., min_length=1, max_length=COPILOT_MAX_PROMPT_CHARS,
                        examples=["Generate 2 hours of data with bearing wear starting at minute 40, high severity"])
    use_claude: bool = Field(True, description="false = force the rule-based parser even if an API key is set")


class FieldError(BaseModel):
    loc: str
    msg: str


class ParseOut(BaseModel):
    parser: str = Field(..., description="'claude' or 'rules' - which parser produced `request`")
    model: str | None = Field(None, description="Claude model name when parser == 'claude'")
    claude_available: bool
    request: dict[str, Any] = Field(..., description="A SimulateRequest (feed it to POST /api/simulate)")
    valid: bool
    errors: list[FieldError]
    warnings: list[str]
    notes: list[str]
    fallback_reason: str | None = Field(None, description="Set when Claude was tried and failed, so the rules were used")


class ValidateRequest(BaseModel):
    request: Any


class ValidateOut(BaseModel):
    valid: bool
    errors: list[FieldError]


@router.get("/status")
def status():
    """Is a Claude key configured? (The key itself is never returned.)"""
    return {"claude_available": copilot.claude_available(), "model": copilot.claude_model(),
            "parser": "claude" if copilot.claude_available() else "rules",
            "max_prompt_chars": COPILOT_MAX_PROMPT_CHARS}


@router.post("/parse", response_model=ParseOut)
def parse(req: ParseRequest):
    try:
        return copilot.parse_prompt(req.prompt, use_claude=req.use_claude)
    except ValueError as exc:
        raise HTTPException(422, str(exc))


@router.post("/validate", response_model=ValidateOut)
def validate(req: ValidateRequest):
    """Check an edited request without running it. Same checks as /api/simulate, plus unknown-field hints."""
    errors = copilot.validate_request(req.request)
    return {"valid": not errors, "errors": errors}
