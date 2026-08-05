param([string]$Title = "Auto-Screen Demo")

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

function Convert-Utf8Text([string]$Base64) {
  return [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($Base64))
}

$form = [System.Windows.Forms.Form]::new()
$form.Text = $Title
$form.StartPosition = "Manual"
$form.Location = [System.Drawing.Point]::new(120, 120)
$form.Size = [System.Drawing.Size]::new(900, 650)
$form.BackColor = [System.Drawing.Color]::FromArgb(245, 247, 250)

$heading = [System.Windows.Forms.Label]::new()
$heading.Text = Convert-Utf8Text "RGVtb25zdHJhw6fDo28gZG8gQXV0by1TY3JlZW4="
$heading.Font = [System.Drawing.Font]::new("Segoe UI", 22, [System.Drawing.FontStyle]::Bold)
$heading.Location = [System.Drawing.Point]::new(50, 35)
$heading.AutoSize = $true
$form.Controls.Add($heading)

$status = [System.Windows.Forms.Label]::new()
$status.Text = Convert-Utf8Text "QWd1YXJkYW5kbyBpbnRlcmHDp8OjbyBhZ8OqbnRpY2E="
$status.Font = [System.Drawing.Font]::new("Segoe UI", 13)
$status.Location = [System.Drawing.Point]::new(55, 105)
$status.Size = [System.Drawing.Size]::new(450, 35)
$form.Controls.Add($status)

$button = [System.Windows.Forms.Button]::new()
$button.Text = Convert-Utf8Text "RXhlY3V0YXIgYcOnw6Nv"
$button.Font = [System.Drawing.Font]::new("Segoe UI", 12)
$button.Location = [System.Drawing.Point]::new(55, 165)
$button.Size = [System.Drawing.Size]::new(220, 55)
$button.Add_Click({ $status.Text = Convert-Utf8Text "QcOnw6NvIGNvbmNsdcOtZGEgY29tIHN1Y2Vzc28="; $status.ForeColor = [System.Drawing.Color]::FromArgb(15, 118, 110) })
$form.Controls.Add($button)

$inputLabel = [System.Windows.Forms.Label]::new()
$inputLabel.Text = "Texto de teste"
$inputLabel.Font = [System.Drawing.Font]::new("Segoe UI", 11)
$inputLabel.Location = [System.Drawing.Point]::new(55, 250)
$inputLabel.AutoSize = $true
$form.Controls.Add($inputLabel)

$input = [System.Windows.Forms.TextBox]::new()
$input.Name = "AgentInput"
$input.Font = [System.Drawing.Font]::new("Segoe UI", 12)
$input.Location = [System.Drawing.Point]::new(55, 280)
$input.Size = [System.Drawing.Size]::new(390, 35)
$form.Controls.Add($input)

$list = [System.Windows.Forms.ListBox]::new()
$list.Font = [System.Drawing.Font]::new("Segoe UI", 12)
$list.Location = [System.Drawing.Point]::new(510, 145)
$list.Size = [System.Drawing.Size]::new(300, 350)
1..30 | ForEach-Object { [void]$list.Items.Add("Etapa $_ do processo") }
$form.Controls.Add($list)

$hint = [System.Windows.Forms.Label]::new()
$hint.Text = Convert-Utf8Text "TyBjdXJzb3Igc2Vyw6EgbW92aWRvLCBjbGljYXLDoSBubyBib3TDo28gZSByb2xhcsOhIGEgbGlzdGEu"
$hint.Font = [System.Drawing.Font]::new("Segoe UI", 11)
$hint.Location = [System.Drawing.Point]::new(55, 350)
$hint.Size = [System.Drawing.Size]::new(390, 80)
$form.Controls.Add($hint)

[void]$form.ShowDialog()
