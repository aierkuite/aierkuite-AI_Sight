from __future__ import annotations

import array
import io
import math
import wave


INT16_MAX = 32767
INT16_MIN = -32768


def _clamp_int16(value: float) -> int:
    """把浮点采样值限制到 int16 范围

    参数:
        value: 待限制的浮点采样值
    返回:
        可写回 PCM 的 int16 采样值
    """
    return max(INT16_MIN, min(INT16_MAX, int(round(value))))


def _frame_rms(samples: array.array[int], start: int, end: int) -> float:
    """计算一段 PCM 采样的归一化 RMS

    参数:
        samples: int16 采样数组
        start: 起始采样下标
        end: 结束采样下标
    返回:
        0 到 1 左右的 RMS 能量值
    """
    if end <= start:
        return 0.0
    total = 0.0
    for sample in samples[start:end]:
        total += sample * sample
    return math.sqrt(total / (end - start)) / INT16_MAX


def _apply_noise_gate(
    samples: array.array[int],
    sample_rate: int,
    channels: int,
    threshold_db: float,
    attenuation: float,
    frame_ms: int,
) -> None:
    """对低电平片段应用噪声门衰减

    参数:
        samples: int16 采样数组，会被原地修改
        sample_rate: 音频采样率
        channels: 声道数
        threshold_db: 低于该 dBFS 阈值的片段会被压低
        attenuation: 低电平片段保留的音量比例
        frame_ms: 噪声门分析窗口毫秒数
    返回:
        无
    """
    threshold = 10 ** (threshold_db / 20)
    frame_samples = max(1, int(sample_rate * frame_ms / 1000)) * channels
    for start in range(0, len(samples), frame_samples):
        end = min(len(samples), start + frame_samples)
        if _frame_rms(samples, start, end) >= threshold:
            continue
        for index in range(start, end):
            samples[index] = _clamp_int16(samples[index] * attenuation)


def _apply_highpass(
    samples: array.array[int], sample_rate: int, channels: int, cutoff_hz: float
) -> None:
    """应用一阶高通滤波以削弱低频背景噪声

    参数:
        samples: int16 采样数组，会被原地修改
        sample_rate: 音频采样率
        channels: 声道数
        cutoff_hz: 高通截止频率，非正数表示跳过
    返回:
        无
    """
    if cutoff_hz <= 0:
        return
    rc = 1 / (2 * math.pi * cutoff_hz)
    dt = 1 / sample_rate
    alpha = rc / (rc + dt)

    previous_input = [0.0] * channels
    previous_output = [0.0] * channels
    for index, sample in enumerate(samples):
        channel = index % channels
        output = alpha * (previous_output[channel] + sample - previous_input[channel])
        previous_input[channel] = float(sample)
        previous_output[channel] = output
        samples[index] = _clamp_int16(output)


def _apply_lowpass(
    samples: array.array[int], sample_rate: int, channels: int, cutoff_hz: float
) -> None:
    """应用一阶低通滤波以削弱高频嘶声

    参数:
        samples: int16 采样数组，会被原地修改
        sample_rate: 音频采样率
        channels: 声道数
        cutoff_hz: 低通截止频率，非正数表示跳过
    返回:
        无
    """
    if cutoff_hz <= 0 or cutoff_hz >= sample_rate / 2:
        return
    rc = 1 / (2 * math.pi * cutoff_hz)
    dt = 1 / sample_rate
    alpha = dt / (rc + dt)

    previous_output = [0.0] * channels
    for index, sample in enumerate(samples):
        channel = index % channels
        output = previous_output[channel] + alpha * (sample - previous_output[channel])
        previous_output[channel] = output
        samples[index] = _clamp_int16(output)


def reduce_wav_background_noise(
    audio: bytes,
    *,
    threshold_db: float,
    attenuation: float,
    highpass_hz: float,
    lowpass_hz: float,
    frame_ms: int = 20,
) -> bytes:
    """对 GPT-SoVITS 返回的 PCM WAV 做轻量背景噪声抑制

    参数:
        audio: GPT-SoVITS 返回的 wav 二进制内容
        threshold_db: 噪声门阈值，越接近 0 越强
        attenuation: 低电平片段保留的音量比例
        highpass_hz: 高通截止频率
        lowpass_hz: 低通截止频率
        frame_ms: 噪声门分析窗口毫秒数
    返回:
        处理后的 wav 二进制内容，无法处理时返回原始内容
    """
    try:
        with wave.open(io.BytesIO(audio), "rb") as reader:
            params = reader.getparams()
            frames = reader.readframes(reader.getnframes())
    except (EOFError, wave.Error):
        return audio

    if params.comptype != "NONE" or params.sampwidth != 2 or params.nchannels < 1:
        return audio

    samples = array.array("h")
    samples.frombytes(frames)
    if samples.itemsize != 2:
        return audio

    attenuation = max(0.0, min(1.0, attenuation))
    _apply_highpass(samples, params.framerate, params.nchannels, highpass_hz)
    _apply_lowpass(samples, params.framerate, params.nchannels, lowpass_hz)
    _apply_noise_gate(
        samples,
        params.framerate,
        params.nchannels,
        threshold_db,
        attenuation,
        frame_ms,
    )

    output = io.BytesIO()
    with wave.open(output, "wb") as writer:
        writer.setparams(params)
        writer.writeframes(samples.tobytes())
    return output.getvalue()
