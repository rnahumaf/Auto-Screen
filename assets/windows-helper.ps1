param(
  [ValidateSet("metrics", "windows")]
  [string]$Command = "metrics"
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

Add-Type -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public static class AutoScreenNative {
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [StructLayout(LayoutKind.Sequential)]
    public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }

    [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
    [DllImport("user32.dll")] public static extern int GetSystemMetrics(int index);
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowTextLength(IntPtr hWnd);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
    [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr hWnd);
}
"@

[void][AutoScreenNative]::SetProcessDPIAware()

if ($Command -eq "metrics") {
  $result = [ordered]@{
    x = [AutoScreenNative]::GetSystemMetrics(76)
    y = [AutoScreenNative]::GetSystemMetrics(77)
    width = [AutoScreenNative]::GetSystemMetrics(78)
    height = [AutoScreenNative]::GetSystemMetrics(79)
    dpi = 96
  }
  $result | ConvertTo-Json -Compress
  exit 0
}

$items = [System.Collections.Generic.List[object]]::new()
$callback = [AutoScreenNative+EnumWindowsProc]{
  param([IntPtr]$handle, [IntPtr]$state)
  if (-not [AutoScreenNative]::IsWindowVisible($handle)) { return $true }
  $length = [AutoScreenNative]::GetWindowTextLength($handle)
  if ($length -le 0) { return $true }
  $builder = [System.Text.StringBuilder]::new($length + 1)
  [void][AutoScreenNative]::GetWindowText($handle, $builder, $builder.Capacity)
  $rect = [AutoScreenNative+RECT]::new()
  if (-not [AutoScreenNative]::GetWindowRect($handle, [ref]$rect)) { return $true }
  [uint32]$processId = 0
  [void][AutoScreenNative]::GetWindowThreadProcessId($handle, [ref]$processId)
  $dpi = 96
  try { $dpi = [int][AutoScreenNative]::GetDpiForWindow($handle) } catch { $dpi = 96 }
  $items.Add([ordered]@{
    title = $builder.ToString()
    processId = [int]$processId
    handle = $handle.ToInt64().ToString()
    x = $rect.Left
    y = $rect.Top
    width = $rect.Right - $rect.Left
    height = $rect.Bottom - $rect.Top
    dpi = $dpi
  })
  return $true
}
[void][AutoScreenNative]::EnumWindows($callback, [IntPtr]::Zero)
@($items) | ConvertTo-Json -Compress
