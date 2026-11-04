# Physical device testing

**Status: not run.** This is a procedure and results template, not evidence that any device passed. Test with the researcher's own devices and synthetic profiles such as `T-01`; do not use participant records, children's photographs or family recordings. These engineering checks do not replace native-speaker review or the approved usability study.

## 1. Record the build and devices

Use the same production build on both devices. Fill in the blanks before testing; duplicate the Apple column if testing both an iPhone and an iPad.

| Field | Android | iPhone / iPad |
|---|---|---|
| Test date, time and tester | Not recorded | Not recorded |
| Manufacturer and exact model | Not recorded | Not recorded |
| OS version; browser version | Not recorded | Not recorded |
| RAM, if known; otherwise “unknown” | Not recorded | Not recorded |
| Battery level; battery-saving mode; charging | Not recorded | Not recorded |
| Browser tab or installed home-screen app | Not recorded | Not recorded |
| Orientation; display/text scaling; browser zoom | Not recorded | Not recorded |
| HTTPS URL | Not recorded | Not recorded |
| Commit SHA; clean/dirty worktree | Not recorded | Not recorded |
| Build time; build snapshot/archive name or deployment ID | Not recorded | Not recorded |
| Grid size; suggestions; sentence speech; speak-on-tap settings | Not recorded | Not recorded |

From the repository root, `git rev-parse HEAD` and `git status --short` identify the revision and uncommitted changes. A commit SHA alone does not identify a dirty build: retain the exact source or production-build snapshot locally and record its filename and SHA-256 if available. Do not publish a source snapshot containing local databases, secrets or participant files. Avoid rebuilding or editing the served app between the two device runs; if it changes, start a new result set.

## 2. Open the production build over HTTPS

**Hosted test URL:** [https://vuga-app.onrender.com](https://vuga-app.onrender.com). Use this URL directly on both devices and continue at step 4; steps 1-3 are only needed for a local preview. The hosted app and API run independently of the development computer.

1. On the computer, from `app/`, run `npm.cmd run build`, then `npm.cmd run preview -- --port 4187` (use `npm` on other shells). This test preview listens on `http://127.0.0.1:4187`; if it is already running, keep that terminal open instead of starting another copy.
2. Use the prepared temporary HTTPS tunnel to that preview, or serve `app/dist/` at the root of an HTTPS static host. Once a temporary public link is authorised, the prepared helper can be started from the `CAPSTONE` folder in a second PowerShell terminal with `.\.device-tools\cloudflared.exe tunnel --url http://127.0.0.1:4187 --http-host-header localhost:4187`. Open the printed **HTTPS address** on the devices. Plain `http://192.168…` is not suitable for validating service workers or microphone access. The offline board needs no API.
3. With a tunnel, keep the computer awake, the preview and tunnel processes running, and its internet connected while preparing the devices. Keep the **same URL** throughout a run; a replacement tunnel hostname is a different origin with separate stored data.
4. On Android, open the URL in Chrome and use its menu to install the app. Current Chrome calls this **Install and create shortcut → Install**; older versions may say **Install app** or **Add to Home screen**. Record whether it actually launches as a standalone app. [Google's installation instructions](https://support.google.com/chrome/answer/9658361?hl=en&co=GENIE.Platform%3DAndroid).
5. On iPhone/iPad, open the URL in Safari, use **Share → Add to Home Screen** (possibly under **More/View More**), enable **Open as Web App** if offered, then add it. Launch the new icon while still online. [Apple's iPhone instructions](https://support.apple.com/guide/iphone/iphea86e5236/ios), [iPad instructions](https://support.apple.com/guide/ipad/ipad8f1f7a29/ipados).
6. In the installed app, keep it open online for at least 1–2 minutes initially, allowing longer on a slow connection. Open several sections, tap pictures, speak a short message, then close and reopen it online. Vuga has **no cache-ready confirmation**: elapsed time or a visible board does not prove all assets are cached. The offline cold-start check below is the test.
7. Hold **Umurezi** to open caregiver access. For these local checks choose **Komeza nta nimero**, set a test PIN, and keep the recovery code privately. In **Abana**, create/select a synthetic profile such as `T-01`. Do not record the PIN or recovery code in screenshots.

Browser tabs and installed apps may have separate storage. Prepare and test each context independently if reporting both. Do not uninstall the app or clear its website data during persistence tests.

## 3. Run the same checks on each device

Use **Pass / Fail / Partial / Not run**. A pass needs an actual observation. For each result include a brief observation and an evidence filename, such as `docs/evidence/physical/<date>/android-offline.mp4`; this is a suggested location, not an existing file. Save only captures containing test data.

| ID | Procedure and expected observation | Android result | Android evidence | Apple result | Apple evidence |
|---|---|---|---|---|---|
| D01 | Open online in the browser, install, and launch from the home screen. Pictures and controls load; note missing install options, icons or browser chrome. | Not run | — | Not run | — |
| D02 | Turn on airplane mode **and explicitly turn Wi-Fi and mobile data off**. Close Vuga from recent apps/app switcher, then launch its icon again. The board loads without a connection. Capture the network state and fresh launch. | Not run | — | Not run | — |
| D03 | Still offline, open several sections and pages, including ones not manually visited online. Select pictures, see suggestions, use **Erekana**, and speak a short message. Images, model and bundled speech work offline. | Not run | — | Not run | — |
| D04 | Tap several pictures, remove the last one, clear the message, use page buttons and enabled horizontal swipes. Rotate portrait/landscape. Controls remain reachable; swipes do not accidentally select a picture; no unexpected loss or duplicate selection. Record grid size and orientation. | Not run | — | Not run | — |
| D05 | Check a single word and `njye + gushaka + amazi` with sentence speech enabled. Confirm audible playback and visible message. On an empty message, **Vuga** is disabled. Tap quickly, then press **Vuga** twice and use **Hagarika** while speech is playing: no overlapping message playback or stuck controls; cancellation lets you continue. Record any first-play delay separately from later plays. | Not run | — | Not run | — |
| D06 | In **Umurezi → Ijwi**, choose a bundled word and **Fata ijwi**. First deny microphone permission: an understandable error appears and the app remains usable. Then allow permission in the browser/app's site settings and retry; record the researcher saying only that word, preview it and select **Bika ijwi**. Confirm playback and offline persistence after a cold reopen. Note if permission recovery requires relaunch. | Not run | — | Not run | — |
| D07 | Enter a wrong test PIN once, then the correct PIN. In **Ikibaho**, change a grid or label setting; return to the board, background/reopen, then cold reopen offline. Caregiver access relocks, the correct PIN works offline, and the selected profile/settings persist. This does not promise recovery of an unfinished message draft. | Not run | — | Not run | — |
| D08 | Measure the smallest picture keys in portrait and landscape with a ruler (section 5). Test both the intended study grid and **Byikora** if claiming both. Record actual width/height and any clipped controls. | Not run | — | Not run | — |
| D09 | Run the prediction benchmark three times, recording every displayed median, p95 and sample count (section 4). | Not run | — | Not run | — |
| D10 | Optional: in **Ohereza**, export completed synthetic messages and confirm the file can be saved/opened on this OS. Record the file type and any download/share limitation; do not export participant data. | Not run | — | Not run | — |

For a failed offline launch, preserve that result. Reconnect to the same URL, allow caching to finish and retry as a **separate retest**. Keep recordings from D06 limited to this test; they override that word on the device, so delete the test recording afterwards if restoring the original voice is needed.

## 4. Measure prediction on the physical hardware

Hold **Umurezi → Ikibaho**, expand **Umuvuduko wo gutanga amagambo afasha**, and press **Pima umuvuduko**. Wait for the result and take a screenshot **after** each run. Run three times in the same app context and network state, without screen recording or another heavy task during measurement.

| Device/context | Network | Run | Samples shown | Median (ms) | p95 (ms) | Evidence | Status |
|---|---|---|---|---|---|---|---|
| Android | Not recorded | 1 | — | — | — | — | Not run |
| Android | Not recorded | 2 | — | — | — | — | Not run |
| Android | Not recorded | 3 | — | — | — | — | Not run |
| iPhone/iPad | Not recorded | 1 | — | — | — | — | Not run |
| iPhone/iPad | Not recorded | 2 | — | — | — | — | Not run |
| iPhone/iPad | Not recorded | 3 | — | — | — | — | Not run |

The current [benchmark](../app/src/prediction/bench.js) times the base predictor's `topK` calls: 20 warm-ups, then 300 calls cycling through five prefixes from [App.jsx](../app/src/App.jsx). The median is the middle call time; p95 is the approximate time below which 95% of calls fall. Compare each run's p95 with the proposal's **200 ms prediction budget**. Preserve all three results; do not call an average of three p95 values a pooled p95. A rounded zero means below the timer's resolution, not instantaneous execution.

This measures prediction computation on real hardware. It does **not** measure the personal re-ranker, tap-to-render delay, FPS, audio start, or cold startup. Qualitative “felt responsive” observations are useful but are not numeric latency evidence. Do not copy emulated laptop metrics into the physical-device table.

## 5. Measure touch targets and assess speech

With a ruler against the screen, measure the **visible key's width and height**, excluding the gap between keys. Record the smallest measured key for each orientation/grid. The proposal requires at least **2.0 cm in each dimension**; CSS pixels alone do not establish physical size. Photograph the ruler and screen without covering the measured edges. Also note browser zoom, OS display scaling and whether a display cutout hides controls.

| Device/context | Grid; orientation; scaling | Smallest width × height (cm) | Meets 2 × 2 cm? | Evidence |
|---|---|---|---|---|
| Android | Not recorded | — | Not run | — |
| Android | Not recorded | — | Not run | — |
| iPhone/iPad | Not recorded | — | Not run | — |
| iPhone/iPad | Not recorded | — | Not run | — |

The proposal's speech-start budget is **300 ms after pressing Vuga**. Listening establishes that speech is audible, not that it meets this timing target. If measuring it, use an external audiovisual recording that captures the finger press and the device's first audible sound; record frame rate, how the press/audio onset were identified, and measurement uncertainty. Test first playback after reopening and repeated playback separately, with the built-in speaker and a fixed volume. A handheld stopwatch or a screen recording that misses device audio cannot establish a sub-300 ms pass. Otherwise report **“audible playback checked; physical speech latency not measured.”** Pronunciation correctness remains for native-speaker review.

## 6. Optional server checks and final record

**API/SMS device checks: not run.** The hosted API is `https://vuga-api.onrender.com`; browser CORS and live SMS setup remain pending (see [hosting status](hosting.md)). Complete that configuration before testing sign-in, real SMS delivery, PIN reset/session revocation, sync and backup conflict handling on the two devices. Record these separately; offline local tests do not validate them.

| Defect | Device / check | Steps and actual result | Expected result | Evidence | Fix/build | Retest date and result |
|---|---|---|---|---|---|---|
| No defects recorded yet; tests not run | — | — | — | — | — | — |

When completed, add observed results and evidence to the testing report. State exact models/OS/browser versions, which checks passed/failed/remain untested, the three benchmark runs, measured key sizes, limitations and any fixes/retests. Android versus Apple provides physical compatibility evidence; it is not automatically a low-end versus high-end hardware comparison. Neither these checks nor the existing automated tests establish participant usability or clinical benefit.
