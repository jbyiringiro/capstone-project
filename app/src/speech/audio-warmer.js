// Opening the audio output is the slowest step of the first Vuga: about 0.37 s in Chromium, while
// later clips start in about 0.04 s. The board therefore opens it in advance with a silent Web
// Audio context. Two measured constraints shape this class:
//   - the AudioContext constructor blocks the main thread for about 0.4 s, so it is built while
//     the board is idle, never inside a tap;
//   - a context only opens the output once it renders something, so it plays one silent sample.
// After a minute without taps the context is suspended to save battery; the next tap resumes it.
export class AudioWarmer {
  constructor({ idleMs = 60_000, createContext = defaultContext, schedule = whenIdle } = {}) {
    this.idleMs = idleMs
    this.createContext = createContext
    this.schedule = schedule
    this.context = null
    this.cancelPrepare = null
    this.timer = null
  }

  prepare() {
    if (this.context || this.cancelPrepare) return
    this.cancelPrepare = this.schedule(() => {
      try {
        this.context = this.createContext()
        this.#playSilence()
        this.#suspendWhenIdle()
      } catch {
        // Without Web Audio, speech still plays; only the first clip starts later.
      }
    })
  }

  touch() {
    if (!this.context) { this.prepare(); return }
    if (this.context.state === 'suspended') this.context.resume().then(() => this.#playSilence()).catch(() => {})
    this.#suspendWhenIdle()
  }

  close() {
    this.cancelPrepare?.()
    this.cancelPrepare = null
    clearTimeout(this.timer)
    this.context?.close().catch(() => {})
    this.context = null
  }

  #playSilence() {
    const source = this.context.createBufferSource()
    source.buffer = this.context.createBuffer(1, 1, 22050)
    source.connect(this.context.destination)
    source.start()
  }

  #suspendWhenIdle() {
    clearTimeout(this.timer)
    this.timer = setTimeout(() => { this.context?.suspend().catch(() => {}) }, this.idleMs)
  }
}

function defaultContext() {
  const Context = globalThis.AudioContext ?? globalThis.webkitAudioContext
  if (!Context) throw new Error('Web Audio is not available')
  return new Context()
}

// Runs `task` once the page is idle, or after `timeout` ms at the latest; returns a cancel function.
export function whenIdle(task, timeout = 3000) {
  if (typeof requestIdleCallback === 'function') {
    const id = requestIdleCallback(task, { timeout })
    return () => cancelIdleCallback(id)
  }
  const id = setTimeout(task, Math.min(timeout, 500))
  return () => clearTimeout(id)
}
