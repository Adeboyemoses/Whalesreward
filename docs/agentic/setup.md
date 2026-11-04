# One-time setup (Earl)

Do these once, in order, before the first Codex session. Steps marked **you** are yours by design: they involve accounts, credentials or repository settings that agents may not touch (soul.md T2/T3).

## 1. Check the product docs link

```bash
cd ~/DevApps/WhalesReward
ls product-docs/            # should list 01 Brief and Discovery … Technical Requirements
```

If it is missing: `bash scripts/link-product-docs.sh`.

## 2. Git and GitHub (**you**)

```bash
cd ~/DevApps/WhalesReward
git init -b staging        # already ran plain `git init`? fine: run `git branch -M staging` after the first commit
git config user.name "Olubukola Adeboye"
git config user.email "<your Cloudrock email>"
mkdir -p .github && cp -R docs/agentic/bootstrap/github/. .github/   # CI and PR template (remote tools can't write .github)
bash scripts/review/test-review.sh && bash .codex/hooks/test-guard.sh   # both must pass
git add AGENTS.md README.md STATUS.md .gitignore .codex .agents .github .review docs scripts
git commit -m "chore: Codex operating model and engineering guidelines"
```

- The repository is **public** under your **adeboyemoses** GitHub account (Earl's choice, 4 Nov 2026; branch protection on a private personal repo would need GitHub Pro) (suggested name `whales-rewards`). It moves to the client or an organisation at handover, under whatever source-ownership terms the contract sets. Add it as `origin` over **HTTPS** (`git remote add origin https://github.com/Adeboyemoses/Whalesreward.git`) and run `gh auth setup-git`: Codex runs commands without your shell's SSH agent, so SSH pushes would fail. Push `staging`, then create `main` from it: `git push -u origin staging && git push origin staging:main`.
- Set the default branch to `staging`.
- Branch protection on `staging`: require a PR and the status checks `gate-self-test`, `build`, `integration`, `e2e` and `review-evidence`; block force pushes; squash merges only.
- Branch protection on `main`: require a PR and the checks `gate-self-test`, `build`, `integration` and `e2e` (not `review-evidence`, which runs only on PRs into `staging`); no direct pushes, no force pushes; merge commits only. Codex opens the `staging` → `main` promotion PR and **you merge it yourself in GitHub**. (Codex works through your own `gh` login, so its PRs are authored by you and GitHub won't let you approve them; your own merge is the control.)
- Make sure `gh auth status` shows the adeboyemoses account.

## 3. Codex (**you**)

1. Open the folder in VS Code with the Codex extension (or run `codex` in the folder). When asked, **trust the project**. Without trust, Codex ignores `.codex/config.toml`, `.codex/agents/` and `.codex/hooks.json`.
2. Approve the hook: in the Codex CLI run `/hooks`, review `.codex/hooks/guard.sh` and trust it. The guard blocks secret reads, writes into `product-docs/`, `git add -A`, merges without `--match-head-commit`, and unapproved pushes to `main` or cloud changes.
3. Connect Linear so Codex can read and update work orders. Check the exact syntax with `codex mcp --help`; the expected form is:
   ```bash
   codex mcp add linear --url https://mcp.linear.app/mcp
   codex mcp login linear
   ```
4. Check that subagents load: ask Codex "List the custom agents you can spawn". You should see the eight agents in `.codex/agents/`. If the VS Code extension doesn't offer them, run sessions from the Codex CLI or app in this folder, or use the fallback in AGENTS.md (one thread per role).
5. **Auto mode is the project default:** `.codex/config.toml` keeps `workspace-write`, enables network access and uses `approval_policy = "never"`. Existing pnpm, Playwright and shared development cache directories are writable. `.codex/rules/default.rules` allows only the listed git, `gh pr`, `gh run`, `gh auth status` and `docker compose` prefixes outside the sandbox without command approval prompts. The guard hook still checks allowed commands; review evidence and branch protection still apply. Anything refused by the sandbox, rules or guard fails visibly instead of asking for approval. **T2 actions stay yours, run in your own terminal.** The rules forbid `gh api`, `gh repo`, `gh secret`, `gh ruleset`, `doctl` and `terraform` in Codex.
6. After this configuration merges, **pull staging in the main checkout and restart each terminal (`codex resume --last`)**. Project rules load at startup only for a trusted project. Initial project/hook trust and connector login remain setup steps; managed policies or launch overrides can take precedence over project defaults. This setting does not change an already running session.
7. Check product-docs access: ask Codex "Open product-docs/04 UI Design/Hi-Fi/Attendant/A02-Sale.png and describe it". A denied read fails visibly; report it to Earl rather than disabling the sandbox.

The rule syntax and startup behavior follow the [official Codex rules documentation](https://learn.chatgpt.com/docs/agent-configuration/rules). To verify the loaded file without executing the sample commands:

```bash
codex execpolicy check --pretty --rules .codex/rules/default.rules -- git commit -m test
codex execpolicy check --pretty --rules .codex/rules/default.rules -- gh api x
codex execpolicy check --pretty --rules .codex/rules/default.rules -- docker compose up
bash .codex/hooks/test-guard.sh
```

Expected decisions are `allow`, `forbidden`, and `allow`, respectively. Policy checks evaluate command matching; they do not prove a command ran or that a hook is trusted in a restarted terminal.

## 4. Local services

Install Docker Desktop, and Android platform tools (`adb`) for the M1 phone test.

WO-core-1 adds `docker-compose.yml` (Postgres, Mailpit, MinIO); after that, `docker compose up -d` starts everything the app needs locally.

## 5. Start a session

Prompt for the first session (paste into Codex):

```
You are the engineering manager for lane:core. Work order: WO-core-1 (Linear WHR). Follow AGENTS.md.
```

One lane per session. `lane:app` starts its first work order after WO-core-1 has merged the scaffold.

## 6. Ask Rook to check in

In Cowork, ask Rook for a Whales Rewards status check. Rook reads `STATUS.md`, the lane files and Linear, and updates your open-questions register.
