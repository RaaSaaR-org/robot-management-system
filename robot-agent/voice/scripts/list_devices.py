"""List audio devices for VOICE_INPUT_DEVICE / VOICE_OUTPUT_DEVICE selection.

Usage: uv run python scripts/list_devices.py
"""

import sounddevice as sd

print(sd.query_devices())
print()
try:
    print(f"default input : {sd.query_devices(kind='input')['name']}")
except Exception as exc:  # noqa: BLE001
    print(f"default input : NONE ({exc})")
try:
    print(f"default output: {sd.query_devices(kind='output')['name']}")
except Exception as exc:  # noqa: BLE001
    print(f"default output: NONE ({exc})")
