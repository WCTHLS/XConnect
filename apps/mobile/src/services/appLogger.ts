export type LogCategory = "BLE" | "WIFI" | "MOTION" | "API" | "ROOM" | "INFO" | "WARN" | "ERROR";

export type LogEntry = {
  id: string;
  timestamp: string;
  category: LogCategory;
  message: string;
  level: "info" | "warn" | "error";
};

type LogListener = (logs: LogEntry[]) => void;

class AppLoggerService {
  private logs: LogEntry[] = [];
  private listeners = new Set<LogListener>();
  private maxLogs = 150;
  private idCounter = 0;

  constructor() {
    this.interceptConsole();
  }

  private interceptConsole() {
    const originalWarn = console.warn;
    const originalError = console.error;

    console.warn = (...args: any[]) => {
      originalWarn.apply(console, args);
      const msg = args.map(a => (typeof a === "object" ? JSON.stringify(a) : String(a))).join(" ");
      this.log("WARN", msg, "warn");
    };

    console.error = (...args: any[]) => {
      originalError.apply(console, args);
      const msg = args.map(a => (typeof a === "object" ? (a?.message || JSON.stringify(a)) : String(a))).join(" ");
      this.log("ERROR", msg, "error");
    };
  }

  log(category: LogCategory, message: string, level: "info" | "warn" | "error" = "info") {
    const now = new Date();
    const timeStr = [
      now.getHours().toString().padStart(2, "0"),
      now.getMinutes().toString().padStart(2, "0"),
      now.getSeconds().toString().padStart(2, "0")
    ].join(":");

    const entry: LogEntry = {
      id: `${Date.now()}-${++this.idCounter}`,
      timestamp: timeStr,
      category,
      message,
      level
    };

    this.logs.unshift(entry);
    if (this.logs.length > this.maxLogs) {
      this.logs.pop();
    }

    this.notify();
  }

  getLogs(): LogEntry[] {
    return [...this.logs];
  }

  clear() {
    this.logs = [];
    this.notify();
  }

  subscribe(listener: LogListener): () => void {
    this.listeners.add(listener);
    listener([...this.logs]);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify() {
    const snapshot = [...this.logs];
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }
}

export const AppLogger = new AppLoggerService();
