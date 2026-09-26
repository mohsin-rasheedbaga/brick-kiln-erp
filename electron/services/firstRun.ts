/**
 * First-run auto setup.
 *
 * On the FIRST launch of the app (or if network.json doesn't exist yet),
 * automatically:
 *   1. Set the network mode to "server" (so other PCs/phones can connect)
 *   2. Trigger Windows Firewall permission via UAC prompt
 *   3. Start the network RPC server
 *   4. Show a one-time notification to the user explaining what happened
 *
 * This way the user doesn't have to manually go to Network Settings —
 * the app "just works" out of the box. The user can switch to Standalone
 * or Client mode later if they don't want this PC to be a server.
 *
 * The setup only runs ONCE per install. We track completion by storing
 * a flag in network.json itself ("firstRunCompleted": true).
 */

import { app, dialog, BrowserWindow } from 'electron';
import log from 'electron-log';
import { getNetworkConfig, saveNetworkConfig, NetworkConfig } from './networkConfig';
import { startNetworkServer, getLocalIpAddresses } from './networkServer';
import { addFirewallRule, isWindows, checkFirewallRule } from './firewall';

let firstRunShown = false;

/**
 * Returns true if this is the first time the app is being run
 * (i.e., network.json doesn't exist or firstRunCompleted flag is missing),
 * OR if the migration has set _recreateFirewallOnNextRun to force a firewall
 * rule re-creation (e.g., to fix rules created with the wrong profile).
 */
export function isFirstRun(): boolean {
  const cfg = getNetworkConfig() as any;
  if (cfg._recreateFirewallOnNextRun === true) {
    return true;
  }
  return !cfg.firstRunCompleted;
}

/**
 * Run the first-run setup wizard:
 *   1. Set mode to "server" if no mode is configured yet
 *   2. Show a friendly dialog explaining what's about to happen
 *   3. Add Windows Firewall rule (UAC prompt)
 *   4. Start the RPC server
 *   5. Mark firstRunCompleted = true
 *
 * Returns true if setup succeeded, false if user declined or it failed.
 * Either way, marks firstRunCompleted = true so it won't run again.
 */
export async function runFirstRunSetup(): Promise<{
  success: boolean;
  mode: 'server' | 'standalone';
  port: number;
  ips: string[];
  firewallAdded: boolean;
  message: string;
}> {
  if (firstRunShown) {
    return { success: true, mode: 'standalone', port: 0, ips: [], firewallAdded: false, message: 'Already shown' };
  }
  firstRunShown = true;

  const cfg = getNetworkConfig() as any;
  const port = cfg.port || 8765;

  // Special case: if _recreateFirewallOnNextRun is set (by v2.9.3 migration),
  // we skip the wizard dialog and directly re-create the firewall rule with
  // the corrected -Profile Any setting. The server is already running.
  if (cfg._recreateFirewallOnNextRun === true) {
    log.info('[first-run] Forced firewall re-creation (migration v2.9.3)');
    let firewallAdded = false;
    if (isWindows()) {
      const fwResult = await addFirewallRule(port, true /* forceRecreate */);
      firewallAdded = fwResult.success;
      log.info(`[first-run] Firewall re-create result: ${fwResult.success} — ${fwResult.message}`);

      // Show a one-time notification about the fix.
      dialog.showMessageBox({
        type: 'info',
        title: 'Connection Fix Applied',
        message: 'Network connection fixed',
        detail:
          `A firewall rule has been re-created with the correct settings\n` +
          `so mobile apps can connect on any Wi-Fi network type.\n\n` +
          `If your mobile app still can't connect, please:\n` +
          `  1. Make sure the desktop ERP is running\n` +
          `  2. Restart the mobile app\n` +
          `  3. Tap "Re-scan Wi-Fi for server" on the login screen`,
        buttons: ['OK'],
      });
    }
    // Clear the force flag so this won't run again.
    saveNetworkConfig({ _recreateFirewallOnNextRun: false, firstRunCompleted: true } as any);
    return {
      success: true,
      mode: cfg.mode || 'server',
      port,
      ips: getLocalIpAddresses(),
      firewallAdded,
      message: 'Firewall rule re-created',
    };
  }

  log.info('[first-run] Starting first-run setup wizard...');

  // Step 1: Ask user permission via a friendly dialog
  const choice = await dialog.showMessageBox({
    type: 'question',
    title: 'Enable Multi-PC Sharing?',
    message: 'Enable Network Sharing?',
    detail:
      `This PC can act as the MAIN server for other PCs and Android phones\n` +
      `on the same Wi-Fi to connect to this software.\n\n` +
      `If you click "Yes, Enable":\n` +
      `  • Windows Firewall will request permission (one-time UAC prompt)\n` +
      `  • This PC will start listening on port ${port}\n` +
      `  • Other devices on your Wi-Fi can connect using this PC's IP\n\n` +
      `If you click "No, Standalone":\n` +
      `  • Only this PC will use the software (no sharing)\n` +
      `  • You can enable sharing later from Network Settings\n\n` +
      `Recommendation: Click "Yes, Enable" — you can always turn it off later.`,
    buttons: [
      'Yes, Enable Sharing',
      'No, Standalone Only',
      'Ask Me Later',
    ],
    defaultId: 0,
    cancelId: 2,
  });

  if (choice.response === 2) {
    // "Ask Me Later" — don't mark as completed, will run again next time
    log.info('[first-run] User chose "Ask Me Later" — will prompt again next launch');
    firstRunShown = false;  // allow re-prompting
    return { success: false, mode: 'standalone', port: 0, ips: [], firewallAdded: false, message: 'User deferred' };
  }

  if (choice.response === 1) {
    // Standalone only
    log.info('[first-run] User chose Standalone mode');
    saveNetworkConfig({ mode: 'standalone', firstRunCompleted: true } as any);
    return { success: true, mode: 'standalone', port: 0, ips: [], firewallAdded: false, message: 'Standalone selected' };
  }

  // User chose "Yes, Enable Sharing"
  log.info('[first-run] User chose Server mode — configuring...');

  // Save server mode
  saveNetworkConfig({ mode: 'server', port });

  // Step 2: Add firewall rule (will trigger UAC prompt)
  let firewallAdded = false;
  let firewallMessage = 'Skipped (not Windows)';
  if (isWindows()) {
    log.info('[first-run] Requesting Windows Firewall permission (UAC prompt)...');
    const fwResult = await addFirewallRule(port);
    firewallAdded = fwResult.success;
    firewallMessage = fwResult.message;
    log.info(`[first-run] Firewall result: ${fwResult.success} — ${fwResult.message}`);
  }

  // Step 3: Start the RPC server
  let ips: string[] = [];
  let serverStarted = false;
  try {
    const result = await startNetworkServer(port);
    ips = result.ips;
    serverStarted = true;
    log.info(`[first-run] RPC server started. Local IPs: ${ips.join(', ')}`);
  } catch (err) {
    log.error('[first-run] Failed to start RPC server:', err);
  }

  // Step 4: Mark first run as completed
  saveNetworkConfig({ firstRunCompleted: true } as any);

  // Step 5: Show a success message with the IP address so the user can note it
  if (serverStarted && ips.length > 0) {
    const ipList = ips.map(ip => `${ip}:${port}`).join('\n   ');
    dialog.showMessageBox({
      type: 'info',
      title: 'Sharing Enabled',
      message: 'Network Sharing is now ON',
      detail:
        `Other devices on your Wi-Fi can now connect to this PC.\n\n` +
        `Share this address with the other PCs/phones:\n` +
        `   ${ipList}\n\n` +
        `On Android app: enter this IP during first setup.\n` +
        `On other PCs: install Brick Kiln ERP → Network Settings → Client mode → enter this IP.\n\n` +
        `You can change these settings later from the Network Sharing page.`,
      buttons: ['OK'],
    });
  } else if (!serverStarted) {
    dialog.showErrorBox(
      'Network Server Failed',
      `Could not start the network server on port ${port}.\n\n` +
      `You can still use the software on this PC (standalone mode).\n\n` +
      `To try again, go to Network Settings and switch to Server mode.`,
    );
  }

  return {
    success: serverStarted,
    mode: 'server',
    port,
    ips,
    firewallAdded,
    message: firewallMessage,
  };
}
