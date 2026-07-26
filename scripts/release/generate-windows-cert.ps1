#Requires -Version 5.1
<#
.SYNOPSIS
  One-time step: generates the self-signed Authenticode code-signing certificate used to
  sign Windows release builds (see docs/release-process.md).

.DESCRIPTION
  Run this once, not per-release. CI reuses the same certificate on every release (via the
  WINDOWS_CERTIFICATE / WINDOWS_CERTIFICATE_PASSWORD / WINDOWS_CERT_THUMBPRINT GitHub
  secrets), so a church machine that trusts it once (install-trust-windows.ps1) keeps
  trusting every future release signed with it.

  Re-running this generates a NEW certificate with a new thumbprint. Only do that if the
  existing key is lost or compromised — every already-trusted machine would need to run
  install-trust-windows.ps1 again with the new .cer, and all three GitHub secrets would need
  updating.

.OUTPUTS
  worship-studio-codesign.pfx — private key + certificate, password-protected. NOT committed
    to git. Base64-encode this into the WINDOWS_CERTIFICATE secret, then store the .pfx
    itself somewhere secure (password manager attachment, etc.) and delete the local copy.
  worship-studio-codesign.cer — public certificate only, no private key. Safe to commit —
    this is exactly what install-trust-windows.ps1 asks church machines to trust.
#>
param(
  [string]$Subject = 'CN=Worship Studio',
  [string]$OutDir = $PSScriptRoot,
  [Parameter(Mandatory)]
  [securestring]$PfxPassword
)

$cert = New-SelfSignedCertificate `
  -Type CodeSigningCert `
  -Subject $Subject `
  -KeyAlgorithm RSA `
  -KeyLength 2048 `
  -KeyUsage DigitalSignature `
  -NotAfter (Get-Date).AddYears(10) `
  -CertStoreLocation Cert:\CurrentUser\My

$pfxPath = Join-Path $OutDir 'worship-studio-codesign.pfx'
$cerPath = Join-Path $OutDir 'worship-studio-codesign.cer'

Export-PfxCertificate -Cert $cert -FilePath $pfxPath -Password $PfxPassword | Out-Null
Export-Certificate -Cert $cert -FilePath $cerPath | Out-Null

Write-Host ''
Write-Host "Thumbprint: $($cert.Thumbprint)"
Write-Host "  -> store this as the WINDOWS_CERT_THUMBPRINT GitHub secret"
Write-Host ''
Write-Host "Private key + cert: $pfxPath"
Write-Host '  -> base64-encode this into the WINDOWS_CERTIFICATE secret, e.g.:'
Write-Host "     [Convert]::ToBase64String([IO.File]::ReadAllBytes('$pfxPath')) | Set-Clipboard"
Write-Host '  -> keep the .pfx file itself out of git; back it up somewhere secure, then delete the local copy'
Write-Host ''
Write-Host "Public cert only: $cerPath"
Write-Host '  -> commit this file; it is what install-trust-windows.ps1 asks church machines to trust'
