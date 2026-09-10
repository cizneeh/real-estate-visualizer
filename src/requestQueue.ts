interface Job {
  priority: () => number
  start: () => void
}

export class RequestQueue {
  private waiting: Job[] = []
  private active = new Set<Job>()
  private nextStart = 0
  private timer?: ReturnType<typeof setTimeout>

  constructor(
    private readonly concurrency: number,
    private readonly interval = 0,
    private readonly backgroundConcurrency = concurrency,
  ) {}

  run<T>(task: () => Promise<T>, signal: AbortSignal, priority = () => 0): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (signal.aborted) {
        reject(signal.reason)
        return
      }
      const cancel = () => {
        this.waiting = this.waiting.filter((queued) => queued !== job)
        signal.removeEventListener('abort', cancel)
        reject(signal.reason)
        this.pump()
      }
      const job: Job = {
        priority,
        start: () => {
          signal.removeEventListener('abort', cancel)
          this.active.add(job)
          ;(async () => {
            signal.throwIfAborted()
            this.nextStart = Date.now() + this.interval
            return task()
          })()
            .then(resolve, reject)
            .finally(() => {
              this.active.delete(job)
              this.pump()
            })
        },
      }
      signal.addEventListener('abort', cancel, { once: true })
      this.waiting.push(job)
      this.pump()
    })
  }

  pump() {
    clearTimeout(this.timer)
    this.timer = undefined
    while (this.active.size < this.concurrency && this.waiting.length) {
      this.waiting.sort((a, b) => a.priority() - b.priority())
      const next = this.waiting[0]
      const backgroundActive = [...this.active].filter((job) => job.priority() > 0).length
      if (next.priority() > 0 && backgroundActive >= this.backgroundConcurrency) return
      const wait = this.nextStart - Date.now()
      if (wait > 0) {
        this.timer = setTimeout(() => this.pump(), wait)
        return
      }
      this.waiting.shift()
      next.start()
    }
  }
}
