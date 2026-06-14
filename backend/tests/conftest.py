import pytest

from app.config import Settings


@pytest.fixture(autouse=True)
def isolate_dotenv(monkeypatch: pytest.MonkeyPatch) -> None:
    """阻止测试读取开发者本地 .env，保证配置校验测试可重现

    参数:
        monkeypatch: pytest 环境变量与属性修改工具
    返回:
        无
    """
    monkeypatch.setitem(Settings.model_config, "env_file", None)
