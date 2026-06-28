import { execFile, execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { repoRoot } from "../config.js";
import { log } from "../logger.js";
import { audit } from "./audit.js";

const AGENTCTL = join(repoRoot, "scripts", "agentctl.sh");

/** Which Windows service manager hosts the bot, if any: the NSSM service 'myhq'
 *  or the 'MyHQ Bot' scheduled task (both installed by myhq-install.ps1). */
// Full paths to system32 executables so they resolve even when the NSSM
// service has a restricted PATH that omits C:\Windows\System32.
const sys32 = join(process.env.SystemRoot ?? "C:\\Windows", "System32");
const SC_EXE       = join(sys32, "sc.exe");
const SCHTASKS_EXE = join(sys32, "schtasks.exe");

function windowsServiceKind(): "nssm" | "task" | null {
  try {
    const out = execFileSync(SC_EXE, ["query", "myhq"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    if (/myhq/i.test(out)) return "nssm";
  } catch {
    /* not registered as a service */
  }
  try {
    execFileSync(SCHTASKS_EXE, ["/query", "/tn", "MyHQ Bot"], { stdio: "ignore" });
    return "task";
  } catch {
    /* no scheduled task */
  }
  return null;
}

/** Whether this checkout is being run under a known service manager, so a
 *  restart will actually respawn the process (rather than just kill it). */
export function serviceInstalled(): boolean {
  try {
    if (process.platform === "darwin") {
      // Matches the launchd label installed by scripts/macos/install-service.sh.
      return existsSync(join(homedir(), "Library", "LaunchAgents", "sh.gyorgy.myhq.plist"));
    }
    if (process.platform === "linux") {
      // Matches the systemd unit installed by scripts/linux/install-service.sh.
      const out = execFileSync("systemctl", ["list-unit-files", "myhq.service"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      });
      return /myhq\.service/.test(out);
    }
    if (process.platform === "win32") {
      return windowsServiceKind() !== null;
    }
  } catch {
    /* manager missing or errored — treat as not installed */
  }
  return false;
}

/**
 * Restart the bot via its service manager. Only safe when a service is
 * installed (otherwise the process would die without respawning), so callers
 * must check serviceInstalled() first. The restart is deferred briefly so the
 * HTTP response can flush before this process is signalled.
 */
export function restartService(): void {
  audit("agent.restart", { platform: process.platform });
  log.warn("Panel requested a service restart — respawning shortly");
  setTimeout(() => {
    if (process.platform === "win32") {
      const kind = windowsServiceKind();
      // Restart detached so the command survives our process being killed mid-
      // restart; the service manager brings us back up. Use built-in service
      // control (Restart-Service / schtasks) — NOT the `nssm` CLI, which usually
      // isn't on the service's PATH. An NSSM service is a real Windows service.
      let child;
      if (kind === "nssm") {
        // Use sc.exe stop + start directly — no powershell, no ExecutionPolicy,
        // no elevation prompt. sc.exe is callable from the service process itself
        // since it already runs with service-control rights as .\admin.
        // Chain via cmd so we can run two sc.exe calls in one detached child.
        const cmdExe = join(sys32, "cmd.exe");
        child = spawn(
          cmdExe,
          ["/c", `"${SC_EXE}" stop myhq & "${SC_EXE}" start myhq`],
          { detached: true, stdio: "ignore", windowsHide: true },
        );
      } else if (kind === "task") {
        const cmdExe = join(sys32, "cmd.exe");
        child = spawn(
          cmdExe,
          ["/c", `"${SCHTASKS_EXE}" /end /tn "MyHQ Bot" & "${SCHTASKS_EXE}" /run /tn "MyHQ Bot"`],
          { detached: true, stdio: "ignore", windowsHide: true },
        );
      } else {
        log.error("Service restart failed: no Windows service or scheduled task found");
        return;
      }
      child.unref();
      return;
    }
    const child = execFile(AGENTCTL, ["restart"], (err) => {
      if (err) log.error("Service restart failed", { error: err.message });
    });
    child.unref();
  }, 800);
}
