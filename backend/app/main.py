import logging
import sys
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import ValidationError

from app.config import get_settings
from app.routes.chat import router as chat_router

FIELD_TO_ENV = {
    "openai_api_key": "OPENAI_API_KEY",
    "openai_base_url": "OPENAI_BASE_URL",
    "openai_model": "OPENAI_MODEL",
    "max_history_rounds": "MAX_HISTORY_ROUNDS",
    "max_image_bytes": "MAX_IMAGE_BYTES",
    "request_timeout_seconds": "REQUEST_TIMEOUT_SECONDS",
    "cors_allow_origins": "CORS_ALLOW_ORIGINS",
    "log_level": "LOG_LEVEL",
}


def configure_logging() -> None:
    """配置标准库日志格式

    参数:
        无
    返回:
        无
    """
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )


def validation_error_fields(exc: Exception) -> list[str]:
    """提取配置异常对应的环境变量名

    参数:
        exc: 配置加载阶段捕获到的异常
    返回:
        需要展示给开发者的环境变量名列表
    """
    if not isinstance(exc, ValidationError):
        return ["OPENAI_API_KEY", "OPENAI_BASE_URL", "OPENAI_MODEL"]

    fields: set[str] = set()
    for error in exc.errors():
        location = error.get("loc", ())
        if not location:
            continue
        field_name = str(location[0])
        fields.add(FIELD_TO_ENV.get(field_name, field_name.upper()))
    return sorted(fields)


def validate_config() -> None:
    """启动时校验必需配置

    参数:
        无
    返回:
        无，配置错误时抛出 SystemExit
    """
    try:
        get_settings()
    except Exception as exc:
        fields = validation_error_fields(exc)
        field_text = " / ".join(fields)
        logging.getLogger("startup").critical(
            "配置校验失败，服务无法启动: %s", field_text
        )
        print(f"启动失败：缺少或无效的环境变量：{field_text}", file=sys.stderr)
        raise SystemExit(1) from exc


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    """在应用启动阶段执行 fail-fast 配置校验

    参数:
        _: FastAPI 应用实例，当前不需要读取
    返回:
        lifespan 异步上下文
    """
    validate_config()
    yield


def safe_cors_origins() -> list[str]:
    """读取 CORS 来源并在配置缺失时保留本地默认值

    参数:
        无
    返回:
        CORS 中间件使用的来源列表
    """
    try:
        return get_settings().cors_origins
    except Exception:
        return ["http://localhost:5173"]


def create_app() -> FastAPI:
    """创建 FastAPI 应用实例

    参数:
        无
    返回:
        完成路由和中间件装配的 FastAPI 应用
    """
    configure_logging()
    app = FastAPI(title="AI 视觉对话助手", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=safe_cors_origins(),
        allow_credentials=False,
        allow_methods=["POST", "OPTIONS"],
        allow_headers=["Content-Type"],
    )
    app.include_router(chat_router, prefix="/api")
    return app


app = create_app()
