param(
    [ValidateSet('Setup', 'Start', 'Stop', 'Test', 'Browser', 'Build', 'Status')]
    [string]$Action = 'Start'
)
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$stateDir = Join-Path $repo '.local-test'
$toolsDir = Join-Path $stateDir 'tools'
New-Item -ItemType Directory -Force -Path $toolsDir | Out-Null
Set-Location -LiteralPath $repo

function Assert-Exit([string]$operation) {
    if ($LASTEXITCODE -ne 0) { throw "$operation failed (exit $LASTEXITCODE). See the output above." }
}
function Get-Bun {
    $candidates = @((Join-Path $toolsDir 'bun-windows-x64/bun.exe'), (Join-Path $repo '../.tools/bun-windows-x64/bun.exe'))
    foreach ($candidate in $candidates) { if (Test-Path -LiteralPath $candidate) { return (Resolve-Path $candidate).Path } }
    if ($Action -ne 'Setup') { throw 'Run this script with -Action Setup first.' }
    Invoke-WebRequest -UseBasicParsing 'https://github.com/oven-sh/bun/releases/download/bun-v1.4.4/bun-windows-x64.zip' -OutFile (Join-Path $toolsDir 'bun.zip')
    Expand-Archive -LiteralPath (Join-Path $toolsDir 'bun.zip') -DestinationPath $toolsDir -Force
    return Join-Path $toolsDir 'bun-windows-x64/bun.exe'
}
function Get-Node {
    $command = Get-Command node -ErrorAction SilentlyContinue
    if ($command) {
        try {
            $version = & $command.Source --version 2>$null
            if ($LASTEXITCODE -eq 0 -and $version -match '^v(2[4-9]|[3-9][0-9])\.') { return $command.Source }
        } catch { }
    }
    $exe = Join-Path $toolsDir 'node-v24.21.0-win-x64/node.exe'
    if (!(Test-Path -LiteralPath $exe)) {
        Invoke-WebRequest -UseBasicParsing 'https://nodejs.org/dist/v24.21.0/node-v24.21.0-win-x64.zip' -OutFile (Join-Path $toolsDir 'node.zip')
        Expand-Archive -LiteralPath (Join-Path $toolsDir 'node.zip') -DestinationPath $toolsDir -Force
    }
    return $exe
}
$bun = Get-Bun
$env:PATH = (Split-Path $bun) + ';' + $env:PATH

function Invoke-Stack([string[]]$StackArgs) {
    $cli = Join-Path $toolsDir 'supabase'
    $shared = Join-Path $repo '../.tools/supabase'
    if (!(Test-Path -LiteralPath $cli) -and (Test-Path -LiteralPath $shared)) { $cli = (Resolve-Path $shared).Path }
    if (!(Test-Path -LiteralPath $cli)) {
        if ($Action -ne 'Setup') { throw 'Supabase CLI missing. Run -Action Setup.' }
        $archive = Join-Path $toolsDir 'supabase-linux.tar.gz'
        Invoke-WebRequest -UseBasicParsing 'https://github.com/supabase/cli/releases/download/v3.2.0/supabase_3.2.0_linux_amd64.tar.gz' -OutFile $archive
        $archiveWsl = (& wsl.exe -d Ubuntu --exec wslpath -a $archive).Trim()
        $toolsWsl = (& wsl.exe -d Ubuntu --exec wslpath -a $toolsDir).Trim()
        & wsl.exe -d Ubuntu --exec tar -xzf $archiveWsl -C $toolsWsl
        Assert-Exit 'Extracting Supabase CLI'
    }
    $cliWsl = (& wsl.exe -d Ubuntu --exec wslpath -a $cli).Trim()
    $savedStatus = Join-Path $stateDir 'status.json'
    if (Test-Path -LiteralPath $savedStatus) {
        $saved = Get-Content -LiteralPath $savedStatus -Raw | ConvertFrom-Json
        # The CLI normally chooses a different stack for every Git branch.
        # Reuse this working copy's saved local stack across branch switches.
        if ($saved.identity.id) {
            & wsl.exe -d Ubuntu --exec $cliWsl @StackArgs --workdir .local-test --stack-id $saved.identity.id
        } else {
            & wsl.exe -d Ubuntu --exec $cliWsl @StackArgs --workdir .local-test --stack manual-notes
        }
    } else {
        & wsl.exe -d Ubuntu --exec $cliWsl @StackArgs --workdir .local-test --stack manual-notes
    }
    Assert-Exit 'Local Supabase command'
}
function Start-Stack {
    New-Item -ItemType Directory -Force -Path (Join-Path $stateDir 'supabase') | Out-Null
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'supabase.toml') -Destination (Join-Path $stateDir 'supabase/config.toml')
    Invoke-Stack @('start', '--runtime', 'native', '--exclude', 'analytics,pooler,storage,functions', '--preparation', 'on-demand', '--yes')
    $json = Invoke-Stack @('status', '--output-format', 'json')
    [System.IO.File]::WriteAllText((Join-Path $stateDir 'status.json'), ($json -join "`n"), [System.Text.UTF8Encoding]::new($false))
    $status = $json | ConvertFrom-Json
    if ($status.env.API_URL -ne 'http://127.0.0.1:54321') { throw 'Unexpected API URL; refusing to configure the test build.' }
    @("VITE_SUPABASE_URL=$($status.env.API_URL)", "VITE_SUPABASE_ANON_KEY=$($status.env.ANON_KEY)", "VITE_CN_LOCAL_TEST=1") | Set-Content -Encoding utf8 (Join-Path $repo '.env.manual-test.local')
    & $bun scripts/manual-notes/migrate.ts
    Assert-Exit 'Migrating local database'
    & $bun scripts/manual-notes/seed.ts
    Assert-Exit 'Preparing local test pages'
}
function Test-Url([string]$url) {
    try { return (Invoke-WebRequest -UseBasicParsing -Uri $url -TimeoutSec 3).StatusCode -eq 200 } catch { return $false }
}
function Start-Worker([string]$name, [string]$url, [string]$directory, [string[]]$WorkerArgs) {
    if (Test-Url $url) { Write-Host "$name is already running: $url"; return }
    $process = Start-Process -FilePath $bun -ArgumentList $WorkerArgs -WorkingDirectory $directory -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $stateDir "$name.log") -RedirectStandardError (Join-Path $stateDir "$name.err.log")
    @{ id = $process.Id; started = $process.StartTime.ToUniversalTime().ToString('o') } | ConvertTo-Json | Set-Content (Join-Path $stateDir "$name.pid.json")
    for ($attempt = 0; $attempt -lt 40; $attempt++) {
        if (Test-Url $url) { Write-Host "$name ready: $url"; return }
        if ($process.HasExited) { throw "$name exited. Read .local-test/$name.err.log" }
        Start-Sleep -Milliseconds 250
    }
    throw "$name did not become ready. Read .local-test/$name.err.log"
}
function Start-Web {
    Start-Worker 'website' 'http://127.0.0.1:8003' (Join-Path $repo 'src/everything-web') @('x', '--bun', 'vite', '--port', '8003', '--host', '127.0.0.1', '--strictPort', '--mode', 'manual-test')
    Start-Worker 'fixtures' 'http://127.0.0.1:8010/article' $repo @('scripts/manual-notes/fixtures.ts')
}
function Build-Extensions {
    Push-Location (Join-Path $repo 'src/everything-extension')
    try {
        & $bun x --bun wxt build --mode manual-test
        Assert-Exit 'Chrome/Edge local extension build'
        & $bun x --bun wxt build -b firefox --mode manual-test
        Assert-Exit 'Firefox local extension build'
    } finally { Pop-Location }
}
function Install-TestBrowser {
    # This pinned stable Chrome for Testing works with unpacked extensions.
    # Playwright's Chromium 153 Windows archive failed SxS activation here.
    $browser = Join-Path $stateDir 'chrome-stable/chrome-win64/chrome.exe'
    if (!(Test-Path -LiteralPath $browser)) {
        Invoke-WebRequest -UseBasicParsing 'https://storage.googleapis.com/chrome-for-testing-public/157.0.8103.78/win64/chrome-win64.zip' -OutFile (Join-Path $stateDir 'chrome-stable.zip')
        Expand-Archive -LiteralPath (Join-Path $stateDir 'chrome-stable.zip') -DestinationPath (Join-Path $stateDir 'chrome-stable') -Force
    }
}

switch ($Action) {
    'Setup' {
        & $bun install --frozen-lockfile
        Assert-Exit 'Dependency installation'
        Start-Stack
        Build-Extensions
        Install-TestBrowser
        Start-Web
    }
    'Start' { Start-Stack; Start-Web }
    'Status' { Invoke-Stack @('status'); Write-Host 'Website: http://127.0.0.1:8003/notes'; Write-Host 'Test pages: http://127.0.0.1:8010/article' }
    'Build' { Build-Extensions }
    'Test' {
        Start-Stack; Start-Web
        & $bun test src/everything-extension
        Assert-Exit 'Extension regression tests'
        $node = Get-Node
        & $node --experimental-strip-types scripts/manual-notes/e2e.ts
        Assert-Exit 'Browser tests'
    }
    'Browser' {
        Start-Stack; Start-Web
        $node = Get-Node
        $readyFile = Join-Path $stateDir 'browser-ready.json'
        if (Test-Path -LiteralPath $readyFile) {
            $ready = Get-Content -LiteralPath $readyFile -Raw | ConvertFrom-Json
            if (Get-Process -Id $ready.pid -ErrorAction SilentlyContinue) { Write-Host 'The local test browser is already open. Look for it on the taskbar.'; return }
        }
        $launchId = [guid]::NewGuid().ToString()
        $browserProcess = Start-Process -FilePath $node -ArgumentList @('--experimental-strip-types', 'scripts/manual-notes/browser.ts', '--launch-id', $launchId) -WorkingDirectory $repo -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $stateDir 'browser.log') -RedirectStandardError (Join-Path $stateDir 'browser.err.log')
        for ($attempt = 0; $attempt -lt 60; $attempt++) {
            if (Test-Path -LiteralPath $readyFile) {
                $ready = Get-Content -LiteralPath $readyFile -Raw | ConvertFrom-Json
                if ($ready.launchId -eq $launchId) { Write-Host 'Opened the isolated browser with Common Notes (Local Test) installed.'; return }
            }
            Start-Sleep -Milliseconds 250
        }
        throw 'The test browser did not become ready. Read .local-test/browser.err.log.'
    }
    'Stop' {
        foreach ($name in @('website', 'fixtures')) {
            $file = Join-Path $stateDir "$name.pid.json"
            if (Test-Path -LiteralPath $file) {
                $saved = Get-Content -LiteralPath $file -Raw | ConvertFrom-Json
                $process = Get-Process -Id $saved.id -ErrorAction SilentlyContinue
                if ($process -and $process.StartTime.ToUniversalTime().ToString('o') -eq $saved.started) { Stop-Process -Id $process.Id -Force }
            }
        }
        Invoke-Stack @('stop')
    }
}
