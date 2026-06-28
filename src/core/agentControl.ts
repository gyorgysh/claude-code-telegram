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
        // The service runs as .\admin which lacks SERVICE_STOP/START rights on
        // its own service object, so sc.exe called directly is denied.
        // Strategy: create a one-shot schtasks entry running as SYSTEM (which
        // always has full SCM rights). The task issues only `sc stop myhq` —
        // NOT restart — because NSSM is configured with AppExit Default Restart
        // and will bring the service back up automatically after the stop. This
        // avoids the race where sc.exe restart kills our process before it can
        // issue the start, leaving the service permanently stopped.
        // The task waits 3 s (ping delay) before stopping so our process has
        // time to finish the HTTP response, then NSSM restarts it ~5 s later.
        const taskName = "MyhqRestart";
        const cmdExe = join(sys32, "cmd.exe");
        const scPath = join(sys32, "sc.exe");
        // /TR value: ping 3-second delay, then sc stop; SYSTEM has no interactive
        // desktop so we keep it headless (no window, no stdin).
        const tr = `cmd /c ping -n 3 127.0.0.1 >nul & "${scPath}" stop myhq`;
        child = spawn(
          cmdExe,
          [
            "/c",
            `"${SCHTASKS_EXE}" /create /f /tn "${taskName}" /ru SYSTEM /sc ONCE /st 00:00 /tr "${tr}" && "${SCHTASKS_EXE}" /run /tn "${taskName}"`,
          ],
          { detached: true, stdio: "ignore", windowsHide: true, shell: false },
        );
      } else if (kind === "task") {
        const cmdExe = join(sys32, "cmd.exe");
        child = spawn(
          cmdExe,
          ["/c", `"${SCHTASKS_EXE}" /end /tn "MyHQ Bot" & "${SCHTASKS_EXE}" /run /tn "MyHQ Bot"`],
          { detached: true, stdio: "ignore", windowsHide: true, shell: false },
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
