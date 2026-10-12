# Vuga design and interaction handoff

This handoff records the earlier illustrated design. The current app uses [licensed online pictures and separate parent access](../docs/licensed_images_parent_access_2026-10-10.md) with Kinyarwanda throughout; the original SVGs and silent sample preview remain historical import references. Current PIN screens and image licence records are in the working app, not in these older SVGs.

## Product intent

Help a learner choose symbols and communicate a message with a partner. Communication opens directly; there is no compulsory account, mascot welcome screen or reward sequence before the board. The proposed interface can be discussed during research, but school approval and the applicable university research process remain separate from design work.

## Screen flows

| Start | Action | Destination / response |
| --- | --- | --- |
| Board | Select a symbol | Append it to the message strip; keep the board order stable |
| Composing | Select another symbol | Append a chip; suggestions may change only in their separate area |
| Composing | Undo | Remove only the final symbol |
| Composing | Clear | Clear the message; do not silently change vocabulary |
| Board | Select a category | Change the symbol grid; preserve the composed message |
| Composing | Show | Display the current sequence at a larger size |
| Show | Back | Return with the same message |
| Composing | Speak without available audio | Preserve the message and offer Show |
| Board | Caregiver control | Current app: open first-use PIN setup or PIN unlock; child board remains available |
| Parent access | Valid confirmed setup or correct existing PIN | Open caregiver controls; PIN is never needed for child communication |
| Caregiver area | Return to child board, reload, background or five-minute inactivity | Lock parent access; returning without a reload preserves the child draft |
| Profiles | Add profile | Show the local profile form; no child account or password |
| Vocabulary | Enable/disable a symbol | Update the proposed board choices |
| Preferences | Motion off | Use instant state changes while keeping selection feedback |
| Summary | No activity yet | Explain the empty state; no fabricated chart or success metric |

The clickable preview demonstrates a bounded sample vocabulary and selected flows. It is not the production AAC engine. The static Figma screens illustrate states, not a working speech synthesiser or inference model.

## Figma prototype setup

Make the ready board the starting frame. Link the demonstration sequence through ready board, composed message, Show, and back. Link Speak to the audio-unavailable state. Link the caregiver control to profiles, then connect vocabulary, preferences and summary navigation. Add a separate phone starting frame so a desktop tablet frame is not scaled down to an unusable size.

For screen navigation, use **Instant** as the default. If testing gentle animation, use a short dissolve around 160 ms for overlays/chip appearance. Do not use Smart Animate to move or reorder the communication grid. A dedicated reduced-motion prototype should use Instant everywhere. The local HTML preview demonstrates motion, but these links and transitions must be created after SVG import.

## Reusable component inventory

| Component | Variants or properties |
| --- | --- |
| Symbol tile | Default, selected, keyboard focus; symbol, readable label, category accent |
| Category control | Default, current; icon and label |
| Message chip | Symbol and label; compact tablet / phone sizing |
| Action button | Primary, secondary, destructive, disabled; icon and label |
| Status label | Local/offline information; never colour alone |
| Preference control | On/off state with explicit text and visible focus |
| Profile card | Current / available; pseudonymous profile label |
| Dialog | Show message, audio unavailable, profile form |
| Empty panel | Empty vocabulary or no activity, with a relevant next action |

Use component instances for repeated elements after importing the SVG. Set content rows and columns to auto-layout; use fixed or minimum touch-target dimensions, and allow text to wrap. Do not infer that SVG groups already have those Figma behaviours.

## Motion specifications

| Interaction | Proposed duration | Behaviour with motion off |
| --- | --- | --- |
| Button press | 120 ms ease-out | Immediate fill/outline change |
| New message chip | 160 ms opacity | Immediate appearance |
| Dialog appearance | Up to 160 ms dissolve | Immediate appearance |
| Playback feedback in a future audio-ready implementation | Static status + Stop control | Same status and control |

No autonomous animation, flashing, confetti, audio rewards or disappearing feedback. Follow the operating system preference even if a caregiver has enabled gentle motion. Feedback must never delay the action or the next input.

## Implementation status — 10 October 2026

The original local preview remains a separate, session-only design demonstration with sample content. The working app now implements the visual direction and the changes below; see the [current implementation record](../docs/licensed_images_parent_access_2026-10-10.md) for technical verification. Importing these SVGs into Figma still requires the setup and review described above. The earlier prototype links go directly to profiles; when updating the design, add the current parent setup/unlock screens before caregiver destinations.

- **Draft retention:** the working app preserves the current composition during caregiver visits by keeping the board mounted while hidden. Changing profile or board mode resets the draft. Browser-reload draft recovery is not claimed.
- **After playback:** successful Kinyarwanda playback completes the message and returns to the core category. Stop/errors preserve the draft. The former English-demo option is removed. Playback alone does not establish language correctness or an understood exchange.
- **Language:** the working app now has Kinyarwanda-only interface copy, accessibility labels, validation/errors and speech. This earlier silent visual preview retains bilingual sample copy and is not the current language reference. Sequences such as `njye / gushaka / amazi` remain literal labels, not grammatically generated sentences. Labels need fluent-speaker review.
- **Symbols:** the working app replaces generated communication pictures with licensed online images stored locally for offline use. Source pages, authors, licences and hashes accompany the image assets. Preserve applicable attribution/licence conditions. Recognition still needs learner/caregiver review; use a learner's established symbol system when appropriate.
- **Parent access:** child communication opens directly. First-use **Umurezi** setup asks a parent to choose and confirm a four-to-six-digit PIN; later visits require it before profiles/settings/audio/export are mounted. **Kwinjira** changes the PIN after verifying the current one. Five failed attempts cause a persisted 30-second cooldown. Return/reload/background/five-minute inactivity lock the memory-only parent session. This local guard does not prove adult identity or protect against browser-storage access; no default PIN or child-facing reset is provided.
- **Preferences:** the working caregiver interface provides profile-scoped photo/pictogram, larger-tile and gentle-motion settings. These persist in device storage. System reduced-motion takes precedence over gentle motion.
- **Speech:** the working app bundles 181 synthetic Kinyarwanda clips from Meta AI MMS-TTS, with CC BY-NC 4.0 attribution/licence and a provenance manifest. Pronunciation is unreviewed. **Umurezi → Ijwi** manages local recordings and word/speaker tests. Saved recordings override installed/bundled speech; matching Kinyarwanda system voices are optional. English is never a fallback. Keep **Erekana** available; the separate design preview remains silent.
- **Measurement:** counts of taps or Speak events alone do not establish successful communication. No generated demonstration profile is a real participant.

## Review before use with intended learners

Review the target age group, device size and orientation, readable vocabulary labels, symbol recognition, number of visible choices, assistance needs, motion preference and access to refusal/help/pain messages. Do not equate a diagnosis with a particular grid size or access method. Confirm those needs with the school and relevant caregivers/professionals through the approved process.

## Import acceptance checks

After importing, compare each frame with its PNG reference. Check long labels, clipping, icon stroke widths, control spacing, focus contrast and phone scrolling. Confirm icons are vector layers, then create components and auto-layout. Test prototype navigation and reduced-motion alternatives. Imported Figma editability and prototype behaviour still require this check in the user's Figma account.
