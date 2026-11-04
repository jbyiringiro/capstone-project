import './parent-access.css'

// Shown once, right after it is made: the code is never stored and cannot be shown again.
export default function RecoveryCode({ code, onDone, done = 'Nayanditse, komeza' }) {
  return <div className="parent-recovery">
    <p className="parent-eyebrow">Kode yo kugarura umubare w’ibanga</p>
    <p className="parent-recovery-code" aria-label={`Kode yo kugarura: ${code.split('').join(' ')}`}>{code}</p>
    <p>Iyandike ku rupapuro, uyibike ahantu umwana atayibona. Niwibagirwa umubare w’ibanga, iyi kode izagufasha gushyiraho undi utabuze amakuru y’abana. Ntizongera kugaragara.</p>
    <button type="button" className="button-primary parent-submit" onClick={onDone}>{done}</button>
  </div>
}
