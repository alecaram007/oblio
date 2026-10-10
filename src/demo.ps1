<#
    Demo di Oblio: crea alcuni file di prova, li affida all'oblio
    e simula più di un anno di vita dell'archivio.
    Tutto avviene nella cartella "demo" accanto a questo progetto.
#>
$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch { }
Add-Type -AssemblyName System.Drawing

$oblio     = Join-Path $PSScriptRoot 'oblio.ps1'
$demo      = Join-Path (Split-Path -Parent $PSScriptRoot) 'demo'
$marcatore = Join-Path $demo '.demo-oblio'
$materiale = Join-Path $demo 'file-di-prova'
$archivio  = Join-Path $demo 'archivio'

if (Test-Path -LiteralPath $demo) {
    if (-not (Test-Path -LiteralPath $marcatore)) { throw "La cartella '$demo' esiste ma non l'ha creata la demo: non la tocco." }
    Remove-Item -LiteralPath $demo -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $materiale | Out-Null
Set-Content -LiteralPath $marcatore -Value 'Cartella generata da demo.ps1: viene ricreata a ogni esecuzione.'

function Oblio([string]$comando, [string]$argomento, [switch]$Sposta) {
    & $oblio $comando $argomento -Archivio $archivio -Sposta:$Sposta
}
function Titolo([string]$testo) {
    Write-Host ''
    Write-Host ''
    Write-Host "━━━ $testo" -ForegroundColor Magenta
}

# ---------------------------------------------------------------------------
# File di prova
# ---------------------------------------------------------------------------
$rnd = New-Object Random 42
function Colore([int]$rosso, [int]$verde, [int]$blu, [int]$alfa = 255) { [Drawing.Color]::FromArgb($alfa, $rosso, $verde, $blu) }
function Pennello($colore) { New-Object Drawing.SolidBrush $colore }
function Sfumatura([int]$y, [int]$altezza, $da, $a) {
    $rett = New-Object Drawing.Rectangle 0, ($y - 1), 2400, ($altezza + 2)
    New-Object Drawing.Drawing2D.LinearGradientBrush ($rett, $da, $a, [single]90)
}
function New-Foto([string]$nome, [scriptblock]$disegno) {
    $bmp = New-Object Drawing.Bitmap 2400, 1600
    $g = [Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [Drawing.Drawing2D.SmoothingMode]::AntiAlias
    & $disegno $g
    $g.Dispose()
    $percorso = Join-Path $materiale $nome
    if ($nome.EndsWith('.png')) {
        $bmp.Save($percorso, [Drawing.Imaging.ImageFormat]::Png)
    } else {
        $codec = [Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
        $par = New-Object Drawing.Imaging.EncoderParameters 1
        $par.Param[0] = New-Object Drawing.Imaging.EncoderParameter ([Drawing.Imaging.Encoder]::Quality), ([long]92)
        $bmp.Save($percorso, $codec, $par)
    }
    $bmp.Dispose()
}

Write-Host ''
Write-Host '  Preparo i file di prova...' -ForegroundColor DarkGray

New-Foto 'mare.jpg' {
    param($g)
    $g.FillRectangle((Sfumatura 0 820 (Colore 110 170 230) (Colore 230 242 250)), 0, 0, 2400, 820)
    $g.FillEllipse((Pennello (Colore 255 225 110)), 1720, 170, 240, 240)
    $g.FillRectangle((Sfumatura 820 360 (Colore 40 120 190) (Colore 20 80 150)), 0, 820, 2400, 360)
    for ($i = 0; $i -lt 1400; $i++) {
        $g.FillEllipse((Pennello (Colore 255 255 255 ($rnd.Next(60, 180)))), $rnd.Next(0, 2400), $rnd.Next(830, 1170), $rnd.Next(8, 40), 3)
    }
    $g.FillRectangle((Sfumatura 1180 420 (Colore 238 214 170) (Colore 214 186 140)), 0, 1180, 2400, 420)
    for ($i = 0; $i -lt 2500; $i++) {
        $g.FillEllipse((Pennello (Colore 150 120 80 ($rnd.Next(40, 140)))), $rnd.Next(0, 2400), $rnd.Next(1185, 1600), 4, 4)
    }
    $g.FillRectangle((Pennello (Colore 90 70 50)), 596, 1010, 10, 420)
    $g.FillPie((Pennello (Colore 210 50 50)), 420, 930, 360, 180, 180, 180)
    $g.FillRectangle((Pennello (Colore 40 150 140)), 880, 1350, 320, 140)
}

New-Foto 'tramonto.png' {
    param($g)
    $g.FillRectangle((Sfumatura 0 1100 (Colore 70 40 110) (Colore 250 140 60)), 0, 0, 2400, 1100)
    for ($i = 0; $i -lt 250; $i++) {
        $d = $rnd.Next(2, 6)
        $g.FillEllipse((Pennello (Colore 255 255 230 ($rnd.Next(80, 220)))), $rnd.Next(0, 2400), $rnd.Next(0, 450), $d, $d)
    }
    $g.FillEllipse((Pennello (Colore 255 90 50)), 1000, 820, 400, 400)
    $punti = New-Object 'System.Collections.Generic.List[Drawing.Point]'
    $punti.Add((New-Object Drawing.Point 0, 1600))
    for ($x = 0; $x -le 2400; $x += 20) {
        $punti.Add((New-Object Drawing.Point $x, ([int](1080 + 70 * [Math]::Sin($x / 260.0) + 40 * [Math]::Sin($x / 97.0)))))
    }
    $punti.Add((New-Object Drawing.Point 2400, 1600))
    $g.FillPolygon((Pennello (Colore 35 20 45)), $punti.ToArray())
    $g.FillRectangle((Pennello (Colore 25 15 30)), 1700, 1000, 180, 140)
    $g.FillRectangle((Pennello (Colore 255 210 120)), 1740, 1040, 40, 40)
}

New-Foto 'bosco.jpg' {
    param($g)
    $g.FillRectangle((Sfumatura 0 700 (Colore 200 220 210) (Colore 150 180 160)), 0, 0, 2400, 700)
    $g.FillRectangle((Sfumatura 700 900 (Colore 60 100 50) (Colore 30 60 30)), 0, 700, 2400, 900)
    for ($i = 0; $i -lt 260; $i++) {
        $x = $rnd.Next(-100, 2400)
        $base = 650 + [int](1000 * $i / 260) + $rnd.Next(-20, 20)
        $alt = [int](($base - 400) * 0.9)
        $lar = [int]($alt * 0.45)
        $verde = Colore ($rnd.Next(20, 60)) ($rnd.Next(80, 140)) ($rnd.Next(30, 70))
        $tri = [Drawing.Point[]]@(
            (New-Object Drawing.Point ([int]($x + $lar / 2)), ($base - $alt)),
            (New-Object Drawing.Point $x, $base),
            (New-Object Drawing.Point ($x + $lar), $base)
        )
        $g.FillPolygon((Pennello $verde), $tri)
        $g.FillRectangle((Pennello (Colore 70 50 30)), [int]($x + $lar / 2 - 6), $base, 12, 30)
    }
}

$utf8 = New-Object Text.UTF8Encoding $false
[IO.File]::WriteAllText((Join-Path $materiale 'diario-estate.txt'), @'
Il 12 agosto siamo arrivati al mare poco prima del tramonto, stanchi ma felici. La nonna aveva preparato la pasta con le melanzane e il profumo arrivava fino al cancello. Dopo cena siamo scesi in spiaggia a piedi nudi e la sabbia era ancora calda. Luca ha trovato una conchiglia enorme e ha giurato che l'avrebbe tenuta per sempre.

Il mare quella sera era calmo, quasi immobile, e rifletteva le luci del paese. Abbiamo parlato a lungo della casa nuova e del lavoro che comincia a settembre. Io avevo paura del cambiamento, ma la nonna ha riso e ha detto che le case si riempiono da sole. Più tardi è arrivato lo zio Franco con la chitarra e abbiamo cantato fino a mezzanotte. Nessuno ricordava le parole delle canzoni, ma non importava a nessuno.

Prima di dormire ho scritto queste righe per non dimenticare la sera al mare con la nonna. Forse tra qualche anno non ricorderò il colore del cielo, ma spero di ricordare la sua risata. Domani si torna in città.
'@, $utf8)

[IO.File]::WriteAllText((Join-Path $materiale 'appunti-trasloco.txt'), @'
Trasloco fissato per sabato 3 ottobre, il ritiro degli scatoloni è giovedì.
Chiamare la ditta per confermare il furgone e l'orario del mattino.
Smontare la libreria del soggiorno e l'armadio della camera.
Etichettare gli scatoloni per stanza: cucina, bagno, studio.
Disdire internet nella vecchia casa e attivarlo nella nuova entro fine mese.
Comunicare il nuovo indirizzo alla banca e al medico.
Lasciare le chiavi al vicino del piano di sotto.
'@, $utf8)

[IO.File]::WriteAllText((Join-Path $materiale 'fattura-luce-settembre.txt'), @'
FATTURA N. 2026/0917
Fornitura di energia elettrica, periodo 1-30 settembre 2026
Consumo: 212 kWh
Totale da pagare: 64,80 euro
Scadenza: 20 ottobre 2026
'@, $utf8)

$rumore = New-Object byte[] 1572864
$rnd.NextBytes($rumore)
[IO.File]::WriteAllBytes((Join-Path $materiale 'backup-vecchio.bin'), $rumore)

$date = @{
    'mare.jpg' = '2026-08-12'; 'tramonto.png' = '2026-08-13'; 'bosco.jpg' = '2026-09-02'
    'diario-estate.txt' = '2026-08-12'; 'appunti-trasloco.txt' = '2026-09-20'
    'fattura-luce-settembre.txt' = '2026-10-01'; 'backup-vecchio.bin' = '2023-05-04'
}
foreach ($nome in $date.Keys) {
    (Get-Item -LiteralPath (Join-Path $materiale $nome)).LastWriteTime =
        [datetime]::ParseExact("$($date[$nome]) 18:30", 'yyyy-MM-dd HH:mm', [Globalization.CultureInfo]::InvariantCulture)
}

# ---------------------------------------------------------------------------
# La storia
# ---------------------------------------------------------------------------
Titolo '1 · Affido a Oblio sette file: tre foto, tre testi (tra cui una fattura) e un vecchio backup'
Oblio crea
Oblio aggiungi $materiale -Sposta
Oblio stato

Titolo '2 · Passano 90 giorni. Riguardo solo la foto del tramonto.'
Oblio tempo 90
Oblio apri tramonto.png

Titolo "3 · Passano altri 60 giorni senza aprire nient'altro."
Oblio tempo 60
Oblio stato

Titolo '4 · Riapro la foto del mare e il diario: ormai sono sbiaditi.'
Oblio apri mare.jpg
Oblio apri diario-estate.txt

Titolo '5 · Passa un anno.'
Oblio tempo 365
Oblio stato

Titolo '6 · Cerco "mare": la traccia resta anche quando il file è sbiadito.'
Oblio cerca mare

Titolo '7 · Cosa resta del bosco e del vecchio backup?'
Oblio apri bosco.jpg
Oblio apri backup-vecchio.bin

Titolo 'Fine'
Write-Host "  I ricordi ricostruiti sono in:  $(Join-Path $archivio 'ricordi')"
Write-Host '  Confronta mare.ricordo.jpg (da 480 px) con bosco.ricordo.jpg (da 64 px).'
Write-Host ''
