# Launch installed Docker Desktop through Windows' process service. This avoids
# inheriting packaged-shell filesystem virtualization for runtime socket files.
# No Docker data, settings, runtime directories or services are modified.
$ErrorActionPreference = 'Stop'
$dockerDesktopPath = 'C:\Program Files\Docker\Docker\Docker Desktop.exe'
if (-not (Test-Path -LiteralPath $dockerDesktopPath -PathType Leaf)) {
    throw "Docker Desktop is not installed at $dockerDesktopPath"
}
$dockerStartup = New-CimInstance -ClassName Win32_ProcessStartup -ClientOnly -Property @{
    ShowWindow = [uint16]0
}
$dockerLaunch = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{
    CommandLine = '"' + $dockerDesktopPath + '"'
    ProcessStartupInformation = $dockerStartup
}
if ($dockerLaunch.ReturnValue -ne 0) {
    throw "Docker Desktop launch failed with Windows return code $($dockerLaunch.ReturnValue)"
}
Write-Output "Docker Desktop launched (PID $($dockerLaunch.ProcessId)). Check readiness with docker info."
