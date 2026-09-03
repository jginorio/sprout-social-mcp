export type TagMeta = {
  tag_id: number;
  text: string;
  type?: string;
  active?: boolean;
  groups?: number[];
};

export type AnalyticsPost = {
  created_time?: string;
  perma_link?: string;
  text?: string;
  post_type?: string;
  network?: string;
  customer_profile_id?: string;
  guid?: string;
  metrics?: Record<string, number | null | undefined>;
  internal?: {
    tags?: Array<{ id: number }>;
  };
};

export type TagPostSummary = {
  guid?: string;
  created_time?: string;
  post_type?: string;
  network?: string;
  customer_profile_id?: string;
  perma_link?: string;
  text?: string;
  tag_ids: number[];
  metrics: Record<string, number>;
};

export type TagPerformanceRow = {
  tag_id: number;
  name: string;
  type?: string;
  active?: boolean;
  post_count: number;
  metrics: Record<string, number>;
  averages: Record<string, number>;
  engagement_rate_per_impression: number | null;
  by_network?: Record<
    string,
    {
      post_count: number;
      metrics: Record<string, number>;
      engagement_rate_per_impression: number | null;
    }
  >;
  top_posts: TagPostSummary[];
};

export type TagPerformanceReport = {
  reporting_period: { start: string; end: string };
  profile_ids: string[];
  posts_analyzed: number;
  unique_tagged_posts: number;
  pages_fetched: number;
  pages_available: number;
  truncated: boolean;
  note: string;
  tags: TagPerformanceRow[];
};

const DEFAULT_NOTE =
  "A post with multiple tags contributes its full lifetime metrics to each tag, matching Sprout's Tag Performance Report. " +
  "engagement_rate_per_impression is engagements / impressions when impressions > 0.";

export function extractTagIds(post: AnalyticsPost): number[] {
  const tags = post.internal?.tags ?? [];
  return tags
    .map((tag) => tag.id)
    .filter((id): id is number => typeof id === "number");
}

export function numericMetrics(
  metrics: Record<string, number | null | undefined> | undefined
): Record<string, number> {
  const out: Record<string, number> = {};
  if (!metrics) return out;
  for (const [key, value] of Object.entries(metrics)) {
    if (typeof value === "number" && Number.isFinite(value)) {
      out[key] = value;
    }
  }
  return out;
}

export function engagementRate(
  metrics: Record<string, number>
): number | null {
  const impressions = metrics["lifetime.impressions"] ?? metrics.impressions;
  const engagements = metrics["lifetime.engagements"] ?? metrics.engagements;
  if (
    typeof impressions !== "number" ||
    impressions <= 0 ||
    typeof engagements !== "number"
  ) {
    return null;
  }
  return Number((engagements / impressions).toFixed(6));
}

export function summarizePost(post: AnalyticsPost): TagPostSummary {
  const text = post.text ?? "";
  return {
    guid: post.guid,
    created_time: post.created_time,
    post_type: post.post_type,
    network: post.network,
    customer_profile_id: post.customer_profile_id,
    perma_link: post.perma_link,
    text: text.length > 180 ? `${text.slice(0, 177)}...` : text || undefined,
    tag_ids: extractTagIds(post),
    metrics: numericMetrics(post.metrics),
  };
}

function addMetrics(
  target: Record<string, number>,
  source: Record<string, number>
): void {
  for (const [key, value] of Object.entries(source)) {
    target[key] = (target[key] ?? 0) + value;
  }
}

function averages(
  totals: Record<string, number>,
  count: number
): Record<string, number> {
  const out: Record<string, number> = {};
  if (count <= 0) return out;
  for (const [key, value] of Object.entries(totals)) {
    out[key] = Number((value / count).toFixed(2));
  }
  return out;
}

export function resolveTagNames(
  tags: TagMeta[],
  names: string[]
): { matched: TagMeta[]; unmatched: string[]; ambiguous: Record<string, TagMeta[]> } {
  const matched: TagMeta[] = [];
  const unmatched: string[] = [];
  const ambiguous: Record<string, TagMeta[]> = {};
  const seen = new Set<number>();

  for (const raw of names) {
    const query = raw.trim().toLowerCase();
    if (!query) continue;

    const exact = tags.filter((tag) => tag.text.toLowerCase() === query);
    const pool = exact.length > 0
      ? exact
      : tags.filter((tag) => tag.text.toLowerCase().includes(query));

    if (pool.length === 0) {
      unmatched.push(raw);
      continue;
    }

    const preferred =
      pool.length > 1 ? pool.filter((tag) => tag.active !== false) : pool;
    const chosen = preferred.length > 0 ? preferred : pool;

    if (chosen.length > 1 && exact.length === 0) {
      ambiguous[raw] = chosen;
      continue;
    }

    for (const tag of chosen) {
      if (!seen.has(tag.tag_id)) {
        seen.add(tag.tag_id);
        matched.push(tag);
      }
    }
  }

  return { matched, unmatched, ambiguous };
}

export function filterTags(
  tags: TagMeta[],
  options: {
    active_only?: boolean;
    group_id?: string;
    type?: string;
    search?: string;
  }
): TagMeta[] {
  let result = tags;

  if (options.active_only) {
    result = result.filter((tag) => tag.active !== false);
  }

  if (options.group_id) {
    const groupId = Number(options.group_id);
    result = result.filter(
      (tag) => Array.isArray(tag.groups) && tag.groups.includes(groupId)
    );
  }

  if (options.type) {
    const type = options.type.toUpperCase();
    result = result.filter((tag) => (tag.type ?? "").toUpperCase() === type);
  }

  if (options.search) {
    const query = options.search.trim().toLowerCase();
    result = result.filter((tag) => tag.text.toLowerCase().includes(query));
  }

  return result;
}

export function aggregateTagPerformance(options: {
  posts: AnalyticsPost[];
  tagMeta: Map<number, TagMeta>;
  profileIds: string[];
  start: string;
  end: string;
  pagesFetched: number;
  pagesAvailable: number;
  truncated: boolean;
  restrictToTagIds?: number[];
  topPostsPerTag: number;
  groupByNetwork: boolean;
  sortBy: string;
}): TagPerformanceReport {
  const restrict = options.restrictToTagIds
    ? new Set(options.restrictToTagIds)
    : undefined;

  const buckets = new Map<
    number,
    {
      posts: AnalyticsPost[];
      totals: Record<string, number>;
      byNetwork: Map<string, { posts: AnalyticsPost[]; totals: Record<string, number> }>;
    }
  >();

  for (const post of options.posts) {
    const tagIds = extractTagIds(post);
    const metrics = numericMetrics(post.metrics);
    const network = post.network ?? "UNKNOWN";

    for (const tagId of tagIds) {
      if (restrict && !restrict.has(tagId)) continue;

      let bucket = buckets.get(tagId);
      if (!bucket) {
        bucket = { posts: [], totals: {}, byNetwork: new Map() };
        buckets.set(tagId, bucket);
      }
      bucket.posts.push(post);
      addMetrics(bucket.totals, metrics);

      if (options.groupByNetwork) {
        let networkBucket = bucket.byNetwork.get(network);
        if (!networkBucket) {
          networkBucket = { posts: [], totals: {} };
          bucket.byNetwork.set(network, networkBucket);
        }
        networkBucket.posts.push(post);
        addMetrics(networkBucket.totals, metrics);
      }
    }
  }

  // Include requested tags even if they had no posts in the window.
  if (restrict) {
    for (const tagId of restrict) {
      if (!buckets.has(tagId)) {
        buckets.set(tagId, { posts: [], totals: {}, byNetwork: new Map() });
      }
    }
  }

  const sortMetric = options.sortBy;
  const rows: TagPerformanceRow[] = [];

  for (const [tagId, bucket] of buckets) {
    const meta = options.tagMeta.get(tagId);
    const topPosts = [...bucket.posts]
      .sort((a, b) => comparePosts(a, b, sortMetric))
      .slice(0, options.topPostsPerTag)
      .map(summarizePost);

    const row: TagPerformanceRow = {
      tag_id: tagId,
      name: meta?.text ?? `Unknown tag ${tagId}`,
      type: meta?.type,
      active: meta?.active,
      post_count: bucket.posts.length,
      metrics: bucket.totals,
      averages: averages(bucket.totals, bucket.posts.length),
      engagement_rate_per_impression: engagementRate(bucket.totals),
      top_posts: topPosts,
    };

    if (options.groupByNetwork) {
      row.by_network = {};
      for (const [network, networkBucket] of bucket.byNetwork) {
        row.by_network[network] = {
          post_count: networkBucket.posts.length,
          metrics: networkBucket.totals,
          engagement_rate_per_impression: engagementRate(networkBucket.totals),
        };
      }
    }

    rows.push(row);
  }

  rows.sort((a, b) => compareRows(a, b, sortMetric));

  return {
    reporting_period: { start: options.start, end: options.end },
    profile_ids: options.profileIds,
    posts_analyzed: options.posts.length,
    unique_tagged_posts: options.posts.filter((post) => extractTagIds(post).length > 0)
      .length,
    pages_fetched: options.pagesFetched,
    pages_available: options.pagesAvailable,
    truncated: options.truncated,
    note: DEFAULT_NOTE,
    tags: rows,
  };
}

function metricValue(metrics: Record<string, number>, sortBy: string): number {
  if (sortBy === "engagement_rate") {
    return engagementRate(metrics) ?? 0;
  }
  if (sortBy === "post_count") {
    return 0;
  }
  return (
    metrics[sortBy] ??
    metrics[`lifetime.${sortBy}`] ??
    metrics["lifetime.impressions"] ??
    0
  );
}

function comparePosts(a: AnalyticsPost, b: AnalyticsPost, sortBy: string): number {
  const aMetrics = numericMetrics(a.metrics);
  const bMetrics = numericMetrics(b.metrics);
  return metricValue(bMetrics, sortBy) - metricValue(aMetrics, sortBy);
}

function compareRows(a: TagPerformanceRow, b: TagPerformanceRow, sortBy: string): number {
  if (sortBy === "post_count") {
    return b.post_count - a.post_count;
  }
  if (sortBy === "engagement_rate") {
    return (b.engagement_rate_per_impression ?? 0) - (a.engagement_rate_per_impression ?? 0);
  }
  const diff = metricValue(b.metrics, sortBy) - metricValue(a.metrics, sortBy);
  if (diff !== 0) return diff;
  return b.post_count - a.post_count;
}
