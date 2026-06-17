import asyncio

import httpx
import pytest
from fastapi.testclient import TestClient
from sse_starlette.sse import AppStatus

from app.config import get_settings
from app.main import create_app


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


def test_tts_returns_wav_bytes(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """验证 /api/tts 成功返回 wav 二进制内容

    参数:
        client: FastAPI 测试客户端
        monkeypatch: pytest 替换工具
    返回:
        无
    """

    async def fake_synthesize(_: str) -> bytes:
        """返回模拟 wav 音频

        参数:
            _: 播报文本
        返回:
            模拟 wav 字节
        """
        return b"RIFFfakewav"

    monkeypatch.setattr("app.routes.tts.synthesize_audio", fake_synthesize)

    response = client.post("/api/tts", json={"text": "こんにちは。"})

    assert response.status_code == 200
    assert "audio/wav" in response.headers["content-type"]
    assert response.content == b"RIFFfakewav"


def test_synthesize_audio_posts_api_v2_payload(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """验证服务层按 GPT-SoVITS api_v2 协议提交合成请求

    参数:
        monkeypatch: pytest 替换工具
    返回:
        无
    """
    from app.services import tts as tts_service

    monkeypatch.setenv("OPENAI_API_KEY", "sk-test-secret")
    monkeypatch.setenv("OPENAI_BASE_URL", "https://example.test/v1")
    monkeypatch.setenv("OPENAI_MODEL", "vision-model")
    monkeypatch.setenv("GPT_SOVITS_REF_AUDIO_PATH", "ref.wav")
    monkeypatch.setenv("GPT_SOVITS_PROMPT_TEXT", "こんにちは")
    get_settings.cache_clear()

    class FakeTtsClient:
        """模拟 GPT-SoVITS api_v2 客户端"""

        def __init__(self) -> None:
            """记录请求载荷

            参数:
                无
            返回:
                无
            """
            self.payload: dict[str, object] | None = None

        async def post(self, url: str, **kwargs: object) -> httpx.Response:
            """返回模拟 api_v2 音频响应

            参数:
                url: 请求路径
                kwargs: 请求参数
            返回:
                模拟 HTTP 响应
            """
            request = httpx.Request("POST", f"http://127.0.0.1:9880{url}")
            assert url == "/tts"
            payload = kwargs["json"]
            assert isinstance(payload, dict)
            self.payload = payload
            return httpx.Response(200, request=request, content=b"RIFFfakewav")

    fake_client = FakeTtsClient()
    monkeypatch.setattr(tts_service, "get_tts_client", lambda: fake_client)

    assert asyncio.run(tts_service.synthesize_audio("こんにちは。")) == b"RIFFfakewav"
    assert fake_client.payload == {
        "text": "こんにちは。",
        "text_lang": "ja",
        "ref_audio_path": "ref.wav",
        "prompt_text": "こんにちは",
        "prompt_lang": "ja",
        "text_split_method": "cut0",
        "media_type": "wav",
        "streaming_mode": False,
    }


def test_tts_maps_connect_error_without_leaking_raw_message(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """验证 GPT-SoVITS 连接失败返回安全中文消息

    参数:
        client: FastAPI 测试客户端
        monkeypatch: pytest 替换工具
    返回:
        无
    """
    from app.services import tts as tts_service

    class FakeTtsClient:
        """模拟连接失败的 GPT-SoVITS 客户端"""

        async def post(self, *_: object, **__: object) -> httpx.Response:
            """抛出模拟连接错误

            参数:
                _: 位置参数
                __: 关键字参数
            返回:
                永不返回
            """
            request = httpx.Request("POST", "http://127.0.0.1:9880/tts")
            raise httpx.ConnectError("connection refused raw detail", request=request)

    monkeypatch.setattr(tts_service, "get_tts_client", lambda: FakeTtsClient())

    response = client.post("/api/tts", json={"text": "こんにちは。"})

    assert response.status_code == 502
    assert response.json() == {
        "message": "无法连接语音合成服务，请确认 GPT-SoVITS 已启动"
    }
    assert "connection refused raw detail" not in response.text


def test_tts_maps_timeout_without_leaking_raw_message(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """验证 GPT-SoVITS 超时返回安全中文消息

    参数:
        client: FastAPI 测试客户端
        monkeypatch: pytest 替换工具
    返回:
        无
    """
    from app.services import tts as tts_service

    class FakeTtsClient:
        """模拟响应超时的 GPT-SoVITS 客户端"""

        async def post(self, *_: object, **__: object) -> httpx.Response:
            """抛出模拟超时错误

            参数:
                _: 位置参数
                __: 关键字参数
            返回:
                永不返回
            """
            request = httpx.Request("POST", "http://127.0.0.1:9880/tts")
            raise httpx.ReadTimeout("timeout raw detail", request=request)

    monkeypatch.setattr(tts_service, "get_tts_client", lambda: FakeTtsClient())

    response = client.post("/api/tts", json={"text": "こんにちは。"})

    assert response.status_code == 502
    assert response.json() == {"message": "语音合成服务响应超时，请稍后再试"}
    assert "timeout raw detail" not in response.text


def test_tts_maps_status_error_without_leaking_upstream_body(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """验证 GPT-SoVITS 非成功状态返回通用安全中文消息

    参数:
        client: FastAPI 测试客户端
        monkeypatch: pytest 替换工具
    返回:
        无
    """
    from app.services import tts as tts_service

    class FakeTtsClient:
        """模拟返回 400 状态的 GPT-SoVITS 客户端"""

        async def post(self, *_: object, **__: object) -> httpx.Response:
            """返回模拟上游错误响应

            参数:
                _: 位置参数
                __: 关键字参数
            返回:
                会在 raise_for_status 中抛错的 HTTP 响应
            """
            request = httpx.Request("POST", "http://127.0.0.1:9880/tts")
            return httpx.Response(
                400,
                request=request,
                text="upstream raw validation body",
            )

    monkeypatch.setattr(tts_service, "get_tts_client", lambda: FakeTtsClient())

    response = client.post("/api/tts", json={"text": "こんにちは。"})

    assert response.status_code == 502
    assert response.json() == {"message": "语音合成服务返回错误，请稍后再试"}
    assert "upstream raw validation body" not in response.text


def test_tts_rejects_empty_text(client: TestClient) -> None:
    """验证空播报文本被请求模型拒绝

    参数:
        client: FastAPI 测试客户端
    返回:
        无
    """
    response = client.post("/api/tts", json={"text": ""})

    assert response.status_code == 422


def test_tts_rejects_too_long_text(client: TestClient) -> None:
    """验证超长播报文本被请求模型拒绝

    参数:
        client: FastAPI 测试客户端
    返回:
        无
    """
    response = client.post("/api/tts", json={"text": "你" * 2001})

    assert response.status_code == 422
