param([Parameter(ValueFromRemainingArguments=$true)][string[]]$TrainingArgs)
$ErrorActionPreference = 'Stop'
$env:PYTHONPATH = "$PSScriptRoot\.venv\Lib\site-packages;$PSScriptRoot"
$env:OMP_NUM_THREADS = '1'
$env:MKL_NUM_THREADS = '1'
$env:MPLBACKEND = 'Agg'
$runtimePython = 'C:\Users\ankud\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe'
& $runtimePython -u -m rl.seeker_runner @TrainingArgs
exit $LASTEXITCODE
