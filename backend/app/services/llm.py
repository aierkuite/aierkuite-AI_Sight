from collections.abc import AsyncIterator, Sequence

from openai import AsyncOpenAI

from app.config import get_settings
from app.schemas import HistoryTurn

SYSTEM_PROMPT = "你是一个本地演示用 AI 视觉对话助手。请根据用户问题和当前画面，用简洁自然的中文回答。"

Message = dict[str, object]


def get_client() -> AsyncOpenAI:
    """创建 OpenAI 异步客户端

    参数:
        无
    返回:
        指向配置中 OpenAI-compatible 地址的 AsyncOpenAI 客户端
    """
    settings = get_settings()
    return AsyncOpenAI(
        api_key=settings.openai_api_key,
        base_url=settings.openai_base_url,
        timeout=settings.request_timeout_seconds,
    )


def build_messages(
    user_text: str,
    image_b64: str | None,
    history: Sequence[HistoryTurn],
    max_history_rounds: int,
) -> list[Message]:
    """构建 OpenAI chat.completions 消息数组

    参数:
        user_text: 当前轮用户问题文本
        image_b64: 当前轮截图的 base64 JPEG 字符串或 None
        history: 前端传入的历史纯文本消息
        max_history_rounds: 最多保留的历史轮数
    返回:
        可传给 OpenAI-compatible 接口的消息数组
    """
    max_history_turns = max_history_rounds * 2
    trimmed_history = list(history)[-max_history_turns:]
    messages: list[Message] = [{"role": "system", "content": SYSTEM_PROMPT}]

    for item in trimmed_history:
        messages.append({"role": item.role, "content": item.content})

    if image_b64:
        content_parts: list[dict[str, object]] = [
            {"type": "text", "text": user_text},
            {
                "type": "image_url",
                "image_url": {"url": f"data:image/jpeg;base64,{image_b64}"},
            },
        ]
        messages.append({"role": "user", "content": content_parts})
    else:
        messages.append({"role": "user", "content": user_text})

    return messages


async def stream_chat(
    user_text: str,
    image_b64: str | None,
    history: Sequence[HistoryTurn],
) -> AsyncIterator[str]:
    """异步流式生成模型回答文本

    参数:
        user_text: 当前轮用户问题文本
        image_b64: 当前轮截图的 base64 JPEG 字符串或 None
        history: 最近历史纯文本消息
    返回:
        逐段产出模型 delta 文本的异步迭代器
    """
    settings = get_settings()
    client = get_client()
    messages = build_messages(
        user_text, image_b64, history, settings.max_history_rounds
    )
    stream = await client.chat.completions.create(
        model=settings.openai_model,
        messages=messages,
        stream=True,
    )

    async for chunk in stream:
        choices = getattr(chunk, "choices", None)
        if not choices:
            continue
        delta = getattr(choices[0], "delta", None)
        content = getattr(delta, "content", None)
        if content:
            yield content
