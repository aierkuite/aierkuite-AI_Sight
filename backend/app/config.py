import math
from functools import lru_cache

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """保存后端运行配置"""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    openai_api_key: str = Field(min_length=1)
    openai_base_url: str = Field(min_length=1)
    openai_model: str = Field(min_length=1)
    gpt_sovits_base_url: str = Field(
        default="http://127.0.0.1:9880",
        min_length=1,
    )
    gpt_sovits_ref_audio_path: str = Field(min_length=1)
    gpt_sovits_prompt_text: str = Field(min_length=1)
    gpt_sovits_prompt_lang: str = "ja"
    gpt_sovits_text_lang: str = "ja"
    gpt_sovits_text_split_method: str = "cut0"
    gpt_sovits_timeout_seconds: int = 60
    gpt_sovits_audio_filter_enabled: bool = True
    gpt_sovits_noise_gate_threshold_db: float = -45.0
    gpt_sovits_noise_gate_attenuation: float = 0.2
    gpt_sovits_highpass_hz: float = 70.0
    gpt_sovits_lowpass_hz: float = 9000.0
    gpt_sovits_auto_start: bool = False
    gpt_sovits_root_dir: str = ""
    gpt_sovits_python_path: str = ""
    gpt_sovits_api_script: str = "api_v2.py"
    gpt_sovits_api_config: str = "GPT_SoVITS/configs/tts_infer.yaml"
    gpt_sovits_api_host: str = "127.0.0.1"
    gpt_sovits_api_port: int = 9880
    gpt_sovits_startup_timeout_seconds: int = 120
    gpt_sovits_probe_timeout_seconds: int = 2
    gpt_sovits_gpt_weights_path: str = ""
    gpt_sovits_sovits_weights_path: str = ""
    max_history_rounds: int = 6
    max_image_bytes: int = 2_000_000
    request_timeout_seconds: int = 60
    cors_allow_origins: str = "http://localhost:5173"
    log_level: str = "INFO"

    @field_validator(
        "openai_api_key",
        "openai_base_url",
        "openai_model",
        "gpt_sovits_base_url",
        "gpt_sovits_ref_audio_path",
        "gpt_sovits_prompt_text",
        "gpt_sovits_prompt_lang",
        "gpt_sovits_text_lang",
        "gpt_sovits_text_split_method",
        "gpt_sovits_api_script",
        "gpt_sovits_api_config",
        "gpt_sovits_api_host",
        "cors_allow_origins",
        "log_level",
    )
    @classmethod
    def strip_non_empty(cls, value: str) -> str:
        """清理字符串配置并拒绝空值

        参数:
            value: 原始环境变量字符串
        返回:
            去除首尾空白后的配置字符串
        """
        stripped = value.strip()
        if not stripped:
            msg = "配置值不能为空"
            raise ValueError(msg)
        return stripped

    @field_validator(
        "max_history_rounds",
        "max_image_bytes",
        "request_timeout_seconds",
        "gpt_sovits_timeout_seconds",
        "gpt_sovits_api_port",
        "gpt_sovits_startup_timeout_seconds",
        "gpt_sovits_probe_timeout_seconds",
    )
    @classmethod
    def require_positive_int(cls, value: int) -> int:
        """校验数值配置必须为正整数

        参数:
            value: 环境变量解析后的整数值
        返回:
            通过校验的正整数
        """
        if value <= 0:
            msg = "配置值必须大于 0"
            raise ValueError(msg)
        return value

    @field_validator(
        "gpt_sovits_noise_gate_threshold_db",
        "gpt_sovits_noise_gate_attenuation",
        "gpt_sovits_highpass_hz",
        "gpt_sovits_lowpass_hz",
    )
    @classmethod
    def require_audio_filter_number(cls, value: float) -> float:
        """校验音频过滤数值配置必须非负或处于合理范围

        参数:
            value: 环境变量解析后的浮点数值
        返回:
            通过校验的音频过滤参数
        """
        if not math.isfinite(value):
            msg = "音频过滤配置必须是有限数值"
            raise ValueError(msg)
        return value

    @field_validator("cors_allow_origins")
    @classmethod
    def reject_wildcard_cors(cls, value: str) -> str:
        """拒绝通配 CORS 来源

        参数:
            value: 逗号分隔的 CORS 来源
        返回:
            通过校验的 CORS 来源字符串
        """
        origins = [origin.strip() for origin in value.split(",") if origin.strip()]
        if "*" in origins:
            msg = "CORS 来源不能使用通配符"
            raise ValueError(msg)
        return ",".join(origins)

    @property
    def cors_origins(self) -> list[str]:
        """拆分 CORS 来源列表

        参数:
            无
        返回:
            可传给 FastAPI CORS 中间件的来源列表
        """
        return [
            origin.strip()
            for origin in self.cors_allow_origins.split(",")
            if origin.strip()
        ]


@lru_cache
def get_settings() -> Settings:
    """读取并缓存后端配置

    参数:
        无
    返回:
        Settings 配置实例
    """
    return Settings()
