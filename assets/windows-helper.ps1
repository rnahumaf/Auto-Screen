param(
  [ValidateSet("metrics", "windows", "displays", "type-unicode", "pointer-events")]
  [string]$Command = "metrics",
  [int]$X = 0,
  [int]$Y = 0,
  [long]$ExpectedHandle = 0,
  [int]$IntervalMs = 0
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)

Add-Type -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

public static class AutoScreenNative {
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
    public delegate bool MonitorEnumProc(IntPtr hMonitor, IntPtr hdcMonitor, ref RECT rect, IntPtr data);

    [StructLayout(LayoutKind.Sequential)]
    public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
    [StructLayout(LayoutKind.Sequential)]
    public struct POINT { public int X; public int Y; }
    [StructLayout(LayoutKind.Sequential)]
    public struct MOUSEINPUT {
        public int dx;
        public int dy;
        public uint mouseData;
        public uint dwFlags;
        public uint time;
        public UIntPtr dwExtraInfo;
    }
    [StructLayout(LayoutKind.Sequential)]
    public struct KEYBDINPUT {
        public ushort wVk;
        public ushort wScan;
        public uint dwFlags;
        public uint time;
        public UIntPtr dwExtraInfo;
    }
    [StructLayout(LayoutKind.Sequential)]
    public struct HARDWAREINPUT { public uint uMsg; public ushort wParamL; public ushort wParamH; }
    [StructLayout(LayoutKind.Explicit)]
    public struct INPUTUNION {
        [FieldOffset(0)] public MOUSEINPUT mi;
        [FieldOffset(0)] public KEYBDINPUT ki;
        [FieldOffset(0)] public HARDWAREINPUT hi;
    }
    [StructLayout(LayoutKind.Sequential)]
    public struct INPUT { public uint type; public INPUTUNION data; }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct MONITORINFOEX {
        public int cbSize;
        public RECT rcMonitor;
        public RECT rcWork;
        public uint dwFlags;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string szDevice;
    }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct DXGI_OUTPUT_DESC {
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string DeviceName;
        public RECT DesktopCoordinates;
        [MarshalAs(UnmanagedType.Bool)] public bool AttachedToDesktop;
        public int Rotation;
        public IntPtr Monitor;
    }

    [ComImport, Guid("770AAE78-F26F-4DBA-A829-253C83D1B387"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IDXGIFactory1 {
        [PreserveSig] int SetPrivateData(ref Guid name, uint size, IntPtr data);
        [PreserveSig] int SetPrivateDataInterface(ref Guid name, IntPtr unknown);
        [PreserveSig] int GetPrivateData(ref Guid name, ref uint size, IntPtr data);
        [PreserveSig] int GetParent(ref Guid riid, out IntPtr parent);
        [PreserveSig] int EnumAdapters(uint adapter, out IntPtr result);
        [PreserveSig] int MakeWindowAssociation(IntPtr window, uint flags);
        [PreserveSig] int GetWindowAssociation(out IntPtr window);
        [PreserveSig] int CreateSwapChain(IntPtr device, IntPtr description, out IntPtr swapChain);
        [PreserveSig] int CreateSoftwareAdapter(IntPtr module, out IntPtr adapter);
        [PreserveSig] int EnumAdapters1(uint adapter, out IDXGIAdapter1 result);
        [return: MarshalAs(UnmanagedType.Bool)] bool IsCurrent();
    }

    [ComImport, Guid("29038F61-3839-4626-91FD-086879011A05"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IDXGIAdapter1 {
        [PreserveSig] int SetPrivateData(ref Guid name, uint size, IntPtr data);
        [PreserveSig] int SetPrivateDataInterface(ref Guid name, IntPtr unknown);
        [PreserveSig] int GetPrivateData(ref Guid name, ref uint size, IntPtr data);
        [PreserveSig] int GetParent(ref Guid riid, out IntPtr parent);
        [PreserveSig] int EnumOutputs(uint output, out IDXGIOutput result);
        [PreserveSig] int GetDesc(IntPtr description);
        [PreserveSig] int CheckInterfaceSupport(ref Guid interfaceName, out long version);
        [PreserveSig] int GetDesc1(IntPtr description);
    }

    [ComImport, Guid("AE02EEDB-C735-4690-8D52-5A8DC20213AA"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IDXGIOutput {
        [PreserveSig] int SetPrivateData(ref Guid name, uint size, IntPtr data);
        [PreserveSig] int SetPrivateDataInterface(ref Guid name, IntPtr unknown);
        [PreserveSig] int GetPrivateData(ref Guid name, ref uint size, IntPtr data);
        [PreserveSig] int GetParent(ref Guid riid, out IntPtr parent);
        [PreserveSig] int GetDesc(out DXGI_OUTPUT_DESC description);
    }

    public sealed class DxgiOutputInfo {
        public string DeviceName;
        public int AdapterIndex;
        public int OutputIndex;
    }

    [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
    [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr value);
    [DllImport("user32.dll")] public static extern int GetSystemMetrics(int index);
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool EnumDisplayMonitors(IntPtr hdc, IntPtr clip, MonitorEnumProc callback, IntPtr data);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern bool GetMonitorInfo(IntPtr monitor, ref MONITORINFOEX info);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowTextLength(IntPtr hWnd);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
    [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern IntPtr MonitorFromPoint(POINT point, uint flags);
    [DllImport("user32.dll")] public static extern IntPtr MonitorFromWindow(IntPtr window, uint flags);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT point);
    [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int virtualKey);
    [DllImport("user32.dll", SetLastError = true)] public static extern uint SendInput(uint count, INPUT[] inputs, int size);
    [DllImport("shcore.dll")] public static extern int GetDpiForMonitor(IntPtr monitor, int dpiType, out uint dpiX, out uint dpiY);
    [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr hWnd, int attribute, out RECT rect, int size);
    [DllImport("dxgi.dll", ExactSpelling = true)] private static extern int CreateDXGIFactory1(ref Guid riid, out IDXGIFactory1 factory);

    public static bool GetVisualWindowRect(IntPtr hWnd, out RECT rect) {
        const int DWMWA_EXTENDED_FRAME_BOUNDS = 9;
        if (DwmGetWindowAttribute(hWnd, DWMWA_EXTENDED_FRAME_BOUNDS, out rect, Marshal.SizeOf(typeof(RECT))) == 0) return true;
        return GetWindowRect(hWnd, out rect);
    }

    public static uint GetDpiAt(int x, int y) {
        POINT point = new POINT { X = x, Y = y };
        IntPtr monitor = MonitorFromPoint(point, 2);
        uint dpiX;
        uint dpiY;
        if (monitor != IntPtr.Zero && GetDpiForMonitor(monitor, 0, out dpiX, out dpiY) == 0) return dpiX;
        return 96;
    }

    public static List<DxgiOutputInfo> GetDxgiOutputs() {
        Guid factoryId = new Guid("770AAE78-F26F-4DBA-A829-253C83D1B387");
        IDXGIFactory1 factory;
        int result = CreateDXGIFactory1(ref factoryId, out factory);
        if (result < 0) Marshal.ThrowExceptionForHR(result);
        List<DxgiOutputInfo> outputs = new List<DxgiOutputInfo>();
        try {
            for (uint adapterIndex = 0; ; adapterIndex++) {
                IDXGIAdapter1 adapter;
                result = factory.EnumAdapters1(adapterIndex, out adapter);
                if (result == unchecked((int)0x887A0002)) break;
                if (result < 0) Marshal.ThrowExceptionForHR(result);
                try {
                    for (uint outputIndex = 0; ; outputIndex++) {
                        IDXGIOutput output;
                        result = adapter.EnumOutputs(outputIndex, out output);
                        if (result == unchecked((int)0x887A0002)) break;
                        if (result < 0) Marshal.ThrowExceptionForHR(result);
                        try {
                            DXGI_OUTPUT_DESC description;
                            result = output.GetDesc(out description);
                            if (result < 0) Marshal.ThrowExceptionForHR(result);
                            if (description.AttachedToDesktop) outputs.Add(new DxgiOutputInfo {
                                DeviceName = description.DeviceName,
                                AdapterIndex = (int)adapterIndex,
                                OutputIndex = (int)outputIndex
                            });
                        } finally { Marshal.FinalReleaseComObject(output); }
                    }
                } finally { Marshal.FinalReleaseComObject(adapter); }
            }
        } finally { Marshal.FinalReleaseComObject(factory); }
        return outputs;
    }

    public static void TypeUnicode(string text, long expectedHandle, int intervalMs) {
        const uint INPUT_KEYBOARD = 1;
        const uint KEYEVENTF_KEYUP = 0x0002;
        const uint KEYEVENTF_UNICODE = 0x0004;
        IntPtr expected = new IntPtr(expectedHandle);
        foreach (char character in text) {
            if (expected != IntPtr.Zero && GetForegroundWindow() != expected) {
                throw new InvalidOperationException("Foreground window changed during Unicode input.");
            }
            INPUT[] inputs = new INPUT[2];
            inputs[0].type = INPUT_KEYBOARD;
            inputs[0].data.ki.wScan = character;
            inputs[0].data.ki.dwFlags = KEYEVENTF_UNICODE;
            inputs[1].type = INPUT_KEYBOARD;
            inputs[1].data.ki.wScan = character;
            inputs[1].data.ki.dwFlags = KEYEVENTF_UNICODE | KEYEVENTF_KEYUP;
            uint sent = SendInput((uint)inputs.Length, inputs, Marshal.SizeOf(typeof(INPUT)));
            if (sent != inputs.Length) throw new Win32Exception(Marshal.GetLastWin32Error(), "SendInput did not send the Unicode character.");
            if (intervalMs > 0) Thread.Sleep(intervalMs);
        }
    }

}
"@

try {
  [void][AutoScreenNative]::SetProcessDpiAwarenessContext([IntPtr]::new(-4))
} catch {
  [void][AutoScreenNative]::SetProcessDPIAware()
}

if ($Command -eq "metrics") {
  $result = [ordered]@{
    x = [AutoScreenNative]::GetSystemMetrics(76)
    y = [AutoScreenNative]::GetSystemMetrics(77)
    width = [AutoScreenNative]::GetSystemMetrics(78)
    height = [AutoScreenNative]::GetSystemMetrics(79)
    dpi = [int][AutoScreenNative]::GetDpiAt($X, $Y)
  }
  $result | ConvertTo-Json -Compress
  exit 0
}

if ($Command -eq "pointer-events") {
  $lastMask = -1
  $lastX = [int]::MinValue
  $lastY = [int]::MinValue
  $frequency = [Diagnostics.Stopwatch]::Frequency
  while ($true) {
    $point = [AutoScreenNative+POINT]::new()
    if (-not [AutoScreenNative]::GetCursorPos([ref]$point)) { throw "GetCursorPos falhou." }
    $mask = 0
    if (([AutoScreenNative]::GetAsyncKeyState(1) -band 0x8000) -ne 0) { $mask = $mask -bor 1 }
    if (([AutoScreenNative]::GetAsyncKeyState(2) -band 0x8000) -ne 0) { $mask = $mask -bor 2 }
    if (([AutoScreenNative]::GetAsyncKeyState(4) -band 0x8000) -ne 0) { $mask = $mask -bor 4 }
    if ($mask -ne $lastMask -or $point.X -ne $lastX -or $point.Y -ne $lastY) {
      $timestamp = [Diagnostics.Stopwatch]::GetTimestamp()
      [Console]::Out.WriteLine("{0}`t{1}`t{2}`t{3}`t{4}", $point.X, $point.Y, $mask, $timestamp, $frequency)
      [Console]::Out.Flush()
      $lastMask = $mask
      $lastX = $point.X
      $lastY = $point.Y
    }
    [Threading.Thread]::Sleep(4)
  }
}

if ($Command -eq "type-unicode") {
  if ($IntervalMs -lt 0 -or $IntervalMs -gt 1000) { throw "IntervalMs deve ficar entre 0 e 1000." }
  $text = [Console]::In.ReadToEnd()
  [AutoScreenNative]::TypeUnicode($text, $ExpectedHandle, $IntervalMs)
  [ordered]@{ characterCount = $text.Length } | ConvertTo-Json -Compress
  exit 0
}

if ($Command -eq "displays") {
  $dxgiByDevice = @{}
  foreach ($output in [AutoScreenNative]::GetDxgiOutputs()) {
    $dxgiByDevice[$output.DeviceName.ToUpperInvariant()] = $output
  }
  $displays = [System.Collections.Generic.List[object]]::new()
  $monitorCallback = [AutoScreenNative+MonitorEnumProc]{
    param([IntPtr]$monitor, [IntPtr]$dc, [ref][AutoScreenNative+RECT]$rect, [IntPtr]$state)
    $info = [AutoScreenNative+MONITORINFOEX]::new()
    $info.cbSize = [Runtime.InteropServices.Marshal]::SizeOf([type][AutoScreenNative+MONITORINFOEX])
    if ([AutoScreenNative]::GetMonitorInfo($monitor, [ref]$info)) {
      $dxgi = $dxgiByDevice[$info.szDevice.ToUpperInvariant()]
      if ($null -ne $dxgi) {
        $displays.Add([ordered]@{
          deviceName = $info.szDevice
          adapterIndex = $dxgi.AdapterIndex
          outputIndex = $dxgi.OutputIndex
          x = $info.rcMonitor.Left
          y = $info.rcMonitor.Top
          width = $info.rcMonitor.Right - $info.rcMonitor.Left
          height = $info.rcMonitor.Bottom - $info.rcMonitor.Top
          dpi = [int][AutoScreenNative]::GetDpiAt($info.rcMonitor.Left + 1, $info.rcMonitor.Top + 1)
          primary = (($info.dwFlags -band 1) -ne 0)
        })
      }
    }
    return $true
  }
  [void][AutoScreenNative]::EnumDisplayMonitors([IntPtr]::Zero, [IntPtr]::Zero, $monitorCallback, [IntPtr]::Zero)
  $orderedDisplays = @($displays | Sort-Object @{ Expression = { -[int]$_.primary } }, x, y, deviceName)
  for ($displayIndex = 0; $displayIndex -lt $orderedDisplays.Count; $displayIndex++) {
    $orderedDisplays[$displayIndex].Insert(0, "index", $displayIndex)
  }
  @($orderedDisplays) | ConvertTo-Json -Compress
  exit 0
}

function Convert-Window([IntPtr]$handle) {
  if ($handle -eq [IntPtr]::Zero) { return $null }
  $length = [AutoScreenNative]::GetWindowTextLength($handle)
  $builder = [System.Text.StringBuilder]::new([Math]::Max(1, $length + 1))
  [void][AutoScreenNative]::GetWindowText($handle, $builder, $builder.Capacity)
  $rect = [AutoScreenNative+RECT]::new()
  if (-not [AutoScreenNative]::GetVisualWindowRect($handle, [ref]$rect)) { return $null }
  [uint32]$processId = 0
  [void][AutoScreenNative]::GetWindowThreadProcessId($handle, [ref]$processId)
  $dpi = 96
  try { $dpi = [int][AutoScreenNative]::GetDpiForWindow($handle) } catch { $dpi = 96 }
  $monitor = [AutoScreenNative]::MonitorFromWindow($handle, 2)
  $monitorInfo = [AutoScreenNative+MONITORINFOEX]::new()
  $monitorInfo.cbSize = [Runtime.InteropServices.Marshal]::SizeOf([type][AutoScreenNative+MONITORINFOEX])
  $displayDeviceName = ""
  if ($monitor -ne [IntPtr]::Zero -and [AutoScreenNative]::GetMonitorInfo($monitor, [ref]$monitorInfo)) {
    $displayDeviceName = $monitorInfo.szDevice
  }
  return [ordered]@{
    title = $builder.ToString()
    processId = [int]$processId
    handle = $handle.ToInt64().ToString()
    x = $rect.Left
    y = $rect.Top
    width = $rect.Right - $rect.Left
    height = $rect.Bottom - $rect.Top
    dpi = $dpi
    displayDeviceName = $displayDeviceName
  }
}


$items = [System.Collections.Generic.List[object]]::new()
$callback = [AutoScreenNative+EnumWindowsProc]{
  param([IntPtr]$handle, [IntPtr]$state)
  if (-not [AutoScreenNative]::IsWindowVisible($handle)) { return $true }
  $item = Convert-Window $handle
  if ($null -eq $item -or [string]::IsNullOrWhiteSpace($item.title)) { return $true }
  $items.Add($item)
  return $true
}
[void][AutoScreenNative]::EnumWindows($callback, [IntPtr]::Zero)
@($items) | ConvertTo-Json -Compress
