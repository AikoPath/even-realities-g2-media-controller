# CLAUDE.md

## PR Creation

- This environment does NOT have GitHub API auth or `gh` CLI. Do not waste time trying API calls.
- To create a PR, build a GitHub compare URL with query parameters directly:
  `https://github.com/{owner}/{repo}/compare/{base}...{head}?expand=1&title=...&body=...`
- URL-encode the title and body, and include the description in the URL from the start.

## Git Workflow

- Always commit and push new or changed files immediately after creating/editing them. Do not wait for reminders or hooks.
- **ALWAYS** include a PR link immediately after every push. No exceptions. Do not wait to be asked.
