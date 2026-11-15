// The Windows tray host: a PowerShell NotifyIcon (WinForms ships with Windows: no dependency). It only displays: it
// reads one TrayView JSON per stdin line and writes `click <id>` lines; stdin closing (Node gone) ends it.
export const WINDOWS_HOST_PS1 = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
[Console]::InputEncoding = [Text.Encoding]::UTF8
[Console]::OutputEncoding = [Text.Encoding]::UTF8

function New-DotIcon([string]$hex) {
  $bmp = New-Object System.Drawing.Bitmap 16, 16
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $brush = New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml($hex))
  $g.FillEllipse($brush, 1, 1, 14, 14)
  $g.DrawEllipse((New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(160, 0, 0, 0)), 1), 1, 1, 13, 13)
  $g.Dispose()
  [System.Drawing.Icon]::FromHandle($bmp.GetHicon())
}
$icons = @{ ok = New-DotIcon '#2da44e'; warn = New-DotIcon '#d4a72c'; down = New-DotIcon '#8c959f' }

function Send([string]$line) { [Console]::Out.WriteLine($line); [Console]::Out.Flush() }

$tray = New-Object System.Windows.Forms.NotifyIcon
$tray.Icon = $icons.down
$tray.Text = 'porlocal'
$tray.ContextMenuStrip = New-Object System.Windows.Forms.ContextMenuStrip
$tray.Visible = $true
$tray.add_MouseClick({ param($s, $e) if ($e.Button -eq [System.Windows.Forms.MouseButtons]::Left) { Send 'click dashboard' } })

function Apply($view) {
  $tray.Icon = $icons[$view.icon]
  $tray.Text = $view.tooltip
  $menu = $tray.ContextMenuStrip
  $menu.Items.Clear()
  foreach ($item in $view.items) {
    if ($item.label -eq '-') { [void]$menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator)); continue }
    $mi = New-Object System.Windows.Forms.ToolStripMenuItem $item.label
    $mi.Tag = $item.id
    if ($item.enabled -eq $false) { $mi.Enabled = $false }
    $mi.add_Click({ param($s, $e) Send ('click ' + $s.Tag); if ($s.Tag -eq 'quit') { [System.Windows.Forms.Application]::Exit() } })
    [void]$menu.Items.Add($mi)
  }
  foreach ($b in $view.balloons) { $tray.ShowBalloonTip(5000, $b.title, $b.text, [System.Windows.Forms.ToolTipIcon]::Info) }
}

# Stdin is read asynchronously and checked by a UI timer: a blocking read would freeze the message loop (clicks
# unanswered). Not [Console]::In: its ReadLineAsync blocks (a synchronized reader); a StreamReader's does not.
$stdin = New-Object System.IO.StreamReader ([Console]::OpenStandardInput()), ([Text.Encoding]::UTF8)
$pending = $stdin.ReadLineAsync()
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 100
$timer.add_Tick({
  while ($pending.IsCompleted) {
    $line = $pending.Result
    if ($null -eq $line) { [System.Windows.Forms.Application]::Exit(); return }
    try { Apply ($line | ConvertFrom-Json) } catch { [Console]::Error.WriteLine("tray host: $_") }
    $script:pending = $stdin.ReadLineAsync()
  }
})
$timer.Start()
[System.Windows.Forms.Application]::Run()
$tray.Visible = $false
$tray.Dispose()
`
