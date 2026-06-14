import asyncio
import base64
import binascii
import json
import logging
import time
from collections.abc import AsyncIterator

from fastapi import APIRouter, HTTPException, status
from sse_starlette.sse import EventSourceResponse

from app.config import get_settings
from app.errors import to_user_message
from app.schemas import ChatRequest
from app.services.llm import stream_chat

router = APIRouter()
logger = logging.getLogger(__name__)


def decoded_image_size(image_b64: str | None) -> int:
    """计算 base64 图片解码后的字节数

    参数:
        image_b64: 前端提交的 base64 JPEG 字符串或 None
    返回:
        图片字节数，无图片时返回 0
    """
    if image_b64 is None:
        return 0
    try:
        return len(base64.b64decode(image_b64, validate=True))
    except (binascii.Error, ValueError) as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="图片格式无效，请提交 base64 JPEG",
        ) from exc


def validate_image_size(image_b64: str | None) -> int:
    """校验图片大小不超过配置上限

    参数:
        image_b64: 前端提交的 base64 JPEG 字符串或 None
    返回:
        图片字节数，无图片时返回 0
    """
    image_bytes = decoded_image_size(image_b64)
    settings = get_settings()
    if image_bytes > settings.max_image_bytes:
        logger.warning("拒绝超限图片: image_bytes=%d", image_bytes)
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="图片过大，请靠近目标后重新提问",
        )
    return image_bytes


@router.post("/chat")
async def chat(request: ChatRequest) -> EventSourceResponse:
    """处理 /api/chat 请求并返回 SSE 流

    参数:
        request: 前端提交的问题、当前截图和纯文本历史
    返回:
        按合同输出 delta、done 或 error 事件的 EventSourceResponse
    """
    settings = get_settings()
    image_bytes = validate_image_size(request.image)
    history_rounds = min(len(request.history) // 2, settings.max_history_rounds)
    logger.info(
        "/api/chat received: model=%s image_bytes=%d history_rounds=%d",
        settings.openai_model,
        image_bytes,
        history_rounds,
    )

    async def event_source() -> AsyncIterator[dict[str, str]]:
        """把模型 delta 包装为 SSE 帧

        参数:
            无
        返回:
            逐个产出 sse-starlette 可识别的事件字典
        """
        started_at = time.perf_counter()
        try:
            async for delta in stream_chat(
                request.text, request.image, request.history
            ):
                yield {"data": json.dumps({"delta": delta}, ensure_ascii=False)}
            elapsed_ms = int((time.perf_counter() - started_at) * 1000)
            logger.info("/api/chat completed: duration_ms=%d", elapsed_ms)
            yield {"event": "done", "data": "{}"}
        except asyncio.CancelledError:
            elapsed_ms = int((time.perf_counter() - started_at) * 1000)
            logger.warning("/api/chat cancelled: duration_ms=%d", elapsed_ms)
            raise
        except Exception as exc:
            elapsed_ms = int((time.perf_counter() - started_at) * 1000)
            logger.error(
                "/api/chat failed: error_type=%s duration_ms=%d",
                type(exc).__name__,
                elapsed_ms,
                exc_info=True,
            )
            yield {
                "event": "error",
                "data": json.dumps(
                    {"message": to_user_message(exc)}, ensure_ascii=False
                ),
            }

    return EventSourceResponse(event_source())
