export class ScanScheduler {
  readonly minimumIntervalMs: number
  private busy = false
  private visible = true
  private lastAutomaticAt = Number.NEGATIVE_INFINITY

  constructor(minimumIntervalMs = 12_000) {
    this.minimumIntervalMs = minimumIntervalMs
  }

  setVisible(visible: boolean): void {
    this.visible = visible
  }

  tryStart(nowMs: number, manual = false): boolean {
    if (this.busy || (!manual && !this.visible)) return false
    if (!manual && nowMs - this.lastAutomaticAt < this.minimumIntervalMs) return false
    this.busy = true
    if (!manual) this.lastAutomaticAt = nowMs
    return true
  }

  finish(): void {
    this.busy = false
  }

  get isBusy(): boolean {
    return this.busy
  }
}
