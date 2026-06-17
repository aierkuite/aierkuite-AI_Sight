import logging

from fastapi import APIRouter, Response
from fastapi.responses import JSONResponse

from app.errors import to_user_message
from app.schemas import TtsRequest
from app.services.tts import synthesize_audio

router = APIRouter()
logger = logging.getLogger(__name__)


@router.post("/tts")
async def tts(request: TtsRequest) -> Response:
    """处理 /api/tts 请求并返回 wav 二进制音频

    参数:
        request: 前端提交的单句播报文本
    返回:
        成功时返回 audio/wav 响应，失败时返回安全中文错误 JSON
    """
    try:
        audio = await synthesize_audio(request.text)
    except Exception as exc:
        logger.error(
            "/api/tts failed: error_type=%s",
            type(exc).__name__,
            exc_info=True,
        )
        return JSONResponse(
            status_code=502,
            content={"message": to_user_message(exc)},
        )
    return Response(content=audio, media_type="audio/wav")
