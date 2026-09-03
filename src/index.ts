#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  aggregateTagPerformance,
  filterTags,
  resolveTagNames,
  type AnalyticsPost,
  type TagMeta,
} from "./tag-performance.js";

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

const DEFAULT_POST_METRICS = [
  "lifetime.impressions",
  "lifetime.engagements",
  "lifetime.reactions",
  "lifetime.video_views",
  "lifetime.saves",
  "lifetime.comments_count",
  "lifetime.post_shares_count",
  "lifetime.post_link_clicks",
];

const DEFAULT_POST_FIELDS = [
  "created_time",
  "perma_link",
  "text",
  "post_type",
  "network",
  "customer_profile_id",
  "guid",
  "internal.tags.id",
];

type PostsAnalyticsResponse = {
  data?: AnalyticsPost[];
  paging?: {
    current_page?: number;
    total_pages?: number;
  };
};

async function fetchTagMetadata(): Promise<TagMeta[]> {
  const data = (await sproutRequest("GET", "/metadata/customer/tags")) as {
    data?: TagMeta[];
  };
  return data.data ?? [];
}

async function fetchPostAnalyticsPage(body: Record<string, unknown>) {
  return (await sproutRequest(
    "POST",
    "/analytics/posts",
    body
  )) as PostsAnalyticsResponse;
}

async function fetchPostAnalyticsPages(options: {
  body: Record<string, unknown>;
  startPage?: number;
  maxPages: number;
}): Promise<{
  posts: AnalyticsPost[];
  pagesFetched: number;
  pagesAvailable: number;
  truncated: boolean;
}> {
  const startPage = options.startPage ?? 1;
  const first = await fetchPostAnalyticsPage({
    ...options.body,
    page: startPage,
  });
  const posts = [...(first.data ?? [])];
  const pagesAvailable = first.paging?.total_pages ?? 1;
  const lastPage = Math.min(pagesAvailable, startPage + options.maxPages - 1);

  for (let page = startPage + 1; page <= lastPage; page++) {
    const next = await fetchPostAnalyticsPage({
      ...options.body,
      page,
    });
    posts.push(...(next.data ?? []));
  }

  const pagesFetched = Math.max(0, lastPage - startPage + 1);
  return {
    posts,
    pagesFetched,
    pagesAvailable,
    truncated: lastPage < pagesAvailable,
  };
}

function parseTagIds(values?: Array<string | number>): number[] {
  if (!values || values.length === 0) return [];
  const ids: number[] = [];
  for (const value of values) {
    const id = typeof value === "number" ? value : Number(String(value).trim());
    if (!Number.isFinite(id)) {
      throw new Error(`Invalid tag_id: ${value}`);
    }
    ids.push(id);
  }
  return ids;
}

const server = new McpServer({
  name: "Sprout Social MCP",
  version: "1.1.0",
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
  "List message/post tags in your Sprout Social account. Optionally filter by active status, group, type (LABEL or CAMPAIGN), or name search. Use these tag_id values with get_tag_performance and get_post_analytics.",
  {
    active_only: z
      .boolean()
      .optional()
      .describe("If true, return only active (non-archived) tags."),
    group_id: z
      .string()
      .optional()
      .describe("Only return tags available in this group ID."),
    type: z
      .enum(["LABEL", "CAMPAIGN"])
      .optional()
      .describe("Filter by tag type."),
    search: z
      .string()
      .optional()
      .describe("Case-insensitive substring match against the tag name."),
  },
  async ({ active_only, group_id, type, search }) => {
    const tags = await fetchTagMetadata();
    const filtered = filterTags(tags, { active_only, group_id, type, search });
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            { data: filtered, count: filtered.length, total: tags.length },
            null,
            2
          ),
        },
      ],
    };
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
    "Supports filtering by Sprout tags via tag_ids or tagged_only. " +
    "Responses include internal.tags.id by default so posts can be grouped by tag. " +
    "Supports pagination — always check paging.total_pages in the response and pull all pages. " +
    "For a Tag Performance Report-style rollup, prefer get_tag_performance. " +
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
        "Additional fields to include. Valid: 'created_time', 'perma_link', 'text', 'post_type', " +
          "'network', 'customer_profile_id', 'guid', 'internal.tags.id'. " +
          "Defaults to those fields if omitted."
      ),
    tag_ids: z
      .array(z.union([z.string(), z.number()]))
      .optional()
      .describe(
        "Only return posts that have at least one of these Sprout tag IDs. " +
          "Use get_tags to discover IDs. Filter uses internal.tags.id.eq(...)."
      ),
    tagged_only: z
      .boolean()
      .optional()
      .describe(
        "If true, only return posts that have at least one tag. Ignored when tag_ids is provided."
      ),
    page: z
      .number()
      .optional()
      .describe("Page number (default: 1). Must be in request body, NOT URL."),
  },
  async ({
    profile_ids,
    metrics,
    created_time_start,
    created_time_end,
    fields,
    tag_ids,
    tagged_only,
    page,
  }) => {
    const filters = [
      `customer_profile_id.eq(${profile_ids.join(", ")})`,
      `created_time.in(${created_time_start}..${created_time_end})`,
    ];

    const parsedTagIds = parseTagIds(tag_ids);
    if (parsedTagIds.length > 0) {
      filters.push(`internal.tags.id.eq(${parsedTagIds.join(", ")})`);
    } else if (tagged_only) {
      filters.push("internal.tags.id.exists(true)");
    }

    const body: Record<string, unknown> = {
      filters,
      metrics,
      fields:
        fields && fields.length > 0
          ? fields
          : DEFAULT_POST_FIELDS,
    };

    if (page) body.page = page;

    const data = await sproutRequest("POST", "/analytics/posts", body);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  "get_tag_performance",
  "Automatically pull Tag Performance Report-style analytics: fetch tagged posts in a date range, " +
    "resolve tag names, and aggregate lifetime metrics by tag (and optionally by network). " +
    "Replaces exporting a tag report from Sprout for post insights. " +
    "Use get_tags first if you need to discover tag names/IDs. " +
    "If tag_ids and tag_names are omitted, every tagged post in the window is rolled up. " +
    "A post with multiple tags contributes its full metrics to each tag. " +
    "Pages through the Posts Analytics API automatically.",
  {
    profile_ids: z
      .array(z.string())
      .describe(
        "Array of customer_profile_id values to include. Use get_profiles to discover IDs."
      ),
    created_time_start: z
      .string()
      .describe(
        "Start of the published-date range in ISO 8601 format (e.g. '2026-08-01T00:00:00')."
      ),
    created_time_end: z
      .string()
      .describe(
        "End of the published-date range in ISO 8601 format (e.g. '2026-08-31T23:59:59')."
      ),
    tag_ids: z
      .array(z.union([z.string(), z.number()]))
      .optional()
      .describe(
        "Optional Sprout tag IDs to include. Combined with tag_names. Use get_tags to look these up."
      ),
    tag_names: z
      .array(z.string())
      .optional()
      .describe(
        "Optional tag names to resolve (case-insensitive exact match, then unique substring). " +
          "Ambiguous names are returned as an error listing candidates."
      ),
    metrics: z
      .array(z.string())
      .optional()
      .describe(
        "Post metrics to aggregate. Defaults to impressions, engagements, reactions, " +
          "video views, saves, comments, shares, and Facebook post link clicks. " +
          "INVALID: 'lifetime.reach', 'lifetime.comments', 'lifetime.shares'."
      ),
    exclude_post_types: z
      .array(z.string())
      .optional()
      .describe(
        "Post types to drop before aggregation, e.g. ['INSTAGRAM_STORY']."
      ),
    group_by_network: z
      .boolean()
      .optional()
      .describe("If true, also break each tag down by social network."),
    top_posts_per_tag: z
      .number()
      .optional()
      .describe("How many top posts to include per tag (default: 5)."),
    sort_by: z
      .enum([
        "lifetime.impressions",
        "lifetime.engagements",
        "lifetime.reactions",
        "post_count",
        "engagement_rate",
      ])
      .optional()
      .describe("Sort tags and top posts by this metric (default: lifetime.impressions)."),
    max_pages: z
      .number()
      .optional()
      .describe(
        "Max Posts Analytics pages to fetch (50 posts per page). Default 40. " +
          "Response sets truncated=true if more pages remain."
      ),
  },
  async ({
    profile_ids,
    created_time_start,
    created_time_end,
    tag_ids,
    tag_names,
    metrics,
    exclude_post_types,
    group_by_network,
    top_posts_per_tag,
    sort_by,
    max_pages,
  }) => {
    const tagMetaList = await fetchTagMetadata();
    const tagMeta = new Map(tagMetaList.map((tag) => [tag.tag_id, tag]));

    const requestedIds = parseTagIds(tag_ids);
    let unmatched: string[] = [];
    let ambiguous: Record<string, TagMeta[]> = {};

    if (tag_names && tag_names.length > 0) {
      const resolved = resolveTagNames(tagMetaList, tag_names);
      unmatched = resolved.unmatched;
      ambiguous = resolved.ambiguous;
      for (const tag of resolved.matched) {
        if (!requestedIds.includes(tag.tag_id)) {
          requestedIds.push(tag.tag_id);
        }
      }
    }

    if (unmatched.length > 0 || Object.keys(ambiguous).length > 0) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                error: "Could not uniquely resolve one or more tag names.",
                unmatched_tag_names: unmatched,
                ambiguous_tag_names: Object.fromEntries(
                  Object.entries(ambiguous).map(([name, candidates]) => [
                    name,
                    candidates.map((tag) => ({
                      tag_id: tag.tag_id,
                      text: tag.text,
                      type: tag.type,
                      active: tag.active,
                    })),
                  ])
                ),
                hint: "Pass explicit tag_ids from get_tags, or use a more specific tag_name.",
              },
              null,
              2
            ),
          },
        ],
      };
    }

    const filters = [
      `customer_profile_id.eq(${profile_ids.join(", ")})`,
      `created_time.in(${created_time_start}..${created_time_end})`,
    ];

    if (requestedIds.length > 0) {
      filters.push(`internal.tags.id.eq(${requestedIds.join(", ")})`);
    } else {
      filters.push("internal.tags.id.exists(true)");
    }

    const body: Record<string, unknown> = {
      filters,
      metrics: metrics && metrics.length > 0 ? metrics : DEFAULT_POST_METRICS,
      fields: DEFAULT_POST_FIELDS,
      limit: 50,
    };

    const { posts, pagesFetched, pagesAvailable, truncated } =
      await fetchPostAnalyticsPages({
        body,
        maxPages: max_pages ?? 40,
      });

    const excluded = new Set(
      (exclude_post_types ?? []).map((type) => type.toUpperCase())
    );
    const filteredPosts =
      excluded.size > 0
        ? posts.filter(
            (post) => !excluded.has((post.post_type ?? "").toUpperCase())
          )
        : posts;

    const report = aggregateTagPerformance({
      posts: filteredPosts,
      tagMeta,
      profileIds: profile_ids,
      start: created_time_start,
      end: created_time_end,
      pagesFetched,
      pagesAvailable,
      truncated,
      restrictToTagIds: requestedIds.length > 0 ? requestedIds : undefined,
      topPostsPerTag: top_posts_per_tag ?? 5,
      groupByNetwork: group_by_network ?? false,
      sortBy: sort_by ?? "lifetime.impressions",
    });

    return {
      content: [{ type: "text", text: JSON.stringify(report, null, 2) }],
    };
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
