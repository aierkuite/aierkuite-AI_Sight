# 后端启动时自动拉起 GPT-SoVITS API

## Goal

后端启动时自动确保本地 GPT-SoVITS `api_v2.py` REST 服务可用，避免电脑重启后只启动 FastAPI 后端却连不上 `9880` 的问题。

## What I Already Know

* 当前后端 `.env` 的 `GPT_SOVITS_BASE_URL` 指向 `http://127.0.0.1:9880`
* GPT-SoVITS 的 Gradio 页面端口 `9872` 和后端调用端口 `9880` 不是同一个服务
* 重启电脑后 `9872` 页面可能恢复，但 `api_v2.py` 的 `9880` REST 服务不会自动恢复
* 后端启动生命周期在 `backend/app/main.py` 的 `lifespan`
* TTS 调用封装在 `backend/app/services/tts.py`

## Requirements

* 后端启动时先探测 `GPT_SOVITS_BASE_URL` 是否可用
* 如果不可用且启用了自动启动，则从配置的 GPT-SoVITS 根目录启动 `api_v2.py`
* 启动成功后自动设置 GPT 权重和 SoVITS 权重
* 如果服务已经可用，则不重复启动进程，只设置权重
* 如果自动启动未配置或失败，后端仍应以清晰中文日志说明原因
* 配置项必须通过 `Settings` 读取，不直接在业务代码中读 `os.getenv`
* 测试中不能真的启动外部 GPT-SoVITS 进程

## Acceptance Criteria

* [ ] `uvicorn app.main:app` 启动时会确保 `9880` 可用
* [ ] `9880` 不存在时会执行配置的 `runtime/python.exe api_v2.py -a 127.0.0.1 -p 9880 -c ...`
* [ ] 启动后会调用 `/set_gpt_weights` 与 `/set_sovits_weights`
* [ ] `9880` 已存在时不会重复创建进程
* [ ] 缺少自动启动路径时有清晰日志，不泄露密钥或用户文本
* [ ] 后端 ruff 与 pytest 通过

## Definition of Done

* 新增/更新后端单元测试
* `ruff format --check .` 通过
* `ruff check .` 通过
* `pytest` 通过
* `.env.example` 记录新增配置项

## Technical Approach

新增 `app/services/gpt_sovits_runtime.py`，在后端 lifespan 中调用。该服务负责短超时探测 `/docs` 或 `/openapi.json`，必要时用 `subprocess.Popen` 启动本机 GPT-SoVITS `api_v2.py`，等待服务就绪后通过现有 TTS 客户端或独立短生命周期客户端设置权重。

## Decision (ADR-lite)

**Context**: 前端和后端都依赖 GPT-SoVITS `9880` REST API，但电脑重启后这个临时进程不会自动恢复。

**Decision**: 把“确保 GPT-SoVITS REST API 可用”放进后端启动生命周期，作为开发期本机依赖自启动逻辑，由 `.env` 配置是否启用和具体路径。

**Consequences**: 启动后端更方便，但该逻辑是本机开发环境耦合项，因此必须可关闭、可配置、测试中可 mock。

## Out of Scope

* 不管理 Gradio WebUI 的 `9872` 页面进程
* 不实现 Windows 开机自启动服务
* 不持久化用户对话、音频或图片
* 不在代码中写死用户的私密参考音频路径或 API Key

## Technical Notes

* 相关文件：`backend/app/main.py`、`backend/app/config.py`、`backend/app/services/tts.py`
* GPT 权重：`GPT_weights_v2ProPlus/heichuan-voice-e15.ckpt`
* SoVITS 权重：`SoVITS_weights_v2ProPlus/heichuan-voice_e5_s200.pth`
