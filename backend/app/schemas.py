from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

HistoryRole = Literal["user", "assistant"]


class HistoryTurn(BaseModel):
    """表示一条纯文本历史消息"""

    model_config = ConfigDict(extra="forbid")

    role: HistoryRole
    content: str = Field(min_length=1)

    @field_validator("content")
    @classmethod
    def strip_content(cls, value: str) -> str:
        """清理历史消息内容并拒绝空文本

        参数:
            value: 历史消息文本
        返回:
            去除首尾空白后的历史消息文本
        """
        stripped = value.strip()
        if not stripped:
            msg = "历史消息不能为空"
            raise ValueError(msg)
        return stripped


class ChatRequest(BaseModel):
    """定义 /api/chat 的请求体"""

    model_config = ConfigDict(extra="forbid")

    text: str = Field(min_length=1)
    image: str | None = None
    history: list[HistoryTurn] = Field(default_factory=list)

    @field_validator("text")
    @classmethod
    def strip_text(cls, value: str) -> str:
        """清理用户问题并拒绝空文本

        参数:
            value: 用户提交的原始问题文本
        返回:
            去除首尾空白后的问题文本
        """
        stripped = value.strip()
        if not stripped:
            msg = "问题文本不能为空"
            raise ValueError(msg)
        return stripped

    @field_validator("image")
    @classmethod
    def normalize_image(cls, value: str | None) -> str | None:
        """把空图片字段归一化为空值

        参数:
            value: 前端提交的 base64 JPEG 字符串或空值
        返回:
            可传给服务层的图片字符串或 None
        """
        if value is None:
            return None
        stripped = value.strip()
        return stripped or None


class DeltaEvent(BaseModel):
    """定义默认 SSE token 事件数据"""

    delta: str


class ErrorEvent(BaseModel):
    """定义 SSE 错误事件数据"""

    message: str
