param([string]$Title = "Auto-Screen Demo")

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$form = [System.Windows.Forms.Form]::new()
$form.Text = $Title
$form.StartPosition = "Manual"
$form.Location = [System.Drawing.Point]::new(120, 120)
$form.Size = [System.Drawing.Size]::new(900, 650)
$form.BackColor = [System.Drawing.Color]::FromArgb(245, 247, 250)

$heading = [System.Windows.Forms.Label]::new()
$heading.Text = "Demonstração do Auto-Screen"
$heading.Font = [System.Drawing.Font]::new("Segoe UI", 22, [System.Drawing.FontStyle]::Bold)
$heading.Location = [System.Drawing.Point]::new(50, 35)
$heading.AutoSize = $true
$form.Controls.Add($heading)

$status = [System.Windows.Forms.Label]::new()
$status.Text = "Aguardando interação agêntica"
$status.Font = [System.Drawing.Font]::new("Segoe UI", 13)
$status.Location = [System.Drawing.Point]::new(55, 105)
$status.Size = [System.Drawing.Size]::new(450, 35)
$form.Controls.Add($status)

$button = [System.Windows.Forms.Button]::new()
$button.Text = "Executar ação"
$button.Font = [System.Drawing.Font]::new("Segoe UI", 12)
$button.Location = [System.Drawing.Point]::new(55, 165)
$button.Size = [System.Drawing.Size]::new(220, 55)
$button.Add_Click({ $status.Text = "Ação concluída com sucesso"; $status.ForeColor = [System.Drawing.Color]::FromArgb(15, 118, 110) })
$form.Controls.Add($button)

$list = [System.Windows.Forms.ListBox]::new()
$list.Font = [System.Drawing.Font]::new("Segoe UI", 12)
$list.Location = [System.Drawing.Point]::new(510, 145)
$list.Size = [System.Drawing.Size]::new(300, 350)
1..30 | ForEach-Object { [void]$list.Items.Add("Etapa $_ do processo") }
$form.Controls.Add($list)

$hint = [System.Windows.Forms.Label]::new()
$hint.Text = "O cursor será movido, clicará no botão e rolará a lista."
$hint.Font = [System.Drawing.Font]::new("Segoe UI", 11)
$hint.Location = [System.Drawing.Point]::new(55, 280)
$hint.Size = [System.Drawing.Size]::new(390, 80)
$form.Controls.Add($hint)

[void]$form.ShowDialog()
