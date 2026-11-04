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
5. Codex's sandbox may treat `.git` as read-only and ask before `git commit` or `git worktree add`. When it asks, approve that command for the session ("don't ask again") rather than switching to full access.
6. Check product-docs access: ask Codex "Open product-docs/04 UI Design/Hi-Fi/Attendant/A02-Sale.png and describe it". If the sandbox refuses the read, approve it when prompted and tell Rook so the setup notes can be corrected.

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
