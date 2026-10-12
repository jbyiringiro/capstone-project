# Licensed online communication photographs

These photographs replace the earlier generated images. Each vocabulary entry has an original title, creator, source-page URL, download URL, reuse licence/link, retrieval date and source/runtime hashes in the [manifest](manifest.json). The [credits page](credits.html) supplies attribution for every card and is available offline after the app has cached. Individual image licences apply to these assets; the repository's MIT code licence does not replace them.

The sources were selected from online photographic collections with explicit reuse permissions. Public-domain and Creative Commons images retain their recorded status; attribution and ShareAlike obligations apply where recorded. Related abstract words sometimes share a context photo, with notes in the manifest. Photographs depicting people do not identify them as disabled, as Vuga users or as project participants.

The app serves local 480 × 480 WebPs, with the complete source image fitted onto a cream canvas. Changes are limited to resizing, padding and format conversion; no generative editing or cropping is used. The originals stay in `design/licensed-photo-sources/` outside the app and repository. Earlier generated originals remain historical design working files and are no longer runtime inputs.

The same picture appears on cards, category shortcuts, suggestions, composed messages and parent views. **Umurezi → Ikibaho → Amafoto afatika** switches a profile to the existing ARASAAC pictograms, which have their own attribution and noncommercial licence. A missing photo also falls back automatically. The vocabulary labels and Kinyarwanda audio remain unchanged.

To prepare the reviewed originals again from `vuga-aac`, using Python with Pillow installed:

```powershell
.venv\Scripts\python.exe scripts/prepare_licensed_photos.py
```

If originals are absent, add `--download`. This restores the pinned source URLs from the manifest and refuses files whose hashes differ. All 181 sources, licences and hashes must be present before the script replaces runtime images. `app/scripts/prepare-photos.mjs` is a compatibility entry point for this same importer.

Parents and teachers still need to review meaning with each learner, particularly pronouns, time, questions and emotions. Source licensing and image decoding do not establish child comprehension or clinical benefit.
