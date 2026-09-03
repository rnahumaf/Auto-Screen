param([int]$DurationSeconds = 15)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -ReferencedAssemblies System.Windows.Forms,System.Drawing -TypeDefinition @"
using System.Drawing;
using System.Windows.Forms;

public sealed class AutoScreenPatternForm : Form {
    private bool alternate;
    public AutoScreenPatternForm() {
        DoubleBuffered = true;
        SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint |
            ControlStyles.OptimizedDoubleBuffer | ControlStyles.Opaque, true);
        UpdateStyles();
    }
    public void FlipPattern() {
        alternate = !alternate;
        Invalidate();
        Update();
    }
    protected override void OnPaintBackground(PaintEventArgs eventArgs) { }
    protected override void OnPaint(PaintEventArgs eventArgs) {
        eventArgs.Graphics.Clear(alternate ? Color.FromArgb(224, 192, 64) : Color.FromArgb(32, 64, 96));
    }
}
"@

try { [System.Windows.Forms.Application]::SetHighDpiMode([System.Windows.Forms.HighDpiMode]::PerMonitorV2) } catch {}

$form = [AutoScreenPatternForm]::new()
$form.Text = "Auto-Screen Capture Fixture"
$form.StartPosition = "Manual"
$form.Location = [System.Drawing.Point]::new(240, 180)
$form.ClientSize = [System.Drawing.Size]::new(800, 600)
$form.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::FixedSingle
$form.MaximizeBox = $false
$form.TopMost = $true

$timer = [System.Windows.Forms.Timer]::new()
$timer.Interval = 80
$timer.Add_Tick({ $form.FlipPattern() })

$closeTimer = [System.Windows.Forms.Timer]::new()
$closeTimer.Interval = [Math]::Max(1, $DurationSeconds * 1000)
$closeTimer.Add_Tick({ $form.Close() })
$form.Add_Shown({ $timer.Start(); $closeTimer.Start() })
$form.Add_FormClosed({ $timer.Stop(); $closeTimer.Stop() })
[void]$form.ShowDialog()
