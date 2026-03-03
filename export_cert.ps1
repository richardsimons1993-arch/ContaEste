# Script to export the public certificate for manual browser import
$certName = "ContaEste SSL"
$exportPath = "c:\Users\Richard\Desktop\Contabilidad\ContaEste\contaeste.crt"

$cert = Get-ChildItem -Path cert:\LocalMachine\My | Where-Object { $_.FriendlyName -eq $certName } | Select-Object -First 1

if ($cert) {
    Export-Certificate -Cert $cert -FilePath $exportPath
    Write-Host "✅ Certificado pblico exportado a $exportPath"
    Write-Host "Ahora puedes importarlo manualmente en Chrome/Edge."
}
else {
    Write-Error "❌ No se encontr el certificado '$certName'. Ejecuta setup_https_v2.ps1 primero."
}
