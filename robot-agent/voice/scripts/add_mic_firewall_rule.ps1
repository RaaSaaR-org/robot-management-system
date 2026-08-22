# NeoDEM robot-day prep (TASK-181 step 1): allow the G1 mic multicast (UDP 5555)
# to reach the voice venv's python. Run elevated.
$ErrorActionPreference = 'Stop'
$result = "$PSScriptRoot\firewall_rule_result.txt"
$voicePython = Join-Path $PSScriptRoot "..\.venv\Scripts\python.exe"
try {
    $existing = Get-NetFirewallRule -DisplayName "NeoDEM voice G1 mic (UDP 5555)" -ErrorAction SilentlyContinue
    if ($existing) {
        "ALREADY_EXISTS" | Out-File $result -Encoding utf8
        exit 0
    }
    New-NetFirewallRule -DisplayName "NeoDEM voice G1 mic (UDP 5555)" `
        -Direction Inbound -Protocol UDP -LocalPort 5555 -Action Allow `
        -Program $voicePython | Out-Null
    "CREATED" | Out-File $result -Encoding utf8
} catch {
    "ERROR: $($_.Exception.Message)" | Out-File $result -Encoding utf8
    exit 1
}
