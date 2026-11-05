# CI PNG round-trip correction

PR #98 initial CI run 41773688796 failed only the WebKit 1/2 shard: `avatars.spec.ts`, exported-pixel SHA assertion, at line 44. Both attempts produced the same mismatch; dimensions and the sampled solid pixel matched. All other CI jobs passed.

An isolated Linux/amd64 Playwright 1.64.0 Noble container reproduced pixel changes without loading the app: drawing a fractional crop, reading its raw canvas pixels, encoding that same canvas to PNG, decoding it and reading pixels again changed 110–162 channels, each by one level. See `ci-png-roundtrip.json`. This establishes that the original test compared different stages of the PNG pipeline.

The expected crop now passes through PNG encoding and decoding before its SHA-256 is compared with the downloaded PNG's decoded pixels. Geometry, dimensions, sampled pixel, full-image exact equality, save/retry, persistence, replacement, removal and authorization assertions remain. No tolerance, platform skip, retry increase or application change was introduced.

Local verification: the corrected complete flow passed three repetitions in each macOS browser engine (six cases). The Linux app-level before/after comparison and updated GitHub checks are tracked in the PR.
