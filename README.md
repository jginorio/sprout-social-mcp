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
| `get_tags` | List all tags |
| `get_users` | List all users |
| `get_topics` | List all listening topics |
| `get_teams` | List all teams |
| `get_case_queues` | List all case queues |

### Analytics

| Tool | Description |
|---|---|
| `get_profile_analytics` | Profile-level analytics (impressions, engagements, etc.) for a date range |
| `get_post_analytics` | Post-level analytics with pagination. Supports impressions, engagements, reactions, video views |

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

The Sprout Social API paginates post analytics. Always check `paging.total_pages` in the response and request all pages:

```
Ask: "Get all Instagram post analytics for last week"
→ Tool calls get_post_analytics with page=1, then page=2, etc.
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

### Finding Profile IDs

Use `get_profiles` first to discover your `customer_profile_id` values, then pass them to analytics or publishing tools.

## Development

```bash
git clone https://github.com/jginorio/sprout-social-mcp.git
cd sprout-social-mcp
npm install
npm run build
```

To test locally:

```bash
SPROUT_SOCIAL_API_KEY=your-token \
SPROUT_SOCIAL_CUSTOMER_ID=your-customer-id \
node dist/index.js
```

## License

MIT
