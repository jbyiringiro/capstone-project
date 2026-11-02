import { useEffect, useState } from 'react'
import { api } from './api-client.js'

// Asks the Vuga API to text a code to a mobile number, and counts the seconds until another code
// may be asked for. `sentTo` is the number the last code went to.
export function usePhoneCode() {
  const [sentTo, setSentTo] = useState(null)
  const [resendAt, setResendAt] = useState(0), [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (resendAt <= Date.now()) return
    const timer = setInterval(() => {
      setNow(Date.now())
      if (Date.now() >= resendAt) clearInterval(timer)
    }, 500)
    return () => clearInterval(timer)
  }, [resendAt])
  async function send(phone, purpose) {
    const reply = await api.sendCode(phone, purpose)
    setSentTo(phone); setNow(Date.now()); setResendAt(Date.now() + reply.resend_after * 1000)
  }
  const forget = () => { setSentTo(null); setResendAt(0) }
  return { sentTo, send, forget, wait: Math.max(0, Math.ceil((resendAt - now) / 1000)) }
}
