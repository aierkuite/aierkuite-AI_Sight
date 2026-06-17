from collections.abc import AsyncIterator
from types import SimpleNamespace

import httpx
import pytest
from fastapi.testclient import TestClient
from openai import AuthenticationError
from sse_starlette.sse import AppStatus

from app.config import get_settings
from app.main import create_app
from app.schemas import HistoryTurn
from app.services.llm import build_messages


@pytest.fixture(autouse=True)
def clear_settings_cache() -> None:
    """在每个测试前后清理配置缓存

    参数:
        无
    返回:
        无
    """
    get_settings.cache_clear()
    AppStatus.should_exit = False
    AppStatus.should_exit_event = None
    yield
    AppStatus.should_exit = False
    AppStatus.should_exit_event = None
    get_settings.cache_clear()


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> TestClient:
    """创建带完整环境变量的测试客户端

    参数:
        monkeypatch: pytest 环境变量修改工具
    返回:
        已通过启动校验的 FastAPI TestClient
    """
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test-secret")
    monkeypatch.setenv("OPENAI_BASE_URL", "https://example.test/v1")
    monkeypatch.setenv("OPENAI_MODEL", "vision-model")
    monkeypatch.setenv("GPT_SOVITS_REF_AUDIO_PATH", "ref.wav")
    monkeypatch.setenv("GPT_SOVITS_PROMPT_TEXT", "こんにちは")
    get_settings.cache_clear()
    with TestClient(create_app()) as test_client:
        yield test_client


def test_chat_stream_emits_delta_and_done(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """验证 /api/chat 正常输出 delta 和 done 帧

    参数:
        client: FastAPI 测试客户端
        monkeypatch: pytest 替换工具
    返回:
        无
    """

    async def fake_stream_chat(
        _: str, __: str | None, ___: list[HistoryTurn]
    ) -> AsyncIterator[str]:
        """产出模拟模型 delta

        参数:
            _: 用户文本
            __: 当前图片
            ___: 历史消息
        返回:
            模拟 delta 异步迭代器
        """
        yield "你好"
        yield "，世界"

    monkeypatch.setattr("app.routes.chat.stream_chat", fake_stream_chat)

    response = client.post(
        "/api/chat",
        json={"text": "看到了什么", "image": "aGk=", "history": []},
    )

    assert response.status_code == 200
    assert 'data: {"delta": "你好"}' in response.text
    assert 'data: {"delta": "，世界"}' in response.text
    assert "event: done" in response.text


def test_chat_stream_maps_openai_error_without_leaking_secret(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """验证上游认证错误被映射成安全 SSE 错误帧

    参数:
        client: FastAPI 测试客户端
        monkeypatch: pytest 替换工具
    返回:
        无
    """

    async def fake_stream_chat(
        _: str, __: str | None, ___: list[HistoryTurn]
    ) -> AsyncIterator[str]:
        """抛出模拟认证错误

        参数:
            _: 用户文本
            __: 当前图片
            ___: 历史消息
        返回:
            永不产出 delta 的异步迭代器
        """
        request = httpx.Request("GET", "https://example.test/v1")
        response = httpx.Response(401, request=request)
        raise AuthenticationError(
            "bad key sk-test-secret", response=response, body=None
        )
        yield ""

    monkeypatch.setattr("app.routes.chat.stream_chat", fake_stream_chat)

    response = client.post(
        "/api/chat",
        json={"text": "测试错误", "image": None, "history": []},
    )

    assert response.status_code == 200
    assert "event: error" in response.text
    assert "AI 服务认证失败，请检查 API Key 配置" in response.text
    assert "sk-test-secret" not in response.text
    assert "https://example.test" not in response.text


def test_chat_rejects_oversized_image(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """验证超出大小上限的图片在开流前被拒绝

    参数:
        client: FastAPI 测试客户端
        monkeypatch: pytest 替换工具
    返回:
        无
    """
    monkeypatch.setenv("MAX_IMAGE_BYTES", "1")
    get_settings.cache_clear()

    response = client.post(
        "/api/chat",
        json={"text": "测试图片", "image": "aGk=", "history": []},
    )

    assert response.status_code == 413


def test_build_messages_trims_history_and_attaches_current_image_only() -> None:
    """验证消息构建只给当前轮携带图片并裁剪历史

    参数:
        无
    返回:
        无
    """
    history = [
        HistoryTurn(role="user", content=f"用户{i}")
        if i % 2 == 0
        else HistoryTurn(role="assistant", content=f"助手{i}")
        for i in range(16)
    ]

    messages = build_messages("当前问题", "aGk=", history, max_history_rounds=6)

    assert len(messages) == 14
    assert messages[1]["content"] == "用户4"
    latest = messages[-1]
    assert latest["role"] == "user"
    assert isinstance(latest["content"], list)
    image_part = latest["content"][1]
    assert isinstance(image_part, dict)
    assert image_part["image_url"] == {"url": "data:image/jpeg;base64,aGk="}
    historical_images = [
        item for item in messages[:-1] if isinstance(item.get("content"), list)
    ]
    assert historical_images == []


def test_build_messages_requires_japanese_answer() -> None:
    """验证系统提示强制模型使用日文回答

    参数:
        无
    返回:
        无
    """
    messages = build_messages("请描述画面", None, [], max_history_rounds=6)

    assert "日本語" in str(messages[0]["content"])


def test_stream_chat_reads_async_openai_deltas(monkeypatch: pytest.MonkeyPatch) -> None:
    """验证服务层能读取 AsyncOpenAI 风格的流式 delta

    参数:
        monkeypatch: pytest 替换工具
    返回:
        无
    """
    from app.services import llm

    class FakeCompletions:
        """模拟 OpenAI completions 对象"""

        async def create(self, **_: object) -> AsyncIterator[SimpleNamespace]:
            """返回模拟流式响应

            参数:
                _: OpenAI SDK 调用参数
            返回:
                模拟 chunk 异步迭代器
            """

            async def iterator() -> AsyncIterator[SimpleNamespace]:
                """逐个返回模拟 chunk

                参数:
                    无
                返回:
                    模拟 chunk 异步迭代器
                """
                yield SimpleNamespace(
                    choices=[SimpleNamespace(delta=SimpleNamespace(content="片段"))]
                )

            return iterator()

    fake_client = SimpleNamespace(chat=SimpleNamespace(completions=FakeCompletions()))

    monkeypatch.setenv("OPENAI_API_KEY", "sk-test-secret")
    monkeypatch.setenv("OPENAI_BASE_URL", "https://example.test/v1")
    monkeypatch.setenv("OPENAI_MODEL", "vision-model")
    monkeypatch.setenv("GPT_SOVITS_REF_AUDIO_PATH", "ref.wav")
    monkeypatch.setenv("GPT_SOVITS_PROMPT_TEXT", "こんにちは")
    get_settings.cache_clear()
    monkeypatch.setattr(llm, "get_client", lambda: fake_client)

    async def collect() -> list[str]:
        """收集 stream_chat 产出的文本

        参数:
            无
        返回:
            模型 delta 文本列表
        """
        return [delta async for delta in llm.stream_chat("问题", None, [])]

    import asyncio

    assert asyncio.run(collect()) == ["片段"]
