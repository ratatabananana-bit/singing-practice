# Session handoff — Singing Practice app

Read this first in a new session. Spec: [APP_SPEC.md](APP_SPEC.md). Layout and run commands: [README.md](README.md).

## Where things are

- Repo: https://github.com/ratatabananana-bit/singing-practice (public, `master`). Git identity in this checkout: Blue <alexcwork2026@gmail.com>.
- GitHub auth: `gh` CLI is logged in as the WRONG account (mossbridgestudio). The right account (ratatabananana-bit) lives in Windows Git Credential Manager. Pushing with plain `git push` works. For `gh release …`, get a token with `printf 'protocol=https\nhost=github.com\n\n' | git credential-manager get` and export it as `GH_TOKEN` (never print it). GCM sometimes pops an account-picker window the user must click.
- Old copy at mossbridgestudio/singing-practice is private, user said leave it.
- Releases: v0.1.0 … v0.1.3, each with a signed APK. Latest APK also in the project root (`singing-practice-0.1.3.apk`, git-ignored).
- Signing: `android/keystore/release.jks` + `android/keystore.properties` (both git-ignored, must be backed up; losing them breaks updates). `npm run apk:release` → `android/app/build/outputs/apk/release/app-release.apk`. Needs JDK 21 at `%LOCALAPPDATA%\jdk-21` (pinned in `~/.gradle/gradle.properties`) and the Android SDK at `%LOCALAPPDATA%\Android\Sdk` (`android/local.properties`, forward slashes). Never run `cap sync` while Gradle is building (file locks).
- Release flow that worked: bump `versionCode`/`versionName` in `android/app/build.gradle` → `npm run build && npx cap sync android` → gradle `assembleRelease` (PowerShell, env ANDROID_HOME/JAVA_HOME) → `git tag vX.Y.Z && git push origin vX.Y.Z` → `gh release create vX.Y.Z <apk>`.
- Dev: `npm run dev` (5173), `npm run server` (yt-dlp helper, 5174), `npm run dev:https` for a phone over LAN. `?fakemic=261.63` or `?fakemic=file:/dev/voice.mp3` feed the pitch engine without a mic. `window.__dev` exposes stores/players in dev. Tests: `npm test` (56 pass).

## What the user wants (direction)

- Pure practice function + smooth UI. No progress tracking, history, streaks, stars, gamification (a history feature was built and reverted). Per-run / per-session feedback is fine.
- Phone layout is "perfect", do not change its sizes. Tablet is its own thing (currently: `@media (min-width: 600px)` → full width, `zoom: 1.2`, bigger keys, taller graphs). The user rejected a two-column tablet layout.
- Buttons must be tappable (36–44 px) without blowing up sections. Labelled buttons over cryptic glyphs. Line-style icons, not emoji (magnet for snap).
- Wants per-session results per exercise and per note (done: "This session" card under Exercise on Play).
- Terse replies ("caveman" mode was on in this session).

## OPEN BUGS reported from the user's Android tablet (not resolved, not reproducible on the PC)

The user is frustrated these keep not getting fixed. All three were observed on a tablet running the APK (screenshot 2000×1250 physical px, Samsung-style nav bar).

1. **Tablet mode not applied.** The app still rendered as a centred phone-width column. Hypothesis: the tablet's CSS width is below the breakpoint, or the user was still on an older APK. 0.1.3 lowered the breakpoint to 600 px and added Settings → Mic test, which prints `innerWidth×innerHeight css px · dpr` — ask for that line first. Fallback plan: detect tablet by `min(screen.width, screen.height) >= 600` or by `navigator.userAgent` / `window.screen` and apply the tablet class via JS instead of a media query; or drop the breakpoint to 500. Also consider that Android WebView `zoom` may behave differently than Chrome.
2. **"Could not decode "YouTube audio.m4a": Unable to decode audio data".** Diagnosis in 0.1.3: in the APK the helper URL was empty, so `/api/yt` went to Capacitor's internal server and returned index.html; the loader now requires Settings → YouTube helper = `http://<pc-ip>:5174` and rejects non-audio. Also `android.allowMixedContent: true` added (http helper from the https app origin). Helper now outputs MP3. NOT yet confirmed on the device. If still failing: check the helper is reachable from the tablet (`http://<pc-ip>:5174/api/health` in the tablet browser), Windows firewall for port 5174, and that the response Content-Type is `audio/mpeg`.
3. **Mic "doesn't work".** Screenshot showed the Studio pill as LIVE with level on the meter but no pitch. Unknown cause. 0.1.3 added Settings → Mic test (permission state, mic state, audio context state/rate, level vs silence gate, detected note/clarity). Ask the user to sing and report that panel. Candidates: Android WebView granting a silent/muted stream when RECORD_AUDIO isn't actually granted (check Permission row), the silence gate (−50 dB default) too high for a distant tablet mic (lower it in Settings → Tuner → Silence gate), AudioWorklet not running in the WebView (Audio row would say suspended), or the first-tap mic start racing with the permission dialog (retry via Mic test → Restart mic). Capacitor's `BridgeWebChromeClient` is supposed to forward `getUserMedia` permission requests to the Android runtime permission; verify the OS prompt appears at all.

## Verified vs not

- Verified on the PC (fake mic, browser pane, production build): everything in README. Pitch engine clean on a real voice sample file.
- Never verified: real microphone on any device, latency calibration, APK on the user's tablet beyond the screenshots above.

## Recent commits (newest first)

1e11495 YouTube in-app fix, 600 px tablet breakpoint, Mic test · 81053ee tablet full width + zoom · 7d63d0d phone sizes kept exact · 0de4272 keyboard squeeze fix · 5446a3d session results, readout fixes, MP3 helper · 305312d beat grid · 21be52e sections, YouTube import, mic toggle race fix · 4e63869 UX tap-target pass + DB v3 · 6ba59a8 revert of history feature.
