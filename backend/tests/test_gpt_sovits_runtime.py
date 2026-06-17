import httpx
import pytest

from app.config import get_settings
from app.services import gpt_sovits_runtime


@pytest.fixture(autouse=True)
def clear_runtime_state() -> None:
    """在每个测试前后清理配置缓存和托管进程状态

    参数:
        无
    返回:
        无
    """
    get_settings.cache_clear()
    gpt_sovits_runtime._process = None
    yield
    gpt_sovits_runtime._process = None
    get_settings.cache_clear()


def set_required_env(monkeypatch: pytest.MonkeyPatch) -> None:
    """设置后端启动所需的基础环境变量

    参数:
        monkeypatch: pytest 环境变量修改工具
    返回:
        无
    """
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test-secret")
    monkeypatch.setenv("OPENAI_BASE_URL", "https://example.test/v1")
    monkeypatch.setenv("OPENAI_MODEL", "vision-model")
    monkeypatch.setenv("GPT_SOVITS_REF_AUDIO_PATH", "ref.wav")
    monkeypatch.setenv("GPT_SOVITS_PROMPT_TEXT", "こんにちは")


def enable_auto_start(monkeypatch: pytest.MonkeyPatch) -> None:
    """设置 GPT-SoVITS 自动启动相关环境变量

    参数:
        monkeypatch: pytest 环境变量修改工具
    返回:
        无
    """
    set_required_env(monkeypatch)
    monkeypatch.setenv("GPT_SOVITS_AUTO_START", "true")
    monkeypatch.setenv("GPT_SOVITS_BASE_URL", "http://127.0.0.1:9880")
    monkeypatch.setenv("GPT_SOVITS_ROOT_DIR", "G:/GPT-SoVITS")
    monkeypatch.setenv("GPT_SOVITS_PYTHON_PATH", "runtime/python.exe")
    monkeypatch.setenv("GPT_SOVITS_GPT_WEIGHTS_PATH", "GPT_weights/demo.ckpt")
    monkeypatch.setenv("GPT_SOVITS_SOVITS_WEIGHTS_PATH", "SoVITS_weights/demo.pth")
    get_settings.cache_clear()


@pytest.mark.anyio
async def test_ensure_gpt_sovits_api_skips_when_disabled(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """验证未启用自动启动时不会探测或启动 GPT-SoVITS

    参数:
        monkeypatch: pytest 替换工具
    返回:
        无
    """
    set_required_env(monkeypatch)
    called = False

    async def fake_probe(_: object) -> bool:
        """记录探测调用

        参数:
            _: 配置对象
        返回:
            永远返回 true
        """
        nonlocal called
        called = True
        return True

    monkeypatch.setattr(gpt_sovits_runtime, "_probe_api", fake_probe)

    await gpt_sovits_runtime.ensure_gpt_sovits_api()

    assert called is False


@pytest.mark.anyio
async def test_ensure_gpt_sovits_api_sets_weights_without_restart(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """验证服务已可用时只设置权重不启动新进程

    参数:
        monkeypatch: pytest 替换工具
    返回:
        无
    """
    enable_auto_start(monkeypatch)
    started = False
    weights_set = False

    async def fake_probe(_: object) -> bool:
        """模拟服务已经可用

        参数:
            _: 配置对象
        返回:
            true 表示服务可用
        """
        return True

    def fake_start(_: object) -> None:
        """记录意外启动调用

        参数:
            _: 配置对象
        返回:
            无
        """
        nonlocal started
        started = True

    async def fake_set_weights(_: object) -> None:
        """记录权重设置调用

        参数:
            _: 配置对象
        返回:
            无
        """
        nonlocal weights_set
        weights_set = True

    monkeypatch.setattr(gpt_sovits_runtime, "_probe_api", fake_probe)
    monkeypatch.setattr(gpt_sovits_runtime, "_start_process", fake_start)
    monkeypatch.setattr(gpt_sovits_runtime, "_set_weights", fake_set_weights)

    await gpt_sovits_runtime.ensure_gpt_sovits_api()

    assert started is False
    assert weights_set is True


@pytest.mark.anyio
async def test_ensure_gpt_sovits_api_starts_process_then_sets_weights(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """验证服务不可用时会启动进程并等待后设置权重

    参数:
        monkeypatch: pytest 替换工具
    返回:
        无
    """
    enable_auto_start(monkeypatch)
    started = False
    weights_set = False
    probes = [False, True]

    async def fake_probe(_: object) -> bool:
        """模拟首次探测失败后等待成功

        参数:
            _: 配置对象
        返回:
            当前探测结果
        """
        return probes.pop(0)

    def fake_start(_: object) -> None:
        """记录启动调用

        参数:
            _: 配置对象
        返回:
            无
        """
        nonlocal started
        started = True

    async def fake_set_weights(_: object) -> None:
        """记录权重设置调用

        参数:
            _: 配置对象
        返回:
            无
        """
        nonlocal weights_set
        weights_set = True

    monkeypatch.setattr(gpt_sovits_runtime, "_probe_api", fake_probe)
    monkeypatch.setattr(gpt_sovits_runtime, "_start_process", fake_start)
    monkeypatch.setattr(gpt_sovits_runtime, "_set_weights", fake_set_weights)

    await gpt_sovits_runtime.ensure_gpt_sovits_api()

    assert started is True
    assert weights_set is True


@pytest.mark.anyio
async def test_set_weights_calls_api_v2_endpoints(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """验证权重设置调用 api_v2 的两个接口

    参数:
        monkeypatch: pytest 替换工具
    返回:
        无
    """
    enable_auto_start(monkeypatch)
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        """记录 HTTP 请求并返回成功响应

        参数:
            request: httpx 捕获到的请求
        返回:
            模拟成功响应
        """
        requests.append(request)
        return httpx.Response(200, request=request, json={"message": "success"})

    transport = httpx.MockTransport(handler)
    original_async_client = httpx.AsyncClient

    def fake_client(*args: object, **kwargs: object) -> httpx.AsyncClient:
        """创建带 MockTransport 的异步客户端

        参数:
            args: 位置参数
            kwargs: 关键字参数
            返回:
            httpx.AsyncClient 测试客户端
        """
        return original_async_client(*args, transport=transport, **kwargs)

    monkeypatch.setattr(httpx, "AsyncClient", fake_client)

    await gpt_sovits_runtime._set_weights(get_settings())

    assert [request.url.path for request in requests] == [
        "/set_gpt_weights",
        "/set_sovits_weights",
    ]
    assert requests[0].url.params["weights_path"] == "GPT_weights/demo.ckpt"
    assert requests[1].url.params["weights_path"] == "SoVITS_weights/demo.pth"
