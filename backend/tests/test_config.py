import pytest

from app.config import get_settings
from app.main import validate_config

REQUIRED_ENV = (
    "OPENAI_API_KEY",
    "OPENAI_BASE_URL",
    "OPENAI_MODEL",
    "GPT_SOVITS_REF_AUDIO_PATH",
    "GPT_SOVITS_PROMPT_TEXT",
)


@pytest.fixture(autouse=True)
def clear_settings_cache() -> None:
    """在每个测试前后清理配置缓存

    参数:
        无
    返回:
        无
    """
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


def test_validate_config_fails_fast_without_required_env(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    """验证缺少必填配置时启动校验会退出

    参数:
        monkeypatch: pytest 环境变量修改工具
        capsys: pytest 标准输出捕获工具
    返回:
        无
    """
    monkeypatch.setenv("OPENAI_API_KEY", "sk-secret-value")
    monkeypatch.setenv("GPT_SOVITS_REF_AUDIO_PATH", "ref-audio-path")
    monkeypatch.setenv("GPT_SOVITS_PROMPT_TEXT", "prompt-text-value")
    monkeypatch.delenv("OPENAI_BASE_URL", raising=False)
    monkeypatch.delenv("OPENAI_MODEL", raising=False)

    with pytest.raises(SystemExit) as error:
        validate_config()

    stderr = capsys.readouterr().err
    assert error.value.code == 1
    assert "OPENAI_BASE_URL" in stderr
    assert "OPENAI_MODEL" in stderr
    assert "sk-secret-value" not in stderr
    assert "prompt-text-value" not in stderr


def test_get_settings_reads_required_env(monkeypatch: pytest.MonkeyPatch) -> None:
    """验证配置完整时能读取 Settings

    参数:
        monkeypatch: pytest 环境变量修改工具
    返回:
        无
    """
    for name in REQUIRED_ENV:
        monkeypatch.setenv(name, f"{name.lower()}-value")

    settings = get_settings()

    assert settings.openai_api_key == "openai_api_key-value"
    assert settings.openai_base_url == "openai_base_url-value"
    assert settings.openai_model == "openai_model-value"
    assert settings.gpt_sovits_ref_audio_path == "gpt_sovits_ref_audio_path-value"
    assert settings.gpt_sovits_prompt_text == "gpt_sovits_prompt_text-value"
    assert settings.gpt_sovits_text_lang == "ja"
    assert settings.gpt_sovits_prompt_lang == "ja"
    assert settings.gpt_sovits_audio_filter_enabled is True
    assert settings.gpt_sovits_noise_gate_threshold_db == -45.0
    assert settings.gpt_sovits_noise_gate_attenuation == 0.2
    assert settings.gpt_sovits_highpass_hz == 70.0
    assert settings.gpt_sovits_lowpass_hz == 9000.0
    assert settings.max_history_rounds == 6


def test_validate_config_fails_fast_without_gpt_sovits_ref_audio_path(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    """验证缺少 GPT-SoVITS 参考音频路径时启动校验会退出

    参数:
        monkeypatch: pytest 环境变量修改工具
        capsys: pytest 标准输出捕获工具
    返回:
        无
    """
    monkeypatch.setenv("OPENAI_API_KEY", "sk-secret-value")
    monkeypatch.setenv("OPENAI_BASE_URL", "https://example.test/v1")
    monkeypatch.setenv("OPENAI_MODEL", "vision-model")
    monkeypatch.setenv("GPT_SOVITS_PROMPT_TEXT", "こんにちは")
    monkeypatch.delenv("GPT_SOVITS_REF_AUDIO_PATH", raising=False)

    with pytest.raises(SystemExit) as error:
        validate_config()

    stderr = capsys.readouterr().err
    assert error.value.code == 1
    assert "GPT_SOVITS_REF_AUDIO_PATH" in stderr
    assert "sk-secret-value" not in stderr
    assert "こんにちは" not in stderr


def test_validate_config_fails_fast_without_gpt_sovits_prompt_text(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    """验证缺少 GPT-SoVITS 日文转写时启动校验会退出

    参数:
        monkeypatch: pytest 环境变量修改工具
        capsys: pytest 标准输出捕获工具
    返回:
        无
    """
    monkeypatch.setenv("OPENAI_API_KEY", "sk-secret-value")
    monkeypatch.setenv("OPENAI_BASE_URL", "https://example.test/v1")
    monkeypatch.setenv("OPENAI_MODEL", "vision-model")
    monkeypatch.setenv("GPT_SOVITS_REF_AUDIO_PATH", "C:/private/ref.wav")
    monkeypatch.delenv("GPT_SOVITS_PROMPT_TEXT", raising=False)

    with pytest.raises(SystemExit) as error:
        validate_config()

    stderr = capsys.readouterr().err
    assert error.value.code == 1
    assert "GPT_SOVITS_PROMPT_TEXT" in stderr
    assert "sk-secret-value" not in stderr
    assert "C:/private/ref.wav" not in stderr
