import { getTableName, sql, type SQL } from "drizzle-orm";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";
import { articles, chatMessages, feedItems, sources } from "./schema.ts";

/**
 * `"table"."column"`. A column written directly in a select field's sql`` renders unqualified ("id"), so inside a
 * correlated subquery it binds to the inner table's column. Use this for every column in correlated subqueries.
 */
const col = (c: SQLiteColumn): SQL => sql`${sql.identifier(getTableName(c.table))}.${sql.identifier(c.name)}`;

/** Publisher of an article's first source. */
export const leadPublisher = sql<string | null>`(select ${col(sources.publisher)} from ${sources} where ${col(sources.articleId)} = ${col(articles.id)} order by ${col(sources.position)} limit 1)`;

/** True when there is no conversation about this article / feed item (chatted items live in Chats, not Saved). */
export const noChat = (type: "article" | "feed_item"): SQL =>
  sql`not exists (select 1 from ${chatMessages} where ${col(chatMessages.subjectType)} = ${type} and ${col(chatMessages.subjectId)} = ${col(type === "article" ? articles.id : feedItems.id)})`;
