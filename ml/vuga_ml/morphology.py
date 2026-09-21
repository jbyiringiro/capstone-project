"""Rule-based generation of Kinyarwanda verb surface forms for the draft lexicon.

Purpose: Kinyarwanda inflection spreads one lemma over dozens of surface forms (subject prefix x
tense x polarity), so a hand-written lexicon of infinitives covers almost nothing in the corpus
(see docs/results_log.md, 21 Sept 2026). This module enumerates the regular, high-frequency forms
of a verb from its infinitive so that the two native-speaker collaborators review a pre-filled
draft instead of typing every form. Every generated row is tagged `generated:<paradigm>:<person>`
and must be accepted, corrected or removed in vocab/decision_log.md before results are reported.

Covered paradigms (regular verbs only)
  pres_ra   disjoint present, SP + -ra- + stem + a         ndashaka, arashaka, barakina
  pres      conjoint present, SP + stem + a                nshaka, ashaka, dukina
  neg_pres  negative present, nti-/si- + SP + stem + a     sinshaka, ntashaka, ntidukina
  fut       future, SP + -za- + stem + a                   nzashaka, azakina
  neg_fut   negative future                                sinzashaka, ntazakina
  imp       imperative singular / plural                   shaka, mushake

Not generated (irregular stem changes; left to the collaborators): perfective/recent past
(-ye forms such as nashatse), object-infix forms, relative forms, subjunctive.

Phonology implemented
  Dahl's law   ku-/tu- -> gu-/du- before a voiceless consonant (gukina, dukina; but kurya, turya)
  N-prefix     n + r -> nd, n + f -> mf, n + b -> mb, n + p -> mp, n + h -> mp, n + v -> mv,
               n + m/n -> n dropped (nmena -> mena is not standard; we emit 'mena' with note)
  glides       a + V -> y + V for i/e/u/o, u + V -> w + V, tu + V -> tw + V, mu + V -> mw + V,
               ba + V -> b + V (bumva), ra + V -> r + V (rumva), n + V -> n + V (numva)
"""
from __future__ import annotations

from dataclasses import dataclass

VOICELESS = ("k", "t", "s", "sh", "c", "f", "p", "h")
VOWELS = "aeiou"

SUBJECT = {  # person -> (prefix, symbol)
    "1sg": ("n", "I"),
    "2sg": ("u", "YOU"),
    "3sg": ("a", "HE_SHE"),
    "1pl": ("tu", "WE"),
    "2pl": ("mu", "YOU_PL"),
    "3pl": ("ba", "THEY"),
}


@dataclass(frozen=True)
class Form:
    surface: str
    paradigm: str
    person: str
    symbols: tuple[str, ...]
    negation: bool


def stem_of(infinitive: str, stem: str | None = None) -> str:
    """gushaka -> shaka, kurya -> rya, kwiga -> iga, kwandika -> andika.

    ku + u-initial stems are written 'ku' (kumva = ku + umva), which cannot be recovered from the
    spelling, so lemmas.csv may give the stem explicitly; it is used when provided.
    """
    if stem:
        return stem.lower().strip()
    inf = infinitive.lower().strip()
    for pre in ("kw", "gu", "ku"):
        if inf.startswith(pre):
            return inf[len(pre):]
    raise ValueError(f"not an infinitive: {infinitive!r}")


def _join_n(stem: str) -> str:
    """Attach the 1sg prefix n- to a consonant- or vowel-initial stem."""
    c = stem[0]
    if c in VOWELS:
        return "n" + stem
    if c == "r":
        return "nd" + stem[1:]
    if c in ("f", "p", "h"):
        return "m" + ("f" if c == "f" else "p") + stem[1:]
    if c == "b":
        return "mb" + stem[1:]
    if c == "v":
        return "mv" + stem[1:]
    if c in ("m", "n"):
        return stem  # n + mena -> mena (nasal absorbed)
    return "n" + stem


def _join_vowel_prefix(prefix: str, stem: str) -> str:
    """Attach a vowel-final prefix (a, u, tu, mu, ba, ra, za, nda, nza) to a stem, with glides."""
    if stem[0] not in VOWELS:
        return prefix + stem
    last, head = prefix[-1], prefix[:-1]
    if last == "a":
        if head == "":
            return "y" + stem             # a + iga -> yiga, a + umva -> yumva
        return head + stem                # ba/ra/za/nda/nza + iga -> biga, riga, ziga, ndiga, nziga
    if last == "u":
        return head + "w" + stem          # u + umva -> wumva, tu + iga -> twiga, mu + iga -> mwiga
    return prefix + stem


def _sp(person: str, stem: str, marker: str = "") -> str:
    """Subject prefix + optional tense marker + stem."""
    prefix, _ = SUBJECT[person]
    if marker:
        # marker follows the prefix: n + ra -> nda, tu + za -> tuza, etc.
        if prefix == "n":
            core = ("nd" + marker[1:]) if marker.startswith("r") else "n" + marker
            return _join_vowel_prefix(core, stem)
        return _join_vowel_prefix(prefix + marker, stem)
    # no marker: Dahl's law on tu-, nasal rules on n-
    if prefix == "n":
        return _join_n(stem)
    if prefix == "tu" and stem[0] not in VOWELS and (stem.startswith("sh") or stem[0] in VOICELESS):
        return _join_vowel_prefix("du", stem)
    return _join_vowel_prefix(prefix, stem)


def conjugate(infinitive: str, symbol: str, extra_symbols: tuple[str, ...] = (),
              stem: str | None = None) -> list[Form]:
    """Return the regular surface forms of `infinitive` mapped to person symbol + `symbol`."""
    stem = stem_of(infinitive, stem)
    forms: list[Form] = []
    tail = (symbol,) + tuple(extra_symbols)
    for person, (prefix, psym) in SUBJECT.items():
        forms.append(Form(_sp(person, stem, "ra"), "pres_ra", person, (psym,) + tail, False))
        forms.append(Form(_sp(person, stem), "pres", person, (psym,) + tail, False))
        forms.append(Form(_sp(person, stem, "za"), "fut", person, (psym,) + tail, False))
        # negatives: 1sg si + n-form ; others nti + (prefix + stem)
        if person == "1sg":
            neg_pres = "si" + _join_n(stem)
            neg_fut = "sin" + _join_vowel_prefix("za", stem)
        else:
            base = _sp(person, stem)
            # nti + u/a + C-stem -> ntu-/nta- (ntushaka, ntashaka); before a glide the i stays
            # (ntiwiga, ntiyiga); nti + tu/mu/ba -> ntidu-/ntimu-/ntiba-
            if prefix in ("u", "a"):
                neg_pres = ("nt" if stem[0] not in VOWELS else "nti") + base
                neg_fut = "nt" + _sp(person, stem, "za")   # -za- starts with a consonant: ntuzumva
            else:
                neg_pres = "nti" + base
                neg_fut = "nti" + _sp(person, stem, "za")
        forms.append(Form(neg_pres, "neg_pres", person, (psym, "NOT") + tail, True))
        forms.append(Form(neg_fut, "neg_fut", person, (psym, "NOT") + tail, True))
    # imperatives
    forms.append(Form(stem, "imp", "2sg", tail, False))
    if stem.endswith("a"):
        forms.append(Form(_join_vowel_prefix("mu", stem[:-1] + "e"), "imp", "2pl", tail, False))
    # deduplicate while keeping first paradigm
    seen: set[str] = set()
    out = []
    for f in forms:
        if f.surface not in seen:
            seen.add(f.surface)
            out.append(f)
    return out
