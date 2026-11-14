## What changes

One or two sentences. Then the commits tell the rest.

## Why

The reason is not the diff. If this replaces an earlier decision, say which one and why now.

## How it is checked

- [ ] `make check` green (Python 69, contract 55, lint, hygiene) — tail pasted below
- [ ] New behaviour has a test, or the claim it supports has an artifact committed with it
- [ ] Numbers in docs/README match the run that produced them
- [ ] If RULES.md changed: that is its own PR, and this one links to it

```text
<paste the last lines of `make check`>
```

## What a reviewer should look at first

The one file where the risk lives, and the one line they would not think to check.

## No secrets, no personal paths

- [ ] No key, seed, token or `.env` value in the diff, the log or a screenshot
- [ ] No operator home directory or e-mail address in any artifact (`make hygiene` catches these)
