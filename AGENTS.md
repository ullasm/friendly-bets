<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

<!-- BEGIN:commit-message-rules -->
# Commit Message Rule

After **every** code change, always append a section at the end of your response in this exact format:

```
📝 Suggested commit message:
<type>(<scope>): <short summary under 72 chars>
```

Where:
- `type` is one of: `feat`, `fix`, `refactor`, `chore`, `docs`, `style`, `test`
- `scope` is the file or feature affected (e.g. `auth`, `api/users`, `layout`)
- `summary` is a concise imperative-mood description in imperative mood (e.g. "add login form validation")

Examples:
```
📝 Suggested commit message:
feat(auth): add JWT refresh token support

📝 Suggested commit message:
fix(api/users): handle null response on profile fetch

📝 Suggested commit message:
refactor(layout): simplify header component structure

📝 Suggested commit message:
chore(deps): update next.js to latest version
```

Do this for every change, no matter how small. Never skip this step.
<!-- END:commit-message-rules -->

<!-- BEGIN:prompt-storage-rules -->
# Prompt Storage Rule

When the user asks to create, generate, save, store, or update a prompt, always create or update a file in `prompts/`.

Use this filename format unless the user explicitly requests a different one:
`prompt-YYYY-MM-DD.txt`

Use the current date for the filename.
Prefer saving the prompt in the repository over returning it only in chat.
<!-- END:prompt-storage-rules -->
