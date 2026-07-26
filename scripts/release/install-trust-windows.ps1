#Requires -RunAsAdministrator
<#
.SYNOPSIS
  One-time step for each Windows machine that will run Worship Studio.

.DESCRIPTION
  Worship Studio releases are signed with a self-signed certificate (not one from a paid
  certificate authority — see docs/release-process.md for why). Windows doesn't trust a
  self-signed certificate by default, so the first install would otherwise show an
  "unrecognized publisher" warning.

  Running this script once trusts that certificate on this machine. Every future release
  signed with the same certificate is then recognized automatically — this script does not
  need to be run again after a normal version update, only if the church ever switches to a
  new signing certificate (which would be announced with the release, if it ever happens).

  A standard Windows installer elevation (UAC) prompt showing "Worship Studio" as the
  publisher is still normal and expected — trusting the certificate just stops it from being
  flagged as unrecognized/unsafe.
#>
$cerPath = Join-Path $PSScriptRoot 'worship-studio-codesign.cer'
if (-not (Test-Path $cerPath)) {
  throw "Certificate not found at $cerPath. Pull the latest repo/release download and try again."
}

Import-Certificate -FilePath $cerPath -CertStoreLocation Cert:\LocalMachine\Root | Out-Null
Write-Host 'Trusted. Worship Studio installers signed with this certificate will no longer show an unrecognized-publisher warning on this machine.'
