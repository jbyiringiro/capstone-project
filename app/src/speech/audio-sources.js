// Where a word's Kinyarwanda speech can come from. Each source either returns a playable part
// ({ blob } or { text, voice }) or null, and the planner tries them in order of preference.
import { kinyarwandaVoice, loadVoices } from './voices.js'

export class AudioSource {
  async resolve(_key, _symbol, _signal) {
    throw new Error(`${this.constructor.name} must implement resolve(key, symbol, signal)`)
  }
}

// A familiar voice a caregiver recorded on this device; always preferred.
export class RecordingSource extends AudioSource {
  constructor(getRecording) {
    super()
    this.getRecording = getRecording
  }
  async resolve(key) {
    const blob = await this.getRecording(key)
    return blob?.size ? { blob } : null
  }
}

// A WAV file served with the app: an installation's own clips or the bundled synthetic speech.
export class ClipSource extends AudioSource {
  constructor(directory) {
    super()
    this.directory = directory
  }
  async resolve(key, symbol, signal) {
    if (symbol?.custom) return null
    try {
      const response = await fetch(`${this.directory}/${encodeURIComponent(key)}.wav`, { signal })
      // An offline single-page fallback answers missing files with HTML, which is not speech.
      if (!response.ok || !response.headers.get('content-type')?.startsWith('audio/')) return null
      const blob = await response.blob()
      return blob.size ? { blob } : null
    } catch {
      return null
    }
  }
}

// A generated sentence word (ndashaka, uri he) from scripts/generate_kinyarwanda_audio.py --forms,
// looked up by its clip name rather than a picture key.
export class GeneratedClipSource extends AudioSource {
  constructor(directory = '/audio/rw/forms') {
    super()
    this.directory = directory
  }
  async resolve(name, _symbol, signal) {
    try {
      const response = await fetch(`${this.directory}/${encodeURIComponent(name)}.mp3`, { signal })
      if (!response.ok || !response.headers.get('content-type')?.startsWith('audio/')) return null
      const blob = await response.blob()
      return blob.size ? { blob } : null
    } catch {
      return null
    }
  }
}

// Reviewed clips a developer installs in public/audio before building. They are listed in
// public/audio/installed.json, so the board never probes the network for files that usually do
// not exist: offline, such a probe fails through the service worker and took about 2 s in Firefox.
export class InstalledClipSource extends ClipSource {
  constructor(directory = '/audio', manifestUrl = `${directory}/installed.json`) {
    super(directory)
    this.manifestUrl = manifestUrl
    this.installed = null
  }
  async resolve(key, symbol, signal) {
    if (symbol?.custom) return null
    this.installed ??= this.#loadManifest(signal)
    return (await this.installed).has(key) ? super.resolve(key, symbol, signal) : null
  }
  async #loadManifest(signal) {
    try {
      const response = await fetch(this.manifestUrl, { signal })
      if (!response.ok || !response.headers.get('content-type')?.includes('json')) return new Set()
      const { clips } = await response.json()
      return new Set(Array.isArray(clips) ? clips : [])
    } catch {
      return new Set()
    }
  }
}

// A Kinyarwanda system voice reading the label. Never another language's voice.
export class SystemVoiceSource extends AudioSource {
  constructor(load = loadVoices) {
    super()
    this.load = load
    this.voices = null
  }
  async resolve(_key, symbol, signal) {
    this.voices ??= await this.load(signal)
    const voice = kinyarwandaVoice(this.voices)
    return voice && symbol?.label_rw ? { text: symbol.label_rw, voice } : null
  }
}
