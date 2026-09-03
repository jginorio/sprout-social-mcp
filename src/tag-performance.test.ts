import { test } from "node:test";
import assert from "node:assert/strict";
import {
  aggregateTagPerformance,
  extractTagIds,
  filterTags,
  resolveTagNames,
  type AnalyticsPost,
  type TagMeta,
} from "./tag-performance.js";

const tags: TagMeta[] = [
  { tag_id: 1, text: "findit", type: "LABEL", active: true, groups: [2068236] },
  { tag_id: 2, text: "housing", type: "LABEL", active: true, groups: [2068236] },
  { tag_id: 3, text: "Restaurantes", type: "LABEL", active: true, groups: [2068236] },
  { tag_id: 4, text: "old housing", type: "LABEL", active: false, groups: [2068236] },
  { tag_id: 5, text: "travel", type: "LABEL", active: true, groups: [2068659] },
  { tag_id: 6, text: "findit pr", type: "LABEL", active: true, groups: [2068236] },
];

function post(partial: Partial<AnalyticsPost> & { tagIds: number[] }): AnalyticsPost {
  const { tagIds, ...rest } = partial;
  return {
    created_time: "2026-08-01T00:00:00Z",
    post_type: "INSTAGRAM_MEDIA",
    network: "INSTAGRAM",
    text: "hello",
    internal: { tags: tagIds.map((id) => ({ id })) },
    ...rest,
  };
}

test("extractTagIds reads internal.tags.id", () => {
  assert.deepEqual(extractTagIds(post({ tagIds: [1, 2] })), [1, 2]);
  assert.deepEqual(extractTagIds({}), []);
});

test("resolveTagNames prefers exact then unique substring matches", () => {
  const resolved = resolveTagNames(tags, ["Findit", "restaurante"]);
  assert.deepEqual(
    resolved.matched.map((tag) => tag.tag_id),
    [1, 3]
  );
  assert.deepEqual(resolved.unmatched, []);
  assert.deepEqual(resolved.ambiguous, {});
});

test("resolveTagNames reports unmatched and ambiguous names", () => {
  const resolved = resolveTagNames(tags, ["find", "missing"]);
  assert.deepEqual(resolved.unmatched, ["missing"]);
  assert.ok(resolved.ambiguous.find);
  assert.deepEqual(
    resolved.ambiguous.find.map((tag) => tag.tag_id).sort(),
    [1, 6]
  );
});

test("filterTags applies active, group, type, and search", () => {
  const filtered = filterTags(tags, {
    active_only: true,
    group_id: "2068236",
    type: "LABEL",
    search: "findit",
  });
  assert.deepEqual(
    filtered.map((tag) => tag.tag_id),
    [1, 6]
  );
});

test("aggregateTagPerformance assigns full metrics to each tag on a post", () => {
  const posts: AnalyticsPost[] = [
    post({
      tagIds: [1, 2],
      network: "INSTAGRAM",
      metrics: { "lifetime.impressions": 100, "lifetime.engagements": 10 },
    }),
    post({
      tagIds: [1],
      network: "FACEBOOK",
      metrics: { "lifetime.impressions": 50, "lifetime.engagements": 5 },
    }),
  ];

  const report = aggregateTagPerformance({
    posts,
    tagMeta: new Map(tags.map((tag) => [tag.tag_id, tag])),
    profileIds: ["5779087"],
    start: "2026-08-01T00:00:00",
    end: "2026-08-31T23:59:59",
    pagesFetched: 1,
    pagesAvailable: 1,
    truncated: false,
    topPostsPerTag: 5,
    groupByNetwork: true,
    sortBy: "lifetime.impressions",
  });

  assert.equal(report.posts_analyzed, 2);
  assert.equal(report.unique_tagged_posts, 2);
  assert.equal(report.tags.length, 2);

  const findit = report.tags[0];
  assert.equal(findit.tag_id, 1);
  assert.equal(findit.post_count, 2);
  assert.equal(findit.metrics["lifetime.impressions"], 150);
  assert.equal(findit.metrics["lifetime.engagements"], 15);
  assert.equal(findit.engagement_rate_per_impression, 0.1);
  assert.equal(findit.by_network?.INSTAGRAM.post_count, 1);
  assert.equal(findit.by_network?.FACEBOOK.post_count, 1);

  const housing = report.tags[1];
  assert.equal(housing.tag_id, 2);
  assert.equal(housing.post_count, 1);
  assert.equal(housing.metrics["lifetime.impressions"], 100);
});

test("aggregateTagPerformance includes requested tags with zero posts", () => {
  const report = aggregateTagPerformance({
    posts: [],
    tagMeta: new Map(tags.map((tag) => [tag.tag_id, tag])),
    profileIds: ["5779087"],
    start: "2026-08-01T00:00:00",
    end: "2026-08-31T23:59:59",
    pagesFetched: 1,
    pagesAvailable: 1,
    truncated: false,
    restrictToTagIds: [1],
    topPostsPerTag: 3,
    groupByNetwork: false,
    sortBy: "post_count",
  });

  assert.equal(report.tags.length, 1);
  assert.equal(report.tags[0].name, "findit");
  assert.equal(report.tags[0].post_count, 0);
});
