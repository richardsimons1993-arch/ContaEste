# Updated Script for a more robust self-signed certificate
$certName = "ContaEsteLocal"
$certPath = "c:\Users\Richard\Desktop\Contabilidad\ContaEste\certificate.pfx"
$password = ConvertTo-SecureString -String "password" -Force -AsPlainText

Write-Host "Re-generando certificado con parmetros extendidos..."
# DNSName is critical for Chrome/Edge to trust it as "Secure"
$cert = New-SelfSignedCertificate -DnsName "localhost", "127.0.0.1" -CertStoreLocation "cert:\LocalMachine\My" -FriendlyName "ContaEste SSL" -NotAfter (Get-Date).AddYears(10) -KeyUsage DigitalSignature, KeyEncipherment -Type SSLServerAuthentication

Write-Host "Exportando a PFX..."
Export-PfxCertificate -Cert $cert -FilePath $certPath -Password $password

Write-Host "Asegurando que est en Root (Raiz de Confianza)..."
$rootStore = New-Object System.Security.Cryptography.X509Certificates.X509Store "Root", "LocalMachine"
$rootStore.Open("ReadWrite")
$rootStore.Add($cert)
$rootStore.Close()

Write-Host "✅ Certificado RE-configurado. Por favor, reinicia el navegador completamente."
