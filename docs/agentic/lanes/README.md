# Lane files

One file per lane: [core.md](core.md) and [app.md](app.md). The session working a lane reads its file at start and **overwrites** it at close (3 KB at most). History lives in git, PR bodies and Linear comments, so these files hold only the current state.

Format:

```
# lane:<name>
WO-<lane>-<n> (WHR-<id>) <title>: <BUILD|READY|FIX|ACCEPTED> since <YYYY-MM-DD>

## In flight
- <PR link> <one line>

## Next
- WHR-<id> <one line>

## Earl's gos
- <YYYY-MM-DD> "<his words>" — PR #<n> (staging → main)

## Risks
- <one line each>

dispatches=N prs=M rounds_max=R escalations=E model=<the session's full model ID>
```

The metric line is always last. Rook compares first-pass merge rates by model from it.
