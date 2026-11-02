
export const clearValidation = event => event.currentTarget.setCustomValidity('')
export const requiredCode = event => event.currentTarget.setCustomValidity('Andika inyuguti imwe, akanyerezo n’imibare ibiri cyangwa itatu, urugero: P-01.')
export const requiredName = event => event.currentTarget.setCustomValidity('Andika izina cyangwa kode y’umwana, nka Keza cyangwa P-01.')

export function Heading({ eyebrow, title, children }) {
  return <div className="dash-heading"><div><p className="dash-eyebrow">{eyebrow}</p><h1>{title}</h1><p>{children}</p></div></div>
}

export function Setting({ id, title, children, checked, disabled, onChange }) {
  return <div className="dash-setting"><div className="dash-setting-copy"><b id={`${id}-label`}>{title}</b><p id={`${id}-description`}>{children}</p></div><label className="dash-switch"><input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={e => onChange(e.target.checked)} aria-labelledby={`${id}-label`} aria-describedby={`${id}-description`} /><span /></label></div>
}
