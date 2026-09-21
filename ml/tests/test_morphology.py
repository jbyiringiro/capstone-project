from vuga_ml.morphology import conjugate, stem_of


def surfaces(inf, stem=None):
    return {f.surface: f for f in conjugate(inf, "X", stem=stem)}


def test_stems():
    assert stem_of("gushaka") == "shaka" and stem_of("kurya") == "rya"
    assert stem_of("kwiga") == "iga" and stem_of("kumva", "umva") == "umva"


def test_regular_consonant_stem():
    s = surfaces("gushaka")
    for form in ["ndashaka", "nshaka", "sinshaka", "nzashaka", "urashaka", "ntushaka", "arashaka",
                 "ntashaka", "turashaka", "dushaka", "ntidushaka", "barashaka", "ntibashaka", "shaka", "mushake"]:
        assert form in s, form
    assert s["sinshaka"].negation and s["sinshaka"].symbols == ("I", "NOT", "X")
    assert s["barashaka"].symbols == ("THEY", "X")


def test_nasal_and_dahl_rules():
    assert "mfasha" in surfaces("gufasha") and "dufasha" in surfaces("gufasha")
    assert "mbona" in surfaces("kubona")
    assert "ndya" in surfaces("kurya") and "turya" in surfaces("kurya")
    assert "mpa" in surfaces("guha")


def test_vowel_stems_glide():
    s = surfaces("kumva", "umva")
    for form in ["ndumva", "numva", "wumva", "yumva", "twumva", "mwumva", "bumva", "ntiyumva", "ntuzumva"]:
        assert form in s, form
    t = surfaces("kwiga")
    for form in ["ndiga", "niga", "wiga", "yiga", "twiga", "biga", "ntiwiga", "nziga"]:
        assert form in t, form
