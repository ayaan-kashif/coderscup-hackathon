# Renders PLACEHOLDER prompt clips with the Windows built-in TTS (System.Speech), 16 kHz 8-bit mono WAV.
# Usage (Windows PowerShell): powershell -File scripts/voice/generate-placeholder-clips.ps1
# The real Urdu clips are generated from text_ur by the TTS provider chosen in the bake-off.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$prompts = Get-Content -Raw -Encoding UTF8 (Join-Path $PSScriptRoot 'prompts.json') | ConvertFrom-Json
$out = Join-Path $root 'public\voice\ur'
New-Item -ItemType Directory -Force $out | Out-Null
$fmt = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Eight, [System.Speech.AudioFormat.AudioChannel]::Mono)
$manifest = @()
foreach ($p in $prompts.prompts) {
  $synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
  $synth.Rate = -1
  $file = Join-Path $out ($p.key + '.wav')
  $synth.SetOutputToWaveFile($file, $fmt)
  $synth.Speak($p.text_roman)
  $synth.Dispose()
  $manifest += [ordered]@{ key = $p.key; file = "/voice/ur/$($p.key).wav"; text_ur = $p.text_ur; text_roman = $p.text_roman; placeholder = $true; bytes = (Get-Item $file).Length }
}
$json = @{ version = 'prompts-v0-placeholder'; clips = $manifest } | ConvertTo-Json -Depth 4
[System.IO.File]::WriteAllText((Join-Path $out 'manifest.json'), $json, (New-Object System.Text.UTF8Encoding($false)))
Write-Output ("{0} clips, {1:N0} KB total" -f $manifest.Count, (($manifest | ForEach-Object { $_.bytes } | Measure-Object -Sum).Sum / 1KB))
