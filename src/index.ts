#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const SPROUT_API_BASE = "https://api.sproutsocial.com";

function getConfig() {
  const apiKey = process.env.SPROUT_SOCIAL_API_KEY;
  if (!apiKey) {
    throw new Error(
      "SPROUT_SOCIAL_API_KEY environment variable is required. " +
        "Set it to your Sprout Social API token."
    );
  }

  const customerId = process.env.SPROUT_SOCIAL_CUSTOMER_ID;
  if (!customerId) {
    throw new Error(
      "SPROUT_SOCIAL_CUSTOMER_ID environment variable is required. " +
        "Set it to your Sprout Social customer ID."
    );
  }

  return { apiKey, customerId };
}

async function sproutRequest(
  method: "GET" | "POST",
  path: string,
  body?: Record<string, unknown>
): Promise<unknown> {
  const { apiKey, customerId } = getConfig();
  const url = `${SPROUT_API_BASE}/v1/${customerId}${path}`;

  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    Accept: "application/json",
  };

  const options: RequestInit = { method, headers };

  if (body) {
    headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url, options);

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Sprout Social API error (${response.status}): ${errorText}`
    );
  }

  return response.json();
}

async function sproutMetadataRequest(path: string): Promise<unknown> {
  const { apiKey } = getConfig();
  const url = `${SPROUT_API_BASE}/v1${path}`;

  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Sprout Social API error (${response.status}): ${errorText}`
    );
  }

  return response.json();
}

const server = new McpServer({
  name: "Sprout Social MCP",
  version: "1.0.0",
});

// ─── Customer Metadata Tools ────────────────────────────────────────────────

server.tool(
  "get_client",
  "Get your Sprout Social customer IDs and names.",
  {},
  async () => {
    const data = await sproutMetadataRequest("/metadata/client");
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  "get_profiles",
  "List all social profiles connected to your Sprout Social account.",
  {},
  async () => {
    const data = await sproutRequest("GET", "/metadata/customer");
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  "get_groups",
  "List all groups in your Sprout Social account.",
  {},
  async () => {
    const data = await sproutRequest("GET", "/metadata/customer/groups");
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  "get_tags",
  "List all tags in your Sprout Social account.",
  {},
  async () => {
    const data = await sproutRequest("GET", "/metadata/customer/tags");
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  "get_users",
  "List all users in your Sprout Social account.",
  {},
  async () => {
    const data = await sproutRequest("GET", "/metadata/customer/users");
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  "get_topics",
  "List all listening topics in your Sprout Social account.",
  {},
  async () => {
    const data = await sproutRequest("GET", "/metadata/customer/topics");
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  "get_teams",
  "List all teams in your Sprout Social account.",
  {},
  async () => {
    const data = await sproutRequest("GET", "/metadata/customer/teams");
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  "get_case_queues",
  "List all case queues in your Sprout Social account.",
  {},
  async () => {
    const data = await sproutRequest("GET", "/metadata/customer/queues");
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

// ─── Analytics Tools ────────────────────────────────────────────────────────

server.tool(
  "get_profile_analytics",
  "Get owned profile-level analytics (impressions, engagements, etc.) for one or more profiles over a reporting period. " +
    "Requires a reporting_period filter in the format 'YYYY-MM-DD...YYYY-MM-DD' (max 1 year span).",
  {
    profile_ids: z
      .array(z.string())
      .describe(
        "Array of customer_profile_id values to query. Use get_profiles to discover available IDs."
      ),
    metrics: z
      .array(z.string())
      .describe(
        "Metrics to retrieve, e.g. ['impressions', 'engagements', 'reactions', 'post_link_clicks']. " +
          "Available metrics depend on profile type."
      ),
    reporting_period_start: z
      .string()
      .describe("Start date in YYYY-MM-DD format."),
    reporting_period_end: z
      .string()
      .describe("End date in YYYY-MM-DD format."),
    page: z
      .number()
      .optional()
      .describe("Page number for paginated results (default: 1)."),
  },
  async ({ profile_ids, metrics, reporting_period_start, reporting_period_end, page }) => {
    const body: Record<string, unknown> = {
      filters: [
        `customer_profile_id.eq(${profile_ids.join(", ")})`,
        `reporting_period.in(${reporting_period_start}...${reporting_period_end})`,
      ],
      metrics,
    };
    if (page) body.page = page;

    const data = await sproutRequest("POST", "/analytics/profiles", body);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  "get_post_analytics",
  "Get post-level analytics (impressions, engagements, etc.) for posts within a date range. " +
    "Supports pagination — always check paging.total_pages in the response and pull all pages. " +
    "IMPORTANT: The page parameter must be in the request body, not as a URL query parameter.",
  {
    profile_ids: z
      .array(z.string())
      .describe("Array of customer_profile_id values to filter posts by."),
    metrics: z
      .array(z.string())
      .describe(
        "Metrics to retrieve. " +
          "All platforms: 'lifetime.impressions', 'lifetime.engagements', 'lifetime.reactions', " +
          "'lifetime.video_views', 'lifetime.saves', 'lifetime.comments_count', 'lifetime.post_shares_count'. " +
          "Facebook only: 'lifetime.post_link_clicks', 'lifetime.post_content_clicks', 'lifetime.post_content_clicks_other'. " +
          "Instagram: click metrics are NOT available (silently ignored by the API). " +
          "INVALID (will error): 'lifetime.reach', 'lifetime.comments', 'lifetime.shares'."
      ),
    created_time_start: z
      .string()
      .describe(
        "Start of the date range in ISO 8601 format (e.g. '2026-03-23T00:00:00')."
      ),
    created_time_end: z
      .string()
      .describe(
        "End of the date range in ISO 8601 format (e.g. '2026-03-30T00:00:00')."
      ),
    fields: z
      .array(z.string())
      .optional()
      .describe(
        "Additional fields to include. Valid: 'created_time', 'perma_link', 'text', 'post_type'. " +
          "Defaults to all if omitted."
      ),
    page: z
      .number()
      .optional()
      .describe("Page number (default: 1). Must be in request body, NOT URL."),
  },
  async ({ profile_ids, metrics, created_time_start, created_time_end, fields, page }) => {
    const body: Record<string, unknown> = {
      filters: [
        `customer_profile_id.eq(${profile_ids.join(", ")})`,
        `created_time.in(${created_time_start}..${created_time_end})`,
      ],
      metrics,
    };

    if (fields && fields.length > 0) {
      body.fields = fields;
    } else {
      body.fields = ["created_time", "perma_link", "text", "post_type"];
    }

    if (page) body.page = page;

    const data = await sproutRequest("POST", "/analytics/posts", body);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

// ─── Messages Tool ──────────────────────────────────────────────────────────

server.tool(
  "get_messages",
  "Retrieve messages from your Sprout Social inbox. Supports cursor-based pagination. " +
    "Messages include those received by and sent from your profiles.",
  {
    profile_ids: z
      .array(z.string())
      .describe("Array of customer_profile_id values to filter messages by."),
    created_time_start: z
      .string()
      .optional()
      .describe("Filter messages created after this ISO 8601 datetime."),
    created_time_end: z
      .string()
      .optional()
      .describe("Filter messages created before this ISO 8601 datetime."),
    fields: z
      .array(z.string())
      .optional()
      .describe(
        "Fields to return. Refer to Sprout API docs for valid message fields."
      ),
    sort: z
      .array(z.string())
      .optional()
      .describe("Sort order, e.g. ['created_time:desc']."),
    limit: z
      .number()
      .optional()
      .describe("Maximum number of messages to return per page."),
  },
  async ({ profile_ids, created_time_start, created_time_end, fields, sort, limit }) => {
    const filters: string[] = [
      `customer_profile_id.eq(${profile_ids.join(", ")})`,
    ];

    if (created_time_start && created_time_end) {
      filters.push(
        `created_time.in(${created_time_start}..${created_time_end})`
      );
    }

    const body: Record<string, unknown> = { filters };
    if (fields) body.fields = fields;
    if (sort) body.sort = sort;
    if (limit) body.limit = limit;

    const data = await sproutRequest("POST", "/messages", body);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

// ─── Listening Tools ────────────────────────────────────────────────────────

server.tool(
  "get_listening_topic_metrics",
  "Get metrics for a specific listening topic (e.g. volume, sentiment, engagement). " +
    "Use get_topics first to discover available topic IDs.",
  {
    topic_id: z.string().describe("The listening topic ID."),
    metrics: z
      .array(z.string())
      .describe(
        "Metrics to retrieve for the topic. Refer to Sprout API docs for valid topic metrics."
      ),
    filters: z
      .array(z.string())
      .optional()
      .describe("Additional filter expressions."),
    page: z
      .number()
      .optional()
      .describe("Page number for paginated results."),
  },
  async ({ topic_id, metrics, filters, page }) => {
    const body: Record<string, unknown> = { metrics };
    if (filters) body.filters = filters;
    if (page) body.page = page;

    const data = await sproutRequest(
      "POST",
      `/listening/topics/${topic_id}/metrics`,
      body
    );
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  "get_listening_topic_messages",
  "Get messages found within a specific listening topic. " +
    "Use get_topics first to discover available topic IDs.",
  {
    topic_id: z.string().describe("The listening topic ID."),
    filters: z
      .array(z.string())
      .optional()
      .describe("Filter expressions for the messages query."),
    fields: z
      .array(z.string())
      .optional()
      .describe("Fields to return for each message."),
    sort: z
      .array(z.string())
      .optional()
      .describe("Sort order for results."),
    limit: z.number().optional().describe("Maximum messages per page."),
    page: z.number().optional().describe("Page number."),
  },
  async ({ topic_id, filters, fields, sort, limit, page }) => {
    const body: Record<string, unknown> = {};
    if (filters) body.filters = filters;
    if (fields) body.fields = fields;
    if (sort) body.sort = sort;
    if (limit) body.limit = limit;
    if (page) body.page = page;

    const data = await sproutRequest(
      "POST",
      `/listening/topics/${topic_id}/messages`,
      body
    );
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

// ─── Publishing Tools ───────────────────────────────────────────────────────

server.tool(
  "create_publishing_post",
  "Create a new publishing post in Sprout Social to be published at a future time. " +
    "The post will appear in Sprout's publishing calendar.",
  {
    profile_ids: z
      .array(z.string())
      .describe(
        "Array of customer_profile_id values the post will be published to."
      ),
    text: z.string().describe("The text content of the post."),
    scheduled_time: z
      .string()
      .describe(
        "ISO 8601 datetime when the post should be published (e.g. '2026-06-30T18:00:00Z')."
      ),
    media_ids: z
      .array(z.string())
      .optional()
      .describe(
        "Array of media IDs (from upload_media) to attach to the post."
      ),
    is_draft: z
      .boolean()
      .optional()
      .describe("If true, creates the post as a draft (default: false)."),
    tags: z
      .array(z.string())
      .optional()
      .describe("Array of tag IDs to apply to the post."),
  },
  async ({ profile_ids, text, scheduled_time, media_ids, is_draft, tags }) => {
    const entries = profile_ids.map((profileId) => {
      const entry: Record<string, unknown> = {
        customer_profile_id: profileId,
        text,
        scheduled_time,
        is_draft: is_draft ?? false,
      };
      if (media_ids && media_ids.length > 0) {
        entry.media = media_ids.map((id) => ({ id }));
      }
      if (tags && tags.length > 0) {
        entry.tags = tags;
      }
      return entry;
    });

    const data = await sproutRequest("POST", "/publishing/posts", {
      entries,
    });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  "get_publishing_post",
  "Retrieve details of a specific publishing post by its ID.",
  {
    publishing_post_id: z
      .string()
      .describe("The unique ID of the publishing post to retrieve."),
  },
  async ({ publishing_post_id }) => {
    const data = await sproutRequest(
      "GET",
      `/publishing/posts/${publishing_post_id}`
    );
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

// ─── Media Upload Tool ──────────────────────────────────────────────────────

server.tool(
  "upload_media",
  "Upload media (image/video) to Sprout Social for use in publishing posts. " +
    "Provide either a public URL to the media file. Returns a media ID to use with create_publishing_post.",
  {
    media_url: z
      .string()
      .describe("A public HTTP/HTTPS URL of the media file to upload."),
  },
  async ({ media_url }) => {
    const { apiKey, customerId } = getConfig();
    const url = `${SPROUT_API_BASE}/v1/${customerId}/media`;

    const formData = new FormData();
    formData.append("media_url", media_url);

    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Sprout Social media upload error (${response.status}): ${errorText}`
      );
    }

    const data = await response.json();
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

// ─── Cases Tool ─────────────────────────────────────────────────────────────

server.tool(
  "get_cases",
  "Retrieve cases (customer inquiries/issues) from Sprout Social. " +
    "Cases represent customer interactions that may require action by a social care agent.",
  {
    updated_time_start: z
      .string()
      .optional()
      .describe("Filter by updated time start (YYYY-MM-DD format)."),
    updated_time_end: z
      .string()
      .optional()
      .describe("Filter by updated time end (YYYY-MM-DD format)."),
    priority: z
      .array(z.string())
      .optional()
      .describe(
        "Filter by priority. Valid values: 'HIGH', 'MEDIUM', 'LOW', 'UNDEFINED'."
      ),
    limit: z.number().optional().describe("Maximum cases to return per page."),
    sort: z
      .array(z.string())
      .optional()
      .describe("Sort order, e.g. ['created_time:asc']."),
    timezone: z
      .string()
      .optional()
      .describe(
        "Timezone for date filters (e.g. 'America/Chicago'). Defaults to UTC."
      ),
    page_cursor: z
      .string()
      .optional()
      .describe("Cursor for pagination (from previous response)."),
  },
  async ({ updated_time_start, updated_time_end, priority, limit, sort, timezone, page_cursor }) => {
    const filters: string[] = [];

    if (updated_time_start && updated_time_end) {
      filters.push(
        `updated_time.in(${updated_time_start}...${updated_time_end})`
      );
    }

    if (priority && priority.length > 0) {
      filters.push(`priority.eq(${priority.join(", ")})`);
    }

    const body: Record<string, unknown> = {};
    if (filters.length > 0) body.filters = filters;
    if (limit) body.limit = limit;
    if (sort) body.sort = sort;
    if (timezone) body.timezone = timezone;
    if (page_cursor) body.page_cursor = page_cursor;

    const data = await sproutRequest("POST", "/cases/filter", body);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

// ─── Start Server ───────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Sprout Social MCP server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
