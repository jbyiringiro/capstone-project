# Vuga — local design pack

**Historical design reference.** The current app uses a fully Kinyarwanda interface, licensed online communication pictures, and separate child and parent access. See the [current implementation and screenshots](../docs/licensed_images_parent_access_2026-10-10.md). This pack preserves the earlier illustrated SVGs and silent sample preview for design history and local Figma import. It does not include the current PIN screens or licensed image set; use the working app as the reference for those changes.

This is a proposed visual redesign of the Vuga communication app, prepared for review before a school visit. The colours, symbol style, language, layout and motion still need feedback from learners, caregivers and staff. It is not a validated AAC intervention or a finished production app.

## Open the design

- Double-click `preview.html` to try the interactive design locally. Keep its CSS, JavaScript and `icons.js` beside it. No server or internet connection is required.
- Open `foundations.html` for the colour palette, typography, component states and motion specifications.
- `figma-import/` contains the SVG screens to import into Figma.
- `previews/` contains PNG reference images. Use SVGs for design editing; PNGs are visual references.

The preview is separate from the working app in `vuga-aac/app`. It does not read its profiles, call its API, or collect research data. Example profiles and selected words are demonstration content. Edits in the preview last only for the current page session and reset when reloaded. The preview does not generate speech; its suggestions are authored examples, not model output.

## Included screens

The import folder contains **12 tablet states**, **3 phone views**, and **1 foundations sheet**, plus a combined overview.

Tablet states: ready board; composing a message; food and drink; feelings; Show message; audio unavailable; empty vocabulary; caregiver profiles; add profile; vocabulary editor; board preferences; empty local summary.

Phone views: ready board, composing a message, and caregiver profiles. The browser preview also adapts the other routes to a narrow viewport.

The icon library in `assets/icons/` has **25 original SVG illustrations**. `assets/icons-contact-sheet.svg` provides them together for import and review.

## Import into Figma web

1. Create or open a **Figma Design** file, and open its canvas.
2. Drag the SVG files from `figma-import/` onto that canvas. For a quick overview, import `all-screens.svg`; for work at full size, import the individual screens instead.
3. Keep one top-level frame per screen. Arrange tablet screens together, phone screens together, and foundations on a separate page if desired.
4. Check fonts and line breaks. The design uses **Segoe UI**, matching the existing Windows app preview. Install/enable this font for Figma or deliberately select a replacement, then recheck all labels.
5. Create reusable Figma components from the tile, category tab, message chip and action-button examples. Add auto-layout where needed and connect the prototype according to `HANDOFF.md`.

Figma imports SVGs as vector content rather than flat images. The files contain real SVG shapes, icon paths and text elements. Text treatment can vary with Figma's importer and font availability. Imports have **not been tested inside Figma** in this session: the account connection required reauthentication, and you chose a local deliverable.

SVG does not preserve HTML behaviour, Figma component relationships, auto-layout constraints, variables or prototype connections. The animated/clickable experience is in `preview.html`; use the interaction specifications to recreate it in Figma. This pack does not contain a native `.fig` file.

See [Figma's import guidance](https://help.figma.com/hc/en-us/articles/360040028034-Add-images-and-videos-to-designs) for supported imports.

## Design direction

- Cream background, dark readable labels, teal primary actions and restrained pastel accents.
- Large illustrated communication tiles, consistent control positions and a separate suggestion area.
- A small decorative leaf mascot; it never acts as a reward or distracts from a symbol choice.
- Tablet layouts plus phone adaptations with fewer columns.
- Brief interaction feedback and a reduced-motion preference. No looping mascot or background animation.
- Caregiver controls are visually separate from the communication experience.

The custom illustrations are **unreviewed design symbols**. Do not automatically replace a learner's familiar symbol set. The palette is a visual proposal, not an asserted AAC category standard.

## Evidence and boundaries

The working app has a board, literal symbol sequence, real suggestions, visual message display, profiles/vocabulary, summaries and optional server sync. It now uses Kinyarwanda throughout its interface and speech, including 181 bundled synthetic clips generated with Meta AI MMS-TTS under CC BY-NC 4.0. **Umurezi → Ijwi** provides word/speaker tests and local recording management. Pronunciation and labels still need fluent-speaker review; no installed system voice is assumed. This earlier design preview remains silent with bilingual sample copy: it is a visual reference, superseded by the current app for language and speech behavior.

As of 10 October 2026, the working app implements the visual direction, profile-scoped picture/tile-size/motion settings, and draft retention during caregiver visits. Licensed online images are bundled locally with source, author, licence and hash records. **Umurezi** now requires a parent-chosen PIN before opening caregiver controls; **Kwinjira** changes that PIN. Returning to the child board, reloading, backgrounding or five minutes without input locks parent access. Child communication needs no PIN, including before first parent setup. Changing profile or board mode still resets the draft; browser-reload draft recovery is not claimed. See the [current implementation record](../docs/licensed_images_parent_access_2026-10-10.md) for verification. This local preview remains separate and session-only. There are no measured learner outcomes, clinical claims or invented usage statistics in this pack.

Motion preferences follow the intent of [W3C's guidance on animation from interactions](https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html). Vocabulary, language, symbol choice and access should be individualised with appropriate partners, consistent with [ASHA's AAC guidance](https://www.asha.org/practice-portal/professional-issues/augmentative-and-alternative-communication/). These references inform design choices; they do not certify this design.

## Files for continued editing

`preview.html`, `preview.css`, `preview.js`, `icons.js`, and `foundations.html` are the editable local sources. `export-design.mjs` regenerates the import assets using Playwright from the existing Vuga development environment. `design-snapshot.json`, when generated, records the exported layout geometry for further tooling; it is not a native Figma file.
