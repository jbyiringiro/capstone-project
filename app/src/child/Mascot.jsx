// Vuga's friendly character. It reacts to what the child does (speaking, cheering, thinking) so a
// tap feels answered even before the sound starts. Purely decorative for screen readers.
export default function Mascot({ mood = 'idle' }) {
  return <svg className={`mascot mascot--${mood}`} viewBox="0 0 120 120" width="88" height="88" aria-hidden="true">
    <ellipse className="mascot-shadow" cx="60" cy="112" rx="30" ry="5" />
    <g className="mascot-body">
      <path d="M60 14c26 0 44 20 44 46s-18 46-44 46-44-20-44-46 18-46 44-46z" fill="#176B62" />
      <path d="M60 30c18 0 30 13 30 31s-12 33-30 33-30-15-30-33 12-31 30-31z" fill="#2B8C80" />
      <path className="mascot-leaf" d="M58 15c-6-10-2-17 8-17-1 9-3 13-8 17z" fill="#8CC56A" />
      <circle cx="46" cy="54" r="9" fill="#fff" /><circle cx="74" cy="54" r="9" fill="#fff" />
      <circle className="mascot-eye" cx="47" cy="55" r="4.5" fill="#1D2B29" /><circle className="mascot-eye" cx="75" cy="55" r="4.5" fill="#1D2B29" />
      <circle cx="38" cy="70" r="5" fill="#F5A3A3" opacity=".7" /><circle cx="82" cy="70" r="5" fill="#F5A3A3" opacity=".7" />
      <path className="mascot-smile" d="M48 72c6 7 18 7 24 0" fill="none" stroke="#fff" strokeWidth="4" strokeLinecap="round" />
      <ellipse className="mascot-mouth" cx="60" cy="75" rx="8" ry="6" fill="#1D2B29" />
    </g>
  </svg>
}
