import array
import io
import math
import wave

from app.services.audio_filter import reduce_wav_background_noise


def make_wav(samples: list[int], sample_rate: int = 16000) -> bytes:
    """创建测试用 mono int16 wav

    参数:
        samples: int16 采样列表
        sample_rate: 采样率
    返回:
        wav 二进制内容
    """
    payload = array.array("h", samples)
    output = io.BytesIO()
    with wave.open(output, "wb") as writer:
        writer.setnchannels(1)
        writer.setsampwidth(2)
        writer.setframerate(sample_rate)
        writer.writeframes(payload.tobytes())
    return output.getvalue()


def read_wav_samples(audio: bytes) -> list[int]:
    """读取测试 wav 中的 int16 采样

    参数:
        audio: wav 二进制内容
    返回:
        int16 采样列表
    """
    with wave.open(io.BytesIO(audio), "rb") as reader:
        frames = reader.readframes(reader.getnframes())
    payload = array.array("h")
    payload.frombytes(frames)
    return payload.tolist()


def rms(samples: list[int]) -> float:
    """计算采样 RMS

    参数:
        samples: int16 采样列表
    返回:
        RMS 能量
    """
    return math.sqrt(sum(sample * sample for sample in samples) / len(samples))


def test_reduce_wav_background_noise_gates_quiet_frames() -> None:
    """验证低电平底噪片段会被压低，高电平片段基本保留

    参数:
        无
    返回:
        无
    """
    quiet = [100] * 320
    loud = [10000] * 320
    source = make_wav(quiet + loud)

    filtered = reduce_wav_background_noise(
        source,
        threshold_db=-35,
        attenuation=0.1,
        highpass_hz=0,
        lowpass_hz=0,
    )

    samples = read_wav_samples(filtered)
    assert rms(samples[:320]) < rms(quiet) * 0.2
    assert rms(samples[320:]) > rms(loud) * 0.9


def test_reduce_wav_background_noise_returns_invalid_audio_unchanged() -> None:
    """验证非 wav 数据会原样返回

    参数:
        无
    返回:
        无
    """
    source = b"RIFFfakewav"

    assert (
        reduce_wav_background_noise(
            source,
            threshold_db=-35,
            attenuation=0.1,
            highpass_hz=70,
            lowpass_hz=9000,
        )
        == source
    )
