# Script to generate and trust a self-signed certificate for Localhost
$certName = "ContaEsteLocal"
$certPath = "c:\Users\Richard\Desktop\Contabilidad\ContaEste\certificate.pfx"
$password = ConvertTo-SecureString -String "password" -Force -AsPlainText

# 1. Create Self-Signed Cert
Write-Host "Generando certificado auto-firmado..."
$cert = New-SelfSignedCertificate -DnsName "localhost", "127.0.0.1", "192.168.130.129" -CertStoreLocation "cert:\LocalMachine\My" -FriendlyName "ContaEste SSL" -NotAfter (Get-Date).AddYears(10)

# 2. Export to PFX for Node.js
Write-Host "Exportando a PFX..."
Export-PfxCertificate -Cert $cert -FilePath $certPath -Password $password

# 3. Trust the certificate (Root Authorities)
Write-Host "Instalando en Entidades de Certificacin de Raz de Confianza..."
$rootStore = New-Object System.Security.Cryptography.X509Certificates.X509Store "Root", "LocalMachine"
$rootStore.Open("ReadWrite")
$rootStore.Add($cert)
$rootStore.Close()

Write-Host "✅ Certificado configurado exitosamente."
