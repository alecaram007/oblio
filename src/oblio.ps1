<#
    OBLIO - il file system che dimentica come un essere umano.
    Prototipo in Windows PowerShell 5.1: nessuna installazione richiesta.

    Ogni file viene salvato a strati di dettaglio decrescente, ciascuno cifrato
    con una chiave diversa. Col passare del tempo senza aperture la vitalità
    del file cala (curva dell'oblio di Ebbinghaus) e le chiavi degli strati più
    dettagliati vengono distrutte: il file sbiadisce, fino a restare una traccia.

    Uso:  oblio <comando> [argomento] [-Archivio <cartella>]      (oblio aiuto)
#>
[CmdletBinding()]
param(
    [Parameter(Position = 0)] [string] $Comando = 'aiuto',
    [Parameter(Position = 1)] [string] $Argomento,
    [string] $Archivio,
    [switch] $Sposta,
    [switch] $Conferma,
    [switch] $Mostra
)

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch { }
try { Remove-TypeData -TypeName System.Array -ErrorAction Stop } catch { }
Add-Type -AssemblyName System.Drawing

# ---------------------------------------------------------------------------
# Modello della memoria
# ---------------------------------------------------------------------------
# Vitalità R = e^(-t/S): t = giorni dall'ultima apertura, S = stabilità.
# Uno strato sopravvive finché R resta sopra la sua soglia.
$STABILITA_BASE = 180.0   # con velocità "normale" un file mai riaperto resta nitido ~4 mesi
$RIPASSO        = 2.5     # ogni apertura moltiplica la stabilità (ripetizione spaziata)
$STABILITA_MAX  = 3650.0
$VELOCITA       = [ordered]@{ 'elefante' = 4.0; 'normale' = 1.0; 'pesce-rosso' = 0.25 }

$EST_IMMAGINI = @('.jpg', '.jpeg', '.png', '.bmp', '.gif', '.tif', '.tiff')
$EST_TESTI    = @('.txt', '.md', '.log', '.csv')
$TIPI_NOTI    = @{
    '.pdf' = 'Documento PDF'; '.doc' = 'Documento Word'; '.docx' = 'Documento Word'
    '.xls' = 'Foglio Excel'; '.xlsx' = 'Foglio Excel'; '.ppt' = 'Presentazione'; '.pptx' = 'Presentazione'
    '.zip' = 'Archivio compresso'; '.rar' = 'Archivio compresso'; '.7z' = 'Archivio compresso'
    '.mp3' = 'Audio'; '.wav' = 'Audio'; '.m4a' = 'Audio'; '.mp4' = 'Video'; '.mov' = 'Video'; '.mkv' = 'Video'
    '.exe' = 'Programma'; '.bin' = 'Dati binari'
}

# Documenti che non devono mai sbiadire, riconosciuti dal nome o dal contenuto.
$NOMI_LEGALI  = '(fattur|scontrin|ricevut|contratt|garanzi|bollett|rogito|polizz|cedolin|busta.?paga)|(^|[\W_])(f24|730|cud)([\W_]|$)'
$TESTO_LEGALE = 'fattura\s*(n\.?|nr\.?|num)|partita\s*iva|p\.\s*iva|\biban\b|totale\s+da\s+pagare|codice\s+fiscale'

$IT  = [Globalization.CultureInfo]::GetCultureInfo('it-IT')
$INV = [Globalization.CultureInfo]::InvariantCulture

$STOP = New-Object 'System.Collections.Generic.HashSet[string]'
foreach ($parola in (@'
il lo la gli le un uno una di da in con su per tra fra ed ma che chi non si mi ti ci vi ne
del dello della dei degli delle al allo alla ai agli alle dal dallo dalla dai dagli dalle nel nello nella nei negli nelle
sul sullo sulla sui sugli sulle col come anche più piu poi se perché perche quando questo questa questi queste quello quella
quelli quelle sono sei siamo siete era erano ero sarà ho hai ha abbiamo avete hanno avevo aveva avere essere stato stata stati
molto molta molti tutto tutta tutti tutte ogni mio mia miei mie tuo tua suo sua suoi sue nostro nostra loro io tu lui lei noi voi
cosa già gia ancora solo sempre mai dove qui qua lì là fino dopo prima mentre però pero quindi allora così cosi tanto poco
nessuno nessuna niente nulla qualche qualcosa altro altra altri altre stesso stessa quale quali ecco
the and of to is it that for on with as was are be this by or at from an but not have has had we you they he she
my our your their its so if do did can will would just than then there what which who how all also into out up about more no
'@ -split '\s+')) { if ($parola) { [void]$STOP.Add($parola) } }

# ---------------------------------------------------------------------------
# Utilità
# ---------------------------------------------------------------------------
function Format-Byte([double]$n) {
    if ($n -ge 1MB) { return [string]::Format($IT, '{0:N1} MB', $n / 1MB) }
    if ($n -ge 1KB) { return [string]::Format($IT, '{0:N0} KB', $n / 1KB) }
    return "$([int]$n) B"
}

function Format-Data([datetime]$d) {
    if ($d.Kind -eq [DateTimeKind]::Utc) { $d = $d.ToLocalTime() }
    return $d.ToString('d MMM yyyy', $IT)
}

function Format-Nome([string]$n, [int]$max = 24) {
    if ($n.Length -le $max) { return $n }
    return $n.Substring(0, $max - 1) + '…'
}

function ConvertTo-Data($valore) {
    if ($valore -is [datetime]) { return $valore.ToUniversalTime() }
    return [datetime]::Parse([string]$valore, $INV, [Globalization.DateTimeStyles]::RoundtripKind).ToUniversalTime()
}

function Test-Contiene([string]$testo, [string]$cosa) {
    return [bool]($testo -and $testo.IndexOf($cosa, [StringComparison]::OrdinalIgnoreCase) -ge 0)
}

# ---------------------------------------------------------------------------
# Archivio su disco
# ---------------------------------------------------------------------------
function Get-Percorsi([string]$radice) {
    $meta = Join-Path $radice '.oblio'
    return [pscustomobject]@{
        Radice  = $radice
        Meta    = $meta
        Stato   = Join-Path $meta 'stato.json'
        Chiavi  = Join-Path $meta 'chiavi.json'
        Strati  = Join-Path $meta 'strati'
        Ricordi = Join-Path $radice 'ricordi'
    }
}

function Write-FileAtomico([string]$percorso, [string]$testo) {
    $tmp = "$percorso.tmp"
    [IO.File]::WriteAllText($tmp, $testo, (New-Object Text.UTF8Encoding $false))
    Move-Item -LiteralPath $tmp -Destination $percorso -Force
}

function Read-Stato($P) {
    if (-not (Test-Path -LiteralPath $P.Stato)) {
        throw "Nessun archivio Oblio in '$($P.Radice)'. Crealo con:  oblio crea"
    }
    $stato = [IO.File]::ReadAllText($P.Stato) | ConvertFrom-Json
    foreach ($campo in @{ offsetGiorni = 0; velocita = 'normale'; dimenticatiPerSempre = 0 }.GetEnumerator()) {
        if ($stato.PSObject.Properties.Name -notcontains $campo.Key) {
            $stato | Add-Member -NotePropertyName $campo.Key -NotePropertyValue $campo.Value
        }
    }
    $stato.voci = @($stato.voci | Where-Object { $_ })
    return $stato
}

function Save-Stato($P, $stato) {
    Write-FileAtomico $P.Stato ($stato | ConvertTo-Json -Depth 10)
}

# In un sistema vero le chiavi vivrebbero nel TPM o in un secure enclave:
# lì distruggerle è definitivo. Qui stanno in un file, per semplicità.
function Read-Chiavi($P) {
    $chiavi = @{}
    if (Test-Path -LiteralPath $P.Chiavi) {
        $o = [IO.File]::ReadAllText($P.Chiavi) | ConvertFrom-Json
        foreach ($pr in $o.PSObject.Properties) { $chiavi[$pr.Name] = [Convert]::FromBase64String($pr.Value) }
    }
    return $chiavi
}

function Save-Chiavi($P, $chiavi) {
    $o = [ordered]@{}
    foreach ($k in ($chiavi.Keys | Sort-Object)) { $o[$k] = [Convert]::ToBase64String($chiavi[$k]) }
    Write-FileAtomico $P.Chiavi (ConvertTo-Json -InputObject $o)
}

function New-Archivio($P) {
    if (Test-Path -LiteralPath $P.Stato) {
        Write-Host "  Esiste già un archivio Oblio in $($P.Radice)."
        return
    }
    New-Item -ItemType Directory -Force -Path $P.Meta, $P.Strati, $P.Ricordi | Out-Null
    try { (Get-Item -LiteralPath $P.Meta).Attributes += 'Hidden' } catch { }
    $stato = [pscustomobject]@{
        versione             = 1
        creato               = [datetime]::UtcNow.ToString('o')
        offsetGiorni         = 0
        velocita             = 'normale'
        dimenticatiPerSempre = 0
        voci                 = @()
    }
    Save-Chiavi $P @{}
    Save-Stato $P $stato
    Write-Host ''
    Write-Host "  Archivio Oblio creato in $($P.Radice)" -ForegroundColor White
    Write-Host '  Da qui in poi, ciò che non riapri sbiadisce. Aggiungi file con:  oblio aggiungi <file|cartella>' -ForegroundColor DarkGray
}

# ---------------------------------------------------------------------------
# Cifratura: ogni strato ha la sua chiave (AES-256-CBC + HMAC-SHA256)
# ---------------------------------------------------------------------------
function Get-Fetta([byte[]]$a, [int]$inizio, [int]$lunghezza) {
    $r = New-Object byte[] $lunghezza
    [Array]::Copy($a, $inizio, $r, 0, $lunghezza)
    return ,$r
}

function New-Chiave {
    $k = New-Object byte[] 64
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    $rng.GetBytes($k)
    $rng.Dispose()
    return ,$k
}

function Protect-Strato([byte[]]$dati, [byte[]]$chiave) {
    $aes = [Security.Cryptography.Aes]::Create()
    try {
        $aes.Key = Get-Fetta $chiave 0 32
        $aes.GenerateIV()
        $cifrato = $aes.CreateEncryptor().TransformFinalBlock($dati, 0, $dati.Length)
        $ms = New-Object IO.MemoryStream
        $ms.Write($aes.IV, 0, 16)
        $ms.Write($cifrato, 0, $cifrato.Length)
        $hmac = [Security.Cryptography.HMACSHA256]::new((Get-Fetta $chiave 32 32))
        $tag = $hmac.ComputeHash($ms.ToArray())
        $hmac.Dispose()
        $ms.Write($tag, 0, 32)
        return ,$ms.ToArray()
    } finally { $aes.Dispose() }
}

function Unprotect-Strato([byte[]]$pacchetto, [byte[]]$chiave) {
    $n = $pacchetto.Length
    if ($n -lt 64) { throw 'strato corrotto' }
    $corpo = Get-Fetta $pacchetto 0 ($n - 32)
    $tag   = Get-Fetta $pacchetto ($n - 32) 32
    $hmac = [Security.Cryptography.HMACSHA256]::new((Get-Fetta $chiave 32 32))
    $atteso = $hmac.ComputeHash($corpo)
    $hmac.Dispose()
    $diff = 0
    for ($i = 0; $i -lt 32; $i++) { $diff = $diff -bor ($atteso[$i] -bxor $tag[$i]) }
    if ($diff -ne 0) { throw 'strato manomesso o chiave sbagliata' }
    $aes = [Security.Cryptography.Aes]::Create()
    try {
        $aes.Key = Get-Fetta $chiave 0 32
        $aes.IV  = Get-Fetta $corpo 0 16
        return ,($aes.CreateDecryptor().TransformFinalBlock($corpo, 16, $corpo.Length - 16))
    } finally { $aes.Dispose() }
}

function Get-PercorsoStrato($P, $v, $s) {
    return Join-Path (Join-Path $P.Strati $v.id) "$($s.nome).bin"
}

function Read-Strato($P, $chiavi, $v, $s) {
    $id = "$($v.id)/$($s.nome)"
    $blob = Get-PercorsoStrato $P $v $s
    if (-not $chiavi.ContainsKey($id)) { throw 'chiave distrutta' }
    if (-not (Test-Path -LiteralPath $blob)) { throw 'strato mancante' }
    return ,(Unprotect-Strato ([IO.File]::ReadAllBytes($blob)) ($chiavi[$id]))
}

# Dimenticare = distruggere la chiave. Senza chiave lo strato è rumore,
# anche se ne esistesse una copia in un backup. Il file cifrato viene
# comunque rimosso per liberare spazio.
function Remove-Strato($P, $chiavi, $v, $s) {
    $id = "$($v.id)/$($s.nome)"
    if ($chiavi.ContainsKey($id)) {
        [Array]::Clear($chiavi[$id], 0, $chiavi[$id].Length)
        $chiavi.Remove($id)
    }
    $blob = Get-PercorsoStrato $P $v $s
    if (Test-Path -LiteralPath $blob) { Remove-Item -LiteralPath $blob -Force }
    $s.vivo = $false
}

# ---------------------------------------------------------------------------
# Vitalità e oblio
# ---------------------------------------------------------------------------
function Get-Oggi($stato) { return [datetime]::UtcNow.AddDays([double]$stato.offsetGiorni) }

function Get-Fattore($stato) {
    $f = $VELOCITA[[string]$stato.velocita]
    if (-not $f) { $f = 1.0 }
    return [double]$f
}

function Get-GiorniDaAccesso($v, [datetime]$oggi) {
    $t = ($oggi - (ConvertTo-Data $v.ultimoAccesso)).TotalDays
    if ($t -lt 0) { $t = 0 }
    return $t
}

function Get-Vitalita($v, [datetime]$oggi, [double]$fattore) {
    return [Math]::Exp(-(Get-GiorniDaAccesso $v $oggi) / ([double]$v.stabilita * $fattore))
}

function Get-StratiVivi($v) {
    return @($v.strati | Where-Object { $_.vivo } | Sort-Object { [double]$_.soglia } -Descending)
}

function Get-StatoVoce($v) {
    $top = Get-StratiVivi $v | Select-Object -First 1
    if (-not $top) { return 'traccia' }
    if ($top.nome -eq 'originale') { return 'nitido' }
    if ([double]$top.soglia -ge 0.2) { return 'sbiadito' }
    return 'essenza'
}

function Get-GiorniAlProssimo($v, [datetime]$oggi, [double]$fattore) {
    $top = Get-StratiVivi $v | Select-Object -First 1
    if ($v.fissato -or -not $top) { return $null }
    $limite = -[double]$v.stabilita * $fattore * [Math]::Log([double]$top.soglia)
    return [int][Math]::Max(0, [Math]::Ceiling($limite - (Get-GiorniDaAccesso $v $oggi)))
}

function Invoke-Oblio($P, $stato, $chiavi) {
    $oggi = Get-Oggi $stato
    $fattore = Get-Fattore $stato
    $eventi = New-Object System.Collections.Generic.List[object]
    foreach ($v in $stato.voci) {
        if ($v.fissato) { continue }
        $R = Get-Vitalita $v $oggi $fattore
        $persi = @()
        foreach ($s in (Get-StratiVivi $v)) {
            if ($R -lt [double]$s.soglia) {
                Remove-Strato $P $chiavi $v $s
                $s.dimenticatoIl = $oggi.ToString('o')
                $peso = Format-Byte $s.byte
                if ($s.dettaglio -eq $peso) { $persi += "$($s.nome) ($peso)" }
                else { $persi += "$($s.nome) ($($s.dettaglio), $peso)" }
            }
        }
        if ($persi.Count) {
            $eventi.Add([pscustomobject]@{ nome = $v.nome; persi = $persi; ora = (Get-StatoVoce $v) })
        }
    }
    return $eventi
}

function Show-Eventi($eventi, [bool]$perTempo) {
    Write-Host ''
    if ($perTempo) { $titolo = '  In questo tempo Oblio ha dimenticato:' }
    else { $titolo = '  Da quando non ci vedevamo, Oblio ha dimenticato:' }
    Write-Host $titolo -ForegroundColor Cyan
    foreach ($e in $eventi) {
        Write-Host ('    {0,-24} → {1,-9} persi: {2}' -f (Format-Nome $e.nome), $e.ora, ($e.persi -join '; ')) -ForegroundColor Cyan
    }
}

# ---------------------------------------------------------------------------
# Immagini
# ---------------------------------------------------------------------------
function Open-Immagine([byte[]]$dati) {
    $ms = New-Object IO.MemoryStream (,$dati)
    return [Drawing.Image]::FromStream($ms, $true, $true)
}

function Get-Lato($img, [int]$max) {
    $scala = [Math]::Min(1.0, $max / [double][Math]::Max($img.Width, $img.Height))
    return @(
        [Math]::Max(1, [int][Math]::Round($img.Width * $scala)),
        [Math]::Max(1, [int][Math]::Round($img.Height * $scala))
    )
}

function New-Ridimensionata($img, [int]$w, [int]$h) {
    $bmp = New-Object Drawing.Bitmap $w, $h
    $g = [Drawing.Graphics]::FromImage($bmp)
    try {
        $g.Clear([Drawing.Color]::White)
        $g.InterpolationMode  = [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $g.PixelOffsetMode    = [Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        $g.CompositingQuality = [Drawing.Drawing2D.CompositingQuality]::HighQuality
        $attr = New-Object Drawing.Imaging.ImageAttributes
        $attr.SetWrapMode([Drawing.Drawing2D.WrapMode]::TileFlipXY)
        $dest = New-Object Drawing.Rectangle 0, 0, $w, $h
        $g.DrawImage($img, $dest, 0, 0, $img.Width, $img.Height, [Drawing.GraphicsUnit]::Pixel, $attr)
        $attr.Dispose()
    } finally { $g.Dispose() }
    return $bmp
}

function ConvertTo-Jpeg($bmp, [long]$qualita = 85) {
    $codec = [Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
    $par = New-Object Drawing.Imaging.EncoderParameters 1
    $par.Param[0] = New-Object Drawing.Imaging.EncoderParameter ([Drawing.Imaging.Encoder]::Quality), $qualita
    $ms = New-Object IO.MemoryStream
    $bmp.Save($ms, $codec, $par)
    $par.Dispose()
    return ,$ms.ToArray()
}

function Get-NomeColore([Drawing.Color]$c) {
    $l = $c.GetBrightness(); $s = $c.GetSaturation(); $h = $c.GetHue()
    if ($l -lt 0.16) { return 'nero' }
    if ($s -lt 0.18 -or $l -gt 0.93) { if ($l -gt 0.8) { return 'bianco' } else { return 'grigio' } }
    if ($h -ge 25 -and $h -lt 65 -and $l -gt 0.68 -and $s -lt 0.65) { return 'beige' }
    if ($h -lt 15 -or $h -ge 345) { if ($l -lt 0.3) { return 'bordeaux' } else { return 'rosso' } }
    if ($h -lt 42) { if ($l -lt 0.4) { return 'marrone' } else { return 'arancione' } }
    if ($h -lt 68) { if ($l -lt 0.35) { return 'marrone' } else { return 'giallo' } }
    if ($h -lt 170) { return 'verde' }
    if ($h -lt 215 -or ($h -lt 250 -and $l -gt 0.65)) { return 'azzurro' }
    if ($h -lt 255) { return 'blu' }
    if ($h -lt 290) { return 'viola' }
    return 'rosa'
}

function Get-DataScatto($img, [datetime]$ripiego) {
    try {
        if ($img.PropertyIdList -contains 36867) {
            $s = [Text.Encoding]::ASCII.GetString($img.GetPropertyItem(36867).Value).Trim([char]0)
            return [datetime]::ParseExact($s, 'yyyy:MM:dd HH:mm:ss', $INV)
        }
    } catch { }
    return $ripiego
}

# Nel prototipo la "descrizione" nasce dai colori. Una versione vera userebbe
# un modello di visione: "spiaggia con ombrellone rosso" invece di "azzurro, beige".
function Get-DescrizioneImmagine($img, [datetime]$data) {
    $d = Get-Lato $img 24
    $mini = New-Ridimensionata $img $d[0] $d[1]
    $conteggi = @{}; $luce = 0.0; $n = 0
    for ($y = 0; $y -lt $mini.Height; $y++) {
        for ($x = 0; $x -lt $mini.Width; $x++) {
            $c = $mini.GetPixel($x, $y)
            $nome = Get-NomeColore $c
            $conteggi[$nome] = 1 + [int]$conteggi[$nome]
            $luce += $c.GetBrightness(); $n++
        }
    }
    $mini.Dispose()
    $colori = @($conteggi.GetEnumerator() | Sort-Object Value -Descending |
        Where-Object { $_.Value / $n -ge 0.08 } | Select-Object -First 3 | ForEach-Object { $_.Key })
    $l = $luce / $n
    if ($l -gt 0.62) { $tono = 'luminosa' } elseif ($l -lt 0.35) { $tono = 'scura' } else { $tono = 'dai toni medi' }
    if ($img.Width -gt $img.Height * 1.1) { $forma = 'orizzontale' }
    elseif ($img.Height -gt $img.Width * 1.1) { $forma = 'verticale' }
    else { $forma = 'quadrata' }
    return "Immagine $forma $($img.Width)×$($img.Height), $tono; colori: $($colori -join ', ') · $(Format-Data $data)"
}

function Add-Filigrana($bmp, [string]$testo) {
    $g = [Drawing.Graphics]::FromImage($bmp)
    try {
        $g.TextRenderingHint = [Drawing.Text.TextRenderingHint]::AntiAlias
        $h = [Math]::Max(24, [int]($bmp.Height * 0.07))
        $fondo = New-Object Drawing.SolidBrush ([Drawing.Color]::FromArgb(175, 0, 0, 0))
        $g.FillRectangle($fondo, 0, $bmp.Height - $h, $bmp.Width, $h)
        $px = [Math]::Min($h * 0.45, $bmp.Width / ($testo.Length * 0.62))
        $font = New-Object Drawing.Font ('Segoe UI', [single]$px, [Drawing.FontStyle]::Bold, [Drawing.GraphicsUnit]::Pixel)
        $fmt = New-Object Drawing.StringFormat
        $fmt.Alignment = [Drawing.StringAlignment]::Center
        $fmt.LineAlignment = [Drawing.StringAlignment]::Center
        $area = New-Object Drawing.RectangleF ([single]0, [single]($bmp.Height - $h), [single]$bmp.Width, [single]$h)
        $g.DrawString($testo, $font, [Drawing.Brushes]::White, $area, $fmt)
        $font.Dispose(); $fondo.Dispose(); $fmt.Dispose()
    } finally { $g.Dispose() }
}

# ---------------------------------------------------------------------------
# Testi: riassunto estrattivo locale (nessun servizio esterno)
# ---------------------------------------------------------------------------
function Read-Testo([byte[]]$dati) {
    try { return (New-Object Text.UTF8Encoding $false, $true).GetString($dati).TrimStart([char]0xFEFF) }
    catch { return [Text.Encoding]::Default.GetString($dati) }
}

function Get-AnalisiTesto([string]$testo) {
    $pulito = ($testo -replace '\r', '').Trim()
    $frasi = @([regex]::Split($pulito, '(?<=[\.\!\?…])\s+|\n+') | ForEach-Object { $_.Trim() } | Where-Object { $_ })
    $tutte = [regex]::Matches($pulito.ToLower(), '[\p{L}\p{N}]+')
    $freq = @{}
    foreach ($m in $tutte) {
        $w = $m.Value
        if ($w.Length -gt 2 -and -not $STOP.Contains($w) -and $w -notmatch '^\d+$') { $freq[$w] = 1 + [int]$freq[$w] }
    }
    $maxF = 1
    if ($freq.Count) { $maxF = ($freq.Values | Measure-Object -Maximum).Maximum }

    $punteggi = @(for ($i = 0; $i -lt $frasi.Count; $i++) {
        $parole = @([regex]::Matches($frasi[$i].ToLower(), '[\p{L}\p{N}]+') | ForEach-Object { $_.Value } | Where-Object { $freq.ContainsKey($_) })
        $punti = 0.0
        foreach ($w in ($parole | Select-Object -Unique)) { $punti += $freq[$w] / $maxF }
        if ($parole.Count) { $punti = $punti / [Math]::Sqrt($parole.Count) }
        if ($i -eq 0) { $punti *= 1.15 }
        [pscustomobject]@{ i = $i; punti = $punti }
    })

    $chiave = @($freq.GetEnumerator() |
        Sort-Object @{ Expression = { $_.Value }; Descending = $true }, @{ Expression = { $_.Key }; Descending = $false } |
        Select-Object -First 6 | ForEach-Object { $_.Key })
    $quante = [int][Math]::Min(12, [Math]::Max(1, [Math]::Ceiling($frasi.Count * 0.3)))
    $scelte = @($punteggi | Sort-Object punti -Descending | Select-Object -First $quante | Sort-Object i)
    $migliore = $punteggi | Sort-Object punti -Descending | Select-Object -First 1

    $essenza = ''
    if ($migliore) { $essenza = $frasi[$migliore.i] }
    return [pscustomobject]@{
        Parole         = $tutte.Count
        Frasi          = $frasi.Count
        Chiave         = $chiave
        Riassunto      = (@($scelte | ForEach-Object { $frasi[$_.i] }) -join ' ')
        FrasiRiassunto = $scelte.Count
        Essenza        = $essenza
    }
}

# ---------------------------------------------------------------------------
# Aggiungere file: ogni file diventa una pila di strati cifrati
# ---------------------------------------------------------------------------
function Get-Tipo([string]$est) {
    $e = $est.ToLower()
    if ($EST_IMMAGINI -contains $e) { return 'immagine' }
    if ($EST_TESTI -contains $e) { return 'testo' }
    return 'binario'
}

function Get-NomeLibero($stato, [string]$nome) {
    $esistenti = @{}
    foreach ($v in $stato.voci) { $esistenti[$v.nome.ToLower()] = $true }
    if (-not $esistenti.ContainsKey($nome.ToLower())) { return $nome }
    $base = [IO.Path]::GetFileNameWithoutExtension($nome); $est = [IO.Path]::GetExtension($nome)
    for ($i = 2; ; $i++) {
        $candidato = "$base ($i)$est"
        if (-not $esistenti.ContainsKey($candidato.ToLower())) { return $candidato }
    }
}

function Add-File($P, $stato, $chiavi, [IO.FileInfo]$file) {
    $bytes = [IO.File]::ReadAllBytes($file.FullName)
    $tipo = Get-Tipo $file.Extension
    $strati = New-Object System.Collections.Generic.List[object]
    $descrizione = ''; $larghezza = 0; $altezza = 0; $testoLegale = ''

    if ($tipo -eq 'immagine') {
        try {
            $img = Open-Immagine $bytes
            try {
                $descrizione = Get-DescrizioneImmagine $img (Get-DataScatto $img $file.LastWriteTime)
                foreach ($livello in @(@('miniatura', 0.05, 64, 80), @('media', 0.2, 480, 85))) {
                    $d = Get-Lato $img $livello[2]
                    $bmp = New-Ridimensionata $img $d[0] $d[1]
                    $strati.Add(@{ nome = $livello[0]; soglia = $livello[1]; dettaglio = "$($d[0])×$($d[1]) px"; dati = (ConvertTo-Jpeg $bmp $livello[3]) })
                    $bmp.Dispose()
                }
                $strati.Add(@{ nome = 'originale'; soglia = 0.5; dettaglio = "$($img.Width)×$($img.Height) px"; dati = $bytes })
                $larghezza = $img.Width; $altezza = $img.Height
            } finally { $img.Dispose() }
        } catch {
            $tipo = 'binario'
            $strati.Clear()
        }
    }

    if ($tipo -eq 'testo') {
        $testo = Read-Testo $bytes
        $a = Get-AnalisiTesto $testo
        $testoLegale = $testo
        $temi = @($a.Chiave | Select-Object -First 3) -join ', '
        if ($a.Parole) { $descrizione = "Testo di $($a.Parole) parole, $($a.Frasi) frasi; parla di: $temi · $(Format-Data $file.LastWriteTime)" }
        else { $descrizione = "Testo vuoto · $(Format-Data $file.LastWriteTime)" }
        $essenza = "$($a.Essenza)`r`n`r`nParole chiave: $($a.Chiave -join ', ')"
        $strati.Add(@{ nome = 'essenza'; soglia = 0.05; dettaglio = '1 frase + parole chiave'; dati = [Text.Encoding]::UTF8.GetBytes($essenza) })
        $strati.Add(@{ nome = 'riassunto'; soglia = 0.2; dettaglio = "$($a.FrasiRiassunto) frasi su $($a.Frasi)"; dati = [Text.Encoding]::UTF8.GetBytes($a.Riassunto) })
        $strati.Add(@{ nome = 'originale'; soglia = 0.5; dettaglio = "$($a.Parole) parole"; dati = $bytes })
    }

    if ($tipo -eq 'binario') {
        $genere = $TIPI_NOTI[$file.Extension.ToLower()]
        if (-not $genere) { $genere = "File $($file.Extension)" }
        $sha = [Security.Cryptography.SHA256]::Create()
        $impronta = -join (($sha.ComputeHash($bytes))[0..5] | ForEach-Object { $_.ToString('x2') })
        $sha.Dispose()
        $descrizione = "$genere di $(Format-Byte $bytes.Length) · impronta $impronta… · $(Format-Data $file.LastWriteTime)"
        # un file binario non sa sbiadire a metà: resiste di più, poi resta solo la traccia
        $strati.Add(@{ nome = 'originale'; soglia = 0.2; dettaglio = (Format-Byte $bytes.Length); dati = $bytes })
    }

    $motivo = ''
    if ($file.BaseName -match $NOMI_LEGALI) { $motivo = 'valore legale (nome)' }
    elseif ($testoLegale -match $TESTO_LEGALE) { $motivo = 'valore legale (contenuto)' }

    $id = ([guid]::NewGuid().ToString('N')).Substring(0, 10)
    $cartella = Join-Path $P.Strati $id
    New-Item -ItemType Directory -Force -Path $cartella | Out-Null
    $ora = (Get-Oggi $stato).ToString('o')
    $voceStrati = @()
    foreach ($s in $strati) {
        $k = New-Chiave
        [IO.File]::WriteAllBytes((Join-Path $cartella "$($s.nome).bin"), (Protect-Strato $s.dati $k))
        $chiavi["$id/$($s.nome)"] = $k
        $voceStrati += [pscustomobject]@{
            nome = $s.nome; soglia = $s.soglia; dettaglio = $s.dettaglio
            byte = $s.dati.Length; vivo = $true; dimenticatoIl = $null
        }
    }

    $voce = [pscustomobject]@{
        id            = $id
        nome          = (Get-NomeLibero $stato $file.Name)
        tipo          = $tipo
        descrizione   = $descrizione
        byteOriginali = $bytes.Length
        larghezza     = $larghezza
        altezza       = $altezza
        aggiunto      = $ora
        ultimoAccesso = $ora
        stabilita     = $STABILITA_BASE
        accessi       = 0
        fissato       = [bool]$motivo
        motivoFissato = $motivo
        strati        = $voceStrati
    }
    $stato.voci = @($stato.voci) + $voce
    return $voce
}

function Add-Percorso($P, $stato, $chiavi, [string]$percorso) {
    if (-not $percorso) { throw 'Indica un file o una cartella:  oblio aggiungi <percorso>' }
    if (-not (Test-Path -LiteralPath $percorso)) { throw "Non trovo '$percorso'." }
    $item = Get-Item -LiteralPath $percorso
    $dentroArchivio = $P.Radice.TrimEnd('\') + '\'
    if ($item.PSIsContainer) {
        $files = @(Get-ChildItem -LiteralPath $item.FullName -File -Recurse |
            Where-Object { -not $_.FullName.StartsWith($dentroArchivio, [StringComparison]::OrdinalIgnoreCase) })
    } else { $files = @($item) }
    if (-not $files.Count) { Write-Host '  Nessun file da aggiungere.'; return }

    Write-Host ''
    $ok = 0
    foreach ($file in $files) {
        try {
            $v = Add-File $P $stato $chiavi $file
            # salva prima di toccare l'originale: se qualcosa va storto, niente è perso
            Save-Chiavi $P $chiavi
            Save-Stato $P $stato
            if ($Sposta) { Remove-Item -LiteralPath $file.FullName -Force }
            $ok++
            $extra = ''; $colore = 'White'
            if ($v.fissato) { $extra = " · fissato: $($v.motivoFissato)"; $colore = 'Yellow' }
            Write-Host ('  + {0,-24} {1,-9} {2} strati · {3}{4}' -f (Format-Nome $v.nome), $v.tipo, @($v.strati).Count, (Format-Byte $v.byteOriginali), $extra) -ForegroundColor $colore
        } catch {
            Write-Host "  ! $($file.Name): $($_.Exception.Message)" -ForegroundColor Red
        }
    }
    Write-Host ''
    Write-Host "  $ok file affidati all'oblio." -ForegroundColor White
    if (-not $Sposta) {
        Write-Host "  Gli originali sono rimasti dove erano (usa -Sposta per spostarli davvero nell'archivio)." -ForegroundColor DarkGray
    }
}

# ---------------------------------------------------------------------------
# Comandi
# ---------------------------------------------------------------------------
function Find-Voce($stato, [string]$chi) {
    if (-not $chi) { throw 'Indica il nome di un file.' }
    $voci = @($stato.voci)
    $trovate = @($voci | Where-Object { $_.nome -eq $chi -or $_.id -eq $chi })
    if ($trovate.Count -eq 1) { return $trovate[0] }
    $trovate = @($voci | Where-Object { Test-Contiene $_.nome $chi })
    if ($trovate.Count -eq 1) { return $trovate[0] }
    if ($trovate.Count -gt 1) { throw "Più file corrispondono a '$chi': $((@($trovate | ForEach-Object { $_.nome })) -join ', ')" }
    throw "Nessun file chiamato '$chi' nell'archivio."
}

function Show-Stato($P, $stato) {
    $oggi = Get-Oggi $stato
    $fattore = Get-Fattore $stato
    $voci = @($stato.voci)
    Write-Host ''
    Write-Host "  OBLIO · $($P.Radice)" -ForegroundColor White
    $sim = ''
    if ([double]$stato.offsetGiorni -ne 0) { $sim = " (tempo simulato: +$($stato.offsetGiorni) giorni)" }
    Write-Host "  oggi $(Format-Data $oggi)$sim · velocità dell'oblio: $($stato.velocita)" -ForegroundColor DarkGray
    Write-Host ''
    if (-not $voci.Count) {
        Write-Host "  L'archivio è vuoto. Aggiungi qualcosa con:  oblio aggiungi <file|cartella>"
        return
    }

    $ordine  = @('nitido', 'sbiadito', 'essenza', 'traccia')
    $plurali = @{ nitido = 'nitidi'; sbiadito = 'sbiaditi'; essenza = 'essenze'; traccia = 'tracce' }
    $colori  = @{ nitido = 'White'; sbiadito = 'Gray'; essenza = 'DarkGray'; traccia = 'DarkGray' }
    $gruppi  = @{}
    foreach ($st in $ordine) { $gruppi[$st] = 0 }
    $righe = @(foreach ($v in $voci) {
        $st = Get-StatoVoce $v
        $gruppi[$st]++
        [pscustomobject]@{ voce = $v; stato = $st; rango = [array]::IndexOf($ordine, $st); vitalita = (Get-Vitalita $v $oggi $fattore) }
    })

    $massimo = ($gruppi.Values | Measure-Object -Maximum).Maximum
    foreach ($st in $ordine) {
        $n = $gruppi[$st]
        $lun = 0
        if ($massimo) { $lun = [int][Math]::Ceiling(20 * $n / $massimo) }
        Write-Host ('  {0,-9} {1,3}  {2}' -f $plurali[$st], $n, ('█' * $lun)) -ForegroundColor $colori[$st]
    }
    $fissati = @($voci | Where-Object { $_.fissato }).Count
    if ($fissati) { Write-Host ('  {0,-9} {1,3}  (indimenticabili)' -f 'fissati', $fissati) -ForegroundColor Yellow }

    $prima = 0.0; $adesso = 0.0
    foreach ($v in $voci) {
        $prima += [double]$v.byteOriginali
        foreach ($s in $v.strati) { if ($s.vivo) { $adesso += [double]$s.byte } }
        $adesso += $v.descrizione.Length
    }
    $delta = 0
    if ($prima) { $delta = ($adesso - $prima) / $prima * 100 }
    $segno = ''
    if ($delta -gt 0) { $segno = '+' }
    Write-Host ''
    Write-Host ([string]::Format($IT, "  spazio: {0} all'origine → {1} oggi ({2}{3:N0}%)", (Format-Byte $prima), (Format-Byte $adesso), $segno, $delta)) -ForegroundColor DarkGray
    if ([int]$stato.dimenticatiPerSempre) {
        Write-Host "  dimenticati per sempre su richiesta: $($stato.dimenticatiPerSempre)" -ForegroundColor DarkGray
    }

    Write-Host ''
    $formato = '  {0,-24} {1,-9} {2,-15} {3,-27} {4}'
    Write-Host ($formato -f 'FILE', 'STATO', 'VITALITÀ', 'COSA RESTA', 'PROSSIMO OBLIO') -ForegroundColor DarkGray
    foreach ($riga in ($righe | Sort-Object rango, @{ Expression = { $_.voce.nome } })) {
        $v = $riga.voce
        $top = Get-StratiVivi $v | Select-Object -First 1
        if ($top) { $resta = "$($top.nome) · $($top.dettaglio)" } else { $resta = 'solo la descrizione' }
        if ($v.fissato) {
            $vit = 'fissato'
            $prossimo = 'mai'
            $colore = 'Yellow'
        } elseif (-not $top) {
            $vit = '░░░░░░░░░░ —'
            $prossimo = '—'
            $colore = $colori[$riga.stato]
        } else {
            $barra = ('█' * [int][Math]::Round($riga.vitalita * 10)).PadRight(10, '░')
            $vit = "$barra $($riga.vitalita.ToString('0.00', $IT))"
            $g = Get-GiorniAlProssimo $v $oggi $fattore
            if ($null -eq $g) { $prossimo = '—' } elseif ($g -le 0) { $prossimo = 'a breve' } else { $prossimo = "tra $g giorni" }
            $colore = $colori[$riga.stato]
        }
        Write-Host ($formato -f (Format-Nome $v.nome), $riga.stato, $vit, (Format-Nome $resta 27), $prossimo) -ForegroundColor $colore
    }
}

function Open-Voce($P, $stato, $chiavi, $v) {
    New-Item -ItemType Directory -Force -Path $P.Ricordi | Out-Null
    $oggi = Get-Oggi $stato
    $dati = $null; $strato = $null
    foreach ($s in (Get-StratiVivi $v)) {
        try {
            $dati = Read-Strato $P $chiavi $v $s
            $strato = $s
            break
        } catch {
            $s.vivo = $false   # chiave o dati persi: lo strato è irrecuperabile
        }
    }

    $base = [IO.Path]::GetFileNameWithoutExtension($v.nome)
    if (-not $strato) {
        $out = Join-Path $P.Ricordi "$base.traccia.txt"
        $righe = @(
            'TRACCIA DI UN FILE DIMENTICATO', '',
            "Nome:        $($v.nome)",
            "Descrizione: $($v.descrizione)",
            "Affidato a Oblio il $(Format-Data (ConvertTo-Data $v.aggiunto))", '',
            'Di questo file resta solo la traccia: il contenuto non esiste più da nessuna parte.'
        )
        [IO.File]::WriteAllText($out, ($righe -join "`r`n"), [Text.Encoding]::UTF8)
        $fonte = 'solo la traccia: il contenuto è dimenticato'
    } elseif ($strato.nome -eq 'originale') {
        $out = Join-Path $P.Ricordi $v.nome
        [IO.File]::WriteAllBytes($out, $dati)
        $fonte = 'originale, intatto'
    } elseif ($v.tipo -eq 'immagine') {
        # Qui un modello generativo potrebbe "reimmaginare" i dettagli.
        # Il prototipo si limita a ingrandire ciò che resta: un ricordo sfocato.
        $img = Open-Immagine $dati
        $bmp = New-Ridimensionata $img ([int]$v.larghezza) ([int]$v.altezza)
        $img.Dispose()
        Add-Filigrana $bmp "RICORDO RICOSTRUITO · NON ORIGINALE · da $($strato.dettaglio)"
        $out = Join-Path $P.Ricordi "$base.ricordo.jpg"
        [IO.File]::WriteAllBytes($out, (ConvertTo-Jpeg $bmp 88))
        $bmp.Dispose()
        $fonte = "ricostruito dallo strato «$($strato.nome)» ($($strato.dettaglio))"
    } else {
        $intestazione = @(
            "=== RICORDO RICOSTRUITO — NON È L'ORIGINALE ===",
            "Fonte: strato «$($strato.nome)» ($($strato.dettaglio)). Il resto è stato dimenticato e non si può recuperare.",
            '', ''
        ) -join "`r`n"
        $out = Join-Path $P.Ricordi "$base.ricordo.txt"
        [IO.File]::WriteAllText($out, $intestazione + (Read-Testo $dati), [Text.Encoding]::UTF8)
        $fonte = "ricostruito dallo strato «$($strato.nome)» ($($strato.dettaglio))"
    }

    # Riconsolidamento: ripensare a un ricordo lo rafforza (una traccia non ha più nulla da rafforzare).
    $primaS = [double]$v.stabilita
    if ($strato) { $v.stabilita = [Math]::Min($STABILITA_MAX, $primaS * $RIPASSO) }
    $v.ultimoAccesso = $oggi.ToString('o')
    $v.accessi = [int]$v.accessi + 1

    Write-Host ''
    Write-Host "  Aperto:  $($v.nome)" -ForegroundColor White
    Write-Host "  Fonte:   $fonte"
    Write-Host "  File:    $out"
    if ($v.fissato) {
        Write-Host '  È fissato: non sbiadirà mai.' -ForegroundColor Yellow
    } elseif ($strato) {
        Write-Host ([string]::Format($IT, '  Riconsolidato: stabilità {0:N0} → {1:N0} giorni. Da qui in poi sbiadisce più lentamente.', $primaS, $v.stabilita)) -ForegroundColor Green
    }
    if ($Mostra) { Invoke-Item -LiteralPath $out }
}

function Find-Ricordi($P, $stato, $chiavi, [string]$cosa) {
    if (-not $cosa) { throw 'Cosa devo cercare?  oblio cerca <parola>' }
    Write-Host ''
    $trovati = 0
    foreach ($v in $stato.voci) {
        $dove = @()
        if (Test-Contiene $v.nome $cosa) { $dove += 'nel nome' }
        if (Test-Contiene $v.descrizione $cosa) { $dove += 'nella traccia' }
        if ($v.tipo -eq 'testo') {
            $top = Get-StratiVivi $v | Select-Object -First 1
            if ($top) {
                try {
                    if (Test-Contiene (Read-Testo (Read-Strato $P $chiavi $v $top)) $cosa) { $dove += "nel testo ($($top.nome))" }
                } catch { }
            }
        }
        if ($dove.Count) {
            $trovati++
            Write-Host ('  {0,-24} {1,-9} trovato {2}' -f (Format-Nome $v.nome), (Get-StatoVoce $v), ($dove -join ', ')) -ForegroundColor White
            Write-Host "      $($v.descrizione)" -ForegroundColor DarkGray
        }
    }
    if (-not $trovati) { Write-Host "  Nessun ricordo contiene '$cosa'." -ForegroundColor DarkGray }
}

function Show-Velocita($stato) {
    Write-Host ''
    foreach ($k in $VELOCITA.Keys) {
        $S = $STABILITA_BASE * $VELOCITA[$k]
        $nitido = [int]($S * [Math]::Log(2)); $sbiadito = [int]($S * -[Math]::Log(0.2)); $essenza = [int]($S * -[Math]::Log(0.05))
        $segno = ' '; $colore = 'Gray'
        if ($k -eq $stato.velocita) { $segno = '▶'; $colore = 'White' }
        Write-Host ('  {0} {1,-12} nitido ~{2} gg · sbiadito fino a ~{3} gg · essenza fino a ~{4} gg, poi traccia' -f $segno, $k, $nitido, $sbiadito, $essenza) -ForegroundColor $colore
    }
    Write-Host "  (per un file mai riaperto; ogni apertura rallenta l'oblio)" -ForegroundColor DarkGray
}

function Show-Aiuto {
    Write-Host @'

  OBLIO — il file system che dimentica come un essere umano

  oblio crea                          crea un archivio (default: .\archivio-oblio)
  oblio aggiungi <file|cartella>      affida file all'oblio (copia; con -Sposta rimuove l'originale)
  oblio stato                         cosa è nitido, cosa sbiadisce, cosa resta solo come traccia
  oblio apri <nome> [-Mostra]         ricostruisce il file in \ricordi e lo riconsolida
  oblio cerca <parola>                cerca anche tra i file dimenticati, nelle loro tracce
  oblio fissa <nome>                  rende un file indimenticabile
  oblio libera <nome>                 lo restituisce al corso dell'oblio
  oblio dimentica <nome> -Conferma    oblio immediato e totale, traccia compresa
  oblio velocita [elefante|normale|pesce-rosso]
  oblio tempo [<giorni>|reset]        simula il passare del tempo

  Opzione per tutti i comandi:  -Archivio <cartella>   (oppure la variabile OBLIO_ARCHIVIO)

'@
}

function Invoke-Main {
    $radice = $Archivio
    if (-not $radice) { $radice = $env:OBLIO_ARCHIVIO }
    if (-not $radice) { $radice = 'archivio-oblio' }
    if (-not [IO.Path]::IsPathRooted($radice)) { $radice = Join-Path (Get-Location).ProviderPath $radice }
    $P = Get-Percorsi ([IO.Path]::GetFullPath($radice))
    $cmd = $Comando.ToLower()

    if ($cmd -in 'aiuto', 'help', '-h', '/?') { Show-Aiuto; return }
    if ($cmd -eq 'crea') { New-Archivio $P; return }
    $noti = 'aggiungi', 'stato', 'apri', 'cerca', 'fissa', 'libera', 'dimentica', 'velocita', 'velocità', 'tempo'
    if ($cmd -notin $noti) { throw "Comando sconosciuto: '$Comando'. Scrivi:  oblio aiuto" }

    $stato  = Read-Stato $P
    $chiavi = Read-Chiavi $P

    $avanzato = $false
    if ($cmd -eq 'tempo' -and $Argomento) {
        if ($Argomento -eq 'reset') {
            $stato.offsetGiorni = 0
            Write-Host ''
            Write-Host "  Orologio riportato a oggi: $(Format-Data (Get-Oggi $stato))." -ForegroundColor Magenta
        } else {
            $giorni = 0
            if (-not [int]::TryParse($Argomento, [ref]$giorni)) { throw "Numero di giorni non valido: '$Argomento'" }
            $stato.offsetGiorni = [int]$stato.offsetGiorni + $giorni
            $avanzato = $true
            Write-Host ''
            Write-Host "  Il tempo avanza di $giorni giorni (simulazione). Oggi è il $(Format-Data (Get-Oggi $stato))." -ForegroundColor Magenta
        }
    }

    # Prima di ogni comando, il tempo trascorso fa il suo lavoro.
    $eventi = @(Invoke-Oblio $P $stato $chiavi)
    if ($eventi.Count) { Show-Eventi $eventi ($cmd -eq 'tempo') }
    elseif ($avanzato) { Write-Host '  Nessun ricordo è sbiadito.' -ForegroundColor DarkGray }

    switch ($cmd) {
        'aggiungi' { Add-Percorso $P $stato $chiavi $Argomento }
        'stato'    { Show-Stato $P $stato }
        'apri'     { Open-Voce $P $stato $chiavi (Find-Voce $stato $Argomento) }
        'cerca'    { Find-Ricordi $P $stato $chiavi $Argomento }
        'fissa' {
            $v = Find-Voce $stato $Argomento
            $v.fissato = $true; $v.motivoFissato = 'scelto da te'
            Write-Host ''
            Write-Host "  $($v.nome) ora è indimenticabile." -ForegroundColor Yellow
            $st = Get-StatoVoce $v
            if ($st -ne 'nitido') { Write-Host "  Ciò che era già sbiadito non torna: resterà per sempre così ($st)." -ForegroundColor DarkGray }
        }
        'libera' {
            $v = Find-Voce $stato $Argomento
            $v.fissato = $false; $v.motivoFissato = ''
            $v.ultimoAccesso = (Get-Oggi $stato).ToString('o')
            Write-Host ''
            Write-Host "  $($v.nome) torna a seguire il corso dell'oblio, a partire da oggi."
        }
        'dimentica' {
            $v = Find-Voce $stato $Argomento
            Write-Host ''
            if (-not $Conferma) {
                Write-Host "  Stai per dimenticare PER SEMPRE '$($v.nome)': chiavi distrutte, traccia cancellata, nessun ritorno." -ForegroundColor Yellow
                Write-Host "  Per procedere:  oblio dimentica `"$($v.nome)`" -Conferma"
            } else {
                foreach ($s in $v.strati) { if ($s.vivo) { Remove-Strato $P $chiavi $v $s } }
                $cartella = Join-Path $P.Strati $v.id
                if (Test-Path -LiteralPath $cartella) { Remove-Item -LiteralPath $cartella -Recurse -Force }
                $stato.voci = @($stato.voci | Where-Object { $_.id -ne $v.id })
                $stato.dimenticatiPerSempre = [int]$stato.dimenticatiPerSempre + 1
                Write-Host "  '$($v.nome)' è stato dimenticato per sempre." -ForegroundColor Cyan
                Write-Host '  Eventuali copie già estratte in \ricordi restano: quelle sono tue.' -ForegroundColor DarkGray
            }
        }
        { $_ -in 'velocita', 'velocità' } {
            if ($Argomento) {
                if (-not $VELOCITA.Contains($Argomento.ToLower())) { throw "Velocità sconosciuta: '$Argomento'. Scegli tra: $($VELOCITA.Keys -join ', ')" }
                $stato.velocita = $Argomento.ToLower()
            }
            Show-Velocita $stato
        }
        'tempo' {
            if (-not $Argomento) {
                Write-Host ''
                Write-Host "  Oggi è il $(Format-Data (Get-Oggi $stato)) (spostamento simulato: $($stato.offsetGiorni) giorni)."
            }
        }
    }

    Save-Chiavi $P $chiavi
    Save-Stato $P $stato
}

try {
    Invoke-Main
} catch {
    Write-Host "  Errore: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
