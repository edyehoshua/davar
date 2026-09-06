# Bani pronunciation policy and corpus audit

The English and Spanish schemas provide simplified reader guides, not IPA or a
complete reconstruction of Tiberian pronunciation. Consonantal gemination is not
doubled in this display style; a dagesh still controls plosive pronunciation and
keeps an attached medial sheva vocal. Long vowels are not marked with macrons.

Rules covered by regressions:

1. Initial sheva remains vocal (`וְ` → `ve`); it never borrows a vowel across a word boundary.
2. Final sheva closes the word (`מֶלֶךְ` → `melekh`).
3. A sheva after a short vowel closes that syllable (`מִקְוֶה` → `miqveh`, `אַנְתּוּן` → `antun`).
4. The first of two medial shevas closes the preceding short syllable; the second remains vocal.
5. Geminated sheva stays vocal (`אִגְּרָא` → `igera`).
6. Qamats qatan and reduced vowels are represented in both languages (`אׇהֳלָה` → `oholah`).
7. A pointed consonantal yod is not swallowed as a mater (`מַיִם` → `mayim`).
8. Medial he is emitted before its vowel (`אַבְרָהָם` → `avraham`), not reversed to `ah`.
9. Repeated vowels survive consonant deduplication. A terminal consonant is part of the preceding syllable, not a new syllable.
10. Word boundaries survive stress formatting. The explicit H6960 final stress is retained; `qaVAh` becomes `qaVAH` because final h belongs to the stressed syllable.

Sheva after a long vowel remains vocal (`אוֹרְחָה` → `orekhah`). Traditional
systems differ here; see the upstream [syllabification options](https://charlesloder.github.io/hebrew-transliteration/api/interfaces/sylopts/).
The default penultimate stress is a fallback, not a scholarly stress assertion.
Unmarked qamats is not automatically reclassified as qamats qatan.

## Reproduction

```bash
.venv/bin/python -m pytest tools/bani/tests tests -q
.venv/bin/python tools/bani/audit_phonology.py --output tools/bani/reports/phonology-en.json
.venv/bin/python tools/bani/audit_phonology.py --language es --output tools/bani/reports/phonology-es.json
.venv/bin/python scripts/dict/update_transliterations.py --bani
```

The last command explicitly regenerates display fields in individual lexicon
roots/words. It preserves other metadata and the H3068 suppression policy.
Without `--bani`, the existing fill-only workflow remains available. Bulk
lexicon output is not silently rewritten by the audit command.

## Results and limitations

The same corrected reference parser measures 7,910 multi-syllable entries:
English 19.1024% → 97.6738% (7,726 matches); Spanish 23.2491% → 98.0784%
(7,758 matches). Baselines use main's old engine and schemas, with the same
reference parser as the final audit. Earlier 18.59% / 85.35% intermediate
measurements used a parser that undercounted multiword Strong's references.

Reports contain every disagreement, including ab/avi, avraham, agmon, igera,
edrei, oholah, antun, elohim, ash/esh, miqveh/qavah, melekh, and yod/mater
families. This metric measures syllable counts only; it cannot certify every
consonant, vowel, stress, or family derivation. It does not use Strong's `pron`
to generate the output. Remaining disagreements are review material, including
reference-specific hiatus conventions. Monosyllabic/missing references are
explicitly excluded, not counted as successes. The regression suite preserves
known good yom/initial-sheva/miqveh forms and checks corrected Hebrew contexts.
