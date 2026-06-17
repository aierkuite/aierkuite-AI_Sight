import asyncio
import logging
import subprocess
from pathlib import Path
from urllib.parse import urlparse

import httpx

from app.config import Settings, get_settings

logger = logging.getLogger(__name__)

_process: subprocess.Popen[bytes] | None = None


def _api_base_url(settings: Settings) -> str:
    """生成本机 GPT-SoVITS api_v2 服务地址

    参数:
        settings: 后端运行配置
    返回:
        用于探测和设置权重的服务地址
    """
    return f"http://{settings.gpt_sovits_api_host}:{settings.gpt_sovits_api_port}"


def _expected_base_url(settings: Settings) -> str:
    """规范化后端配置中的 GPT-SoVITS 服务地址

    参数:
        settings: 后端运行配置
    返回:
        去除末尾斜杠后的服务地址
    """
    return settings.gpt_sovits_base_url.rstrip("/")


def _can_manage_configured_url(settings: Settings) -> bool:
    """判断当前服务地址是否可由本进程自动管理

    参数:
        settings: 后端运行配置
    返回:
        地址匹配自动启动 host/port 时返回 true
    """
    parsed = urlparse(settings.gpt_sovits_base_url)
    return (
        parsed.scheme in {"http", "https"}
        and parsed.hostname == settings.gpt_sovits_api_host
        and (parsed.port or 80) == settings.gpt_sovits_api_port
    )


def _resolve_path(root_dir: Path, value: str) -> Path:
    """把配置路径解析成绝对路径

    参数:
        root_dir: GPT-SoVITS 项目根目录
        value: 绝对路径或相对根目录的路径
    返回:
        解析后的绝对路径
    """
    path = Path(value)
    if path.is_absolute():
        return path
    return root_dir / path


def _build_start_command(settings: Settings) -> tuple[list[str], Path]:
    """组装 GPT-SoVITS api_v2 启动命令

    参数:
        settings: 后端运行配置
    返回:
        启动命令参数列表和工作目录
    """
    root_dir = Path(settings.gpt_sovits_root_dir)
    python_path = _resolve_path(root_dir, settings.gpt_sovits_python_path)
    script_path = _resolve_path(root_dir, settings.gpt_sovits_api_script)
    config_path = _resolve_path(root_dir, settings.gpt_sovits_api_config)
    command = [
        str(python_path),
        str(script_path),
        "-a",
        settings.gpt_sovits_api_host,
        "-p",
        str(settings.gpt_sovits_api_port),
        "-c",
        str(config_path),
    ]
    return command, root_dir


async def _probe_api(settings: Settings) -> bool:
    """探测 GPT-SoVITS api_v2 是否可用

    参数:
        settings: 后端运行配置
    返回:
        openapi 接口可访问时返回 true
    """
    timeout = httpx.Timeout(settings.gpt_sovits_probe_timeout_seconds)
    try:
        async with httpx.AsyncClient(
            base_url=_expected_base_url(settings), timeout=timeout
        ) as client:
            response = await client.get("/openapi.json")
            response.raise_for_status()
    except httpx.HTTPError:
        return False
    return True


async def _wait_until_ready(settings: Settings) -> bool:
    """等待 GPT-SoVITS api_v2 启动完成

    参数:
        settings: 后端运行配置
    返回:
        超时前服务可用时返回 true
    """
    deadline = (
        asyncio.get_running_loop().time() + settings.gpt_sovits_startup_timeout_seconds
    )
    while asyncio.get_running_loop().time() < deadline:
        if await _probe_api(settings):
            return True
        await asyncio.sleep(1)
    return False


def _start_process(settings: Settings) -> None:
    """启动 GPT-SoVITS api_v2 子进程

    参数:
        settings: 后端运行配置
    返回:
        无
    """
    global _process
    command, cwd = _build_start_command(settings)
    _process = subprocess.Popen(
        command,
        cwd=cwd,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
    )


async def _set_weights(settings: Settings) -> None:
    """按配置设置 GPT-SoVITS 推理权重

    参数:
        settings: 后端运行配置
    返回:
        无
    """
    if (
        not settings.gpt_sovits_gpt_weights_path
        and not settings.gpt_sovits_sovits_weights_path
    ):
        return

    timeout = httpx.Timeout(settings.gpt_sovits_timeout_seconds)
    async with httpx.AsyncClient(
        base_url=_expected_base_url(settings), timeout=timeout
    ) as client:
        if settings.gpt_sovits_gpt_weights_path:
            response = await client.get(
                "/set_gpt_weights",
                params={"weights_path": settings.gpt_sovits_gpt_weights_path},
            )
            response.raise_for_status()
        if settings.gpt_sovits_sovits_weights_path:
            response = await client.get(
                "/set_sovits_weights",
                params={"weights_path": settings.gpt_sovits_sovits_weights_path},
            )
            response.raise_for_status()


async def ensure_gpt_sovits_api() -> None:
    """确保 GPT-SoVITS api_v2 服务已启动并应用权重配置

    参数:
        无
    返回:
        无
    """
    settings = get_settings()
    if not settings.gpt_sovits_auto_start:
        return

    if not _can_manage_configured_url(settings):
        logger.warning("GPT-SoVITS 自动启动已跳过：BASE_URL 与自动启动端口不匹配")
        return

    if not await _probe_api(settings):
        if not settings.gpt_sovits_root_dir or not settings.gpt_sovits_python_path:
            logger.warning("GPT-SoVITS 自动启动已跳过：缺少根目录或 Python 路径配置")
            return
        logger.info("GPT-SoVITS api_v2 未就绪，正在启动本机服务")
        try:
            _start_process(settings)
        except OSError:
            logger.exception("GPT-SoVITS api_v2 启动失败")
            return
        if not await _wait_until_ready(settings):
            logger.error("GPT-SoVITS api_v2 启动后等待就绪超时")
            return

    try:
        await _set_weights(settings)
    except httpx.HTTPError:
        logger.exception("GPT-SoVITS 权重设置失败")
        return
    logger.info("GPT-SoVITS api_v2 已就绪")


async def stop_managed_gpt_sovits_api() -> None:
    """停止由后端启动的 GPT-SoVITS api_v2 子进程

    参数:
        无
    返回:
        无
    """
    global _process
    if _process is None:
        return
    if _process.poll() is None:
        _process.terminate()
        try:
            await asyncio.wait_for(asyncio.to_thread(_process.wait), timeout=10)
        except TimeoutError:
            _process.kill()
            await asyncio.to_thread(_process.wait)
    _process = None
