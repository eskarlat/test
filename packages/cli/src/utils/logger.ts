import * as clack from "@clack/prompts";
import pc from "picocolors";

export function isInteractive(): boolean {
  return Boolean(process.stdout.isTTY);
}

export function intro(title: string): void {
  if (isInteractive()) {
    clack.intro(pc.bold(title));
  } else {
    console.log(title);
  }
}

export function outro(message: string): void {
  if (isInteractive()) {
    clack.outro(message);
  } else {
    console.log(message);
  }
}

export function info(message: string): void {
  if (isInteractive()) {
    clack.log.info(message);
  } else {
    console.log(message);
  }
}

export function success(message: string): void {
  if (isInteractive()) {
    clack.log.success(message);
  } else {
    console.log(message);
  }
}

export function warn(message: string): void {
  if (isInteractive()) {
    clack.log.warn(message);
  } else {
    console.warn(message);
  }
}

export function error(message: string): void {
  if (isInteractive()) {
    clack.log.error(message);
  } else {
    console.error(message);
  }
}

export function spinner(message: string) {
  if (isInteractive()) {
    const s = clack.spinner();
    s.start(message);
    return {
      stop: (msg?: string) => s.stop(msg ?? message),
      message: (msg: string) => s.message(msg),
    };
  }
  console.log(message);
  return {
    stop: (msg?: string) => { if (msg) console.log(msg); },
    message: (msg: string) => console.log(msg),
  };
}

export function cancel(message: string): never {
  if (isInteractive()) {
    clack.cancel(message);
  } else {
    console.error(message);
  }
  process.exit(1);
}
