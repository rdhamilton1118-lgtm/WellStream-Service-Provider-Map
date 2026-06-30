param(
  [string]$InputDirectory = 'assets',
  [string]$OutputDirectory = 'research/asset-ocr'
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.IRandomAccessStream, Windows.Storage.Streams, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.SoftwareBitmap, Windows.Graphics.Imaging, ContentType = WindowsRuntime]
$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Media.Ocr.OcrResult, Windows.Foundation, ContentType = WindowsRuntime]

$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetParameters().Count -eq 1
})[0]

function Await-WinRT($Operation, [Type]$ResultType) {
  $task = $asTaskGeneric.MakeGenericMethod($ResultType).Invoke($null, @($Operation))
  $task.Wait()
  $task.Result
}

$inputPath = (Resolve-Path $InputDirectory).Path
$outputPath = Join-Path (Get-Location) $OutputDirectory
New-Item -ItemType Directory -Path $outputPath -Force | Out-Null
$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
if (-not $engine) { throw 'Windows OCR could not create an engine for the installed user languages.' }

$images = Get-ChildItem -LiteralPath $inputPath -File | Where-Object {
  $_.Extension -match '^\.(jpg|jpeg|png|tif|tiff|bmp)$' -and $_.Name -match '^(Scan_|20260624_)'
} | Sort-Object Name

foreach ($image in $images) {
  $outputFile = Join-Path $outputPath ($image.BaseName + '.txt')
  $file = Await-WinRT ([Windows.Storage.StorageFile]::GetFileFromPathAsync($image.FullName)) ([Windows.Storage.StorageFile])
  $stream = Await-WinRT ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
  try {
    $decoder = Await-WinRT ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
    $bitmap = Await-WinRT ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
    try {
      $result = Await-WinRT ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
      $lineText = ($result.Lines | ForEach-Object { $_.Text }) -join [Environment]::NewLine
      [System.IO.File]::WriteAllText($outputFile, $lineText, [System.Text.UTF8Encoding]::new($false))
      Write-Output "$($image.Name)`t$($result.Lines.Count) lines`t$($lineText.Length) characters"
    } finally {
      if ($bitmap -is [System.IDisposable]) { $bitmap.Dispose() }
    }
  } finally {
    $stream.Dispose()
  }
}
