# Start / stop the OpenAI-compatible shim detached from the current shell.
#   .\serve.ps1              # port 8770
#   .\serve.ps1 -Port 8780
#   .\serve.ps1 -Stop
param(
    [int]$Port = 8770,
    [string]$Bank = "bank.jsonl",
    [switch]$Stop
)

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

function Get-Listener($p) {
    Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue |
        Select-Object -First 1 -ExpandProperty OwningProcess
}

$owner = Get-Listener $Port
if ($Stop) {
    if ($owner) {
        Stop-Process -Id $owner -Force
        "stopped pid=$owner port=$Port"
    } else {
        "nothing listening on $Port"
    }
    return
}

if ($owner) {
    Stop-Process -Id $owner -Force
    Start-Sleep -Milliseconds 800
    "replaced old pid=$owner"
}

# Win32_Process.Create: процесс не наследует хендлы и не держит вызывающий шелл
$cmd = "cmd.exe /c python shim.py --port $Port --bank $Bank >> shim.out.log 2>> shim.log"
$res = Invoke-CimMethod -ClassName Win32_Process -MethodName Create `
    -Arguments @{ CommandLine = $cmd; CurrentDirectory = $root }
if ($res.ReturnValue -ne 0) {
    "start failed: ReturnValue=$($res.ReturnValue)"
    return
}

for ($i = 0; $i -lt 25; $i++) {
    Start-Sleep -Milliseconds 400
    try {
        $h = (Invoke-WebRequest "http://127.0.0.1:$Port/healthz" -UseBasicParsing -TimeoutSec 2).Content
        $live = Get-Listener $Port
        if ($live) {
            $live | Set-Content -Path ".shim.pid" -Encoding ascii
            "pid=$live http://127.0.0.1:$Port  $h"
            return
        }
    } catch { }
}
"started pid=$($res.ProcessId) but healthz is not answering, check shim.log"