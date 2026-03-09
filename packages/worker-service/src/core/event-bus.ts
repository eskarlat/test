import { EventEmitter } from "node:events";

export type WorkerEventType =
  | "project:registered"
  | "project:unregistered"
  | "extension:mounted"
  | "extension:unmounted"
  | "extension:installed"
  | "extension:removed"
  | "extension:upgraded"
  | "extension:remounted"
  | "extension:enabled"
  | "extension:disabled"
  | "extension:error"
  | "mcp:connected"
  | "mcp:disconnected"
  | "vault:updated"
  | "updates:available"
  | "session:started"
  | "session:ended"
  | "observation:created"
  | "observation:updated"
  | "tool:denied"
  | "tool:used"
  | "prompt:recorded"
  | "error:recorded"
  | "subagent:started"
  | "subagent:stopped";

export interface WorkerEvent {
  type: WorkerEventType;
  payload: Record<string, unknown>;
  timestamp: string;
}

const RING_BUFFER_SIZE = 100;

class EventBus extends EventEmitter {
  private readonly buffer: WorkerEvent[] = [];

  emit(event: "event", workerEvent: WorkerEvent): boolean;
  emit(event: string, ...args: unknown[]): boolean;
  emit(event: string, ...args: unknown[]): boolean {
    if (event === "event" && args[0]) {
      const workerEvent = args[0] as WorkerEvent;
      this.buffer.push(workerEvent);
      if (this.buffer.length > RING_BUFFER_SIZE) {
        this.buffer.shift();
      }
    }
    return super.emit(event, ...args);
  }

  publish(type: WorkerEventType, payload: Record<string, unknown>): void {
    const event: WorkerEvent = {
      type,
      payload,
      timestamp: new Date().toISOString(),
    };
    this.emit("event", event);
  }

  getHistory(): WorkerEvent[] {
    return [...this.buffer];
  }
}

export const eventBus = new EventBus();
