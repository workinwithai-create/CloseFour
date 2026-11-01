# CloseFour

Four-bar closing desk for bedroom producers and AI-music finishers.

Loops never end. Hooks slam and then nothing. CloseFour writes four live-instrument bars that resolve — cadence, soft land, final hit, ritard — so the track can finish.

Live chairs only: FluidR3 piano, nylon, upright, kit, violin (samples pinned from PreEight@d58301e4a494555f411a2afbc448b724136eee76).

Distinct from TagFour (last-line end tag), LiftTwo (pre-hook lift), PreEight, MelodyFour, RestFour, StackFour, LandFour, ModEight, AfterHook, EndEight, LastHook.

Live: https://closefour.vercel.app

## Pricing recommendation

One-time $19 on Gumroad (or $9 add-on inside Forge Pass $24/mo).
This is a desk, not a recurring studio.
Sell next to RealGrooves-style indie tools on Gumroad + a pinned X demo.

Free for personal use. Commercial export requires a license key (Gumroad / Lemon Squeezy) or WorkinWithAI entitlement. (License gate not yet wired; next milestone.)

## Status

- Source on GitHub
- Permanent live deployment (Vercel production)
- Lookahead scheduler on AudioContext clock; live changes apply on next step; stop silences immediately
- Grid-true WAV (OfflineAudioContext, exact length, folded tail, peak ≤ -1 dBFS) + multi-track MIDI of the added parts (each chair own track, tempo + 4/4). Reuses loaded samples. No random in export path.
- Samples pinned to commit SHA; missing instruments named in UI
- BPM 60–180 + key selector; settings persist in localStorage
- Mobile: AudioContext on first tap, iOS silent-switch note, visibilitychange stops cleanly

Remaining for full ship: real checkout + license delivery gate, full acceptance suite run on device, any final sample honesty checks.

## Acceptance notes

Scheduler uses lookahead on the AudioContext clock. Exports are grid-true OfflineAudioContext renders with folded tails. Samples pinned to commit SHA. Live changes apply on next step.
