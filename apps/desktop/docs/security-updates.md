# Desktop security update policy

Every packaged launch checks `<UPDATE_SERVER_URL base>/security-policy.json` before opening business windows. This is independent of the OTA channel eligibility, first-launch marker, rollout percentage, and automatic-update preference. Stable installers skip the initial OTA gate; Canary and Beta installers keep it.

The endpoint is independent of versioned Core feeds so one policy can cover existing installers. The client accepts a strict schema, a maximum 1 MiB response, and an Ed25519 signature verified with the packaged OTA public key. The request times out after five seconds. No publication workflow is included yet.

```json
{
  "kind": "desktop-security-policy",
  "schemaVersion": 1,
  "revision": 1,
  "rules": [
    {
      "channel": "stable",
      "platforms": ["darwin", "win32", "linux"],
      "target": "shell",
      "affectedVersions": ">=2.2.0 <2.2.20",
      "minimumInstallerVersion": "2.2.20"
    },
    {
      "channel": "canary",
      "platforms": ["darwin"],
      "target": "core",
      "affectedVersions": "2.2.20-canary.3",
      "minimumInstallerVersion": "2.2.20-canary.4"
    }
  ],
  "signature": "<base64 Ed25519 signature>"
}
```

Sign the canonical JSON of all fields except `signature`, using the same recursive sorted-key canonicalization as the Core manifest (`coreOta/manifest.ts`). `kind` separates the policy from an OTA manifest. Increment `revision` for every policy change, including revocation; an empty `rules` array with a newer revision clears restrictions. Publish the complete rule set each time. Lower or equal revisions cannot replace a verified local policy.

`channel` refers to the installer build channel, not a user-selected update preference. `target: shell` matches the installed full-package version. `target: core` matches the active Core version. `affectedVersions` uses npm SemVer ranges with prereleases included; an exact version is also valid. Rules are limited to the listed platforms. Overlapping rules all apply.

An affected installation opens the shell-owned required-update window, offering Retry or Quit on failure. It fetches a full installer from its build channel (Beta uses the Canary installer feed), using Sparkle on macOS and electron-updater elsewhere. The available installer must meet every matched rule's minimum version and must not match any affected range for this channel/platform. Publish a usable fixed installer before publishing a restriction. A full installer is expected to ship a Core at that same version; the next startup evaluates the actual installed Shell and Core again.

Verified policies are persisted atomically in `security-update-policy.json` under userData. A failed request, invalid signature, missing endpoint, or older response retains the previous verified policy. A known vulnerable version remains blocked offline. Without any verified policy, unavailable policy service does not block ordinary startup. This is operational update enforcement, not protection against a user who deliberately modifies their local installation/cache.

## Current delivery boundary

- Requires a new full installer containing this startup gate; older clients cannot learn this behavior through a policy file alone.
- Checks run at startup. Already-running clients do not immediately react to a newly published policy.
- Remote publishing, authorization and operator tooling are intentionally deferred.
- First-launch Core OTA continues to use the existing signed feed and offline-first behavior. Security restrictions always take precedence.
