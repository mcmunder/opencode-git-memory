---
"@mcmunder/opencode-git-memory": patch
---

fix: add `main` field and relax peer dependency for plugin loading compatibility

All other OpenCode plugins use the `main` field for entry point resolution. Our plugin only had `exports`, which OpenCode's plugin loader may not resolve. Also relaxed `peerDependencies` from an exact pin (`1.2.27`) to `>=1.1.0` to match the convention used by other plugins and avoid conflicts with the SDK version shipped by OpenCode.
