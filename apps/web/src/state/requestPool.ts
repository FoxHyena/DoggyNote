/** A shared request budget. Aborted queued work never takes a network slot. */
export function requestPool(limit: number) {
  let active = 0
  const queue: (() => void)[] = []
  return function run<T>(task: () => Promise<T>, signal: AbortSignal): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const abort = () => {
        const index = queue.indexOf(start)
        if (index >= 0) queue.splice(index, 1)
        signal.removeEventListener('abort', abort)
        reject(signal.reason)
      }
      const start = () => {
        signal.removeEventListener('abort', abort)
        if (signal.aborted) { reject(signal.reason); return }
        active++
        void Promise.resolve().then(task).then(resolve, reject).finally(() => {
          active--
          queue.shift()?.()
        })
      }
      if (signal.aborted) { reject(signal.reason); return }
      if (active < limit) start()
      else { queue.push(start); signal.addEventListener('abort', abort, { once: true }) }
    })
  }
}
