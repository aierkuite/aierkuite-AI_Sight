from openai import (
    APIConnectionError,
    APITimeoutError,
    AuthenticationError,
    BadRequestError,
    RateLimitError,
)


class AppError(Exception):
    """表示可安全展示给用户的领域异常"""


def to_user_message(exc: Exception) -> str:
    """把异常映射为安全的中文用户提示

    参数:
        exc: 捕获到的上游或领域异常
    返回:
        不包含密钥、原始错误和内部路径的中文提示
    """
    if isinstance(exc, AuthenticationError):
        return "AI 服务认证失败，请检查 API Key 配置"
    if isinstance(exc, RateLimitError):
        return "请求过于频繁，请稍后再试"
    if isinstance(exc, APITimeoutError):
        return "AI 服务响应超时，请稍后再试"
    if isinstance(exc, APIConnectionError):
        return "无法连接 AI 服务，请检查网络或 OPENAI_BASE_URL"
    if isinstance(exc, BadRequestError):
        return "请求被模型拒绝（可能图片过大或模型不支持图片输入）"
    if isinstance(exc, AppError):
        return str(exc)
    return "服务异常，请稍后再试"
