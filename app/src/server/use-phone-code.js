import { useEffect, useState } from 'react'
import { api } from './api-client.js'

// What to tell the caregiver once the server took a code: a text on its way to their phone, or,
// on a test server, a code that went to the SMS provider's simulator or to the server's log and
// will never reach a phone. `where` is the number as the caregiver should see it.
export function codeSentText(delivery, where) {
  if (delivery === 'simulator') return `Kode yoherejwe kuri simulator ya Africa’s Talking (igerageza): ntizagera kuri telefoni ${where}. Imara iminota 10.`
  if (delivery === 'log') return 'Kode yanditswe mu bubiko bwa seriveri ya Vuga y’igerageza: ntizagera kuri telefoni. Imara iminota 10.'
  return `Twohereje kode y’imibare 6 kuri ${where}. Imara iminota 10. Niba SMS itaje mu minota mike, saba indi kode.`
}

// Asks the Vuga API to text a code to a mobile number, and counts the seconds until another code
// may be asked for. `sentTo` is the number the last code went to, and `delivery` where it went.
export function usePhoneCode() {
  const [sentTo, setSentTo] = useState(null), [delivery, setDelivery] = useState(null)
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
    setSentTo(phone); setDelivery(reply.delivery ?? 'sms'); setNow(Date.now()); setResendAt(Date.now() + reply.resend_after * 1000)
  }
  const forget = () => { setSentTo(null); setDelivery(null); setResendAt(0) }
  return { sentTo, delivery, send, forget, wait: Math.max(0, Math.ceil((resendAt - now) / 1000)) }
}
