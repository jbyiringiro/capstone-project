import { useEffect, useMemo, useState } from 'react'
import { liveQuery } from 'dexie'
import { listCustomSymbols } from '../storage/custom-symbols.js'
import { SymbolCatalogue, customBoardSymbol } from './catalogue.js'

// Keeps the catalogue in step with the custom-word store. One object URL per stored picture is
// created when the word appears and revoked when it is deleted or the app closes.
export function useSymbolCatalogue(bundled) {
  const [custom, setCustom] = useState([])
  useEffect(() => {
    const urls = new Map()
    const subscription = liveQuery(listCustomSymbols).subscribe({
      next: records => {
        const present = new Set(records.map(record => record.symbol_id))
        for (const [key, url] of urls) if (!present.has(key)) { URL.revokeObjectURL(url); urls.delete(key) }
        setCustom(records.map(record => {
          if (!urls.has(record.symbol_id)) urls.set(record.symbol_id, URL.createObjectURL(record.image))
          return customBoardSymbol(record, urls.get(record.symbol_id))
        }))
      },
      // The bundled board keeps working if the custom store cannot be read.
      error: () => setCustom([])
    })
    return () => {
      subscription.unsubscribe()
      for (const url of urls.values()) URL.revokeObjectURL(url)
    }
  }, [])
  return useMemo(() => new SymbolCatalogue(bundled, custom), [bundled, custom])
}
