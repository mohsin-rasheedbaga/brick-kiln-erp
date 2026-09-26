/**
 * Windows Firewall helper.
 * Adds inbound TCP rule for the listening port via UAC elevation.
 */

import { spawn } from 'child_process';
import log from 'electron-log';

const RULE_NAME = 'Brick Kiln ERP Server';

export function isWindows(): boolean {
  return process.platform === 'win32';
}

export function checkFirewallRule(port: number): Promise<boolean> {
  if (!isWindows()) return Promise.resolve(true);
  return new Promise((resolve) => {
    const ps = spawn('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command',
      `Get-NetFirewallRule -DisplayName '${RULE_NAME}' -ErrorAction SilentlyContinue | ForEach-Object { $portFilter = $_ | Get-NetFirewallPortFilter -ErrorAction SilentlyContinue; if ($portFilter.LocalPort -eq ${port}) { Write-Output 'YES'; break } }; Write-Output 'END'`,
    ], { windowsHide: true });
    let out = '';
    ps.stdout.on('data', (d) => { out += d.toString(); });
    ps.on('close', () => resolve(out.includes('YES')));
    ps.on('error', () => resolve(false));
  });
}

export function addFirewallRule(port: number, forceRecreate: boolean = false): Promise<{ success: boolean; message: string }> {
  if (!isWindows()) return Promise.resolve({ success: true, message: 'Not Windows — skipped.' });
  return new Promise(async (resolve) => {
    const exists = await checkFirewallRule(port);
    if (exists && !forceRecreate) return resolve({ success: true, message: 'Firewall rule already exists.' });

    log.info(`[firewall] ${forceRecreate ? 'Re-creating' : 'Adding'} inbound TCP rule for port ${port} (UAC prompt will appear)...`);
    // Use -Profile Any so the rule applies on ALL network types:
    // Domain, Private, AND Public. Many home Wi-Fi networks are classified
    // as "Public" by Windows, which would block the connection if we only
    // allowed Private+Domain.
    // If forceRecreate=true, we first delete any existing rules (to fix
    // rules that were created with the wrong profile in older versions).
    const psScript = `
      try {
        # Remove any existing rules (handles upgrade from older versions
        # where the rule was created with -Profile Private,Domain only).
        Remove-NetFirewallRule -DisplayName '${RULE_NAME}' -ErrorAction SilentlyContinue
        Remove-NetFirewallRule -DisplayName '${RULE_NAME} Beacon' -ErrorAction SilentlyContinue
        # Create new TCP rule with -Profile Any so it applies to all network types.
        New-NetFirewallRule -DisplayName '${RULE_NAME}' -Direction Inbound -Action Allow -Protocol TCP -LocalPort ${port} -Profile Any -ErrorAction Stop | Out-Null
        # Also add a UDP rule for the beacon broadcast port (8766) so mobile apps can receive broadcasts.
        New-NetFirewallRule -DisplayName '${RULE_NAME} Beacon' -Direction Inbound -Action Allow -Protocol UDP -LocalPort 8766 -Profile Any -ErrorAction Stop | Out-Null
        Write-Output 'SUCCESS'
      } catch { Write-Output ('FAILED: ' + $_.Exception.Message) }
    `.trim();

    const ps = spawn('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command',
      `Start-Process powershell.exe -Verb RunAs -Wait -ArgumentList '-NoProfile','-Command','${psScript.replace(/'/g, "''")}'`,
    ], { windowsHide: true });

    ps.on('error', (err) => resolve({ success: false, message: `Could not start firewall config: ${err.message}` }));
    ps.on('close', async () => {
      const nowExists = await checkFirewallRule(port);
      if (nowExists) {
        resolve({ success: true, message: 'Firewall rule created successfully (applies to ALL network types: Public/Private/Domain). Clients can now connect.' });
      } else {
        resolve({ success: false, message: 'Firewall rule was not created. Did you click "Yes" on the UAC permission dialog?' });
      }
    });
  });
}

export function removeFirewallRule(): Promise<{ success: boolean; message: string }> {
  if (!isWindows()) return Promise.resolve({ success: true, message: 'Not Windows — skipped.' });
  return new Promise((resolve) => {
    const psScript = `
      try {
        Remove-NetFirewallRule -DisplayName '${RULE_NAME}' -ErrorAction Stop
        Remove-NetFirewallRule -DisplayName '${RULE_NAME} Beacon' -ErrorAction Stop
        Write-Output 'SUCCESS'
      } catch { Write-Output ('FAILED: ' + $_.Exception.Message) }
    `.trim();
    const ps = spawn('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command',
      `Start-Process powershell.exe -Verb RunAs -Wait -ArgumentList '-NoProfile','-Command','${psScript.replace(/'/g, "''")}'`,
    ], { windowsHide: true });
    ps.on('error', () => resolve({ success: false, message: 'Failed to start firewall cleanup.' }));
    ps.on('close', () => resolve({ success: true, message: 'Firewall rule removed.' }));
  });
}
