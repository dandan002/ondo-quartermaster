## What changes

<!-- One or two sentences on what this does and why. -->

## How it was tested

<!-- Which tests cover it; anything run by hand. -->

## Safety checklist

- [ ] Nothing that must hold (grants, exclusions, gates) moved into prompt text
- [ ] Any new tool declares its grant and goes through the effect gate if it can change something
- [ ] Untrusted content (files, pages, windows) is fenced and screened
- [ ] No secrets, keys or customer data in code, fixtures or logs
- [ ] If gate rules or decision fixtures changed, `agent/config/thresholds.json` was re-measured
