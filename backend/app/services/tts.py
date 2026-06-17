import httpx

from app.config import get_settings
from app.errors import AppError
from app.services.audio_filter import reduce_wav_background_noise

_client: httpx.AsyncClient | None = None


def get_tts_client() -> httpx.AsyncClient:
    """创建并复用 GPT-SoVITS api_v2 异步 HTTP 客户端

    参数:
        无
    返回:
        可用于逐句语音合成的 httpx.AsyncClient 客户端
    """
    global _client
    if _client is None:
        settings = get_settings()
        _client = httpx.AsyncClient(
            base_url=settings.gpt_sovits_base_url,
            timeout=settings.gpt_sovits_timeout_seconds,
        )
    return _client


async def close_tts_client() -> None:
    """关闭 GPT-SoVITS HTTP 客户端并释放连接池

    参数:
        无
    返回:
        无
    """
    global _client
    if _client is not None:
        await _client.aclose()
        _client = None


async def synthesize_audio(text: str) -> bytes:
    """把文本合成为 wav 音频字节

    参数:
        text: 已通过请求模型校验的播报文本
    返回:
        GPT-SoVITS api_v2 返回并完成可选后处理的 wav 二进制内容
    """
    settings = get_settings()
    payload = {
        "text": text,
        "text_lang": settings.gpt_sovits_text_lang,
        "ref_audio_path": settings.gpt_sovits_ref_audio_path,
        "prompt_text": settings.gpt_sovits_prompt_text,
        "prompt_lang": settings.gpt_sovits_prompt_lang,
        "text_split_method": settings.gpt_sovits_text_split_method,
        "media_type": "wav",
        "streaming_mode": False,
    }
    client = get_tts_client()
    try:
        response = await client.post("/tts", json=payload)
        response.raise_for_status()
    except httpx.TimeoutException as exc:
        raise AppError("语音合成服务响应超时，请稍后再试") from exc
    except httpx.ConnectError as exc:
        raise AppError("无法连接语音合成服务，请确认 GPT-SoVITS 已启动") from exc
    except httpx.HTTPStatusError as exc:
        raise AppError("语音合成服务返回错误，请稍后再试") from exc

    audio = response.content
    if not settings.gpt_sovits_audio_filter_enabled:
        return audio
    return reduce_wav_background_noise(
        audio,
        threshold_db=settings.gpt_sovits_noise_gate_threshold_db,
        attenuation=settings.gpt_sovits_noise_gate_attenuation,
        highpass_hz=settings.gpt_sovits_highpass_hz,
        lowpass_hz=settings.gpt_sovits_lowpass_hz,
    )
