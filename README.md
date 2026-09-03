# Sprout Social MCP Server

> **Note:** This is an unofficial, community-built MCP server to use while Sprout Social works on releasing their official one.

A [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) server for the [Sprout Social API](https://api.sproutsocial.com/docs/). It lets AI assistants (Claude, Cursor, Devin, etc.) access your Sprout Social data — analytics, publishing, messages, listening, and more — through a standardized interface.

## Quick Start

### Prerequisites

- Node.js 18+
- A Sprout Social API token ([how to create one](https://api.sproutsocial.com/docs/#using-api-tokens))
- Your Sprout Social Customer ID ([how to find it](https://api.sproutsocial.com/docs/#get-client-customer-id))

### Running via npx

No installation required:

```bash
SPROUT_SOCIAL_API_KEY=your-token \
SPROUT_SOCIAL_CUSTOMER_ID=your-customer-id \
npx sprout-social-mcp
```

### Configuration with Claude Desktop

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "sprout-social": {
      "command": "npx",
      "args": ["-y", "sprout-social-mcp"],
      "env": {
        "SPROUT_SOCIAL_API_KEY": "your-api-token",
        "SPROUT_SOCIAL_CUSTOMER_ID": "your-customer-id"
      }
    }
  }
}
```

### Configuration with Cursor

Add to your `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "sprout-social": {
      "command": "npx",
      "args": ["-y", "sprout-social-mcp"],
      "env": {
        "SPROUT_SOCIAL_API_KEY": "your-api-token",
        "SPROUT_SOCIAL_CUSTOMER_ID": "your-customer-id"
      }
    }
  }
}
```

### Configuration with VS Code (GitHub Copilot)

Add to your `.vscode/mcp.json`:

```json
{
  "servers": {
    "sprout-social": {
      "command": "npx",
      "args": ["-y", "sprout-social-mcp"],
      "env": {
        "SPROUT_SOCIAL_API_KEY": "your-api-token",
        "SPROUT_SOCIAL_CUSTOMER_ID": "your-customer-id"
      }
    }
  }
}
```

### Configuration with Devin

In Devin's MCP settings, add a new server:

- **Name:** `sprout-social`
- **Command:** `npx -y sprout-social-mcp`
- **Environment Variables:**
  - `SPROUT_SOCIAL_API_KEY` → your API token
  - `SPROUT_SOCIAL_CUSTOMER_ID` → your customer ID

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `SPROUT_SOCIAL_API_KEY` | Yes | Your Sprout Social API token |
| `SPROUT_SOCIAL_CUSTOMER_ID` | Yes | Your Sprout Social customer ID |

## Available Tools

### Customer Metadata

| Tool | Description |
|---|---|
| `get_client` | Get your Sprout Social customer IDs and names |
| `get_profiles` | List all connected social profiles |
| `get_groups` | List all groups |
| `get_tags` | List tags, with optional filters for active status, group, type, or name |
| `get_users` | List all users |
| `get_topics` | List all listening topics |
| `get_teams` | List all teams |
| `get_case_queues` | List all case queues |

### Analytics

| Tool | Description |
|---|---|
| `get_profile_analytics` | Profile-level analytics (impressions, engagements, etc.) for a date range |
| `get_post_analytics` | Post-level analytics with pagination. Supports impressions, engagements, reactions, video views, and tag filters |
| `get_tag_performance` | Tag Performance Report-style rollup: automatically pull tagged posts and aggregate lifetime metrics by tag |

### Messages

| Tool | Description |
|---|---|
| `get_messages` | Retrieve inbox messages with filtering and cursor-based pagination |

### Listening

| Tool | Description |
|---|---|
| `get_listening_topic_metrics` | Get metrics for a listening topic |
| `get_listening_topic_messages` | Get messages from a listening topic |

### Publishing

| Tool | Description |
|---|---|
| `create_publishing_post` | Create a new post to be published at a scheduled time |
| `get_publishing_post` | Retrieve details of a specific publishing post |

### Media

| Tool | Description |
|---|---|
| `upload_media` | Upload media via URL for use in publishing posts |

### Cases

| Tool | Description |
|---|---|
| `get_cases` | Retrieve customer cases/inquiries with filters for priority, time range, etc. |

## Usage Tips

### Post Analytics Pagination

The Sprout Social API paginates post analytics (50 posts per page). For normal ranges, check `paging.total_pages` and request the next `page`. For very large ranges (~10k+ posts), use `guid_cursor` instead of page numbers: pass the last `guid` from the previous response and keep going until a page comes back empty.

`get_post_analytics` also accepts `sort` (e.g. `['lifetime.impressions:desc']`) and `timezone` (ICANN name for the date filter; response times stay UTC). Cursor mode always sorts by `guid:asc`.

```
Ask: "Get all Instagram post analytics for last week"
→ Tool calls get_post_analytics with page=1, then page=2, etc.

Ask: "Top posts by impressions last month"
→ get_post_analytics with sort=['lifetime.impressions:desc']
```

### Valid Post-Level Metrics

**All platforms (Instagram, Facebook, LinkedIn, TikTok, etc.):**

- `lifetime.impressions` — total views
- `lifetime.engagements` — total engagement (likes, comments, shares, saves)
- `lifetime.reactions` — reactions only
- `lifetime.video_views` — video view count
- `lifetime.saves` — saves/bookmarks
- `lifetime.comments_count` — comment count
- `lifetime.post_shares_count` — share count

**Facebook only:**

- `lifetime.post_link_clicks` — clicks on links in the post
- `lifetime.post_content_clicks` — total clicks on post content
- `lifetime.post_content_clicks_other` — other content clicks

> **Platform limitations:**
> - **Reach** (`lifetime.reach`) is NOT available at the post level — only at the profile level via `get_profile_analytics`. This is a Sprout Social API limitation.
> - **Click metrics** are only available for Facebook posts. For Instagram, the API silently ignores them (no error, but no data returned).

**Invalid metrics** (will cause errors): `lifetime.comments`, `lifetime.shares`, `lifetime.reach`

### Tag Performance (replaces exporting a tag report)

Sprout has no dedicated tag-analytics endpoint. Tag data lives on posts (`internal.tags.id`) and can be combined with post metrics to reproduce the Tag Performance Report.

`get_tag_performance` does that automatically:

1. Resolves tag names/IDs via `get_tags` metadata
2. Pages through tagged posts in the date range
3. Aggregates lifetime metrics per tag (impressions, engagements, engagement rate, reactions, comments, shares, saves, video views, Facebook link clicks)
4. Returns top posts for each tag, and optionally a per-network breakdown

```
Ask: "How did the campaign and launch tags perform on Instagram last month?"
→ get_profiles (for Instagram customer_profile_id)
→ get_tag_performance with tag_names ["campaign", "launch"]
```

**Behavior notes:**

- A post with multiple tags contributes its **full** lifetime metrics to each tag — the same method Sprout uses in the Tag Performance Report.
- If `tag_ids` / `tag_names` are omitted, every tagged post in the window is rolled up.
- Ambiguous tag names return candidate IDs instead of guessing. Use `get_tags` (`search`, `active_only`, `group_id`) to pick the right ID.
- Stories often inflate post counts and dilute engagement rate. Pass `exclude_post_types: ["INSTAGRAM_STORY"]` when you want feed/reel performance only.
- Responses set `truncated: true` if `max_pages` stopped before all post pages were fetched (50 posts per page).

You can also filter raw posts without aggregating:

```
get_post_analytics(..., tag_ids: ["12345"], tagged_only: true)
```

The filter uses `internal.tags.id.eq(...)` / `internal.tags.id.exists(true)` on the Posts Analytics API. `tag_id.eq(...)` is **not** valid on that endpoint.

### Finding Profile IDs

Use `get_profiles` first to discover your `customer_profile_id` values, then pass them to analytics or publishing tools.

## Development

```bash
git clone https://github.com/jginorio/sprout-social-mcp.git
cd sprout-social-mcp
npm install
npm run build
npm test
```

To test locally:

```bash
SPROUT_SOCIAL_API_KEY=your-token \
SPROUT_SOCIAL_CUSTOMER_ID=your-customer-id \
node dist/index.js
```

## License

MIT
