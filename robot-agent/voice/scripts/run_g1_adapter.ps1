# Start the G1 audio adapter (TASK-181 step 2).
#
# The adapter needs Python 3.10 + cyclonedds + unitree_sdk2py. The voice
# service's own 3.12 venv cannot run it (no cp312 cyclonedds wheels), so it
# runs out-of-process in C:\Unitree\.venv-g1-audio and is reached over HTTP.
#
#   .\scripts\run_g1_adapter.ps1           # real robot (DDS domain 0)
#   .\scripts\run_g1_adapter.ps1 -Mock     # robot-less smoke test
#
# Verify from another shell:  curl http://localhost:8766/health
#
# ASCII only, deliberately: Windows PowerShell 5.1 reads .ps1 files as ANSI,
# so a stray UTF-8 dash or umlaut here becomes mojibake and breaks the parser.

param(
    [switch]$Mock,
    [string]$Interface = "Ethernet 3",
    [int]$Port = 8766
)

$ErrorActionPreference = "Stop"

$venvPython = "C:\Unitree\.venv-g1-audio\Scripts\python.exe"
$sdkPath = "C:\Unitree\unitree_sdk2_python"
$adapter = Join-Path $PSScriptRoot "..\adapters\g1_audio_adapter.py"

if (-not (Test-Path $venvPython)) {
    Write-Error "DDS venv missing: $venvPython"
    Write-Error "Recreate: uv venv --python 3.10 C:\Unitree\.venv-g1-audio; uv pip install --python $venvPython cyclonedds==0.10.2 numpy"
    exit 1
}
if (-not (Test-Path $sdkPath)) {
    Write-Error "unitree_sdk2_python missing: $sdkPath"
    exit 1
}

$env:PYTHONPATH = $sdkPath
$env:G1_NET_INTERFACE = $Interface
$env:G1_AUDIO_ADAPTER_PORT = "$Port"
if ($Mock) { $env:G1_AUDIO_MOCK = "1" } else { $env:G1_AUDIO_MOCK = "0" }

if (-not $Mock) {
    # DDS domain 0 = real robot. The adapter only ever calls AudioClient
    # (speaker / volume / LED); it never publishes to the motion topics.
    $nic = Get-NetIPAddress -AddressFamily IPv4 -InterfaceAlias $Interface -ErrorAction SilentlyContinue
    if (-not $nic) {
        Write-Error "Interface '$Interface' has no IPv4 address - is the robot LAN adapter up?"
        exit 1
    }
    Write-Host "Interface $Interface = $($nic.IPAddress), DDS domain 0 (real robot)" -ForegroundColor Cyan
}

Write-Host "Starting G1 audio adapter on :$Port (mock=$($env:G1_AUDIO_MOCK))" -ForegroundColor Green
& $venvPython $adapter
