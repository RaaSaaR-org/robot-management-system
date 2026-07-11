"""Robot-agnostic local voice interaction service for NeoDEM.

Pipeline: AudioInput -> VAD segmenter -> STT -> A2A agent -> TTS -> AudioOutput.
All AI processing runs locally (faster-whisper, Piper, Ollama-backed agent).
"""

__version__ = "0.1.0"
