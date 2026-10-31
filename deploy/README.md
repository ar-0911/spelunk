# Hosting Spelunk for other people

`spelunk serve` runs the dashboard as a public website. Visitors paste a link to a public repository and get the same map, Find, Trace, Risks, First day and Error lookup as `spelunk ui`. Ask and Explain with Claude work with the Anthropic API key each visitor pastes.

What it does differently from `spelunk ui`, so it's safe on the open internet:

- **Public repositories only.** Links must be `https://` on an allowed host (GitHub, GitLab and Bitbucket by default). It takes no access tokens, and it ignores `GITHUB_TOKEN` and the other git tokens in its environment, so it can't read private code by accident.
- **No local files.** The folder picker, Braid and publishing to Elemnt are switched off.
- **Visitors bring their own Claude key.** `ANTHROPIC_API_KEY` is ignored, so strangers can't spend your credit. A pasted key stays in memory for that visitor's session only and is never written to disk or logs.
- **One session per browser**, in an HttpOnly cookie. Everyone who opens the same repository shares one download and one scan of it.
- **Remote MCP at `/mcp`**, for claude.ai and Claude Code: the same public-only rules, no sign-in, nothing kept per caller. Each tool call names the repository. See [Claude on the web](../README.md#with-claude-on-the-web-claudeai).
- **Limits.** Two downloads or scans run at once (the rest wait), each address may start 20 downloads an hour, git gets 3 minutes per download, and the 30 most recently opened repositories are kept on disk.

## Try it locally

```sh
pnpm build
node dist/cli.js serve --port 8080      # then open http://localhost:8080
```

Or with Docker:

```sh
docker build -t spelunk .
docker run --rm -p 8080:8080 spelunk
```

## Cloudflare

Runs on [Cloudflare Containers](https://developers.cloudflare.com/containers/), which need the **Workers Paid** plan ($5 a month). Docker must be running on the machine you deploy from, because wrangler builds the image locally.

```sh
cd deploy/cloudflare
npm install
npx wrangler login
npx wrangler deploy
npx wrangler tail        # logs, in another terminal
```

Wrangler prints the address, `https://spelunk.<your-subdomain>.workers.dev`. The first visit starts the container, which takes a few seconds; after 30 minutes without visitors it sleeps, and its sessions and downloads are forgotten. To use your own hostname, uncomment `routes` in `wrangler.jsonc` and deploy again.

Settings are the `vars` in `wrangler.jsonc`: `SPELUNK_ALLOWED_HOSTS`, `SPELUNK_MAX_REPOS`, `SPELUNK_CLONES_PER_HOUR` and `SPELUNK_MCP_DOWNLOADS_PER_HOUR` (new repositories `/mcp` may download in an hour, all callers together, because claude.ai's requests all come from Anthropic's addresses). Don't add Claude keys or git tokens as secrets; the server ignores them.

## Anywhere else

Any host that runs a Docker image works (Fly.io, Railway, Render, a VM). Put it behind HTTPS: the session cookie is marked `Secure`, so browsers drop it over plain HTTP on any host but `localhost`. Run a single instance, because sessions live in memory.
