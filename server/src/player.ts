import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { unlink } from "node:fs/promises";

interface Item {
  file: string;
  deleteAfter: boolean;
  done: (err?: Error) => void;
}

function findPlayer(): { cmd: string; args: string[] } | undefined {
  if (process.platform === "darwin") return { cmd: "afplay", args: [] };
  for (const cmd of ["pw-play", "paplay", "aplay", "ffplay"]) {
    if (spawnSync("sh", ["-c", `command -v ${cmd}`]).status === 0) {
      return { cmd, args: cmd === "ffplay" ? ["-nodisp", "-autoexit", "-loglevel", "quiet"] : [] };
    }
  }
  return undefined;
}

/** Plays audio files one after another through the system player (afplay on macOS). */
export class Player {
  private queue: Item[] = [];
  private current?: { item: Item; child: ChildProcess };
  private readonly player = findPlayer();

  get available(): boolean {
    return this.player !== undefined;
  }

  get busy(): boolean {
    return this.current !== undefined || this.queue.length > 0;
  }

  /** Queues a file; the promise resolves when it has finished (or was stopped). */
  enqueue(file: string, deleteAfter = false): Promise<void> {
    if (!this.player) {
      return Promise.reject(new Error("No audio player found (afplay on macOS; pw-play, paplay, aplay or ffplay elsewhere)."));
    }
    return new Promise((resolve, reject) => {
      this.queue.push({ file, deleteAfter, done: (err) => (err ? reject(err) : resolve()) });
      this.next();
    });
  }

  /** Stops the current playback and drops everything queued. Returns how many items were dropped. */
  stop(): number {
    const dropped = this.queue.splice(0);
    for (const item of dropped) this.finish(item);
    let count = dropped.length;
    if (this.current) {
      count += 1;
      this.current.child.kill("SIGTERM");
    }
    return count;
  }

  private finish(item: Item, err?: Error): void {
    if (item.deleteAfter) unlink(item.file).catch(() => undefined);
    item.done(err);
  }

  private next(): void {
    if (this.current || !this.player) return;
    const item = this.queue.shift();
    if (!item) return;
    const child = spawn(this.player.cmd, [...this.player.args, item.file], { stdio: "ignore" });
    this.current = { item, child };
    let settled = false;
    const settle = (err?: Error) => {
      if (settled) return;
      settled = true;
      this.current = undefined;
      this.finish(item, err);
      this.next();
    };
    child.on("error", (err) => settle(new Error(`${this.player?.cmd} failed: ${err.message}`)));
    child.on("exit", (code, signal) => {
      if (code === 0 || signal) settle();
      else settle(new Error(`${this.player?.cmd} exited with code ${code}`));
    });
  }
}
